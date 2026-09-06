import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GameApi, Result, Vec3 } from "../game/src/contracts.js";
import { InputController } from "../game/src/input/mouse.js";

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
});

describe("held left pointer movement", () => {
  it("retargets ground movement on the render cadence until release", () => {
    const windowTarget = new EventTarget() as EventTarget & { innerWidth: number; innerHeight: number };
    windowTarget.innerWidth = 800;
    windowTarget.innerHeight = 600;
    vi.stubGlobal("window", windowTarget);

    const canvas = new TestCanvas();
    const camera = new THREE.PerspectiveCamera();
    const movement = { setDirectInput: vi.fn() };
    const orbit = { yaw: 0, rotate: vi.fn(), zoom: vi.fn(), panPixels: vi.fn() };
    const destinations: Vec3[] = [];
    let groundPick = 0;
    const api = {
      moveTo: vi.fn(() => success({ pathLength: 10, etaMs: 1000 })),
      getPlayer: vi.fn(() => ({ position: [0, 0, 0] })),
      inspect: vi.fn(),
      interact: vi.fn(),
      stop: vi.fn(() => success(undefined)),
    } as unknown as GameApi;
    const input = new InputController(
      canvas as unknown as HTMLCanvasElement,
      { camera, scene: new THREE.Scene() },
      orbit,
      api,
      movement,
      { onWalkDestination: (point) => destinations.push(point) },
    );
    cleanups.push(() => input.dispose());
    input.picker.setGroundSource(() => ({
      entityId: null,
      point: [groundPick += 1, 0, groundPick] as Vec3,
      distance: 1,
    }));

    canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 100, clientY: 100 }));
    expect(api.moveTo).toHaveBeenCalledTimes(1);

    windowTarget.dispatchEvent(pointerEvent("pointermove", { clientX: 140, clientY: 120 }));
    input.update();
    expect(api.moveTo).toHaveBeenCalledTimes(1);

    windowTarget.dispatchEvent(pointerEvent("pointermove", { clientX: 220, clientY: 180 }));
    input.update();
    expect(api.moveTo).toHaveBeenCalledTimes(1);
    const steering = movement.setDirectInput.mock.lastCall![0];
    expect(steering.forward).toBeLessThan(0);
    expect(steering.strafe).toBeGreaterThan(0);

    input.update();
    expect(api.moveTo).toHaveBeenCalledTimes(1);
    expect(destinations).toHaveLength(4);
    expect(destinations[1]).not.toEqual(destinations[2]);

    // Real mouse chords use pointermove for the second press and first release.
    windowTarget.dispatchEvent(pointerEvent("pointermove", { button: 2, buttons: 3, clientX: 220, clientY: 180 }));
    windowTarget.dispatchEvent(pointerEvent("pointermove", { button: -1, buttons: 3, clientX: 250, clientY: 190 }));
    input.update();
    expect(orbit.rotate).toHaveBeenCalledTimes(1);
    expect(movement.setDirectInput.mock.lastCall![0].strafe).toBeGreaterThan(0);
    expect(api.moveTo).toHaveBeenCalledTimes(1);
    windowTarget.dispatchEvent(pointerEvent("pointermove", { button: 2, buttons: 1, clientX: 250, clientY: 190 }));
    input.update();
    expect(movement.setDirectInput.mock.lastCall![0].strafe).toBeGreaterThan(0);
    expect(input.contextMenu.isOpen()).toBe(false);

    windowTarget.dispatchEvent(pointerEvent("pointerup", { clientX: 220, clientY: 180 }));
    windowTarget.dispatchEvent(pointerEvent("pointermove", { clientX: 300, clientY: 220 }));
    input.update();
    expect(api.moveTo).toHaveBeenCalledTimes(2);
    expect(movement.setDirectInput).toHaveBeenLastCalledWith({ forward: 0, strafe: 0, cameraYaw: 0 });
  });
  it("clicks the floor beyond a non-interactive overhead prop, not its origin", () => {
    const windowTarget = new EventTarget();
    vi.stubGlobal("window", windowTarget);
    const canvas = new TestCanvas();
    const api = {
      inspect: vi.fn(() => success({ interactions: [] })),
      moveTo: vi.fn(() => success({ pathLength: 5, etaMs: 1000 })),
    } as unknown as GameApi;
    const input = new InputController(canvas as unknown as HTMLCanvasElement,
      { camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() },
      { yaw: 0, rotate: vi.fn(), zoom: vi.fn(), panPixels: vi.fn() }, api,
      { setDirectInput: vi.fn() });
    cleanups.push(() => input.dispose());
    input.picker.setEntitySource(() => ({entityId: "roof", point: [0, 4, 0], distance: 2}));
    input.picker.setGroundSource(() => ({entityId: null, point: [0, 0, -5], distance: 8}));
    canvas.dispatchEvent(pointerEvent("pointerdown"));
    expect(api.moveTo).toHaveBeenCalledExactlyOnceWith({position: [0, 0, -5]});
  });

});
