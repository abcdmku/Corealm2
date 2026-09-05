/**
 * Keyboard input: direct movement, cancel, and the keybinding registry every later panel hangs off.
 *
 * Two separate concerns live here on purpose.
 *
 *  - Held keys (WASD, arrows, Shift) are polled once per frame, because movement is a continuous
 *    axis and edge-triggered events would stutter it.
 *  - Everything else is edge-triggered through `KeyBindingRegistry`, which is the ONLY way a panel
 *    should claim a key. This file deliberately does not know that `I` is inventory or `J` is
 *    quests — those panels do not exist yet, and a key table owned by the input layer becomes a
 *    merge conflict the moment two workers add a panel in the same round.
 *
 * Cancel routes through `GameApi.stop()` like everything else. No direct store access anywhere.
 */
import type { EntityId, GameApi } from "../contracts.js";
import { reportResult } from "../ui/contextMenu.js";

// --------------------------------------------------------------- chord parsing

/**
 * Canonical chord form: modifiers in a fixed order, then the key, lower case.
 * "shift+k", "ctrl+alt+delete", "escape", "f3", "1", "space".
 */
export function normaliseChord(spec: string): string {
  const parts = spec.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop() ?? "";
  const flags = new Set(parts);
  return buildChord(key === "" ? " " : key, {
    ctrl: flags.has("ctrl") || flags.has("control"),
    alt: flags.has("alt") || flags.has("option"),
    shift: flags.has("shift"),
    meta: flags.has("meta") || flags.has("cmd") || flags.has("super"),
  });
}

export function chordFromEvent(event: KeyboardEvent): string {
  return buildChord(event.key, {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  });
}

interface Modifiers { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }

function buildChord(rawKey: string, modifiers: Modifiers): string {
  const key = normaliseKeyName(rawKey);
  let chord = "";
  if (modifiers.ctrl) chord += "ctrl+";
  if (modifiers.alt) chord += "alt+";
  // A bare modifier keypress is a chord of itself, not "shift+shift".
  if (modifiers.shift && key !== "shift") chord += "shift+";
  if (modifiers.meta) chord += "meta+";
  return chord + key;
}

function normaliseKeyName(key: string): string {
  if (key === " " || key.toLowerCase() === "spacebar") return "space";
  return key.toLowerCase();
}

/**
 * Game keys must not fire while the player is typing a bank filter or a chat line. Buttons and
 * checkboxes are excluded because they are not text entry and Space should still reach them.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  // The registry is unit-testable outside a DOM, where these globals do not exist.
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    const type = target.type.toLowerCase();
    return type !== "button" && type !== "checkbox" && type !== "radio"
      && type !== "submit" && type !== "reset" && type !== "range";
  }
  return false;
}

// ------------------------------------------------------------- the registry

export interface KeyBinding {
  /** Stable id, e.g. "panel.inventory". Registering the same id twice replaces the first. */
  id: string;
  /** Chords, in any readable spelling: ["i"], ["shift+k"], ["f3"]. */
  keys: readonly string[];
  /** Shown by a future controls panel. Keep it human. */
  label: string;
  /** Grouping for that panel: "Panels", "Combat", "Camera". */
  group?: string;
  /** Lower runs first when several bindings share a chord. Default 100. */
  priority?: number;
  /** Fire while a text field has focus. Default false. */
  allowInInput?: boolean;
  /** Fire on OS auto-repeat. Default false. */
  allowRepeat?: boolean;
  /** Return true to consume the key and stop lower-priority bindings from seeing it. */
  onDown(event: KeyboardEvent): boolean | void;
  onUp?(event: KeyboardEvent): void;
}

/** Returned by `register`. Call it in the panel's teardown. */
export type Unregister = () => void;

export class KeyBindingRegistry {
  private readonly bindings = new Map<string, KeyBinding>();
  /** Chord -> binding ids, kept sorted by priority so dispatch is a straight walk. */
  private readonly byChord = new Map<string, string[]>();
  private readonly escapeStack: (() => boolean)[] = [];

  register(binding: KeyBinding): Unregister {
    this.unregister(binding.id);
    this.bindings.set(binding.id, binding);
    for (const key of binding.keys) {
      const chord = normaliseChord(key);
      const ids = this.byChord.get(chord) ?? [];
      ids.push(binding.id);
      ids.sort((a, b) => this.priorityOf(a) - this.priorityOf(b));
      this.byChord.set(chord, ids);
    }
    return () => this.unregister(binding.id);
  }

  unregister(id: string): void {
    if (!this.bindings.delete(id)) return;
    for (const [chord, ids] of this.byChord) {
      const next = ids.filter((entry) => entry !== id);
      if (next.length === 0) this.byChord.delete(chord);
      else this.byChord.set(chord, next);
    }
  }

  get(id: string): KeyBinding | undefined {
    return this.bindings.get(id);
  }

  /** For a controls panel, and for the debug surface to list what is bound. */
  list(): KeyBinding[] {
    return [...this.bindings.values()].sort((a, b) => this.priorityOf(a.id) - this.priorityOf(b.id));
  }

  /**
   * Panels push a closer here. Escape pops the top one before falling through to cancelling the
   * activity, which is the PRD's rule: "close the top panel, otherwise cancel".
   * The handler returns true when it consumed the Escape.
   */
  pushEscapeHandler(handler: () => boolean): Unregister {
    this.escapeStack.push(handler);
    return () => {
      const index = this.escapeStack.lastIndexOf(handler);
      if (index >= 0) this.escapeStack.splice(index, 1);
    };
  }

  /** Runs the top-most escape handler that claims the event. */
  runEscapeStack(): boolean {
    for (let i = this.escapeStack.length - 1; i >= 0; i -= 1) {
      const handler = this.escapeStack[i];
      if (handler && handler()) return true;
    }
    return false;
  }

  /** Returns true when a binding consumed the event. */
  handleKeyDown(event: KeyboardEvent): boolean {
    const inText = isTextEntry(event.target);
    for (const binding of this.matching(chordFromEvent(event))) {
      if (inText && !binding.allowInInput) continue;
      if (event.repeat && !binding.allowRepeat) continue;
      if (binding.onDown(event) === true) return true;
    }
    return false;
  }

  handleKeyUp(event: KeyboardEvent): void {
    const inText = isTextEntry(event.target);
    for (const binding of this.matching(chordFromEvent(event))) {
      if (inText && !binding.allowInInput) continue;
      binding.onUp?.(event);
    }
  }

  private matching(chord: string): KeyBinding[] {
    const ids = this.byChord.get(chord) ?? [];
    const out: KeyBinding[] = [];
    for (const id of ids) {
      const binding = this.bindings.get(id);
      if (binding) out.push(binding);
    }
    return out;
  }

  private priorityOf(id: string): number {
    return this.bindings.get(id)?.priority ?? 100;
  }
}

/**
 * The shared registry. Panels created anywhere can `import { keybindings }` and claim a key without
 * the root threading a reference through six constructors.
 */
export const keybindings = new KeyBindingRegistry();

// ------------------------------------------------------------- the controller

/** Held keys, by canonical name. Modifier state is read off the event, not tracked here. */
const MOVE_FORWARD = ["w", "arrowup"] as const;
const MOVE_BACK = ["s", "arrowdown"] as const;
const MOVE_LEFT = ["a", "arrowleft"] as const;
const MOVE_RIGHT = ["d", "arrowright"] as const;

export interface MovementAxes {
  /** -1 back .. 1 forward, camera-relative. */
  forward: number;
  /** -1 left .. 1 right. */
  strafe: number;
}

export interface KeyboardControllerOptions {
  api: GameApi;
  registry?: KeyBindingRegistry;
  /** Defaults to `window`. */
  target?: Window | HTMLElement;
  /** Space acts on the hovered entity, falling back to the selected one. Wired by the mouse layer. */
  getActionTargetId?: () => EntityId | null;
  /** Runs the target's primary interaction. Wired by the mouse layer so both routes agree. */
  activateTarget?: () => void;
}

export class KeyboardController {
  readonly registry: KeyBindingRegistry;

  private readonly held = new Set<string>();
  private readonly disposers: Unregister[] = [];
  /** Widened to EventTarget: a Window|HTMLElement union has no callable addEventListener. */
  private readonly target: EventTarget;
  private shift = false;

  constructor(private readonly options: KeyboardControllerOptions) {
    this.registry = options.registry ?? keybindings;
    this.target = options.target ?? window;

    this.target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.target.addEventListener("keyup", this.onKeyUp as EventListener);
    window.addEventListener("blur", this.onBlur);

    this.installDefaults();
  }

  /**
   * The only keys this layer owns. Panel keys belong to their panels; movement and cancel belong
   * to the input layer because nothing else can own them.
   */
  private installDefaults(): void {
    this.disposers.push(this.registry.register({
      id: "input.cancel",
      keys: ["escape"],
      label: "Close panel / cancel action",
      group: "General",
      allowInInput: true,
      // Runs last: a panel that pushed an escape handler, or the context menu, gets first refusal.
      priority: 900,
      onDown: () => {
        if (this.registry.runEscapeStack()) return true;
        const result = this.options.api.stop();
        if (!result.ok) {
          reportResult(result);
          return true;
        }
        // Cancelling an action and opening the pause menu are one Escape press. Falling through
        // lets `ui.menu` run after the stop, while an open panel still consumes the key above.
        return false;
      },
    }));

    this.disposers.push(this.registry.register({
      id: "input.interact",
      keys: ["space"],
      label: "Use the thing under the cursor",
      group: "General",
      priority: 200,
      onDown: (event) => {
        // Focused controls own Space, including native button activation on keyup.
        if (typeof Element !== "undefined" && event.target instanceof Element
          && event.target.closest("button, input, select, textarea, a[href], summary, [role='button']")) return false;
        const activate = this.options.activateTarget;
        if (!activate) return false;
        if (!this.options.getActionTargetId?.()) return false;
        // A world interaction must not also scroll the page.
        event.preventDefault();
        activate();
        return true;
      },
    }));
  }

  /** Camera-relative axes for this frame. The mouse layer adds the camera yaw. */
  axes(): MovementAxes {
    const forward = (this.anyHeld(MOVE_FORWARD) ? 1 : 0) - (this.anyHeld(MOVE_BACK) ? 1 : 0);
    const strafe = (this.anyHeld(MOVE_RIGHT) ? 1 : 0) - (this.anyHeld(MOVE_LEFT) ? 1 : 0);
    return { forward, strafe };
  }

  isHeld(key: string): boolean {
    return this.held.has(normaliseKeyName(key));
  }

  /**
   * Shift-to-walk is read here but not yet applied: `Movement.setDirectInput` normalises the axis
   * magnitude to 1, so there is no speed channel to attach it to. Left exposed so the round that
   * adds a speed scale can use it without another input change.
   */
  isWalking(): boolean {
    return this.shift;
  }

  /** Drops all held keys. Called on blur, on reset, and whenever focus leaves the canvas. */
  clear(): void {
    this.held.clear();
    this.shift = false;
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
    window.removeEventListener("blur", this.onBlur);
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.clear();
  }

  private anyHeld(keys: readonly string[]): boolean {
    for (const key of keys) if (this.held.has(key)) return true;
    return false;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // Map and menu handlers may consume a key before it bubbles to this controller.
    if (event.defaultPrevented) return;
    if (isTextEntry(event.target)) {
      // Typing a bank filter must never walk the player into a wall.
      this.clear();
      if (this.registry.handleKeyDown(event)) event.preventDefault();
      return;
    }
    this.shift = event.shiftKey;
    this.held.add(normaliseKeyName(event.key));
    if (this.registry.handleKeyDown(event)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.shift = event.shiftKey;
    this.held.delete(normaliseKeyName(event.key));
    this.registry.handleKeyUp(event);
  };

  private onBlur = (): void => this.clear();
}
