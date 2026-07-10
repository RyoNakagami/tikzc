import type { SyntaxNode } from "@lezer/common";

export const PATH_KEYWORDS = new Set([
  "--",
  "-|",
  "|-",
  "..",
  "edge",
  "at",
  "bend",
  "controls",
  "and",
  "cycle",
  "rectangle",
  "circle",
  "ellipse",
  "arc",
  "grid",
  "plot",
  "coordinates",
  "parabola",
  "sin",
  "cos"
]);

export function classifyPathKeyword(node: SyntaxNode, source: string): string | null {
  const raw = source.slice(node.from, node.to).trim().toLowerCase();
  if (PATH_KEYWORDS.has(raw)) {
    return raw;
  }
  return null;
}
