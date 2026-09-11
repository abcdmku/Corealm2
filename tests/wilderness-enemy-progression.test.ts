import { describe, expect, it } from 'vitest';
import type { EnemyDef } from '../game/src/content/index.js';
import { enemyCombatLevel } from '../game/src/content/index.js';
import type { CreatureSpeciesDef } from '../game/src/content/creatureSpecies.js';
import type { EnemyGroupDef } from '../game/src/content/regions.js';
import { WILDERNESS_CREATURE_SPECIES } from '../game/src/content/wildernessCreatureSpecies.js';
import { WILDERNESS_DRAGONS } from '../game/src/content/wildernessDragons.js';
import { WILDERNESS_RUNE_KEEPERS, wildernessTierAt } from '../game/src/content/wildernessDepth.js';
import { DEEP_WILDERNESS_KEEPERS, DEEP_WILDERNESS_PACKS, resolveDeepWildernessPacks } from '../game/src/content/deepWildernessEncounters.js';
import {
  buildWildernessEnemyProgression, wildernessEnemyLevelAt, wildernessStructureLootForGroup,
} from '../game/src/content/wildernessEnemyProgression.js';
import { WILDERNESS_KEEPER_COMPONENTS, WILDERNESS_STRUCTURE_COMPONENTS } from '../game/src/content/wildernessLoot.js';

const legacy: EnemyDef = {
  id: 'skeleton_soldier_t5', family: 'skeleton_soldier', name: 'Skeleton Soldier', tier: 5,
  maxHealth: 19, attackLevel: 7, defenceLevel: 5, accuracy: 6, armour: 10, magicArmour: 15,
  maxHit: 3, attackSpeedMs: 2400, aggroRadius: 7, moveSpeedMps: 1.6, walkSpeedMps: .4,
  behaviour: 'aggressive', attackStyle: 'melee', attackRangeM: 1.8,
  drops: [{ itemId: 'earth_essence', quantity: [1, 1], chance: .15 }], marks: [5, 15],
};
const species = [...WILDERNESS_CREATURE_SPECIES, ...WILDERNESS_DRAGONS];
const group = (id: string, z: number, family = legacy.family): EnemyGroupDef => ({
  id, family, name: family, tier: wildernessTierAt(z), count: 9, centre: [0, z], radius: 16,
  assetId: `creature_${family}`, scale: 1,
});
const lookup = (_id: string, family: string, tier: number): EnemyDef | undefined =>
  family === legacy.family && tier === 5 ? legacy : undefined;

describe('Wilderness enemy progression', () => {
  it('rebalances existing shallow and deep undead with exact group aliases and both canonical tiers', () => {
    const groups = [group('south_graves', 460), group('north_graves', 695), group('deep_graves', 710), group('far_graves', 940)];
    const rows = buildWildernessEnemyProgression(groups, lookup, []);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.id)).toEqual([
      'skeleton_soldier_t50', 'skeleton_soldier_t70', 'south_graves', 'north_graves', 'deep_graves', 'far_graves',
    ]);
    expect(groups.map((entry) => enemyCombatLevel(byId.get(entry.id)!))).toEqual([48, 56, 69, 77]);
    for (const entry of groups) {
      const row = byId.get(entry.id)!;
      expect(row.tier).toBe(wildernessTierAt(entry.centre[1]));
      expect(row.attackSpeedMs).toBe(legacy.attackSpeedMs);
      expect(row.moveSpeedMps).toBe(legacy.moveSpeedMps);
      expect(row.walkSpeedMps).toBe(legacy.walkSpeedMps);
      expect(row.attackStyle).toBe(legacy.attackStyle);
      expect(row.attackRangeM).toBe(legacy.attackRangeM);
      expect(row.behaviour).toBe(legacy.behaviour);
      expect(row.drops.some((drop) => drop.itemId === (row.tier === 50 ? 'grave_thread' : 'void_thread') && drop.chance === 1)).toBe(true);
      expect(row.drops.some((drop) => drop.itemId === 'cosmic_rune')).toBe(true);
      expect(row.maxHealth).toBeGreaterThan(legacy.maxHealth);
      expect(row.maxHit).toBeGreaterThan(legacy.maxHit);
      expect(row.marks).toEqual([row.tier, row.tier * 3]);
    }
  });

  it('uses a matching exact encounter block before a species block, preserving its gait and behaviour', () => {
    const original = { ...legacy, id: 'old_watch', walkSpeedMps: .21, moveSpeedMps: .85,
      attackSpeedMs: 3200, behaviour: 'territorial' as const };
    const generic: CreatureSpeciesDef = {
      id: legacy.family, assetId: 'creature_skeleton_soldier', regionId: 'wilderness', activity: 'patrol',
      description: 'Generic family body', scale: 1, stats: legacy,
    };
    const [alias] = buildWildernessEnemyProgression([group('old_watch', 590)],
      (id) => id === 'old_watch' ? original : undefined, [generic]).filter((row) => row.id === 'old_watch');
    expect(alias).toMatchObject({ walkSpeedMps: .21, moveSpeedMps: .85, attackSpeedMs: 3200, behaviour: 'territorial' });
  });

  it('keeps each new species northward modifier modest and monotonic without resetting its body stats', () => {
    for (const body of species.filter((row) => !WILDERNESS_RUNE_KEEPERS.some((keeper) => keeper.id === row.id))) {
      const south = body.stats.tier === 50 ? 460 : 700;
      const samples = Array.from({ length: 12 }, (_, i) => wildernessEnemyLevelAt(body.stats, south + i * 20));
      expect(samples.every((value, i) => i === 0 || value >= samples[i - 1]!), body.id).toBe(true);
      expect(samples.at(-1)! - samples[0]!).toBeLessThanOrEqual(4);
      expect(Math.abs(samples[0]! - enemyCombatLevel(body.stats)), body.id).toBeLessThanOrEqual(1);
      const row = buildWildernessEnemyProgression([group(`pack_${body.id}`, south + 120, body.stats.family)], () => undefined, [body])
        .find((entry) => entry.id === `pack_${body.id}`)!;
      expect(row.attackStyle).toBe(body.stats.attackStyle);
      expect(row.attackRangeM).toBe(body.stats.attackRangeM);
      expect(row.attackSpeedMs).toBe(body.stats.attackSpeedMs);
      expect(row.moveSpeedMps).toBe(body.stats.moveSpeedMps);
      expect(row.walkSpeedMps).toBe(body.stats.walkSpeedMps);
      expect(row.aggroRadius).toBe(body.stats.aggroRadius);
    }
  });

  it('resolves all 24 authored new packs and five rune keepers, preserving 7–15 resident counts', () => {
    const ordinary = resolveDeepWildernessPacks(species);
    const keepers = DEEP_WILDERNESS_KEEPERS.map((keeper): EnemyGroupDef => {
      const body = species.find((row) => row.id === keeper.id)!;
      return { id: keeper.id, family: body.stats.family, name: keeper.name, tier: keeper.tier, count: 1,
        centre: keeper.centre, radius: keeper.radius, miniBoss: true, assetId: body.assetId, scale: body.scale };
    });
    const inputs = [...ordinary, ...keepers];
    const original = JSON.stringify({ inputs, species });
    const result = buildWildernessEnemyProgression(inputs, () => undefined, species);
    expect(JSON.stringify({ inputs, species })).toBe(original);
    const aliases = result.filter((row) => inputs.some((input) => input.id === row.id));
    expect(ordinary).toHaveLength(24);
    expect(aliases).toHaveLength(29);
    expect(new Set(result.map((row) => row.id)).size).toBe(result.length);
    for (const input of ordinary) {
      const row = result.find((entry) => entry.id === input.id)!;
      expect(input.count).toBeGreaterThanOrEqual(7);
      expect(input.count).toBeLessThanOrEqual(15);
      expect(row.tier).toBe(wildernessTierAt(input.centre[1]));
      expect(enemyCombatLevel(row)).toBeGreaterThanOrEqual(row.tier === 50 ? 48 : 69);
      expect(enemyCombatLevel(row)).toBeLessThanOrEqual(row.tier === 50 ? 61 : 81);
      expect(result.some((entry) => entry.id === `${row.family}_t50`)).toBe(true);
      expect(result.some((entry) => entry.id === `${row.family}_t70`)).toBe(true);
      const plan = DEEP_WILDERNESS_PACKS.find((pack) => pack.id === input.id)!;
      const special = row.drops.filter((drop) => Object.values(WILDERNESS_STRUCTURE_COMPONENTS).includes(drop.itemId));
      if (plan.siteId) expect(special).toEqual([{ itemId: WILDERNESS_STRUCTURE_COMPONENTS[plan.siteId as keyof typeof WILDERNESS_STRUCTURE_COMPONENTS], quantity: [1, 1], chance: .12 }]);
      else expect(special).toEqual([]);
    }
    for (const keeper of WILDERNESS_RUNE_KEEPERS) {
      const alias = result.find((row) => row.id === keeper.id)!;
      const canonical = result.find((row) => row.id === `${keeper.id}_t${keeper.tier}`)!;
      expect(enemyCombatLevel(alias)).toBe(keeper.tier * keeper.multiplier);
      expect(enemyCombatLevel(canonical)).toBe(keeper.tier * keeper.multiplier);
      expect(alias.drops.find((drop) => drop.itemId === keeper.rune)).toMatchObject({ chance: 1, quantity: [24, 40] });
      expect(alias.drops.find((drop) => drop.itemId === WILDERNESS_KEEPER_COMPONENTS[keeper.id])).toMatchObject({ chance: 1 });
      expect(result.some((row) => row.id === `${keeper.id}_t${keeper.tier === 50 ? 70 : 50}`)).toBe(false);
    }
    expect(keepers.map((keeper) => enemyCombatLevel(result.find((row) => row.id === keeper.id)!))).toEqual([150, 200, 210, 280, 350]);
  });

  it('does not turn an ordinary pack into a keeper just because it shares a family name', () => {
    const source = species.find((row) => row.id === 'furnace_regent')!;
    const result = buildWildernessEnemyProgression([group('ordinary_furnace_regent_echoes', 610, source.stats.family)], () => undefined, [source]);
    const alias = result.find((row) => row.id === 'ordinary_furnace_regent_echoes')!;
    expect(alias.drops.some((drop) => drop.itemId === 'furnace_crown')).toBe(false);
    expect(alias.drops.find((drop) => drop.itemId === 'chaos_rune')?.chance).toBeLessThan(1);
    expect(enemyCombatLevel(alias)).toBeLessThan(70);
  });

  it('recognizes only the six exact fortress court identities', () => {
    for (const site of Object.keys(WILDERNESS_STRUCTURE_COMPONENTS)) {
      for (const side of ['west', 'east']) expect(wildernessStructureLootForGroup(`${site}_${side}_conclave`)).toBe(site);
      expect(wildernessStructureLootForGroup(`${site}_nearby_conclave`)).toBeUndefined();
      expect(wildernessStructureLootForGroup(`${site}_west_conclave_extra`)).toBeUndefined();
    }
  });

  it('rejects unresolved sources, malformed depths, duplicates and a keeper moved into the wrong half', () => {
    expect(() => buildWildernessEnemyProgression([group('missing', 560)], () => undefined, [])).toThrow('Missing Wilderness source');
    expect(() => buildWildernessEnemyProgression([group('same', 560), group('same', 620)], lookup, [])).toThrow('Duplicate Wilderness encounter');
    expect(() => wildernessEnemyLevelAt(legacy, Number.NaN)).toThrow('Invalid Wilderness encounter depth');
    const keeper = { ...group('hollow_star', 680, 'hollow_star'), count: 1, miniBoss: true };
    expect(() => buildWildernessEnemyProgression([keeper], () => undefined, species)).toThrow('outside its 70 depth band');
    expect(() => buildWildernessEnemyProgression([{ ...keeper, centre: [0, 880], count: 7 }], () => undefined, species)).toThrow('must be one boss');
  });
});
