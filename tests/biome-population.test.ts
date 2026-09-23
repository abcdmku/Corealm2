import { describe, expect, it } from 'vitest';
import { REGIONS } from '../game/src/content/regions.js';
import { inStarterWildlifeArea } from '../game/src/content/fantasyEncounters.js';
import { WORLD_HABITATS } from '../game/src/content/worldHabitats.js';
import { encounterBodyRadius } from '../game/src/content/encounterPlacement.js';
import { encounterActorId } from '../game/src/content/encounterPopulation.js';
import { lavaClearanceAt } from '../game/src/content/wildernessLava.js';
import { WORLD_CONTENT, WORLD_PLACEMENTS } from '../game/src/content/worldData.js';

const current = REGIONS.flatMap(region => [
  ...region.enemyGroups.map(group => ({ ...group, regionId: region.id })),
  ...(region.dungeon?.enemyGroups.map(group => ({ ...group, regionId: region.dungeon!.id })) ?? []),
]);
const population = WORLD_PLACEMENTS.filter(placement => placement.id.startsWith('population_')).map(source => ({ source,
  group: current.find(group => group.id === source.id)!,
  habitat: WORLD_HABITATS.find(habitat => habitat.groupId === source.id)!,
  creature: WORLD_CONTENT.creatureByGroup.get(source.id),
}));

describe('compiled world population placements', () => {
  it('projects authored placements and compiled creatures into live groups and habitats', () => {
    expect(population.length).toBeGreaterThan(0);
    expect(new Set(population.map(row => row.source.id)).size).toBe(population.length);
    for (const { source, group, habitat, creature } of population) {
      expect(group, source.id).toBeDefined();
      expect(habitat, source.id).toBeDefined();
      expect(creature, source.id).toBeDefined();
      expect(group.count, source.id).toBe(source.count);
      expect(group.regionId, source.id).toBe(source.regionId);
      expect(group.assetId, source.id).toBe(creature!.assetId);
      expect(group.family, source.id).toBe(creature!.stats.family);
      expect(WORLD_CONTENT.habitats, source.id).toContain(habitat);
      expect(habitat.groupId, source.id).toBe(group.id);
      expect(habitat.regionId, source.id).toBe(source.regionId);
      expect(habitat.anchors, source.id).toHaveLength(source.count);
      expect(encounterActorId(group, 0), source.id).toBe(`${source.id}_1`);
    }
  });

  it('fits each compiled body inside its habitat and region with distinct anchors outside starter fields', () => {
    for (const { source, group, habitat } of population) {
      const region = REGIONS.find(region => region.id === source.regionId)!;
      const bodyRadius = encounterBodyRadius(group);
      expect(habitat, source.id).toBeDefined();
      expect(habitat.anchors.length, source.id).toBe(group.count);
      expect(habitat.dressing, source.id).toEqual([]);
      expect(inStarterWildlifeArea(group.regionId, habitat.centre, -habitat.radius), source.id).toBe(false);
      for (const [x, z] of habitat.anchors) {
        expect(Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) + bodyRadius, source.id).toBeLessThanOrEqual(habitat.radius + 1e-6);
        expect(x - bodyRadius, source.id).toBeGreaterThan(region.bounds.min[0]);
        expect(x + bodyRadius, source.id).toBeLessThan(region.bounds.max[0]);
        expect(z - bodyRadius, source.id).toBeGreaterThan(region.bounds.min[1]);
        expect(z + bodyRadius, source.id).toBeLessThan(region.bounds.max[1]);
      }
      for (let a = 0; a < group.count; a++) for (let b = a + 1; b < group.count; b++) {
        const first = habitat.anchors[a]!, second = habitat.anchors[b]!;
        expect(Math.hypot(first[0] - second[0], first[1] - second[1]) + .01, source.id).toBeGreaterThanOrEqual(bodyRadius * 2);
      }
    }
  });

  it('keeps nearby compiled population placements physically separate and clear of active northern lava banks', () => {
    const errors: string[] = [];
    for (let a = 0; a < population.length; a++) {
      const first = population[a]!, radius = encounterBodyRadius(first.group);
      for (const anchor of first.habitat.anchors) {
        const clearance = lavaClearanceAt(...anchor) - radius;
        if (clearance < 1) errors.push(`${first.group.id}: ${clearance.toFixed(3)} m from lava bank`);
      }
      for (const second of population.slice(a + 1)) {
        const secondRadius = encounterBodyRadius(second.group);
        for (const p of first.habitat.anchors) for (const q of second.habitat.anchors) {
          const clearance = Math.hypot(p[0] - q[0], p[1] - q[1]) - radius - secondRadius;
          if (clearance < .5 - 1e-6) errors.push(`${first.group.id}/${second.group.id}: ${clearance.toFixed(3)} m between bodies`);
        }
      }
    }
    expect(errors).toEqual([]);
  });
});
