import { expandTexConditionals } from "../conditionals/expand.js";
import type { MacroBinding, MacroOriginFrame } from "./types.js";

const CONTROL_SEQUENCE_REGEX = /\\[A-Za-z@]+/g;
const CONTROL_SEQUENCE_AT_START_REGEX = /^\\[A-Za-z@]+/;
const LETTER_HEAD_REGEX = /^[A-Za-z@]/;
const CONTROL_WORD_TAIL_REGEX = /\\[A-Za-z@]+$/;
const LETTER_CHAR_REGEX = /[A-Za-z@]/;
const DIGIT_REGEX = /[1-9]/;

export const DEFAULT_MACRO_EXPANSION_MAX_DEPTH = 100;

export type MacroExpansionTraceEvent = {
  macroName: string;
  provenance: MacroOriginFrame[];
};

export type MacroExpansionOptions = {
  maxDepth?: number;
  trace?: MacroExpansionTraceEvent[];
};

export function expandMacroBindings(
  input: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  opts: MacroExpansionOptions = {}
): string {
  if (input.length === 0 || bindings.size === 0) {
    return input;
  }

  const maxDepth = Math.max(1, opts.maxDepth ?? DEFAULT_MACRO_EXPANSION_MAX_DEPTH);
  let current = input;
  const seen = new Set<string>([current]);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = expandTexConditionals(substituteSinglePass(current, bindings, opts.trace));
    if (next === current) {
      return next;
    }
    if (seen.has(next)) {
      return next;
    }

    seen.add(next);
    current = next;
  }

  return current;
}

export function isControlSequenceToken(raw: string): boolean {
  return /^\\[A-Za-z@]+$/.test(raw.trim());
}

function substituteSinglePass(
  input: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  trace: MacroExpansionTraceEvent[] | undefined
): string {
  let output = "";
  let cursor = 0;
  CONTROL_SEQUENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = CONTROL_SEQUENCE_REGEX.exec(input);
  while (match) {
    const macroName = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + macroName.length;
    output += input.slice(cursor, matchStart);

    const binding = bindings.get(macroName);
    if (binding == null) {
      output += macroName;
      cursor = matchEnd;
      CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
      match = CONTROL_SEQUENCE_REGEX.exec(input);
      continue;
    }

    let replacement: string | null = null;
    let consumedUntil = matchEnd;

    if (binding.kind === "text") {
      replacement = binding.value;
    } else {
      const args = parseMacroInvocationArgs(
        input,
        matchEnd,
        binding.parameterCount,
        binding.optionalFirstArgDefault
      );
      if (args) {
        replacement = applyMacroArguments(binding.body, args.values);
        consumedUntil = args.nextIndex;
      }
    }

    if (replacement == null) {
      output += macroName;
      cursor = matchEnd;
      CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
      match = CONTROL_SEQUENCE_REGEX.exec(input);
      continue;
    }

    recordTrace(trace, macroName, binding.provenance);
    if (requiresLeadingBoundary(output, replacement)) {
      output += "{}";
    }
    output += replacement;
    const nextChar = input[consumedUntil] ?? "";
    if (requiresTrailingBoundary(replacement, nextChar)) {
      output += "{}";
    }

    cursor = consumedUntil;
    CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
    match = CONTROL_SEQUENCE_REGEX.exec(input);
  }

  output += input.slice(cursor);
  return output;
}

function parseMacroInvocationArgs(
  input: string,
  startIndex: number,
  count: number,
  optionalFirstArgDefault: string | undefined
): { values: string[]; nextIndex: number } | null {
  if (count <= 0) {
    return { values: [], nextIndex: startIndex };
  }

  let cursor = startIndex;
  const values: string[] = [];
  if (optionalFirstArgDefault != null) {
    cursor = skipWhitespace(input, cursor);
    if (input[cursor] === "[") {
      const optionalArg = parseOptionalBracketArgument(input, cursor);
      if (!optionalArg) {
        return null;
      }
      values.push(optionalArg.value);
      cursor = optionalArg.nextIndex;
    } else {
      values.push(optionalFirstArgDefault);
    }
  }

  const requiredCount = Math.max(0, count - values.length);
  for (let argIndex = 0; argIndex < requiredCount; argIndex += 1) {
    cursor = skipWhitespace(input, cursor);
    if (cursor >= input.length) {
      return null;
    }

    const parsed = parseSingleMacroArgument(input, cursor);
    if (!parsed) {
      return null;
    }
    values.push(parsed.value);
    cursor = parsed.nextIndex;
  }

  return {
    values,
    nextIndex: cursor
  };
}

function parseOptionalBracketArgument(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  return readBracketContent(input, startIndex);
}

function parseSingleMacroArgument(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  const first = input[startIndex] ?? "";
  if (first.length === 0) {
    return null;
  }

  if (first === "{") {
    return readBracedContent(input, startIndex);
  }

  if (first === "\\") {
    const match = CONTROL_SEQUENCE_AT_START_REGEX.exec(input.slice(startIndex));
    if (match) {
      return {
        value: match[0],
        nextIndex: startIndex + match[0].length
      };
    }
  }

  return {
    value: first,
    nextIndex: startIndex + 1
  };
}

function readBracedContent(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  let depth = 0;
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: input.slice(startIndex + 1, index),
          nextIndex: index + 1
        };
      }
    }
    index += 1;
  }

  return null;
}

function readBracketContent(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  let depth = 0;
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: input.slice(startIndex + 1, index),
          nextIndex: index + 1
        };
      }
    }
    index += 1;
  }

  return null;
}

function applyMacroArguments(template: string, args: string[]): string {
  let output = "";
  for (let index = 0; index < template.length; index += 1) {
    const char = template[index] ?? "";
    if (char !== "#") {
      output += char;
      continue;
    }

    const next = template[index + 1] ?? "";
    if (next === "#") {
      output += "#";
      index += 1;
      continue;
    }

    if (DIGIT_REGEX.test(next)) {
      const argIndex = Number.parseInt(next, 10) - 1;
      output += args[argIndex] ?? `#${next}`;
      index += 1;
      continue;
    }

    output += "#";
  }
  return output;
}

function recordTrace(trace: MacroExpansionTraceEvent[] | undefined, macroName: string, provenance: MacroOriginFrame[]): void {
  if (!trace) {
    return;
  }
  trace.push({
    macroName,
    provenance: cloneProvenance(provenance)
  });
}

function cloneProvenance(provenance: MacroOriginFrame[]): MacroOriginFrame[] {
  return provenance.map((entry) => ({
    macroName: entry.macroName,
    definitionId: entry.definitionId,
    definitionSpan: {
      from: entry.definitionSpan.from,
      to: entry.definitionSpan.to
    },
    commandRaw: entry.commandRaw
  }));
}

function skipWhitespace(input: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < input.length) {
    if (!/\s/.test(input[cursor] ?? "")) {
      break;
    }
    cursor += 1;
  }
  return cursor;
}

function requiresLeadingBoundary(outputSoFar: string, replacement: string): boolean {
  return LETTER_HEAD_REGEX.test(replacement) && CONTROL_WORD_TAIL_REGEX.test(outputSoFar);
}

function requiresTrailingBoundary(replacement: string, nextChar: string): boolean {
  return nextChar.length > 0 && LETTER_CHAR_REGEX.test(nextChar) && CONTROL_WORD_TAIL_REGEX.test(replacement);
}
