import type { SyntaxNode } from "@lezer/common";

export function forEachChild(node: SyntaxNode, fn: (child: SyntaxNode) => void): void {
  let child = node.firstChild;
  while (child) {
    fn(child);
    child = child.nextSibling;
  }
}

export function walk(node: SyntaxNode, fn: (node: SyntaxNode) => void): void {
  fn(node);
  forEachChild(node, (child) => { walk(child, fn); });
}

export function findFirstNodeByName(root: SyntaxNode, name: string): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  walk(root, (node) => {
    if (!found && node.type.name === name) {
      found = node;
    }
  });
  return found;
}

export function findFirstChildByName(node: SyntaxNode, name: string): SyntaxNode | null {
  let child = node.firstChild;
  while (child) {
    if (child.type.name === name) {
      return child;
    }
    child = child.nextSibling;
  }
  return null;
}

export function firstNamedChild(node: SyntaxNode): SyntaxNode | null {
  let child = node.firstChild;
  while (child) {
    if (!child.type.isAnonymous) {
      return child;
    }
    child = child.nextSibling;
  }
  return null;
}
