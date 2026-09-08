export interface PortalTransitionRequest {
  name: string;
  /** Load the destination before changing any authoritative player state. */
  prepare(report: (completedSteps: number, label: string) => void): Promise<void>;
  commit(): void;
  /** Resolve only after the destination has drawn behind the opaque curtain. */
  settled(): Promise<void>;
}

/** Covers a realm change until its real destination is ready to show. */
export class PortalTransition {
  private running = false;
  private generation = 0;
  private curtain: HTMLDivElement | null = null;
  private releaseKeys: (() => void) | null = null;
  private cancelLoading: (() => void) | null = null;

  constructor(private readonly lock: (locked: boolean) => void) {}

  get active(): boolean { return this.running; }

  async run(request: PortalTransitionRequest): Promise<void> {
    if (this.running) throw new Error("A passage is already loading");
    const generation = ++this.generation;
    const previousFocus = document.activeElement;
    const curtain = document.createElement("div");
    curtain.className = "portal-transition";
    curtain.dataset.phase = "closing";
    curtain.setAttribute("role", "status");
    curtain.setAttribute("aria-live", "polite");
    curtain.tabIndex = -1;
    curtain.style.cssText = "position:fixed;inset:0;z-index:100000;background:#080a0c;color:#c7c4ba;display:grid;place-items:center;opacity:0;font:16px Georgia,serif;letter-spacing:.04em;pointer-events:auto;";
    const panel = document.createElement("div");
    panel.style.cssText = "width:min(340px,calc(100vw - 48px));text-align:center;";
    const title = document.createElement("div");
    title.textContent = request.name;
    title.style.cssText = "font-size:26px;margin-bottom:24px;color:#ece5d3;";
    const label = document.createElement("div");
    label.className = "portal-loading-label";
    label.style.cssText = "font:14px system-ui,sans-serif;letter-spacing:normal;margin-bottom:12px;";
    const progress = document.createElement("progress");
    progress.max = 3;
    progress.value = 0;
    progress.setAttribute("aria-label", "Destination loading progress");
    progress.style.cssText = "width:100%;height:10px;accent-color:#bfa36c;display:block;";
    const count = document.createElement("div");
    count.style.cssText = "font:12px system-ui,sans-serif;letter-spacing:normal;color:#a7a394;margin-top:10px;";
    panel.append(title, label, progress, count);
    curtain.append(panel);
    // Count completed loading stages, not elapsed time or an estimated download percentage.
    const report = (completedSteps: number, text: string): void => {
      if (generation !== this.generation || !Number.isFinite(completedSteps)) return;
      progress.value = Math.max(progress.value, Math.min(3, Math.floor(completedSteps)));
      label.textContent = text;
      count.textContent = `${progress.value} of 3 steps complete`;
      progress.setAttribute("aria-valuetext", `${count.textContent}. ${text}`);
    };
    report(0, "Loading destination…");
    const blockKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.running = true;
    this.curtain = curtain;
    this.lock(true);
    document.body.append(curtain);
    curtain.focus({ preventScroll: true });
    window.addEventListener("keydown", blockKey, true);
    window.addEventListener("keyup", blockKey, true);
    const releaseKeys = (): void => {
      window.removeEventListener("keydown", blockKey, true);
      window.removeEventListener("keyup", blockKey, true);
    };
    this.releaseKeys = releaseKeys;
    const current = (): boolean => generation === this.generation;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const fade = async (from: number, to: number, duration: number): Promise<void> => {
      const animation = curtain.animate([{ opacity: from }, { opacity: to }], { duration, easing: "ease-in-out", fill: "forwards" });
      await animation.finished;
      curtain.style.opacity = String(to);
      animation.cancel();
    };
    try {
      // Start the I/O at once, but attach its rejection before waiting for the fade.
      const cancelled = new Promise<{ cancelled: true }>((resolve) => {
        this.cancelLoading = () => resolve({ cancelled: true });
      });
      const timeout = new Promise<{ ok: false; error: Error }>((resolve) => {
        loadTimer = setTimeout(() => resolve({ ok: false, error: new Error("The passage could not finish loading. Please try again.") }), 30_000);
      });
      const loaded = Promise.race([
        request.prepare((steps, label) => report(Math.min(2, steps), label)).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error })),
        cancelled, timeout,
      ]);
      await fade(0, 1, 280);
      if (!current()) return;
      curtain.dataset.phase = "loading";
      const result = await loaded;
      if (!current()) return;
      if ("cancelled" in result) return;
      if (!result.ok) throw result.error;
      report(2, "Preparing the view…");
      request.commit();
      await request.settled();
      if (!current()) return;
      report(3, "Ready");
      curtain.dataset.phase = "opening";
      await fade(1, 0, 360);
    } finally {
      clearTimeout(loadTimer);
      releaseKeys();
      curtain.remove();
      if (current()) {
        this.running = false;
        this.curtain = null;
        this.releaseKeys = null;
        this.cancelLoading = null;
        this.lock(false);
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      }
    }
  }

  /** Reset/import cannot complete an old destination load into the new game. */
  cancel(): void {
    if (!this.running) return;
    this.generation++;
    this.cancelLoading?.();
    this.cancelLoading = null;
    this.releaseKeys?.();
    this.releaseKeys = null;
    this.curtain?.remove();
    this.curtain = null;
    this.running = false;
    this.lock(false);
  }
}
