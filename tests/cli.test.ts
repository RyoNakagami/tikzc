/*
 * Tests for the tikzc CLI entrypoint (src/cli.ts), run as a subprocess via
 * tsx. Only the flags that exit before compilation are covered here — the
 * compile pipeline itself is exercised in vscode-extension/tests/compile.test.ts.
 *
 * Run with:  npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { version as PKG_VERSION } from "../package.json";

const execFileP = promisify(execFile);

const ROOT = path.join(__dirname, "..");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const CLI = path.join(ROOT, "src", "cli.ts");

function runCli(...args: string[]) {
  return execFileP(TSX, [CLI, ...args], { cwd: ROOT });
}

test("--version: package.json のバージョンを表示して正常終了する", async () => {
  const { stdout } = await runCli("--version");
  assert.equal(stdout, `tikzc ${PKG_VERSION}\n`);
});

test("-V: --version の短縮形として同じ出力を返す", async () => {
  const { stdout } = await runCli("-V");
  assert.equal(stdout, `tikzc ${PKG_VERSION}\n`);
});

test("--version: VERSION ファイル（bump-version.sh の正）と一致する", async () => {
  const canonical = (await fs.readFile(path.join(ROOT, "VERSION"), "utf8")).trim();
  const { stdout } = await runCli("--version");
  assert.equal(stdout.trim(), `tikzc ${canonical}`);
});

test("--version: 入力ファイルより優先され，コンパイルは走らない", async () => {
  const { stdout } = await runCli("--version", "no-such-file.tikz");
  assert.equal(stdout, `tikzc ${PKG_VERSION}\n`);
});

test("--help: バージョンフラグがヘルプに載っている", async () => {
  const { stdout } = await runCli("--help");
  assert.match(stdout, /-V, --version/);
});
