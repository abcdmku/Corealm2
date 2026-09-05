import { describe, expect, it } from "vitest";
import { SKILL_IDS, type SkillId } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { assemblePortalFixture } from "../game/src/featureLab/portal.js";
import { Store } from "../game/src/state/store.js";
import { Solids } from "../game/src/systems/solids.js";
import { TravelSystem } from "../game/src/systems/travel.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

function passage() {
  const fixture = assemblePortalFixture(() => 0, () => 0);
  const store = new Store(5, 0);
  const entry = fixture.entities[0]!;
  store.get().player.position = [...entry.interactionPosition!];
  const events = new EventBus();
  const dispatcher = new InteractionDispatcher({
    get: id => fixture.entities.find(entity => entity.id === id),
    playerPosition: () => store.get().player.position,
    skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, 1])) as Record<SkillId, number>,
  });
  let commit: (() => void) | undefined;
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  new TravelSystem({ store, events, clock: new SimClock(), dispatcher,
    entities: { get: id => fixture.entities.find(entity => entity.id === id), all: () => fixture.entities },
    nav: { closestPoint: point => point, routeNode: id => fixture.routeNodes.find(node => node.id === id) },
    place: (position, regionId) => { store.get().player.position = position; store.get().player.regionId = regionId; },
    transition: (_destination, performCommit) => {
      commit = performCommit;
      return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    },
  });
  return { fixture, store, entry, events, dispatcher, commit: () => commit!(), finish: () => finish!(), fail: () => fail!(new Error("load failed")) };
}

describe("portal travel", () => {
  it("keeps the source realm until the fade commits, then discovers exactly once", async () => {
    const h = passage();
    expect(h.dispatcher.run(h.entry.id, "enter").ok).toBe(true);
    expect(h.store.get().player.regionId).toBe("fallowmarch");
    expect(h.store.get().discovery.locations["lab:portal:inside"]).toBeUndefined();
    expect(h.dispatcher.run(h.entry.id, "enter")).toMatchObject({ ok: false, error: { code: "BUSY" } });
    h.commit();
    expect(h.store.get().player.regionId).toBe("gravelmaw");
    expect(h.store.get().player.position).toEqual([-36, -12, -36]);
    h.events.flush();
    expect(h.events.since(0).events.filter(event => event.type === "entity.discovered")).toHaveLength(1);
    h.finish();
    await Promise.resolve();
  });

  it("preserves the source and reports a destination load failure", async () => {
    const h = passage();
    const before = structuredClone(h.store.get().player);
    h.dispatcher.run(h.entry.id, "enter");
    h.fail();
    await Promise.resolve();
    await Promise.resolve();
    h.events.flush();
    expect(h.store.get().player).toEqual(before);
    expect(h.events.since(0).events).toContainEqual(expect.objectContaining({ type: "navigation.failed", data: expect.objectContaining({ reason: "portal-load-failed" }) }));
  });

  it("requires the authored approach and refuses sealed entrances", () => {
    const h = passage();
    const point = h.store.get().player.position;
    h.store.get().player.position = [point[0], point[1], point[2] + 1];
    expect(h.dispatcher.run(h.entry.id, "enter")).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
    h.store.get().player.position = [...h.entry.interactionPosition!];
    h.entry.state = "sealed";
    expect(h.dispatcher.run(h.entry.id, "enter")).toMatchObject({ ok: false, error: { code: "REQUIREMENTS_NOT_MET" } });
  });

  it("blocks walking through both arch openings while leaving both approach pads clear", () => {
    const h = passage();
    const solids = new Solids(h.fixture.solids);
    for (const entity of h.fixture.entities) {
      const approach = entity.interactionPosition!;
      expect(solids.resolve(approach, approach, 0.35)).toEqual(approach);
      const behind: [number, number, number] = [entity.position[0], entity.position[1], entity.position[2] - 1];
      expect(solids.resolve(behind, approach, 0.35)).not.toEqual(behind);
    }
  });
});
