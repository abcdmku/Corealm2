import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GameApi, Result, Vec3 } from "../game/src/contracts.js";
import { InputController } from "../game/src/input/mouse.js";
import { TouchGestures } from "../game/src/input/touch.js";
import { VirtualJoystick } from "../game/src/input/joystick.js";
import { FakeElement, installFakeDocument } from "./fake-dom.js";

// ------------------------------------------------------------------ recogniser

function gestureHarness(options: { longPressMs?: number; slopPx?: number } = {}) {
  const handlers = {
    onTap: vi.fn(),
    onLongPress: vi.fn(),
    onOrbit: vi.fn(),
    onPinch: vi.fn(),
    onEnd: vi.fn(),
  };
  const gestures = new TouchGestures(handlers, { longPressMs: 100, slopPx: 10, ...options });
  return { handlers, gestures };
}

describe("touch gesture recognition", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a short still press as a tap at the lift point", () => {
    vi.useFakeTimers();
    const { handlers, gestures } = gestureHarness();
    gestures.down({ pointerId: 1, clientX: 100, clientY: 100 });
    gestures.move({ pointerId: 1, clientX: 103, clientY: 102 });
    gestures.up({ pointerId: 1, clientX: 103, clientY: 102 });
    expect(handlers.onTap).toHaveBeenCalledWith(103, 102);
    expect(handlers.onLongPress).not.toHaveBeenCalled();
    expect(handlers.onOrbit).not.toHaveBeenCalled();
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
    expect(gestures.active()).toBe(false);
    vi.runAllTimers();
    expect(handlers.onLongPress).not.toHaveBeenCalled();
  });

  it("turns a held still press into a long press and never a tap", () => {
    vi.useFakeTimers();
    const { handlers, gestures } = gestureHarness();
    gestures.down({ pointerId: 1, clientX: 50, clientY: 60 });
    vi.advanceTimersByTime(120);
    expect(handlers.onLongPress).toHaveBeenCalledWith(50, 60);
    gestures.up({ pointerId: 1, clientX: 50, clientY: 60 });
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it("turns travel beyond the slop into an orbit drag and cancels the hold", () => {
    vi.useFakeTimers();
    const { handlers, gestures } = gestureHarness();
    gestures.down({ pointerId: 1, clientX: 100, clientY: 100 });
    gestures.move({ pointerId: 1, clientX: 130, clientY: 100 });
    gestures.move({ pointerId: 1, clientX: 140, clientY: 106 });
    vi.advanceTimersByTime(200);
    expect(handlers.onLongPress).not.toHaveBeenCalled();
    expect(handlers.onOrbit).toHaveBeenCalledWith(10, 6);
    gestures.up({ pointerId: 1, clientX: 140, clientY: 106 });
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it("treats two fingers as pinch plus orbit and drops back to orbit when one lifts", () => {
    vi.useFakeTimers();
    const { handlers, gestures } = gestureHarness();
    gestures.down({ pointerId: 1, clientX: 100, clientY: 100 });
    gestures.down({ pointerId: 2, clientX: 200, clientY: 100 });
    vi.advanceTimersByTime(200);
    expect(handlers.onLongPress).not.toHaveBeenCalled();

    // Spread the second finger 40 px further out and shift the pair down 10 px.
    gestures.move({ pointerId: 2, clientX: 240, clientY: 120 });
    expect(handlers.onPinch).toHaveBeenLastCalledWith(expect.closeTo(Math.hypot(140, 20) - 100, 6));
    expect(handlers.onOrbit).toHaveBeenLastCalledWith(20, 10);

    gestures.up({ pointerId: 2, clientX: 240, clientY: 120 });
    expect(handlers.onTap).not.toHaveBeenCalled();
    handlers.onOrbit.mockClear();
    gestures.move({ pointerId: 1, clientX: 90, clientY: 95 });
    expect(handlers.onOrbit).toHaveBeenCalledWith(-10, -5);
    gestures.up({ pointerId: 1, clientX: 90, clientY: 95 });
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores pointers it never saw go down", () => {
    const { handlers, gestures } = gestureHarness();
    gestures.move({ pointerId: 9, clientX: 1, clientY: 1 });
    gestures.up({ pointerId: 9, clientX: 1, clientY: 1 });
    expect(handlers.onTap).not.toHaveBeenCalled();
    expect(gestures.tracks(9)).toBe(false);
  });
});

// ---------------------------------------------------------------- controller

class TestCanvas extends EventTarget {
  readonly classList = { toggle: vi.fn() };
  readonly clientHeight = 600;

  getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;
  }

  setPointerCapture(): void {}
  hasPointerCapture(): boolean { return false; }
  releasePointerCapture(): void {}
}

function pointerEvent(type: string, values: Partial<PointerEventInit> = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    pointerType: "touch",
    ...values,
  });
  return event as PointerEvent;
}

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function controllerHarness() {
  const windowTarget = new EventTarget() as EventTarget & { innerWidth: number; innerHeight: number };
  windowTarget.innerWidth = 800;
  windowTarget.innerHeight = 600;
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("navigator", { vibrate: vi.fn() });
  installFakeDocument();

  const canvas = new TestCanvas();
  const camera = new THREE.PerspectiveCamera();
  const movement = { setDirectInput: vi.fn() };
  const orbit = { yaw: 0, rotate: vi.fn(), zoom: vi.fn(), panPixels: vi.fn() };
  const destinations: Vec3[] = [];
  const api = {
    moveTo: vi.fn(() => success({ pathLength: 10, etaMs: 1000 })),
    getPlayer: vi.fn(() => ({ position: [0, 0, 0] })),
    inspect: vi.fn(() => ({ ok: false, error: { code: "NOT_FOUND", message: "no" } })),
    interact: vi.fn(),
    stop: vi.fn(() => success(undefined)),
  } as unknown as GameApi;
  const input = new InputController(
    canvas as unknown as HTMLCanvasElement,
    { camera, scene: new THREE.Scene() },
    orbit,
    api,
    movement,
    { onWalkDestination: (point) => destinations.push(point), uiRoot: null },
  );
  cleanups.push(() => input.dispose());
  input.picker.setGroundSource(() => ({ entityId: null, point: [5, 0, 5] as Vec3, distance: 1 }));
  return { windowTarget, canvas, input, api, orbit, movement, destinations };
}

describe("touch play on the input controller", () => {
  it("is inert until switched on: a touch pointer acts like a mouse", () => {
    const { canvas, api } = controllerHarness();
    canvas.dispatchEvent(pointerEvent("pointerdown"));
    // The mouse path acts on press, as it always has.
    expect(api.moveTo).toHaveBeenCalledTimes(1);
  });

  it("walks on the lift of a tap, not on the press", () => {
    vi.useFakeTimers();
    const { canvas, windowTarget, input, api, destinations } = controllerHarness();
    input.setTouchControls(true);

    canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 120, clientY: 140 }));
    expect(api.moveTo).not.toHaveBeenCalled();
    windowTarget.dispatchEvent(pointerEvent("pointerup", { clientX: 120, clientY: 140 }));
    expect(api.moveTo).toHaveBeenCalledTimes(1);
    expect(destinations).toEqual([[5, 0, 5]]);
  });

  it("opens the context menu on a long press and does not walk", () => {
    vi.useFakeTimers();
    const { canvas, windowTarget, input, api } = controllerHarness();
    input.setTouchControls(true);
    // The menu's own DOM is the browser gate's business; here only the call matters.
    const openForGround = vi.spyOn(input.contextMenu, "openForGround").mockImplementation(() => {});

    canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 200, clientY: 200 }));
    vi.advanceTimersByTime(600);
    expect(openForGround).toHaveBeenCalledWith([5, 0, 5], 200, 200, expect.objectContaining({ movementEnabled: true }));
    windowTarget.dispatchEvent(pointerEvent("pointerup", { clientX: 200, clientY: 200 }));
    expect(api.moveTo).not.toHaveBeenCalled();
  });

  it("orbits on a one-finger drag and zooms on a pinch", () => {
    vi.useFakeTimers();
    const { canvas, windowTarget, input, orbit, api } = controllerHarness();
    input.setTouchControls(true);

    canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100 }));
    windowTarget.dispatchEvent(pointerEvent("pointermove", { clientX: 130, clientY: 100 }));
    windowTarget.dispatchEvent(pointerEvent("pointermove", { clientX: 150, clientY: 110 }));
    expect(orbit.rotate).toHaveBeenCalledTimes(1);
    const [yaw, pitch] = orbit.rotate.mock.calls[0] as [number, number];
    expect(yaw).toBeLessThan(0);
    expect(pitch).toBeLessThan(0);

    canvas.dispatchEvent(pointerEvent("pointerdown", { pointerId: 2, clientX: 300, clientY: 110 }));
    windowTarget.dispatchEvent(pointerEvent("pointermove", { pointerId: 2, clientX: 360, clientY: 110 }));
    expect(orbit.zoom).toHaveBeenCalledTimes(1);
    // Spreading the fingers pulls the camera in.
    expect((orbit.zoom.mock.calls[0] as [number])[0]).toBeLessThan(0);

    windowTarget.dispatchEvent(pointerEvent("pointerup", { pointerId: 2, clientX: 360, clientY: 110 }));
    windowTarget.dispatchEvent(pointerEvent("pointerup", { clientX: 150, clientY: 110 }));
    expect(api.moveTo).not.toHaveBeenCalled();
  });

  it("switching touch off returns the finger to the mouse path", () => {
    const { canvas, input, api } = controllerHarness();
    input.setTouchControls(true);
    input.setTouchControls(false);
    canvas.dispatchEvent(pointerEvent("pointerdown"));
    expect(api.moveTo).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------- joystick

function joystickPointer(type: string, values: Partial<PointerEventInit> = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 7, clientX: 50, clientY: 50, ...values });
  return event as PointerEvent;
}

describe("virtual joystick", () => {
  it("reads camera-relative axes from the thumb offset, clamped to the unit circle", () => {
    installFakeDocument();
    const stick = new VirtualJoystick({ radius: 40, deadZone: 0.1 });
    cleanups.push(() => stick.dispose());
    (stick.element as unknown as FakeElement).rect = { left: 10, top: 10, width: 80, height: 80, right: 90, bottom: 90, x: 10, y: 10 };
    stick.setVisible(true);

    stick.element.dispatchEvent(joystickPointer("pointerdown", { clientX: 50, clientY: 50 }));
    expect(stick.active()).toBe(true);
    expect(stick.axes()).toEqual({ forward: 0, strafe: 0 });

    // Straight up by half the travel is half speed forward.
    stick.element.dispatchEvent(joystickPointer("pointermove", { clientX: 50, clientY: 30 }));
    expect(stick.axes()).toEqual({ forward: 0.5, strafe: 0 });

    // Far past the rim, diagonally, is a unit vector.
    stick.element.dispatchEvent(joystickPointer("pointermove", { clientX: 250, clientY: 250 }));
    const { forward, strafe } = stick.axes();
    expect(forward).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(strafe).toBeCloseTo(Math.SQRT1_2, 6);

    stick.element.dispatchEvent(joystickPointer("pointerup"));
    expect(stick.active()).toBe(false);
    expect(stick.axes()).toEqual({ forward: 0, strafe: 0 });
  });

  it("does not let a press on the stick reach the world", () => {
    installFakeDocument();
    const stick = new VirtualJoystick();
    cleanups.push(() => stick.dispose());
    const parent = document.createElement("div");
    const parentSaw = vi.fn();
    parent.addEventListener("pointerdown", parentSaw);
    stick.mount(parent);
    stick.setVisible(true);
    stick.element.dispatchEvent(joystickPointer("pointerdown"));
    expect(parentSaw).not.toHaveBeenCalled();
  });
});
