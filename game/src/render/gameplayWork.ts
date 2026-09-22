/** Start asset preparation within a small budget after each painted gameplay frame. Network and
 * asynchronous decoder work can overlap; a job waiting on another asset never locks the queue. */
export class GameplayWork {
  private interactive = false;
  private scheduled = false;
  private pressureUntil = 0;
  private readonly jobs: { start: () => void; priority: () => number; queuedAt: number }[] = [];

  constructor(private readonly schedule: (run: () => void) => void = afterPaint,
    private readonly now: () => number = () => performance.now()) {}

  setInteractive(value: boolean): void {
    this.interactive = value;
    if (!value) {
      this.pressureUntil = 0;
      while (this.jobs.length) this.takeNext()!.start();
    }
  }

  /** Feed the measured frame interval, including CPU/GPU waits, rather than just render CPU
   * time. A slow frame gives input and drawing a short recovery window. */
  reportFrame(milliseconds: number): void {
    if (this.interactive && Number.isFinite(milliseconds) && milliseconds > 25) {
      this.pressureUntil = this.now() + 120;
    }
  }

  isUnderPressure(): boolean {
    return this.pressureUntil > 0 && this.now() < this.pressureUntil;
  }

  run<T>(work: () => T | PromiseLike<T>, priority: () => number = () => 0): Promise<T> {
    if (!this.interactive) return Promise.resolve().then(work);
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ priority, queuedAt: this.now(), start: () => {
        try { resolve(work()); } catch (error) { reject(error); }
      } });
      this.scheduleNext();
    });
  }

  /** Each iterator step must be small. Unlike run(), this splits a long computation across
   * painted frames. Promises alone do not yield to rendering, and cannot interrupt one step. */
  runSliced<T>(steps: Iterator<unknown, T>, priority: () => number = () => 0): Promise<T> {
    const advance = (): T | Promise<T> => {
      const started = this.now();
      const budget = this.isUnderPressure() ? 0.5 : 2;
      let count = 0;
      do {
        const step = steps.next();
        if (step.done) return step.value;
        count++;
      } while (count < 128 && this.now() - started < budget);
      return this.run(advance, priority);
    };
    return this.run(advance, priority);
  }

  private takeNext() {
    let best = -1;
    let bestRank = -Infinity;
    const underPressure = this.isUnderPressure();
    const now = underPressure ? this.now() : 0;
    for (let i = 0; i < this.jobs.length; i++) {
      const job = this.jobs[i]!;
      const rank = job.priority();
      // Visible/player work still progresses. Optional work gets a bounded delay, so low-end
      // machines that sustain 30 fps and hidden tabs never leave a requested asset unfinished.
      if (underPressure && rank < 2 && now - job.queuedAt < 500) continue;
      if (rank > bestRank) { best = i; bestRank = rank; }
    }
    return best < 0 ? undefined : this.jobs.splice(best, 1)[0];
  }

  private scheduleNext(): void {
    if (this.scheduled || !this.jobs.length) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      const started = this.now();
      const underPressure = this.isUnderPressure();
      const budget = underPressure ? 0.5 : 2;
      // Cheap placement and cancelled jobs should not each cost an entire frame. An expensive
      // job gets the frame to itself; bounded starts also contain async decoder continuations.
      let count = 0;
      do {
        const next = this.takeNext();
        if (!next) break;
        next.start(); count++;
      } while (this.jobs.length && count < (underPressure ? 1 : 8) && this.now() - started < budget);
      this.scheduleNext();
    });
  }
}

function afterPaint(run: () => void): void {
  let done = false;
  let painted: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    // The fallback can fire in a host that has no frame scheduler, or after a test has put its
    // stubs back, and an unguarded call there throws out of a timer where nothing can catch it.
    if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    clearTimeout(fallback);
    clearTimeout(painted);
    run();
  };
  const frame = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(() => { painted = setTimeout(finish, 0); }) : undefined;
  // Background tabs and a stopped render loop must still finish a requested destination.
  const fallback = setTimeout(finish, 100);
}
