/*
 * snippet-service.ts — extension-host service behind the webview
 * "latex.compileSnippet" RPC (native text fallback for node text the
 * embedded editor's MathJax engine cannot render).
 *
 * Wraps src/core's buildSnippetTex()/compileSnippetToSvg() with:
 *   - success LRU cache keyed by sha1 of the built document (so header /
 *     defaults changes naturally miss)
 *   - failure cache with TTL (mid-typing invalid TeX must not recompile
 *     on every keystroke)
 *   - in-flight de-duplication (parallel requests share one compile)
 *   - concurrency 1 (never saturate the machine with lualatex processes)
 *   - per-snippet timeout reported as a transient error (retryable)
 *
 * vscode-independent so it can be unit-tested with an injected compiler.
 */

import { createHash } from "node:crypto";
import {
  buildSnippetTex,
  compileSnippetToSvg,
  TikzCompileError,
  type SnippetParams,
  type TikzOptions,
} from "../../src/core";

/** TeX pt (72.27/in) -> bp (72/in), the embedded editor's pt unit */
const PT_TO_BP = 72 / 72.27;

const SUCCESS_CACHE_LIMIT = 200;
const FAILURE_CACHE_LIMIT = 100;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60 * 1000;

/** wire shape sent by the webview (structurally mirrored there) */
export type SnippetRpcRequest = SnippetParams & {
  id: string;
  /** `#|` header lines of the current document ("" = host fallback) */
  header: string;
};

export type SnippetRpcResult =
  | { id: string; status: "ok"; svg: string; wdBp: number; htBp: number; dpBp: number }
  | { id: string; status: "error"; message: string; errorKind: "latex" | "transient" };

type SuccessEntry = { svg: string; wdBp: number; htBp: number; dpBp: number };
type FailureEntry = { message: string; at: number };

type SnippetCompiler = typeof compileSnippetToSvg;

function setCapped<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export class SnippetService {
  private readonly successCache = new Map<string, SuccessEntry>();
  private readonly failureCache = new Map<string, FailureEntry>();
  private readonly inflight = new Map<string, Promise<SnippetRpcResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly compile: SnippetCompiler;
  private readonly timeoutMs: number;

  constructor(options: { compile?: SnippetCompiler; timeoutMs?: number } = {}) {
    this.compile = options.compile ?? compileSnippetToSvg;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Compile a batch sequentially (concurrency 1 across all callers).
   * `fallbackHeader` replaces an empty request header (the linked .tikz
   * document text on the host); `defaults` come from workspace settings.
   */
  async compileSnippets(
    requests: SnippetRpcRequest[],
    fallbackHeader: string,
    defaults: TikzOptions
  ): Promise<SnippetRpcResult[]> {
    return Promise.all(
      requests.map((request) => this.compileOne(request, fallbackHeader, defaults))
    );
  }

  private compileOne(
    request: SnippetRpcRequest,
    fallbackHeader: string,
    defaults: TikzOptions
  ): Promise<SnippetRpcResult> {
    const header = request.header.length > 0 ? request.header : fallbackHeader;
    const tex = buildSnippetTex(request, header, defaults);
    const hash = createHash("sha1").update(tex).digest("hex");

    const cached = this.successCache.get(hash);
    if (cached) {
      setCapped(this.successCache, hash, cached, SUCCESS_CACHE_LIMIT); // LRU touch
      return Promise.resolve({ id: request.id, status: "ok", ...cached });
    }
    const failed = this.failureCache.get(hash);
    if (failed && Date.now() - failed.at < FAILURE_TTL_MS) {
      return Promise.resolve({
        id: request.id,
        status: "error",
        message: failed.message,
        errorKind: "latex",
      });
    }

    const running = this.inflight.get(hash);
    if (running) {
      return running.then((result) => ({ ...result, id: request.id }));
    }

    const task = this.enqueue(() => this.runCompile(request.id, hash, tex));
    this.inflight.set(hash, task);
    void task.finally(() => {
      this.inflight.delete(hash);
    });
    return task;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  private async runCompile(id: string, hash: string, tex: string): Promise<SnippetRpcResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`snippet compile timed out after ${this.timeoutMs}ms`)),
          this.timeoutMs
        );
      });
      const result = await Promise.race([this.compile(tex), timeout]);
      const entry: SuccessEntry = {
        svg: result.svg,
        wdBp: result.metrics.wdTexPt * PT_TO_BP,
        htBp: result.metrics.htTexPt * PT_TO_BP,
        dpBp: result.metrics.dpTexPt * PT_TO_BP,
      };
      setCapped(this.successCache, hash, entry, SUCCESS_CACHE_LIMIT);
      return { id, status: "ok", ...entry };
    } catch (e) {
      if (e instanceof TikzCompileError) {
        const message = e.message;
        setCapped(this.failureCache, hash, { message, at: Date.now() }, FAILURE_CACHE_LIMIT);
        return { id, status: "error", message, errorKind: "latex" };
      }
      return {
        id,
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        errorKind: "transient",
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
