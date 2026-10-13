import { NativeWorker } from "./worker";
import type { EditingMetadata } from "./editing";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const INSTALL_COMMAND = '"cargo install --git https://github.com/RyoNakagami/tikzc tikzc --locked"';
const INSTALL = `Install the Rust version with ${INSTALL_COMMAND}, or set tikzc.nativePath to its executable.`;
const cannotRun = (binary: string, error: unknown) => `Cannot run Rust tikzc (${binary}). ${INSTALL} ${error instanceof Error ? error.message : String(error)}`;
const notTikzc = (binary: string) => `The selected executable (${binary}) is not tikzc. ${INSTALL}`;
const tooOld = (binary: string, found: string) => `tikzc ${found} (${binary}) is older than 1.0.0, the first version this extension supports (earlier builds, including the removed TeX-based npm CLI, have no preview server). ${INSTALL}`;
const majorMinor = (version: string) => /^(\d+\.\d+)\./.exec(version)?.[1];
export interface RenderRequest {
  binary: string;
  source: string;
  dpi: number;
  mainfont?: string;
  packages?: string[];
  libraries?: string[];
}
export interface RenderArtifact {
  svg: string;
  png: Buffer;
  editing?: EditingMetadata;
}

/** One compilation produces both exports; the preview displays these exact bytes. */
export class RustRenderer {
  private cache = new Map<string, Promise<RenderArtifact>>();
  private worker?: NativeWorker;
  private binary = "";
  private tail: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private warned = new Set<string>();
  /** A binary whose major.minor differs from the extension still renders; `warn` reports it once per binary. */
  constructor(private extensionVersion?: string, private warn?: (message: string) => void) {}
  dispose(): void { clearTimeout(this.idle); this.worker?.dispose(); this.worker = undefined; this.cache.clear(); }
  render(request: RenderRequest): Promise<RenderArtifact> {
    const key = JSON.stringify(request);
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const result = this.tail.then(() => this.renderFresh(request));
    this.tail = result.catch(() => {});
    this.cache.set(key, result);
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
    void result.catch(() => { if (this.cache.get(key) === result) this.cache.delete(key); });
    return result;
  }
  private checkVersion(binary: string, output: string): void {
    const found = /^tikzc (\S+)/.exec(output)?.[1] ?? "", expected = this.extensionVersion ?? "";
    if (!majorMinor(found) || !majorMinor(expected) || majorMinor(found) === majorMinor(expected) || this.warned.has(binary)) return;
    this.warned.add(binary);
    this.warn?.(`tikzc ${found} (${binary}) does not match extension ${expected}. Reinstall it with ${INSTALL_COMMAND}.`);
  }
  private async renderFresh(request: RenderRequest): Promise<RenderArtifact> {
    const {source, prefix} = prepareSource(request);
    clearTimeout(this.idle);
    if (this.binary !== request.binary || !this.worker?.alive) {
      this.worker?.dispose();
      let version;
      try {
        version = await run(request.binary, ["--version"], { timeout: 60_000, maxBuffer: 1024*1024, windowsHide: true });
      } catch (error) {
        throw new Error(cannotRun(request.binary, error));
      }
      const found = /^tikzc ((\d+)\.\S*)/.exec(version.stdout);
      if (!found) throw new Error(notTikzc(request.binary));
      // Every tikzc from 1.0.0 on is accepted; only pre-1.0 builds are refused.
      if (Number(found[2]) < 1) throw new Error(tooOld(request.binary, found[1]));
      this.checkVersion(request.binary, version.stdout);
      this.binary = request.binary; this.worker = new NativeWorker(request.binary);
    }
    try {
      const result = await this.worker.request(source, request.dpi);
      const editing = result.editing as EditingMetadata | undefined;
      if (editing) {
        const bytes = Buffer.from(source, "utf8");
        const offset = (n: number) => bytes.subarray(0,n).toString("utf8").length-prefix.length;
        editing.nodes = editing.nodes.filter(n => offset(n.start) >= 0).map(n => ({...n, id: offset(n.id), start: offset(n.start), labelStart: offset(n.labelStart), end: offset(n.end), objectId: n.objectId == null ? undefined : offset(n.objectId)}));
        if (editing.objects) editing.objects = editing.objects.map(o => ({...o,id:offset(o.id),start:offset(o.start),end:offset(o.end),endpoints:o.endpoints?.map(p=>({...p,start:offset(p.start),end:offset(p.end)})),pathPoints:o.pathPoints?.map(p=>({...p,start:offset(p.start),end:offset(p.end)})),pathNormalizations:o.pathNormalizations?.map(p=>({...p,start:offset(p.start),end:offset(p.end)}))}));
        if (editing.insertionOffset != null) editing.insertionOffset = offset(editing.insertionOffset);
      }
      return {svg: result.svg, png: Buffer.from(result.png), editing};
    } catch (error) {
      throw new Error(String(error).replace(/document\.tikz:(\d+):(\d+):/, (_, line: string, column: string) => `document.tikz:${Math.max(1, Number(line)-prefix.split("\n").length+1)}:${column}:`));
    } finally {
      this.idle = setTimeout(() => { this.worker?.dispose(); this.worker = undefined; }, 60_000); this.idle.unref();
    }
  }
}

function prepareSource(request: RenderRequest): {source: string; prefix: string} {
  if (!Number.isFinite(request.dpi) || request.dpi <= 0) throw new Error("PNG DPI must be finite and positive.");
  const headers: string[] = [];
  for (const [key,value] of [["mainfont",request.mainfont],["packages",request.packages?.join(", ")],["libraries",request.libraries?.join(", ")]]) {
    if (!value) continue;
    if (/[\r\n]/.test(value)) throw new Error(`Invalid newline in ${key} setting.`);
    headers.push(`#| ${key}: ${value}`);
  }
  const prefix = headers.length ? headers.join("\n")+"\n" : "";
  return {source: prefix+request.source, prefix};
}
