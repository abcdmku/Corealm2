import { describe, expect, it } from 'vitest';
import type { RegionDef, EnemyGroupDef } from '../game/src/content/regions.js';
import { REGIONS, SURFACE_REGIONS } from '../game/src/content/regions.js';
import { CREATURE_SPECIES } from '../game/src/content/creatureSpecies.js';
import { isReservedUniversalMinibossAsset } from '../game/src/content/universalMinibosses.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';
import type { SemanticEntity, SolidVolume } from '../game/src/contracts.js';
import { buildUniversalMinibossGroups } from '../game/src/world/universalMinibossSpawns.js';
import {
  deriveUniversalMinibossSockets, remapReservedEncounterGroup, validUniversalMinibossFootprint,
} from '../game/src/world/universalMinibossSockets.js';

describe('universal miniboss socket selection', () => {
  it('finds separated sockets around each surface region authored exclusion layout', () => {
    // This proves content exclusions, not the authored world's actual terrain. Root supplies
    // the graded height, water, solids and live residents for final-world placement acceptance.
    for (const region of SURFACE_REGIONS) {
      const options = { seed: 42, heightAt: (x: number, z: number) => x * .02 + z * .04 };
      const sockets = deriveUniversalMinibossSockets(region, options);
      expect(sockets).toEqual(deriveUniversalMinibossSockets(region, options));
      expect(sockets.length).toBeGreaterThanOrEqual(2);
      expect(sockets.length).toBeLessThanOrEqual(128);
      expect(buildUniversalMinibossGroups(region.id, 42, sockets)).toHaveLength(2);
      for (const socket of sockets) {
        const gap = (point: readonly [number, number]) => Math.hypot(socket.position[0] - point[0], socket.position[1] - point[1]);
        if (region.settlement) expect(gap(region.settlement.centre)).toBeGreaterThanOrEqual(45);
        for (const cluster of region.clusters) expect(gap(cluster.centre)).toBeGreaterThanOrEqual(cluster.radius + 14);
        for (const group of region.enemyGroups) if (!group.id.startsWith('universal_miniboss_')) {
          expect(gap(group.centre)).toBeGreaterThanOrEqual(group.radius + (group.boss || group.miniBoss ? 15 : 12));
        }
      }
    }
  });

  it('rejects steep, nonfinite, wet and partially unsupported body footprints', () => {
    const sample = (heightAt: (x: number, z: number) => number) => validUniversalMinibossFootprint('fallowmarch', [0, 0], { seed: 0, heightAt });
    expect(sample(x => x * .499)).toBe(true);
    expect(sample(x => x * .5)).toBe(false);
    expect(sample(x => x > 1 ? NaN : 0)).toBe(false);
    expect(sample(x => x > 1 ? 2 : 0)).toBe(false);
    expect(validUniversalMinibossFootprint('fallowmarch', [0, 0], {
      seed: 0, heightAt: () => 0, canStand: x => x < 1,
    })).toBe(false);
  });

  it('checks rotated solids and actual actor clearance while respecting different floors', () => {
    const solid: SolidVolume = { id: 'angled_wall', kind: 'box', position: [0, 0, 0], size: [10, 3, 1], rotationY: Math.PI / 4 };
    const options = { seed: 0, heightAt: () => 0, solids: [solid] };
    expect(validUniversalMinibossFootprint('fallowmarch', [3, -3], options)).toBe(false);
    expect(validUniversalMinibossFootprint('fallowmarch', [4, 4], options)).toBe(true);
    expect(validUniversalMinibossFootprint('gravelmaw', [3, -3], { ...options, heightAt: () => -25 })).toBe(true);
    const actor: SemanticEntity = { id: 'resident', name: 'Resident', archetype: 'enemy', regionId: 'fallowmarch', tier: 1,
      position: [0, 0, 0], state: 'alive', interactions: ['attack'] };
    expect(validUniversalMinibossFootprint('fallowmarch', [11.9, 0], { seed: 0, heightAt: () => 0, entities: [actor] })).toBe(false);
    expect(validUniversalMinibossFootprint('fallowmarch', [12, 0], { seed: 0, heightAt: () => 0, entities: [actor] })).toBe(true);
    expect(validUniversalMinibossFootprint('gravelmaw', [0, 0], { seed: 0, heightAt: () => -25, entities: [actor] })).toBe(true);
  });

  it('reports an impossible region instead of placing through an exclusion', () => {
    const region: RegionDef = { ...SURFACE_REGIONS[0]!, bounds: { min: [0, 0], max: [90, 90] } };
    expect(() => deriveUniversalMinibossSockets(region, { seed: 0, heightAt: () => NaN })).toThrow('No separated safe');
    expect(() => deriveUniversalMinibossSockets(region, { seed: 0, heightAt: () => 0, canStand: () => false })).toThrow('No separated safe');
  });
  it('uses cave root and body gaps without applying outdoor actor margins underground', () => {
    const resident: SemanticEntity = { id: 'cave_resident', name: 'Cave Resident', archetype: 'enemy', regionId: 'gravelmaw', tier: 10,
      position: [0, -25, 0], state: 'alive', interactions: ['attack'],
      combat: { health: 20, maxHealth: 20, level: 10, aggroRadius: 4, bodyRadius: 1 } };
    const options = { seed: 0, heightAt: () => -25, entities: [resident] };
    expect(validUniversalMinibossFootprint('gravelmaw', [6.49, 0], options)).toBe(false);
    expect(validUniversalMinibossFootprint('gravelmaw', [6.5, 0], options)).toBe(true);
    resident.combat!.bodyRadius = 3;
    expect(validUniversalMinibossFootprint('gravelmaw', [8.49, 0], options)).toBe(false);
    expect(validUniversalMinibossFootprint('gravelmaw', [8.5, 0], options)).toBe(true);
    resident.regionId = 'fallowmarch';
    expect(validUniversalMinibossFootprint('fallowmarch', [8.5, 0], options)).toBe(false);
    resident.regionId = 'gravelmaw';
    resident.archetype = 'npc';
    delete resident.combat;
    expect(validUniversalMinibossFootprint('gravelmaw', [5.9, 0], options)).toBe(false);
    expect(validUniversalMinibossFootprint('gravelmaw', [6, 0], options)).toBe(true);
    const solid: SolidVolume = { id: resident.id, kind: 'cylinder', position: [0, -25, 0], radius: 1.5, height: 2 };
    expect(validUniversalMinibossFootprint('gravelmaw', [6.99, 0], { ...options, solids: [solid] })).toBe(false);
    expect(validUniversalMinibossFootprint('gravelmaw', [7, 0], { ...options, solids: [solid] })).toBe(true);
  });
});

describe('reserved source body remap', () => {
  const ordinary: EnemyGroupDef = { id: 'wilderness_east_basalt_prowl', family: 'basalt_maw', name: 'Basalt Maw',
    tier: 50, assetId: 'creature_basalt_maw', centre: [0, 0], radius: 12, count: 4, scale: 1 };
  it('changes only ordinary body and scale, preserving the encounter balance lookup and save identity', () => {
    const revised = remapReservedEncounterGroup(ordinary);
    expect(revised.assetId).toBe('creature_furnace_grazer');
    const { assetId: _oldAsset, scale: _oldScale, ...before } = ordinary;
    const { assetId: _newAsset, scale: _newScale, ...after } = revised;
    expect(after).toEqual(before);
    expect(ordinary.assetId).toBe('creature_basalt_maw');
    expect(revised.scale).toBeGreaterThan(0);
  });
  it('remaps named bosses at native replacement size while retaining their rank and identity', () => {
    for (const [id, assetId, replacementId, rank] of [
      ['hollow_star', 'creature_hollow_star', 'voidstone_colossus', 'miniBoss'],
      ['amethyst_sovereign_court', 'creature_amethyst_sovereign', 'bloomheart_matriarch', 'boss'],
    ] as const) {
      const boss: EnemyGroupDef = { ...ordinary, id, assetId, count: 1, [rank]: true };
      const revised = remapReservedEncounterGroup(boss);
      const replacement = CREATURE_SPECIES.find(species => species.id === replacementId)!;
      expect(revised.assetId).toBe(replacement.assetId);
      expect(revised[rank]).toBe(true);
      expect(revised.id).toBe(id);
      expect(revised.family).toBe(boss.family);
      expect(revised.tier).toBe(boss.tier);
      expect(revised.scale * tierSilhouetteScale(revised.tier) * (rank === 'boss' ? 1.6 : 1.3))
        .toBeCloseTo(replacement.scale * tierSilhouetteScale(replacement.stats.tier));
    }
  });
  it('retains the two universal slots and unreserved creatures', () => {
    const boss = { ...ordinary, id: 'universal_miniboss_faeholme_1', assetId: 'fantasy_monster_09', miniBoss: true };
    const normal = { ...ordinary, assetId: 'creature_furnace_grazer' };
    expect(remapReservedEncounterGroup(boss)).toBe(boss);
    expect(remapReservedEncounterGroup(normal)).toBe(normal);
  });
  it('leaves no legacy reserved body in the world encounter projection', () => {
    const groups = REGIONS.flatMap(region => [...region.enemyGroups, ...region.dungeon?.enemyGroups ?? []]);
    for (const group of groups.map(remapReservedEncounterGroup)) {
      if (!group.id.startsWith('universal_miniboss_')) expect(isReservedUniversalMinibossAsset(group.assetId), group.id).toBe(false);
    }
  });
});
