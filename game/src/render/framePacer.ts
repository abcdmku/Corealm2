export type GpuCompletion = (() => Promise<void>) & { dispose?: () => void };

interface CompletionBackend {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: { queue: { onSubmittedWorkDone(): Promise<void> } };
  gl?: WebGL2RenderingContext;
}

/** Observe submitted work without blocking the CPU. Three's removed waitForGPU() method
 * is a stub, so native completion uses the queue itself. Construct after renderer.init(). */
export function createGpuCompletion(renderer: { backend: unknown }, timeoutMs = 30_000): GpuCompletion {
  const backend = renderer.backend as CompletionBackend;
  const queue = backend.isWebGPUBackend ? backend.device?.queue : undefined;
  const gl = backend.isWebGLBackend ? backend.gl : undefined;
  if (!queue && !gl) throw new Error('GPU completion requires an initialized rendering backend');
  let disposed = false;
  const cancellations = new Set<() => void>();
  const completion: GpuCompletion = () => new Promise<void>((resolve, reject) => {
    if (disposed) { reject(new Error('GPU completion observer is disposed')); return; }
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let fence: WebGLSync | null = null;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(pollTimer);
      cancellations.delete(cancel);
      if (fence && gl && !gl.isContextLost()) gl.deleteSync(fence);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const cancel = () => settle(new Error('GPU completion observer is disposed'));
    const timeout = setTimeout(() => settle(new Error('GPU completion timed out')), timeoutMs);
    cancellations.add(cancel);
    try {
      if (queue) {
        void queue.onSubmittedWorkDone().then(() => settle(), error => settle(error ?? new Error('GPU completion failed')));
      } else if (gl) {
        if (gl.isContextLost()) { settle(new Error('Rendering context was lost')); return; }
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!fence) { settle(new Error('Could not create GPU completion fence')); return; }
        gl.flush();
        const poll = () => {
          if (settled) return;
          try {
            if (gl.isContextLost()) { settle(new Error('Rendering context was lost')); return; }
            const status = gl.clientWaitSync(fence!, 0, 0);
            if (status === gl.WAIT_FAILED) settle(new Error('GPU completion fence failed'));
            else if (status === gl.TIMEOUT_EXPIRED) pollTimer = setTimeout(poll, 4);
            else settle();
          } catch (error) { settle(error ?? new Error('GPU completion failed')); }
        };
        pollTimer = setTimeout(poll, 0);
      }
    } catch (error) { settle(error ?? new Error('GPU completion failed')); }
  });
  completion.dispose = () => {
    disposed = true;
    for (const cancel of cancellations) cancel();
  };
  return completion;
}

/** Keep at most two gameplay frames on the GPU. Completion callbacks release slots without
 * awaiting inside the animation loop, so an overloaded GPU gets the latest player state. */
export class FramePacer {
  private pending: { submittedAt: number; id: number; completedAt?: number }[] = [];
  private recent: { id: number; at: number; ms: number }[] = [];
  private submitted = 0;
  private completed = 0;
  private skipped = 0;
  private skippedThisFrame = 0;
  private lastCompletionMs = 0;
  private maxCompletionMs = 0;
  private completedAt = 0;
  private failed = false;
  private disposed = false;
  private generation = 0;
  private activeLimit: number;
  private recoveryFrames = 0;

  constructor(private readonly completion: GpuCompletion, private readonly limit = 2,
    private readonly now = () => performance.now()) {
    if (limit !== 1 && limit !== 2) throw new Error('GPU frame limit must be one or two');
    this.activeLimit = limit;
  }

  ready(_now: number): boolean {
    if (this.failed || this.disposed) return false;
    if (this.pending.length >= this.activeLimit) {
      this.skipped++;
      this.skippedThisFrame++;
      return false;
    }
    return true;
  }

  private adapt(completionMs: number): void {
    // Keep two slots when healthy. Recover from overload after ten prompt completions.
    if (this.skippedThisFrame > 0 && completionMs > 80) {
      this.activeLimit = 1;
      this.recoveryFrames = 0;
    } else if (this.activeLimit < this.limit) {
      this.recoveryFrames = completionMs < 50 ? this.recoveryFrames + 1 : 0;
      if (this.recoveryFrames >= 10) this.activeLimit = this.limit;
    }
    this.skippedThisFrame = 0;
  }

  submit(now: number): void {
    if (this.pending.length >= this.activeLimit || this.failed || this.disposed) {
      throw new Error('Gameplay frame submitted before GPU completion');
    }
    const frame = { submittedAt: now, id: ++this.submitted, completedAt: undefined as number | undefined };
    const generation = this.generation;
    this.pending.push(frame);
    try {
      void this.completion().then(() => {
        if (this.disposed || this.failed || generation !== this.generation) return;
        frame.completedAt = this.now();
        let completionMs = 0;
        let released = 0;
        while (this.pending[0]?.completedAt !== undefined) {
          const completed = this.pending.shift()!;
          const at = Math.max(this.completedAt, completed.completedAt!);
          this.lastCompletionMs = Math.max(0, at - completed.submittedAt);
          this.maxCompletionMs = Math.max(this.maxCompletionMs, this.lastCompletionMs);
          this.completed++;
          released++;
          this.completedAt = at;
          this.recent.push({ id: completed.id, at, ms: this.lastCompletionMs });
          if (this.recent.length > this.limit) this.recent.shift();
          completionMs = Math.max(completionMs, this.lastCompletionMs);
        }
        if (released > 0) this.adapt(completionMs);
      }, () => {
        if (!this.disposed && generation === this.generation) this.failed = true;
      });
    } catch {
      this.failed = true;
    }
  }

  resetTiming(): void {
    this.skippedThisFrame = 0; this.lastCompletionMs = 0; this.maxCompletionMs = 0;
  }
  contextRestored(): void {
    this.generation++;
    this.pending = []; this.recent = []; this.failed = false; this.skippedThisFrame = 0; this.lastCompletionMs = 0;
    this.activeLimit = this.limit; this.recoveryFrames = 0;
  }
  pressureMs(now: number): number { return Math.max(this.lastCompletionMs, this.pendingMs(now)); }
  pendingMs(now: number): number { return this.pending.length ? Math.max(0, now - this.pending[0]!.submittedAt) : 0; }
  snapshot(now: number) {
    return { submitted: this.submitted, completed: this.completed, skipped: this.skipped,
      pending: this.pending.length, limit: this.activeLimit, pendingMs: this.pendingMs(now), recent: this.recent.map(frame => ({ ...frame })),
      lastCompletionMs: this.lastCompletionMs, maxCompletionMs: this.maxCompletionMs, completedAt: this.completedAt,
      failed: this.failed };
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pending = [];
    this.completion.dispose?.();
  }
}

/** Apply the selected resolution equally on phones and desktop, up to the existing 2x DPR limit. */
export function gameplayPixelRatio(dpr: number, preference: number): number {
  return Math.min(dpr, 2) * preference;
}
