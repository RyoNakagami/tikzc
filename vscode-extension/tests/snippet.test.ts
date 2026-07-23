/*
 * Tests for the node-text snippet pipeline behind the webview
 * "latex.compileSnippet" RPC (native text fallback for node text the
 * embedded editor's MathJax engine cannot render, e.g. \faGlobe):
 *   - buildSnippetTex()      preamble merge + style/width wrapping
 *   - parseSnippetMetrics()  TIKZC-METRICS line parsing
 *   - compileSnippetToSvg()  real lualatex + dvisvgm run (skips w/o toolchain)
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildSnippetTex,
  compileSnippetToSvg,
  parseSnippetMetrics,
  DEFAULT_MAINFONT,
  type SnippetParams,
} from "../../src/core";

const execFileP = promisify(execFile);

const BASE_PARAMS: SnippetParams = {
  text: "hello",
  mode: "text",
  widthBp: null,
  alignment: null,
  fontStyle: "normal",
  fontWeight: "normal",
  fontFamily: "serif",
};

let toolchain = false;
let fontawesome = false;

before(async () => {
  const results = await Promise.all(
    ["lualatex", "dvisvgm"].map(async (cmd) => {
      try {
        await execFileP(cmd, ["--version"]);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code !== "ENOENT";
      }
    })
  );
  toolchain = results.every(Boolean);
  try {
    const { stdout } = await execFileP("kpsewhich", ["fontawesome.sty"]);
    fontawesome = stdout.trim().length > 0;
  } catch {
    fontawesome = false;
  }
});

// ---------------------------------------------------------------------------
// buildSnippetTex: プリアンブル合成
// ---------------------------------------------------------------------------

test("buildSnippetTex: #| ヘッダの packages / mainfont がプリアンブルに反映される", () => {
  const header = "#| mainfont: IPAexGothic\n#| packages: [fontawesome]\n";
  const tex = buildSnippetTex(BASE_PARAMS, header);
  assert.match(tex, /\\setmainfont\{IPAexGothic\}/);
  assert.match(tex, /\\usepackage\{fontawesome\}/);
  assert.match(tex, /\\usepackage\{amsmath\}/); // DEFAULT_PACKAGES は常に含む
  assert.match(tex, /\\documentclass\[border=0pt\]\{standalone\}/);
});

test("buildSnippetTex: ヘッダ無しでは defaults と DEFAULT_MAINFONT が使われる", () => {
  const tex = buildSnippetTex(BASE_PARAMS, "");
  assert.match(tex, new RegExp(`\\\\setmainfont\\{${DEFAULT_MAINFONT}\\}`));
  const withDefaults = buildSnippetTex(BASE_PARAMS, "", {
    mainfont: "IPAexGothic",
    packages: ["fontawesome5"],
  });
  assert.match(withDefaults, /\\setmainfont\{IPAexGothic\}/);
  assert.match(withDefaults, /\\usepackage\{fontawesome5\}/);
});

test("buildSnippetTex: metrics.txt への \\write とスニペット本体を含む", () => {
  const tex = buildSnippetTex(BASE_PARAMS, "");
  assert.match(tex, /\\immediate\\openout\\tikzcmetricsfile=metrics\.txt/);
  assert.match(
    tex,
    /TIKZC-METRICS:\\the\\wd\\tikzcsnippetbox:\\the\\ht\\tikzcsnippetbox:\\the\\dp\\tikzcsnippetbox/
  );
  assert.match(tex, /\\sbox\\tikzcsnippetbox\{\\mbox\{hello\}\}/);
});

// ---------------------------------------------------------------------------
// buildSnippetTex: スタイル / 幅ラッピング（MathJax エンジンの buildWrappedTeX と同型）
// ---------------------------------------------------------------------------

test("buildSnippetTex: family/weight/style が \\textsf・\\textbf・\\textit の入れ子になる", () => {
  const tex = buildSnippetTex(
    {
      ...BASE_PARAMS,
      fontFamily: "sans",
      fontWeight: "bold",
      fontStyle: "italic",
    },
    ""
  );
  assert.ok(tex.includes("\\mbox{\\textit{\\textbf{\\textsf{hello}}}}"));
});

test("buildSnippetTex: monospace は \\texttt になる", () => {
  const tex = buildSnippetTex({ ...BASE_PARAMS, fontFamily: "monospace" }, "");
  assert.ok(tex.includes("\\texttt{hello}"));
});

test("buildSnippetTex: widthBp 指定で \\parbox[t] + 揃えコマンドになる", () => {
  const ragged = buildSnippetTex({ ...BASE_PARAMS, widthBp: 120 }, "");
  assert.ok(ragged.includes("\\parbox[t]{120bp}{\\raggedright hello}"));
  const centered = buildSnippetTex(
    { ...BASE_PARAMS, widthBp: 120, alignment: "center" },
    ""
  );
  assert.ok(centered.includes("\\parbox[t]{120bp}{\\centering hello}"));
  const justified = buildSnippetTex(
    { ...BASE_PARAMS, widthBp: 120, alignment: "justified" },
    ""
  );
  assert.ok(justified.includes("\\parbox[t]{120bp}{hello}"));
});

test("buildSnippetTex: math モードは $...$、幅指定時は \\parbox に包む", () => {
  const natural = buildSnippetTex({ ...BASE_PARAMS, mode: "math", text: "x^2" }, "");
  assert.ok(natural.includes("\\sbox\\tikzcsnippetbox{$x^2$}"));
  const wrapped = buildSnippetTex(
    { ...BASE_PARAMS, mode: "math", text: "x^2", widthBp: 80 },
    ""
  );
  assert.ok(wrapped.includes("\\parbox{80bp}{$x^2$}"));
});

// ---------------------------------------------------------------------------
// parseSnippetMetrics
// ---------------------------------------------------------------------------

test("parseSnippetMetrics: TIKZC-METRICS 行から wd/ht/dp を読む", () => {
  const metrics = parseSnippetMetrics("TIKZC-METRICS:24.9066pt:6.94444pt:1.94444pt\n");
  assert.deepEqual(metrics, { wdTexPt: 24.9066, htTexPt: 6.94444, dpTexPt: 1.94444 });
});

test("parseSnippetMetrics: 不正な入力には null を返す", () => {
  assert.equal(parseSnippetMetrics(""), null);
  assert.equal(parseSnippetMetrics("TIKZC-METRICS:abc:def:ghi"), null);
  assert.equal(parseSnippetMetrics("no metrics here"), null);
});

// ---------------------------------------------------------------------------
// compileSnippetToSvg: 実コンパイル（要 TeX ツールチェーン）
// ---------------------------------------------------------------------------

test("compileSnippetToSvg: プレーンテキストが SVG + 正のメトリクスになる", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm not installed");
  const tex = buildSnippetTex(BASE_PARAMS, "");
  const result = await compileSnippetToSvg(tex);
  assert.ok(result.svg.includes("<svg"));
  assert.ok(result.metrics.wdTexPt > 0);
  assert.ok(result.metrics.htTexPt > 0);
  assert.ok(result.metrics.dpTexPt >= 0);
});

test("compileSnippetToSvg: \\faGlobe が fontawesome ヘッダ付きでコンパイルできる", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm not installed");
  if (!fontawesome) return t.skip("fontawesome.sty not installed");
  const tex = buildSnippetTex(
    { ...BASE_PARAMS, text: "\\faGlobe" },
    "#| mainfont: IPAexGothic\n#| packages: [fontawesome]\n"
  );
  const result = await compileSnippetToSvg(tex);
  assert.ok(result.svg.includes("<svg"));
  // アイコングリフはパスとして埋め込まれる（--no-fonts）
  assert.ok(result.svg.includes("<path"), "icon glyph should be embedded as a path");
  assert.ok(result.metrics.wdTexPt > 0);
  assert.ok(result.metrics.htTexPt > 0);
});

test("compileSnippetToSvg: 不正な TeX は TikzCompileError で失敗する", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm not installed");
  const tex = buildSnippetTex({ ...BASE_PARAMS, text: "\\undefinedmacroxyz" }, "");
  await assert.rejects(
    () => compileSnippetToSvg(tex),
    (e: Error) => e.name === "TikzCompileError"
  );
});
