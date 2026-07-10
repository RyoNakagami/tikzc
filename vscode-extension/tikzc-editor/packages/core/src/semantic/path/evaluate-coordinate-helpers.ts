import { frameLocalPoint, worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { frameTransform } from "../../coords/transforms.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import type { CoordinateForm, CoordinateItem } from "../../ast/types.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import type { EvaluatedCoordinate } from "../coords/evaluate.js";
import { applyMatrixToVector } from "../transform.js";
import { DEFAULT_GRID_STEP } from "./constants.js";
import type { PlacementSegment } from "./types.js";

function wv(x: number, y: number): WorldVector {
  return worldVector(pt(x), pt(y));
}

function inferSegmentEndHeadingDegrees(segment: PlacementSegment | null): number {
  if (!segment) {
    return 0;
  }

  let direction: WorldVector | null = null;
  if (segment.kind === "line") {
    direction = wv(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
  } else if (segment.kind === "hv") {
    direction = wv(segment.to.x - segment.bend.x, segment.to.y - segment.bend.y);
  } else if (segment.kind === "cubic") {
    direction = wv(segment.to.x - segment.c2.x, segment.to.y - segment.c2.y);
    if (Math.hypot(direction.x, direction.y) <= 1e-9) {
      direction = wv(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    }
  } else if (segment.kind === "arc") {
    direction = wv(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
  }

  if (!direction || Math.hypot(direction.x, direction.y) <= 1e-9) {
    return 0;
  }
  return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

export function evaluateTurnCoordinate(
  item: CoordinateItem,
  currentPoint: WorldPoint | null,
  transform: { a: number; b: number; c: number; d: number; e: number; f: number },
  lastPlacementSegment: PlacementSegment | null
): EvaluatedCoordinate | null {
  const hasTurnOption = item.options?.entries.some(
    (entry) =>
      (entry.kind === "flag" && entry.key === "turn") ||
      (entry.kind === "kv" && entry.key === "turn")
  );
  if (!hasTurnOption) {
    return null;
  }

  const polarForm: CoordinateForm = "polar";
  if (item.form !== "polar") {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: [`invalid-turn-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  if (!currentPoint) {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: ["turn-coordinate-without-current-point"],
      advancesCurrentPoint: true
    };
  }

  const angleQuantity = parseQuantityExpression(item.x.trim());
  const radius = parseLength(item.y, "cm");
  if (angleQuantity?.kind !== "scalar" || radius == null) {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: [`invalid-polar-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  const heading = inferSegmentEndHeadingDegrees(lastPlacementSegment);
  const absoluteAngle = heading + angleQuantity.value;
  const radians = (absoluteAngle * Math.PI) / 180;
  const localVector = frameLocalPoint(
    pt(radius * Math.cos(radians)),
    pt(radius * Math.sin(radians))
  );
  const delta = applyMatrixToVector(transform, localVector);

  return {
    kind: "transformed",
    world: worldPoint(pt(currentPoint.x + delta.x), pt(currentPoint.y + delta.y)),
    local: localVector,
    frame: frameTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f),
    coordinateForm: polarForm,
    relativePrefix: item.relativePrefix,
    diagnostics: [],
    advancesCurrentPoint: true
  };
}

export function resolveDefaultGridStep(
  transform: { a: number; b: number; c: number; d: number },
  axis: "x" | "y"
): number {
  const oneCoordinateUnit = parseLength("1", "cm") ?? DEFAULT_GRID_STEP;
  const vector =
    axis === "x"
      ? applyMatrixToVector(transform, wv(oneCoordinateUnit, 0))
      : applyMatrixToVector(transform, wv(0, oneCoordinateUnit));
  const magnitude = Math.hypot(vector.x, vector.y);
  return Number.isFinite(magnitude) && magnitude > 1e-9 ? magnitude : DEFAULT_GRID_STEP;
}
