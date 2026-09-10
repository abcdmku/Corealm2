/**
 * The spell action bars: up to four strips of eight square slots, Knight Online sized.
 *
 * A bar is a row of icons and nothing else. Key caps sit in the slot corner, the drag grip is a
 * twelve-pixel tab on the leading edge, and every option that is not "press a slot" lives behind
 * one small menu on the trailing edge. The first pass of this bar carried a title, four school
 * tabs, a status line and a progress bar and was wider than the inventory; a bar the player has
 * to look at is a bar that is in the way.
 *
 * Bars dock to the bottom (stacked upward, centred), to the left or right edge (stacked outward,
 * vertical by default), or sit wherever the grip was dropped. Slots take spells by drag from the
 * spellbook or from another slot; dragging a slot off every bar clears it. Layout and slot
 * contents persist in `localStorage` under the caller's key, so the lab and the world each keep
 * their own arrangement and a phone keeps a different one from a desktop.
 *
 * The bar owns no gameplay. `catalogue()` gives it the live spell rows and `activate(id)` is the
 * only thing a press does; the world maps that to `castNow` / `setPreferredSpell` and the lab to a
 * range cast. Keys go through the shared `KeyBindingRegistry` so the controls panel lists them and
 * an open conversation (which claims the number row at a higher priority) still wins.
 */
import type { SpellElement, SpellId, SpellRung } from "../contracts.js";
import type { KeyBindingRegistry, Unregister } from "../input/keyboard.js";
import { spellIconSvg } from "./spellIcons.js";
import "./styles/spellActionBar.css";

export const ACTION_BAR_SLOTS = 8;
export const ACTION_BAR_MAX = 4;
export const SPELL_DRAG_MIME = "text/x-corealm-spell";

export type ActionBarDock = "bottom" | "left" | "right" | "free";

export interface ActionBarSpell {
  id: SpellId;
  name: string;
  element: SpellElement;
  rung: SpellRung;
  rank: number;
  unlocked: boolean;
  castable: boolean;
  blockedBy: string | null;
  description: string;
}

export interface ActionBarCastLock {
  spellId: SpellId;
  startedMs: number;
  endsMs: number;
}

export interface ActionBarDeps {
  /** The spells a slot may hold, with their live state. Read on every refresh. */
  catalogue(): readonly ActionBarSpell[];
  /** A slot press or its key. The bar has already refused presses while a cast lock is live. */
  activate(spellId: SpellId): void;
  registry: KeyBindingRegistry;
  /** `localStorage` key for layout and slots. Distinct per surface. */
  storageKey: string;
  /** First-run slot contents per bar; bars without a row start empty. */
  defaults?: readonly (readonly (SpellId | null)[])[];
  /** How many bars a first run shows. Default one. */
  defaultVisible?: number;
  /** Where a message about a refused press goes. Default: nowhere. */
  notify?(message: string): void;
}

export interface ActionBarLayout {
  bars: ActionBarState[];
  locked: boolean;
}

export interface ActionBarState {
  slots: (SpellId | null)[];
  dock: ActionBarDock;
  x: number;
  y: number;
  vertical: boolean;
  visible: boolean;
}

export interface SpellActionBar {
  readonly root: HTMLElement;
  mount(parent: HTMLElement): void;
  /** Repaints every slot from the catalogue. Cheap when nothing changed. */
  refresh(): void;
  /** The invocation in progress, for the slot lock and its sweep. Null clears it. */
  setCastLock(lock: ActionBarCastLock | null, nowMs: number): void;
  /** Highlights the standing spell across every bar, or none. */
  select(spellId: SpellId | null): void;
  /** Puts a spell in the first empty slot of the first visible bar. False when every slot is full. */
  assign(spellId: SpellId): boolean;
  setSlot(bar: number, slot: number, spellId: SpellId | null): void;
  getLayout(): ActionBarLayout;
  /** The compact summary the lab publishes through `window.__spellRange`. */
  getState(): {
    bars: number; dock: string; vertical: boolean; x: number; y: number;
    selected: string; busy: boolean; slots: (string | null)[];
  };
  dispose(): void;
}

const LAYOUT_VERSION = 2;
const EDGE = 12;
const GAP = 6;

/** Digit keys per bar. Bar four is pointer-only: every remaining modifier is a browser shortcut. */
const BAR_KEYS: readonly (readonly string[])[] = [
  ["1", "2", "3", "4", "5", "6", "7", "8"],
  // `event.key` under Shift is the shifted glyph on most layouts, so both spellings are bound; the
  // handler reads `event.code` and does not care which one matched.
  ["shift+1", "shift+2", "shift+3", "shift+4", "shift+5", "shift+6", "shift+7", "shift+8",
    "shift+!", "shift+@", "shift+#", "shift+$", "shift+%", "shift+^", "shift+&", "shift+*"],
  ["alt+1", "alt+2", "alt+3", "alt+4", "alt+5", "alt+6", "alt+7", "alt+8"],
  [],
];
const BAR_KEY_LABELS: readonly string[] = ["", "⇧", "Alt", ""];

interface DragPayload { id: SpellId; bar?: number; slot?: number }

interface BarView {
  root: HTMLElement;
  slots: HTMLButtonElement[];
  icons: (SpellId | null)[];
  paint: string[];
}

export function createSpellActionBar(deps: ActionBarDeps): SpellActionBar {
  const root = document.createElement("div");
  root.className = "abars";
  root.setAttribute("aria-label", "Spell action bars");

  let layout = loadLayout(deps);
  let selected: SpellId | null = null;
  let lock: ActionBarCastLock | null = null;
  let lockProgress = -1;
  let byId = new Map<SpellId, ActionBarSpell>();
  const views: BarView[] = [];
  const unregisters: Unregister[] = [];
  let menu: HTMLElement | null = null;
  let dropInside = false;

  // --------------------------------------------------------------- building

  for (let index = 0; index < ACTION_BAR_MAX; index += 1) views.push(buildBar(index));

  function buildBar(index: number): BarView {
    const bar = document.createElement("section");
    bar.className = "abar";
    bar.dataset["bar"] = String(index);
    bar.setAttribute("aria-label", `Action bar ${index + 1}`);

    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "abar__grip";
    grip.title = `Action bar ${index + 1}. Drag to move, right-click for options`;
    grip.setAttribute("aria-label", `Move action bar ${index + 1}`);
    grip.innerHTML = `<span class="abar__grip-dots" aria-hidden="true"></span><span class="abar__num">${index + 1}</span>`;
    installGripDrag(grip, index);
    grip.addEventListener("contextmenu", (event) => { event.preventDefault(); openMenu(index, grip); });

    const strip = document.createElement("div");
    strip.className = "abar__slots";
    const slots: HTMLButtonElement[] = [];
    for (let slot = 0; slot < ACTION_BAR_SLOTS; slot += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "abar__slot is-empty";
      button.dataset["slot"] = String(slot);
      button.innerHTML = `<span class="abar__icon" aria-hidden="true"></span>`
        + `<kbd class="abar__key" aria-hidden="true"></kbd>`
        + `<span class="abar__lock" aria-hidden="true"></span>`
        + `<span class="abar__sweep" aria-hidden="true"></span>`;
      button.addEventListener("click", () => press(index, slot));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (layout.locked || !layout.bars[index]!.slots[slot]) return;
        setSlot(index, slot, null);
      });
      installSlotDrag(button, index, slot);
      strip.appendChild(button);
      slots.push(button);
    }

    const options = document.createElement("button");
    options.type = "button";
    options.className = "abar__menu";
    options.title = "Action bar options";
    options.setAttribute("aria-label", `Action bar ${index + 1} options`);
    options.setAttribute("aria-haspopup", "menu");
    options.textContent = "⋯";
    options.addEventListener("click", () => openMenu(index, options));

    bar.append(grip, strip, options);
    // The world's click-to-move listener is on the canvas underneath; a bar press must never walk.
    bar.addEventListener("pointerdown", (event) => event.stopPropagation());
    bar.addEventListener("wheel", (event) => event.stopPropagation());
    root.appendChild(bar);
    return { root: bar, slots, icons: new Array<SpellId | null>(ACTION_BAR_SLOTS).fill(null), paint: new Array<string>(ACTION_BAR_SLOTS).fill("") };
  }

  // ------------------------------------------------------------------ keys

  for (let index = 0; index < ACTION_BAR_MAX; index += 1) {
    const keys = BAR_KEYS[index]!;
    if (keys.length === 0) continue;
    unregisters.push(deps.registry.register({
      id: `actionbar.${index + 1}`,
      keys,
      label: `Action bar ${index + 1}, slots 1 to 8`,
      group: "Action bar",
      // Above the panels' 100 so a slot wins over a panel toggle sharing a digit, below the
      // conversation panel's 50 so an open dialogue keeps the number row for its replies.
      priority: 80,
      onDown: (event) => {
        const match = /^(?:Digit|Numpad)([1-8])$/.exec(event.code);
        if (!match || !layout.bars[index]!.visible) return false;
        press(index, Number(match[1]) - 1);
        return true;
      },
    }));
  }

  // --------------------------------------------------------------- actions

  function press(bar: number, slot: number): void {
    const id = layout.bars[bar]!.slots[slot];
    if (!id) return;
    if (lock) {
      deps.notify?.(`${byId.get(lock.spellId)?.name ?? "The invocation"} is still resolving.`);
      return;
    }
    deps.activate(id);
  }

  function setSlot(bar: number, slot: number, spellId: SpellId | null): void {
    const target = layout.bars[bar];
    if (!target || slot < 0 || slot >= ACTION_BAR_SLOTS) return;
    if (target.slots[slot] === spellId) return;
    target.slots[slot] = spellId;
    save();
    paint();
  }

  function assign(spellId: SpellId): boolean {
    for (const bar of layout.bars) {
      if (!bar.visible) continue;
      const free = bar.slots.indexOf(null);
      if (free < 0) continue;
      bar.slots[free] = spellId;
      save();
      paint();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- dragging

  function installGripDrag(grip: HTMLButtonElement, index: number): void {
    let drag: { id: number; dx: number; dy: number; moved: boolean } | null = null;
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = views[index]!.root.getBoundingClientRect();
      drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
      grip.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    grip.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const bar = layout.bars[index]!;
      if (!drag.moved && Math.hypot(event.clientX - (drag.dx + views[index]!.root.getBoundingClientRect().left),
        event.clientY - (drag.dy + views[index]!.root.getBoundingClientRect().top)) < 3) return;
      drag.moved = true;
      bar.dock = "free";
      bar.x = event.clientX - drag.dx;
      bar.y = event.clientY - drag.dy;
      place();
    });
    const finish = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      if (moved) save();
    };
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
  }

  function installSlotDrag(button: HTMLButtonElement, bar: number, slot: number): void {
    button.draggable = true;
    button.addEventListener("dragstart", (event) => {
      const id = layout.bars[bar]!.slots[slot];
      if (!id || layout.locked || !event.dataTransfer) { event.preventDefault(); return; }
      dropInside = false;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(SPELL_DRAG_MIME, JSON.stringify({ id, bar, slot } satisfies DragPayload));
      event.dataTransfer.setData("text/plain", id);
      button.classList.add("is-dragging");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("is-dragging");
      // Dropped on nothing: the slot is cleared, the way an RS3 slot is emptied.
      if (!dropInside && !layout.locked) setSlot(bar, slot, null);
    });
    button.addEventListener("dragover", (event) => {
      if (layout.locked || !event.dataTransfer?.types.includes(SPELL_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      button.classList.add("is-drop");
    });
    button.addEventListener("dragleave", () => button.classList.remove("is-drop"));
    button.addEventListener("drop", (event) => {
      button.classList.remove("is-drop");
      const raw = event.dataTransfer?.getData(SPELL_DRAG_MIME);
      if (!raw || layout.locked) return;
      event.preventDefault();
      dropInside = true;
      let payload: DragPayload;
      try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
      if (!byId.has(payload.id)) return;
      const target = layout.bars[bar]!;
      const displaced = target.slots[slot] ?? null;
      if (payload.bar !== undefined && payload.slot !== undefined) {
        // From another slot: swap, so a full bar can still be reordered.
        const source = layout.bars[payload.bar];
        if (source && !(payload.bar === bar && payload.slot === slot)) source.slots[payload.slot] = displaced;
      }
      target.slots[slot] = payload.id;
      save();
      paint();
    });
  }

  // ------------------------------------------------------------------ menu

  function closeMenu(): void {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onEscape, true);
  }
  const onOutside = (event: PointerEvent): void => {
    if (menu && !menu.contains(event.target as Node)) closeMenu();
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { closeMenu(); event.stopPropagation(); }
  };

  function openMenu(index: number, anchor: HTMLElement): void {
    closeMenu();
    const bar = layout.bars[index]!;
    const items: { label: string; on(): void; checked?: boolean; disabled?: boolean }[] = [
      { label: "Dock bottom", checked: bar.dock === "bottom", on: () => { bar.dock = "bottom"; bar.vertical = false; } },
      { label: "Dock left", checked: bar.dock === "left", on: () => { bar.dock = "left"; bar.vertical = true; } },
      { label: "Dock right", checked: bar.dock === "right", on: () => { bar.dock = "right"; bar.vertical = true; } },
      { label: bar.vertical ? "Lay horizontal" : "Stand vertical", on: () => { bar.vertical = !bar.vertical; } },
      { label: layout.locked ? "Unlock slots" : "Lock slots", checked: layout.locked, on: () => { layout.locked = !layout.locked; } },
    ];
    const hidden = layout.bars.findIndex((row) => !row.visible);
    if (hidden >= 0) items.push({ label: `Show bar ${hidden + 1}`, on: () => { layout.bars[hidden]!.visible = true; } });
    if (index > 0) items.push({ label: `Hide bar ${index + 1}`, on: () => { bar.visible = false; } });
    items.push({ label: "Clear this bar", on: () => { bar.slots.fill(null); } });
    items.push({ label: "Reset all bars", on: () => { layout = defaultLayout(deps); } });

    menu = document.createElement("div");
    menu.className = "abar-menu";
    menu.setAttribute("role", "menu");
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "abar-menu__item";
      button.setAttribute("role", "menuitem");
      if (item.checked !== undefined) button.setAttribute("aria-checked", String(item.checked));
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      button.addEventListener("click", () => { item.on(); closeMenu(); save(); paint(); place(); });
      menu.appendChild(button);
    }
    menu.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth || 150;
    const height = menu.offsetHeight || 200;
    menu.style.left = `${Math.max(4, Math.min(innerWidth - width - 4, rect.left))}px`;
    menu.style.top = `${rect.top - height - 4 > 4 ? rect.top - height - 4 : Math.min(innerHeight - height - 4, rect.bottom + 4)}px`;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onEscape, true);
  }

  // -------------------------------------------------------------- painting

  function paint(): void {
    byId = new Map(deps.catalogue().map((spell) => [spell.id, spell]));
    layout.bars.forEach((bar, index) => {
      const view = views[index]!;
      view.root.hidden = !bar.visible;
      view.root.dataset["dock"] = bar.dock;
      view.root.classList.toggle("is-vertical", bar.vertical);
      view.root.classList.toggle("is-locked", layout.locked);
      view.root.classList.toggle("is-busy", lock !== null);
      bar.slots.forEach((id, slot) => {
        const button = view.slots[slot]!;
        const spell = id ? byId.get(id) : undefined;
        const key = keyLabel(index, slot);
        const signature = spell
          ? [spell.id, spell.unlocked, spell.castable, spell.blockedBy ?? "", selected === spell.id, lock?.spellId === spell.id, key, layout.locked].join("|")
          : `empty|${key}|${layout.locked}`;
        if (view.icons[slot] !== (spell?.id ?? null)) {
          view.icons[slot] = spell?.id ?? null;
          button.querySelector<HTMLElement>(".abar__icon")!.innerHTML = spell ? spellIconSvg(spell, 30) : "";
        }
        if (view.paint[slot] === signature) return;
        view.paint[slot] = signature;
        button.querySelector<HTMLElement>(".abar__key")!.textContent = key;
        button.classList.toggle("is-empty", !spell);
        button.classList.toggle("is-locked", !!spell && !spell.unlocked);
        button.classList.toggle("is-blocked", !!spell && spell.unlocked && !spell.castable);
        button.classList.toggle("is-selected", !!spell && selected === spell.id);
        button.classList.toggle("is-casting", !!spell && lock?.spellId === spell.id);
        button.draggable = !!spell && !layout.locked;
        button.dataset["spell"] = spell?.id ?? "";
        if (!spell) {
          button.title = layout.locked ? "Empty slot" : "Empty slot. Drag a spell here from the spellbook";
          button.setAttribute("aria-label", `Bar ${index + 1} slot ${slot + 1}, empty`);
          return;
        }
        const status = spell.blockedBy ?? (spell.rank > 0 ? "Cast once at the current target" : "Set as the standing spell");
        button.title = `${spell.name}${key ? ` (${key})` : ""}\n${status}`;
        button.setAttribute("aria-label", `${spell.name}, bar ${index + 1} slot ${slot + 1}${key ? `, key ${key}` : ""}. ${status}`);
      });
    });
    place();
  }

  function keyLabel(bar: number, slot: number): string {
    if (BAR_KEYS[bar]!.length === 0) return "";
    return `${BAR_KEY_LABELS[bar]}${slot + 1}`;
  }

  /**
   * Positions every visible bar. Docked bars stack away from their edge in bar order, so bar two
   * docked bottom sits above bar one; a free bar is clamped inside the viewport after a resize.
   */
  function place(): void {
    const stacks: Record<ActionBarDock, number> = { bottom: 0, left: 0, right: 0, free: 0 };
    // The panel dock owns the bottom-right corner (and the whole bottom strip on a phone). Bottom
    // bars centre themselves but never under it: on a narrow window they slide left of it, and
    // above a full-width phone dock they start from its top edge instead of the screen's.
    const dock = root.parentElement?.querySelector<HTMLElement>(".dock")?.getBoundingClientRect() ?? null;
    const dockIsStrip = !!dock && dock.width > innerWidth * 0.7;
    const bottomBase = dockIsStrip && dock ? innerHeight - dock.top + GAP : EDGE;
    layout.bars.forEach((bar, index) => {
      if (!bar.visible) return;
      const el = views[index]!.root;
      el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.transform = "";
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (bar.dock === "bottom") {
        let left = Math.round((innerWidth - w) / 2);
        if (dock && !dockIsStrip && left + w > dock.left - GAP) left = Math.max(EDGE, dock.left - GAP - w);
        el.style.left = `${left}px`;
        el.style.bottom = `${bottomBase + stacks.bottom}px`;
        stacks.bottom += h + GAP;
      } else if (bar.dock === "left" || bar.dock === "right") {
        el.style[bar.dock] = `${EDGE + stacks[bar.dock]}px`;
        el.style.top = "38%";
        el.style.transform = "translateY(-38%)";
        stacks[bar.dock] += w + GAP;
      } else {
        bar.x = Math.max(4, Math.min(innerWidth - w - 4, bar.x));
        bar.y = Math.max(4, Math.min(innerHeight - h - 4, bar.y));
        el.style.left = `${bar.x}px`;
        el.style.top = `${bar.y}px`;
      }
    });
  }

  function save(): void {
    try {
      localStorage.setItem(deps.storageKey, JSON.stringify({ version: LAYOUT_VERSION, ...layout }));
    } catch { /* Storage can be disabled or full; the bar still works for the session. */ }
  }

  const onResize = (): void => place();
  window.addEventListener("resize", onResize);

  paint();

  return {
    root,
    mount(parent) {
      parent.appendChild(root);
      place();
    },
    refresh: paint,
    setCastLock(next, nowMs) {
      const changed = (next?.spellId ?? null) !== (lock?.spellId ?? null) || (next?.startedMs ?? 0) !== (lock?.startedMs ?? 0);
      // The caller's lock is authoritative: the combat system drops it on its own sim tick, which
      // trails the render clock by up to one tick. Expiring it here first opened a window where the
      // bar looked free and the next press was refused as "still resolving".
      lock = next;
      const progress = lock ? Math.min(1, (nowMs - lock.startedMs) / Math.max(1, lock.endsMs - lock.startedMs)) : -1;
      if (changed || (lock === null && lockProgress !== -1)) paint();
      if (progress !== lockProgress) {
        lockProgress = progress;
        for (const view of views) {
          for (const button of view.slots) {
            button.style.setProperty("--sweep", progress < 0 ? "0" : String(progress));
          }
        }
      }
    },
    select(spellId) {
      if (selected === spellId) return;
      selected = spellId;
      paint();
    },
    assign,
    setSlot,
    getLayout: () => ({ locked: layout.locked, bars: layout.bars.map((bar) => ({ ...bar, slots: [...bar.slots] })) }),
    getState() {
      const first = layout.bars[0]!;
      const rect = views[0]!.root.getBoundingClientRect();
      return {
        bars: layout.bars.filter((bar) => bar.visible).length,
        dock: first.dock,
        vertical: first.vertical,
        x: rect.x,
        y: rect.y,
        selected: selected ?? "",
        busy: lock !== null,
        slots: [...first.slots],
      };
    },
    dispose() {
      closeMenu();
      for (const off of unregisters) off();
      window.removeEventListener("resize", onResize);
      root.remove();
    },
  };
}

// -------------------------------------------------------------------- layout

function defaultLayout(deps: ActionBarDeps): ActionBarLayout {
  const visible = Math.max(1, Math.min(ACTION_BAR_MAX, deps.defaultVisible ?? 1));
  const docks: ActionBarDock[] = ["bottom", "bottom", "right", "left"];
  return {
    locked: false,
    bars: Array.from({ length: ACTION_BAR_MAX }, (_, index) => ({
      slots: Array.from({ length: ACTION_BAR_SLOTS }, (_, slot) => deps.defaults?.[index]?.[slot] ?? null),
      dock: docks[index]!,
      x: 0,
      y: 0,
      vertical: index >= 2,
      visible: index < visible,
    })),
  };
}

function loadLayout(deps: ActionBarDeps): ActionBarLayout {
  const fallback = defaultLayout(deps);
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(deps.storageKey) ?? "null"); } catch { raw = null; }
  if (!raw || typeof raw !== "object") return fallback;
  const stored = raw as Partial<ActionBarLayout> & { version?: number };
  if (stored.version !== LAYOUT_VERSION || !Array.isArray(stored.bars)) return fallback;
  const known = new Set(deps.catalogue().map((spell) => spell.id));
  const docks = new Set<ActionBarDock>(["bottom", "left", "right", "free"]);
  return {
    locked: stored.locked === true,
    bars: fallback.bars.map((base, index) => {
      const bar = stored.bars?.[index] as Partial<ActionBarState> | undefined;
      if (!bar) return base;
      return {
        slots: Array.from({ length: ACTION_BAR_SLOTS }, (_, slot) => {
          const id = bar.slots?.[slot];
          return typeof id === "string" && known.has(id as SpellId) ? id as SpellId : null;
        }),
        dock: docks.has(bar.dock as ActionBarDock) ? bar.dock as ActionBarDock : base.dock,
        x: Number.isFinite(bar.x) ? Number(bar.x) : 0,
        y: Number.isFinite(bar.y) ? Number(bar.y) : 0,
        vertical: typeof bar.vertical === "boolean" ? bar.vertical : base.vertical,
        visible: index === 0 ? true : typeof bar.visible === "boolean" ? bar.visible : base.visible,
      };
    }),
  };
}
