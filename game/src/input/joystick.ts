/**
 * The on-screen thumbstick for touch play.
 *
 * It produces the same camera-relative axes as WASD (`KeyboardController.axes()`), and
 * `InputController.update()` folds them through the same `setDirectInput` call, so a thumb on
 * glass and a hand on the keyboard reach the movement system by the identical path.
 *
 * Small on purpose. The base is 96 px and sits low in the left corner; idle it is mostly
 * transparent, and it only brightens under a thumb. A phone screen is the whole game, and a
 * joystick that takes a fifth of it takes a fifth of the world.
 */
import type { MovementAxes } from "./keyboard.js";

export interface VirtualJoystickOptions {
  /** Knob travel in px from the centre. Defaults to the stylesheet's base radius less the knob. */
  radius?: number;
  /** Fraction of the radius below which the stick reads as centred. */
  deadZone?: number;
}

const DEFAULT_RADIUS_PX = 34;
const DEFAULT_DEAD_ZONE = 0.14;

export class VirtualJoystick {
  readonly element: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly radius: number;
  private readonly deadZone: number;
  private pointerId: number | null = null;
  private centreX = 0;
  private centreY = 0;
  private axisX = 0;
  private axisY = 0;

  constructor(options: VirtualJoystickOptions = {}) {
    this.radius = options.radius ?? DEFAULT_RADIUS_PX;
    this.deadZone = options.deadZone ?? DEFAULT_DEAD_ZONE;

    const root = document.createElement("div");
    root.className = "joystick";
    root.setAttribute("role", "slider");
    root.setAttribute("aria-label", "Move");
    root.setAttribute("aria-valuemin", "0");
    root.setAttribute("aria-valuemax", "1");
    root.setAttribute("aria-valuenow", "0");
    root.hidden = true;

    const knob = document.createElement("div");
    knob.className = "joystick__knob";
    root.appendChild(knob);

    root.addEventListener("pointerdown", this.onPointerDown);
    root.addEventListener("pointermove", this.onPointerMove);
    root.addEventListener("pointerup", this.onPointerUp);
    root.addEventListener("pointercancel", this.onPointerUp);
    root.addEventListener("lostpointercapture", this.onPointerUp);

    this.element = root;
    this.knob = knob;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    if (this.element.hidden === !visible) return;
    this.element.hidden = !visible;
    if (!visible) this.clear();
  }

  isVisible(): boolean {
    return !this.element.hidden;
  }

  active(): boolean {
    return this.pointerId !== null;
  }

  /** -1..1 on each axis; forward is up on the stick. Magnitude is clamped to the unit circle. */
  axes(): MovementAxes {
    // `|| 0` folds the negative zero a centred stick would otherwise report.
    return { forward: -this.axisY || 0, strafe: this.axisX || 0 };
  }

  /** Recentres and drops the finger. Blur, reset, and a movement lock all come through here. */
  clear(): void {
    if (this.pointerId !== null) {
      try {
        if (this.element.hasPointerCapture?.(this.pointerId)) this.element.releasePointerCapture(this.pointerId);
      } catch {
        // Already released.
      }
    }
    this.pointerId = null;
    this.setAxes(0, 0);
    this.element.classList.remove("is-active");
  }

  dispose(): void {
    this.clear();
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointercancel", this.onPointerUp);
    this.element.removeEventListener("lostpointercapture", this.onPointerUp);
    this.element.remove();
  }

  // ------------------------------------------------------------------ events

  private onPointerDown = (event: PointerEvent): void => {
    // The stick is a control, never a world click. Stop it here so the canvas never sees it.
    event.stopPropagation();
    event.preventDefault();
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    const rect = this.element.getBoundingClientRect();
    this.centreX = rect.left + rect.width / 2;
    this.centreY = rect.top + rect.height / 2;
    try { this.element.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable. */ }
    this.element.classList.add("is-active");
    this.track(event.clientX, event.clientY);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.track(event.clientX, event.clientY);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.clear();
  };

  private track(clientX: number, clientY: number): void {
    let dx = (clientX - this.centreX) / this.radius;
    let dy = (clientY - this.centreY) / this.radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    if (length < this.deadZone) {
      dx = 0;
      dy = 0;
    }
    this.setAxes(dx, dy);
  }

  private setAxes(x: number, y: number): void {
    this.axisX = x;
    this.axisY = y;
    const px = Math.round(x * this.radius);
    const py = Math.round(y * this.radius);
    this.knob.style.transform = `translate(${px}px, ${py}px)`;
    this.element.setAttribute("aria-valuenow", Math.min(1, Math.hypot(x, y)).toFixed(2));
  }
}
