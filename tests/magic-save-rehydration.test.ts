import { describe, expect, it } from "vitest";
import type { SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SaveService } from "../game/src/persistence/storage.js";
import { rehydrateWorldContainers } from "../game/src/persistence/worldContainers.js";
import { createInitialState } from "../game/src/state/store.js";
import { EntityStore } from "../game/src/world/entities.js";

function entityStore(state = createInitialState()): EntityStore {
  return new EntityStore({
    skillLevels: () => Object.fromEntries(
      Object.entries(state.skills).map(([id, value]) => [id, value.level]),
    ) as Record<SkillId, number>,
  });
}

const TEMPEST_ROC: SemanticEntity = {
  id: "tempest_roc",
  archetype: "boss",
  name: "Tempest Roc",
  tier: 1,
  regionId: "fallowmarch",
  position: [80, 2, -40],
  state: "alive",
  interactions: ["inspect", "attack"],
};

describe("save migration and runtime container rehydration", () => {
  it("routes imported JSON through migration and derived-state repair", () => {
    const legacy = createInitialState(711, 25);
    legacy.meta.saveVersion = 2;
    legacy.skills.magic = { xp: 0, level: 99 };
    legacy.equipment.offHand = { itemId: "quartz_focus", quantity: 1 };
    legacy.dialogue = {
      npcId: "vess",
      nodeId: "mid-conversation",
      text: "stale",
      speaker: "Vess",
      options: [],
    };
    const oldShape = legacy as unknown as {
      magic?: unknown;
      equipment: Record<string, { itemId: string; quantity: number } | null>;
    };
    delete oldShape.magic;
    delete oldShape.equipment.focus;

    const loaded = new SaveService().deserialize(JSON.stringify(legacy));

    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.meta.saveVersion).toBe(8);
    expect(loaded.state?.skills.magic).toEqual({ xp: 0, level: 1 });
    expect(loaded.state?.equipment.mainHand).toEqual({ itemId: "air_wand", quantity: 1 });
    expect((loaded.state?.equipment as unknown as Record<string, unknown>).focus).toBeUndefined();
    expect(loaded.state?.equipment.offHand).toBeNull();
    expect(loaded.state?.magic.weaponCharges.air_wand).toBe(1000);
    expect(loaded.state?.magic.consumedOrbs.air_orb).toBe(true);
    expect(loaded.state?.dialogue).toBeNull();
  });

  it("rejects invalid debug-import JSON instead of replacing state with it", () => {
    expect(new SaveService().deserialize("{broken")).toEqual({
      status: "failed",
      reason: "Save is not valid JSON",
    });
  });

  it("restores recovery and boss-loot entities without changing custody or weapon charge", () => {
    const state = createInitialState(712, 0);
    state.magic.weaponCharges.air_wand = 137;
    state.world.recoveryCache = {
      id: "recovery_cache",
      position: [4, 0, 5],
      regionId: "fallowmarch",
      items: [{ itemId: "air_essence", quantity: 100 }],
      expiresAtMs: 90_000,
    };
    state.world.lootPiles.loot_tempest_roc_1 = {
      position: [81, 2, -41],
      items: [{ itemId: "air_orb", quantity: 1 }],
      expiresAtMs: 60_000,
      ownerOnly: true,
    };

    const entities = entityStore(state);
    entities.load([TEMPEST_ROC]);
    expect(rehydrateWorldContainers(state, entities)).toEqual({
      recoveryCaches: 1,
      lootPiles: 1,
    });

    expect(entities.get("recovery_cache")).toMatchObject({
      archetype: "recovery_cache",
      interactions: ["inspect", "loot"],
      view: { assetId: "crate_wood" },
      meta: { expiresAtMs: 90_000, itemCount: 1 },
    });
    expect(entities.get("loot_tempest_roc_1")).toMatchObject({
      archetype: "loot",
      name: "Tempest Roc's drop",
      tier: 1,
      regionId: "fallowmarch",
      interactions: ["inspect", "loot"],
      view: { assetId: "crate_wood" },
      meta: { droppedBy: "tempest_roc", expiresAtMs: 60_000 },
    });
    expect(entities.observe(
      { archetypes: ["loot"], interaction: "loot", radius: 8 },
      [81, 2, -41],
    ).map((entity) => entity.id)).toEqual(["loot_tempest_roc_1"]);
    expect(state.world.lootPiles.loot_tempest_roc_1?.items).toEqual([
      { itemId: "air_orb", quantity: 1 },
    ]);
    expect(state.magic.weaponCharges.air_wand).toBe(137);

    // Repeating the operation, as debug import can, replaces runtime entities rather than cloning
    // them. Runtime position changes also cannot mutate the canonical pile record by alias.
    rehydrateWorldContainers(state, entities);
    expect(entities.byArchetype("loot")).toHaveLength(1);
    entities.setPosition("loot_tempest_roc_1", [1, 2, 3]);
    expect(state.world.lootPiles.loot_tempest_roc_1?.position).toEqual([81, 2, -41]);

    state.world.recoveryCache = null;
    state.world.lootPiles = {};
    expect(rehydrateWorldContainers(state, entities)).toEqual({ recoveryCaches: 0, lootPiles: 0 });
    expect(entities.get("recovery_cache")).toBeUndefined();
    expect(entities.get("loot_tempest_roc_1")).toBeUndefined();
  });

  it("uses a position resolver when an old pile id no longer identifies its source", () => {
    const state = createInitialState(713, 0);
    state.world.lootPiles.legacy_drop = {
      position: [-90, -12, 30],
      items: [{ itemId: "water_orb", quantity: 1 }],
      expiresAtMs: 42_000,
      ownerOnly: true,
    };
    const entities = entityStore(state);
    entities.load([TEMPEST_ROC]);

    rehydrateWorldContainers(state, entities, { regionAt: () => "gravelmaw" });

    expect(entities.get("legacy_drop")).toMatchObject({
      name: "Loot pile",
      regionId: "gravelmaw",
      interactions: ["inspect", "loot"],
    });
  });
});
