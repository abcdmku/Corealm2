import { keybindings } from "../input/keyboard.js";
import type { KeyBindingRegistry, Unregister } from "../input/keyboard.js";
import { createUiIcon } from "./icons.js";
import { panelInteraction } from "./panelInteraction.js";
import { isSmallScreen } from "./mobileLayout.js";

export interface PanelPlacement {
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  width?: string;
  maxHeight?: string;
}

export interface PanelFrameOptions {
  id: string;
  title: string;
  placement: PanelPlacement;
  registry?: KeyBindingRegistry;
  /** Chord that toggles the panel, e.g. "i". Omit for panels opened by world interaction. */
  key?: string;
  /** Shown in a controls list. Defaults to "Toggle <title>". */
  keyLabel?: string;
  /**
   * Panels in the same group share one screen slot: opening one closes the others. This is the
   * no-overlap rule — "side" is the tab slot above the dock, "center" is the one large window.
   * The group name is also added as a `panel--<group>` class so the stylesheet can shape the slot.
   */
  group?: string;
  /** Draggable by its header. The first drag converts the placement to explicit left/top. */
  movable?: boolean;
  onOpen?(): void;
  onClose?(): void;
}

/** Matches `--z-panel` in styles.css. A raised panel stays inside the band above it. */
const PANEL_Z_BASE = 20;

/** How far a raise may climb before it wraps. Keeps panels below `--z-menu` at 30. */
const PANEL_STACK_DEPTH = 9;

const panelStack: PanelFrame[] = [];

/** Frames by group, so open() can vacate a shared slot. Module-level: frames register on
 * construction and leave on dispose, and the map never outlives the page. */
const panelGroups = new Map<string, Set<PanelFrame>>();

/**
 * One panel chrome: header, close button, body, key binding, Escape handling, focus restore.
 *
 * Escape goes through `pushEscapeHandler` so the input layer's cancel binding sees it last — the
 * PRD rule is "close the top panel, otherwise cancel the activity", and the escape stack is what
 * makes "top" mean the most recently opened panel.
 */
export class PanelFrame {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly registry: KeyBindingRegistry;
  private readonly disposers: Unregister[] = [];
  private popEscape: Unregister | null = null;
  private restoreFocus: HTMLElement | null = null;
  private opened = false;
  private cancelDrag: (() => void) | null = null;

  constructor(private readonly options: PanelFrameOptions) {
    this.registry = options.registry ?? keybindings;

    const root = document.createElement("section");
    root.className = "panel panel--float";
    if (options.group) {
      root.classList.add(`panel--${options.group}`);
      let peers = panelGroups.get(options.group);
      if (!peers) {
        peers = new Set();
        panelGroups.set(options.group, peers);
      }
      peers.add(this);
    }
    root.id = `panel-${options.id}`;
    root.hidden = true;
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", options.title);
    const place = options.placement;
    if (place.top !== undefined) root.style.top = place.top;
    if (place.left !== undefined) root.style.left = place.left;
    if (place.right !== undefined) root.style.right = place.right;
    // Side panels share the dock's clearance and reading width, including compact density.
    if (place.bottom !== undefined) root.style.bottom = options.group === "side"
      ? `var(--dock-clearance, ${place.bottom})` : place.bottom;
    if (place.width !== undefined) root.style.width = options.group === "side"
      ? `var(--side-panel-width, ${place.width})` : place.width;
    // Only when a panel asks for one. Writing the default inline made it beat every stylesheet
    // rule, including the `@media (max-height: 800px)` block in styles.css that exists to shrink
    // panels on a short screen — which had therefore never done anything since it was written.
    // The default now lives on `.panel--float`, where a media query can reach it.
    if (place.maxHeight !== undefined) root.style.maxHeight = place.maxHeight;

    const header = document.createElement("header");
    header.className = "panel__header";

    const titles = document.createElement("div");
    titles.className = "panel__titles";
    const title = document.createElement("h2");
    title.className = "panel__title";
    title.textContent = options.title;
    const subtitle = document.createElement("div");
    subtitle.className = "panel__subtitle";
    titles.append(title, subtitle);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "panel__close";
    close.setAttribute("aria-label", `Close ${options.title}`);
    close.appendChild(createUiIcon("close"));
    close.addEventListener("click", () => this.close());

    header.append(titles, close);

    /*
     * Drag-to-move, on the header only. The placement may be anchored any way (right/bottom, or
     * left:50% + a stylesheet transform); the first drag converts it to explicit left/top and
     * kills the transform, because mixing a centring transform with a dragged position doubles
     * every movement. Listeners on window exist only for the duration of a drag.
     */
    if (options.movable) {
      root.classList.add("panel--movable");
      header.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("button")) return;
        // On a phone the panel is a sheet pinned by the stylesheet; a drag would only fight it.
        if (isSmallScreen()) return;
        this.cancelDrag?.();
        const rect = root.getBoundingClientRect();
        const grabX = event.clientX - rect.left;
        const grabY = event.clientY - rect.top;
        const onMove = (move: PointerEvent) => {
          if (move.pointerId !== event.pointerId) return;
          const left = Math.min(Math.max(move.clientX - grabX, 0), Math.max(0, window.innerWidth - rect.width));
          const top = Math.min(Math.max(move.clientY - grabY, 0), Math.max(0, window.innerHeight - 32));
          root.classList.add("is-moved");
          root.style.left = `${Math.round(left)}px`;
          root.style.top = `${Math.round(top)}px`;
          root.style.right = "auto";
          root.style.bottom = "auto";
          root.style.transform = "none";
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          window.removeEventListener("blur", onUp);
          this.cancelDrag = null;
        };
        this.cancelDrag = onUp;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        window.addEventListener("blur", onUp);
        event.preventDefault();
      });
    }

    const body = document.createElement("div");
    body.className = "panel__body";

    root.append(header, body);

    this.root = root;
    this.body = body;
    this.subtitleEl = subtitle;
    root.addEventListener("pointerdown", () => this.raise());

    if (options.key) {
      this.disposers.push(this.registry.register({
        id: `panel.${options.id}`,
        keys: [options.key],
        label: options.keyLabel ?? `Toggle ${options.title}`,
        group: "Panels",
        onDown: () => {
          this.toggle();
          return true;
        },
      }));
    }
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.opened;
  }

  setSubtitle(text: string): void {
    if (this.subtitleEl.textContent !== text) this.subtitleEl.textContent = text;
  }

  open(): void {
    if (this.opened) {
      this.raise();
      return;
    }
    // One slot per group. The sibling closes BEFORE this opens so focus restore and the escape
    // stack see a plain close-then-open, never two panels fighting over the same pixels.
    if (this.options.group) {
      for (const peer of panelGroups.get(this.options.group) ?? []) {
        if (peer !== this) peer.close();
      }
    }
    this.opened = true;
    this.root.hidden = false;
    this.raise();
    this.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.options.onOpen?.();
    this.focusFirst();
  }

  close(): void {
    this.cancelDrag?.();
    if (!this.opened) return;
    this.opened = false;
    this.root.hidden = true;
    this.popEscape?.();
    this.popEscape = null;
    const stackIndex = panelStack.indexOf(this);
    if (stackIndex !== -1) panelStack.splice(stackIndex, 1);
    this.options.onClose?.();

    // Focus goes back where it came from, or the next keystroke lands on a hidden element.
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    if (restore && restore.isConnected && !restore.closest("[hidden]") && !this.root.contains(restore)
      && this.root.contains(document.activeElement)) {
      restore.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Reorders visible panels below menus and keeps Escape aligned with the front panel. */
  raise(): void {
    if (!this.opened) return;
    panelInteraction.generation += 1;
    const previous = panelStack.indexOf(this);
    if (previous !== -1) panelStack.splice(previous, 1);
    panelStack.push(this);
    panelStack.forEach((panel, index) => {
      panel.root.style.zIndex = String(PANEL_Z_BASE + Math.min(index + 1, PANEL_STACK_DEPTH));
    });
    this.popEscape?.();
    this.popEscape = this.registry.pushEscapeHandler(() => {
      if (!this.opened) return false;
      this.close();
      return true;
    });
  }

  focusFirst(): void {
    const target = this.body.querySelector<HTMLElement>("[data-autofocus]")
      ?? this.body.querySelector<HTMLElement>("button:not([disabled]), input, select, [tabindex='0']");
    (target ?? this.root).focus({ preventScroll: true });
  }

  dispose(): void {
    this.close();
    if (this.options.group) panelGroups.get(this.options.group)?.delete(this);
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.root.remove();
  }
}
