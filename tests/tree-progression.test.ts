import { describe, expect, it } from "vitest";
import { TREE_SPECIES, treeAssetIds, treeSpeciesForAsset, treeEncounterWeight } from "../game/src/content/treeSpecies.js";
import { resourceDef } from "../game/src/content/resources.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { CAMPFIRE_FUELS } from "../game/src/content/gatheringProductionTiers.js";
import { DEFAULT_SCATTER } from "../game/src/world/scatter.js";

describe("tree species progression", () => {
  it("uses the requested woodcutting levels for both the tree and the harvested log", () => {
    const expected = [["pine",1],["ash",5],["oak",10],["walnut",20],["willow",30],["maple",40],["teak",50],["yew",60],["magic",70]];
    expect(TREE_SPECIES.map(s => [s.id,s.level])).toEqual(expected);
    for (const species of TREE_SPECIES) {
      const resource = resourceDef(species.resourceId);
      expect(resource.reqLevel).toBe(species.level);
      expect(resource.tier).toBe(species.level);
      expect(resource.itemId).toBe(species.logId);
      expect(ALL_ITEMS.find(item => item.id === species.logId)?.name).toBe(`${species.name} Log`);
      expect(CAMPFIRE_FUELS.find(fuel => fuel.logItemId === species.logId)?.tier).toBe(species.level);
      expect(resource.presentation.availableAssetIds).toEqual(treeAssetIds(species));
      for (const assetId of treeAssetIds(species)) expect(treeSpeciesForAsset(assetId)).toBe(species);
    }
    expect(treeSpeciesForAsset("corealm_magic_99")).toBeUndefined();
  });

  it("keeps every future tier possible while reducing its weight as the gap increases", () => {
    for (const area of [1,5,10,20]) {
      const future = TREE_SPECIES.filter(s => s.level > area);
      for (const [i,species] of future.entries()) {
        const weight=treeEncounterWeight(species,area);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThan(.08);
        if (i) expect(weight).toBeLessThan(treeEncounterWeight(future[i-1]!,area));
      }
    }
    expect(treeEncounterWeight(TREE_SPECIES[8]!,1)).toBeLessThan(.00001);
  });

  it("divides encounter weight across variants so extra models never make a species more common", () => {
    const pool=DEFAULT_SCATTER.fallowmarch.layers.find(l => l.id === "copse")!.species!;
    const weights = TREE_SPECIES.map(species => pool.filter(e=>treeAssetIds(species).includes(e.assetId)).reduce((n,e)=>n+e.weight!,0));
    expect(weights[0]!/weights.reduce((a,b)=>a+b,0)).toBeGreaterThan(.9);
    for (let i=1;i<weights.length;i++) expect(weights[i]!).toBeLessThan(weights[i-1]!);
    expect(pool.filter(e=>treeSpeciesForAsset(e.assetId)).length).toBe(24);
  });
});
