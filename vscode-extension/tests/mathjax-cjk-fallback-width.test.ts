/*
 * Regression test for the phantom gap after CJK runs in canvas node text.
 *
 * The lite adaptor (worker runtime) estimates fallback CJK characters at
 * 1em each, but MathJax's SVG output emits fallback <text> elements with an
 * x-height-matched font-size (884px for newcm, i.e. 0.884em). The 0.116em
 * per-char overestimate accumulated across a CJK run and pushed the next
 * in-font glyph (e.g. the ASCII "1" in "…を1対1で…") too far right, showing
 * an unnatural space on the canvas. installWorkerFallbackTextMeasurement in
 * tikzc-editor/packages/core/src/text/mathjax-engine.ts scales the estimate
 * to the emitted font-size (and measures for real via OffscreenCanvas when
 * available — not in Node, so this test exercises the scaled-estimate path).
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";

// Force the worker runtime (liteAdaptor + badSizes estimation): the engine
// picks it when `self === globalThis` and no DOM globals exist, which is the
// same environment as the webview compute worker.
(globalThis as { self?: unknown }).self = globalThis;

import { createMathJaxNodeTextEngine } from "../tikzc-editor/packages/core/src/text/mathjax-engine";
import type { NodeTextEngine } from "../tikzc-editor/packages/core/src/text/types";

// First line of sandbox/nat.tikz's description node: 21 CJK chars, then "1対1".
const NODE_TEXT =
  "プライベートアドレスとグローバルアドレスを1対1で対応させて変換する仕組み．\\\\\n確保しているグローバルアドレスの数までなら，複数のコンピュータを";
const LEADING_CJK_CHARS = "プライベートアドレスとグローバルアドレスを".length;
const CM_TO_PT = 28.45274;

let engine: NodeTextEngine;

before(async () => {
  engine = await createMathJaxNodeTextEngine();
});

test("CJKフォールバック幅がfont-sizeスケールと一致し，ASCII字の前に隙間が出ない", async () => {
  const request = {
    text: NODE_TEXT,
    mode: "text" as const,
    textWidthPt: 13.5 * CM_TO_PT,
    alignment: "ragged-right" as const,
    fontStyle: "normal" as const,
    fontWeight: "normal" as const,
    fontFamily: "serif" as const,
    fontSizePt: 10,
  };

  let metrics = null;
  try {
    metrics = engine.measure(request);
  } catch {
    // dynamic font subsets may need an async round trip first
  }
  if (engine.flushPending) {
    await engine.flushPending();
  }
  metrics ??= engine.measure(request);
  assert.ok(metrics, "measure should produce metrics");

  const payload = engine.renderFromCache(metrics.cacheKey);
  assert.ok(payload, "render payload should be cached");

  // The fallback <text> font-size the width estimate must match (newcm
  // x_height 0.442 → 884px in the 1000-units-per-em coordinate system).
  const fontSizeMatch = payload.body.match(/font-size="([\d.]+)px"/);
  assert.ok(fontSizeMatch, "fallback text should carry a font-size");
  const fontSizeUnits = Number.parseFloat(fontSizeMatch[1]);

  // The "1" glyph (data-c="31") exists in the MathJax font and is positioned
  // right after the 21-char CJK fallback run.
  const digitMatch = payload.body.match(/<path data-c="31"[^>]*translate\(([\d.]+),0\)/);
  assert.ok(digitMatch, '"1" should render as a positioned glyph path');
  const digitX = Number.parseFloat(digitMatch[1]);

  const expectedX = LEADING_CJK_CHARS * fontSizeUnits;
  assert.ok(
    Math.abs(digitX - expectedX) < 1,
    `"1" should start at the rendered end of the CJK run (${expectedX}), got ${digitX}`
  );
  // Guard against the old behavior (1em per CJK char → 21000 units).
  assert.ok(digitX < LEADING_CJK_CHARS * 1000 - 1000, "old 1em-per-char estimate must not come back");
});
