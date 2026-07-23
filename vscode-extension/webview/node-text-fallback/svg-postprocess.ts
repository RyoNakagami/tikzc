/*
 * svg-postprocess.ts — convert a dvisvgm SVG document (from the
 * "latex.compileSnippet" RPC) into the { viewBox, body } shape of the
 * editor's NodeTextRenderPayload, so emit.ts can embed it exactly like a
 * MathJax fragment.
 *
 * Pure string processing (no DOM) so it runs in workers and unit tests.
 */

export type SnippetRenderPayload = {
  viewBox: { x: number; y: number; width: number; height: number };
  body: string;
};

/** djb2, hex-encoded — stable 8-char id prefix per cache key */
function hash8(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const ROOT_OPEN_TAG = /<svg\b[^>]*>/;
const VIEW_BOX_ATTR = /\bviewBox\s*=\s*(['"])([^'"]+)\1/;

/**
 * dvisvgm's --optimize=all emits glyph defs with generic ids (g0-172, page1
 * ...) that collide when several snippet fragments share one SVG document —
 * two snippets can define the same id for different glyphs. Prefix every id
 * and reference with a fragment-specific token.
 */
function namespaceIds(body: string, prefix: string): string {
  return body
    .replace(/\bid=(['"])([^'"]+)\1/g, (_m, q: string, id: string) => `id=${q}${prefix}${id}${q}`)
    .replace(
      /\b(xlink:href|href)=(['"])#([^'"]+)\2/g,
      (_m, attr: string, q: string, id: string) => `${attr}=${q}#${prefix}${id}${q}`
    )
    .replace(/\burl\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}${id})`);
}

/**
 * The editor's root <svg> declares only the default namespace, so a fragment
 * carrying dvisvgm's xlink:href would make the serialized export document
 * ill-formed XML (unbound prefix) — PNG/SVG export then fails even though
 * the live canvas (HTML parser) renders fine. Rewrite to the SVG2 plain
 * href, which every renderer the export targets understands.
 */
function dropXlinkPrefix(body: string): string {
  return body.replace(/\bxlink:href=/g, "href=");
}

/**
 * MathJax fragments paint with currentColor, which emit.ts drives through the
 * wrapper <svg color="...">. dvisvgm output paints explicit black by default;
 * map those to currentColor (keeping any other explicit colors, e.g. from
 * \textcolor) and set inheritable defaults on a wrapping <g> for the glyph
 * <use>/<path> elements that carry no fill attribute at all.
 */
function adoptCurrentColor(body: string): string {
  const recolored = body.replace(
    /\b(fill|stroke)=(['"])(#000000|#000|black|rgb\(0,\s*0,\s*0\))\2/gi,
    (_m, attr: string, q: string) => `${attr}=${q}currentColor${q}`
  );
  return `<g fill="currentColor" stroke="none">${recolored}</g>`;
}

/**
 * Extract viewBox + inner markup from a dvisvgm SVG document and rewrite it
 * for embedding. Returns null when the document has no parsable root/viewBox.
 */
export function toSnippetRenderPayload(
  cacheKey: string,
  svgDocument: string
): SnippetRenderPayload | null {
  const open = svgDocument.match(ROOT_OPEN_TAG);
  if (!open || open.index == null) return null;

  const viewBoxMatch = open[0].match(VIEW_BOX_ATTR);
  if (!viewBoxMatch) return null;
  const numbers = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number);
  if (numbers.length !== 4 || !numbers.every(Number.isFinite)) return null;
  const [x, y, width, height] = numbers;
  if (width <= 0 || height <= 0) return null;

  const close = svgDocument.lastIndexOf("</svg>");
  if (close === -1) return null;
  let body = svgDocument.slice(open.index + open[0].length, close).trim();
  body = namespaceIds(body, `n${hash8(cacheKey)}-`);
  body = dropXlinkPrefix(body);
  body = adoptCurrentColor(body);
  return { viewBox: { x, y, width, height }, body };
}
