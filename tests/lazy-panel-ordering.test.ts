import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyBindingRegistry } from "../game/src/input/keyboard.js";
import { cancelPendingPanelOpens, LazyPanel } from "../game/src/ui/lazyPanelRegistry.js";
import { panelInteraction } from "../game/src/ui/panelInteraction.js";
import type { ManagedPanel } from "../game/src/ui/panels.js";

const disposers: Array<() => void> = [];

beforeEach(() => { panelInteraction.generation = 0; });
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

function fixture(registry: KeyBindingRegistry, id: string) {
  let resolve!: (panel: ManagedPanel) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ManagedPanel>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  let opened = false;
  const frame = {
    mount: vi.fn(),
    isOpen: () => opened,
    open: vi.fn(() => { opened = true; panelInteraction.generation += 1; }),
    close: vi.fn(() => { opened = false; }),
    toggle: vi.fn(),
    dispose: vi.fn(),
  };
  const panel: ManagedPanel = { frame, refresh: vi.fn(), dispose: vi.fn() };
  const onError = vi.fn();
  const lazy = new LazyPanel({ id, title: id, registry, load: () => promise, onError });
  disposers.push(() => lazy.dispose());
  return { lazy, panel, frame, resolve: () => resolve(panel), reject, onError };
}

async function settle() {
  // Includes ensureLoaded's catch/finally and withPanel's deferred action.
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

describe("pending panel opens", () => {
  it("Escape cancels the first open before its import resolves", async () => {
    const registry = new KeyBindingRegistry();
    const current = fixture(registry, "inventory");
    current.lazy.frame.open();
    expect(current.lazy.frame.isOpen()).toBe(true);
    expect(registry.runEscapeStack()).toBe(true);
    expect(current.lazy.frame.isOpen()).toBe(false);

    current.resolve();
    await settle();
    expect(current.frame.open).not.toHaveBeenCalled();
    expect(registry.runEscapeStack()).toBe(false);

    current.lazy.frame.open();
    expect(current.frame.open).toHaveBeenCalledOnce();
  });

  it.each(["older-first", "newer-first"])("only the latest first-open request wins, %s", async (order) => {
    const registry = new KeyBindingRegistry();
    const older = fixture(registry, "inventory");
    const newer = fixture(registry, "equipment");
    older.lazy.frame.open();
    newer.lazy.frame.open();
    if (order === "older-first") {
      older.resolve();
      await settle();
      newer.resolve();
    } else {
      newer.resolve();
      await settle();
      older.resolve();
    }
    await settle();
    expect(older.frame.open).not.toHaveBeenCalled();
    expect(newer.frame.open).toHaveBeenCalledOnce();
  });

  it("does not replace a panel that opened while its import was pending", async () => {
    const registry = new KeyBindingRegistry();
    const older = fixture(registry, "inventory");
    const loaded = fixture(registry, "equipment");
    loaded.resolve();
    loaded.lazy.withPanel(() => undefined);
    await settle();
    older.lazy.frame.open();
    loaded.lazy.frame.open();
    older.resolve();
    await settle();
    expect(older.frame.open).not.toHaveBeenCalled();
    expect(loaded.frame.open).toHaveBeenCalledOnce();
  });

  it("the title hook cancels pending opens and panel-specific actions without hiding visible panels", async () => {
    const registry = new KeyBindingRegistry();
    const pending = fixture(registry, "inventory");
    const bank = fixture(registry, "bank");
    const loaded = fixture(registry, "equipment");
    loaded.resolve();
    loaded.lazy.frame.open();
    await settle();
    const openBank = vi.fn();
    bank.lazy.withPanel(openBank);
    pending.lazy.frame.open();

    cancelPendingPanelOpens(registry);
    expect(registry.runEscapeStack()).toBe(false);
    pending.resolve();
    bank.resolve();
    await settle();
    expect(pending.frame.open).not.toHaveBeenCalled();
    expect(openBank).not.toHaveBeenCalled();
    expect(loaded.lazy.frame.isOpen()).toBe(true);
    expect(loaded.frame.close).not.toHaveBeenCalled();
  });

  it("Escape skips an older request superseded by a visible panel", async () => {
    const registry = new KeyBindingRegistry();
    const older = fixture(registry, "inventory");
    older.lazy.frame.open();
    panelInteraction.generation += 1;
    expect(registry.runEscapeStack()).toBe(false);
    older.resolve();
    await settle();
    expect(older.frame.open).not.toHaveBeenCalled();
  });

  it("a failed import releases its Escape handler", async () => {
    const registry = new KeyBindingRegistry();
    const pending = fixture(registry, "inventory");
    pending.lazy.frame.open();
    pending.reject(new Error("offline"));
    await settle();
    expect(pending.onError).toHaveBeenCalledOnce();
    expect(pending.lazy.frame.isOpen()).toBe(false);
    expect(registry.runEscapeStack()).toBe(false);
  });
});
