/**
 * Touch gesture recognition for the world canvas.
 *
 * A finger is not a mouse: it has no hover, no second button and no wheel, and the first contact
 * cannot be acted on immediately because it might be the start of a two-finger gesture. So touch
 * pointers are recognised here and reported as intents, and `InputController` maps each intent
 * onto the same action a mouse would have reached:
 *
 *   tap                 → left click (walk, or the thing's main action)
 *   long press          → right click (the context menu)
 *   one-finger drag     → orbit the camera
 *   two-finger drag     → orbit the camera
 *   pinch               → zoom
 *
 * The recogniser owns no DOM listeners and no timers beyond the long-press one, so it can be
 * driven by synthetic events in a test exactly as the browser drives it.
 */

export interface TouchPoint {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface TouchGestureHandlers {
  onTap(clientX: number, clientY: number): void;
  onLongPress(clientX: number, clientY: number): void;
  /** Pixel deltas since the previous move of the same gesture. */
  onOrbit(deltaX: number, deltaY: number): void;
  /** Change in the distance between two fingers, in pixels. Positive is spreading apart. */
  onPinch(deltaPx: number): void;
  /** Every finger has lifted. */
  onEnd?(): void;
}

export interface TouchGestureOptions {
  /** Hold still this long and the press becomes a long press. */
  longPressMs?: number;
  /** Travel beyond this and a press becomes a drag; a tap must stay inside it. */
  slopPx?: number;
}

export const LONG_PRESS_MS = 450;
export const TAP_SLOP_PX = 12;

type Mode = "idle" | "pending" | "orbit" | "pinch" | "done";

interface Tracked {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export class TouchGestures {
  private readonly pointers = new Map<number, Tracked>();
  private order: number[] = [];
  private mode: Mode = "idle";
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastSpan = 0;
  private readonly longPressMs: number;
  private readonly slopPx: number;

  constructor(private readonly handlers: TouchGestureHandlers, options: TouchGestureOptions = {}) {
    this.longPressMs = options.longPressMs ?? LONG_PRESS_MS;
    this.slopPx = options.slopPx ?? TAP_SLOP_PX;
  }

  /** True while this pointer is part of a gesture, so the caller can route its later events. */
  tracks(pointerId: number): boolean {
    return this.pointers.has(pointerId);
  }

  active(): boolean {
    return this.pointers.size > 0;
  }

  down(point: TouchPoint): void {
    if (this.pointers.has(point.pointerId)) return;
    this.pointers.set(point.pointerId, {
      x: point.clientX, y: point.clientY, startX: point.clientX, startY: point.clientY,
    });
    this.order.push(point.pointerId);

    if (this.pointers.size === 1) {
      this.mode = "pending";
      this.lastX = point.clientX;
      this.lastY = point.clientY;
      this.startLongPress(point.pointerId);
      return;
    }
    if (this.pointers.size === 2) {
      // A second finger settles it: this is a camera gesture, whatever the first finger was doing.
      this.clearLongPress();
      this.mode = "pinch";
      const [a, b] = this.firstTwo();
      this.lastX = (a.x + b.x) / 2;
      this.lastY = (a.y + b.y) / 2;
      this.lastSpan = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  move(point: TouchPoint): void {
    const tracked = this.pointers.get(point.pointerId);
    if (!tracked) return;
    tracked.x = point.clientX;
    tracked.y = point.clientY;

    if (this.mode === "pending") {
      if (Math.hypot(tracked.x - tracked.startX, tracked.y - tracked.startY) <= this.slopPx) return;
      this.clearLongPress();
      this.mode = "orbit";
      this.lastX = tracked.x;
      this.lastY = tracked.y;
      return;
    }

    if (this.mode === "orbit") {
      if (point.pointerId !== this.order[0]) return;
      const dx = tracked.x - this.lastX;
      const dy = tracked.y - this.lastY;
      this.lastX = tracked.x;
      this.lastY = tracked.y;
      if (dx !== 0 || dy !== 0) this.handlers.onOrbit(dx, dy);
      return;
    }

    if (this.mode === "pinch") {
      const [a, b] = this.firstTwo();
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      const dx = cx - this.lastX;
      const dy = cy - this.lastY;
      const dSpan = span - this.lastSpan;
      this.lastX = cx;
      this.lastY = cy;
      this.lastSpan = span;
      if (dx !== 0 || dy !== 0) this.handlers.onOrbit(dx, dy);
      if (dSpan !== 0) this.handlers.onPinch(dSpan);
    }
  }

  up(point: TouchPoint): void {
    const tracked = this.pointers.get(point.pointerId);
    if (!tracked) return;
    if (this.mode === "pending") {
      // Released before the hold matured and without travelling: a tap, at the lift point.
      this.clearLongPress();
      this.mode = "done";
      this.handlers.onTap(point.clientX, point.clientY);
    }
    this.forget(point.pointerId);
  }

  cancel(point: TouchPoint): void {
    if (!this.pointers.has(point.pointerId)) return;
    this.clearLongPress();
    if (this.mode === "pending") this.mode = "done";
    this.forget(point.pointerId);
  }

  /** Drops every finger without reporting anything. Blur, reset, and dispose use this. */
  reset(): void {
    this.clearLongPress();
    this.pointers.clear();
    this.order = [];
    this.mode = "idle";
  }

  dispose(): void {
    this.reset();
  }

  // ------------------------------------------------------------------ internals

  private forget(pointerId: number): void {
    this.pointers.delete(pointerId);
    this.order = this.order.filter((id) => id !== pointerId);
    if (this.pointers.size === 0) {
      this.mode = "idle";
      this.handlers.onEnd?.();
      return;
    }
    if (this.mode === "pinch" && this.pointers.size === 1) {
      // One finger left of a pinch keeps orbiting from where it is, with no jump.
      const remaining = this.pointers.get(this.order[0] ?? -1);
      if (remaining) {
        this.mode = "orbit";
        this.lastX = remaining.x;
        this.lastY = remaining.y;
      }
    }
  }

  private firstTwo(): [Tracked, Tracked] {
    const a = this.pointers.get(this.order[0] ?? -1);
    const b = this.pointers.get(this.order[1] ?? -1);
    // Only called with two or more fingers tracked; the fallback keeps the types honest.
    const zero: Tracked = { x: 0, y: 0, startX: 0, startY: 0 };
    return [a ?? zero, b ?? zero];
  }

  private startLongPress(pointerId: number): void {
    this.clearLongPress();
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const tracked = this.pointers.get(pointerId);
      if (!tracked || this.mode !== "pending") return;
      this.mode = "done";
      this.handlers.onLongPress(tracked.x, tracked.y);
    }, this.longPressMs);
  }

  private clearLongPress(): void {
    if (this.longPressTimer === null) return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }
}
