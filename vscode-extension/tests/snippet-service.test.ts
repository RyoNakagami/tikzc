/*
 * Unit tests for SnippetService (vscode-extension/src/snippet-service.ts):
 * cache hits, failure caching, in-flight sharing and serialization, all with
 * an injected mock compiler — no TeX toolchain required.
 *
 * Run with:  npm test   (in vscode-extension/)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SnippetService, type SnippetRpcRequest } from "../src/snippet-service";
import { TikzCompileError, type SnippetParams } from "../../src/core";

const BASE: Omit<SnippetRpcRequest, "id"> = {
  text: "hello",
  mode: "text",
  widthBp: null,
  alignment: null,
  fontStyle: "normal",
  fontWeight: "normal",
  fontFamily: "serif",
  header: "",
};

const OK_RESULT = {
  svg: "<svg viewBox='0 0 10 10'><path d='M0 0'/></svg>",
  metrics: { wdTexPt: 72.27, htTexPt: 7.227, dpTexPt: 0 },
  log: "",
};

function req(id: string, overrides: Partial<SnippetRpcRequest> = {}): SnippetRpcRequest {
  return { ...BASE, id, ...overrides };
}

test("成功結果はキャッシュされ2回目はコンパイルされない、寸法はbpに変換される", async () => {
  let calls = 0;
  const service = new SnippetService({
    compile: async () => {
      calls += 1;
      return OK_RESULT;
    },
  });
  const [first] = await service.compileSnippets([req("a")], "", {});
  assert.equal(first.status, "ok");
  assert.ok(first.status === "ok");
  // 72.27 TeX pt = 72 bp
  assert.ok(Math.abs(first.wdBp - 72) < 1e-9);
  assert.ok(Math.abs(first.htBp - 7.2) < 1e-9);
  const [second] = await service.compileSnippets([req("b")], "", {});
  assert.equal(second.status, "ok");
  assert.equal(second.id, "b");
  assert.equal(calls, 1);
});

test("latex エラーは失敗キャッシュされ同一スニペットを再コンパイルしない", async () => {
  let calls = 0;
  const service = new SnippetService({
    compile: async () => {
      calls += 1;
      throw new TikzCompileError("Undefined control sequence", "log");
    },
  });
  const [first] = await service.compileSnippets([req("a")], "", {});
  assert.equal(first.status, "error");
  assert.ok(first.status === "error" && first.errorKind === "latex");
  const [second] = await service.compileSnippets([req("b")], "", {});
  assert.equal(second.status, "error");
  assert.equal(calls, 1);
});

test("transient エラー（タイムアウト等）はキャッシュされず再試行できる", async () => {
  let calls = 0;
  const service = new SnippetService({
    compile: async () => {
      calls += 1;
      if (calls === 1) throw new Error("spawn ENOENT");
      return OK_RESULT;
    },
  });
  const [first] = await service.compileSnippets([req("a")], "", {});
  assert.ok(first.status === "error" && first.errorKind === "transient");
  const [second] = await service.compileSnippets([req("a")], "", {});
  assert.equal(second.status, "ok");
  assert.equal(calls, 2);
});

test("同一スニペットの並行要求はインフライト共有され1回しかコンパイルされない", async () => {
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new SnippetService({
    compile: async () => {
      calls += 1;
      await gate;
      return OK_RESULT;
    },
  });
  const p1 = service.compileSnippets([req("a")], "", {});
  const p2 = service.compileSnippets([req("b")], "", {});
  release();
  const [[r1], [r2]] = await Promise.all([p1, p2]);
  assert.equal(r1.status, "ok");
  assert.equal(r2.status, "ok");
  assert.equal(r1.id, "a");
  assert.equal(r2.id, "b");
  assert.equal(calls, 1);
});

test("異なるスニペットは直列に1件ずつコンパイルされる", async () => {
  let active = 0;
  let maxActive = 0;
  const service = new SnippetService({
    compile: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return OK_RESULT;
    },
  });
  await service.compileSnippets(
    [req("a", { text: "one" }), req("b", { text: "two" }), req("c", { text: "three" })],
    "",
    {}
  );
  assert.equal(maxActive, 1);
});

test("header / defaults が違えば別キャッシュエントリになる", async () => {
  let calls = 0;
  const service = new SnippetService({
    compile: async () => {
      calls += 1;
      return OK_RESULT;
    },
  });
  await service.compileSnippets([req("a")], "", {});
  await service.compileSnippets([req("b", { header: "#| packages: [fontawesome]" })], "", {});
  await service.compileSnippets([req("c")], "", { mainfont: "IPAexGothic" });
  assert.equal(calls, 3);
});

test("request.header が空のとき fallbackHeader が使われる", async () => {
  let calls = 0;
  const service = new SnippetService({
    compile: async () => {
      calls += 1;
      return OK_RESULT;
    },
  });
  // fallbackHeader 経由と明示 header で同じプリアンブルになればキャッシュ共有される
  await service.compileSnippets([req("a")], "#| packages: [fontawesome]", {});
  await service.compileSnippets([req("b", { header: "#| packages: [fontawesome]" })], "", {});
  assert.equal(calls, 1);
});

test("タイムアウトは transient エラーとして返る", async () => {
  const service = new SnippetService({
    timeoutMs: 20,
    compile: () => new Promise(() => {}), // never resolves
  });
  const [result] = await service.compileSnippets([req("a")], "", {});
  assert.ok(result.status === "error" && result.errorKind === "transient");
  assert.match(result.message, /timed out/);
});
