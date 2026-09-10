/**
 * Placing an area invocation: the reticle follows the pointer, a click casts, right-click or
 * Escape cancels.
 *
 * The session is UI-side glue. It knows nothing about three.js: the host hands it a picker
 * (screen pixel to ground point) and a reticle with show/move/hide, and the cast callback owns the
 * range rule and the actual spell. In range is decided here from the caster's position so the ring
 * can turn red before the click, and the same distance is re-checked by the combat system when the
 * cast is actually asked for.
 *
 * Pointer events are captured on the window during a session, so the canvas underneath never sees
 * the placing click as a walk order and the world's hover picking stands down.
 */
import type { SpellElement, SpellId, Vec3 } from "../contracts.js";

export interface AreaAimHost {
  /** Ground point under a client pixel, or null when the ray misses the world. */
  pickGround(clientX: number, clientY: number): Vec3 | null;
  show(radius: number, element: SpellElement): void;
  move(point: Vec3, inRange: boolean): void;
  hide(): void;
}

export interface AreaAimRequest {
  spellId: SpellId;
  name: string;
  element: SpellElement;
  /** Ring radius in metres: the invocation's furthest pulse edge. */
  radius: number;
  /** Furthest the aim point may be from the caster, in metres. */
  range: number;
}

export interface AreaAimDeps {
  host: AreaAimHost;
  casterPosition(): Vec3;
  /** Asked once per accepted click. Returns false to keep aiming (the cast was refused). */
  cast(spellId: SpellId, point: Vec3): boolean;
  notify?(message: string): void;
}

export interface AreaAimSession {
  begin(request: AreaAimRequest): void;
  cancel(): void;
  /** The spell being placed, or null. */
  active(): SpellId | null;
  /** Re-samples range against the caster's current position; call from the UI tick. */
  update(): void;
  dispose(): void;
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function createAreaAimSession(deps: AreaAimDeps): AreaAimSession {
  let current: AreaAimRequest | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let lastPoint: Vec3 | null = null;

  const inRange = (point: Vec3): boolean => !!current && distanceXZ(deps.casterPosition(), point) <= current.range;

  const track = (clientX: number, clientY: number): void => {
    if (!current) return;
    lastPointer = { x: clientX, y: clientY };
    const point = deps.host.pickGround(clientX, clientY);
    lastPoint = point;
    if (point) deps.host.move(point, inRange(point));
  };

  const onMove = (event: PointerEvent): void => { track(event.clientX, event.clientY); };
  // Always know where the pointer is, so a key press puts the ring under it on the first frame
  // rather than at the world origin until the hand moves.
  const remember = (event: PointerEvent): void => { if (!current) lastPointer = { x: event.clientX, y: event.clientY }; };
  window.addEventListener("pointermove", remember, { passive: true });

  const onDown = (event: PointerEvent): void => {
    if (!current) return;
    // The placing click never reaches the canvas: no walk order, no hover pick, no context menu.
    event.stopPropagation();
    event.preventDefault();
    if (event.button === 2) { cancel(); return; }
    if (event.button !== 0) return;
    track(event.clientX, event.clientY);
    const point = lastPoint;
    if (!point) return;
    if (!inRange(point)) {
      deps.notify?.(`${current.name} reaches ${current.range} m. Move closer or pick a nearer spot.`);
      return;
    }
    const request = current;
    if (deps.cast(request.spellId, point)) cancel();
  };

  const swallow = (event: Event): void => {
    if (!current) return;
    event.stopPropagation();
    event.preventDefault();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!current || event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    cancel();
  };

  function listen(on: boolean): void {
    const method = on ? "addEventListener" : "removeEventListener";
    window[method]("pointermove", onMove as EventListener, true);
    window[method]("pointerdown", onDown as EventListener, true);
    window[method]("pointerup", swallow, true);
    window[method]("click", swallow, true);
    window[method]("contextmenu", swallow, true);
    window[method]("keydown", onKey as EventListener, true);
  }

  function cancel(): void {
    if (!current) return;
    current = null;
    lastPoint = null;
    deps.host.hide();
    listen(false);
    document.body.classList.remove("is-aiming");
  }

  return {
    begin(request) {
      if (current) cancel();
      current = request;
      deps.host.show(request.radius, request.element);
      document.body.classList.add("is-aiming");
      listen(true);
      if (lastPointer) track(lastPointer.x, lastPointer.y);
      deps.notify?.(`Click where ${request.name} should land. Right-click or Escape to cancel.`);
    },
    cancel,
    active: () => current?.spellId ?? null,
    update() {
      if (current && lastPointer) track(lastPointer.x, lastPointer.y);
    },
    dispose() {
      cancel();
      window.removeEventListener("pointermove", remember);
    },
  };
}
