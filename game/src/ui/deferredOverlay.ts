import type { KeyBindingRegistry, Unregister } from "../input/keyboard.js";

interface Overlay<Detail> {
  mount(parent: HTMLElement): void;
  show(detail: Detail): void;
  update(): void;
  dispose(): void;
}

interface DeferredOverlayOptions<Detail> {
  registry: KeyBindingRegistry;
  load(): Promise<Overlay<Detail>>;
  onError(error: unknown): void;
}

/** Defers an event-driven overlay while preserving the latest request and Escape dismissal. */
export class DeferredOverlay<Detail> {
  private overlay: Overlay<Detail> | null = null;
  private loading: Promise<void> | null = null;
  private parent: HTMLElement | null = null;
  private pending: { detail: Detail; mayShow: () => boolean } | null = null;
  private popEscape: Unregister | null = null;
  private disposed = false;

  constructor(private readonly options: DeferredOverlayOptions<Detail>) {}

  mount(parent: HTMLElement): void {
    if (this.disposed) return;
    this.parent = parent;
    this.overlay?.mount(parent);
  }

  show(detail: Detail, mayShow: () => boolean): void {
    if (this.disposed) return;
    if (this.overlay) {
      this.overlay.show(detail);
      return;
    }
    this.cancelPending();
    this.pending = { detail, mayShow };
    this.popEscape = this.options.registry.pushEscapeHandler(() => {
      this.cancelPending();
      return true;
    });
    if (this.loading) return;
    this.loading = this.options.load().then((overlay) => {
      if (this.disposed) {
        overlay.dispose();
        return;
      }
      this.overlay = overlay;
      if (this.parent) overlay.mount(this.parent);
      const pending = this.pending;
      this.cancelPending();
      if (pending?.mayShow()) overlay.show(pending.detail);
    }).catch((error: unknown) => {
      this.cancelPending();
      if (!this.disposed) this.options.onError(error);
    }).finally(() => { this.loading = null; });
  }

  /** A menu or newer interaction can cancel an import without hiding an already visible report. */
  cancelPending(): void {
    this.pending = null;
    this.popEscape?.();
    this.popEscape = null;
  }

  update(): void {
    this.overlay?.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.overlay?.dispose();
    this.overlay = null;
    this.parent = null;
  }
}
