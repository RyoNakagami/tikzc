export type ParseBooleanishOptions = {
  allowOnOff?: boolean;
  allowNoneAsFalse?: boolean;
  empty?: boolean | null;
};

export function parseBooleanishNormalized(input: string, options: ParseBooleanishOptions = {}): boolean | null {
  const allowOnOff = options.allowOnOff ?? false;
  const allowNoneAsFalse = options.allowNoneAsFalse ?? false;
  const empty = options.empty ?? null;
  const normalized = input.trim().toLowerCase();

  if (normalized.length === 0) {
    return empty;
  }

  if (normalized === "true" || normalized === "yes" || normalized === "1" || (allowOnOff && normalized === "on")) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "no" ||
    normalized === "0" ||
    (allowOnOff && normalized === "off") ||
    (allowNoneAsFalse && normalized === "none")
  ) {
    return false;
  }

  return null;
}
