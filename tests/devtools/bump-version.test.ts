import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const MANAGED = [
  "VERSION", "package.json", "package-lock.json",
  "vscode-extension/package.json", "vscode-extension/package-lock.json",
  "plugins/tikzc/.claude-plugin/plugin.json", "plugins/tikzc/.codex-plugin/plugin.json",
  "Cargo.toml", "Cargo.lock",
];

function fixture(t: TestContext) {
  // Spaces and quotes exercise paths passed through the shell entry point.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tikzc version's "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of [...MANAGED, "devtools/bump-version.sh", "devtools/bump-version.mjs"]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), target);
  }
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const run = (...args: string[]) => spawnSync("bash", [path.join(root, "devtools/bump-version.sh"), ...args], {
    cwd: os.tmpdir(), encoding: "utf8",
  });
  const snapshot = () => MANAGED.map(file => fs.existsSync(path.join(root, file)) ? read(file) : null);
  return { root, read, write, run, snapshot };
}

test("bump updates npm and Cargo together, preserving dependencies, formatting and independent versions", t => {
  const f = fixture(t);
  const original = f.read("VERSION").trim();
  const next = "2.7.13-rc.1+build.04";
  const cargo = f.read("Cargo.toml");
  const lock = f.read("Cargo.lock");
  // A nested version before the root version must not be changed.
  f.write("package.json", `{
  "metadata": { "version": "9.8.7" },
  "name": "tikzc",
  "version": "${original}",
  "files": [
    "dist/"
  ]
}\n`);
  const pkg = f.read("package.json");
  f.write("vscode-extension/vendor/package.json", '{"version":"9.8.7"}\n');
  f.write("CHANGELOG.md", "## [0.1.0] - 2020-01-01\n");
  const result = f.run("v" + next);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read("VERSION"), next + "\n");
  assert.equal(f.read("package.json"), pkg.replace(`"version": "${original}"`, `"version": "${next}"`));
  assert.equal(f.read("Cargo.toml"), cargo.replace(`version = "${original}"`, `version = "${next}"`));
  assert.equal(f.read("Cargo.lock"), lock.replace(/(name = "tikzc"\r?\nversion = ")[^"]+/, (_, prefix) => prefix + next));
  for (const file of ["package-lock.json", "vscode-extension/package-lock.json"]) {
    const before = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
    before.version = next;
    before.packages[""].version = next;
    assert.deepEqual(JSON.parse(f.read(file)), before);
  }
  assert.equal(JSON.parse(f.read("vscode-extension/package.json")).version, next);
  assert.equal(f.read("vscode-extension/vendor/package.json"), '{"version":"9.8.7"}\n');
  assert.equal(f.read("CHANGELOG.md"), "## [0.1.0] - 2020-01-01\n");
  assert.equal(f.run("--check").status, 0);
  const bumped = f.snapshot();
  assert.equal(f.run(next).status, 0);
  assert.deepEqual(f.snapshot(), bumped, "repeating a bump is idempotent");
});

test("--check is read-only and detects every managed version field", t => {
  const f = fixture(t);
  const before = f.snapshot();
  assert.equal(f.run("--check").status, 0);
  assert.deepEqual(f.snapshot(), before);
  for (const file of MANAGED.slice(1)) {
    const text = f.read(file);
    if (file.endsWith(".json")) {
      const data = JSON.parse(text);
      data.version = "8.7.6";
      f.write(file, JSON.stringify(data));
    } else {
      f.write(file, text.replace(/(name = "tikzc"\r?\nversion = ")[^"]+/, (_, prefix) => prefix + "8.7.6"));
    }
    const snapshot = f.snapshot();
    const result = f.run("--check");
    assert.equal(result.status, 1, file);
    assert.ok(result.stdout.includes(`MISMATCH ${file}#`), result.stdout);
    assert.deepEqual(f.snapshot(), snapshot);
    f.write(file, text);
    if (file.endsWith("package-lock.json")) {
      const data = JSON.parse(text);
      data.packages[""].version = "8.7.6";
      f.write(file, JSON.stringify(data));
      assert.equal(f.run("--check").status, 1, `${file} root package`);
      f.write(file, text);
    }
  }
});

test("bad arguments and invalid SemVer never write files", t => {
  const f = fixture(t);
  const before = f.snapshot();
  const badArgs = [[], ["1.2.3", "extra"], ["--check", "extra"], ["--help", "extra"],
    ...["1.2", "01.2.3", "1.02.3", "1.2.03", "1.2.3.4", "1.2.3-01", "1.2.3-rc..1", "1.2.3+", "1.2.3\n", "vv1.2.3", "--unknown"].map(x => [x])];
  for (const args of badArgs) {
    const result = f.run(...args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.deepEqual(f.snapshot(), before);
  }
  for (const arg of ["--help", "-h"]) {
    assert.equal(f.run(arg).status, 0);
    assert.deepEqual(f.snapshot(), before);
  }
});

test("missing or malformed targets fail before any file is updated", t => {
  const f = fixture(t);
  const cases = [
    ["Cargo.lock", null],
    ["Cargo.lock", 'version = 4\n[[package]]\nname = "other"\nversion = "1.2.3"\n'],
    ["Cargo.toml", '[package]\nname = "tikzc"\nversion.workspace = true\n'],
    ["vscode-extension/package.json", "{broken"],
    ["vscode-extension/package-lock.json", '{"version":"1.2.3","packages":{}}'],
    ["VERSION", "not-a-version\n"],
  ] as const;
  for (const [file, broken] of cases) {
    const original = f.read(file);
    if (broken === null) fs.unlinkSync(path.join(f.root, file));
    else f.write(file, broken);
    const before = f.snapshot();
    for (const arg of ["--check", "2.7.13"]) {
      const result = f.run(arg);
      assert.equal(result.status, 1, file);
      assert.ok(result.stderr.includes(file), result.stderr);
      assert.deepEqual(f.snapshot(), before);
    }
    f.write(file, original);
  }
});

test("Cargo updates tolerate comments and CRLF, leaving registry packages untouched", t => {
  const f = fixture(t);
  const current = f.read("VERSION").trim();
  const manifest = `[package] # CLI\r\nname = 'tikzc'\r\nversion = '${current}' # release\r\nrust-version = '1.92'\r\n\r\n[dependencies]\r\nother = '1.0.0'\r\n`;
  const lock = `version = 4\n[[package]]\nname = "tikzc"\nversion = "0.1.0"\nsource = "registry+https://example.invalid"\n\n[[package]]\nname = "tikzc"\nversion = "${current}"\n`;
  f.write("Cargo.toml", manifest);
  f.write("Cargo.lock", lock);
  const result = f.run("2.7.13");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.read("Cargo.toml"), manifest.replace(`version = '${current}'`, "version = '2.7.13'"));
  assert.equal(f.read("Cargo.lock"), lock.replace(`version = "${current}"`, 'version = "2.7.13"'));
  assert.equal(f.run("--check").status, 0);
});
