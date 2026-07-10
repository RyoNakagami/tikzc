import type { NodeTextRenderInfo } from "../../text/types.js";
import type { TwoPartShapeSizingInput } from "./shape-geometry.js";

export type NodeShape =
  | "rectangle"
  | "rounded rectangle"
  | "chamfered rectangle"
  | "cross out"
  | "strike out"
  | "circle"
  | "magnifying glass"
  | "circle split"
  | "circle solidus"
  | "ellipse split"
  | "diamond split"
  | "rectangle split"
  | "ellipse"
  | "diamond"
  | "trapezium"
  | "semicircle"
  | "regular polygon"
  | "star"
  | "isosceles triangle"
  | "kite"
  | "dart"
  | "circular sector"
  | "cylinder"
  | "cloud"
  | "starburst"
  | "signal"
  | "tape"
  | "rectangle callout"
  | "ellipse callout"
  | "cloud callout"
  | "single arrow"
  | "double arrow"
  | "coordinate";
export type NodeLayer = "front" | "behind";

export type NodeLayout = {
  textLines: string[];
  textBlockWidth: number;
  textBlockHeight: number;
  textRenderInfo: NodeTextRenderInfo;
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
  lineWidth: number;
  outerXSep: number;
  outerYSep: number;
  visualWidth: number;
  visualHeight: number;
  visualRadius: number;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  baseLineY: number;
  midLineY: number;
  twoPartShapeSizing?: TwoPartShapeSizingInput;
};
