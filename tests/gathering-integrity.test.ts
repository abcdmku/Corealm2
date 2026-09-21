import { describe, expect, it } from "vitest";
import type { GameEvent, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content } from "../game/src/content/index.js";
import { RESOURCES } from "../game/src/content/resources.js";
import { totalXpAt } from "../game/src/content/xp.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import { loadSerializedSave, serializeSave } from "../game/src/persistence/storage.js";
import { createInitialState, Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { GatheringSystem, type NodeRuntime } from "../game/src/systems/gathering.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

content.register({ items: ALL_ITEMS, resources: RESOURCES });

interface HarnessOptions {
  maxYields?: number;
  remaining?: number;
  playSeconds?: number;
  savedNode?: NodeRuntime;
}

interface Harness {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  activity: ActivitySystem;
  gathering: GatheringSystem;
  entity: SemanticEntity;
  setNow(atMs: number): void;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const maxYields = options.maxYields ?? 3;
  const remaining = options.remaining ?? maxYields;
  const store = new Store(0, 0);
  store.get().meta.playSeconds = options.playSeconds ?? 0;
  store.get().skills.mining = { xp: totalXpAt(99), level: 99 };

  const entity: SemanticEntity = {
    id: "test_grithe_seam",
    archetype: "ore",
    name: "Test Grithe Seam",
    tier: 1,
    regionId: "fallowmarch",
    position: [0, 0, 0],
    state: "available",
    requirements: { mining: 1 },
    interactions: ["inspect", "mine"],
    resource: { remaining, maxYields, respawnSeconds: 21, itemId: "grithe_ore" },
  };

  if (options.savedNode) {
    store.get().world.nodes[entity.id] = { ...options.savedNode };
  }

  const entities = new Map([[entity.id, entity]]);
  const events = new EventBus();
  const clock = new SimClock();
  const rng = new RngStreams(0);
  let nowMs = 0;
  const inventory = new InventorySystem({ store, events, now: () => nowMs });
  const activity = new ActivitySystem(store, events);
  const skillLevels = (): Record<SkillId, number> => Object.fromEntries(
    SKILL_IDS.map((skill) => [skill, store.get().skills[skill].level]),
  ) as Record<SkillId, number>;
  const dispatcher = new InteractionDispatcher({
    get: (entityId) => entities.get(entityId),
    playerPosition: () => store.get().player.position,
    skillLevels,
  });
  const gathering = new GatheringSystem({
    store,
    events,
    clock,
    rng,
    entities: { get: (entityId) => entities.get(entityId) },
    inventory,
    activity,
    dispatcher,
  });

  return {
    store,
    events,
    clock,
    rng,
    activity,
    gathering,
    entity,
    setNow(atMs: number): void { nowMs = atMs; },
  };
}

function eventsOfType(events: EventBus, type: GameEvent["type"]): GameEvent[] {
  events.flush();
  return events.since(0).events.filter((event) => event.type === type);
}

describe("gathering event and save integrity", () => {
  it("emits one source-rich receipt per gathered item and the canonical depletion payload", () => {
    const h = createHarness({ maxYields: 3, playSeconds: 12.5 });

    expect(h.gathering.begin(h.entity, "mine").ok).toBe(true);
    h.setNow(5_400);
    h.activity.tick(5_400, 5_400);

    const receipts = eventsOfType(h.events, "item.received").filter(
      (event) => event.data.itemId === "grithe_ore",
    );
    expect(receipts).toHaveLength(3);
    expect(receipts.map((event) => event.data.quantity)).toEqual([1, 1, 1]);
    expect(receipts.every((event) => event.entityId === h.entity.id)).toBe(true);
    expect(receipts.every((event) => event.data.source === "gather")).toBe(true);
    expect(receipts.every((event) => event.data.skill === "mining")).toBe(true);

    const depleted = eventsOfType(h.events, "resource.depleted");
    expect(depleted).toHaveLength(1);
    expect(depleted[0]?.entityId).toBe(h.entity.id);
    expect(depleted[0]?.data).toMatchObject({
      entityId: h.entity.id,
      itemId: "grithe_ore",
      yieldsTaken: 3,
      respawnInSeconds: 21,
      respawnSeconds: 21,
      respawnAtMs: 33_500,
    });
  });

  it("hydrates a saved depleted node before first touch and ages it only by played time", () => {
    const h = createHarness({
      maxYields: 11,
      remaining: 11,
      playSeconds: 10,
      savedNode: { remaining: 0, maxYields: 11, state: "depleted", respawnAtMs: 31_000 },
    });

    expect(h.entity.state).toBe("depleted");
    expect(h.entity.resource?.remaining).toBe(0);

    // A normal simulation tick cannot consume a timer while played time is unchanged.
    h.gathering.tick(100, 100);
    expect(h.entity.state).toBe("depleted");

    h.store.get().meta.playSeconds = 30.999;
    h.gathering.tick(0, 1);
    expect(h.entity.state).toBe("depleted");

    h.store.get().meta.playSeconds = 31;
    h.gathering.tick(0, 1);
    expect(h.entity.state).toBe("available");
    expect(h.entity.resource?.remaining).toBeGreaterThanOrEqual(8);
    expect(h.entity.resource?.remaining).toBeLessThanOrEqual(15);
    expect(h.store.get().world.nodes[h.entity.id]?.respawnAtMs).toBeNull();
  });

  it("forces a saved node due against played time instead of the caller's session timestamp", () => {
    const h = createHarness({
      playSeconds: 47.25,
      savedNode: { remaining: 0, maxYields: 3, state: "depleted", respawnAtMs: 90_000 },
    });

    expect(h.gathering.forceRespawn(h.entity.id, 800_000)).toBe(true);
    expect(h.store.get().world.nodes[h.entity.id]?.respawnAtMs).toBe(47_250);
    h.gathering.tick(0, 0);
    expect(h.entity.state).toBe("available");
  });

  it("uses the reseeded gather stream after a world reset", () => {
    const h = createHarness({
      savedNode: { remaining: 0, maxYields: 3, state: "depleted", respawnAtMs: 0 },
    });

    h.gathering.tick(0, 0);
    const firstRoll = h.entity.resource?.remaining;

    const node = h.store.get().world.nodes[h.entity.id];
    if (!node) throw new Error("test node was not hydrated");
    node.remaining = 0;
    node.state = "depleted";
    node.respawnAtMs = 0;
    h.entity.state = "depleted";
    if (h.entity.resource) h.entity.resource.remaining = 0;

    h.rng.reseed(0);
    h.gathering.tick(0, 0);
    expect(h.entity.resource?.remaining).toBe(firstRoll);
  });

  it("fast-forwards an existing resource deadline without aging other played-time systems", () => {
    const h = createHarness({
      savedNode: { remaining: 0, maxYields: 3, state: "depleted", respawnAtMs: 21_000 },
    });

    h.gathering.fastForwardRespawns(120);
    expect(h.entity.state).toBe("available");
    expect(h.store.get().meta.playSeconds).toBe(0);
  });

  it("does not spend a fresh respawn deadline with the jump that depleted the node", () => {
    const h = createHarness({ maxYields: 3 });
    h.gathering.fastForwardRespawns(120);
    expect(h.gathering.begin(h.entity, "mine").ok).toBe(true);

    h.setNow(120_000);
    h.activity.tick(100, 120_000);
    h.gathering.tick(100, 120_000);

    expect(h.entity.state).toBe("depleted");
    expect(h.store.get().world.nodes[h.entity.id]?.respawnAtMs).toBe(21_000);
  });

  it("round-trips a respawn roll and hydrates its matching remaining and maximum counts", () => {
    const before = createHarness({
      maxYields: 3,
      savedNode: { remaining: 0, maxYields: 3, state: "depleted", respawnAtMs: 0 },
    });
    before.gathering.tick(0, 0);

    const respawned = before.store.get().world.nodes[before.entity.id];
    if (!respawned) throw new Error("test node did not respawn");
    expect(respawned.maxYields).toBe(respawned.remaining);
    const respawnCapacity = respawned.maxYields;

    // Save after the new roll has been partly gathered. This catches a loader that restores only
    // `remaining`, because the rebuilt entity starts with an unrelated world-generation capacity.
    respawned.remaining -= 2;
    if (before.entity.resource) before.entity.resource.remaining = respawned.remaining;
    expect(respawned.remaining).toBeLessThan(respawnCapacity);

    const loaded = loadSerializedSave(serializeSave(before.store.get()));
    expect(loaded.status).toBe("loaded");
    const persisted = loaded.state?.world.nodes[before.entity.id];
    expect(persisted).toEqual(respawned);

    const after = createHarness({
      maxYields: 99,
      remaining: 99,
      savedNode: persisted,
    });
    expect(after.entity.resource?.remaining).toBe(respawned.remaining);
    expect(after.entity.resource?.maxYields).toBe(respawned.maxYields);
    expect(after.store.get().world.nodes[after.entity.id]).toEqual(respawned);

    expect(after.gathering.forceDeplete(after.entity.id, 0)).toBe(true);
    expect(eventsOfType(after.events, "resource.depleted").at(-1)?.data.yieldsTaken).toBe(respawnCapacity);
  });

  it.each([1, 2, 3])("repairs a v%s node missing maxYields without changing its saved lifecycle", (version) => {
    const legacy = createInitialState(71, 0);
    legacy.meta.saveVersion = version;
    legacy.world.nodes.test_grithe_seam = {
      remaining: 4,
      maxYields: 4,
      state: "available",
      respawnAtMs: null,
    };
    delete (legacy.world.nodes.test_grithe_seam as Partial<NodeRuntime>).maxYields;

    const loaded = loadSerializedSave(JSON.stringify(legacy));
    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.world.nodes.test_grithe_seam).toEqual({
      remaining: 4,
      maxYields: 4,
      state: "available",
      respawnAtMs: null,
    });
  });
});
