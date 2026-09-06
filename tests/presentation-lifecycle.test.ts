import { describe, expect, it, vi } from "vitest";
import { DeferredOverlay } from "../game/src/ui/deferredOverlay.js";
import { KeyBindingRegistry } from "../game/src/input/keyboard.js";
import { AudioDirector } from "../game/src/audio/director.js";
import type { AudioEngine } from "../game/src/audio/engine.js";

describe("presentation lifecycle", () => {
  it("checks the current request guard even after an overlay has loaded", async () => {
    const overlay = { mount: vi.fn(), show: vi.fn(), update: vi.fn(), dispose: vi.fn() };
    const deferred = new DeferredOverlay<string>({
      registry: new KeyBindingRegistry(), load: async () => overlay, onError: vi.fn(),
    });
    deferred.show("first", () => true);
    await Promise.resolve();
    deferred.show("stale after travel", () => false);
    expect(overlay.show.mock.calls).toEqual([["first"]]);
    deferred.show("current", () => true);
    expect(overlay.show.mock.calls).toEqual([["first"], ["current"]]);
    deferred.dispose();
  });

  it("Escape drops a pending report without losing the loaded overlay", async () => {
    let resolve!: (value: typeof overlay) => void;
    const overlay = { mount: vi.fn(), show: vi.fn(), update: vi.fn(), dispose: vi.fn() };
    const registry = new KeyBindingRegistry();
    const deferred = new DeferredOverlay<string>({
      registry, load: () => new Promise((done) => { resolve = done; }), onError: vi.fn(),
    });
    deferred.show("dismissed", () => true);
    expect(registry.runEscapeStack()).toBe(true);
    resolve(overlay);
    await Promise.resolve();
    expect(overlay.show).not.toHaveBeenCalled();
    deferred.show("new", () => true);
    expect(overlay.show).toHaveBeenCalledWith("new");
    deferred.dispose();
  });

  it("a disposed director cannot restart audio from delayed observations", () => {
    const engine = { playCue: vi.fn(), stopLoop: vi.fn() };
    const director = new AudioDirector(engine as unknown as AudioEngine, { cues: {} });
    director.dispose();
    director.observeActivity({ kind: "eating" });
    director.observeCombatHit({ attacker: "player", damage: 1, hit: true, killed: true, kind: "melee" });
    director.observeMovement({ atMs: 10, moving: true, regionId: "fallowmarch", speedMps: 3 });
    director.observeGameEvent({ type: "inventory.full", data: {} } as Parameters<AudioDirector["observeGameEvent"]>[0]);
    expect(engine.playCue).not.toHaveBeenCalled();
  });
});
