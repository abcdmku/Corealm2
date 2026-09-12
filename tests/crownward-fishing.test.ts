import { describe, expect, it } from 'vitest';
import { CROWNWARD_FISH, CROWNWARD_FISH_ITEMS, CROWNWARD_FISH_RESOURCES, CROWNWARD_FISH_RECIPES, crownwardFisheries } from '../game/src/content/crownwardFishing.js';
import { CROWNWARD_RIVER_CHANNELS, CROWNWARD_RIVER_LAB_CHANNELS } from '../game/src/content/crownwardRiver.js';
import { carveRiverTerrain, riverWaterBodies } from '../game/src/world/riverChannels.js';
import { fishingSiteAnchors } from '../game/src/app/fishingAccess.js';

describe('Crownward fishing', () => {
  it('requires T30 trout, T40 tuna and T60 salmon and supplies complete cooking outputs', () => {
    expect(CROWNWARD_FISH.map(f => [f.name, f.tier])).toEqual([['Trout',30], ['Tuna',40], ['Salmon',60]]);
    for (const fish of CROWNWARD_FISH) {
      const resource = CROWNWARD_FISH_RESOURCES.find(r => r.itemId === fish.id)!;
      expect(resource.reqLevel).toBe(fish.tier);
      expect(resource.tier).toBe(fish.tier);
      const recipe = CROWNWARD_FISH_RECIPES.find(r => r.inputs[0]!.itemId === fish.id)!;
      expect(recipe.reqLevel).toBe(fish.tier);
      expect(CROWNWARD_FISH_ITEMS.find(i => i.id === recipe.output.itemId)?.food?.healAmount).toBeGreaterThan(0);
      expect(CROWNWARD_FISH_ITEMS.some(i => i.id === recipe.burntItemId)).toBe(true);
    }
  });
  for (const [name, channels] of [['lab', CROWNWARD_RIVER_LAB_CHANNELS], ['world', CROWNWARD_RIVER_CHANNELS]] as const) {
    it(`places all 15 ${name} schools in existing water with dry casting stances`, () => {
      const fixture = crownwardFisheries(channels);
      const height = (x: number, z: number) => carveRiverTerrain(8, x, z, channels);
      const anchors = fishingSiteAnchors(fixture.sites, riverWaterBodies(channels), height);
      expect(anchors.schools.size).toBe(15);
      for (const [id, school] of anchors.schools) {
        expect(school[1] - height(school[0], school[2])).toBeGreaterThanOrEqual(.55);
        expect(anchors.banks.has(id)).toBe(true);
        expect(anchors.banks.get(id)![1]).toBeGreaterThan(school[1]);
      }
      expect(fixture.clusters.filter(c => c.resourceId.includes('salmon')).every(c => c.waterBodyId!.startsWith('river:'))).toBe(true);
      expect(fixture.clusters.filter(c => !c.resourceId.includes('salmon')).every(c => c.waterBodyId!.startsWith('lake:'))).toBe(true);
    });
  }
});
