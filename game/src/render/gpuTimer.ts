interface TimestampRenderer {
  hasFeature(name: string): boolean;
  resolveTimestampsAsync(type: 'render'): Promise<number | undefined>;
}

/** Resolve the renderer's timestamps asynchronously. Construct after renderer.init() with
 * trackTimestamp enabled. The result covers all render passes in the latest resolved frame. */
export class GpuTimer {
  private readonly supported: boolean;
  private pending = false;
  private active = false;
  private disposed = false;
  private frame = 0;
  private milliseconds: number | null = null;
  private completed = 0;

  constructor(private readonly renderer: TimestampRenderer,
    private readonly intervalFrames = 10, private readonly phase = 0) {
    this.supported = renderer.hasFeature('timestamp-query');
  }

  begin(): void {
    if (!this.supported || this.disposed || this.active) return;
    this.active = this.frame++ % this.intervalFrames === this.phase && !this.pending;
  }

  end(): void {
    if (!this.active || this.disposed) return;
    this.active = false;
    this.pending = true;
    try {
      void this.renderer.resolveTimestampsAsync('render').then(ms => {
        if (this.disposed) return;
        this.pending = false;
        if (ms !== undefined && Number.isFinite(ms) && ms >= 0) {
          this.milliseconds = ms;
          this.completed++;
        }
      }, () => {
        if (!this.disposed) { this.pending = false; this.milliseconds = null; }
      });
    } catch {
      this.pending = false;
      this.milliseconds = null;
    }
  }

  snapshot(): { supported: boolean; milliseconds: number | null; completed: number; pending: number } {
    return { supported: this.supported, milliseconds: this.milliseconds, completed: this.completed, pending: Number(this.pending) };
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.pending = false;
  }
}
