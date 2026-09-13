import { describe, expect, it } from 'vitest';
import { REGIONS } from '../game/src/content/regions.js';
import { FAIRY_GARDEN_SPECIES } from '../game/src/content/fairyGardenCreatures.js';
import { FAIRY_TERRACE_ENCOUNTERS, FAIRY_TERRACE_GROUPS, FAIRY_TERRACE_HABITATS } from '../game/src/content/fairyTerraceEncounters.js';
import { encounterPopulationCount, encounterActorId } from '../game/src/content/encounterPopulation.js';
import { habitatIdleTargets } from '../game/src/world/habitatMovement.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, FAIRY_MINIBOSS_SOCKETS } from '../game/src/world/fairyLandforms.js';

describe('authored ordinary fairy terrace encounters', () => {
  it('registers twelve mixed clearings with seven residents apiece and stable unique actor IDs', () => {
    const siteIds = [...FAIRY_COMBAT_PLATEAUS, ...FAIRY_DEEP_PATH_CLEARINGS].map(site => site.id).sort();
    expect([...new Set(FAIRY_TERRACE_ENCOUNTERS.map(entry => entry.siteId))].sort()).toEqual(siteIds);
    expect(FAIRY_TERRACE_GROUPS).toHaveLength(24);
    expect(FAIRY_TERRACE_HABITATS).toHaveLength(24);
    const actorIds: string[] = [];
    for (const siteId of siteIds) {
      const entries = FAIRY_TERRACE_ENCOUNTERS.filter(entry => entry.siteId === siteId);
      expect(entries.map(entry => encounterPopulationCount(entry.group))).toEqual([4, 3]);
      for (const { group, habitat } of entries) {
        expect(group.boss || group.miniBoss).toBeFalsy();
        expect(group.assetId.startsWith('fairy_garden_')).toBe(true);
        expect(habitat.anchors).toHaveLength(group.count);
        expect(habitat.groupId).toBe(group.id);
        for (let index = 0; index < group.count; index++) actorIds.push(encounterActorId(group, index));
      }
    }
    expect(actorIds).toHaveLength(84);
    expect(new Set(actorIds).size).toBe(84);
  });

  it('wires all twelve accepted species into each region without legacy ordinary bodies', () => {
    for (const regionId of ['gloamgarden', 'faeholme']) {
      const region = REGIONS.find(row => row.id === regionId)!;
      const encounters = FAIRY_TERRACE_ENCOUNTERS.filter(entry => entry.habitat.regionId === regionId);
      expect(encounters.map(entry => entry.speciesId).sort()).toEqual(
        FAIRY_GARDEN_SPECIES.filter(entry => entry.regionId === regionId).map(entry => entry.id).sort());
      const groups = region.enemyGroups.filter(group => !group.boss && !group.miniBoss);
      expect(groups.map(group => group.id).sort()).toEqual(encounters.map(entry => entry.group.id).sort());
      expect(groups.reduce((sum, group) => sum + encounterPopulationCount(group), 0)).toBe(42);
    }
  });

  it('reserves every guardian socket while residents idle near their own anchors', () => {
    for (const { group, habitat } of FAIRY_TERRACE_ENCOUNTERS) {
      for (const [index, anchor] of habitat.anchors.entries()) {
        const idle = habitatIdleTargets(encounterActorId(group, index), [anchor[0], 0, anchor[1]], habitat);
        expect(idle.ranging).toBe(false);
        expect(idle.nearestAnchorIndex).toBe(index);
        for (const point of [anchor, ...idle.candidates.map(candidate => [candidate.position[0], candidate.position[2]])]) {
          for (const socket of FAIRY_MINIBOSS_SOCKETS.filter(entry => entry.regionId === habitat.regionId)) {
            expect(Math.hypot(point[0]! - socket.position[0], point[1]! - socket.position[1]),
              `${group.id} reserves ${socket.id}`).toBeGreaterThanOrEqual(12);
          }
        }
      }
    }
  });
});
