import type { ArrowTip } from "../../semantic/types.js";
import type { ArrowShorteningResult, ArrowSide, ArrowTipMetrics, ArrowTipPlan, NormalizedArrowTip } from "./types.js";

const EPSILON = 1e-6;
const DEFAULT_CONTEXT_LINE_WIDTH = 0.4;
const DEFAULT_STEALTH_INSET_FACTOR = 0.325;

export type LatexShapeParameters = {
  length: number;
  width: number;
  lineWidth: number;
  frontMiter: number;
  innerLength: number;
  halfBackWidth: number;
};

export type StealthShapeParameters = {
  length: number;
  width: number;
  lineWidth: number;
  inset: number;
  frontMiter: number;
  backMiter: number;
  topMiter: number;
  insetMiter: number;
  innerLength: number;
  innerHalfWidth: number;
};

type ArrowTipInput = Omit<ArrowTip, "afterLineEnd"> & { afterLineEnd?: boolean };

export function normalizeArrowTip(tip: ArrowTipInput, contextLineWidth: number, fallbackColor: string): NormalizedArrowTip {
  const lineWidth = normalizeLineWidth(tip.lineWidth, contextLineWidth);
  return {
    ...tip,
    afterLineEnd: tip.afterLineEnd ?? false,
    length: Math.max(0.01, tip.length),
    width: Math.max(0.01, tip.width),
    sep: Math.max(0, tip.sep),
    lineWidth,
    color: tip.color ?? fallbackColor
  };
}

export function computeArrowShortening(side: ArrowSide, tips: NormalizedArrowTip[], contextLineWidth: number): ArrowShorteningResult {
  if (tips.length === 0) {
    return { lineEndShortening: 0, totalLength: 0, plans: [] };
  }

  const metricsList = tips.map((tip) => buildArrowTipMetrics(tip, contextLineWidth));
  let lineEndShortening = 0;
  let totalLength = 0;
  for (let index = 0; index < tips.length; index += 1) {
    const tip = tips[index];
    const metrics = metricsList[index];
    const delta = metrics.tipEnd - metrics.backEnd + metrics.sep;
    totalLength += delta;
    if (tip.afterLineEnd) {
      lineEndShortening += metrics.tipEnd + metrics.sep - metrics.backEnd;
    } else {
      lineEndShortening = metrics.tipEnd + metrics.sep - metrics.lineEnd;
    }
  }

  let prefixLength = 0;
  const plans: ArrowTipPlan[] = [];
  for (let index = 0; index < tips.length; index += 1) {
    const tip = tips[index];
    const metrics = metricsList[index];
    const delta = metrics.tipEnd - metrics.backEnd + metrics.sep;
    const offset = lineEndShortening - totalLength + prefixLength - metrics.backEnd + metrics.lineEnd;
    plans.push({
      side,
      index,
      tip,
      metrics,
      offset,
      bend: tip.bend
    });
    prefixLength += delta;
  }

  return {
    lineEndShortening: Math.max(0, lineEndShortening),
    totalLength,
    plans
  };
}

export function buildArrowTipMetrics(tip: NormalizedArrowTip, contextLineWidth: number): ArrowTipMetrics {
  if (tip.kind === "latex") {
    const params = computeLatexShapeParameters(tip);
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.round ? params.innerLength + 0.5 * params.lineWidth : params.length - 0.5 * params.lineWidth,
      backEnd: -0.5 * params.lineWidth,
      lineEnd: tip.reversed ? params.innerLength - 0.5 * normalizeLineWidth(contextLineWidth, contextLineWidth) : 0,
      visualTipEnd: tip.round ? params.innerLength + 0.5 * params.lineWidth : params.length - 0.5 * params.lineWidth,
      visualBackEnd: -0.5 * params.lineWidth,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "stealth") {
    const params = computeStealthShapeParameters(tip);
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.round ? params.innerLength + params.backMiter + 0.5 * params.lineWidth : params.length,
      backEnd: tip.round ? params.backMiter - 0.5 * params.lineWidth : 0,
      lineEnd: tip.reversed
        ? params.innerLength + params.backMiter - 0.25 * normalizeLineWidth(contextLineWidth, contextLineWidth)
        : params.inset + params.insetMiter - 0.25 * params.lineWidth,
      visualTipEnd: tip.round ? params.innerLength + params.backMiter + 0.5 * params.lineWidth : params.length,
      visualBackEnd: params.inset,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "kite") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: Math.max(0, tip.inset ?? 0.25 * tip.length),
      visualTipEnd: tip.length,
      visualBackEnd: Math.max(0, tip.inset ?? 0),
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "cm-rightarrow") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: Math.max(0, tip.length - tip.lineWidth),
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "bar") {
    let metrics: ArrowTipMetrics = {
      tipEnd: 0,
      backEnd: 0,
      lineEnd: 0,
      visualTipEnd: 0,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "hooks" || tip.kind === "straight-barb" || tip.kind === "arc-barb") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: tip.length,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "tee-barb") {
    let metrics: ArrowTipMetrics = {
      tipEnd: Math.max(tip.length, tip.inset ?? 0),
      backEnd: Math.min(0, -(tip.inset ?? 0)),
      lineEnd: 0,
      visualTipEnd: Math.max(tip.length, tip.inset ?? 0),
      visualBackEnd: Math.min(0, -(tip.inset ?? 0)),
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "triangle" || tip.kind === "triangle-cap") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: 0.1 * tip.length,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "square" || tip.kind === "circle" || tip.kind === "round-cap" || tip.kind === "butt-cap") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: 0,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "rays") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: 0.5 * tip.length,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "implies") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: 0.1 * tip.length,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  let metrics: ArrowTipMetrics = {
    tipEnd: tip.length,
    backEnd: 0,
    lineEnd: 0.15 * tip.length,
    visualTipEnd: tip.length,
    visualBackEnd: 0,
    sep: tip.sep
  };
  if (tip.reversed) {
    metrics = reverseMetrics(metrics);
  }
  return metrics;
}

export function computeLatexShapeParameters(tip: NormalizedArrowTip): LatexShapeParameters {
  const length = Math.max(0.01, tip.length);
  const width = Math.max(0.01, tip.width);
  const lineWidth = Math.min(Math.max(0, tip.lineWidth), 0.2 * length);
  const slope = length / Math.max(EPSILON, width);
  const frontMiter = Math.sqrt(1 + 9 * slope * slope) * lineWidth;
  const innerLength = Math.max(0.01, length - 0.5 * frontMiter - 0.5 * lineWidth);
  const halfBackWidth = Math.max(0.01, width / 2);
  return {
    length,
    width,
    lineWidth,
    frontMiter,
    innerLength,
    halfBackWidth
  };
}

export function computeStealthShapeParameters(tip: NormalizedArrowTip): StealthShapeParameters {
  const length = Math.max(0.01, tip.length);
  const width = Math.max(0.01, tip.width);
  const inset = Math.max(0, tip.inset ?? length * DEFAULT_STEALTH_INSET_FACTOR);
  const maxLineWidth = 0.25 * Math.max(0.01, length - inset);
  const lineWidth = Math.min(Math.max(0, tip.lineWidth), maxLineWidth);

  const frontSlope = length / Math.max(EPSILON, width);
  const frontMiter = 0.5 * Math.sqrt(1 + 4 * frontSlope * frontSlope) * lineWidth;

  const halfWidth = 0.5 * width;
  const angleTip = Math.atan2(length, Math.max(EPSILON, halfWidth));
  const angleInset = Math.atan2(inset, Math.max(EPSILON, halfWidth));
  const halfDelta = 0.5 * (angleTip - angleInset);
  const reciprocalTan = Math.abs(Math.tan(halfDelta)) <= EPSILON ? 0 : 1 / Math.tan(halfDelta);
  const backMiterLength = 0.5 * reciprocalTan * lineWidth;
  const bisector = angleInset + halfDelta;
  let backMiter = Math.sin(bisector) * backMiterLength;
  const topMiter = Math.cos(bisector) * backMiterLength;
  if (Math.abs(inset) <= EPSILON) {
    backMiter = 0.5 * lineWidth;
  }

  const insetSlope = inset / Math.max(EPSILON, width);
  const insetMiter = 0.5 * Math.sqrt(1 + 4 * insetSlope * insetSlope) * lineWidth;
  const innerLength = Math.max(0.01, length - frontMiter - backMiter);
  const innerHalfWidth = Math.max(0.01, halfWidth - topMiter);

  return {
    length,
    width,
    lineWidth,
    inset,
    frontMiter,
    backMiter,
    topMiter,
    insetMiter,
    innerLength,
    innerHalfWidth
  };
}

function reverseMetrics(metrics: ArrowTipMetrics): ArrowTipMetrics {
  return {
    tipEnd: -metrics.backEnd,
    backEnd: -metrics.tipEnd,
    lineEnd: -metrics.lineEnd,
    visualTipEnd: -metrics.visualBackEnd,
    visualBackEnd: -metrics.visualTipEnd,
    sep: metrics.sep
  };
}

function normalizeLineWidth(lineWidth: number | null | undefined, fallback: number): number {
  const resolvedFallback = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_CONTEXT_LINE_WIDTH;
  if (!Number.isFinite(lineWidth) || lineWidth == null || lineWidth <= 0) {
    return resolvedFallback;
  }
  return lineWidth;
}
