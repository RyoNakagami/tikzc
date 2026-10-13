import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** One persistent Rust process reuses fonts and shaped labels between edits. */
export class NativeWorker {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private stderr = "";
  private stopped = false;
  private pending?: { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  constructor(binary: string) {
    this.child = spawn(binary, ["--preview-server"], { windowsHide: true, stdio: "pipe" });
    this.child.unref();
    for (const pipe of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      (pipe as typeof pipe & { unref?: () => void }).unref?.();
    }
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 64 * 1024 * 1024) { this.fail(new Error("Native response exceeds 64 MiB.")); return; }
      const end = this.buffer.indexOf("\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      const job = this.pending; this.pending = undefined;
      if (!job) { this.fail(new Error("Unexpected native worker response.")); return; }
      clearTimeout(job.timer);
      try {
        const response = JSON.parse(line);
        if (response.error) job.reject(new Error(String(response.error)));
        else job.resolve(response);
      } catch (error) { job.reject(new Error(`Invalid native response: ${error}`)); this.dispose(); }
    });
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-8192); });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => this.fail(new Error(this.stderr || `Native worker exited (${code}).`)));
  }
  get alive(): boolean { return !this.stopped; }
  request(source: string, dpi: number): Promise<any> {
    if (this.stopped || this.pending) return Promise.reject(new Error("Native worker is unavailable."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Native rendering timed out.")), 60_000);
      this.pending = { resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ source, dpi }) + "\n", (error) => { if (error) this.fail(error); });
    });
  }
  private fail(error: Error): void {
    this.stopped = true;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.child.kill();
  }
  dispose(): void { this.fail(new Error("Native worker disposed.")); }
}
