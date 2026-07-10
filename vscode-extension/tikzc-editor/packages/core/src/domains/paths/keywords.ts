import type { SyntaxNode } from "@lezer/common";

import { pathKeywordItemId } from "../../ast/ids.js";
import type { PathKeywordItem } from "../../ast/types.js";
import { classifyPathKeyword } from "../../syntax/tokens.js";

export function maybeMapPathKeywordItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathKeywordItem | null {
  const keyword = classifyPathKeyword(node, source);
  if (!keyword) {
    return null;
  }

  return {
    kind: "PathKeyword",
    id: pathKeywordItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    keyword
  };
}
