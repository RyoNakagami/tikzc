import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { WorldPoint } from "../coords/points.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

/**
 * Find the closest point on a line segment to a given point.
 */
export function closestPointOnLine(p: WorldPoint, a: WorldPoint, b: WorldPoint): { t: number; point: WorldPoint } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) {
    return { t: 0, point: wp(a.x, a.y) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return {
    t,
    point: wp(a.x + t * dx, a.y + t * dy)
  };
}

/**
 * Evaluate a cubic Bezier at parameter t.
 */
export function evalCubic(t: number, c0: WorldPoint, c1: WorldPoint, c2: WorldPoint, c3: WorldPoint): WorldPoint {
  const s = 1 - t;
  const s2 = s * s;
  const t2 = t * t;
  return wp(
    s2 * s * c0.x + 3 * s2 * t * c1.x + 3 * s * t2 * c2.x + t2 * t * c3.x,
    s2 * s * c0.y + 3 * s2 * t * c1.y + 3 * s * t2 * c2.y + t2 * t * c3.y
  );
}

/**
 * Find the closest point on a cubic Bezier to a given point.
 * Uses iterative subdivision for robust results.
 */
export function closestPointOnCubic(
  p: WorldPoint,
  c0: WorldPoint,
  c1: WorldPoint,
  c2: WorldPoint,
  c3: WorldPoint
): { t: number; point: WorldPoint } {
  // Sample coarsely, then refine around the best sample
  const COARSE_SAMPLES = 32;
  let bestT = 0;
  let bestDistSq = Infinity;

  for (let i = 0; i <= COARSE_SAMPLES; i++) {
    const t = i / COARSE_SAMPLES;
    const pt = evalCubic(t, c0, c1, c2, c3);
    const dSq = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestT = t;
    }
  }

  // Refine with bisection
  let lo = Math.max(0, bestT - 1 / COARSE_SAMPLES);
  let hi = Math.min(1, bestT + 1 / COARSE_SAMPLES);
  for (let iter = 0; iter < 20; iter++) {
    const mid1 = lo + (hi - lo) / 3;
    const mid2 = hi - (hi - lo) / 3;
    const p1 = evalCubic(mid1, c0, c1, c2, c3);
    const p2 = evalCubic(mid2, c0, c1, c2, c3);
    const d1 = (p1.x - p.x) ** 2 + (p1.y - p.y) ** 2;
    const d2 = (p2.x - p.x) ** 2 + (p2.y - p.y) ** 2;
    if (d1 < d2) {
      hi = mid2;
    } else {
      lo = mid1;
    }
  }

  const finalT = (lo + hi) / 2;
  const finalPoint = evalCubic(finalT, c0, c1, c2, c3);
  return { t: finalT, point: finalPoint };
}

/**
 * Split a cubic Bezier at parameter t using de Casteljau subdivision.
 * Returns control points for the two resulting cubics.
 */
export function subdivideCubicAt(
  t: number,
  c0: WorldPoint,
  c1: WorldPoint,
  c2: WorldPoint,
  c3: WorldPoint
): { left: [WorldPoint, WorldPoint, WorldPoint, WorldPoint]; right: [WorldPoint, WorldPoint, WorldPoint, WorldPoint] } {
  const lerp = (a: WorldPoint, b: WorldPoint): WorldPoint =>
    wp(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));

  const p01 = lerp(c0, c1);
  const p12 = lerp(c1, c2);
  const p23 = lerp(c2, c3);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const p0123 = lerp(p012, p123);

  return {
    left: [c0, p01, p012, p0123],
    right: [p0123, p123, p23, c3]
  };
}
