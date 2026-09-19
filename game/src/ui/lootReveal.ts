import { sendGameCommand } from "../api/commands.js";
/** Compact, world-anchored contents for loot piles and Recovery Caches. */
import type { LootContainerView, Vec3 } from "../contracts.js";
import { onTapElsewhere } from "./hoverIntent.js";
import type { UiContext } from "./panels.js";
import { itemName, paintSlot } from "./panels.js";
import { reportResult } from "./contextMenu.js";

const MAX_COLUMNS = 4;
const PANEL_GAP_PX = 12;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_HEIGHT_METRES = 0.65;

export function lootGridColumns(itemCount: number): number {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(itemCount)));
}

/** Shows only the remaining stacks. A stack moves only when its own cell is clicked. */
export class LootReveal {
  private readonly root = document.createElement("section");
  private readonly grid = document.createElement("div");
  private container: LootContainerView | null = null;
  private popEscape: (() => void) | null = null;
  private stopPressDismissal: (() => void) | null = null;

  constructor(private readonly ctx: UiContext) {
    this.root.className = "loot-reveal";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "false");
    this.root.addEventListener("pointerdown", (event) => event.stopPropagation());

    this.grid.className = "slot-grid loot-reveal__grid";
    this.root.append(this.grid);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  show(container: LootContainerView): void {
    if (container.items.length === 0) {
      this.hide();
      return;
    }

    this.container = {
      ...container,
      position: [...container.position] as Vec3,
      items: container.items.map((stack) => ({ ...stack })),
    };
    this.root.dataset["sourceId"] = container.entityId;
    this.root.setAttribute("aria-label", `${container.name} contents`);
    this.paint();
    this.root.hidden = false;
    this.installEscapeHandler();
    this.installPressDismissal();
    this.update();
  }

  /** Keeps the compact grid beside its world container while the camera moves. */
  update(): void {
    const container = this.container;
    if (this.root.hidden || !container) return;
    const inspected = this.ctx.api.inspect(container.entityId);
    if (!inspected.ok) {
      this.hide();
      return;
    }
    if (inspected.value.loot && JSON.stringify(inspected.value.loot) !== JSON.stringify(container.items)) {
      container.items = inspected.value.loot.map(stack => ({ ...stack }));
      if (!container.items.length) { this.hide(); return; }
      this.paint();
    }

    const point = this.ctx.projectWorldToScreen?.([
      container.position[0],
      container.position[1] + ANCHOR_HEIGHT_METRES,
      container.position[2],
    ]);
    if (!point || !point.visible) {
      this.root.style.visibility = "hidden";
      return;
    }

    const offsetParent = this.root.offsetParent;
    const parentRect = offsetParent instanceof HTMLElement
      ? offsetParent.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const anchorX = point.x - parentRect.left;
    const anchorY = point.y - parentRect.top;
    const width = this.root.offsetWidth;
    const height = this.root.offsetHeight;
    const right = anchorX + PANEL_GAP_PX;
    const left = right + width <= parentRect.width - VIEWPORT_MARGIN_PX
      ? right
      : anchorX - width - PANEL_GAP_PX;

    this.root.style.left = `${Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(left, parentRect.width - width - VIEWPORT_MARGIN_PX),
    )}px`;
    this.root.style.top = `${Math.max(
      VIEWPORT_MARGIN_PX,
      Math.min(anchorY - height / 2, parentRect.height - height - VIEWPORT_MARGIN_PX),
    )}px`;
    this.root.style.visibility = "visible";
    this.root.dataset["anchorX"] = String(Math.round(anchorX));
    this.root.dataset["anchorY"] = String(Math.round(anchorY));
  }

  hide(): void {
    this.root.hidden = true;
    this.root.style.visibility = "hidden";
    this.container = null;
    delete this.root.dataset["sourceId"];
    this.popEscape?.();
    this.popEscape = null;
    this.stopPressDismissal?.();
    this.stopPressDismissal = null;
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  /**
   * A tap anywhere else closes the grid. Walking away, opening a panel, or a click on the ground
   * are all "I am done with this pile", and on a phone Escape is not a key anyone has. A drag is
   * left alone: turning the camera to see the pile must not throw its contents away.
   */
  private installPressDismissal(): void {
    if (this.stopPressDismissal) return;
    this.stopPressDismissal = onTapElsewhere((target) => {
      if (target && this.root.contains(target)) return;
      this.hide();
    });
  }

  private installEscapeHandler(): void {
    if (this.popEscape) return;
    this.popEscape = this.ctx.registry.pushEscapeHandler(() => {
      this.hide();
      return true;
    });
  }

  private paint(): void {
    const container = this.container;
    if (!container) return;
    this.grid.style.setProperty("--slot-columns", String(lootGridColumns(container.items.length)));
    const cells = container.items.map((stack, stackIndex) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "slot loot-reveal__slot";
      paintSlot(cell, stack);
      this.ctx.tooltip.attach(cell, () => ({
        kind: "item",
        itemId: stack.itemId,
        quantity: stack.quantity,
      }));
      const label = `Take ${itemName(stack.itemId)} x ${stack.quantity.toLocaleString("en-US")}${stack.partyId ? " - party round robin" : ""}`;
      cell.setAttribute("aria-label", label);
      if (stack.partyId) { cell.dataset.partyLoot = "true"; cell.title = "Anyone can collect. Sent to the next eligible party member."; }
      cell.addEventListener("click", () => this.take(stackIndex, stack.stackId));
      return cell;
    });
    this.grid.replaceChildren(...cells);
  }

  private async take(stackIndex: number, stackId?: string): Promise<void> {
    const container = this.container;
    if (!container) return;
    const result = await sendGameCommand(this.ctx.api, "takeLoot", container.entityId, stackIndex, stackId);
    if (!reportResult(result)) return;
    if (this.container !== container) { this.ctx.refresh(); return; }

    if (result.value.containerEmpty) {
      this.hide();
    } else {
      container.items = result.value.remaining.map((stack) => ({ ...stack }));
      this.paint();
      this.update();
    }
    this.ctx.refresh();
  }
}
