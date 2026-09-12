import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAIRY_ORE_RESOURCES, FAIRY_TREE_RESOURCES } from '../game/src/content/fairyOres.js';
import { CROWNWARD } from '../game/src/content/crownward.js';
import { FAIRY_REGIONS } from '../game/src/content/fairyRegions.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { RECIPES } from '../game/src/content/recipes.js';
import { resourceDef } from '../game/src/content/resources.js';
import { FAIRY_RESOURCE_SITES, authoredSiteForCluster, worldSitePoint } from '../game/src/content/worldSites.js';

const regions = [CROWNWARD, ...FAIRY_REGIONS];
const manifest = JSON.parse(readFileSync(new URL('../game/public/assets/manifest.json', import.meta.url), 'utf8'));
const assets = new Set<string>(manifest.assets.map((asset: { id: string }) => asset.id));

describe('Crownward and fairy gathering content', () => {
  it('requires the regional Mining level and yields materials usable by existing production', () => {
    expect(FAIRY_ORE_RESOURCES.map(row => row.reqLevel)).toEqual([30, 40, 60]);
    for (const ore of FAIRY_ORE_RESOURCES) {
      expect(resourceDef(ore.id)).toBe(ore);
      expect(ore.tier).toBe(ore.reqLevel);
      expect(ALL_ITEMS.some(item => item.id === ore.itemId)).toBe(true);
      expect(RECIPES.some(recipe => recipe.kind === 'smelt' && recipe.inputs.some(input => input.itemId === ore.itemId))).toBe(true);
      for (const bonus of ore.bonus ?? []) expect(ALL_ITEMS.some(item => item.id === bonus.itemId)).toBe(true);
      expect(ore.presentation.depletedAssetId).toBe(`${ore.presentation.availableAssetIds[0]}_spent`);
      for (const id of [...ore.presentation.availableAssetIds, ore.presentation.depletedAssetId!]) expect(assets.has(id), id).toBe(true);
    }
  });

  it('keeps local tree skins on the existing high tier timber economy', () => {
    expect(FAIRY_TREE_RESOURCES.map(row => row.itemId)).toEqual(['willow_log', 'yew_log']);
    for (const tree of FAIRY_TREE_RESOURCES) {
      expect(ALL_ITEMS.find(item => item.id === tree.itemId)?.tier).toBe(tree.reqLevel);
      expect(resourceDef(tree.id)).toBe(tree);
      for (const id of [...tree.presentation.availableAssetIds, tree.presentation.depletedAssetId!]) expect(assets.has(id), id).toBe(true);
    }
  });

  it('connects every new cluster to a complete authored site inside its own region', () => {
    const clusters = regions.flatMap(region => region.clusters);
    const siteClusters = new Set(FAIRY_RESOURCE_SITES.flatMap(site => site.resourceSlots.map(slot => slot.clusterId)));
    expect(siteClusters.size).toBe(15);
    expect(FAIRY_RESOURCE_SITES).toHaveLength(15);
    for (const site of FAIRY_RESOURCE_SITES) {
      const region = regions.find(candidate => candidate.id === site.regionId)!;
      const cluster = clusters.find(candidate => candidate.locationId === site.locationId)!;
      expect(region.locations.some(location => location.id === site.locationId)).toBe(true);
      expect(cluster.centre).toEqual(site.centre);
      expect(authoredSiteForCluster(cluster.id)).toBe(site);
      expect(site.resourceSlots).toHaveLength(cluster.count);
      expect(new Set(site.resourceSlots.map(slot => slot.index)).size).toBe(cluster.count);
      const resource = resourceDef(cluster.resourceId);
      expect(resource.reqLevel).toBe(region.tier);
      for (const slot of site.resourceSlots) {
        expect(slot.clusterId).toBe(cluster.id);
        const [x, z] = worldSitePoint(site, slot.x, slot.z);
        expect(x).toBeGreaterThan(region.bounds.min[0] + 2);
        expect(x).toBeLessThan(region.bounds.max[0] - 2);
        expect(z).toBeGreaterThan(region.bounds.min[1] + 2);
        expect(z).toBeLessThan(region.bounds.max[1] - 2);
      }
      if (site.kind === 'mine') {
        expect(site.cutFace!.stations.map(station => [station.clusterId, station.index]))
          .toEqual(site.resourceSlots.map(slot => [slot.clusterId, slot.index]));
        for (let i = 1; i < site.resourceSlots.length; i++) {
          expect(site.resourceSlots[i]!.x - site.resourceSlots[i - 1]!.x).toBeGreaterThan(3.5);
        }
      } else {
        expect(site.resourceSlots.every(slot => Math.abs(slot.x) >= 8)).toBe(true);
      }
      for (const dressing of site.dressing) expect(assets.has(dressing.assetId), dressing.assetId).toBe(true);
    }
  });
});
