/*
 * Unit tests for the compile pipeline the extension drives:
 *   - tikzc.exportSvg / tikzc.exportPng  -> compileTikz()      (see exportAs in src/extension.ts)
 *   - webview "latex.compile" RPC        -> compileTexToSvg()
 *
 * These shell out to lualatex / dvisvgm / pdftoppm exactly like the real
 * commands, so they need the TeX toolchain and the IPAexMincho font; each
 * compile test skips itself when the toolchain is missing.
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildTex,
  compileTikz,
  compileTexToSvg,
  injectStandalonePreamble,
  stripDvisvgmClassOption,
  TikzCompileError,
  DEFAULT_MAINFONT,
} from "../../src/core";

const execFileP = promisify(execFile);

// mirrors the diagrams the editor round-trips: Japanese node labels rendered
// through fontspec + IPAexMincho (DEFAULT_MAINFONT)
const JAPANESE_SOURCE = [
  "\\node[draw, rounded corners] (in) at (0,0) {日本語入力};",
  "\\node[draw, rounded corners] (out) at (4,0) {出力データ};",
  "\\draw[-{Stealth}] (in) -- (out);",
].join("\n");

const ASCII_SOURCE = "\\draw[->] (0,0) -- (2,1) node[right] {output};";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let toolchain = false;
let fontawesome = false;

before(async () => {
  const results = await Promise.all(
    ["lualatex", "dvisvgm", "pdftoppm"].map(async (cmd) => {
      try {
        await execFileP(cmd, ["--version"]);
        return true;
      } catch (e) {
        // pdftoppm --version prints its banner but exits 1; only a failed
        // spawn (ENOENT) means the tool is actually missing
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
// 日本語入力
// ---------------------------------------------------------------------------

test("日本語入力: buildTex が fontspec + IPAexMincho で本文を保持する", () => {
  const tex = buildTex(JAPANESE_SOURCE);
  assert.match(tex, /\\usepackage\{fontspec\}/);
  assert.match(tex, new RegExp(`\\\\setmainfont\\{${DEFAULT_MAINFONT}\\}`));
  assert.ok(tex.includes("日本語入力"));
  assert.ok(tex.includes("出力データ"));
});

test("日本語入力: 日本語ラベルが SVG にコンパイルできる", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  const result = await compileTikz(JAPANESE_SOURCE, { formats: ["svg"] });
  assert.ok(result.svg, "svg should be produced");
  assert.ok(result.svg.includes("<svg"), "output should be an SVG document");
  // dvisvgm --no-fonts embeds CJK glyphs as outline paths
  assert.ok(result.svg.includes("<path"), "glyphs should be embedded as paths");
});

// ---------------------------------------------------------------------------
// svg出力
// ---------------------------------------------------------------------------

test("svg出力: compileTikz({formats:['svg']}) が SVG のみを返す", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  const result = await compileTikz(ASCII_SOURCE, { formats: ["svg"] });
  assert.ok(result.svg, "svg should be set");
  assert.ok(result.svg.trimStart().startsWith("<"), "svg should be XML text");
  assert.ok(result.svg.includes("<svg"), "svg root element expected");
  assert.equal(result.png, undefined, "png should not be produced");
});

// ---------------------------------------------------------------------------
// png出力
// ---------------------------------------------------------------------------

test("png出力: compileTikz({formats:['png']}) が PNG バイナリを返す", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  const result = await compileTikz(ASCII_SOURCE, { formats: ["png"], dpi: 150 });
  assert.ok(result.png, "png should be set");
  assert.ok(
    result.png.subarray(0, 8).equals(PNG_SIGNATURE),
    "output should start with the PNG signature"
  );
  assert.equal(result.svg, undefined, "svg should not be produced");
});

// ---------------------------------------------------------------------------
// errorなし
// ---------------------------------------------------------------------------

test("errorなし: 正常な文書は LaTeX ログにエラー行を残さない", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  // same path as the webview "latex.compile" RPC: full document in, svg + log out
  const { svg, log } = await compileTexToSvg(buildTex(JAPANESE_SOURCE));
  assert.ok(svg.length > 0, "svg should not be empty");
  assert.ok(!/^!/m.test(log), `LaTeX log should contain no "!" error lines:\n${log.slice(-500)}`);
});

// ---------------------------------------------------------------------------
// positioning の and 記法
// ---------------------------------------------------------------------------

// regression: `below right={0.55cm and 1.3cm} of x` (braced distance pair)
// died in the PGF math parser with "Unknown operator `a' or `an'";
// buildTex() now rewrites it to the canonical unbraced form
const BRACED_AND_SOURCE = [
  "\\node[draw] (a) {A};",
  "\\node[draw, below right={0.55cm and 1.3cm} of a.south west] (b) {B};",
].join("\n");

test("and記法: 波括弧つき距離ペアの positioning 指定でも SVG 化できる", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  const { svg, log } = await compileTexToSvg(buildTex(BRACED_AND_SOURCE));
  assert.ok(svg.includes("<svg"), "output should be an SVG document");
  assert.ok(!/^!/m.test(log), `LaTeX log should contain no "!" error lines:\n${log.slice(-500)}`);
});

// ---------------------------------------------------------------------------
// アイコン（#| ヘッダ）
// ---------------------------------------------------------------------------

// the "latex.compile" RPC receives a standalone document assembled by the
// embedded editor: documentclass + \usepackage{tikz} + inferred libraries,
// with no trace of the .tikz source's `#|` header (regression: fontawesome
// icons rendered fine via the CLI but failed in the editor's compiled preview)
const EDITOR_ICON_DOC = [
  "\\documentclass[dvisvgm,border=2pt]{standalone}",
  "\\usepackage{tikz}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "\\node[font=\\ttfamily] {\\faFolderOpen\\ config/};",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");

const ICON_TIKZ_SOURCE = [
  "#| mainfont: IPAexGothic",
  "#| packages: [fontawesome]",
  "#| libraries: [calc]",
  "\\begin{tikzpicture}",
  "\\node[font=\\ttfamily] {\\faFolderOpen\\ config/};",
  "\\end{tikzpicture}",
].join("\n");

test("アイコン: エディタ生成文書は素のままだと \\faFolderOpen で失敗する", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  // class option normalized, but no preamble injected -> the icon macro is
  // still undefined (the pre-fix behaviour of the latex.compile RPC)
  await assert.rejects(
    compileTexToSvg(stripDvisvgmClassOption(EDITOR_ICON_DOC)),
    (e: unknown) => {
      assert.ok(e instanceof TikzCompileError);
      assert.match(e.message, /Undefined control sequence/);
      return true;
    }
  );
});

test("アイコン: dvisvgm クラスオプションは lualatex で致命的なので除去される", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  // unstripped, the compile fails before the picture is even read
  await assert.rejects(
    compileTexToSvg(EDITOR_ICON_DOC),
    (e: unknown) => {
      assert.ok(e instanceof TikzCompileError);
      assert.match(e.message, /Backend request inconsistent with engine/);
      return true;
    }
  );
});

test("アイコン: RPC と同じ変換後は fontawesome アイコンがコンパイルできる", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  if (!fontawesome) return t.skip("fontawesome.sty not installed");
  // same transform as the extension's "latex.compile" RPC handler
  const tex = injectStandalonePreamble(
    stripDvisvgmClassOption(EDITOR_ICON_DOC),
    ICON_TIKZ_SOURCE
  );
  const { svg, log } = await compileTexToSvg(tex);
  assert.ok(svg.includes("<svg"), "output should be an SVG document");
  assert.ok(svg.includes("<path"), "icon glyphs should be embedded as paths");
  assert.ok(!/^!/m.test(log), `LaTeX log should contain no "!" error lines:\n${log.slice(-500)}`);
});

test("errorなし: 壊れた入力は TikzCompileError として報告される", async (t) => {
  if (!toolchain) return t.skip("lualatex/dvisvgm/pdftoppm not installed");
  await assert.rejects(
    compileTikz("\\thisisnotarealmacro", { formats: ["svg"] }),
    (e: unknown) => {
      assert.ok(e instanceof TikzCompileError, "should be a TikzCompileError");
      assert.match(e.message, /lualatex compilation failed/);
      assert.ok(e.log.length > 0, "the LaTeX log should be attached");
      return true;
    }
  );
});
