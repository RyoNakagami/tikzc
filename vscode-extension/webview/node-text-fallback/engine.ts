/*
 * engine.ts — drop-in replacement for the "tikz-editor/text/mathjax-engine"
 * module (wired via a resolve.alias entry in vite.config.ts that outranks
 * the generic tikz-editor alias).
 *
 * Everything is re-exported from the real vendored engine unchanged except
 * createMathJaxNodeTextEngine, which returns a wrapper: node text the
 * MathJax engine cannot render (e.g. \faGlobe with `#| packages:
 * [fontawesome]`) falls back to a native lualatex compile on the extension
 * host, so the canvas shows the same glyphs tikzc produces.
 *
 * NOTE: this file's path must NOT contain the substring "text/mathjax-engine"
 * — vite.config.ts's localMathJaxPlugin transforms (and asserts on) any
 * module whose id matches it.
 */

import {
  createMathJaxNodeTextEngine as createRealEngine,
  getActiveMathJaxOutputJax,
  setWorkerFontLoader,
  type MathJaxFont,
} from "../../tikzc-editor/packages/core/src/text/mathjax-engine";
import { DEFAULT_TEXT_FONT_SIZE } from "../../tikzc-editor/packages/core/src/semantic/style/resolve.js";
import type {
  NodeTextEngine,
  NodeTextMeasureRequest,
  NodeTextMetrics,
  NodeTextRenderPayload,
  NodeTextValidationIssue,
} from "../../tikzc-editor/packages/core/src/text/types.js";
import { NativeTextCompiler } from "./native-compiler";
import { escapeAngleBracketsInAttributeValues } from "./mathjax-xml-safe";
import type { NativeSnippetCompiler } from "./types";

export { getActiveMathJaxOutputJax, setWorkerFontLoader };
export type { MathJaxFont };

/** MIDLINE_FROM_BASELINE_RATIO — private to the vendored engine, mirrored here */
const MIDLINE_FROM_BASELINE_RATIO = 0.215;

// one shared native cache across every engine consumer (compute pipeline and
// canvas panel both call createMathJaxNodeTextEngine)
const nativeCompiler = new NativeTextCompiler({
  baseFontSizePt: DEFAULT_TEXT_FONT_SIZE,
  midlineRatio: MIDLINE_FROM_BASELINE_RATIO,
});

/** Inject the RPC bridge; without it the fallback stays inert (plain text). */
export function setNativeSnippetCompiler(compiler: NativeSnippetCompiler): void {
  nativeCompiler.setCompiler(compiler);
}

/** Keep the `#|` header the fallback preamble uses in sync with the document. */
export function setNativeSnippetHeaderSource(source: string): void {
  nativeCompiler.setHeaderFromSource(source);
}

// MathJax serializes fragments in HTML mode, leaving raw `<`/`>` in attribute
// values (e.g. data-latex="$d_i<\lambda$") — fine on the live canvas, fatal
// for every export path that re-parses the document as strict XML. Escape at
// the payload boundary; cache per payload object (payloads are engine-cached).
const xmlSafePayloadCache = new WeakMap<NodeTextRenderPayload, NodeTextRenderPayload>();

function toXmlSafePayload(payload: NodeTextRenderPayload): NodeTextRenderPayload {
  let safe = xmlSafePayloadCache.get(payload);
  if (!safe) {
    const body = escapeAngleBracketsInAttributeValues(payload.body);
    safe = body === payload.body ? payload : { ...payload, body };
    xmlSafePayloadCache.set(payload, safe);
  }
  return safe;
}

/** mirror of the vendored engine's private isMathJaxAsyncRetryError() */
function isMathJaxAsyncRetryError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("mathjax retry") ||
    (message.includes("asynchronous action is required") && message.includes("promise-based"))
  );
}

export async function createMathJaxNodeTextEngine(options?: {
  font?: MathJaxFont;
}): Promise<NodeTextEngine> {
  const inner = await createRealEngine(options);

  return {
    validate(text: string): NodeTextValidationIssue | null {
      const issue = inner.validate(text);
      if (!issue) return null;
      // MathJax can't parse it, but the native fallback might still render
      // it: only surface a diagnostic once the native compile failed too.
      const nativeMessage = nativeCompiler.failureMessageFor(text);
      if (nativeMessage) {
        return { code: "invalid-node-tex", message: nativeMessage };
      }
      return null;
    },

    measure(request: NodeTextMeasureRequest): NodeTextMetrics | null {
      try {
        const measured = inner.measure(request);
        if (measured) return measured;
      } catch (error) {
        // let the MathJax async retry machinery work exactly as before
        if (isMathJaxAsyncRetryError(error)) throw error;
        // any other error falls through to the native path
      }
      // measure() returns null both for "async render pending" and for
      // "permanently invalid TeX"; validate() (cached) disambiguates.
      const issue = inner.validate(request.text);
      if (issue == null) return null; // pending — MathJax will finish it
      return nativeCompiler.measure(request);
    },

    renderFromCache(cacheKey: string): NodeTextRenderPayload | null {
      if (cacheKey.startsWith("native:")) {
        return nativeCompiler.renderFromCache(cacheKey);
      }
      const payload = inner.renderFromCache(cacheKey);
      return payload ? toXmlSafePayload(payload) : null;
    },

    async flushPending(): Promise<readonly string[]> {
      const innerKeys = (await inner.flushPending?.()) ?? [];
      const nativeKeys = await nativeCompiler.flushPending();
      return [...innerKeys, ...nativeKeys];
    },
  };
}
