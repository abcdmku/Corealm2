/**
 * Small-screen and touch layout state, as classes on `#ui-root`.
 *
 * The stylesheet does most of the work through media queries; these classes exist for the parts
 * a media query cannot express. `is-touch` is a preference as much as a capability — a laptop
 * with a touchscreen still has a mouse, and a phone in desktop mode still has thumbs — so it is
 * resolved from the settings store's "auto | on | off" against `(pointer: coarse)`. `is-small`,
 * `is-portrait` and `is-landscape` mirror the media queries so scripts that must know (panel
 * dragging, the title hint, the controls list) read the same answer the stylesheet uses.
 *
 * `layoutState()` is the module-level read for code that has no handle on the layout object. It
 * is updated by whichever `MobileLayout` is live, and defaults to a desktop answer before one is.
 */

/** Phone-sized in either axis. A landscape phone is short, a portrait phone is narrow. */
export const SMALL_SCREEN_QUERY = "(max-width: 760px), (max-height: 480px)";
export const PORTRAIT_QUERY = "(orientation: portrait)";
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export type TouchPreference = "auto" | "on" | "off";

export interface LayoutState {
  /** Phone-sized viewport in at least one axis. */
  small: boolean;
  portrait: boolean;
  /** Touch controls are on: gestures on the canvas, the joystick, and touch-sized chrome. */
  touch: boolean;
}

let current: LayoutState = { small: false, portrait: false, touch: false };

export function layoutState(): LayoutState {
  return { ...current };
}

export function mediaMatches(query: string): boolean {
  const matchMedia = globalThis.matchMedia;
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia.call(globalThis, query).matches;
  } catch {
    return false;
  }
}

export function isSmallScreen(): boolean {
  return mediaMatches(SMALL_SCREEN_QUERY);
}

export function hasCoarsePointer(): boolean {
  return mediaMatches(COARSE_POINTER_QUERY);
}

/** "auto" follows the primary pointer; "on" and "off" are the player's word over the browser's. */
export function resolveTouchPreference(preference: TouchPreference): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return hasCoarsePointer();
}

type Listener = (state: LayoutState) => void;

export class MobileLayout {
  private preference: TouchPreference = "auto";
  private readonly listeners = new Set<Listener>();
  private readonly queries: { list: MediaQueryList; handler: () => void }[] = [];
  private state: LayoutState = { small: false, portrait: false, touch: false };

  constructor(private readonly root: HTMLElement) {
    for (const query of [SMALL_SCREEN_QUERY, PORTRAIT_QUERY, COARSE_POINTER_QUERY]) {
      const list = safeMatchMedia(query);
      if (!list) continue;
      const handler = (): void => this.apply();
      if (typeof list.addEventListener === "function") list.addEventListener("change", handler);
      else if (typeof list.addListener === "function") list.addListener(handler);
      this.queries.push({ list, handler });
    }
    this.apply();
  }

  setTouchPreference(preference: TouchPreference): void {
    if (this.preference === preference) return;
    this.preference = preference;
    this.apply();
  }

  get(): LayoutState {
    return { ...this.state };
  }

  /** Fires at once with the current state, then on every change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.get());
    return () => { this.listeners.delete(listener); };
  }

  private apply(): void {
    const next: LayoutState = {
      small: isSmallScreen(),
      portrait: mediaMatches(PORTRAIT_QUERY),
      touch: resolveTouchPreference(this.preference),
    };
    const classes = this.root.classList;
    classes.toggle("is-small", next.small);
    classes.toggle("is-portrait", next.portrait);
    classes.toggle("is-landscape", !next.portrait);
    classes.toggle("is-touch", next.touch);
    const changed = next.small !== this.state.small || next.portrait !== this.state.portrait
      || next.touch !== this.state.touch;
    this.state = next;
    current = { ...next };
    if (!changed) return;
    for (const listener of this.listeners) listener(this.get());
  }

  dispose(): void {
    for (const { list, handler } of this.queries) {
      if (typeof list.removeEventListener === "function") list.removeEventListener("change", handler);
      else if (typeof list.removeListener === "function") list.removeListener(handler);
    }
    this.queries.length = 0;
    this.listeners.clear();
    for (const name of ["is-small", "is-portrait", "is-landscape", "is-touch"]) this.root.classList.remove(name);
    current = { small: false, portrait: false, touch: false };
  }
}

function safeMatchMedia(query: string): MediaQueryList | null {
  const matchMedia = globalThis.matchMedia;
  if (typeof matchMedia !== "function") return null;
  try {
    return matchMedia.call(globalThis, query);
  } catch {
    return null;
  }
}
