/*
 * Unit tests for the pure source-parsing / tex-assembly functions in core.ts.
 * These exercise the logic that does not shell out to lualatex/dvisvgm/pdftoppm,
 * so they run fast and need no LaTeX toolchain.
 *
 * Run with:  npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseList,
  parseSource,
  buildTex,
  DEFAULT_PACKAGES,
  DEFAULT_LIBRARIES,
  DEFAULT_MAINFONT,
} from "../src/core";

// ---------------------------------------------------------------------------
// parseList
// ---------------------------------------------------------------------------

test("parseList: undefined and empty inputs yield []", () => {
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual(parseList(""), []);
  assert.deepEqual(parseList("   "), []);
  assert.deepEqual(parseList("[]"), []);
});

test("parseList: bracketed list", () => {
  assert.deepEqual(parseList("[circuitikz, pgfplots]"), [
    "circuitikz",
    "pgfplots",
  ]);
});

test("parseList: bare comma-separated list", () => {
  assert.deepEqual(parseList("arrows.meta, calc"), ["arrows.meta", "calc"]);
});

test("parseList: trims whitespace and strips surrounding quotes", () => {
  assert.deepEqual(parseList('[ "a" , "b" ]'), ["a", "b"]);
  assert.deepEqual(parseList("  x  ,  y  "), ["x", "y"]);
});

test("parseList: drops empty entries from trailing/duplicate commas", () => {
  assert.deepEqual(parseList("a,,b,"), ["a", "b"]);
  assert.deepEqual(parseList("[a, , b]"), ["a", "b"]);
});

test("parseList: single element", () => {
  assert.deepEqual(parseList("calc"), ["calc"]);
  assert.deepEqual(parseList("[calc]"), ["calc"]);
});

// ---------------------------------------------------------------------------
// parseSource
// ---------------------------------------------------------------------------

test("parseSource: no header returns empty opts and full body", () => {
  const src = "\\draw (0,0) -- (1,1);";
  const { opts, body } = parseSource(src);
  assert.deepEqual(opts, {});
  assert.equal(body, src);
});

test("parseSource: extracts #| header options", () => {
  const src = [
    "#| scale: 1.5",
    "#| mainfont: IPAexGothic",
    "\\draw (0,0) circle (1);",
  ].join("\n");
  const { opts, body } = parseSource(src);
  assert.deepEqual(opts, { scale: "1.5", mainfont: "IPAexGothic" });
  assert.equal(body, "\\draw (0,0) circle (1);");
});

test("parseSource: header parsing stops at first non-header line", () => {
  // a #| line appearing after body content is treated as body, not an option
  const src = ["#| scale: 2", "\\draw (0,0);", "#| packages: [x]"].join("\n");
  const { opts, body } = parseSource(src);
  assert.deepEqual(opts, { scale: "2" });
  assert.equal(body, "\\draw (0,0);\n#| packages: [x]");
});

test("parseSource: tolerates surrounding whitespace in header lines", () => {
  const src = "   #|   scale :  1.2   \n\\draw (0,0);";
  const { opts } = parseSource(src);
  assert.deepEqual(opts, { scale: "1.2" });
});

test("parseSource: keys may contain hyphens and word chars", () => {
  const src = "#| some-key: value\n\\draw;";
  const { opts } = parseSource(src);
  assert.deepEqual(opts, { "some-key": "value" });
});

// ---------------------------------------------------------------------------
// buildTex
// ---------------------------------------------------------------------------

test("buildTex: bare content is wrapped in a tikzpicture", () => {
  const tex = buildTex("\\draw (0,0) -- (1,1);");
  assert.match(tex, /\\begin\{tikzpicture\}/);
  assert.match(tex, /\\end\{tikzpicture\}/);
  assert.match(tex, /\\draw \(0,0\) -- \(1,1\);/);
});

test("buildTex: existing tikzpicture is not double-wrapped", () => {
  const src = "\\begin{tikzpicture}\n\\draw (0,0);\n\\end{tikzpicture}";
  const tex = buildTex(src);
  const opens = tex.match(/\\begin\{tikzpicture\}/g) ?? [];
  assert.equal(opens.length, 1);
});

test("buildTex: includes the standalone preamble and default font", () => {
  const tex = buildTex("\\draw (0,0);");
  assert.match(tex, /\\documentclass\[border=2pt\]\{standalone\}/);
  assert.match(tex, /\\usepackage\{fontspec\}/);
  assert.match(tex, /\\usepackage\{tikz\}/);
  assert.ok(tex.includes(`\\setmainfont{${DEFAULT_MAINFONT}}`));
  assert.match(tex, /\\begin\{document\}/);
  assert.match(tex, /\\end\{document\}/);
});

test("buildTex: emits default packages and libraries", () => {
  const tex = buildTex("\\draw (0,0);");
  for (const pkg of DEFAULT_PACKAGES) {
    assert.ok(tex.includes(`\\usepackage{${pkg}}`), `missing package ${pkg}`);
  }
  assert.ok(
    tex.includes(`\\usetikzlibrary{${DEFAULT_LIBRARIES.join(",")}}`),
    "default libraries not emitted as a single usetikzlibrary"
  );
});

test("buildTex: header option overrides the default mainfont", () => {
  const tex = buildTex("#| mainfont: IPAexGothic\n\\draw (0,0);");
  assert.ok(tex.includes("\\setmainfont{IPAexGothic}"));
  assert.ok(!tex.includes(`\\setmainfont{${DEFAULT_MAINFONT}}`));
});

test("buildTex: defaults.mainfont is used when no header option", () => {
  const tex = buildTex("\\draw (0,0);", { mainfont: "NotoSansCJK" });
  assert.ok(tex.includes("\\setmainfont{NotoSansCJK}"));
});

test("buildTex: header mainfont wins over defaults.mainfont", () => {
  const tex = buildTex("#| mainfont: FromHeader\n\\draw (0,0);", {
    mainfont: "FromDefaults",
  });
  assert.ok(tex.includes("\\setmainfont{FromHeader}"));
  assert.ok(!tex.includes("\\setmainfont{FromDefaults}"));
});

test("buildTex: scale wraps content in scalebox", () => {
  const tex = buildTex("#| scale: 1.5\n\\draw (0,0);");
  assert.match(tex, /\\scalebox\{1\.5\}\{\\begin\{tikzpicture\}/);
});

test("buildTex: no scalebox when scale is absent", () => {
  const tex = buildTex("\\draw (0,0);");
  assert.ok(!tex.includes("\\scalebox"));
});

test("buildTex: packages/libraries merge defaults + defaults arg + header, deduped", () => {
  const tex = buildTex(
    "#| packages: [circuitikz, amsmath]\n#| libraries: [calc, decorations]\n\\draw (0,0);",
    { packages: ["pgfplots"], libraries: ["patterns"] }
  );

  // amsmath is a default; it must appear exactly once despite the header repeat
  const amsmath = tex.match(/\\usepackage\{amsmath\}/g) ?? [];
  assert.equal(amsmath.length, 1, "amsmath should be deduplicated");

  // defaults-arg and header packages both present
  assert.ok(tex.includes("\\usepackage{pgfplots}"));
  assert.ok(tex.includes("\\usepackage{circuitikz}"));

  // calc is a default library and appears in header; single usetikzlibrary line
  const libLine = tex
    .split("\n")
    .find((l) => l.startsWith("\\usetikzlibrary{"))!;
  const libs = libLine
    .replace("\\usetikzlibrary{", "")
    .replace(/\}$/, "")
    .split(",");
  assert.equal(
    new Set(libs).size,
    libs.length,
    "libraries should be deduplicated"
  );
  assert.ok(libs.includes("patterns"));
  assert.ok(libs.includes("decorations"));
  assert.ok(libs.includes("calc"));
});

test("buildTex: package merge order is defaults, then defaults arg, then header", () => {
  const tex = buildTex("#| packages: [zzz]\n\\draw;", { packages: ["mmm"] });
  const idxDefault = tex.indexOf("\\usepackage{amsmath}");
  const idxArg = tex.indexOf("\\usepackage{mmm}");
  const idxHeader = tex.indexOf("\\usepackage{zzz}");
  assert.ok(idxDefault < idxArg && idxArg < idxHeader);
});
