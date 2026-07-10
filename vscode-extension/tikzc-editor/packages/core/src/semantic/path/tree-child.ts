import type { WorldPoint } from "../../coords/points.js";
import type { EdgeFromParentOperationItem, PathItem } from "../../ast/types.js";

export function hasFollowingChildOperation(items: PathItem[], startIndex: number): boolean {
  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind === "PathComment" || item.kind === "PathOption") {
      continue;
    }
    return item.kind === "ChildOperation";
  }
  return false;
}

export function hasNamedTreeRootNode(items: PathItem[]): boolean {
  for (const item of items) {
    if (item.kind === "PathComment" || item.kind === "PathOption") {
      continue;
    }
    return item.kind === "Node" && typeof item.name === "string" && item.name.trim().length > 0;
  }
  return false;
}

export function splitChildBodyAndTrailingEdgeFromParent(
  items: PathItem[]
): {
  body: PathItem[];
  trailingEdge: EdgeFromParentOperationItem | null;
  trailingCoordinateOperations: Array<Extract<PathItem, { kind: "CoordinateOperation" }>>;
} {
  const explicitEdges = items.filter((item): item is EdgeFromParentOperationItem => item.kind === "EdgeFromParentOperation");
  const trailingEdge = explicitEdges.length > 0 ? explicitEdges[explicitEdges.length - 1] : null;
  if (!trailingEdge) {
    return {
      body: [...items],
      trailingEdge: null,
      trailingCoordinateOperations: []
    };
  }

  const trailingEdgeIndex = items.lastIndexOf(trailingEdge);
  const trailingLabelNodes: Array<Extract<PathItem, { kind: "Node" }>> = [];
  const trailingCoordinateOperations: Array<Extract<PathItem, { kind: "CoordinateOperation" }>> = [];
  const absorbedNodeIndexes = new Set<number>();
  for (let cursor = trailingEdgeIndex + 1; cursor < items.length; cursor += 1) {
    const candidate = items[cursor];
    if (!candidate || candidate.kind === "PathComment") {
      continue;
    }
    if (candidate.kind === "Node") {
      trailingLabelNodes.push(candidate);
      absorbedNodeIndexes.add(cursor);
      continue;
    }
    if (candidate.kind === "CoordinateOperation") {
      trailingCoordinateOperations.push(candidate);
      absorbedNodeIndexes.add(cursor);
      continue;
    }
    break;
  }

  const mergedTrailingEdge: EdgeFromParentOperationItem =
    trailingLabelNodes.length > 0
      ? {
          ...trailingEdge,
          nodes: [...(trailingEdge.nodes ?? []), ...trailingLabelNodes]
        }
      : trailingEdge;

  return {
    body: items.filter((item, index) => item.kind !== "EdgeFromParentOperation" && !absorbedNodeIndexes.has(index)),
    trailingEdge: mergedTrailingEdge,
    trailingCoordinateOperations
  };
}

export function formatPointCoordinateRaw(point: WorldPoint): string {
  const x = Number.isFinite(point.x) ? Number(point.x.toFixed(6)) : point.x;
  const y = Number.isFinite(point.y) ? Number(point.y.toFixed(6)) : point.y;
  return `(${x}pt,${y}pt)`;
}

export function sanitizeGeneratedNodeName(raw: string): string {
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "node";
}
