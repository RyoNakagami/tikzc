import type { Px } from "./scalars.js";
import { pt, scalarValue } from "./scalars.js";

export function pxToPt(value: Px, zoom: number): ReturnType<typeof pt> {
  return pt(scalarValue(value) / Math.max(zoom, 1e-6));
}
