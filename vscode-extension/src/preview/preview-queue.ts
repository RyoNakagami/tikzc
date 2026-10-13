/** Coalesce edits, suppress stale successes/errors, and bound work to one job. */
export class PreviewQueue<T, R> {
  private revision = 0;
  private pending?: { value: T; revision: number };
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private compile: (value: T) => Promise<R>,
    private publish: (result: R) => void,
    private fail: (error: unknown) => void,
    private invalidate: () => void,
  ) {}

  update(value: T, delay: number): void {
    if (this.disposed) return;
    const revision = ++this.revision;
    this.pending = undefined;
    clearTimeout(this.timer);
    this.invalidate();
    this.timer = setTimeout(() => {
      this.pending = { value, revision };
      void this.pump();
    }, Math.max(0, delay));
  }

  dispose(): void {
    this.disposed = true;
    ++this.revision;
    clearTimeout(this.timer);
    this.pending = undefined;
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.pending && !this.disposed) {
        const job = this.pending;
        this.pending = undefined;
        try {
          const result = await this.compile(job.value);
          if (job.revision === this.revision && !this.disposed) this.publish(result);
        } catch (error) {
          if (job.revision === this.revision && !this.disposed) this.fail(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
