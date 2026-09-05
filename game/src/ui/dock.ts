/**
 * The panel dock: the bar of buttons along the bottom-right that opens the panels.
 *
 * Phase 1 bound the inventory to `i`, skills to `k` and equipment to `e`, and advertised none of
 * it. A player who cannot find their inventory cannot progress, and no screenshot of the game ever
 * showed a panel because nothing on screen suggested there was one. This is the fix: every panel
 * has a permanent button, each button prints its own key, and the button lights up while its panel
 * is open.
 *
 * The dock owns no state. It asks each entry whether its panel is open on every update and paints
 * from the answer, so a panel opened by a key, by a world interaction, or by another panel all
 * light the same button.
 */
import { createUiIcon, type UiIconName } from "./icons.js";

export interface DockEntry {
  id: string;
  label: string;
  /** The key that toggles it, as the player should read it. */
  key: string;
  /** An authored line icon; the visible label carries the panel's name. */
  icon: UiIconName;
  toggle(): void;
  isOpen(): boolean;
  /** Optional badge, e.g. the number of active quests. Empty string hides it. */
  badge?(): string;
}

interface DockButton {
  entry: DockEntry;
  root: HTMLButtonElement;
  badge: HTMLElement;
  open: boolean;
  badgeText: string;
}

export class PanelDock {
  private readonly root: HTMLElement;
  private readonly buttons: DockButton[] = [];

  constructor(entries: readonly DockEntry[]) {
    const root = document.createElement("nav");
    root.className = "dock";
    root.setAttribute("aria-label", "Panels");

    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dock__btn";
      button.setAttribute("aria-pressed", "false");
      // The title carries the key too, so a hover answers "how do I open this without the mouse".
      button.title = `${entry.label} (${entry.key.toUpperCase()})`;
      button.setAttribute("aria-label", `${entry.label}, key ${entry.key.toUpperCase()}`);

      const glyph = document.createElement("span");
      glyph.className = "dock__glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.appendChild(createUiIcon(entry.icon));

      const label = document.createElement("span");
      label.className = "dock__label";
      label.textContent = entry.label;

      const key = document.createElement("kbd");
      key.className = "dock__key";
      key.setAttribute("aria-hidden", "true");
      key.textContent = entry.key.toUpperCase();

      const badge = document.createElement("span");
      badge.className = "dock__badge";
      badge.hidden = true;

      button.append(glyph, label, key, badge);
      // Pointer down rather than click: the world's click-to-move listener runs on the canvas, and
      // a dock press must never also order a walk.
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", () => entry.toggle());

      root.appendChild(button);
      this.buttons.push({ entry, root: button, badge, open: false, badgeText: "" });
    }

    this.root = root;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  /** Cheap enough to call at the HUD's cadence: it only writes when a value actually changed. */
  update(): void {
    for (const button of this.buttons) {
      const open = button.entry.isOpen();
      if (open !== button.open) {
        button.open = open;
        button.root.classList.toggle("is-active", open);
        button.root.setAttribute("aria-pressed", open ? "true" : "false");
      }
      const text = button.entry.badge?.() ?? "";
      if (text !== button.badgeText) {
        button.badgeText = text;
        button.badge.textContent = text;
        button.badge.hidden = text === "";
      }
    }
  }

  dispose(): void {
    this.root.remove();
    this.buttons.length = 0;
  }
}
