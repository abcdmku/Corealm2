import { PanelFrame } from "./panelFrame.js";
/**
 * Every key the game answers to, read from the live registry.
 *
 * `KeyBindingRegistry.list()` has carried the comment "Shown by a future controls panel" since
 * round 0. This is that panel. It reads the registry rather than a hand-written table, so a binding
 * that is added, moved or lost shows up here without anybody remembering to update a list — which
 * is the only way a controls screen stays true. Bindings come and go at runtime (a panel claims its
 * key in its constructor and gives it back on dispose; a conversation claims number keys only while
 * it is open), so `refresh` re-reads the registry every time instead of caching a snapshot.
 *
 * Two things the registry cannot tell us, and the only two things in here that are written by hand:
 *
 *  - Movement. WASD and the arrows are polled per frame as held keys by `KeyboardController.axes`,
 *    not registered as bindings, because movement is a continuous axis.
 *  - The mouse. `InputController` has its own vocabulary — click, drag, wheel — with no registry
 *    behind it at all.
 *
 * Both are transcribed from `input/keyboard.ts` and `input/mouse.ts`, not from what a game of this
 * shape usually does. Where the code and the convention disagree, the code wins: Shift is read by
 * `isWalking()` but nothing applies it yet, so there is no walk/run line here, and left-drag is
 * deliberately inert rather than a second way to orbit.
 */
import type { KeyBinding } from "../input/keyboard.js";
import { normaliseChord } from "../input/keyboard.js";
import type { ManagedPanel, UiContext } from "./panels.js";


/**
 * How a chord part is drawn on a cap. Anything not in here is title-cased, so a binding that
 * arrives on "f3" or "pageup" still renders as a key rather than as raw event.key spelling.
 */
const CAP_LABELS: Record<string, string> = {
  escape: "Esc",
  space: "Space",
  enter: "Enter",
  tab: "Tab",
  backspace: "Bksp",
  delete: "Del",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Meta",
};

/** Groups the registry is known to use, in reading order. Anything else is appended after. */
const GROUP_ORDER = ["Panels", "General"];

const UNGROUPED = "Other";

interface StaticRow {
  /** One entry per alternative chord; each entry is the caps that make it up. */
  chords: string[][];
  label: string;
}

/**
 * The mouse, straight out of `input/mouse.ts`.
 *
 * `DRAG_THRESHOLD_PX` is 4, so pointer travel past four pixels switches the gesture into drag mode.
 * Left-button world actions begin on press; right-click menus open on release unless the gesture
 * became a drag.
 */
const MOUSE_ROWS: StaticRow[] = [
  {
    chords: [["Left click"]],
    label: "Walk to that spot. On a thing, run its main action — walking into range is part of it.",
  },
  {
    chords: [["Right click"]],
    label: "Everything that thing will let you do, in a menu. On bare ground: Walk here, Stop.",
  },
  {
    chords: [["Right drag"], ["Middle drag"]],
    label: "Swing the camera. Left drag is inert on purpose, so a slipped click never moves your view.",
  },
  {
    chords: [["Wheel"]],
    label: "Zoom in and out.",
  },
  {
    chords: [["Hover"]],
    label: "The cursor label names the thing and the verb a left click would run.",
  },
];

/**
 * Movement, straight out of `input/keyboard.ts`. Held per frame, camera-relative, magnitude
 * normalised in `systems/movement.ts` — so there is exactly one speed and Shift has nothing to
 * attach to yet.
 */
const MOVE_ROWS: StaticRow[] = [
  { chords: [["W"], ["↑"]], label: "Forward, away from the camera." },
  { chords: [["S"], ["↓"]], label: "Back." },
  { chords: [["A"], ["←"]], label: "Step left." },
  { chords: [["D"], ["→"]], label: "Step right." },
];

const HOW_TO_PLAY = [
  "Left click the ground to walk there, or click a tree, a rock or a person to use it — you close the distance on your own.",
  "Right click anything to see everything it will let you do. That menu is the game.",
];

const MOVE_NOTE = "A and D strafe; they do not turn you — turning is the camera's job, on a right drag. Touching any of these drops whatever you clicked your way toward.";

function capLabel(part: string): string {
  const known = CAP_LABELS[part];
  if (known) return known;
  if (part.length === 1) return part.toUpperCase();
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/** "shift+k" becomes ["Shift", "K"]. Normalised first so any registered spelling lands here. */
function chordCaps(spec: string): string[] {
  return normaliseChord(spec).split("+").filter(Boolean).map(capLabel);
}

/** One `<kbd>`. Longer than a single character gets a wider cap so the text is not cramped. */
function capElement(text: string): HTMLElement {
  const cap = document.createElement("kbd");
  cap.className = text.length > 1 ? "controls__cap controls__cap--wide" : "controls__cap";
  cap.textContent = text;
  return cap;
}

export class ControlsPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  /** Rebuilt from the registry on every change. The hand-written sections sit outside it. */
  private readonly dynamic: HTMLElement;
  private signature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "controls",
      title: "Controls",
      key: "h",
      keyLabel: "Controls",
      registry: ctx.registry,
      // Tucked under the purse at the top right and stopping just short of the dock at the bottom
      // right, rather than sliding under either. That is the whole vertical budget; past it the
      // body scrolls, which is also what absorbs a conversation's transient number keys.
      placement: { top: "56px", left: "50%", width: "640px", maxHeight: "calc(100vh - 112px)" },
      group: "center",
      onOpen: () => this.refresh(true),
    });

    const body = document.createElement("div");
    body.className = "controls";
    body.appendChild(this.buildIntro());

    // Two columns: the hand-written half on the left, the registry's half on the right. One column
    // ran to ~880 px, which does not fit 720p and scrolls behind an overlay scrollbar the player
    // cannot see until they are already scrolling. Side by side it fits on screen at both sizes.
    const written = document.createElement("div");
    written.className = "controls__column";
    written.appendChild(this.buildStaticSection("Mouse", MOUSE_ROWS));
    written.appendChild(this.buildStaticSection("Moving", MOVE_ROWS, MOVE_NOTE));

    this.dynamic = document.createElement("div");
    this.dynamic.className = "controls__column controls__dynamic";

    const columns = document.createElement("div");
    columns.className = "controls__columns";
    columns.append(written, this.dynamic);
    body.appendChild(columns);

    this.frame.body.appendChild(body);
  }

  refresh(force = false): void {
    const bindings = this.ctx.registry.list();
    // Group and label are in the signature too: a binding that only moves between groups still
    // changes what this panel should be drawing.
    const signature = bindings
      .map((b) => `${b.id}:${b.keys.join("+")}:${b.group ?? ""}:${b.label}`)
      .join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.dynamic.replaceChildren();
    for (const [group, rows] of this.groupBindings(bindings)) {
      this.dynamic.appendChild(this.buildSection(group, rows));
    }
    this.frame.setSubtitle(`${bindings.length} keys bound`);
  }

  dispose(): void {
    this.frame.dispose();
  }

  // ------------------------------------------------------------------ registry

  /**
   * Bindings by group, groups in reading order.
   *
   * Rows are keyed by chord, not by binding, because several bindings can share one chord: Escape
   * carries both `input.cancel` at priority 900 and `ui.menu` at 950. Two identical Esc caps with
   * different labels reads as a bug. Priority order is a fallback chain — the first binding that
   * consumes the key stops the rest — so the labels are joined in that order with "then", which is
   * what actually happens when you press it.
   */
  private groupBindings(bindings: KeyBinding[]): [string, StaticRow[]][] {
    const groups = new Map<string, Map<string, StaticRow>>();
    for (const binding of bindings) {
      const group = binding.group?.trim() || UNGROUPED;
      const rows = groups.get(group) ?? new Map<string, StaticRow>();
      groups.set(group, rows);

      const chords = binding.keys.map((key) => normaliseChord(key));
      const key = chords.join("|");
      const existing = rows.get(key);
      if (existing) {
        existing.label = `${existing.label}, then ${lowerFirst(binding.label)}`;
        continue;
      }
      rows.set(key, { chords: chords.map(chordCaps), label: binding.label });
    }

    const ordered = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
    return ordered.map((group) => [group, [...(groups.get(group) ?? new Map()).values()]]);
  }

  // -------------------------------------------------------------------- markup

  private buildIntro(): HTMLElement {
    const intro = document.createElement("div");
    intro.className = "controls__intro";
    for (const line of HOW_TO_PLAY) {
      const paragraph = document.createElement("p");
      paragraph.className = "controls__lede";
      paragraph.textContent = line;
      intro.appendChild(paragraph);
    }
    return intro;
  }

  private buildStaticSection(title: string, rows: StaticRow[], note?: string): HTMLElement {
    const section = this.buildSection(title, rows);
    if (note) {
      const line = document.createElement("p");
      line.className = "controls__note";
      line.textContent = note;
      section.appendChild(line);
    }
    return section;
  }

  private buildSection(title: string, rows: StaticRow[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "controls__section";

    const heading = document.createElement("h3");
    heading.className = "controls__heading u-caps u-dim";
    heading.textContent = title;
    section.appendChild(heading);

    for (const row of rows) section.appendChild(this.buildRow(row));
    return section;
  }

  private buildRow(row: StaticRow): HTMLElement {
    const element = document.createElement("div");
    element.className = "controls__row";

    const keys = document.createElement("div");
    keys.className = "controls__keys";
    row.chords.forEach((chord, index) => {
      if (index > 0) keys.appendChild(separator("/"));
      chord.forEach((part, partIndex) => {
        if (partIndex > 0) keys.appendChild(separator("+"));
        keys.appendChild(capElement(part));
      });
    });

    const label = document.createElement("div");
    label.className = "controls__label";
    label.textContent = row.label;

    element.append(keys, label);
    return element;
  }
}

function separator(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "controls__sep";
  span.textContent = text;
  return span;
}

/** "Menu" becomes "menu" when it is being joined onto the end of another label. */
function lowerFirst(text: string): string {
  if (!text) return text;
  // An all-caps word is an acronym, not a sentence start. Leave it alone.
  if (text.slice(0, 2) === text.slice(0, 2).toUpperCase() && /[A-Z]{2}/.test(text.slice(0, 2))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function rank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  if (index >= 0) return index;
  // Unknown groups keep their own order after the known ones; "Other" sinks to the bottom.
  return group === UNGROUPED ? GROUP_ORDER.length + 1 : GROUP_ORDER.length;
}
