import type { ScenePathCommand } from "../../semantic/types.js";
import {
  commandFromSegment,
  commandsToSegments,
  hasDrawablePathCommands,
  samplePointFromStartExtrapolated,
  sliceSegment
} from "../../geometry/path-sampler.js";

const EPSILON = 1e-6;

export type ShortenSubpathResult = {
  commands: ScenePathCommand[];
  appliedStartShortening: number;
  appliedEndShortening: number;
  originalLength: number;
};

export function shortenOpenSubpath(
  subpath: ScenePathCommand[],
  requestedStartShortening: number,
  requestedEndShortening: number
): ShortenSubpathResult {
  const commands = subpath.map((command) => cloneCommand(command));
  if (commands.length < 2 || !hasDrawablePathCommands(commands)) {
    return {
      commands,
      appliedStartShortening: 0,
      appliedEndShortening: 0,
      originalLength: 0
    };
  }

  const segments = commandsToSegments(commands);
  const originalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (segments.length === 0 || originalLength <= EPSILON) {
    return {
      commands,
      appliedStartShortening: 0,
      appliedEndShortening: 0,
      originalLength
    };
  }

  const requestedStart = Math.max(0, requestedStartShortening);
  const requestedEnd = Math.max(0, requestedEndShortening);
  const appliedStart = Math.min(requestedStart, originalLength);
  const appliedEnd = Math.min(requestedEnd, Math.max(0, originalLength - appliedStart));
  const keepFrom = appliedStart;
  const keepTo = Math.max(keepFrom, originalLength - appliedEnd);

  if (keepTo - keepFrom <= EPSILON) {
    const anchor = samplePointFromStartExtrapolated(segments, keepFrom) ?? segments[0].from;
    return {
      commands: [{ kind: "M", to: anchor }],
      appliedStartShortening: appliedStart,
      appliedEndShortening: appliedEnd,
      originalLength
    };
  }

  const keptSegments = [];
  let traveled = 0;
  for (const segment of segments) {
    if (traveled >= keepTo) {
      break;
    }
    const segmentStart = traveled;
    const segmentEnd = traveled + segment.length;
    const localStart = Math.max(0, keepFrom - segmentStart);
    const localEnd = Math.min(segment.length, keepTo - segmentStart);
    if (localEnd - localStart > EPSILON) {
      const sliced = sliceSegment(segment, localStart, localEnd);
      if (sliced) {
        keptSegments.push(sliced);
      }
    }
    traveled = segmentEnd;
  }

  if (keptSegments.length === 0) {
    const anchor = samplePointFromStartExtrapolated(segments, keepFrom) ?? segments[0].from;
    return {
      commands: [{ kind: "M", to: anchor }],
      appliedStartShortening: appliedStart,
      appliedEndShortening: appliedEnd,
      originalLength
    };
  }

  const head = keptSegments[0];
  const resultCommands: ScenePathCommand[] = [];
  resultCommands.push({ kind: "M", to: { ...head.from } });
  for (const segment of keptSegments) {
    resultCommands.push(commandFromSegment(segment));
  }

  return {
    commands: resultCommands,
    appliedStartShortening: appliedStart,
    appliedEndShortening: appliedEnd,
    originalLength
  };
}

function cloneCommand(command: ScenePathCommand): ScenePathCommand {
  if (command.kind === "M" || command.kind === "L") {
    return { kind: command.kind, to: { ...command.to } };
  }
  if (command.kind === "C") {
    return { kind: "C", c1: { ...command.c1 }, c2: { ...command.c2 }, to: { ...command.to } };
  }
  if (command.kind === "A") {
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: { ...command.to }
    };
  }
  return { kind: "Z" };
}
