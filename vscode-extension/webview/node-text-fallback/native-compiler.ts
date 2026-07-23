/*
 * native-compiler.ts — client-side state machine of the native text
 * fallback: caches natively compiled node-text fragments, queues compile
 * requests during measure(), and resolves them in flushPending() so the
 * editor's existing "flush -> recompute -> cache hit" cycle picks them up
 * (same contract as the MathJax engine's async render queue).
 *
 * DOM-independent and compiler-injected, so the whole machine is unit
 * testable without a webview or TeX toolchain.
 */

import type {
  NativeSnippetCompiler,
  NativeSnippetRequest,
  NativeSnippetResult,
} from "./types";
import { toSnippetRenderPayload, type SnippetRenderPayload } from "./svg-postprocess";

/** subset of the editor's NodeTextMeasureRequest we consume */
export type NativeMeasureRequest = {
  text: string;
  mode?: "text" | "math";
  textWidthPt: number | null;
  alignment?: "ragged-right" | "ragged-left" | "center" | "justified";
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
  fontSizePt: number;
};

/** shape of the editor's NodeTextMetrics */
export type NativeMetrics = {
  cacheKey: string;
  width: number;
  height: number;
  baselineY: number;
  midLineY: number;
  paragraphId: null;
  renderSourceText: string;
};

type Entry =
  | { status: "pending" }
  | {
      status: "done";
      payload: SnippetRenderPayload;
      baseWidthPt: number;
      baseHeightPt: number;
      baseLineYPt: number;
      midLineYPt: number;
      renderSourceText: string;
    }
  | { status: "failed"; message: string; errorKind: "latex" | "transient"; at: number };

const ENTRY_LIMIT = 256;
const TRANSIENT_RETRY_MS = 30 * 1000;

function setCapped<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/** the `#|` header lines at the top of a .tikz source (mirrors parseSource) */
export function extractTikzHeader(source: string): string {
  const lines: string[] = [];
  for (const line of source.split("\n")) {
    if (/^\s*#\|\s*[\w-]+\s*:/.test(line)) lines.push(line);
    else break;
  }
  return lines.join("\n");
}

export class NativeTextCompiler {
  private compiler: NativeSnippetCompiler | null = null;
  private header = "";
  private readonly entries = new Map<string, Entry>();
  /** last native failure message per raw text (for validate diagnostics) */
  private readonly failureByText = new Map<string, string>();
  private readonly queued = new Map<string, NativeSnippetRequest>();
  private readonly requestedThisPass = new Set<string>();
  private flushChain: Promise<readonly string[]> = Promise.resolve([]);

  constructor(private readonly options: { baseFontSizePt: number; midlineRatio: number }) {}

  setCompiler(compiler: NativeSnippetCompiler): void {
    this.compiler = compiler;
  }

  setHeaderFromSource(source: string): void {
    this.header = extractTikzHeader(source);
  }

  /**
   * Look up (or queue) a native render for node text MathJax cannot handle.
   * Returns metrics scaled to the requested font size, or null while the
   * compile is pending/failed (the caller then falls back to plain text
   * until flushPending() reports the key).
   */
  measure(request: NativeMeasureRequest): NativeMetrics | null {
    if (!this.compiler) return null;
    const scale = request.fontSizePt / this.options.baseFontSizePt;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const mode = request.mode ?? "text";
    const widthBp =
      request.textWidthPt == null ? null : Math.round((request.textWidthPt / scale) * 1000) / 1000;
    const alignment = request.textWidthPt == null ? null : (request.alignment ?? null);
    const key =
      "native:" +
      JSON.stringify({
        text: request.text,
        mode,
        widthBp,
        alignment,
        fontStyle: request.fontStyle,
        fontWeight: request.fontWeight,
        fontFamily: request.fontFamily,
        header: this.header,
      });
    this.requestedThisPass.add(key);

    const entry = this.entries.get(key);
    if (entry?.status === "done") {
      return {
        cacheKey: key,
        width: entry.baseWidthPt * scale,
        height: entry.baseHeightPt * scale,
        baselineY: entry.baseLineYPt * scale,
        midLineY: entry.midLineYPt * scale,
        paragraphId: null,
        renderSourceText: entry.renderSourceText,
      };
    }
    if (entry?.status === "pending") return null;
    if (entry?.status === "failed") {
      const retryable =
        entry.errorKind === "transient" && Date.now() - entry.at > TRANSIENT_RETRY_MS;
      if (!retryable) return null;
      this.entries.delete(key);
    }

    setCapped(this.entries, key, { status: "pending" }, ENTRY_LIMIT);
    this.queued.set(key, {
      id: key,
      text: request.text,
      mode,
      widthBp,
      alignment,
      fontStyle: request.fontStyle,
      fontWeight: request.fontWeight,
      fontFamily: request.fontFamily,
      header: this.header,
    });
    return null;
  }

  renderFromCache(cacheKey: string): { cacheKey: string; viewBox: SnippetRenderPayload["viewBox"]; body: string } | null {
    const entry = this.entries.get(cacheKey);
    if (entry?.status !== "done") return null;
    return { cacheKey, ...entry.payload };
  }

  /** latest native failure message for this node text, if any */
  failureMessageFor(text: string): string | null {
    return this.failureByText.get(text) ?? null;
  }

  /**
   * Compile everything queued during this pass and return the cache keys
   * that became renderable. Queued items no longer requested (stale
   * mid-typing states) are dropped before compiling. Serialized so
   * concurrent flushes from multiple engine consumers cannot interleave.
   */
  flushPending(): Promise<readonly string[]> {
    const run = async (): Promise<readonly string[]> => {
      for (const key of [...this.queued.keys()]) {
        if (!this.requestedThisPass.has(key)) {
          this.queued.delete(key);
          this.entries.delete(key);
        }
      }
      this.requestedThisPass.clear();
      if (this.queued.size === 0 || !this.compiler) return [];

      const batch = [...this.queued.values()];
      this.queued.clear();
      let results: NativeSnippetResult[];
      try {
        results = await this.compiler(batch);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        for (const request of batch) {
          setCapped(
            this.entries,
            request.id,
            { status: "failed", message, errorKind: "transient", at: Date.now() },
            ENTRY_LIMIT
          );
        }
        return [];
      }

      const finalized: string[] = [];
      const byId = new Map(results.map((r) => [r.id, r]));
      for (const request of batch) {
        const result = byId.get(request.id);
        if (!result || result.status === "error") {
          const message = result?.message ?? "no result returned for snippet";
          const errorKind = result?.status === "error" ? result.errorKind : "transient";
          setCapped(
            this.entries,
            request.id,
            { status: "failed", message, errorKind, at: Date.now() },
            ENTRY_LIMIT
          );
          setCapped(this.failureByText, request.text, message, ENTRY_LIMIT);
          continue;
        }
        const payload = toSnippetRenderPayload(request.id, result.svg);
        if (!payload) {
          setCapped(
            this.entries,
            request.id,
            {
              status: "failed",
              message: "snippet SVG could not be parsed",
              errorKind: "latex",
              at: Date.now(),
            },
            ENTRY_LIMIT
          );
          continue;
        }
        const baseLineYPt = -((result.htBp - result.dpBp) / 2);
        setCapped(
          this.entries,
          request.id,
          {
            status: "done",
            payload,
            baseWidthPt: result.wdBp,
            baseHeightPt: result.htBp + result.dpBp,
            baseLineYPt,
            midLineYPt: baseLineYPt + this.options.baseFontSizePt * this.options.midlineRatio,
            renderSourceText: request.text,
          },
          ENTRY_LIMIT
        );
        this.failureByText.delete(request.text);
        finalized.push(request.id);
      }
      return finalized;
    };

    const next = this.flushChain.then(run, run);
    this.flushChain = next.then(
      () => [],
      () => []
    );
    return next;
  }
}
