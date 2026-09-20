import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";
import { STARTER_CREATURES } from "../game/src/content/starterCreatures.js";
import { STARTER_GROUPS, STARTER_HABITATS } from "../game/src/content/starterHabitats.js";
import { REGIONS } from "../game/src/content/regions.js";
import { enemyBlockFor } from "../game/src/content/enemies.js";
import { habitatForGroup } from "../game/src/content/worldHabitats.js";
import { fantasyEncounter, FANTASY_ENCOUNTER_SPECIES } from "../game/src/content/fantasyEncounters.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { populationGroup } from "../game/src/content/encounterPlacement.js";
import { LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES } from "../game/src/content/legacyEncounterPlacements.js";
import { encounterActorId } from "../game/src/content/encounterPopulation.js";

describe("starter creature integration", () => {
  it("uses established animal and insect sources with combat clips, never excluded platformer models", () => {
    for (const species of STARTER_CREATURES) {
      const asset = MANIFEST.assets.find(asset => asset.id === species.assetId)!;
      expect(asset).toBeDefined();
      expect(asset.pack).not.toBe("ultimate-platformer-pack");
      expect(asset.animations).toEqual(expect.arrayContaining(["Idle", "Walk", "Attack", "Hit", "Death"]));
      expect(species.stats.tier).toBe(1);
      expect(species.stats.maxHit).toBeLessThanOrEqual(2);
      for (const drop of species.stats.lootRolls.flatMap(roll => roll.drops)) expect(ALL_ITEMS.some(item => item.id === drop.itemId)).toBe(true);
    }
  });
  it("keeps starter populations linked to their compiled habitats", () => {
    const region = REGIONS.find(region => region.id === "fallowmarch")!;
    for (const source of STARTER_GROUPS) {
      const group = region.enemyGroups.find(row => row.id === source.id)!;
      expect(group).toBeDefined();
      const habitat = habitatForGroup(group.id)!;
      expect(habitat.anchors).toHaveLength(group.count);
      expect(group.count).toBeGreaterThan(0);
    }
  });
});
