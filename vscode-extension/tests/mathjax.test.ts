/*
 * Unit tests for MathJax SVG rendering as the webview canvas uses it.
 *
 * The vendored tikz-editor renders node text through MathJax (see
 * tikzc-editor/packages/core/src/text/mathjax-engine.ts). This runs the same
 * input/tex + output/svg configuration (createMathJaxConfig, minus the
 * Knuth-Plass linebreak visitor, which only matters for canvas layout) on the
 * Node build of @mathjax/src to verify tex -> svg conversion itself.
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import mathjaxEntry from "@mathjax/src";

type MathJaxRuntime = Awaited<ReturnType<typeof mathjaxEntry.init>>;

let MathJax: MathJaxRuntime;

before(async () => {
  MathJax = await mathjaxEntry.init({
    loader: { load: ["input/tex", "output/svg", "[tex]/color", "[tex]/html"] },
    tex: {
      packages: { "[+]": ["color", "html"], "[-]": ["noundefined"] },
      // same as the webview engine: surface TeX errors instead of rendering merror nodes
      formatError: (_jax: unknown, err: Error) => {
        throw err;
      },
    },
    svg: { fontCache: "none" },
    startup: { typeset: false },
  });
});

/** tex -> outer <svg> markup, via the same adaptor surface the webview uses. */
async function tex2svg(tex: string, display = true): Promise<string> {
  const node = await MathJax.tex2svgPromise(tex, { display });
  const adaptor = MathJax.startup.adaptor;
  return adaptor.outerHTML(adaptor.firstChild(node));
}

test("mathjaxレンダリング: ディスプレイ数式が SVG になる", async () => {
  const svg = await tex2svg("\\frac{a}{b} + \\sqrt{x^2 + 1}");
  assert.ok(svg.startsWith("<svg"), "output should be an <svg> element");
  assert.match(svg, /viewBox="/);
  assert.ok(svg.includes("<path"), "glyphs should be rendered as paths");
});

test("mathjaxレンダリング: インライン数式も SVG になる", async () => {
  const svg = await tex2svg("e^{i\\pi} = -1", false);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("<path"));
});

test("mathjaxレンダリング: 動的フォントサブセット (\\mathbb) が解決される", async () => {
  // \mathbb needs the lazily-loaded double-struck subset; tex2svgPromise must
  // await the font load (mathjax.handleRetriesFor) instead of failing once
  const svg = await tex2svg("\\mathbb{R}^n");
  assert.ok(svg.includes("<path"), "double-struck glyphs should render as paths");
});

test("mathjaxレンダリング: 日本語テキストも errorなし で描画される", async () => {
  // newcm has no CJK glyphs; MathJax falls back to <text> elements, which the
  // webview canvas then styles with the system font — but it must not throw
  const svg = await tex2svg("\\text{日本語ラベル}", false);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("日本語ラベル"), "CJK should fall back to text content");
  assert.ok(!svg.includes("merror"), "no MathJax error node expected");
});

test("mathjaxレンダリング: 未定義マクロはエラーとして通知される", async () => {
  // MathJax throws a TexError, which is not an Error instance — match manually
  await assert.rejects(tex2svg("\\notarealmacro"), (e: unknown) => {
    const message = String((e as { message?: unknown })?.message ?? e);
    assert.match(message, /Undefined control sequence/);
    return true;
  });
});
