import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApi } from "../game/src/contracts.js";
import { KeyboardController, KeyBindingRegistry } from "../game/src/input/keyboard.js";

// The suite runs in Node. These DOM doubles supply target classification; the real
// controller receives cancelable events through its installed event listeners.
class TestElement extends EventTarget {
  control: TestElement | null = null;
  closest(): TestElement | null { return this.control; }
}
class TestHTMLElement extends TestElement { isContentEditable = false; }
class TestInput extends TestHTMLElement { type = "search"; }
class TestTextarea extends TestHTMLElement {}
class TestSelect extends TestHTMLElement {}

function keyEvent(key: string, type = "keydown"): KeyboardEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false });
  return event as KeyboardEvent;
}

const controllers: KeyboardController[] = [];

function setup(target: TestElement = new TestHTMLElement()) {
  const stop = vi.fn(() => ({ ok: true, value: undefined }));
  const activate = vi.fn();
  const registry = new KeyBindingRegistry();
  const controller = new KeyboardController({
    api: { stop } as unknown as GameApi,
    target: target as unknown as HTMLElement,
    registry,
    getActionTargetId: () => "selected-bank-chest",
    activateTarget: activate,
  });
  controllers.push(controller);
  return { target, stop, activate, registry, controller };
}

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("Element", TestElement);
  vi.stubGlobal("HTMLElement", TestHTMLElement);
  vi.stubGlobal("HTMLInputElement", TestInput);
  vi.stubGlobal("HTMLTextAreaElement", TestTextarea);
  vi.stubGlobal("HTMLSelectElement", TestSelect);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
});

describe("keyboard input owned by UI", () => {
  it.each(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])(
    "does not turn a consumed %s into player movement",
    (key) => {
      const target = new TestHTMLElement();
      target.addEventListener("keydown", (event) => event.preventDefault());
      const { controller } = setup(target);

      target.dispatchEvent(keyEvent(key));

      expect(controller.axes()).toEqual({ forward: 0, strafe: 0 });
      expect(controller.isHeld(key)).toBe(false);
    },
  );

  it("does not repeat a UI Space action on the selected world entity", () => {
    const target = new TestElement();
    const walkToMapPlace = vi.fn();
    target.addEventListener("keydown", (event) => {
      event.preventDefault();
      walkToMapPlace();
    });
    const { activate } = setup(target);

    target.dispatchEvent(keyEvent(" "));

    expect(walkToMapPlace).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not dispatch a panel shortcut already consumed by the UI", () => {
    const target = new TestHTMLElement();
    target.addEventListener("keydown", (event) => event.preventDefault());
    const { registry } = setup(target);
    const openPanel = vi.fn(() => true);
    registry.register({ id: "panel.lab", keys: ["l"], label: "Lab", onDown: openPanel });

    target.dispatchEvent(keyEvent("l"));

    expect(openPanel).not.toHaveBeenCalled();
  });

  it.each(["button", "button child", "SVG button"])(
    "leaves Space activation to a focused %s",
    (kind) => {
      const control = kind === "SVG button" ? new TestElement() : new TestHTMLElement();
      const target = kind === "button child" ? new TestHTMLElement() : control;
      target.control = control;
      const { activate } = setup(target);
      const event = keyEvent(" ");

      target.dispatchEvent(event);

      expect(activate).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it.each(["search", "textarea", "select", "contenteditable"])(
    "closes the top panel with Escape from %s and consumes the key",
    (kind) => {
      const target = kind === "search" ? new TestInput()
        : kind === "textarea" ? new TestTextarea()
        : kind === "select" ? new TestSelect() : new TestHTMLElement();
      target.isContentEditable = kind === "contenteditable";
      const { registry, stop, controller } = setup(target);
      const closeTopPanel = vi.fn(() => true);
      registry.pushEscapeHandler(closeTopPanel);
      const event = keyEvent("Escape");

      target.dispatchEvent(event);

      expect(closeTopPanel).toHaveBeenCalledOnce();
      expect(stop).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(controller.axes()).toEqual({ forward: 0, strafe: 0 });
    },
  );

  it("continues to suppress world movement and shortcuts while typing", () => {
    const { target, registry, activate, controller } = setup(new TestInput());
    const openPanel = vi.fn(() => true);
    registry.register({ id: "panel.inventory", keys: ["i"], label: "Inventory", onDown: openPanel });

    for (const key of ["w", "i", " "]) target.dispatchEvent(keyEvent(key));

    expect(controller.axes()).toEqual({ forward: 0, strafe: 0 });
    expect(openPanel).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("keeps world movement, release, and Space interaction working", () => {
    const { target, controller, activate } = setup();
    target.dispatchEvent(keyEvent("w"));
    expect(controller.axes()).toEqual({ forward: 1, strafe: 0 });

    const release = keyEvent("w", "keyup");
    release.preventDefault();
    target.dispatchEvent(release);
    expect(controller.axes()).toEqual({ forward: 0, strafe: 0 });

    const interact = keyEvent(" ");
    target.dispatchEvent(interact);
    expect(activate).toHaveBeenCalledOnce();
    expect(interact.defaultPrevented).toBe(true);
  });
});
