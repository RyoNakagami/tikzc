import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as tick } from "node:timers/promises";
import { PreviewQueue } from "../src/preview/preview-queue";

test("rapid edits and document switches suppress stale results and errors", async () => {
  const jobs: { value: string; resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  const published: string[] = [];
  const errors: unknown[] = [];
  let invalidated = 0;
  const queue = new PreviewQueue<string, string>(
    (value) => new Promise((resolve, reject) => jobs.push({ value, resolve, reject })),
    (result) => published.push(result), (error) => errors.push(error), () => { invalidated++; },
  );
  queue.update("a", 0); await tick(10);
  queue.update("b", 0); queue.update("c", 0); await tick(10);
  assert.equal(jobs.length, 1);
  jobs[0].resolve("obsolete a"); await tick(10);
  assert.deepEqual(published, []);
  assert.equal(jobs[1].value, "c");
  queue.update("d", 0); await tick(10);
  jobs[1].reject(new Error("obsolete c")); await tick(10);
  assert.deepEqual(errors, []);
  jobs[2].resolve("current d"); await tick(10);
  assert.deepEqual(published, ["current d"]);
  queue.update("bad", 0); await tick(10);
  jobs[3].reject(new Error("current error")); await tick(10);
  assert.equal(errors.length, 1);
  assert.equal(invalidated, 5);
  queue.dispose();
});

test("disposing a panel suppresses in-flight completion and pending work", async () => {
  let complete!: (value: string) => void;
  let calls = 0;
  const results: string[] = [];
  const queue = new PreviewQueue<string, string>(() => { calls++; return new Promise((resolve) => { complete = resolve; }); },
    (result) => results.push(result), () => assert.fail("disposed error"), () => {});
  queue.update("a", 0); await tick(10);
  queue.update("b", 0); queue.dispose(); complete("a"); await tick(10);
  queue.update("c", 0); await tick(10);
  assert.equal(calls, 1); assert.deepEqual(results, []);
});
