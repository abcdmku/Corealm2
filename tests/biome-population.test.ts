import { describe, expect, it } from 'vitest';
import { BIOME_POPULATION } from '../game/src/content/biomePopulation.js';
import { REGIONS, SOURCE_REGIONS } from '../game/src/content/regions.js';
import { inStarterWildlifeArea } from '../game/src/content/fantasyEncounters.js';
import { WORLD_HABITATS } from '../game/src/content/worldHabitats.js';
import { encounterBodyRadius } from '../game/src/content/encounterPlacement.js';
import { encounterActorId } from '../game/src/content/encounterPopulation.js';
import { lavaClearanceAt } from '../game/src/content/wildernessLava.js';

// This redesign predates Crownward and the separately authored fairy populations.
const originalRegionIds = new Set(['fallowmarch', 'vellenwood', 'karrowmoor', 'kilnhalt', 'wilderness']);
const originalRegions = SOURCE_REGIONS.filter(region => originalRegionIds.has(region.id));
const current = REGIONS.flatMap(region => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]);
const population = BIOME_POPULATION.map(source => ({ source,
  group: current.find(group => group.id === source.id)!,
  habitat: WORLD_HABITATS.find(habitat => habitat.groupId === source.id)!,
}));

describe('new biome population reservations', () => {
  it('adds seven to fifteen residents per authored encounter in every biome', () => {
    expect(BIOME_POPULATION.length).toBeGreaterThanOrEqual(50);
    expect(new Set(BIOME_POPULATION.map(pack => pack.id)).size).toBe(BIOME_POPULATION.length);
    for (const { source, group } of population) {
      expect(group.count, source.id).toBeGreaterThanOrEqual(7);
      expect(group.count, source.id).toBeLessThanOrEqual(15);
      expect(encounterActorId(group, 0), source.id).toBe(`${source.id}_1`);
    }
    for (const region of originalRegions) {
      const packs = population.filter(pack => pack.source.regionId === region.id);
      expect(packs.length, region.id).toBeGreaterThanOrEqual(8);
      expect(packs.reduce((sum, pack) => sum + pack.group.count, 0), region.id).toBeGreaterThanOrEqual(packs.length * 7);
    }
  });

  it('fits each measured body inside its habitat and region with distinct anchors outside starter fields', () => {
    for (const { source, group, habitat } of population) {
      const region = REGIONS.find(region => region.id === source.regionId)!;
      const bodyRadius = encounterBodyRadius(group);
      expect(habitat, source.id).toBeDefined();
      expect(habitat.anchors.length, source.id).toBe(group.count);
      expect(habitat.dressing, source.id).toEqual([]);
      expect(inStarterWildlifeArea(source.regionId, habitat.centre, -habitat.radius), source.id).toBe(false);
      for (const [x, z] of habitat.anchors) {
        expect(Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) + bodyRadius, source.id).toBeLessThanOrEqual(habitat.radius + 1e-6);
        expect(x - bodyRadius, source.id).toBeGreaterThan(region.bounds.min[0]);
        expect(x + bodyRadius, source.id).toBeLessThan(region.bounds.max[0]);
        expect(z - bodyRadius, source.id).toBeGreaterThan(region.bounds.min[1]);
        expect(z + bodyRadius, source.id).toBeLessThan(region.bounds.max[1]);
      }
      for (let a = 0; a < group.count; a++) for (let b = a + 1; b < group.count; b++) {
        const first = habitat.anchors[a]!, second = habitat.anchors[b]!;
        expect(Math.hypot(first[0] - second[0], first[1] - second[1]), source.id).toBeGreaterThanOrEqual(bodyRadius * 2 + .5 - 1e-6);
      }
    }
  });

  it('keeps nearby packs physically separate and every body clear of active northern lava banks', () => {
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
