/** Start asset preparation within a small budget after each painted gameplay frame. Network and
 * asynchronous decoder work can overlap; a job waiting on another asset never locks the queue. */
export class GameplayWork {
  private interactive = false;
  private scheduled = false;
  private readonly jobs: { start: () => void; priority: () => number }[] = [];

  constructor(private readonly schedule: (run: () => void) => void = afterPaint,
    private readonly now: () => number = () => performance.now()) {}

  setInteractive(value: boolean): void {
    this.interactive = value;
    if (!value) while (this.jobs.length) this.takeNext()!.start();
  }

  run<T>(work: () => T | PromiseLike<T>, priority: () => number = () => 0): Promise<T> {
    if (!this.interactive) return Promise.resolve().then(work);
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ priority, start: () => {
        try { resolve(work()); } catch (error) { reject(error); }
      } });
      this.scheduleNext();
    });
  }

  private takeNext() {
    let best = 0;
    for (let i = 1; i < this.jobs.length; i++) {
      if (this.jobs[i]!.priority() > this.jobs[best]!.priority()) best = i;
    }
    return this.jobs.splice(best, 1)[0];
  }

  private scheduleNext(): void {
    if (this.scheduled || !this.jobs.length) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      const started = this.now();
      // Cheap placement and cancelled jobs should not each cost an entire frame. An expensive
      // job gets the frame to itself; bounded starts also contain async decoder continuations.
      let count = 0;
      do { this.takeNext()?.start(); count++; }
      while (this.jobs.length && count < 8 && this.now() - started < 2);
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
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    clearTimeout(painted);
    run();
  };
  const frame = requestAnimationFrame(() => { painted = setTimeout(finish, 0); });
  // Background tabs and a stopped render loop must still finish a requested destination.
  const fallback = setTimeout(finish, 100);
}
