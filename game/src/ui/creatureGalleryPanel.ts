import type { CreatureGallery, GalleryMotion } from "../featureLab/creatureGallery.js";

export interface CreatureGalleryPanelOptions {
  parent?: HTMLElement;
  onFrame?: (bounds: NonNullable<ReturnType<CreatureGallery["getBounds"]>>) => void;
}

/** Controls production actor setup; gallery motion never changes semantic position. */
export class CreatureGalleryPanel {
  readonly root = document.createElement("section");
  private readonly preset = document.createElement("select");
  private readonly count = document.createElement("input");
  private readonly load = document.createElement("button");
  private readonly frame = document.createElement("button");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly motionButtons: HTMLButtonElement[] = [];
  private readonly refreshTimer: number;
  private busy = false;
  private disposed = false;
  private signature = "";

  constructor(private readonly gallery: CreatureGallery, private readonly options: CreatureGalleryPanelOptions = {}) {
    this.root.id = "creature-gallery-panel";
    this.root.setAttribute("aria-label", "Creature gallery");
    this.root.style.cssText = "position:fixed;left:12px;top:78px;width:310px;max-width:calc(100vw - 24px);max-height:calc(100vh - 160px);overflow:auto;z-index:56;padding:16px;box-sizing:border-box;border:1px solid #726248;border-radius:8px;background:rgba(24,29,26,.96);color:#eee7d8;font:12px/1.5 system-ui;box-shadow:0 12px 32px #0006;";
    const heading = document.createElement("h2");
    heading.textContent = "Creature gallery";
    heading.style.cssText = "margin:0 0 12px;font:600 15px/1.3 system-ui;";
    this.preset.id = "creature-gallery-preset";
    for (const row of gallery.getCatalog()) {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = row.label;
      this.preset.append(option);
    }
    this.count.id = "creature-gallery-count";
    this.count.type = "number";
    this.count.min = "1";
    this.count.max = "64";
    this.count.step = "1";
    for (const field of [this.preset, this.count]) field.style.cssText = "display:block;width:100%;box-sizing:border-box;margin:4px 0 12px;padding:7px;background:#30382f;color:#eee7d8;border:1px solid #75684f;border-radius:4px;font:inherit;";
    this.load.id = "creature-gallery-load";
    this.load.textContent = "Load actors";
    this.load.addEventListener("click", () => { void this.invoke(async () => {
      await gallery.show(this.preset.value, Number(this.count.value));
      this.fit();
    }); });
    this.frame.id = "creature-gallery-frame";
    this.frame.textContent = "Frame actors";
    this.frame.hidden = !options.onFrame;
    this.frame.addEventListener("click", () => this.fit());
    const setup = document.createElement("div");
    setup.style.cssText = "display:flex;gap:8px;margin-bottom:12px;";
    setup.append(this.load, this.frame);
    const motions = document.createElement("div");
    motions.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:6px;";
    for (const motion of ["idle", "walk", "run", "attack", "hit"] satisfies GalleryMotion[]) {
      const button = document.createElement("button");
      button.id = `creature-gallery-${motion}`;
      button.textContent = motion.charAt(0).toUpperCase() + motion.slice(1);
      button.addEventListener("click", () => { void this.invoke(() => gallery.play(motion)); });
      this.motionButtons.push(button);
      motions.append(button);
    }
    for (const button of [this.load, this.frame, ...this.motionButtons]) {
      button.type = "button";
      button.className = "btn";
      button.style.cssText = "padding:7px 10px;font:inherit;";
    }
    this.status.id = "creature-gallery-status";
    this.status.setAttribute("role", "status");
    this.status.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0 6px;color:#c8b98e;";
    this.error.id = "creature-gallery-error";
    this.error.setAttribute("role", "alert");
    this.error.style.cssText = "white-space:pre-wrap;color:#ffb8a3;";
    this.error.hidden = true;
    const note = document.createElement("p");
    note.textContent = "Stationary production actors. Walk and run inspect skeletal cycles in place. Use one actor for texture review and a crowd for near/far animation continuity. Combat damage is tested in the combat lab.";
    note.style.cssText = "margin:10px 0 0;font-size:11px;color:#adb5a7;";
    this.root.append(heading, label("Creature", this.preset), label("Actor count · 1–64", this.count), setup, motions, this.status, this.error, note);
    (options.parent ?? document.body).append(this.root);
    this.refresh();
    this.refreshTimer = window.setInterval(() => this.refresh(), 500);
  }

  refresh(): void {
    if (this.busy || this.disposed) return;
    const state = this.gallery.getState();
    const signature = `${state.ready}:${state.presetId}:${state.count}:${state.motion}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.preset.value = state.presetId;
    this.count.value = String(state.count);
    this.status.textContent = state.ready
      ? `${state.count} production actors\n${state.assetId}\nLast motion command: ${state.motion}`
      : "Loading production actors…";
    for (const button of [...this.motionButtons, this.frame]) button.disabled = !state.ready || !state.count;
  }

  dispose(): void {
    this.disposed = true;
    window.clearInterval(this.refreshTimer);
    this.root.remove();
  }

  private async invoke(operation: () => void | Promise<void>): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.error.hidden = true;
    for (const control of [this.preset, this.count, this.load, this.frame, ...this.motionButtons]) control.disabled = true;
    try { await operation(); }
    catch (error) {
      if (!this.disposed) {
        this.error.textContent = error instanceof Error ? error.message : String(error);
        this.error.hidden = false;
      }
    } finally {
      this.busy = false;
      if (!this.disposed) {
        for (const control of [this.preset, this.count, this.load, this.frame, ...this.motionButtons]) control.disabled = false;
        this.signature = "";
        this.refresh();
      }
    }
  }

  private fit(): void {
    const bounds = this.gallery.getBounds();
    if (bounds) this.options.onFrame?.(bounds);
  }
}

function label(text: string, control: HTMLElement): HTMLLabelElement {
  const root = document.createElement("label");
  root.textContent = text;
  root.append(control);
  return root;
}
