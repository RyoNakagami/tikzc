import type { SyntaxNode } from "@lezer/common";

import type { Diagnostic } from "../../diagnostics/types.js";
import { walk } from "../../syntax/cursor.js";
import { parseCoordinate } from "./parse.js";

export function collectCoordinateDiagnostics(root: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  walk(root, (node) => {
    if (node.type.name !== "Coordinate") {
      return;
    }

    const raw = source.slice(node.from, node.to);
    if (raw.trim() === "()" && isEmptyNodeNameCoordinate(node, source)) {
      return;
    }
    if (!parseCoordinate(raw).isWellFormed) {
      diagnostics.push({
        severity: "warning",
        message: `Malformed coordinate \`${formatCoordinatePreview(raw)}\`; use a named coordinate such as \`(A)\` or numeric parts such as \`(0,0)\`.`,
        span: { from: node.from, to: node.to },
        code: "malformed-coordinate"
      });
    }
  });
}

function isEmptyNodeNameCoordinate(node: SyntaxNode, source: string): boolean {
  for (let current: SyntaxNode | null = node.parent; current; current = current.parent) {
    if (current.type.name === "NodeName") {
      return true;
    }
    if (current.type.name === "PathStatement" || current.type.name === "Statement") {
      break;
    }
  }

  const lookbehind = source.slice(Math.max(0, node.from - 48), node.from);
  const lookahead = source.slice(node.to, Math.min(source.length, node.to + 48));
  return /\bnode\s*$/.test(lookbehind) && /^\s*(?:\[|at\b|\{)/.test(lookahead);
}

function formatCoordinatePreview(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 40) {
    return trimmed;
  }
  return `${trimmed.slice(0, 39)}...`;
}
