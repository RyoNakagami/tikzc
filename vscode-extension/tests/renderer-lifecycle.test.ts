import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setImmediate as flush } from "node:timers/promises";
import type { RustRenderer, RenderArtifact } from "../src/preview/renderer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const code = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/preview/renderer.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs",
  external: ["./worker", "node:child_process"], write: false,
}).outputFiles[0].text;
const request = { binary: "mock-tikzc", source: "\\node {A};", dpi: 150 };
const version = { stdout: "tikzc 1.1.0", stderr: "" };
const artifact: RenderArtifact = { svg: "<svg/>", png: Buffer.from([1]) };

function harness() {
  const versions: { signal?: AbortSignal; job: ReturnType<typeof deferred<typeof version>> }[] = [];
  const workers: NativeWorker[] = [];
  const timers: { callback(): void; cleared: boolean; unref(): void }[] = [];
  const execFile = Object.assign(() => {}, {
    [promisify.custom]: (_binary: string, _args: string[], options: { signal?: AbortSignal }) => {
      const job = deferred<typeof version>();
      versions.push({ signal: options.signal, job });
      // Deliberately let callbacks arrive after cancellation to test races.
      return job.promise;
    },
  });
  class NativeWorker {
    alive = true;
    jobs: ReturnType<typeof deferred<RenderArtifact>>[] = [];
    constructor() { workers.push(this); }
    request() {
      const job = deferred<RenderArtifact>();
      this.jobs.push(job);
      return job.promise;
    }
    dispose() { this.alive = false; }
  }
  const module = { exports: {} as { RustRenderer: typeof RustRenderer } };
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    module, exports: module.exports, Buffer, AbortController,
    setTimeout: (callback: () => void) => {
      const timer = { callback, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer?: typeof timers[number]) => { if (timer) timer.cleared = true; },
    require: (name: string) => name === "./worker" ? { NativeWorker }
      : name === "node:child_process" ? { execFile } : require(name),
  });
  return { renderer: new module.exports.RustRenderer(), versions, workers, timers };
}

test("dispose cancels requests that have not started", async () => {
  const h = harness();
  const result = assert.rejects(h.renderer.render(request), /cancelled/);
  h.renderer.dispose();
  await result;
  assert.equal(h.versions.length, 0);
  assert.equal(h.workers.length, 0);
  assert.equal(h.timers.length, 0);
});

test("dispose during version check prevents stale worker creation and permits immediate reopening", async () => {
  const h = harness();
  const old = assert.rejects(h.renderer.render(request), /cancelled/);
  const queued = assert.rejects(h.renderer.render({ ...request, source: "queued" }), /cancelled/);
  await flush();
  h.renderer.dispose();
  assert.equal(h.versions[0].signal?.aborted, true, "cancel the version subprocess too");
  const fresh = h.renderer.render(request);
  await flush();
  assert.equal(h.versions.length, 2, "reopening does not wait for the old version check");
  h.versions[1].job.resolve(version);
  await flush();
  h.workers[0].jobs[0].resolve(artifact);
  await fresh;
  h.versions[0].job.resolve(version);
  await Promise.all([old, queued]);
  assert.equal(h.workers.length, 1, "the old check never starts a worker");
  assert.equal(h.workers[0].alive, true);
  assert.equal(h.timers.length, 1);
  assert.equal(h.renderer.render(request), fresh, "stale failures do not evict the new cache entry");
  h.renderer.dispose();
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`late ${outcome} after disposal cannot affect the reopened renderer`, async () => {
    const h = harness();
    const old = assert.rejects(h.renderer.render(request), /cancelled/);
    await flush();
    h.versions[0].job.resolve(version);
    await flush();
    h.renderer.dispose();
    assert.equal(h.workers[0].alive, false);
    const fresh = h.renderer.render(request);
    await flush();
    h.versions[1].job.resolve(version);
    await flush();
    h.workers[1].jobs[0].resolve(artifact);
    await fresh;
    if (outcome === "resolve") h.workers[0].jobs[0].resolve(artifact);
    else h.workers[0].jobs[0].reject(new Error("old worker failed"));
    await old;
    assert.equal(h.timers.length, 1, "old completion does not install an idle timer");
    assert.equal(h.workers[1].alive, true);
    assert.equal(h.renderer.render(request), fresh);
    h.renderer.dispose();
  });
}

test("an old idle callback cannot stop a new worker", async () => {
  const h = harness();
  const old = h.renderer.render(request);
  await flush();
  h.versions[0].job.resolve(version);
  await flush();
  h.workers[0].jobs[0].resolve(artifact);
  await old;
  h.renderer.dispose();
  assert.equal(h.timers[0].cleared, true);
  const fresh = h.renderer.render(request);
  await flush();
  h.versions[1].job.resolve(version);
  await flush();
  h.timers[0].callback();
  assert.equal(h.workers[1].alive, true);
  h.workers[1].jobs[0].resolve(artifact);
  await fresh;
  h.renderer.dispose();
});
