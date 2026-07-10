import type { FeatureId } from "./feature-ids.js";

export type LayerStatus = "not-applicable" | "none" | "partial" | "stable";

export type CapabilityRow = {
  parser: LayerStatus;
  semantic: LayerStatus;
  svg: LayerStatus;
  edit: LayerStatus;
  fixtures: string[];
  notes?: string;
};

export type CapabilityMatrix = Record<FeatureId, CapabilityRow>;
