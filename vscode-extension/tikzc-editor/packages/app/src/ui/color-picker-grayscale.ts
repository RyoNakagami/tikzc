const BLACK_PERCENT_BY_GRAY_ALIAS = new Map<string, number>([
  ["darkgray", 75],
  ["gray", 50],
  ["lightgray", 25]
]);

const GRAY_ALIAS_BY_BLACK_PERCENT = new Map<number, string>([
  [75, "darkgray"],
  [50, "gray"],
  [25, "lightgray"]
]);

export function expandGrayAliasToBlackMix(driverValue: string | null): string | null {
  if (driverValue == null) {
    return null;
  }
  const blackPercent = BLACK_PERCENT_BY_GRAY_ALIAS.get(driverValue);
  if (blackPercent == null) {
    return driverValue;
  }
  return `black!${blackPercent}`;
}

export function serializeBlackMixToGrayAlias(blackPercent: number): string {
  const roundedPercent = Math.round(blackPercent);
  return GRAY_ALIAS_BY_BLACK_PERCENT.get(roundedPercent) ?? `black!${roundedPercent}`;
}
