/** Keep a bounded pair of gameplay frames on the GPU. A busy GPU gets the newest state next,
 * rather than a queue of old camera/player poses. All waits have a zero timeout. */
export class FramePacer {
  private pending: { fence: WebGLSync; submittedAt: number; id: number }[] = [];
  private recent: { id: number; at: number; ms: number }[] = [];
  private submitted = 0;
  private completed = 0;
  private skipped = 0;
  private skippedThisFrame = 0;
  private lastCompletionMs = 0;
  private maxCompletionMs = 0;
  private completedAt = 0;
  private slowFrames = 0;
  private scale = 1;
  private lastReductionAt = -Infinity;
  private failed = false;
  private activeLimit: number;
  private recoveryFrames = 0;

  constructor(private readonly gl: WebGL2RenderingContext, private readonly limit = 2) { this.activeLimit = limit; }

  ready(now: number): boolean {
    if (this.failed || this.gl.isContextLost()) return false;
    let completionMs = 0;
    while (this.pending.length) {
      const frame = this.pending[0]!;
      const status = this.gl.clientWaitSync(frame.fence, 0, 0);
      if (status === this.gl.TIMEOUT_EXPIRED) break;
      this.gl.deleteSync(frame.fence);
      this.pending.shift();
      if (status === this.gl.WAIT_FAILED) { this.failed = true; return false; }
      this.lastCompletionMs = Math.max(0, now - frame.submittedAt);
      this.maxCompletionMs = Math.max(this.maxCompletionMs, this.lastCompletionMs);
      this.completed++;
      this.completedAt = now;
      this.recent.push({ id: frame.id, at: now, ms: this.lastCompletionMs });
      if (this.recent.length > this.limit) this.recent.shift();
      completionMs = Math.max(completionMs, this.lastCompletionMs);
    }
    if (completionMs > 0) this.adapt(now, completionMs);
    if (this.pending.length >= this.activeLimit) {
      this.skipped++;
      this.skippedThisFrame++;
      return false;
    }
    return true;
  }

  private adapt(now: number, completionMs: number): void {
    // Two slots preserve 60 Hz on healthy browsers. During overload, an extra unfinished
    // image only adds input latency. Recover the second slot after ten prompt completions.
    if (this.skippedThisFrame > 0 && completionMs > 80) {
      this.activeLimit = 1;
      this.recoveryFrames = 0;
    } else if (this.activeLimit < this.limit) {
      this.recoveryFrames = completionMs < 50 ? this.recoveryFrames + 1 : 0;
      if (this.recoveryFrames >= 10) this.activeLimit = this.limit;
    }
    // Polling cadence includes CPU work and vsync. Only repeated missed opportunities or
    // a severe completion delay reduce resolution; a single 30 FPS callback does not.
    this.slowFrames = this.skippedThisFrame > 0 && completionMs > 35 ? this.slowFrames + 1 : 0;
    if (((this.skippedThisFrame > 0 && completionMs > 80) || this.slowFrames >= 3)
      && now - this.lastReductionAt >= 2_000) {
      this.scale = Math.max(0.5, this.scale * (completionMs > 80 ? 0.75 : 0.85));
      // Resizing recreates postprocess targets. Do not mistake that one-off work for
      // another sustained overload and cascade immediately to the minimum resolution.
      this.lastReductionAt = now;
      this.slowFrames = 0;
    }
    this.skippedThisFrame = 0;
  }

  submit(now: number): void {
    if (this.pending.length >= this.activeLimit || this.failed) throw new Error('Gameplay frame submitted before GPU completion');
    const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) { this.failed = true; return; }
    this.submitted++;
    this.pending.push({ fence, submittedAt: now, id: this.submitted });
    // The requestAnimationFrame boundary flushes this fence. Do not finish/wait on the CPU.
  }

  resolutionScale(): number { return this.scale; }
  resetResolution(): void { this.scale = 1; this.slowFrames = 0; this.lastReductionAt = -Infinity; }
  resetTiming(): void {
    this.skippedThisFrame = 0; this.slowFrames = 0; this.lastCompletionMs = 0; this.maxCompletionMs = 0;
  }
  contextRestored(): void {
    // Objects from a lost context are already invalid; do not query or delete the old fence.
    this.pending = []; this.recent = []; this.failed = false; this.skippedThisFrame = 0; this.lastCompletionMs = 0;
    this.activeLimit = this.limit; this.recoveryFrames = 0;
  }
  pressureMs(now: number): number { return Math.max(this.lastCompletionMs, this.pendingMs(now)); }
  pendingMs(now: number): number { return this.pending.length ? Math.max(0, now - this.pending[0]!.submittedAt) : 0; }
  snapshot(now: number) {
    return { submitted: this.submitted, completed: this.completed, skipped: this.skipped,
      pending: this.pending.length, limit: this.activeLimit, pendingMs: this.pendingMs(now), recent: this.recent.map(frame => ({ ...frame })),
      lastCompletionMs: this.lastCompletionMs, maxCompletionMs: this.maxCompletionMs, completedAt: this.completedAt,
      resolutionScale: this.scale, failed: this.failed };
  }
  dispose(): void { for (const frame of this.pending) this.gl.deleteSync(frame.fence); this.pending = []; }
}

/** High-DPI phones need a bounded drawing buffer even with older saved graphics preferences. */
export function gameplayPixelRatio(dpr: number, preference: number, mobile: boolean, adaptive = 1): number {
  return Math.min(Math.min(dpr, 2) * preference, mobile ? 1.25 : 2) * adaptive;
}
