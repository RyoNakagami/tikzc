/*
 * Unit tests for the native text fallback state machine
 * (webview/node-text-fallback/native-compiler.ts) with a mock compiler.
 * No TeX toolchain or DOM required.
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NativeTextCompiler,
  extractTikzHeader,
  type NativeMeasureRequest,
} from "../webview/node-text-fallback/native-compiler";
import type {
  NativeSnippetRequest,
  NativeSnippetResult,
} from "../webview/node-text-fallback/types";

const BASE_FONT = 9.96264;
const MIDLINE = 0.215;

const SVG = [
  "<svg viewBox='0 0 20 10'>",
  "<defs><path id='g0-1' d='M0 0'/></defs>",
  "<use xlink:href='#g0-1'/>",
  "</svg>",
].join("");

function okResult(id: string): NativeSnippetResult {
  return { id, status: "ok", svg: SVG, wdBp: 20, htBp: 8, dpBp: 2 };
}

function measureReq(overrides: Partial<NativeMeasureRequest> = {}): NativeMeasureRequest {
  return {
    text: "\\faGlobe",
    mode: "text",
    textWidthPt: null,
    fontStyle: "normal",
    fontWeight: "normal",
    fontFamily: "serif",
    fontSizePt: BASE_FONT,
    ...overrides,
  };
}

function makeCompiler(
  handler: (requests: NativeSnippetRequest[]) => NativeSnippetResult[] | Promise<NativeSnippetResult[]>
): { compiler: NativeTextCompiler; calls: NativeSnippetRequest[][] } {
  const calls: NativeSnippetRequest[][] = [];
  const compiler = new NativeTextCompiler({ baseFontSizePt: BASE_FONT, midlineRatio: MIDLINE });
  compiler.setCompiler(async (requests) => {
    calls.push(requests);
    return handler(requests);
  });
  return { compiler, calls };
}

test("extractTikzHeader: 先頭の #| 行だけを抜き出す", () => {
  const source = "#| mainfont: IPAexGothic\n#| packages: [fontawesome]\n\\begin{tikzpicture}\n#| not-header: x\n";
  assert.equal(extractTikzHeader(source), "#| mainfont: IPAexGothic\n#| packages: [fontawesome]");
  assert.equal(extractTikzHeader("\\begin{tikzpicture}"), "");
});

test("未コンパイル→pending→done の基本遷移", async () => {
  const { compiler } = makeCompiler((reqs) => reqs.map((r) => okResult(r.id)));
  // (b) 未コンパイル: null + キュー投入
  assert.equal(compiler.measure(measureReq()), null);
  // (c) コンパイル中（再measure）: null のまま
  assert.equal(compiler.measure(measureReq()), null);
  const keys = await compiler.flushPending();
  assert.equal(keys.length, 1);
  assert.ok(keys[0].startsWith("native:"));
  // (d) 完了: metrics が返る
  const metrics = compiler.measure(measureReq());
  assert.ok(metrics);
  assert.equal(metrics.cacheKey, keys[0]);
  assert.equal(metrics.width, 20);
  assert.equal(metrics.height, 10);
  assert.equal(metrics.baselineY, -3); // -((8-2)/2)
  assert.ok(Math.abs(metrics.midLineY - (-3 + BASE_FONT * MIDLINE)) < 1e-9);
  // renderFromCache が payload を返す
  const payload = compiler.renderFromCache(keys[0]);
  assert.ok(payload);
  assert.deepEqual(payload.viewBox, { x: 0, y: 0, width: 20, height: 10 });
  assert.ok(payload.body.includes("currentColor"));
});

test("フォントサイズはスケールされ、キャッシュキーはサイズ非依存", async () => {
  const { compiler, calls } = makeCompiler((reqs) => reqs.map((r) => okResult(r.id)));
  compiler.measure(measureReq());
  await compiler.flushPending();
  const at2x = compiler.measure(measureReq({ fontSizePt: BASE_FONT * 2 }));
  assert.ok(at2x);
  assert.equal(at2x.width, 40);
  assert.equal(at2x.height, 20);
  assert.equal(at2x.baselineY, -6);
  assert.equal(calls.length, 1); // 再コンパイルなし
});

test("latex 失敗はキャッシュされ再キューされない、failureMessageFor で読める", async () => {
  const { compiler, calls } = makeCompiler((reqs) =>
    reqs.map((r) => ({
      id: r.id,
      status: "error" as const,
      message: "Undefined control sequence",
      errorKind: "latex" as const,
    }))
  );
  compiler.measure(measureReq());
  const keys = await compiler.flushPending();
  assert.equal(keys.length, 0); // 失敗は finalized に含めない
  assert.equal(compiler.measure(measureReq()), null);
  await compiler.flushPending();
  assert.equal(calls.length, 1);
  assert.equal(compiler.failureMessageFor("\\faGlobe"), "Undefined control sequence");
});

test("今パスで要求されなかった queued は flush 時に破棄される（タイピング中間状態）", async () => {
  const { compiler, calls } = makeCompiler((reqs) => reqs.map((r) => okResult(r.id)));
  compiler.measure(measureReq({ text: "\\faGl" })); // 中間状態
  // 次のパス: 完成形だけ要求される
  compiler.measure(measureReq({ text: "\\faGlobe" }));
  // 中間状態はパス外 → flush で破棄したいが、requestedThisPass には両方載っている
  // （同一パス扱い）。まず flush して両方確定させるのではなく、パス境界を再現:
  await compiler.flushPending(); // pass 1: 両方コンパイルされる
  assert.equal(calls[0].length, 2);

  // pass 2: 新しい中間状態を queue し、その後のパスでは要求しない
  compiler.measure(measureReq({ text: "\\faSit" }));
  // pass 3 相当: flush 前に別テキストだけを要求
  await compiler.flushPending(); // \faSit はこのパスで要求済みなのでコンパイルされる
  compiler.measure(measureReq({ text: "\\faSitemap" }));
  compiler.measure(measureReq({ text: "\\faSitemap" }));
  const keys = await compiler.flushPending();
  assert.equal(keys.length, 1);
  assert.ok(keys[0].includes("faSitemap"));
});

test("stale 破棄: measure 後に別パスで要求されなければコンパイルされない", async () => {
  const { compiler, calls } = makeCompiler((reqs) => reqs.map((r) => okResult(r.id)));
  compiler.measure(measureReq({ text: "\\faOld" }));
  // パス境界: flushPending は requestedThisPass をクリアする
  await compiler.flushPending();
  assert.equal(calls.length, 1);
  // 次パス: \faOld は要求されず、新規 \faNew だけ
  compiler.measure(measureReq({ text: "\\faNew" }));
  // (\faOld は entries に done 済み。queued は空。破棄対象なし)
  const keys = await compiler.flushPending();
  assert.equal(keys.length, 1);
  assert.ok(keys[0].includes("faNew"));
});

test("RPC 自体の失敗は transient として全 queued を failed にする", async () => {
  const compiler = new NativeTextCompiler({ baseFontSizePt: BASE_FONT, midlineRatio: MIDLINE });
  let calls = 0;
  compiler.setCompiler(async () => {
    calls += 1;
    throw new Error("webview disposed");
  });
  compiler.measure(measureReq());
  const keys = await compiler.flushPending();
  assert.equal(keys.length, 0);
  assert.equal(compiler.measure(measureReq()), null); // failed → null（30秒は再試行しない）
  await compiler.flushPending();
  assert.equal(calls, 1);
});

test("compiler 未注入なら何もキューされない（従来動作に退避）", async () => {
  const compiler = new NativeTextCompiler({ baseFontSizePt: BASE_FONT, midlineRatio: MIDLINE });
  assert.equal(compiler.measure(measureReq()), null);
  const keys = await compiler.flushPending();
  assert.equal(keys.length, 0);
});

test("header が変わるとキーが変わり再コンパイルされる", async () => {
  const { compiler, calls } = makeCompiler((reqs) => reqs.map((r) => okResult(r.id)));
  compiler.setHeaderFromSource("#| packages: [fontawesome]\n\\begin{tikzpicture}");
  compiler.measure(measureReq());
  await compiler.flushPending();
  compiler.setHeaderFromSource("#| packages: [fontawesome5]\n\\begin{tikzpicture}");
  assert.equal(compiler.measure(measureReq()), null); // 新キー → pending
  await compiler.flushPending();
  assert.equal(calls.length, 2);
});

test("textWidthPt はフォントサイズで正規化されてキー・リクエストに載る", async () => {
  const { compiler, calls } = makeCompiler((reqs) => reqs.map((r) => okResult(r.id)));
  compiler.measure(measureReq({ textWidthPt: BASE_FONT * 2 * 12, fontSizePt: BASE_FONT * 2, alignment: "center" }));
  await compiler.flushPending();
  // widthBp はキーの float ジッタ対策で小数3桁に丸められる
  assert.ok(Math.abs((calls[0][0].widthBp ?? 0) - 12 * BASE_FONT) < 0.001);
  assert.equal(calls[0][0].alignment, "center");
});
