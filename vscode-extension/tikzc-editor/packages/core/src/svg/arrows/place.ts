import { worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ArrowLocalPoint, WorldPoint } from "../../coords/points.js";
import type { ScenePathCommand } from "../../semantic/types.js";
import { addPoint, scaleVector } from "../../geometry/path-sampler.js";
import type { Frame } from "./types.js";
import type { ArrowLocalPathCommand } from "./types.js";

export function placeLocalPathsRigid(localPaths: ArrowLocalPathCommand[][], frame: Frame, offset: number): ScenePathCommand[][] {
  return localPaths.map((path) =>
    transformLocalPath(path, (point) => {
      const x = offset + point.x;
      const tangentOffset = scaleVector(frame.tangent, x);
      const normalOffset = scaleVector(frame.normal, point.y);
      return addPoint(frame.point, worldVector(pt(tangentOffset.x + normalOffset.x), pt(tangentOffset.y + normalOffset.y)));
    })
  );
}

export function placeLocalPathsBent(localPaths: ArrowLocalPathCommand[][], offset: number, frameAtOffset: (x: number) => Frame): ScenePathCommand[][] {
  return localPaths.map((path) =>
    transformLocalPath(path, (point) => {
      const x = offset + point.x;
      const frame = frameAtOffset(x);
      return addPoint(frame.point, scaleVector(frame.normal, point.y));
    })
  );
}

function transformLocalPath(path: ArrowLocalPathCommand[], mapPoint: (point: ArrowLocalPoint) => WorldPoint): ScenePathCommand[] {
  return path.map((command) => {
    if (command.kind === "Z") {
      return { kind: "Z" };
    }
    if (command.kind === "M" || command.kind === "L") {
      return { kind: command.kind, to: mapPoint(command.to) };
    }
    if (command.kind === "C") {
      return {
        kind: "C",
        c1: mapPoint(command.c1),
        c2: mapPoint(command.c2),
        to: mapPoint(command.to)
      };
    }
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: mapPoint(command.to)
    };
  });
}
