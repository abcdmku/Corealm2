/**
 * When a hover card may open, and the one press that takes every open popover away.
 *
 * A finger has no hover. Touch fires `pointerenter` on the way down, and the matching
 * `pointerleave` never arrives when the press lands on something that repaints or when the canvas
 * calls `preventDefault` on the tap — which `input/mouse.ts` does for every touch, so the focused
 * button never blurs either. The result on a phone was an item card and a "Press I to open" card
 * left standing over the world with no hover left to come and clear them.
 *
 * So hover cards are a mouse and keyboard affordance, and there are exactly two rules:
 *
 *  - A touch pointer never opens one, and neither does the focus a press leaves behind; only a
 *    real hover or a keyboard focus ring (`:focus-visible`) does.
 *  - Any press outside the anchor closes whatever is open, whichever pointer made it. Popovers
 *    that are not hover cards — the loot grid — register on the same press so one tap away from
 *    the world clears the screen.
 */

/** Told where the pointer went down; closes itself unless that was its own. */
export type PressDismissal = (target: Node | null) => void;

/** Past this the gesture was a drag — an orbit of the camera, not "I am done with that". */
const TAP_SLOP_PX = 10;

const pressDismissals = new Set<PressDismissal>();
/** Each tap dismissal remembers the press it was born under, so that press cannot close it. */
const tapDismissals = new Map<PressDismissal, number>();
let listening = false;
let downTarget: Node | null = null;
let downX = 0;
let downY = 0;
let tracking = false;
let presses = 0;

const onWindowPointerDown = (event: Event): void => {
  const press = event as PointerEvent;
  downTarget = event.target instanceof Node ? event.target : null;
  downX = press.clientX;
  downY = press.clientY;
  tracking = true;
  presses += 1;
  // A copy: a dismissal is free to unregister itself while closing.
  for (const dismiss of [...pressDismissals]) dismiss(downTarget);
};

const onWindowPointerUp = (event: Event): void => {
  if (!tracking) return;
  tracking = false;
  const release = event as PointerEvent;
  if (Math.hypot(release.clientX - downX, release.clientY - downY) > TAP_SLOP_PX) return;
  for (const [dismiss, born] of [...tapDismissals]) {
    // The click that opened the popover resolves between its own down and up. Its release is the
    // end of that gesture, not a new one, so it never closes what it just opened.
    if (born < presses) dismiss(downTarget);
  }
};

const onWindowPointerCancel = (): void => { tracking = false; };

function listen(): void {
  // Headless renders of a tooltip (the item-label tests) have a window without listeners on it.
  if (listening || typeof window?.addEventListener !== "function") return;
  listening = true;
  window.addEventListener("pointerdown", onWindowPointerDown, true);
  window.addEventListener("pointerup", onWindowPointerUp, true);
  window.addEventListener("pointercancel", onWindowPointerCancel, true);
}

/**
 * Closes a popover the moment a pointer goes down outside it. Capture phase, so a panel that
 * stops propagation on its own pointers cannot keep a stale card alive behind it.
 */
export function onPressElsewhere(dismiss: PressDismissal): () => void {
  pressDismissals.add(dismiss);
  listen();
  return () => { pressDismissals.delete(dismiss); };
}

/**
 * Closes a popover on a tap or click outside it, and leaves it alone for a drag: swinging the
 * camera round to look at the pile is not the same gesture as walking away from it.
 */
export function onTapElsewhere(dismiss: PressDismissal): () => void {
  tapDismissals.set(dismiss, presses);
  listen();
  return () => { tapDismissals.delete(dismiss); };
}

/** True when the press that focused this element should not also open its hover card. */
function focusWantsCard(target: Element): boolean {
  try {
    return target.matches(":focus-visible");
  } catch {
    // Older engines and jsdom: a focused element is focused, and there is no press to blame.
    return true;
  }
}

export interface HoverTriggers {
  show(): void;
  hide(): void;
}

/** Wires the show/hide triggers a hover card is allowed to have. Returns the detach. */
export function attachHoverTriggers(target: Element, triggers: HoverTriggers): () => void {
  const onEnter = (event: Event): void => {
    if (event instanceof PointerEvent && event.pointerType === "touch") return;
    triggers.show();
  };
  const onLeave = (): void => triggers.hide();
  const onFocus = (): void => { if (focusWantsCard(target)) triggers.show(); };

  target.addEventListener("pointerenter", onEnter);
  target.addEventListener("pointerleave", onLeave);
  target.addEventListener("pointercancel", onLeave);
  target.addEventListener("focus", onFocus);
  target.addEventListener("blur", onLeave);

  return (): void => {
    target.removeEventListener("pointerenter", onEnter);
    target.removeEventListener("pointerleave", onLeave);
    target.removeEventListener("pointercancel", onLeave);
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("blur", onLeave);
  };
}
