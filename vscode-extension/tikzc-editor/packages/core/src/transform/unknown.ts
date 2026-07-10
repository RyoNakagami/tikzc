import type { SyntaxNode } from "@lezer/common";

import { unknownPathItemId, unknownStatementId } from "../ast/ids.js";
import type { UnknownPathItem, UnknownStatement } from "../ast/types.js";

export function mapUnknownPathItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): UnknownPathItem {
  return {
    kind: "UnknownPathItem",
    id: unknownPathItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

export function mapUnknownStatement(node: SyntaxNode, source: string, statementIndex: number): UnknownStatement {
  return {
    kind: "UnknownStatement",
    id: unknownStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}
