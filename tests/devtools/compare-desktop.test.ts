import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
// The stubs are shebang scripts, and the script lists inputs with ripgrep.
const SKIP = process.platform === "win32" ? "stub executables need a POSIX shell"
  : spawnSync("rg", ["--version"]).status !== 0 ? "rg is not installed" : false;

type Run = { code: number | null; width?: number; height?: number; svg: string; png: string; stderr: string };
type Case = { sha256: string; paths: string[]; bytes: number; native: Run; reference: Run };

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

function fixture(t: TestContext) {
  // The script resolves the repository from its own location, so a copy in a
  // temporary directory keeps every output away from the real target/.
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tikzc compare ")));
  const corpus = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tikzc corpus ")));
  t.after(() => { for (const dir of [repo, corpus]) fs.rmSync(dir, { recursive: true, force: true }); });
  const script = path.join(repo, "devtools/compare-desktop.mjs");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "devtools/compare-desktop.mjs"), script);

  // A stand-in for tikzc: logs its arguments, then writes an SVG and a PNG
  // header of the given size. Marker comments in the input select failures.
  const stub = (name: "native" | "reference", file: string, width: number) => {
    const log = path.join(repo, `${name}.log`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("tikzc stub-${name}"); process.exit(0); }
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const source = fs.readFileSync(args[0], "utf8");
if (source.includes("FAIL-${name}")) { console.error("error: <unsupported> & more"); process.exit(3); }
if (source.includes("MUTATE-${name}")) fs.appendFileSync(args[0], "% changed\\n");
const dir = args[args.indexOf("-o") + 1], stem = path.basename(args[0], ".tikz");
fs.writeFileSync(path.join(dir, stem + ".svg"), "<svg/>");
const png = Buffer.alloc(24);
png.writeUInt32BE(${width}, 16); png.writeUInt32BE(50, 20);
fs.writeFileSync(path.join(dir, stem + ".png"), png);
`, { mode: 0o755 });
    return { file, calls: () => fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]) : [] };
  };
  // The native stub sits at the script's default --native location.
  const native = stub("native", path.join(repo, "target/release/tikzc"), 110);
  const reference = stub("reference", path.join(repo, "target/tikzc-before"), 100);

  const write = (base: string, file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), text);
    return path.join(base, file);
  };
  const run = (...args: string[]) => spawnSync(process.execPath,
    [script, "--reference", reference.file, ...args], { cwd: os.tmpdir(), encoding: "utf8" });
  const results = (out: string) => JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
  const baseline = path.join(repo, "target/desktop-comparison/baseline");
  return { repo, corpus, native, reference, write, run, results, baseline };
}

test("renders each unique diagram with both executables and writes the report and gallery", { skip: SKIP }, t => {
  const f = fixture(t);
  const a = f.write(f.corpus, "a.tikz", "A");
  const copy = f.write(f.corpus, "copy/a.tikz", "A");
  f.write(f.corpus, "b.tikz", "B");
  f.write(f.corpus, ".hidden/c.tikz", "C");
  f.write(f.corpus, "notes.txt", "not a diagram");
  for (const excluded of [".git", "node_modules", "target"]) f.write(f.corpus, `sub/${excluded}/x.tikz`, excluded);

  const result = f.run("--root", f.corpus);
  assert.equal(result.status, 0, result.stderr);
  const report = f.results(f.baseline);
  assert.equal(report.root, f.corpus);
  assert.equal(report.out, f.baseline);
  assert.equal(report.referenceVersion, "tikzc stub-reference");
  assert.equal(report.nativeVersion, "tikzc stub-native");
  assert.equal(report.nativeSha256, sha256(fs.readFileSync(f.native.file, "utf8")));
  assert.equal(report.dpi, 150);
  assert.equal(report.fileCount, 4);
  assert.equal(report.uniqueCount, 3);
  assert.equal(report.inputsUnchanged, true);
  assert.deepEqual(report.summary, { both: 3, referenceOnly: 0, nativeOnly: 0, neither: 0, externalUnique: 3, externalBoth: 3 });

  const cases: Case[] = report.cases;
  const duplicate = cases.find(c => c.sha256 === sha256("A"))!;
  assert.deepEqual(duplicate.paths, [a, copy], "identical files form one case");
  assert.equal(duplicate.bytes, 1);
  for (const c of cases) {
    const dir = path.join(f.baseline, c.sha256.slice(0, 12));
    for (const [run, name, width] of [[c.native, "native", 110], [c.reference, "reference", 100]] as const) {
      assert.equal(run.code, 0);
      assert.deepEqual([run.width, run.height], [width, 50]);
      assert.equal(path.dirname(run.svg), path.join(dir, name));
      assert.ok(fs.existsSync(run.svg) && fs.existsSync(run.png));
    }
  }
  // One invocation per unique input, with the documented command line.
  for (const stub of [f.native, f.reference]) {
    const calls = stub.calls();
    assert.deepEqual(calls.map(args => path.basename(args[0])).sort(), ["a.tikz", "b.tikz", "c.tikz"]);
    for (const args of calls) assert.deepEqual([args[1], args[2], args[3], ...args.slice(5)], ["-f", "both", "-o", "--dpi", "150", "-q"]);
  }

  const metrics = report.externalMetrics;
  assert.equal(metrics.widthRelativeError.count, 3);
  assert.ok(Math.abs(metrics.widthRelativeError.median - 0.1) < 1e-9);
  assert.equal(metrics.heightRelativeError.max, 0);

  const html = fs.readFileSync(path.join(f.baseline, "index.html"), "utf8");
  const prefix = duplicate.sha256.slice(0, 12);
  assert.ok(html.includes(`src="${prefix}/native/a.png"`) && html.includes(`href="${prefix}/reference/a.svg"`), "gallery links are relative");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.at(-1), path.join(f.baseline, "index.html"));
  assert.deepEqual(JSON.parse(lines.at(-2)!), report.summary);
});

test("render failures are counted and shown without failing the run", { skip: SKIP }, t => {
  const f = fixture(t);
  f.write(f.corpus, "ok.tikz", "ok");
  f.write(f.corpus, "native-fails.tikz", "FAIL-native");
  f.write(f.corpus, "reference-fails.tikz", "FAIL-reference");
  f.write(f.corpus, "both-fail.tikz", "FAIL-native FAIL-reference");

  const result = f.run("--root", f.corpus);
  assert.equal(result.status, 0, result.stderr);
  const report = f.results(f.baseline);
  assert.deepEqual(report.summary, { both: 1, referenceOnly: 1, nativeOnly: 1, neither: 1, externalUnique: 4, externalBoth: 1 });
  assert.equal(report.externalMetrics.widthRelativeError.count, 1, "metrics only cover cases where both succeed");
  const failed: Case = report.cases.find((c: Case) => c.paths[0].endsWith("native-fails.tikz"));
  assert.equal(failed.native.code, 3);
  assert.equal(failed.native.width, undefined);
  assert.equal(failed.reference.code, 0);
  assert.match(result.stdout, /reference=0 native=3 native-fails\.tikz error: <unsupported> & more/);

  const html = fs.readFileSync(path.join(f.baseline, "index.html"), "utf8");
  assert.ok(html.includes("native — ERROR") && html.includes("reference — ERROR"));
  assert.ok(html.includes("error: &lt;unsupported&gt; &amp; more"), "diagnostics are HTML-escaped");
  assert.ok(!html.includes("<unsupported>"));
});

test("diagrams inside the repository are not external, and target/ is never read as input", { skip: SKIP }, t => {
  const f = fixture(t);
  f.write(f.repo, "notebook/a.tikz", "A");
  f.write(f.repo, "target/stale/b.tikz", "B");

  const result = f.run("--root", f.repo, "--native", f.native.file);
  assert.equal(result.status, 0, result.stderr);
  const report = f.results(f.baseline);
  assert.equal(report.fileCount, 1);
  assert.deepEqual(report.summary, { both: 1, referenceOnly: 0, nativeOnly: 0, neither: 0, externalUnique: 0, externalBoth: 0 });
  assert.equal(report.externalMetrics.widthRelativeError, null);
});

test("--out outside this repository's target/ is rejected before anything runs", { skip: SKIP }, t => {
  const f = fixture(t);
  f.write(f.corpus, "a.tikz", "A");
  for (const out of [path.join(f.corpus, "out"), path.join(f.repo, "target-other"), path.join(f.repo, "target")]) {
    const result = f.run("--root", f.corpus, "--out", out);
    assert.notEqual(result.status, 0, out);
    assert.match(result.stderr, /Output must be inside this repository target\//);
    assert.ok(!fs.existsSync(path.join(out, "results.json")), out);
  }
  assert.ok(!fs.existsSync(path.join(f.repo, "target-other")));
  assert.deepEqual([f.native.calls(), f.reference.calls()], [[], []]);
});

test("--reuse-reference renders the reference only for inputs missing from the earlier run", { skip: SKIP }, t => {
  const f = fixture(t);
  f.write(f.corpus, "a.tikz", "A");
  f.write(f.corpus, "b.tikz", "B");
  assert.equal(f.run("--root", f.corpus).status, 0);
  const first = f.results(f.baseline);

  f.write(f.corpus, "new.tikz", "new");
  const out = path.join(f.repo, "target/desktop-comparison/after");
  const cache = path.join(f.baseline, "results.json");
  const result = f.run("--root", f.corpus, "--out", out, "--reuse-reference", cache);
  assert.equal(result.status, 0, result.stderr);
  const second = f.results(out);
  assert.equal(second.referenceReuse, cache);
  assert.equal(second.summary.both, 3);
  assert.deepEqual(f.reference.calls().map(args => path.basename(args[0])).sort(), ["a.tikz", "b.tikz", "new.tikz"]);
  assert.equal(f.native.calls().length, 5, "the build under test is always rendered again");
  for (const old of first.cases as Case[]) {
    const reused: Case = second.cases.find((c: Case) => c.sha256 === old.sha256);
    assert.deepEqual(reused.reference, old.reference);
    assert.ok(reused.reference.png.startsWith(f.baseline + path.sep), "reused images stay in the earlier output");
    assert.ok(reused.native.png.startsWith(out + path.sep));
  }
});

test("an input modified during the audit fails the run", { skip: SKIP }, t => {
  const f = fixture(t);
  f.write(f.corpus, "a.tikz", "A");
  f.write(f.corpus, "b.tikz", "MUTATE-native");

  const result = f.run("--root", f.corpus);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Input changed during audit: .*b\.tikz/);
  assert.equal(f.results(f.baseline).inputsUnchanged, undefined);
  assert.ok(!fs.existsSync(path.join(f.baseline, "index.html")));
});
