import { describe, expect, it } from "vitest";
import { ARCHETYPES, INTERACTION_IDS, SKILL_IDS } from "../game/src/contracts.js";
import { DIALOGUE_NODES } from "../game/src/content/dialogue.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { NPCS } from "../game/src/content/npcs.js";
import { QUESTS } from "../game/src/content/quests.js";
import { REGIONS } from "../game/src/content/regions.js";
import { RESOURCES } from "../game/src/content/resources.js";
import { migrate } from "../game/src/persistence/migrate.js";
import { createInitialState } from "../game/src/state/store.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

const FARMING_ITEMS = [
  "bittergrain", "duskberry", "cairnleaf", "coalroot",
  "bittergrain_seed", "duskberry_seed", "cairnleaf_seed", "coalroot_seed",
] as const;

describe("farming removal", () => {
  it("removes farming from the public gameplay contracts and authored world", () => {
    expect(SKILL_IDS).not.toContain("farming");
    expect(ARCHETYPES).not.toContain("farm_plot");
    expect(INTERACTION_IDS).not.toEqual(expect.arrayContaining(["rake", "plant", "harvest"]));
    expect(RESOURCES.some((resource) => resource.skill === ("farming" as never))).toBe(false);
    expect(REGIONS.flatMap((region) => region.locations).some((location) => location.kind === ("farm" as never))).toBe(false);
    expect(buildWorld(1337, () => 0).entities.some((entity) => entity.archetype === ("farm_plot" as never))).toBe(false);
  });

  it("removes farming items and the Bright Water quest without removing Syb", () => {
    const itemIds = new Set(ALL_ITEMS.map((item) => item.id));
    for (const itemId of FARMING_ITEMS) expect(itemIds.has(itemId), itemId).toBe(false);

    expect(QUESTS.some((quest) => quest.id === "bright_water")).toBe(false);
    expect(JSON.stringify(QUESTS)).not.toContain("farming");
    expect(JSON.stringify(DIALOGUE_NODES)).not.toContain("bright_water");
    expect(NPCS.find((npc) => npc.id === "npc_ranger_syb")?.questIds).toEqual([]);
  });

  it("strips retired farming state and items from version 6 saves", () => {
    const legacy = createInitialState(1337, 10) as unknown as Record<string, any>;
    legacy.meta.saveVersion = 6;
    legacy.skills.farming = { xp: 250, level: 4 };
    legacy.quests.bright_water = { status: "active", stage: 1, counters: {}, flags: {} };
    legacy.farming = { marchfield_plots_1: { state: "growing" } };
    legacy.inventory.slots[5] = { itemId: "bittergrain_seed", quantity: 3, slotIndex: 5 };
    legacy.bank.slots.push({ itemId: "cairnleaf", quantity: 2 });
    legacy.world.lootPiles.old_crop = {
      position: [0, 0, 0], items: [{ itemId: "coalroot", quantity: 1 }],
      expiresAtMs: 100, ownerOnly: true,
    };

    const migrated = migrate(legacy);
    expect(migrated.ok).toBe(true);
    const state = migrated.state as unknown as Record<string, any>;
    expect(state.meta.saveVersion).toBe(8);
    expect(state.skills.farming).toBeUndefined();
    expect(state.quests.bright_water).toBeUndefined();
    expect(state.farming).toBeUndefined();
    expect(state.inventory.slots[5]).toBeNull();
    expect(state.bank.slots).toEqual([]);
    expect(state.world.lootPiles.old_crop.items).toEqual([]);
  });
});
