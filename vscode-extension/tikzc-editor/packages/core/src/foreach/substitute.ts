import type { ForeachIterationBinding } from "./types.js";

const CONTROL_SEQUENCE_REGEX = /\\[A-Za-z@]+/g;
const LETTER_HEAD_REGEX = /^[A-Za-z@]/;
const CONTROL_WORD_TAIL_REGEX = /\\[A-Za-z@]+$/;

export function substituteForeachBindings(input: string, bindings: Partial<ForeachIterationBinding>): string {
  return substituteForeachBindingsWithMap(input, bindings).output;
}

export type ForeachSubstitutionResult = {
  output: string;
  mapSpan: (span: { from: number; to: number }) => { from: number; to: number } | null;
};

export function substituteForeachBindingsWithMap(input: string, bindings: Partial<ForeachIterationBinding>): ForeachSubstitutionResult {
  if (input.length === 0 || Object.keys(bindings).length === 0) {
    return {
      output: input,
      mapSpan: (span) => ({ ...span })
    };
  }

  let output = "";
  const outputToInput: number[] = [];
  let cursor = 0;
  CONTROL_SEQUENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = CONTROL_SEQUENCE_REGEX.exec(input);
  while (match) {
    const raw = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + raw.length;

    const literal = input.slice(cursor, matchStart);
    output += literal;
    for (let offset = cursor; offset < matchStart; offset += 1) {
      outputToInput.push(offset);
    }

    const value = bindings[raw];
    if (value == null) {
      output += raw;
      for (let offset = matchStart; offset < matchEnd; offset += 1) {
        outputToInput.push(offset);
      }
    } else {
      if (requiresLeadingBoundary(output, value)) {
        output += "{}";
        outputToInput.push(matchStart, matchStart);
      }
      output += value;
      for (let index = 0; index < value.length; index += 1) {
        outputToInput.push(matchStart);
      }

    }

    cursor = matchEnd;
    match = CONTROL_SEQUENCE_REGEX.exec(input);
  }

  const tail = input.slice(cursor);
  output += tail;
  for (let offset = cursor; offset < input.length; offset += 1) {
    outputToInput.push(offset);
  }

  return {
    output,
    mapSpan: (span) => mapOutputSpanToInput(span, outputToInput, input.length)
  };
}

function mapOutputSpanToInput(
  span: { from: number; to: number },
  outputToInput: readonly number[],
  inputLength: number
): { from: number; to: number } | null {
  if (span.from < 0 || span.to < span.from || span.to > outputToInput.length) {
    return null;
  }
  if (span.from === span.to) {
    const mapped = outputToInput.at(Math.min(span.from, outputToInput.length - 1));
    return mapped == null ? null : { from: mapped, to: mapped };
  }

  let from = inputLength;
  let to = 0;
  for (let index = span.from; index < span.to; index += 1) {
    const mapped = outputToInput.at(index);
    if (mapped == null) {
      return null;
    }
    from = Math.min(from, mapped);
    to = Math.max(to, mapped + 1);
  }
  return { from, to };
}

function requiresLeadingBoundary(outputSoFar: string, replacement: string): boolean {
  return LETTER_HEAD_REGEX.test(replacement) && CONTROL_WORD_TAIL_REGEX.test(outputSoFar);
}
