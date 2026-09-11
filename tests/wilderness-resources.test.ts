import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { WILDERNESS_ORE_RESOURCES, WILDERNESS_RESOURCE_CLUSTERS, WILDERNESS_RESOURCE_LOCATIONS, WILDERNESS_RESOURCE_SITES, WILDERNESS_TREE_RESOURCES, WILDERNESS_TREE_VARIANTS } from '../game/src/content/wildernessResources.js';
import { WILDERNESS_RESOURCE_INTENTS, wildernessTierAt } from '../game/src/content/wildernessDepth.js';
import { RESOURCE_TREE_DESIGNS, retainLeafSpray, sculptOreNormal, sculptOrePoint, sculptTreeNormal, sculptTreePoint, type Point } from '../tools/wilderness-resources/sculpt.js';

describe('Wilderness gathering sites', () => {
  it('connects every frozen resource intention to one complete, locally placed harvest cluster', () => {
    expect(WILDERNESS_RESOURCE_SITES.map(s => s.id)).toEqual(WILDERNESS_RESOURCE_INTENTS.map(s => s.id));
    const definitions = new Map([...WILDERNESS_ORE_RESOURCES, ...WILDERNESS_TREE_RESOURCES].map(r => [r.id, r]));
    for (const intent of WILDERNESS_RESOURCE_INTENTS) {
      const site = WILDERNESS_RESOURCE_SITES.find(s => s.id === intent.id)!;
      const cluster = WILDERNESS_RESOURCE_CLUSTERS.find(c => c.locationId === intent.id)!;
      const resource = definitions.get(cluster.resourceId)!;
      expect(site.centre).toEqual(intent.position); expect(cluster.centre).toEqual(intent.position);
      expect(WILDERNESS_RESOURCE_LOCATIONS.some(l => l.id === site.locationId)).toBe(true);
      expect(resource.reqLevel).toBe(wildernessTierAt(site.centre[1])); expect(resource.tier).toBe(intent.tier);
      expect(site.resourceSlots).toHaveLength(cluster.count);
      expect(site.resourceSlots.map(slot => slot.index)).toEqual(Array.from({ length: cluster.count }, (_, i) => i + 1));
      for (const slot of site.resourceSlots) {
        expect(slot.clusterId).toBe(cluster.id); expect(Math.abs(slot.x)).toBeLessThan(site.extent[0] - 4);
        expect(Math.abs(slot.z)).toBeLessThan(site.extent[1] - 4);
      }
    }
  });
  it('keeps mine seams connected to a cut face and opens a clear approach to every grove', () => {
    for (const site of WILDERNESS_RESOURCE_SITES) {
      if (site.kind === 'mine') {
        expect(site.cutFace!.stations.map(s => [s.clusterId, s.index])).toEqual(site.resourceSlots.map(s => [s.clusterId, s.index]));
        expect(site.cutFace!.frontSetback).toBe(.4); expect(site.terrain.backRise).toBeGreaterThan(4);
        for (let i = 1; i < site.resourceSlots.length; i++) expect(site.resourceSlots[i]!.x - site.resourceSlots[i - 1]!.x).toBeGreaterThan(3.5);
      } else {
        expect(site.resourceSlots.every(s => Math.abs(s.x) >= 8)).toBe(true);
        expect(site.resourceSlots.some(s => s.x < 0) && site.resourceSlots.some(s => s.x > 0)).toBe(true);
      }
    }
  });
  it('gives mineable hosts explicit matching spent states and preserves real timber yields', () => {
    for (const ore of WILDERNESS_ORE_RESOURCES) expect(ore.presentation.depletedAssetId).toBe(`${ore.presentation.availableAssetIds[0]}_spent`);
    expect(WILDERNESS_TREE_RESOURCES.map(t => t.itemId)).toEqual(['teak_log', 'magic_log']);
    expect(WILDERNESS_TREE_VARIANTS.map(t => t.assetId)).toEqual(RESOURCE_TREE_DESIGNS.map(t => t.id));
    for (const alias of WILDERNESS_TREE_VARIANTS) {
      const resource = WILDERNESS_TREE_RESOURCES.find(row => row.id === alias.resourceId)!;
      expect(resource.presentation.availableAssetIds).toContain(alias.assetId); expect(resource.itemId).toBe(alias.itemId);
      expect(resource.presentation.depletedAssetId).toBe(`corealm_stump_wilderness_${alias.speciesId}`);
    }
  });
});

describe('continuous Wilderness resource sculpts', () => {
  it.each(RESOURCE_TREE_DESIGNS)('$id keeps the rooted pivot fixed and normals perpendicular to the sculpted wood', ({ id }) => {
    expect(sculptTreePoint(id, [0, 0, 0])).toEqual([0, 0, 0]);
    for (const point of [[.4, .8, .2], [2, 6, -2], [0, 11, 3]] as Point[]) {
      const n = sculptTreeNormal(id, point, [0, 0, 1]);
      const a = new Vector3(...sculptTreePoint(id, point));
      const b = new Vector3(...sculptTreePoint(id, [point[0] + .0001, point[1], point[2]])).sub(a).normalize();
      expect(Math.abs(b.dot(new Vector3(...n)))).toBeLessThan(.001);
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
    }
  });
  it('preserves living lee sprays while stripping whole windward sprays', () => {
    expect(retainLeafSpray('corealm_teak_lastroot', [-2, 9, 0], 7)).toBe(true);
    expect(retainLeafSpray('corealm_teak_lastroot', [2, 9, 0], 7)).toBe(false);
    expect(retainLeafSpray('corealm_teak_embershelter', [-2, 9, 0], 7)).toBe(false);
    expect(retainLeafSpray('corealm_teak_embershelter', [2, 9, 0], 7)).toBe(true);
  });
  it.each(['cindervein', 'nightglass'] as const)('%s keeps its soil-contact footprint planar through extraction', family => {
    for (const p of [[0, 0, 0], [-.7, 0, .5], [.7, 0, -.5]] as Point[]) expect(sculptOrePoint(family, p)[1]).toBe(0);
    const normal = sculptOreNormal(family, [.3, .7, .2], [0, 1, 0]);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
  });
});
