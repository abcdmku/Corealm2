import { describe, expect, it, vi } from "vitest";
import { CorealmAudioBridge } from "../game/src/audio/gameAudio.js";
import { Store } from "../game/src/state/store.js";
import type { AudioEngine } from "../game/src/audio/engine.js";
import type { AudioDirector } from "../game/src/audio/director.js";
import type { SemanticEntity } from "../game/src/contracts.js";

function fixture() {
  const store = new Store(42, 0);
  const engine = { resetOneShots: vi.fn(), playCue: vi.fn(), setListenerPose: vi.fn() };
  const director = { setRegion: vi.fn(), reset: vi.fn(), observeGameEvent: vi.fn(), observeActivity: vi.fn() };
  const animal: SemanticEntity = { id: "cow", name: "Cow", archetype: "enemy", state: "alive", tier: 1,
    interactions: ["attack"], regionId: "fallowmarch", position: [2, 0, 0] };
  const bridge = new CorealmAudioBridge({ store, engine: engine as unknown as AudioEngine,
    director: director as unknown as AudioDirector, entity: () => animal,
    surfaceAt: () => "grass", listenerForward: () => [1, 0, 0],
    nearestCreature: () => ({ entityId: "cow", family: "cattle", distance: 2 }),
  });
  return { store, engine, director, animal, bridge };
}

describe("audio across travel", () => {
  it("depletion adds the material break sound without replaying the rig contact", () => {
    const f = fixture();
    f.animal.archetype = "ore";
    f.bridge.handleGatherMotion("mine", "impact");
    f.bridge.handleEvent({ type: "resource.depleted", entityId: "cow", data: {} } as Parameters<CorealmAudioBridge["handleEvent"]>[0]);
    expect(f.director.observeActivity.mock.calls.map(([observation]) => observation.phase)).toEqual(["impact", "completed"]);
  });
  it("positions same-realm animals and cancels old voices before dungeon ambience", () => {
    const f = fixture();
    f.bridge.tick(100, 100);
    expect(f.engine.playCue).toHaveBeenCalledWith("creature.cow_low", expect.objectContaining({ position: [2, 0, 0], maxDistance: 34 }));
    f.store.get().player.regionId = "gravelmaw";
    f.bridge.tick(100, 200);
    expect(f.engine.resetOneShots).toHaveBeenCalledOnce();
    expect(f.engine.playCue).toHaveBeenCalledTimes(1);
    expect(f.director.setRegion).toHaveBeenLastCalledWith("gravelmaw", f.store.get().player.position);
    expect(f.engine.setListenerPose).toHaveBeenLastCalledWith(f.store.get().player.position, [1, 0, 0]);
  });

  it("a reset restarts ambience cadence even when the simulation clock rewinds", () => {
    const f = fixture();
    f.bridge.tick(100, 10000);
    f.bridge.reset();
    f.bridge.tick(100, 0);
    expect(f.engine.playCue).toHaveBeenCalledTimes(2);
  });

  it("death stops pending effects and suppresses creature chatter until respawn", () => {
    const f = fixture();
    f.store.get().player.health = 0;
    f.bridge.handleEvent({ type: "player.died", data: {} } as Parameters<CorealmAudioBridge["handleEvent"]>[0]);
    f.bridge.tick(100, 10000);
    expect(f.engine.resetOneShots).toHaveBeenCalledOnce();
    expect(f.engine.playCue.mock.calls).toEqual([["combat.player_death", undefined]]);
    f.store.get().player.health = 10;
    f.bridge.tick(100, 10100);
    expect(f.engine.playCue).toHaveBeenCalledTimes(2);
  });
});
