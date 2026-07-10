import type { FrameLocalPoint, FrameLocalVector, SourceCmPoint, WorldPoint, WorldVector } from "../coords/points.js";
import { cm } from "../coords/scalars.js";
import { sourceCmPoint } from "../coords/points.js";
import type { FrameTransform } from "../coords/transforms.js";
import { ptToCm } from "../coords/source.js";
import { worldToFrameLocal, worldVectorToFrameLocal } from "../coords/frame.js";

/**
 * Convert a world-space position to local (pre-transform) coordinates.
 * Returns null if the transform is not invertible.
 */
export function worldToFrameLocalPoint(world: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  return worldToFrameLocal(world, transform);
}

/**
 * Convert a world-space delta to a local-space delta (excludes translation).
 * Returns null if the transform is not invertible.
 */
export function worldVectorToFrameLocalPoint(delta: WorldVector, transform: FrameTransform): FrameLocalVector | null {
  return worldVectorToFrameLocal(delta, transform);
}

/**
 * Convert local coordinates (TeX points) to source units (cm).
 */
export function frameLocalPtToSourceCmPoint(local: Pick<FrameLocalPoint, "x" | "y"> | Pick<FrameLocalVector, "x" | "y">): SourceCmPoint {
  return sourceCmPoint(cm(ptToCm(local.x)), cm(ptToCm(local.y)));
}

export const worldToLocal = worldToFrameLocalPoint;
export const worldDeltaToLocalDelta = worldVectorToFrameLocalPoint;
export const localToSourceUnits = frameLocalPtToSourceCmPoint;
