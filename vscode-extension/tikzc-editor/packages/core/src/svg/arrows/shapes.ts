import { arrowLocalPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ArrowLocalPoint } from "../../coords/points.js";
import { computeLatexShapeParameters, computeStealthShapeParameters } from "./metrics.js";
import type { ArrowLocalPathCommand, ArrowTipMetrics, NormalizedArrowTip } from "./types.js";

function alPoint(x: number, y: number): ArrowLocalPoint {
  return arrowLocalPoint(pt(x), pt(y));
}

export function buildLocalTipPaths(tip: NormalizedArrowTip, metrics: ArrowTipMetrics): ArrowLocalPathCommand[][] {
  const rawPaths = buildRawTipPaths(tip);
  const mirrored = tip.reversed ? rawPaths.map((path) => transformPath(path, (x, y) => alPoint(-x, y))) : rawPaths;
  const lineEndShift = -metrics.lineEnd;
  return mirrored.map((path) => transformPath(path, (x, y) => alPoint(x + lineEndShift, y)));
}

function buildRawTipPaths(tip: NormalizedArrowTip): ArrowLocalPathCommand[][] {
  const halfWidth = tip.width / 2;

  if (tip.kind === "cm-rightarrow") {
    const c1x = tip.length * 0.18269;
    const c2x = tip.length * 0.58981;
    const c1y = halfWidth * 0.4;
    const c2y = halfWidth * 0.116666;
    return [
      [
        moveTo(0, halfWidth),
        cubicTo(c1x, c1y, c2x, c2y, tip.length, 0),
        cubicTo(c2x, -c2y, c1x, -c1y, 0, -halfWidth)
      ]
    ];
  }

  if (tip.kind === "bar") {
    return [[moveTo(0, -halfWidth), lineTo(0, halfWidth)]];
  }

  if (tip.kind === "hooks") {
    const arcFactor = Math.max(0.25, Math.min(2, (tip.arc ?? 180) / 180));
    const controlX = tip.length * 0.45 * arcFactor;
    const upper = quadraticAsCubic(moveTo(tip.length, 0), controlX, halfWidth, 0, halfWidth);
    const lower = quadraticAsCubic(moveTo(tip.length, 0), controlX, -halfWidth, 0, -halfWidth);
    return [upper, lower];
  }

  if (tip.kind === "straight-barb") {
    return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth)]];
  }

  if (tip.kind === "arc-barb") {
    const arcFactor = Math.max(0.25, Math.min(2, (tip.arc ?? 180) / 180));
    const controlX = tip.length * (0.3 + 0.35 * arcFactor);
    return [[moveTo(0, halfWidth), cubicTo(controlX, halfWidth, controlX, -halfWidth, 0, -halfWidth)]];
  }

  if (tip.kind === "tee-barb") {
    const inset = Math.max(0, Math.min(tip.length, tip.inset ?? tip.length * 0.5));
    const backX = -inset;
    return [
      [moveTo(0, -halfWidth), lineTo(0, halfWidth)],
      [moveTo(backX, halfWidth), lineTo(tip.length, halfWidth)],
      [moveTo(backX, -halfWidth), lineTo(tip.length, -halfWidth)]
    ];
  }

  if (tip.kind === "implies") {
    const midX = tip.length * 0.62;
    const innerTailX = tip.length * 0.35;
    const innerMidX = tip.length * 0.727;
    const innerPointX = tip.length * 0.97;
    return [
      [moveTo(0, halfWidth), lineTo(midX, halfWidth), lineTo(tip.length, 0), lineTo(midX, -halfWidth), lineTo(0, -halfWidth), close()],
      [
        moveTo(innerTailX, halfWidth * 0.7),
        lineTo(innerMidX, halfWidth * 0.7),
        lineTo(innerPointX, 0),
        lineTo(innerMidX, -halfWidth * 0.7),
        lineTo(innerTailX, -halfWidth * 0.7),
        close()
      ]
    ];
  }

  if (tip.kind === "stealth") {
    const params = computeStealthShapeParameters(tip);
    const tipX = params.innerLength + params.backMiter;
    const topX = params.backMiter;
    const insetX = params.inset + params.insetMiter;
    const innerHalfWidth = params.innerHalfWidth;
    return [[moveTo(tipX, 0), lineTo(topX, innerHalfWidth), lineTo(insetX, 0), lineTo(topX, -innerHalfWidth), close()]];
  }

  if (tip.kind === "latex") {
    const params = computeLatexShapeParameters(tip);
    const innerLength = params.innerLength;
    const halfBackWidth = params.halfBackWidth;
    return [
      [
        moveTo(innerLength, 0),
        cubicTo(0.877192 * innerLength, 0.077922 * halfBackWidth, 0.337381 * innerLength, 0.51948 * halfBackWidth, 0, halfBackWidth),
        lineTo(0, -halfBackWidth),
        cubicTo(0.337381 * innerLength, -0.51948 * halfBackWidth, 0.877192 * innerLength, -0.077922 * halfBackWidth, innerLength, 0),
        close()
      ]
    ];
  }

  if (tip.kind === "triangle") {
    return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), close()]];
  }

  if (tip.kind === "triangle-cap") {
    return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), close()]];
  }

  if (tip.kind === "kite") {
    const inset = Math.max(0, Math.min(tip.length - 1e-3, tip.inset ?? tip.length * 0.25));
    return [[moveTo(tip.length, 0), lineTo(inset, halfWidth), lineTo(0, 0), lineTo(inset, -halfWidth), close()]];
  }

  if (tip.kind === "square" || tip.kind === "butt-cap") {
    return [[moveTo(0, halfWidth), lineTo(tip.length, halfWidth), lineTo(tip.length, -halfWidth), lineTo(0, -halfWidth), close()]];
  }

  if (tip.kind === "circle" || tip.kind === "round-cap") {
    const rx = Math.max(0.01, tip.length / 2);
    const cx = rx;
    return [
      [
        moveTo(cx + rx, 0),
        arcTo(rx, halfWidth, 0, false, true, cx - rx, 0),
        arcTo(rx, halfWidth, 0, false, true, cx + rx, 0),
        close()
      ]
    ];
  }

  if (tip.kind === "rays") {
    const rayCount = Math.max(1, Math.round(tip.rayCount ?? 4));
    const rays: ArrowLocalPathCommand[][] = [];
    for (let i = 0; i < rayCount; i += 1) {
      const angle = -Math.PI / 2 + ((i + 0.5) * Math.PI) / rayCount;
      const x = tip.length * Math.cos(angle);
      const y = halfWidth * Math.sin(angle);
      rays.push([moveTo(0, 0), lineTo(x, y)]);
    }
    return rays;
  }

  const notchX = tip.length * 0.24;
  return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), lineTo(notchX, 0), close()]];
}

function transformPath(path: ArrowLocalPathCommand[], map: (x: number, y: number) => ArrowLocalPoint): ArrowLocalPathCommand[] {
  return path.map((command) => {
    if (command.kind === "Z") {
      return { kind: "Z" };
    }
    if (command.kind === "M" || command.kind === "L") {
      const point = map(command.to.x, command.to.y);
      return { kind: command.kind, to: point };
    }
    if (command.kind === "C") {
      const c1 = map(command.c1.x, command.c1.y);
      const c2 = map(command.c2.x, command.c2.y);
      const to = map(command.to.x, command.to.y);
      return { kind: "C", c1, c2, to };
    }
    const to = map(command.to.x, command.to.y);
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to
    };
  });
}

function quadraticAsCubic(start: ArrowLocalPathCommand, cx: number, cy: number, x: number, y: number): ArrowLocalPathCommand[] {
  if (start.kind !== "M") {
    return [start];
  }
  const p0 = start.to;
  const c1 = arrowLocalPoint(
    pt(p0.x + (2 / 3) * (cx - p0.x)),
    pt(p0.y + (2 / 3) * (cy - p0.y))
  );
  const c2 = arrowLocalPoint(
    pt(x + (2 / 3) * (cx - x)),
    pt(y + (2 / 3) * (cy - y))
  );
  return [start, { kind: "C", c1, c2, to: arrowLocalPoint(pt(x), pt(y)) }];
}

function moveTo(x: number, y: number): ArrowLocalPathCommand {
  return { kind: "M", to: arrowLocalPoint(pt(x), pt(y)) };
}

function lineTo(x: number, y: number): ArrowLocalPathCommand {
  return { kind: "L", to: arrowLocalPoint(pt(x), pt(y)) };
}

function cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): ArrowLocalPathCommand {
  return {
    kind: "C",
    c1: arrowLocalPoint(pt(c1x), pt(c1y)),
    c2: arrowLocalPoint(pt(c2x), pt(c2y)),
    to: arrowLocalPoint(pt(x), pt(y))
  };
}

function arcTo(
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number
): ArrowLocalPathCommand {
  return {
    kind: "A",
    rx,
    ry,
    xAxisRotation,
    largeArc,
    sweep,
    to: arrowLocalPoint(pt(x), pt(y))
  };
}

function close(): ArrowLocalPathCommand {
  return { kind: "Z" };
}
