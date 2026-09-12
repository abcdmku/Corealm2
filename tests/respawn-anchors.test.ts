import { describe, expect, it } from "vitest";
import type { RegionId, SkillId, Vec3 } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { EventBus } from "../game/src/core/events.js";
import { SaveService } from "../game/src/persistence/storage.js";
import { Store } from "../game/src/state/store.js";
import { DeathSystem } from "../game/src/systems/death.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import {
  buildSettlementRespawnAnchors,
  RESPAWN_ANCHOR_HEIGHT_TOLERANCE_M,
  RespawnAnchorSystem,
  SETTLEMENT_RESPAWN_RADIUS_M,
  type RespawnAnchor,
} from "../game/src/systems/respawnAnchors.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const COLDBRACE: RespawnAnchor = {
  id: "coldbrace", name: "Coldbrace", regionId: "fallowmarch", position: [20, 5, 30],
};
const ROOTFALL: RespawnAnchor = {
  id: "rootfall", name: "Rootfall", regionId: "vellenwood", position: [200, 25, 100],
};

function runtime(anchors: readonly RespawnAnchor[] = [COLDBRACE, ROOTFALL]) {
  const store = new Store(429, 0);
  store.get().player.respawnPointId = "previous_anchor";
  const system = new RespawnAnchorSystem({ store, anchors: () => anchors });
  const visit = (anchor: RespawnAnchor) => {
    store.get().player.position = [...anchor.position];
    store.get().player.regionId = anchor.regionId;
    return system.update();
  };
  return { store, system, visit };
}

describe("settlement respawn anchors", () => {
  it("accepts the exact horizontal and height limits and rejects positions beyond either", () => {
    expect(SETTLEMENT_RESPAWN_RADIUS_M).toBe(12);
    expect(RESPAWN_ANCHOR_HEIGHT_TOLERANCE_M).toBe(4);
    const { store, system } = runtime();
    const player = store.get().player;
    player.regionId = COLDBRACE.regionId;
    player.position = [32.01, 5, 30];
    expect(system.update()).toBeNull();
    player.position = [20, 9.01, 30];
    expect(system.update()).toBeNull();
    player.position = [20, 0.99, 30];
    expect(system.update()).toBeNull();
    expect(player.respawnPointId).toBe("previous_anchor");
    expect(store.consumeDirty()).toBe(false);

    player.position = [32, 9, 30];
    expect(system.update()).toMatchObject({ id: "coldbrace" });
    expect(player.respawnPointId).toBe("coldbrace");
    expect(store.consumeDirty()).toBe(true);
  });

  it("uses a fixture's explicit radius", () => {
    const anchor: RespawnAnchor = { ...COLDBRACE, radius: 5 };
    const { store, system } = runtime([anchor]);
    store.get().player.position = [25.01, 5, 30];
    expect(system.update()).toBeNull();
    store.get().player.position = [25, 5, 30];
    expect(system.update()?.id).toBe("coldbrace");
  });

  it.each([
    { scenario: "another surface region", regionId: "vellenwood" as RegionId, health: 23 },
    { scenario: "the dungeon", regionId: "gravelmaw" as RegionId, health: 23 },
    { scenario: "a dead player", regionId: "fallowmarch" as RegionId, health: 0 },
  ])("ignores $scenario without replacing the last anchor", ({ regionId, health }) => {
    const surfaceAnchor: RespawnAnchor = { ...COLDBRACE, id: "highcairn", regionId: "karrowmoor" };
    const { store, system } = runtime([COLDBRACE, surfaceAnchor]);
    store.get().player.position = [...COLDBRACE.position];
    store.get().player.regionId = regionId;
    store.get().player.health = health;
    expect(system.update()).toBeNull();
    expect(store.get().player.respawnPointId).toBe("previous_anchor");
    expect(store.consumeDirty()).toBe(false);
  });

  it("tracks the last visited settlement in both directions and writes only when it changes", () => {
    const { store, system, visit } = runtime();
    expect(visit(COLDBRACE)?.id).toBe("coldbrace");
    expect(store.consumeDirty()).toBe(true);
    const revision = store.revision();
    expect(system.update()).toBeNull();
    system.tick(100, 100);
    expect(store.revision()).toBe(revision);
    expect(store.consumeDirty()).toBe(false);

    expect(visit(ROOTFALL)?.id).toBe("rootfall");
    expect(store.get().player.respawnPointId).toBe("rootfall");
    expect(visit(COLDBRACE)?.id).toBe("coldbrace");
    expect(store.get().player.respawnPointId).toBe("coldbrace");

    store.get().player.regionId = ROOTFALL.regionId;
    store.get().player.position = [...ROOTFALL.position];
    system.tick(100, 200);
    expect(store.get().player.respawnPointId).toBe("rootfall");
  });

  it("resolves the stored settlement independently of the current region and copies its position", () => {
    const { store, system } = runtime();
    store.get().player.regionId = "karrowmoor";
    expect(system.resolve("rootfall")).toEqual({
      name: "Rootfall", regionId: "vellenwood", position: ROOTFALL.position,
    });
    expect(system.resolve("rootfall")?.position).not.toBe(ROOTFALL.position);
    expect(system.resolve("rootfall")?.position).not.toBe(system.resolve("rootfall")?.position);
    expect(system.resolve("missing_anchor")).toBeUndefined();
  });

  it("restores the saved last visit and uses it for an actual death after crossing a region boundary", () => {
    const original = runtime();
    original.visit(COLDBRACE);
    original.visit(ROOTFALL);
    const saves = new SaveService(false);
    const loaded = saves.deserialize(saves.serialize(original.store.get()));
    expect(loaded.status).toBe("loaded");
    if (!loaded.state) throw new Error(loaded.reason ?? "Missing loaded state");
    const current = runtime();
    current.store.replace(loaded.state);
    expect(current.store.get().player.respawnPointId).toBe("rootfall");

    const state = current.store.get();
    state.player.regionId = "karrowmoor";
    state.player.position = [320, 80, -170];
    const deathPosition: Vec3 = [...state.player.position];
    current.system.tick(100, 100);
    expect(state.player.respawnPointId).toBe("rootfall");

    const events = new EventBus();
    const skillLevels = () => Object.fromEntries(
      Object.entries(state.skills).map(([id, skill]) => [id, skill.level]),
    ) as Record<SkillId, number>;
    const entities = new EntityStore({ skillLevels });
    const dispatcher = new InteractionDispatcher({
      get: (id) => entities.get(id), playerPosition: () => state.player.position, skillLevels,
    });
    const inventory = new InventorySystem({ store: current.store, events, now: () => 200 });
    const death = new DeathSystem({
      store: current.store, events, entities, inventory, dispatcher, respawn: current.system,
    });
    state.player.health = 0;
    current.system.tick(100, 200);
    death.tick(100, 200);
    events.flush();

    expect(state.player.respawnPointId).toBe("rootfall");
    expect(state.player.regionId).toBe("vellenwood");
    expect(state.player.position).toEqual(ROOTFALL.position);
    expect(state.player.position).not.toBe(ROOTFALL.position);
    expect(state.player.health).toBe(state.player.maxHealth);
    expect(state.world.recoveryCache).toMatchObject({ position: deathPosition, regionId: "karrowmoor" });
    expect(events.since(0, ["player.died"]).events).toHaveLength(1);
    expect(events.since(0, ["player.died"]).events[0]?.data).toMatchObject({
      respawnPointId: "rootfall", respawnPosition: ROOTFALL.position, regionId: "karrowmoor",
    });
    expect(current.system.update()).toBeNull();
  });
});

describe("production settlement anchor mapping", () => {
  it("maps settlement save IDs to settlement route nodes with runtime terrain heights", () => {
    const nodes = new Map<string, { position: Vec3; regionId: RegionId }>();
    for (const [index, region] of REGIONS.entries()) {
      for (const location of region.locations) {
        if (!location.routeNode) continue;
        nodes.set(location.id, {
          position: [location.position[0], 17 + index * 30, location.position[1]], regionId: region.id,
        });
      }
    }
    const anchors = buildSettlementRespawnAnchors((id) => nodes.get(id));
    expect(anchors.map((anchor) => anchor.id).sort()).toEqual(["coldbrace", "crownward_town", "emberfast", "highcairn", "lantern_rest", "prism_hollow", "rootfall"]);
    for (const [settlementId, nodeId] of [
      ["coldbrace", "town_center"], ["rootfall", "rootfall_hamlet"],
      ["highcairn", "highcairn_outpost"], ["emberfast", "emberfast_town"],
      ["crownward_town", "crownward_town_square"], ["lantern_rest", "lantern_rest_square"],
      ["prism_hollow", "prism_hollow_square"],
    ]) {
      const node = nodes.get(nodeId!);
      expect(node).toBeDefined();
      const anchor = anchors.find((entry) => entry.id === settlementId);
      expect(anchor).toMatchObject({ id: settlementId, position: node?.position, regionId: node?.regionId });
      expect(anchor?.position).not.toBe(node?.position);
    }
  });

  it("omits unavailable settlement nodes in an empty or partial lab route graph", () => {
    expect(buildSettlementRespawnAnchors(() => undefined)).toEqual([]);
    const anchors = buildSettlementRespawnAnchors((id) => id === "rootfall_hamlet"
      ? { position: [60, 31, 120], regionId: "vellenwood" }
      : undefined);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ id: "rootfall", regionId: "vellenwood", position: [60, 31, 120] });
  });
});
