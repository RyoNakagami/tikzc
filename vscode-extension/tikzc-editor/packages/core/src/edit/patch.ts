import type { Span } from "../ast/types.js";

export function replaceSpan(source: string, span: Span, replacement: string): { source: string; changedSpan: Span } {
  const next = `${source.slice(0, span.from)}${replacement}${source.slice(span.to)}`;

  return {
    source: next,
    changedSpan: {
      from: span.from,
      to: span.from + replacement.length
    }
  };
}
