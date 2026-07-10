import type { SourcePatch } from "./types.js";

type PatchValidationFailure =
  | "invalid-span-order"
  | "out-of-bounds"
  | "overlapping";

export type ApplySourcePatchesResult =
  | { kind: "success"; source: string }
  | { kind: "invalid"; reason: PatchValidationFailure };

/**
 * Applies source patches whose old spans are interpreted against the same
 * original source document.
 */
export function applySourcePatches(source: string, patches: readonly SourcePatch[]): ApplySourcePatchesResult {
  if (patches.length === 0) {
    return { kind: "success", source };
  }

  const sorted = [...patches].sort((left, right) => {
    if (left.oldSpan.from !== right.oldSpan.from) {
      return left.oldSpan.from - right.oldSpan.from;
    }
    return left.oldSpan.to - right.oldSpan.to;
  });

  let cursor = 0;
  let output = "";
  for (const patch of sorted) {
    const from = patch.oldSpan.from;
    const to = patch.oldSpan.to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
      return { kind: "invalid", reason: "invalid-span-order" };
    }
    if (from < 0 || to > source.length) {
      return { kind: "invalid", reason: "out-of-bounds" };
    }
    if (from < cursor) {
      return { kind: "invalid", reason: "overlapping" };
    }
    output += source.slice(cursor, from);
    output += patch.replacement;
    cursor = to;
  }
  output += source.slice(cursor);
  return { kind: "success", source: output };
}

/**
 * Validates that a patch list represents the transition `previous -> next`
 * when all old spans are interpreted against `previous`.
 */
export function patchesMatchSourceTransition(
  previous: string,
  next: string,
  patches: readonly SourcePatch[]
): boolean {
  const applied = applySourcePatches(previous, patches);
  return applied.kind === "success" && applied.source === next;
}
