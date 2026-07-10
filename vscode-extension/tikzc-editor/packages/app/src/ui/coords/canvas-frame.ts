import type { CanvasTransform } from "../../store/types";
import type { SvgViewBox } from "tikz-editor/svg/types";

export type CanvasFrame = {
  viewBox: SvgViewBox;
  canvasTransform: CanvasTransform;
  viewportRect: DOMRect | null;
  svgElement?: SVGSVGElement | null;
};
