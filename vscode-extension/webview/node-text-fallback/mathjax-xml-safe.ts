/*
 * mathjax-xml-safe.ts — make MathJax fragment markup well-formed XML.
 *
 * MathJax's LiteParser serializes fragments in HTML mode, where attribute
 * values only escape `&` and `"` — a `data-latex` value like
 * `$d_i<\lambda_{\mathrm{obs}}$` keeps its raw `<`. The live canvas parses
 * the markup as HTML and doesn't care, but every export path re-parses the
 * serialized document as strict XML (`<img src=svg>` for PNG, DOMParser
 * "image/svg+xml" for PDF, browsers opening the saved .svg), which rejects
 * the document — "Failed to decode SVG for PNG export."
 *
 * Pure string processing (no DOM) so it runs in workers and unit tests.
 */

/**
 * Escape raw `<` and `>` inside quoted attribute values. Text content is
 * left untouched (MathJax already escapes it), so the transform is
 * idempotent and safe for both HTML and XML consumers.
 */
export function escapeAngleBracketsInAttributeValues(markup: string): string {
  if (!markup.includes("<") && !markup.includes(">")) {
    return markup;
  }
  let out = "";
  let i = 0;
  let inTag = false;
  let quote: '"' | "'" | null = null;
  while (i < markup.length) {
    const ch = markup[i];
    if (!inTag) {
      if (ch === "<") {
        if (markup.startsWith("<!--", i)) {
          const end = markup.indexOf("-->", i + 4);
          const stop = end === -1 ? markup.length : end + 3;
          out += markup.slice(i, stop);
          i = stop;
          continue;
        }
        inTag = true;
      }
      out += ch;
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        out += ch;
      } else if (ch === "<") {
        out += "&lt;";
      } else if (ch === ">") {
        out += "&gt;";
      } else {
        out += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      inTag = false;
    }
    out += ch;
    i++;
  }
  return out;
}
