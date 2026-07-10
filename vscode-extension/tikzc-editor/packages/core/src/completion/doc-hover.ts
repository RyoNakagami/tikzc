import type { SyntaxNode, Tree } from "@lezer/common";

import { parseOptionListRaw } from "../options/parse.js";

export type DocHoverTargetKind =
  | "option-key"
  | "option-value"
  | "command"
  | "keyword"
  | "operator";

export type DocHoverTarget = {
  kind: DocHoverTargetKind;
  from: number;
  to: number;
  query: string;
  candidates: string[];
};

export type ResolveDocHoverTargetInput = {
  source: string;
  tree: Tree;
  pos: number;
};

const SUPPORTED_COMMAND_TOKENS = new Set([
  "DrawCmd",
  "PathCmd",
  "FillDrawCmd",
  "FillCmd",
  "PatternCmd",
  "ClipCmd",
  "ShadeCmd",
  "ShadeDrawCmd",
  "UseAsBoundingBoxCmd",
  "MatrixCmd",
  "NodeCmd",
  "CoordinateCmd"
]);

const SUPPORTED_KEYWORD_TOKENS = new Set([
  "ToKw",
  "CircleKw",
  "RectangleKw",
  "EllipseKw",
  "ArcKw",
  "GridKw",
  "PlotKw",
  "NodeKw",
  "EdgeKw",
  "CoordinateKw"
]);

const SUPPORTED_OPERATORS = new Set(["--", "-|", "|-", ".."]);

export function resolveDocHoverTarget(input: ResolveDocHoverTargetInput): DocHoverTarget | null {
  const { source, tree } = input;
  if (source.length === 0) {
    return null;
  }

  const clampedPos = Math.max(0, Math.min(source.length, input.pos));
  const nodeAtPos = resolveInnerNode(tree, clampedPos, source.length);
  if (!nodeAtPos) {
    return null;
  }

  if (isInsideComment(nodeAtPos)) {
    return null;
  }

  const optionTarget = resolveOptionTarget(source, nodeAtPos, clampedPos);
  if (optionTarget) {
    return optionTarget;
  }

  return resolveTokenTarget(source, nodeAtPos);
}

function resolveOptionTarget(source: string, node: SyntaxNode, pos: number): DocHoverTarget | null {
  const optionNode = findAncestor(node, "OptionList");
  if (!optionNode) {
    return null;
  }

  const optionRaw = source.slice(optionNode.from, optionNode.to);
  const parsed = parseOptionListRaw(optionRaw, optionNode.from);
  for (const entry of parsed.entries) {
    if (entry.kind === "kv") {
      const keySpan = entry.keySpan ?? entry.span;
      if (containsPosition(keySpan, pos)) {
        const query = entry.key;
        return {
          kind: "option-key",
          from: keySpan.from,
          to: keySpan.to,
          query,
          candidates: optionKeyCandidates(query)
        };
      }
      if (entry.valueSpan && containsPosition(entry.valueSpan, pos)) {
        const query = entry.key;
        return {
          kind: "option-value",
          from: entry.valueSpan.from,
          to: entry.valueSpan.to,
          query,
          candidates: optionKeyCandidates(query)
        };
      }
      continue;
    }

    if (entry.kind === "flag" && containsPosition(entry.keySpan ?? entry.span, pos)) {
      const keySpan = entry.keySpan ?? entry.span;
      const query = entry.key;
      return {
        kind: "option-key",
        from: keySpan.from,
        to: keySpan.to,
        query,
        candidates: optionKeyCandidates(query)
      };
    }
  }

  return null;
}

function resolveTokenTarget(source: string, node: SyntaxNode): DocHoverTarget | null {
  const tokenName = node.name;
  const tokenText = source.slice(node.from, node.to).trim();
  if (!tokenText) {
    return null;
  }

  if (SUPPORTED_COMMAND_TOKENS.has(tokenName)) {
    const normalized = normalizeCommandToken(tokenText);
    if (!normalized) {
      return null;
    }
    return {
      kind: "command",
      from: node.from,
      to: node.to,
      query: normalized,
      candidates: [normalized]
    };
  }

  if (SUPPORTED_KEYWORD_TOKENS.has(tokenName)) {
    const keyword = tokenText.toLowerCase();
    return {
      kind: "keyword",
      from: node.from,
      to: node.to,
      query: keyword,
      candidates: uniqueNonEmpty([keyword, `/tikz/${keyword}`])
    };
  }

  if (tokenName === "PathOperator" || tokenName === "GroupPathOperator") {
    const operator = normalizeOperatorToken(tokenText);
    if (!operator || !SUPPORTED_OPERATORS.has(operator)) {
      return null;
    }
    return {
      kind: "operator",
      from: node.from,
      to: node.to,
      query: operator,
      candidates: [operator]
    };
  }

  return null;
}

function resolveInnerNode(tree: Tree, pos: number, sourceLength: number): SyntaxNode | null {
  const nodeAtPos = tree.resolveInner(pos, 0);
  if (nodeAtPos.name !== "TikzFile") {
    return nodeAtPos;
  }
  if (pos > 0) {
    const left = tree.resolveInner(pos - 1, 0);
    if (left.name !== "TikzFile") {
      return left;
    }
  }
  if (pos < sourceLength) {
    const right = tree.resolveInner(pos + 1, 0);
    if (right.name !== "TikzFile") {
      return right;
    }
  }
  return null;
}

function findAncestor(node: SyntaxNode, name: string): SyntaxNode | null {
  let cursor: SyntaxNode | null = node;
  while (cursor) {
    if (cursor.name === name) {
      return cursor;
    }
    cursor = cursor.parent;
  }
  return null;
}

function isInsideComment(node: SyntaxNode): boolean {
  return findAncestor(node, "Comment") !== null;
}

function containsPosition(span: { from: number; to: number }, pos: number): boolean {
  return pos >= span.from && pos <= span.to;
}

function optionKeyCandidates(rawKey: string): string[] {
  const key = rawKey.trim().toLowerCase();
  if (!key) {
    return [];
  }

  if (key.startsWith("/tikz/")) {
    const short = key.slice("/tikz/".length).trim();
    return uniqueNonEmpty([key, short]);
  }

  if (key.startsWith("/pgf/")) {
    const short = key.slice("/pgf/".length).trim();
    return uniqueNonEmpty([key, short]);
  }

  return uniqueNonEmpty([key, `/tikz/${key}`, `/pgf/${key}`]);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeCommandToken(token: string): string | null {
  if (!token.startsWith("\\")) {
    return null;
  }
  const command = token.slice(1).trim();
  if (!command) {
    return null;
  }
  return `\\${command.toLowerCase()}`;
}

function normalizeOperatorToken(token: string): string | null {
  const stripped = token.replace(/\s+/g, "");
  return stripped.length > 0 ? stripped : null;
}
