import type { OptionListAst } from "../../options/types.js";
import { parseLength } from "../coords/parse-length.js";

export function extractCircleRadius(options: OptionListAst | undefined): number | null {
  if (!options) {
    return null;
  }

  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === "radius") {
      const radius = parseLength(entry.valueRaw, "cm");
      if (radius != null) {
        return radius;
      }
    }
  }

  return null;
}
