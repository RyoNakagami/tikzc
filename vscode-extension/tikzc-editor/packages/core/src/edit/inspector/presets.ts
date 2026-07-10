import type { ResolvedPattern } from "../../semantic/types.js";

export type ArrowTipPresetId =
  | "none"
  | "arrow"
  | "stealth"
  | "latex"
  | "triangle"
  | "circle"
  | "square"
  | "kite"
  | "bar"
  | "hooks"
  | "custom";

export type DashStylePresetId =
  | "solid"
  | "dashed"
  | "densely dashed"
  | "loosely dashed"
  | "dotted"
  | "densely dotted"
  | "loosely dotted"
  | "custom";

export type LineCapPresetId = "butt" | "round" | "square" | "custom";

export type LineJoinPresetId = "miter" | "round" | "bevel" | "custom";

export type PathMorphingDecorationPresetId =
  | "none"
  | "zigzag"
  | "straight zigzag"
  | "random steps"
  | "saw"
  | "bent"
  | "bumps"
  | "coil"
  | "snake"
  | "custom";

export type FillModePresetId = "solid" | "gradient" | "pattern" | "custom";

export type FillShadingPresetId = "axis" | "radial" | "ball" | "custom";

export type FillPatternPresetId =
  | "horizontal lines"
  | "vertical lines"
  | "north east lines"
  | "north west lines"
  | "grid"
  | "crosshatch"
  | "dots"
  | "crosshatch dots"
  | "fivepointed stars"
  | "sixpointed stars"
  | "bricks"
  | "checkerboard"
  | "checkerboard light gray"
  | "horizontal lines light gray"
  | "horizontal lines gray"
  | "horizontal lines dark gray"
  | "horizontal lines light blue"
  | "horizontal lines dark blue"
  | "crosshatch dots gray"
  | "crosshatch dots light steel blue"
  | "Lines"
  | "Hatch"
  | "Dots"
  | "Stars"
  | "custom";

export type FillPatternMetaFamilyId = "Lines" | "Hatch" | "Dots" | "Stars";

export type FillPatternMetaOptionKey =
  | "angle"
  | "distance"
  | "xshift"
  | "yshift"
  | "line width"
  | "radius"
  | "points";

export type FillPatternMetaValues = {
  angle: number;
  distance: number;
  xshift: number;
  yshift: number;
  lineWidth: number;
  radius: number;
  points: number;
};

export type ArrowTipSide = "start" | "end";

export type ArrowTipPresetOption = {
  value: Exclude<ArrowTipPresetId, "custom">;
  label: string;
};

export type DashStylePresetOption = {
  value: Exclude<DashStylePresetId, "custom">;
  label: string;
};

export type LineCapPresetOption = {
  value: Exclude<LineCapPresetId, "custom">;
  label: string;
};

export type LineJoinPresetOption = {
  value: Exclude<LineJoinPresetId, "custom">;
  label: string;
};

export type PathMorphingDecorationPresetOption = {
  value: Exclude<PathMorphingDecorationPresetId, "custom">;
  label: string;
};

export type FillModePresetOption = {
  value: Exclude<FillModePresetId, "custom">;
  label: string;
};

export type FillShadingPresetOption = {
  value: Exclude<FillShadingPresetId, "custom">;
  label: string;
};

export type FillPatternPresetOption = {
  value: Exclude<FillPatternPresetId, "custom">;
  label: string;
};

export type NodeShapePresetId =
  | "rectangle"
  | "circle"
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
  | "custom";

export type NodeShapePresetOption = {
  value: Exclude<NodeShapePresetId, "custom">;
  label: string;
};

export type NodeFontFamilyId = "serif" | "sans" | "monospace";

export type NodeFontSizePresetId =
  | "tiny"
  | "scriptsize"
  | "footnotesize"
  | "small"
  | "normalsize"
  | "large"
  | "Large"
  | "LARGE"
  | "huge"
  | "Huge"
  | "custom";

export type NodeFontSizePresetOption = {
  value: Exclude<NodeFontSizePresetId, "custom">;
  label: string;
};

export type CuratedPathMorphingDecorationPresetId = Exclude<PathMorphingDecorationPresetId, "none" | "custom">;
export type PathMorphingDecorationSuboptionKey = "segment length" | "amplitude" | "aspect";
export type PathMorphingDecorationSuboptionSpec = {
  id: string;
  label: string;
  decorationKey: PathMorphingDecorationSuboptionKey;
  writeKey: string;
  step: number;
  unit?: "pt";
  defaultValue: number;
  clearKeys: readonly string[];
};

export const LINE_WIDTH_PRESETS: Array<{ label: string; value: number }> = [
  { label: "ultra thin", value: 0.1 },
  { label: "very thin", value: 0.2 },
  { label: "thin", value: 0.4 },
  { label: "semithick", value: 0.6 },
  { label: "thick", value: 0.8 },
  { label: "very thick", value: 1.2 },
  { label: "ultra thick", value: 1.6 }
];

export const ARROW_OPTION_KEY = "arrows";
const ARROW_SHORTHAND_KEYS = ["-", "->", "<-", "<->"] as const;
export const ARROW_DEFAULT_CLEAR_KEYS = [ARROW_OPTION_KEY, ...ARROW_SHORTHAND_KEYS] as const;
export const DASH_STYLE_PRESET_CLEAR_KEYS = [
  "solid",
  "dashed",
  "densely dashed",
  "loosely dashed",
  "dotted",
  "densely dotted",
  "loosely dotted",
  "dash pattern",
  "dash phase",
  "dash"
] as const;
export const DASH_PATTERN_EPSILON = 1e-3;
export const ARROW_TIP_OPTIONS: ArrowTipPresetOption[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "stealth", label: "Stealth" },
  { value: "latex", label: "Latex" },
  { value: "triangle", label: "Triangle" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "kite", label: "Diamond" },
  { value: "bar", label: "Bar" },
  { value: "hooks", label: "Hooks" }
];
export const DASH_STYLE_OPTIONS: DashStylePresetOption[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "densely dashed", label: "Densely dashed" },
  { value: "loosely dashed", label: "Loosely dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "densely dotted", label: "Densely dotted" },
  { value: "loosely dotted", label: "Loosely dotted" }
];
export const LINE_CAP_OPTIONS: LineCapPresetOption[] = [
  { value: "butt", label: "Butt" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" }
];
export const LINE_JOIN_OPTIONS: LineJoinPresetOption[] = [
  { value: "miter", label: "Miter" },
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" }
];
export const PATH_MORPHING_DECORATION_OPTIONS: PathMorphingDecorationPresetOption[] = [
  { value: "none", label: "None" },
  { value: "zigzag", label: "Zigzag" },
  { value: "straight zigzag", label: "Straight zigzag" },
  { value: "random steps", label: "Random steps" },
  { value: "saw", label: "Saw" },
  { value: "bent", label: "Bent" },
  { value: "bumps", label: "Bumps" },
  { value: "coil", label: "Coil" },
  { value: "snake", label: "Snake" }
];
export const PATH_MORPHING_DECORATION_SUBOPTION_SPECS: Record<
  PathMorphingDecorationSuboptionKey,
  PathMorphingDecorationSuboptionSpec
> = {
  "segment length": {
    id: "path-morphing-segment-length",
    label: "Segment length",
    decorationKey: "segment length",
    writeKey: "/pgf/decoration/segment length",
    step: 0.1,
    unit: "pt",
    defaultValue: 10,
    clearKeys: ["segment length", "/pgf/decoration/segment length", "/pgf/decorations/segment length"]
  },
  amplitude: {
    id: "path-morphing-amplitude",
    label: "Amplitude",
    decorationKey: "amplitude",
    writeKey: "/pgf/decoration/amplitude",
    step: 0.1,
    unit: "pt",
    defaultValue: 2.5,
    clearKeys: ["amplitude", "/pgf/decoration/amplitude", "/pgf/decorations/amplitude"]
  },
  aspect: {
    id: "path-morphing-aspect",
    label: "Aspect",
    decorationKey: "aspect",
    writeKey: "/pgf/decoration/aspect",
    step: 0.05,
    defaultValue: 0.5,
    clearKeys: ["aspect", "/pgf/decoration/aspect", "/pgf/decorations/aspect"]
  }
};
export const PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET: Partial<
  Record<CuratedPathMorphingDecorationPresetId, readonly PathMorphingDecorationSuboptionKey[]>
> = {
  zigzag: ["segment length", "amplitude"],
  "straight zigzag": ["segment length", "amplitude"],
  "random steps": ["segment length", "amplitude"],
  saw: ["segment length", "amplitude"],
  bent: ["amplitude", "aspect"],
  bumps: ["segment length", "amplitude"],
  coil: ["segment length", "amplitude"],
  snake: ["segment length", "amplitude"]
};
export const FILL_MODE_OPTIONS: FillModePresetOption[] = [
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
  { value: "pattern", label: "Pattern" }
];
export const FILL_SHADING_OPTIONS: FillShadingPresetOption[] = [
  { value: "axis", label: "Axis" },
  { value: "radial", label: "Radial" },
  { value: "ball", label: "Ball" }
];
export const FILL_PATTERN_OPTIONS: FillPatternPresetOption[] = [
  { value: "horizontal lines", label: "horizontal lines" },
  { value: "vertical lines", label: "vertical lines" },
  { value: "north east lines", label: "north east lines" },
  { value: "north west lines", label: "north west lines" },
  { value: "grid", label: "grid" },
  { value: "crosshatch", label: "crosshatch" },
  { value: "dots", label: "dots" },
  { value: "crosshatch dots", label: "crosshatch dots" },
  { value: "fivepointed stars", label: "fivepointed stars" },
  { value: "sixpointed stars", label: "sixpointed stars" },
  { value: "bricks", label: "bricks" },
  { value: "checkerboard", label: "checkerboard" },
  { value: "checkerboard light gray", label: "checkerboard light gray" },
  { value: "horizontal lines light gray", label: "horizontal lines light gray" },
  { value: "horizontal lines gray", label: "horizontal lines gray" },
  { value: "horizontal lines dark gray", label: "horizontal lines dark gray" },
  { value: "horizontal lines light blue", label: "horizontal lines light blue" },
  { value: "horizontal lines dark blue", label: "horizontal lines dark blue" },
  { value: "crosshatch dots gray", label: "crosshatch dots gray" },
  { value: "crosshatch dots light steel blue", label: "crosshatch dots light steel blue" },
  { value: "Lines", label: "Lines" },
  { value: "Hatch", label: "Hatch" },
  { value: "Dots", label: "Dots" },
  { value: "Stars", label: "Stars" }
];
export const NODE_SHAPE_OPTIONS: NodeShapePresetOption[] = [
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "diamond", label: "Diamond" },
  { value: "trapezium", label: "Trapezium" },
  { value: "semicircle", label: "Semicircle" },
  { value: "regular polygon", label: "Regular polygon" },
  { value: "star", label: "Star" },
  { value: "isosceles triangle", label: "Isosceles triangle" },
  { value: "kite", label: "Kite" },
  { value: "dart", label: "Dart" },
  { value: "circular sector", label: "Circular sector" },
  { value: "cylinder", label: "Cylinder" },
  { value: "cloud", label: "Cloud" },
  { value: "starburst", label: "Starburst" },
  { value: "signal", label: "Signal" },
  { value: "tape", label: "Tape" },
  { value: "rectangle callout", label: "Rectangle callout" },
  { value: "ellipse callout", label: "Ellipse callout" },
  { value: "cloud callout", label: "Cloud callout" },
  { value: "single arrow", label: "Single arrow" },
  { value: "double arrow", label: "Double arrow" }
];
export const NODE_SHAPE_KEY = "shape";
export const NODE_SHAPE_KNOWN_KEYS = [
  "rectangle",
  "circle",
  "ellipse",
  "diamond",
  "trapezium",
  "semicircle",
  "regular polygon",
  "star",
  "isosceles triangle",
  "kite",
  "dart",
  "circular sector",
  "cylinder",
  "cloud",
  "starburst",
  "signal",
  "tape",
  "rectangle callout",
  "ellipse callout",
  "cloud callout",
  "single arrow",
  "double arrow",
  "coordinate"
] as const;
export const CURATED_NODE_SHAPE_SET = new Set<Exclude<NodeShapePresetId, "custom">>(
  NODE_SHAPE_OPTIONS.map((option) => option.value)
);
export const NODE_SHAPE_KNOWN_SET = new Set<string>(NODE_SHAPE_KNOWN_KEYS);
export const NODE_SHAPE_CUSTOM_NOTE =
  "Custom node shape detected. Picking a preset shape will replace non-preset shape keys.";
export const NODE_INNER_SEP_DEFAULT = 3.333;
export const NODE_INNER_SEP_CLEAR_KEYS = ["inner xsep", "inner ysep"] as const;
export const NODE_INNER_SEP_CONFLICT_NOTE =
  "inner xsep/inner ysep detected. Editing Inner sep will replace axis-specific padding.";
export const NODE_MINIMUM_DIMENSION_DEFAULT = 1;
export const NODE_MINIMUM_DIMENSION_CLEAR_KEYS = ["minimum size"] as const;
export const NODE_MINIMUM_DIMENSION_CONFLICT_NOTE =
  "minimum size detected. Editing Minimum width/height will replace shared sizing with axis-specific values.";
export const NODE_FONT_KEYS = ["font", "node font"] as const;
export const NODE_FONT_CUSTOM_NOTE =
  "Custom font command detected. Editing in the toolbar will replace unsupported font tokens.";
export const NODE_FONT_SIZE_PRESETS: Array<{
  value: Exclude<NodeFontSizePresetId, "custom">;
  label: string;
  command: string;
  scale: number;
}> = [
  { value: "tiny", label: "tiny", command: "\\tiny", scale: 0.5 },
  { value: "scriptsize", label: "scriptsize", command: "\\scriptsize", scale: 0.7 },
  { value: "footnotesize", label: "footnotesize", command: "\\footnotesize", scale: 0.8 },
  { value: "small", label: "small", command: "\\small", scale: 0.9 },
  { value: "normalsize", label: "normalsize", command: "\\normalsize", scale: 1 },
  { value: "large", label: "large", command: "\\large", scale: 1.2 },
  { value: "Large", label: "Large", command: "\\Large", scale: 1.44 },
  { value: "LARGE", label: "LARGE", command: "\\LARGE", scale: 1.728 },
  { value: "huge", label: "huge", command: "\\huge", scale: 2.074 },
  { value: "Huge", label: "Huge", command: "\\Huge", scale: 2.488 }
];
export const NODE_FONT_PRESET_BY_ID = new Map(
  NODE_FONT_SIZE_PRESETS.map((preset) => [preset.value, preset] as const)
);
export const NODE_FONT_FAMILY_COMMAND: Record<NodeFontFamilyId, string> = {
  serif: "\\rmfamily",
  sans: "\\sffamily",
  monospace: "\\ttfamily"
};
export const NODE_FONT_WEIGHT_COMMAND: Record<"normal" | "bold", string> = {
  normal: "\\mdseries",
  bold: "\\bfseries"
};
export const NODE_FONT_STYLE_COMMAND: Record<"normal" | "italic", string> = {
  normal: "\\upshape",
  italic: "\\itshape"
};
export const NODE_FONT_SIZE_EPSILON = 0.02;
export const META_FILL_PATTERN_PRESETS = {
  lines: "Lines",
  hatch: "Hatch",
  dots: "Dots",
  stars: "Stars"
} as const satisfies Record<string, Exclude<FillPatternPresetId, "custom">>;
export const DEFAULT_META_PATTERN_DISTANCE = 3;
export const DEFAULT_META_PATTERN_STARS_DISTANCE = 8.5358;
export const DEFAULT_META_PATTERN_RADIUS = 0.5;
export const DEFAULT_META_PATTERN_STARS_RADIUS = 2.8453;
const META_FILL_PATTERN_VALUE_SET = new Set<string>(Object.values(META_FILL_PATTERN_PRESETS));
export const META_FILL_PATTERN_PRESET_BY_LOWER = new Map<string, Exclude<FillPatternPresetId, "custom">>(
  Object.values(META_FILL_PATTERN_PRESETS).map((value) => [value.toLowerCase(), value] as const)
);
export const FILL_PATTERN_PRESET_BY_LOWER = new Map<string, Exclude<FillPatternPresetId, "custom">>(
  FILL_PATTERN_OPTIONS.filter((option) => !META_FILL_PATTERN_VALUE_SET.has(option.value))
    .map((option) => [option.value.toLowerCase(), option.value] as const)
);
export const META_FILL_PATTERN_PRESET_BY_KIND: Record<
  ResolvedPattern["kind"],
  Exclude<FillPatternPresetId, "custom"> | null
> = {
  legacy: null,
  "meta-lines": "Lines",
  "meta-hatch": "Hatch",
  "meta-dots": "Dots",
  "meta-stars": "Stars"
};
export const FILL_STYLE_CUSTOM_NOTE = "Custom fill style detected. Picking a curated value will replace custom keys.";
export const PATH_MORPHING_DECORATION_CLEAR_KEYS = [
  "decorate",
  "/tikz/decorate",
  "decoration",
  "/pgf/decoration",
  "/pgf/decoration/name",
  "/pgf/decorations/name",
  "name",
  "mirror",
  "raise",
  "transform",
  "pre",
  "pre length",
  "post",
  "post length",
  "path has corners",
  "reverse path",
  "segment length",
  "/pgf/decoration/segment length",
  "/pgf/decorations/segment length",
  "amplitude",
  "/pgf/decoration/amplitude",
  "/pgf/decorations/amplitude",
  "aspect",
  "/pgf/decoration/aspect",
  "/pgf/decorations/aspect",
  "start radius",
  "shape size",
  "shape width",
  "shape start width",
  "shape height",
  "shape start height",
  "shape sep",
  "text",
  "text color",
  "text align",
  "text align/align",
  "text align/left indent",
  "text align/right indent"
] as const;
export const ROUNDED_CORNERS_CLEAR_KEYS = ["rounded corners", "sharp corners"] as const;
export const FILL_PATTERN_CLEAR_KEYS = [
  "pattern",
  "/tikz/pattern",
  "pattern color",
  "/tikz/pattern color"
] as const;
export const FILL_SHADING_CLEAR_KEYS = [
  "shade",
  "/tikz/shade",
  "shading",
  "/tikz/shading",
  "shading angle",
  "/tikz/shading angle",
  "top color",
  "/tikz/top color",
  "middle color",
  "/tikz/middle color",
  "bottom color",
  "/tikz/bottom color",
  "left color",
  "/tikz/left color",
  "right color",
  "/tikz/right color",
  "inner color",
  "/tikz/inner color",
  "outer color",
  "/tikz/outer color",
  "ball color",
  "/tikz/ball color",
  "lower left",
  "/tikz/lower left",
  "lower right",
  "/tikz/lower right",
  "upper left",
  "/tikz/upper left",
  "upper right",
  "/tikz/upper right"
] as const;
export const AXIS_SHADING_CONFLICT_CLEAR_KEYS = [
  "inner color",
  "/tikz/inner color",
  "outer color",
  "/tikz/outer color",
  "ball color",
  "/tikz/ball color",
  "lower left",
  "/tikz/lower left",
  "lower right",
  "/tikz/lower right",
  "upper left",
  "/tikz/upper left",
  "upper right",
  "/tikz/upper right"
] as const;
export const RADIAL_SHADING_CONFLICT_CLEAR_KEYS = [
  "shading angle",
  "/tikz/shading angle",
  "top color",
  "/tikz/top color",
  "middle color",
  "/tikz/middle color",
  "bottom color",
  "/tikz/bottom color",
  "left color",
  "/tikz/left color",
  "right color",
  "/tikz/right color",
  "ball color",
  "/tikz/ball color",
  "lower left",
  "/tikz/lower left",
  "lower right",
  "/tikz/lower right",
  "upper left",
  "/tikz/upper left",
  "upper right",
  "/tikz/upper right"
] as const;
export const BALL_SHADING_CONFLICT_CLEAR_KEYS = [
  "shading angle",
  "/tikz/shading angle",
  "top color",
  "/tikz/top color",
  "middle color",
  "/tikz/middle color",
  "bottom color",
  "/tikz/bottom color",
  "left color",
  "/tikz/left color",
  "right color",
  "/tikz/right color",
  "inner color",
  "/tikz/inner color",
  "outer color",
  "/tikz/outer color",
  "lower left",
  "/tikz/lower left",
  "lower right",
  "/tikz/lower right",
  "upper left",
  "/tikz/upper left",
  "upper right",
  "/tikz/upper right"
] as const;
export const SHADING_ACTIVATION_KEYS = new Set([
  "shading",
  "/tikz/shading",
  "shading angle",
  "/tikz/shading angle",
  "top color",
  "/tikz/top color",
  "middle color",
  "/tikz/middle color",
  "bottom color",
  "/tikz/bottom color",
  "left color",
  "/tikz/left color",
  "right color",
  "/tikz/right color",
  "inner color",
  "/tikz/inner color",
  "outer color",
  "/tikz/outer color",
  "ball color",
  "/tikz/ball color",
  "lower left",
  "/tikz/lower left",
  "lower right",
  "/tikz/lower right",
  "upper left",
  "/tikz/upper left",
  "upper right",
  "/tikz/upper right"
]);

export const ROUNDED_CORNERS_DEFAULT_RADIUS = 4;

export type ShadowPresetId = "none" | "drop-shadow" | "copy-shadow" | "circular-drop-shadow" | "circular-glow";

export type ShadowPresetOption = {
  value: Exclude<ShadowPresetId, "none">;
  label: string;
};

export const SHADOW_PRESET_OPTIONS: ShadowPresetOption[] = [
  { value: "drop-shadow", label: "Drop shadow" },
  { value: "copy-shadow", label: "Copy shadow" },
  { value: "circular-drop-shadow", label: "Circular drop shadow" },
  { value: "circular-glow", label: "Circular glow" }
];

export const SHADOW_PRESET_TIKZ_KEY: Record<Exclude<ShadowPresetId, "none">, string> = {
  "drop-shadow": "drop shadow",
  "copy-shadow": "copy shadow",
  "circular-drop-shadow": "circular drop shadow",
  "circular-glow": "circular glow"
};

export const SHADOW_ALL_KEYS = [
  "drop shadow",
  "copy shadow",
  "circular drop shadow",
  "circular glow",
  "general shadow",
  "double copy shadow"
] as const;

// 1ex = 4.3pt (standard approximation used throughout this codebase)
const SHADOW_EX_IN_PT = 4.3;

export type ShadowPresetDefaults = {
  xshiftPt: number;
  yshiftPt: number;
  scale: number;
  /** null means opacity is not written by this preset */
  opacity: number | null;
  /** null means fill is not written by this preset (uses path's own color) */
  color: string | null;
};

export const SHADOW_PRESET_DEFAULTS: Record<Exclude<ShadowPresetId, "none">, ShadowPresetDefaults> = {
  "drop-shadow": {
    xshiftPt: 0.5 * SHADOW_EX_IN_PT,
    yshiftPt: -0.5 * SHADOW_EX_IN_PT,
    scale: 1,
    opacity: 0.5,
    color: "black!50"
  },
  "copy-shadow": {
    xshiftPt: 0.5 * SHADOW_EX_IN_PT,
    yshiftPt: -0.5 * SHADOW_EX_IN_PT,
    scale: 1,
    opacity: null,
    color: null
  },
  "circular-drop-shadow": {
    xshiftPt: 0.3 * SHADOW_EX_IN_PT,
    yshiftPt: -0.3 * SHADOW_EX_IN_PT,
    scale: 1.1,
    opacity: null,
    color: "black"
  },
  "circular-glow": {
    xshiftPt: 0,
    yshiftPt: 0,
    scale: 1.25,
    opacity: null,
    color: "black"
  }
};
