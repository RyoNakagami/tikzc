import type { Tree } from "@lezer/common";
import { useEffect, useMemo, useState } from "react";
import { parseTikz } from "tikz-editor/parser/index";
import { BASIC_PICKER_COLOR_SET } from "./color-palette";
import { resolveDeclaredColorAnalysis } from "./source-color-detection";
import { useEditorStore } from "../store/store";

export type NamedColorSwatch = {
  token: string;
  cssColor: string;
};

let lastDeclaredColorSignature = "__project-named-colors:uninitialized__";
let lastSwatches: NamedColorSwatch[] = [];

export function collectProjectNamedColorSwatches(
  declaredColors: ReadonlyMap<string, string>
): NamedColorSwatch[] {
  const swatches: NamedColorSwatch[] = [];
  const seen = new Set<string>();

  for (const [token, cssColor] of declaredColors.entries()) {
    const normalizedToken = token.trim().toLowerCase();
    if (
      normalizedToken.length === 0 ||
      seen.has(normalizedToken) ||
      BASIC_PICKER_COLOR_SET.has(normalizedToken)
    ) {
      continue;
    }
    seen.add(normalizedToken);
    swatches.push({
      token: normalizedToken,
      cssColor
    });
  }

  return swatches;
}

export function resolveProjectNamedColorSwatches(
  source: string,
  tree: Tree
): NamedColorSwatch[] {
  const analysis = resolveDeclaredColorAnalysis(source, tree);
  if (analysis.signature === lastDeclaredColorSignature) {
    return lastSwatches;
  }
  lastDeclaredColorSignature = analysis.signature;
  lastSwatches = collectProjectNamedColorSwatches(analysis.colors);
  return lastSwatches;
}

export function useProjectNamedColorSwatches(): NamedColorSwatch[] {
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const source = useEditorStore((s) => s.source);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  // Snapshots that crossed the compute-worker boundary carry no Lezer tree
  // (not structured-clone safe); re-parse lazily below in that case.
  const parseTree = useEditorStore((s) => s.snapshot?.parseResult?.tree ?? null);
  const shouldFreeze =
    activeSourceScrubSourceId != null ||
    activeCanvasDragKind === "element" ||
    activeCanvasDragKind === "resize" ||
    activeCanvasDragKind === "rotate" ||
    activeCanvasDragKind === "handle";
  const [stable, setStable] = useState({ source, parseTree, activeFigureId });

  useEffect(() => {
    if (!shouldFreeze) {
      setStable({ source, parseTree, activeFigureId });
    }
  }, [shouldFreeze, source, parseTree, activeFigureId]);

  return useMemo(() => {
    if (stable.source.trim().length === 0) {
      return [];
    }
    const tree =
      stable.parseTree ??
      parseTikz(stable.source, { recover: true, activeFigureId: stable.activeFigureId }).tree;
    return resolveProjectNamedColorSwatches(stable.source, tree);
  }, [stable.source, stable.parseTree, stable.activeFigureId]);
}
