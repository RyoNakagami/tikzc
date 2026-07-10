import type { CanvasDragKind } from "../store/types";

export function dragKindToComputeTrigger(
  dragKind: CanvasDragKind | null
): "drag-element" | "drag-handle" | "other" {
  if (dragKind === "element" || dragKind === "resize" || dragKind === "rotate") {
    return "drag-element";
  }
  if (dragKind === "handle") {
    return "drag-handle";
  }
  return "other";
}

export function computeTrigger(
  dragKind: CanvasDragKind | null,
  sourceScrubSourceId: string | null
): "drag-element" | "drag-handle" | "other" {
  const dragTrigger = dragKindToComputeTrigger(dragKind);
  if (dragTrigger !== "other") {
    return dragTrigger;
  }
  if (sourceScrubSourceId) {
    return "drag-element";
  }
  return "other";
}
