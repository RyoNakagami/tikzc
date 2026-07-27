/*
 * compute-worker-client.ts — page-side counterpart of compute.worker.ts.
 *
 * computeSnapshotPreferWorker() has the exact same contract as
 * computeSnapshot(); it transparently falls back to inline (main-thread)
 * compute when the Worker constructor throws (CSP, test environments) or the
 * worker later dies, so behavior degrades to the status quo instead of
 * breaking.
 */
import { computeSnapshot, setMathJaxFont, type ComputeRequest, type ComputeResponse } from "../../compute";
import type { MathJaxFont } from "tikz-editor/text/mathjax-engine";
import {
  incrementProfilingCounter,
  recordProfilingComputeTiming
} from "tikz-editor/profiling";
import type {
  ComputeWorkerRequestMessage,
  ComputeWorkerResponseMessage
} from "./compute-worker-types";

type NativeSnippetBridgeCompiler = (requests: unknown[]) => Promise<unknown[]>;

type PendingCompute = {
  resolve: (response: ComputeResponse) => void;
  reject: (error: Error) => void;
};

let nativeSnippetBridgeCompiler: NativeSnippetBridgeCompiler | null = null;
let sharedWorker: Worker | null = null;
let workerInitFailed = false;
const pendingComputes = new Map<string, PendingCompute>();

/**
 * Host integration hook: forwards the worker's native text fallback compile
 * requests (node text MathJax cannot render) to the platform's snippet
 * compiler. Without it those requests fail as transient errors and the nodes
 * render as plain text — same as an engine without native fallback.
 */
export function setComputeWorkerNativeSnippetCompiler(compiler: NativeSnippetBridgeCompiler): void {
  nativeSnippetBridgeCompiler = compiler;
}

function getWorker(): Worker | null {
  if (workerInitFailed) {
    return null;
  }
  if (sharedWorker) {
    return sharedWorker;
  }
  try {
    sharedWorker = new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" });
    sharedWorker.addEventListener("message", onWorkerMessage as EventListener);
    sharedWorker.addEventListener("error", onWorkerError as EventListener);
    return sharedWorker;
  } catch {
    workerInitFailed = true;
    return null;
  }
}

function onWorkerMessage(event: MessageEvent<ComputeWorkerResponseMessage>): void {
  const message = event.data;
  if (!message) {
    return;
  }
  if (message.type === "compute-result") {
    const pending = pendingComputes.get(message.id);
    if (!pending) {
      return;
    }
    pendingComputes.delete(message.id);
    if (message.ok) {
      pending.resolve(message.response);
    } else {
      pending.reject(new Error(message.error));
    }
    return;
  }
  if (message.type === "native-snippet-request") {
    void respondToNativeSnippetRequest(message.requestId, message.requests);
    return;
  }
  if (message.type === "profiling-counter") {
    incrementProfilingCounter(message.counter, message.amount);
    return;
  }
  if (message.type === "profiling-compute-timing") {
    recordProfilingComputeTiming(message.timing);
  }
}

async function respondToNativeSnippetRequest(requestId: string, requests: unknown[]): Promise<void> {
  const worker = sharedWorker;
  if (!worker) {
    return;
  }
  let response: ComputeWorkerRequestMessage;
  if (!nativeSnippetBridgeCompiler) {
    response = {
      type: "native-snippet-response",
      requestId,
      error: "no native snippet compiler is registered on the page"
    };
  } else {
    try {
      const results = await nativeSnippetBridgeCompiler(requests);
      response = { type: "native-snippet-response", requestId, results };
    } catch (error) {
      response = {
        type: "native-snippet-response",
        requestId,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  worker.postMessage(response);
}

function onWorkerError(): void {
  if (!sharedWorker) {
    return;
  }
  // Fail fast for waiting requests (their promises rerun inline); subsequent
  // computes use the inline fallback permanently.
  workerInitFailed = true;
  sharedWorker.terminate();
  sharedWorker = null;
  for (const [id, pending] of [...pendingComputes]) {
    pendingComputes.delete(id);
    pending.reject(new Error("compute-worker-error"));
  }
}

/** Same contract as computeSnapshot(), preferring the worker when available. */
export async function computeSnapshotPreferWorker(request: ComputeRequest): Promise<ComputeResponse> {
  const worker = getWorker();
  if (!worker) {
    return computeSnapshot(request);
  }
  try {
    return await new Promise<ComputeResponse>((resolve, reject) => {
      pendingComputes.set(request.id, { resolve, reject });
      const message: ComputeWorkerRequestMessage = { type: "compute", request };
      worker.postMessage(message);
    });
  } catch {
    // worker died or the response could not be produced — rerun inline so the
    // caller always gets a snapshot
    return computeSnapshot(request);
  }
}

/** Keep the MathJax font in sync for both the worker and the inline fallback. */
export function setComputeMathJaxFont(font: MathJaxFont): void {
  setMathJaxFont(font);
  getWorker()?.postMessage({ type: "set-mathjax-font", font } satisfies ComputeWorkerRequestMessage);
}
