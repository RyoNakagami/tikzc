import { frameLocalPoint, frameLocalVector, worldPoint, worldVector } from "./points.js";
import type { FrameLocalPoint, FrameLocalVector, WorldPoint, WorldVector } from "./points.js";
import type { FrameToWorldTransform, WorldToFrameTransform } from "./transforms.js";
import { worldToFrameTransform } from "./transforms.js";
import { scalarValue, pt } from "./scalars.js";

export function applyFrameToWorldPoint(transform: FrameToWorldTransform, point: FrameLocalPoint): WorldPoint {
  return worldPoint(
    pt((transform.a * scalarValue(point.x) + transform.c * scalarValue(point.y) + transform.e)),
    pt((transform.b * scalarValue(point.x) + transform.d * scalarValue(point.y) + transform.f))
  );
}

export function applyFrameToWorldVector(
  transform: Pick<FrameToWorldTransform, "a" | "b" | "c" | "d">,
  vector: FrameLocalVector
): WorldVector {
  return worldVector(
    pt((transform.a * scalarValue(vector.x) + transform.c * scalarValue(vector.y))),
    pt((transform.b * scalarValue(vector.x) + transform.d * scalarValue(vector.y)))
  );
}

export function invertFrameToWorldTransform(transform: FrameToWorldTransform): WorldToFrameTransform | null {
  const det = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }
  return worldToFrameTransform(
    transform.d / det,
    -transform.b / det,
    -transform.c / det,
    transform.a / det,
    (transform.c * transform.f - transform.d * transform.e) / det,
    (transform.b * transform.e - transform.a * transform.f) / det
  );
}

export function applyWorldToFramePoint(transform: WorldToFrameTransform, point: WorldPoint): FrameLocalPoint {
  return frameLocalPoint(
    pt((transform.a * scalarValue(point.x) + transform.c * scalarValue(point.y) + transform.e)),
    pt((transform.b * scalarValue(point.x) + transform.d * scalarValue(point.y) + transform.f))
  );
}

export function applyWorldToFrameVector(
  transform: Pick<WorldToFrameTransform, "a" | "b" | "c" | "d">,
  vector: WorldVector
): FrameLocalVector {
  return frameLocalVector(
    pt((transform.a * scalarValue(vector.x) + transform.c * scalarValue(vector.y))),
    pt((transform.b * scalarValue(vector.x) + transform.d * scalarValue(vector.y)))
  );
}

export function worldToFrameLocal(point: WorldPoint, transform: FrameToWorldTransform): FrameLocalPoint | null {
  const inverse = invertFrameToWorldTransform(transform);
  if (!inverse) {
    return null;
  }
  return applyWorldToFramePoint(inverse, point);
}

export function worldVectorToFrameLocal(vector: WorldVector, transform: FrameToWorldTransform): FrameLocalVector | null {
  const inverse = invertFrameToWorldTransform(transform);
  if (!inverse) {
    return null;
  }
  return applyWorldToFrameVector(inverse, vector);
}

export const applyFrameTransform = applyFrameToWorldPoint;
export const applyFrameVector = applyFrameToWorldVector;
export const invertFrameTransform = invertFrameToWorldTransform;
