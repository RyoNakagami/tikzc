export type ScannedFigure = {
  span: { from: number; to: number };
  beginSpan: { from: number; to: number };
  endSpan: { from: number; to: number };
  isTemplate: boolean;
};

type FigureCandidate = Omit<ScannedFigure, "isTemplate"> & {
  containsUnresolvedPlaceholder: boolean;
};

export function scanTikzFigures(source: string): ScannedFigure[] {
  const beginPattern = /\\begin\{tikzpicture\*?\}/g;
  const candidates: FigureCandidate[] = [];
  let hasPlaceholderCandidate = false;
  let match = beginPattern.exec(source);

  while (match) {
    const beginRaw = match[0];
    const beginFrom = match.index;
    const beginTo = beginFrom + beginRaw.length;
    const endToken = beginRaw.endsWith("*}") ? "\\end{tikzpicture*}" : "\\end{tikzpicture}";
    const endFrom = source.indexOf(endToken, beginTo);
    if (endFrom < 0) {
      break;
    }
    const endTo = endFrom + endToken.length;
    const inner = source.slice(beginTo, endFrom);
    const containsUnresolvedPlaceholder = containsUnresolvedMacroPlaceholder(inner);
    hasPlaceholderCandidate ||= containsUnresolvedPlaceholder;

    candidates.push({
      span: { from: beginFrom, to: endTo },
      beginSpan: { from: beginFrom, to: beginTo },
      endSpan: { from: endFrom, to: endTo },
      containsUnresolvedPlaceholder
    });
    beginPattern.lastIndex = endTo;
    match = beginPattern.exec(source);
  }

  if (!hasPlaceholderCandidate) {
    return candidates.map(({ containsUnresolvedPlaceholder: _containsUnresolvedPlaceholder, ...figure }) => ({
      ...figure,
      isTemplate: false
    }));
  }

  const macroBodySpans = collectMacroDefinitionBodySpans(source);
  return candidates.map(({ containsUnresolvedPlaceholder, ...figure }) => ({
    ...figure,
    isTemplate: containsUnresolvedPlaceholder && isInsideAnySpan(figure.beginSpan.from, macroBodySpans)
  }));
}

function collectMacroDefinitionBodySpans(source: string): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let cursor = 0;

  while (cursor < source.length) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char !== "\\") {
      cursor += 1;
      continue;
    }

    const command = readControlSequence(source, cursor);
    if (!command) {
      cursor += 1;
      continue;
    }
    cursor = command.to;

    if (command.raw === "\\def") {
      const body = tryReadDefBodySpan(source, cursor);
      if (body) {
        spans.push(body);
        cursor = body.to + 1;
      }
      continue;
    }

    if (
      command.raw === "\\newcommand" ||
      command.raw === "\\renewcommand" ||
      command.raw === "\\providecommand" ||
      command.raw === "\\DeclareRobustCommand" ||
      command.raw === "\\DeclareMathOperator"
    ) {
      const body = tryReadNewCommandBodySpan(source, cursor);
      if (body) {
        spans.push(body);
        cursor = body.to + 1;
      }
      continue;
    }
  }

  return spans;
}

function containsUnresolvedMacroPlaceholder(source: string): boolean {
  let cursor = 0;
  while (cursor < source.length) {
    const char = source.charAt(cursor);

    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }

    if (char === "\\") {
      cursor = Math.min(source.length, cursor + 2);
      continue;
    }

    if (char === "#") {
      const next = source.charAt(cursor + 1);
      if (next === "#") {
        cursor += 2;
        continue;
      }
      if (/[0-9]/u.test(next)) {
        return true;
      }
    }

    cursor += 1;
  }

  return false;
}

function skipComment(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    const char = source.charAt(cursor);
    cursor += 1;
    if (char === "\n" || char === "\r") {
      break;
    }
  }
  return cursor;
}

function skipWhitespaceAndComments(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    const char = source.charAt(cursor);
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    break;
  }
  return cursor;
}

function readControlSequence(source: string, from: number): { raw: string; from: number; to: number } | null {
  if (source.charAt(from) !== "\\") {
    return null;
  }
  let cursor = from + 1;
  while (cursor < source.length && /[A-Za-z@]/u.test(source.charAt(cursor))) {
    cursor += 1;
  }
  if (cursor === from + 1) {
    cursor = Math.min(source.length, from + 2);
  }
  return {
    raw: source.slice(from, cursor),
    from,
    to: cursor
  };
}

function readBalancedDelimited(
  source: string,
  from: number,
  openChar: "{" | "[",
  closeChar: "}" | "]"
): { from: number; to: number } | null {
  if (source.charAt(from) !== openChar) {
    return null;
  }
  let depth = 0;
  let cursor = from;
  while (cursor < source.length) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return { from, to: cursor - 1 };
      }
      continue;
    }
    cursor += 1;
  }
  return null;
}

function tryReadDefBodySpan(source: string, fromCursor: number): { from: number; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  const name = readControlSequence(source, cursor);
  if (!name) {
    return null;
  }
  cursor = name.to;

  while (cursor < source.length) {
    cursor = skipWhitespaceAndComments(source, cursor);
    const char = source.charAt(cursor);
    if (char === "{") {
      const group = readBalancedDelimited(source, cursor, "{", "}");
      return group ? { from: group.from + 1, to: group.to - 1 } : null;
    }
    if (char === "\\") {
      const control = readControlSequence(source, cursor);
      if (!control) {
        return null;
      }
      cursor = control.to;
      continue;
    }
    cursor += 1;
  }
  return null;
}

function tryReadNewCommandBodySpan(source: string, fromCursor: number): { from: number; to: number } | null {
  let cursor = skipWhitespaceAndComments(source, fromCursor);
  if (source.charAt(cursor) === "*") {
    cursor += 1;
  }
  cursor = skipWhitespaceAndComments(source, cursor);

  const directName = readControlSequence(source, cursor);
  if (directName) {
    cursor = directName.to;
  } else {
    const nameGroup = readBalancedDelimited(source, cursor, "{", "}");
    if (!nameGroup) {
      return null;
    }
    cursor = nameGroup.to + 1;
  }

  cursor = skipWhitespaceAndComments(source, cursor);
  const arityGroup = readBalancedDelimited(source, cursor, "[", "]");
  if (arityGroup) {
    cursor = arityGroup.to + 1;
  }

  cursor = skipWhitespaceAndComments(source, cursor);
  const optionalGroup = readBalancedDelimited(source, cursor, "[", "]");
  if (optionalGroup) {
    cursor = optionalGroup.to + 1;
  }

  cursor = skipWhitespaceAndComments(source, cursor);
  const body = readBalancedDelimited(source, cursor, "{", "}");
  if (!body) {
    return null;
  }
  return { from: body.from + 1, to: body.to - 1 };
}

function isInsideAnySpan(offset: number, spans: readonly { from: number; to: number }[]): boolean {
  for (const span of spans) {
    if (offset >= span.from && offset <= span.to) {
      return true;
    }
  }
  return false;
}
