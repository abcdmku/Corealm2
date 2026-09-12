import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tierSilhouetteScale } from '../game/src/core/math.js';
import { FAIRY_CREATURE_SPECIES } from '../game/src/content/fairyCreatures.js';
import { FAIRY_TERRACE_ENCOUNTERS, FAIRY_TERRACE_GROUPS, FAIRY_TERRACE_HABITATS } from '../game/src/content/fairyTerraceEncounters.js';
import { createEncounterFormation } from '../game/src/content/encounterPopulation.js';
import { habitatIdleTargets } from '../game/src/world/habitatMovement.js';
import { applyFairyLandforms, FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, FAIRY_MINIBOSS_SOCKETS } from '../game/src/world/fairyLandforms.js';

/**
 * Root-centred horizontal diagonals, rounded outward from the accepted source GLBs.
 * Unlike half the largest side, these include each mesh's offset from its actor root.
 * The manifest check below verifies promoted meshes against these durable conservative bounds.
 */
const NATIVE_ROOT_ENVELOPES: Readonly<Record<string, number>> = {
  fairy_monster_11: 1.15, fairy_monster_14: 0.94, fairy_monster_16: 0.67,
  fairy_monster_21: 0.65, fairy_monster_27: 1.12, fairy_monster_30: 1.52,
};

function bodyEnvelope(group: typeof FAIRY_TERRACE_GROUPS[number]): number {
  return NATIVE_ROOT_ENVELOPES[group.assetId]! * group.scale * tierSilhouetteScale(group.tier);
}

describe('authored ordinary fairy terrace encounters', () => {
  it('populates all six tables and six deep hollows with seven stable ordinary residents', () => {
    const siteIds = [...FAIRY_COMBAT_PLATEAUS, ...FAIRY_DEEP_PATH_CLEARINGS].map(site => site.id).sort();
    expect(FAIRY_TERRACE_ENCOUNTERS.map(entry => entry.siteId).sort()).toEqual(siteIds);
    expect(FAIRY_TERRACE_GROUPS).toHaveLength(12);
    expect(FAIRY_TERRACE_HABITATS).toHaveLength(12);
    const actorIds = new Set<string>();
    for (const { group, habitat } of FAIRY_TERRACE_ENCOUNTERS) {
      expect(group.count).toBe(7);
      expect(group.boss || group.miniBoss).toBeFalsy();
      expect(group.assetId.startsWith('fairy_monster_')).toBe(true);
      expect(habitat.anchors).toHaveLength(7);
      expect(habitat.groupId).toBe(group.id);
      const formation = createEncounterFormation(group, {
        bodyRadius: bodyEnvelope(group), preferredAnchors: habitat.anchors,
        maxRadius: habitat.radius, count: 7, bodyGap: 6,
      });
      expect(formation.anchors).toEqual(habitat.anchors);
      expect(createEncounterFormation(group, {
        bodyRadius: bodyEnvelope(group), preferredAnchors: habitat.anchors,
        maxRadius: habitat.radius, count: 7, bodyGap: 6,
      }).actorIds).toEqual(formation.actorIds);
      for (const id of formation.actorIds) {
        expect(actorIds.has(id), id).toBe(false);
        actorIds.add(id);
      }
    }
    expect(actorIds.size).toBe(84);
  });

  it('keeps full bodies and idle movement within each receiving floor and away from banks', () => {
    for (const { siteId, group, habitat } of FAIRY_TERRACE_ENCOUNTERS) {
      const rootEnvelope = bodyEnvelope(group), motionEnvelope = rootEnvelope + habitat.roamRadius!;
      const plateau = FAIRY_COMBAT_PLATEAUS.find(entry => entry.id === siteId);
      const expectedRise = plateau?.rise ?? 0;
      for (const anchor of habitat.anchors) {
        expect(Math.hypot(anchor[0] - habitat.centre[0], anchor[1] - habitat.centre[1]) + motionEnvelope,
          `${siteId} receiving-floor containment`).toBeLessThan(habitat.radius);
        for (let index = 0; index < 24; index++) {
          const angle = index * Math.PI / 12;
          const x = anchor[0] + Math.cos(angle) * motionEnvelope;
          const z = anchor[1] + Math.sin(angle) * motionEnvelope;
          expect(applyFairyLandforms(x, z, 0), `${siteId} body/idle edge ${index}`).toBeCloseTo(expectedRise, 5);
        }
      }
    }
  });

  it('retains ten-metre root spacing and a running gap after two residents wander toward each other', () => {
    for (const { group, habitat } of FAIRY_TERRACE_ENCOUNTERS) {
      const body = bodyEnvelope(group);
      for (let a = 0; a < habitat.anchors.length; a++) for (let b = a + 1; b < habitat.anchors.length; b++) {
        const left = habitat.anchors[a]!, right = habitat.anchors[b]!;
        const distance = Math.hypot(left[0] - right[0], left[1] - right[1]);
        expect(distance, `${group.id} roots ${a}/${b}`).toBeGreaterThanOrEqual(10);
        expect(distance - body * 2 - habitat.roamRadius! * 2,
          `${group.id} moving body gap ${a}/${b}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('reserves every universal miniboss socket while keeping idle residents near their own anchor', () => {
    for (const { group, habitat } of FAIRY_TERRACE_ENCOUNTERS) {
      for (const [index, anchor] of habitat.anchors.entries()) {
        const idle = habitatIdleTargets(`${group.id}_${index + 1}`, [anchor[0], 0, anchor[1]], habitat);
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

  it('uses all six species per tier and reserves larger elders for the wider remote hollows', () => {
    for (const regionId of ['gloamgarden', 'faeholme']) {
      const encounters = FAIRY_TERRACE_ENCOUNTERS.filter(entry => entry.habitat.regionId === regionId);
      expect(encounters.map(entry => entry.speciesId).sort()).toEqual(
        FAIRY_CREATURE_SPECIES.filter(entry => entry.regionId === regionId).map(entry => entry.id).sort(),
      );
      for (const { speciesId, habitat } of encounters.filter(entry => entry.speciesId.startsWith('elder_'))) {
        expect(habitat.radius, speciesId).toBeGreaterThanOrEqual(19);
      }
    }
    for (const id of ['moonpetal_table', 'prism_table']) {
      const firstPlateau = FAIRY_TERRACE_ENCOUNTERS.find(entry => entry.siteId === id)!;
      const species = FAIRY_CREATURE_SPECIES.find(entry => entry.id === firstPlateau.speciesId)!;
      expect(species.stats.behaviour).toBe('territorial');
    }
  });

  it('bounds every promoted source model using the same full root-space measurement', () => {
    const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8')) as {
      assets: { id: string; base: { x: number; z: number }; size: { x: number; z: number } }[];
    };
    // Staged modules can be tested before promotion. Once a model ships, its real bounds are required.
    for (const [id, envelope] of Object.entries(NATIVE_ROOT_ENVELOPES)) {
      const asset = manifest.assets.find(entry => entry.id === id);
      if (!asset) continue;
      const x = Math.max(Math.abs(asset.base.x), Math.abs(asset.base.x + asset.size.x));
      const z = Math.max(Math.abs(asset.base.z), Math.abs(asset.base.z + asset.size.z));
      expect(Math.hypot(x, z), id).toBeLessThanOrEqual(envelope);
    }
  });
});
