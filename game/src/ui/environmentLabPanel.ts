import type { EnvironmentWorkbench } from "../featureLab/environment.js";

export interface EnvironmentLabPanelOptions {
  parent?: HTMLElement;
  onFrame?: (bounds: NonNullable<ReturnType<EnvironmentWorkbench["getBounds"]>>, detail?: boolean) => void;
}

/** Optional authoring overlay; the scene and every asset remain production-owned. */
export class EnvironmentLabPanel {
  readonly root = document.createElement("section");
  private readonly mode = document.createElement("select");
  private readonly selection = document.createElement("select");
  private readonly foliageControls = document.createElement("div");
  private readonly layout = document.createElement("select");
  private readonly count = document.createElement("input");
  private readonly span = document.createElement("input");
  private readonly variants = document.createElement("input");
  private readonly load = document.createElement("button");
  private readonly frame = document.createElement("button");
  private readonly detail = document.createElement("button");
  private readonly info = document.createElement("p");
  private readonly status = document.createElement("p");
  private readonly error = document.createElement("p");
  private readonly catalog;
  private busy = false;
  private disposed = false;
  private signature = "";
  private readonly refreshTimer: number;

  constructor(private readonly workbench: EnvironmentWorkbench, private readonly options: EnvironmentLabPanelOptions = {}) {
    this.catalog = workbench.getCatalog();
    this.root.id = "environment-lab-panel";
    this.root.setAttribute("aria-label", "Environment workbench");
    this.root.style.cssText = "position:fixed;left:12px;bottom:76px;width:320px;max-width:calc(100vw - 24px);max-height:calc(100vh - 160px);overflow:auto;z-index:55;padding:16px;box-sizing:border-box;border:1px solid #726248;border-radius:8px;background:rgba(24,29,26,.96);color:#eee7d8;font:12px/1.5 system-ui;box-shadow:0 12px 32px #0006;";
    const heading = document.createElement("h2");
    heading.textContent = "Environment workbench";
    heading.style.cssText = "margin:0 0 12px;font:600 15px/1.3 system-ui;";
    this.mode.id = "environment-lab-mode";
    this.mode.append(option("gallery", "Model gallery"), option("site", "Authored sites"), option("foliage", "Foliage"), option("cut-face", "Cut face"), option("portal", "Dungeon entrance"));
    this.selection.id = "environment-lab-selection";
    this.layout.id = "environment-lab-layout";
    this.layout.append(option("grid", "Grid · density"), option("lane", "Lane · distance sweep"));
    this.count.id = "environment-lab-count";
    this.count.type = "number";
    this.count.min = "1";
    this.count.max = "16384";
    this.count.step = "1";
    this.count.value = "64";
    this.count.required = true;
    this.span.id = "environment-lab-span";
    this.span.type = "number";
    this.span.min = "0.1";
    this.span.step = "any";
    this.span.value = "96";
    this.span.required = true;
    for (const control of [this.mode, this.selection, this.layout, this.count, this.span]) {
      control.style.cssText = "display:block;width:100%;box-sizing:border-box;margin:4px 0 12px;padding:7px;background:#30382f;color:#eee7d8;border:1px solid #75684f;border-radius:4px;font:inherit;";
    }
    const dimensions = document.createElement("div");
    dimensions.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
    dimensions.append(label("Instance count", this.count), label("Span (m)", this.span));
    this.variants.type = "checkbox";
    this.variants.id = "environment-lab-variants";
    this.foliageControls.append(label("Layout", this.layout), dimensions, label("Mix species variants", this.variants));
    this.mode.addEventListener("change", () => { this.populate(); this.describe(); });
    this.selection.addEventListener("change", () => this.describe());
    this.load.type = "button";
    this.load.id = "environment-lab-load";
    this.load.textContent = "Load selection";
    this.load.addEventListener("click", () => { void this.show(); });
    this.frame.type = "button";
    this.frame.id = "environment-lab-frame";
    this.frame.textContent = "Frame scene";
    this.frame.hidden = !options.onFrame;
    this.frame.addEventListener("click", () => this.fit());
    this.detail.type = "button";
    this.detail.id = "environment-lab-detail";
    this.detail.textContent = "Detail";
    this.detail.hidden = !options.onFrame;
    this.detail.addEventListener("click", () => this.fit(true));
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;margin-bottom:12px;";
    for (const button of [this.load, this.frame, this.detail]) {
      button.className = "btn";
      button.style.cssText = "padding:7px 10px;font:inherit;";
      actions.append(button);
    }
    this.info.id = "environment-lab-source";
    this.info.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;color:#c4cbbd;";
    this.status.id = "environment-lab-status";
    this.status.setAttribute("role", "status");
    this.status.style.cssText = "margin:8px 0;color:#c8b98e;";
    this.error.id = "environment-lab-error";
    this.error.setAttribute("role", "alert");
    this.error.style.cssText = "white-space:pre-wrap;color:#ffb8a3;";
    this.error.hidden = true;
    const note = document.createElement("p");
    note.textContent = "Mine and grove resources use normal gathering. Fisheries require a water and basin scene and are unavailable in this dry yard.";
    note.style.cssText = "margin:10px 0 0;font-size:11px;color:#adb5a7;";
    this.root.append(heading, label("Mode", this.mode), label("Selection", this.selection), this.foliageControls, actions, this.info, this.status, this.error, note);
    (options.parent ?? document.body).append(this.root);
    this.refresh();
    this.refreshTimer = window.setInterval(() => this.refresh(), 500);
  }

  refresh(): void {
    if (this.busy || this.disposed) return;
    const state = this.workbench.getState();
    const signature = `${state.mode}:${state.selection}:${state.ready}:${state.entityIds.length}:${state.assets.length}:${JSON.stringify(state.foliage ?? null)}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.mode.value = state.mode;
    this.populate();
    this.selection.value = state.selection;
    if (state.foliage) {
      this.layout.value = state.foliage.layout;
      this.count.value = String(state.foliage.count);
      this.span.value = String(state.foliage.span);
      this.variants.checked = state.assets.length > 1;
    }
    this.describe();
    this.status.textContent = state.ready
      ? `${state.foliage ? `${state.foliage.count} foliage instances` : `${state.entityIds.length} entities`} · ${state.assets.length} model files loaded`
      : "Loading scene…";
    this.frame.disabled = !state.ready || !this.workbench.getBounds();
  }

  dispose(): void {
    this.disposed = true;
    window.clearInterval(this.refreshTimer);
    this.root.remove();
  }

  private populate(): void {
    this.selection.replaceChildren();
    this.foliageControls.hidden = this.mode.value !== "foliage";
    if (this.mode.value === "gallery") {
      this.selection.append(option("all", `Full gallery · ${this.catalog.assets.length} original models`));
      for (const asset of this.catalog.assets) this.selection.append(option(asset.id, asset.label));
    } else if (this.mode.value === "foliage") {
      for (const asset of this.catalog.assets) {
        if (/^corealm_(?:oak|pine|ash|walnut|willow|maple|teak|yew|magic|fern|shrub)_\d+$/.test(asset.id)) {
          this.selection.append(option(asset.id, asset.label));
        }
      }
    } else if (this.mode.value === "cut-face") {
      this.selection.append(option("two-seam-slope", "Two ore seams · sloped face"));
    } else if (this.mode.value === "portal") {
      this.selection.append(option("gravelmaw", "Stone Cavern entrance"));
    } else if (this.mode.value === "site") {
      for (const site of this.catalog.sites) {
        const entry = option(site.id, `${site.label}${site.available ? "" : " · water scene required"}`);
        entry.disabled = !site.available;
        this.selection.append(entry);
      }
      this.selection.value = this.catalog.sites.find((site) => site.available)?.id ?? "";
    }
  }

  private describe(): void {
    if (this.mode.value === "portal") {
      this.info.textContent = "Production masonry opening and recessed stone passage. Inspect threshold, arch fit and depth.";
    } else if (this.mode.value === "cut-face") {
      this.info.textContent = "Two production ore resources in a sloped cut face. Inspect seam placement, mining contact and depleted stone.";
    } else if (this.mode.value === "site") {
      const site = this.catalog.sites.find((candidate) => candidate.id === this.selection.value);
      this.info.textContent = site?.available
        ? "Authored resource positions and setting pieces. Previewed at yard centre, with its approach facing +Z."
        : site?.reason ?? "No site selected.";
    } else {
      const asset = this.catalog.assets.find((candidate) => candidate.id === this.selection.value);
      this.info.textContent = asset
        ? `${asset.source}\n${asset.id}\n${asset.size.map((value) => value.toFixed(2)).join(" × ")} m · native dimensions\n${asset.file}`
        : "All original environment models at native scale. Ground plants are in front; trees and cliffs occupy the rear rows.";
    }
  }

  private async show(): Promise<void> {
    if (this.busy || this.disposed) return;
    if (this.mode.value === "foliage" && (!this.count.reportValidity() || !this.span.reportValidity())) return;
    this.busy = true;
    this.error.hidden = true;
    for (const control of [this.mode, this.selection, this.layout, this.count, this.span, this.variants, this.load, this.frame, this.detail]) control.disabled = true;
    this.status.textContent = "Loading production models…";
    try {
      if (this.mode.value === "site") await this.workbench.showSite(this.selection.value);
      else if (this.mode.value === "cut-face") await this.workbench.showCutFace();
      else if (this.mode.value === "portal") await this.workbench.showPortal();
      else if (this.mode.value === "foliage") await this.workbench.showFoliage(this.selection.value, {
        variants: this.variants.checked ? this.catalog.assets.filter(asset =>
          asset.id.replace(/_\d+$/, "") === this.selection.value.replace(/_\d+$/, "")).map(asset => asset.id) : undefined,
        layout: this.layout.value as "lane" | "grid",
        count: this.count.valueAsNumber,
        span: this.span.valueAsNumber,
      });
      else await this.workbench.showGallery(this.selection.value === "all" ? undefined : this.selection.value);
      if (!this.disposed) this.fit();
    } catch (error) {
      if (!this.disposed) {
        this.error.textContent = error instanceof Error ? error.message : String(error);
        this.error.hidden = false;
      }
    } finally {
      this.busy = false;
      if (!this.disposed) {
        for (const control of [this.mode, this.selection, this.layout, this.count, this.span, this.variants, this.load, this.frame, this.detail]) control.disabled = false;
        this.signature = "";
        this.refresh();
      }
    }
  }

  private fit(detail = false): void {
    const bounds = this.workbench.getBounds();
    if (bounds) this.options.onFrame?.(bounds, detail);
  }
}

function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  return element;
}

function label(text: string, control: HTMLElement): HTMLLabelElement {
  const element = document.createElement("label");
  element.textContent = text;
  element.append(control);
  return element;
}
