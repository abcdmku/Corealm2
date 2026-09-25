import { describe, expect, it } from "vitest";
import { RPG_BESTIARY_STAGED } from "../game/src/content/rpgBestiary.js";
import { enemyBlockFor } from "../game/src/content/enemies.js";
import { REGIONS } from "../game/src/content/regions.js";
import { createFeatureLabEntity, FEATURE_LAB_CATALOG, stagedCreaturePreset } from "../game/src/featureLab/catalog.js";
import { npcOutfitParts } from "../game/src/render/characterAppearances.js";

describe("explicit source creature reviews", () => {
  it("previews a staged Slayer Master model without changing the authored NPC", () => {
    const preset = FEATURE_LAB_CATALOG.targets.npc.find(row => row.id === "npc_slayer_aevra")!;
    expect(preset).toBeDefined();
    const baseYCalls: string[] = [];
    const placement = {
      entityId: "slayer-review",
      groundPosition: [0, 0, 0] as [number, number, number],
      baseY: (assetId: string) => { baseYCalls.push(assetId); return 0; },
    };
    const authored = createFeatureLabEntity(preset, placement);
    const preview = createFeatureLabEntity(preset, { ...placement, assetId: "npc_slayer_aevra" });
    expect(authored.view?.assetId).toBe("npc_fey_nightshade");
    expect(preview.view?.assetId).toBe("npc_slayer_aevra");
    expect(preview.view?.partAssetIds).toEqual([]);
    expect(preview.npc).toEqual(authored.npc);
    expect(baseYCalls).toEqual(["npc_fey_nightshade", "npc_slayer_aevra"]);
    expect(createFeatureLabEntity(preset, placement).view?.assetId).toBe("npc_fey_nightshade");
  });

  it("dresses only the two compatible human bodies and leaves native creature rigs intact", () => {
    expect(npcOutfitParts("npc_warden_ilse", "base_female")).toEqual([
      "outfit_female_peasant_chest", "outfit_female_peasant_legs",
      "outfit_female_peasant_boots", "outfit_female_peasant_gloves",
    ]);
    expect(npcOutfitParts("npc_trapper_mott", "base_male")).toEqual([
      "outfit_male_ranger_chest", "outfit_male_ranger_legs",
      "outfit_male_ranger_boots", "outfit_male_ranger_gloves",
      "outfit_male_ranger_hood", "outfit_male_ranger_pauldron",
    ]);
    for (const assetId of ["npc_fey_autumn", "npc_slayer_aevra", "creature_skeleton_soldier"]) {
      expect(npcOutfitParts("npc_trapper_mott", assetId), assetId).toEqual([]);
    }
    const preset = FEATURE_LAB_CATALOG.targets.npc.find((row) => row.id === "npc_warden_ilse")!;
    const placement = { entityId: "npc-preview", groundPosition: [0, 0, 0] as const, baseY: 0 };
    expect(createFeatureLabEntity(preset, placement).view?.partAssetIds).toEqual(
      npcOutfitParts("npc_warden_ilse", "base_female"),
    );
    expect(createFeatureLabEntity(preset, { ...placement, assetId: "creature_skeleton_soldier" })
      .view?.partAssetIds).toEqual([]);
  });

  it("uses each placed NPC's settlement tier in the lab catalog", () => {
    for (const region of REGIONS) for (const settlement of region.settlements) {
      for (const npc of settlement.npcs) {
        const preset = FEATURE_LAB_CATALOG.targets.npc.find((row) => row.id === npc.id);
        expect(preset?.tier, npc.id).toBe(settlement.tier);
      }
    }
  });

  it("constructs the staged creature with its own stats without making it a normal selection", () => {
    for (const source of RPG_BESTIARY_STAGED) {
      const id = `candidate:${source.id}`;
      expect(FEATURE_LAB_CATALOG.targets.creature.some(row => row.id === id)).toBe(false);
      expect(enemyBlockFor(id, source.stats.family, source.stats.tier)).toBeUndefined();
      const preset = stagedCreaturePreset(id)!;
      expect(preset).toBeDefined();
      const actor = createFeatureLabEntity(preset, { entityId: "source-review", groundPosition: [0, 0, 0], baseY: 0 });
      expect(actor.view?.assetId).toBe(source.assetId);
      expect(actor.combat?.maxHealth).toBe(source.stats.maxHealth);
      expect(actor.meta?.enemyDefId).toBe(source.stats.id);
    }
    expect(stagedCreaturePreset("candidate:missing")).toBeUndefined();
  });
});
