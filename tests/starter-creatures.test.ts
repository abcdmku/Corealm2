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
      for (const drop of species.stats.drops) expect(ALL_ITEMS.some(item => item.id === drop.itemId)).toBe(true);
    }
  });
  it("keeps the starter source roster and resolves the accepted occupants of each stable habitat", () => {
    const region = REGIONS.find(region => region.id === "fallowmarch")!;
    expect(STARTER_GROUPS.reduce((n, group) => n + group.count, 0)).toBe(15);
    const wasps = STARTER_GROUPS.filter(group => group.family.endsWith("_wasp"));
    expect(wasps).toHaveLength(3);
    expect(new Set(wasps.map(group => group.assetId)).size).toBe(3);
    expect(wasps.every(group => group.count === 1 && group.assetId !== "creature_marsh_wasp")).toBe(true);
    for (const group of STARTER_GROUPS) {
      expect(region.enemyGroups.filter(row => row.id === group.id)).toHaveLength(1);
      const habitat = habitatForGroup(group.id)!;
      expect(habitat.centre).toEqual(LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES[group.id]?.centre
        ?? STARTER_HABITATS.find(row => row.groupId === group.id)!.centre);
      expect(habitat.activity).toBe(FANTASY_ENCOUNTER_SPECIES[group.id] ? "patrol" : STARTER_HABITATS.find(row => row.groupId === group.id)!.activity);
      const occupant = populationGroup(fantasyEncounter(group));
      expect(occupant.count).toBeGreaterThanOrEqual(7);
      expect(occupant.count).toBeLessThanOrEqual(15);
      expect(occupant.legacyCount).toBe(group.count);
      expect(habitat.anchors).toHaveLength(occupant.count);
      expect(encounterActorId(occupant, 0)).toBe(group.count === 1 ? group.id : `${group.id}_1`);
      expect(region.enemyGroups.find(row => row.id === group.id)).toEqual(occupant);
      expect(enemyBlockFor(group.id, occupant.family, occupant.tier)?.name).toBe(occupant.name);
    }
  });
});
