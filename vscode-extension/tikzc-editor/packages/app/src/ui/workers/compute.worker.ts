/*
 * compute.worker.ts — runs the full compute pipeline (parse → semantic →
 * MathJax measure → SVG emit) off the main thread, so typing and IME
 * composition in the page stay responsive no matter how heavy a recompute is.
 *
 * The incremental parse/semantic sessions (module state in ../../compute) live
 * entirely inside this worker. The page talks to it through the client in
 * ./compute-worker-client.ts, which also transparently falls back to inline
 * compute when workers are unavailable.
 */
import { computeSnapshot, setMathJaxFont, type ComputeRequest, type ComputeResponse } from "../../compute";
import { registerMathJaxWorkerFontLoader } from "./mathjax-worker-fonts";
import * as textEngineModule from "tikz-editor/text/mathjax-engine";
import type {
  ComputeWorkerRequestMessage,
  ComputeWorkerResponseMessage
} from "./compute-worker-types";

registerMathJaxWorkerFontLoader();

type ComputeWorkerScope = {
  onmessage: ((event: MessageEvent<ComputeWorkerRequestMessage>) => void) | null;
  postMessage: (message: ComputeWorkerResponseMessage) => void;
};

const workerContext = self as unknown as ComputeWorkerScope;

// The worker has its own profiling module state — forward records to the page
// so the DevPanel profiling view keeps seeing compute timings.
globalThis.__TIKZ_EDITOR_PROFILING_RECORDER__ = {
  incrementCounter(counter, amount = 1) {
    workerContext.postMessage({ type: "profiling-counter", counter, amount });
  },
  recordComputeTiming(timing) {
    workerContext.postMessage({ type: "profiling-compute-timing", timing });
  },
  recordSvgPatchTiming() {},
  recordSourcePanelSyncTiming() {}
};

// Native text fallback bridge: only the VSCode build's aliased engine module
// exposes these hooks (upstream's engine has no native fallback), so both
// calls are optional. Compile requests travel worker → page → extension host.
const engineHooks = textEngineModule as {
  setNativeSnippetCompiler?: (compiler: (requests: never[]) => Promise<never[]>) => void;
  setNativeSnippetHeaderSource?: (source: string) => void;
};

let nativeRequestCounter = 0;
const pendingNativeRequests = new Map<
  string,
  { resolve: (results: unknown[]) => void; reject: (error: Error) => void }
>();

function compileNativeSnippetsViaPage(requests: unknown[]): Promise<unknown[]> {
  nativeRequestCounter += 1;
  const requestId = `native-${nativeRequestCounter}`;
  return new Promise<unknown[]>((resolve, reject) => {
    pendingNativeRequests.set(requestId, { resolve, reject });
    workerContext.postMessage({ type: "native-snippet-request", requestId, requests });
  });
}

engineHooks.setNativeSnippetCompiler?.(
  compileNativeSnippetsViaPage as unknown as (requests: never[]) => Promise<never[]>
);

/**
 * Lezer Tree instances do not survive structured clone (prototype methods are
 * lost), so the tree is dropped at the worker boundary. Main-thread consumers
 * (project named colors, DevPanel tree view) re-parse lazily when they need it.
 */
function toTransferableResponse(response: ComputeResponse): ComputeResponse {
  const parseResult = response.snapshot.parseResult;
  if (!parseResult || parseResult.tree == null) {
    return response;
  }
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      parseResult: { ...parseResult, tree: null }
    }
  };
}

async function runCompute(request: ComputeRequest): Promise<void> {
  try {
    // keep the native fallback's `#|` header in sync with the document
    engineHooks.setNativeSnippetHeaderSource?.(request.source);
    const response = await computeSnapshot(request);
    workerContext.postMessage({
      type: "compute-result",
      id: request.id,
      ok: true,
      response: toTransferableResponse(response)
    });
  } catch (error) {
    workerContext.postMessage({
      type: "compute-result",
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

workerContext.onmessage = (event: MessageEvent<ComputeWorkerRequestMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }
  if (message.type === "set-mathjax-font") {
    setMathJaxFont(message.font);
    return;
  }
  if (message.type === "native-snippet-response") {
    const pending = pendingNativeRequests.get(message.requestId);
    if (!pending) {
      return;
    }
    pendingNativeRequests.delete(message.requestId);
    if (message.error != null) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.results ?? []);
    }
    return;
  }
  if (message.type === "compute") {
    void runCompute(message.request);
  }
};
