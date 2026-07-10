import type { SceneFigure } from "../semantic/types.js";
import type { SvgViewBox } from "./types.js";

export function computeViewBox(scene: SceneFigure, padding = 12): SvgViewBox {
  const bounds = scene.bounds;
  if (!bounds) {
    return { x: -padding, y: -padding, width: 100 + padding * 2, height: 100 + padding * 2 };
  }

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: width + padding * 2,
    height: height + padding * 2
  };
}

