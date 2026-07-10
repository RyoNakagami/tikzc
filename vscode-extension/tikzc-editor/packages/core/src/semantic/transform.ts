import { worldPoint, worldVector } from "../coords/points.js";
import type { WorldPoint, WorldVector } from "../coords/points.js";
import { worldTransform } from "../coords/transforms.js";
import type { WorldTransform } from "../coords/transforms.js";
import { pt } from "../coords/scalars.js";

export function identityMatrix(): WorldTransform {
  return worldTransform(1, 0, 0, 1, 0, 0);
}

export function multiplyMatrix(left: WorldTransform, right: WorldTransform): WorldTransform {
  return worldTransform(
    left.a * right.a + left.c * right.b,
    left.b * right.a + left.d * right.b,
    left.a * right.c + left.c * right.d,
    left.b * right.c + left.d * right.d,
    left.a * right.e + left.c * right.f + left.e,
    left.b * right.e + left.d * right.f + left.f
  );
}

export function applyMatrix(matrix: WorldTransform, point: WorldPoint): WorldPoint {
  return worldPoint(
    pt(matrix.a * point.x + matrix.c * point.y + matrix.e),
    pt(matrix.b * point.x + matrix.d * point.y + matrix.f)
  );
}

export function applyMatrixToVector(
  matrix: Pick<WorldTransform, "a" | "b" | "c" | "d">,
  point: Pick<WorldPoint, "x" | "y">
): WorldVector {
  return worldVector(
    pt(matrix.a * point.x + matrix.c * point.y),
    pt(matrix.b * point.x + matrix.d * point.y)
  );
}

export function translationMatrix(tx: number, ty: number): WorldTransform {
  return worldTransform(1, 0, 0, 1, tx, ty);
}

export function scaleMatrix(sx: number, sy: number): WorldTransform {
  return worldTransform(sx, 0, 0, sy, 0, 0);
}

export function rotationMatrix(degrees: number): WorldTransform {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return worldTransform(cos, sin, -sin, cos, 0, 0);
}

export function inverseMatrix(matrix: WorldTransform): WorldTransform | null {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }
  return worldTransform(
    matrix.d / det,
    -matrix.b / det,
    -matrix.c / det,
    matrix.a / det,
    (matrix.c * matrix.f - matrix.d * matrix.e) / det,
    (matrix.b * matrix.e - matrix.a * matrix.f) / det
  );
}
