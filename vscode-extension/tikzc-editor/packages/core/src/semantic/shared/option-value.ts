import { isWrappedBySingleBracePair, stripWrappingBraces } from "../../utils/braces.js";

export function normalizeOptionValue(raw: string): string {
  return stripWrappingBraces(raw);
}

export { isWrappedBySingleBracePair };
