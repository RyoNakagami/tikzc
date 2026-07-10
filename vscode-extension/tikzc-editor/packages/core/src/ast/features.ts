export const FeatureFlags = {
  version: "v1",
  tikzPictureEnvironment: true,
  pathStatements: true,
  scopeStatements: true,
  foreachStatements: true,
  nodeText: true,
  coordinateEditing: true,
  structuredOptions: true,
  semanticIr: true,
  svgRendering: true,
  opaqueUnknownCommands: true,
  strongRecovery: true
} as const;

export type FeatureFlagName = Exclude<keyof typeof FeatureFlags, "version">;
