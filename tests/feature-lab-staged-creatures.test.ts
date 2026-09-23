import { describe, expect, it } from "vitest";
import { RPG_BESTIARY_STAGED } from "../game/src/content/rpgBestiary.js";
import { enemyBlockFor } from "../game/src/content/enemies.js";
import { createFeatureLabEntity, FEATURE_LAB_CATALOG, stagedCreaturePreset } from "../game/src/featureLab/catalog.js";

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
    expect(preview.npc).toEqual(authored.npc);
    expect(baseYCalls).toEqual(["npc_fey_nightshade", "npc_slayer_aevra"]);
    expect(createFeatureLabEntity(preset, placement).view?.assetId).toBe("npc_fey_nightshade");
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
