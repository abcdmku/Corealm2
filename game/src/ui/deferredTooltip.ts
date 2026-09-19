import type { GameApi } from "../contracts.js";
import { attachHoverTriggers, onPressElsewhere } from "./hoverIntent.js";
import type { Tooltip, TooltipContent } from "./tooltips.js";

/** Loads item-card rendering on the first hover or keyboard focus. */
export class DeferredTooltip {
  private tooltip: Tooltip | null = null;
  private loading: Promise<void> | null = null;
  private parent: HTMLElement | null = null;
  private active: { target: Element; provider: () => TooltipContent | null } | null = null;
  private readonly detachers: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly api: GameApi, private readonly onError: (error: unknown) => void) {
    // The loaded card hides itself on a press elsewhere; this clears the anchor behind it, or the
    // next `refresh()` on the UI tick would put the card straight back up.
    this.detachers.push(onPressElsewhere((target) => {
      const active = this.active;
      if (!active || (target && active.target.contains(target))) return;
      this.active = null;
      this.tooltip?.hide();
    }));
  }

  mount(parent: HTMLElement): void {
    if (this.disposed) return;
    this.parent = parent;
    this.tooltip?.mount(parent);
  }

  attach(target: Element, provider: () => TooltipContent | null): () => void {
    if (this.disposed) return () => undefined;
    let attached = true;
    const detachTriggers = attachHoverTriggers(target, {
      show: () => {
        this.active = { target, provider };
        if (this.tooltip) this.refresh();
        else this.load();
      },
      hide: () => {
        if (this.active?.target !== target) return;
        this.active = null;
        this.tooltip?.hide();
      },
    });
    const detach = (): void => {
      if (!attached) return;
      attached = false;
      detachTriggers();
      if (this.active?.target === target) {
        this.active = null;
        this.tooltip?.hide();
      }
    };
    this.detachers.push(detach);
    return detach;
  }

  refresh(): void {
    const active = this.active;
    if (!this.tooltip || !active) return;
    // A removed or closed panel cannot leave an orphaned card when its import resolves.
    if (!active.target.isConnected || active.target.getClientRects().length === 0) {
      this.active = null;
      this.tooltip.hide();
      return;
    }
    const spec = active.provider();
    if (spec) this.tooltip.show(spec, active.target);
    else this.tooltip.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = null;
    this.parent = null;
    for (const detach of this.detachers) detach();
    this.detachers.length = 0;
    this.tooltip?.dispose();
    this.tooltip = null;
  }

  private load(): void {
    if (this.loading || this.disposed) return;
    this.loading = import("./tooltips.js").then(({ Tooltip }) => {
      if (this.disposed) return;
      this.tooltip = new Tooltip(this.api);
      if (this.parent) this.tooltip.mount(this.parent);
      this.refresh();
    }).catch((error: unknown) => {
      if (!this.disposed) this.onError(error);
    }).finally(() => { this.loading = null; });
  }
}
