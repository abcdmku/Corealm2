import { afterEach, describe, expect, it } from 'vitest';
import type { SemanticEntity } from '../game/src/contracts.js';
import { Rng } from '../game/src/core/rng.js';
import { content, enemyCombatLevel, type EnemyDef } from '../game/src/content/index.js';
import { ENEMIES, ENEMY_BLOCKS, FANTASY_ENCOUNTER_BLOCKS, FANTASY_ENCOUNTER_LINEAGE,
  FANTASY_TIER_BLOCKS, ORDRUN_PHASES, enemyBlockFor, enemyIdFor,
  huntEnemyDefMatches } from '../game/src/content/enemies.js';
import { FOREST_CREATURE_REDESIGNS } from '../game/src/content/forestCreatureRedesigns.js';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';
import { BIOME_POPULATION_LEGACY_REPLACEMENTS } from '../game/src/content/biomePopulation.js';
import { CREATURE_LOOT_ITEMS, CREATURE_LOOT_RECIPES, CREATURE_TROPHY_BY_SPECIES } from '../game/src/content/creatureLoot.js';
import { SOURCE_REGIONS } from '../game/src/content/regions.js';
import { buildEnemyGroup } from '../game/src/world/regionBuilder.js';
import { resolveEnemyDef } from '../game/src/systems/combat.js';

const species = [...FOREST_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS];
const sourceGroups = SOURCE_REGIONS.flatMap(region => [
  ...region.enemyGroups.map(group => ({ regionId: region.id, group })),
  ...(region.dungeon?.enemyGroups.map(group => ({ regionId: region.dungeon!.id, group })) ?? []),
]);
const originalRegistry = content.allEnemies();
afterEach(() => content.register({ enemies: originalRegistry }));

// These are the only intended changes in an existing encounter's stat block.
function balance(def: EnemyDef) {
  const { id, family, name, moveSpeedMps, walkSpeedMps, ...unchanged } = def;
  return unchanged;
}

describe('fantasy encounter reward and combat continuity', () => {
  it('preserves all 54 original stat lines and selects them through production actor construction', () => {
    content.register({ enemies: ENEMIES });
    expect(FANTASY_ENCOUNTER_BLOCKS).toHaveLength(54);
    expect(Object.keys(FANTASY_ENCOUNTER_LINEAGE).sort()).toEqual(Object.keys(BIOME_POPULATION_LEGACY_REPLACEMENTS).sort());
    for (const alias of FANTASY_ENCOUNTER_BLOCKS) {
      const { group, regionId } = sourceGroups.find(row => row.group.id === alias.id)!;
      const originalId = enemyIdFor(group.family, group.tier);
      const original = ENEMY_BLOCKS.find(row => row.id === originalId)!;
      const replacement = species.find(row => row.id === BIOME_POPULATION_LEGACY_REPLACEMENTS[alias.id])!;
      expect(FANTASY_ENCOUNTER_LINEAGE[alias.id]![0], alias.id).toBe(originalId);
      expect(balance(alias), alias.id).toEqual(balance(original));
      expect(alias.family, alias.id).toBe(replacement.stats.family);
      expect(alias.name, alias.id).toBe(replacement.stats.name);
      expect(alias.moveSpeedMps, alias.id).toBe(replacement.stats.moveSpeedMps);
      expect(alias.walkSpeedMps, alias.id).toBe(replacement.stats.walkSpeedMps);

      const actors: SemanticEntity[] = [];
      buildEnemyGroup(regionId, { ...group, family: alias.family, name: alias.name,
        assetId: replacement.assetId, scale: replacement.scale }, new Rng(42),
      spot => [spot[0], 0, spot[1]], actors, () => null);
      expect(actors, alias.id).toHaveLength(group.count);
      for (const actor of actors) {
        expect(actor.meta?.enemyDefId, actor.id).toBe(group.id);
        expect(actor.combat?.maxHealth, actor.id).toBe(original.maxHealth);
        expect(actor.combat?.level, actor.id).toBe(enemyCombatLevel(original));
        expect(resolveEnemyDef(actor), actor.id).toBe(alias);
      }
      // The source gallery can still request the old body and get its original stats.
      expect(enemyBlockFor(group.id, group.family, group.tier), group.id).toBe(original);
    }
  });

  it('keeps all 21 expansion trophies and the displaced fox material obtainable for existing recipes', () => {
    const requiredTrophies = [
      'lynx_sinew', 'badger_bristle', 'porcupine_quill', 'horse_tailhair', 'bighorn_fleece',
      'moose_antler_palm', 'tapir_leather', 'crocodile_scute', 'salamander_secretion', 'tortoise_shell_plate',
      'monitor_sinew', 'heron_quill', 'bustard_plume', 'snail_mucus', 'beetle_mandible',
      'centipede_chitin', 'spider_thread', 'ravager_talon', 'drake_scale', 'mantis_scythe', 'nightmare_plate',
      'fox_guardhair',
    ];
    const trophyIds = new Set<string>(Object.values(CREATURE_TROPHY_BY_SPECIES));
    const retained = new Set(FANTASY_ENCOUNTER_BLOCKS.flatMap(row => row.drops)
      .filter(drop => trophyIds.has(drop.itemId) && drop.chance > 0).map(drop => drop.itemId));
    expect([...retained].sort()).toEqual(requiredTrophies.sort());
    for (const itemId of requiredTrophies) {
      expect(CREATURE_LOOT_ITEMS.some(item => item.id === itemId), itemId).toBe(true);
      // Retired jewelry ingredients remain sellable trophies.
      expect(CREATURE_LOOT_ITEMS.find(item => item.id === itemId)!.value, itemId).toBeGreaterThan(0);
    }
  });

  it('provides unique canonical blocks at every regional tier without changing native species balance', () => {
    expect(species).toHaveLength(15);
    expect(FANTASY_TIER_BLOCKS).toHaveLength(60);
    expect(new Set(ENEMIES.map(row => row.id)).size).toBe(ENEMIES.length);
    for (const creature of species) {
      const rows = [1, 5, 10, 20].map(tier => enemyBlockFor(`coastal_${creature.id}`, creature.stats.family, tier)!);
      expect(rows.map(row => row.tier), creature.id).toEqual([1, 5, 10, 20]);
      expect(rows.find(row => row.tier === creature.stats.tier), creature.id).toEqual(creature.stats);
      for (const [index, row] of rows.entries()) {
        expect(row.id).toBe(enemyIdFor(creature.stats.family, row.tier));
        expect(row.maxHealth).toBeGreaterThan(0);
        expect(row.maxHit).toBeGreaterThan(0);
        expect(row.attackSpeedMs).toBe(creature.stats.attackSpeedMs);
        expect(row.drops).toEqual(creature.stats.drops);
        for (const stat of ['maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit'] as const) {
          expect(Number.isFinite(row[stat]), `${row.id}/${stat}`).toBe(true);
          expect(row[stat], `${row.id}/${stat}`).toBeGreaterThanOrEqual(0);
          if (index > 0) expect(row[stat], `${row.id}/${stat}`).toBeGreaterThanOrEqual(rows[index - 1]![stat]);
        }
        if (row.marks) {
          expect(row.marks[0]).toBeGreaterThanOrEqual(0);
          expect(row.marks[1]).toBeGreaterThanOrEqual(row.marks[0]);
          if (index > 0) expect(row.marks[1]).toBeGreaterThanOrEqual(rows[index - 1]!.marks![1]);
        }
      }
    }
  });

  it('preserves the seven boss identities, Orb progression, rare rewards and Ordrun phase thresholds', () => {
    const bossIds = { tempest_roc: 'tempest_roc_t1', rootheart: 'rootheart_t5', ordrun: 'quarrykeeper_t10',
      cinderwake: 'cinderwake_t20', galeskin: 'galeskin_t1', mossbound: 'mossbound_t5', tideworn: 'tideworn_t10' };
    for (const [groupId, canonicalId] of Object.entries(bossIds)) {
      const source = sourceGroups.find(row => row.group.id === groupId)!.group;
      const original = ENEMY_BLOCKS.find(row => row.id === canonicalId)!;
      expect(enemyBlockFor(groupId, source.family, source.tier), groupId).toEqual({ ...original, id: groupId });
      expect(FANTASY_ENCOUNTER_LINEAGE[groupId], groupId).toBeUndefined();
    }
    for (const [id, orb] of [['tempest_roc', 'air_orb'], ['rootheart', 'earth_orb'],
      ['ordrun', 'water_orb'], ['cinderwake', 'fire_orb']]) {
      expect(ENEMIES.find(row => row.id === id)!.drops).toContainEqual({ itemId: orb, quantity: [1, 1], chance: 1 });
    }
    for (const id of ['galeskin', 'mossbound', 'tideworn', 'cinderwake']) {
      for (const weapon of ['sword', 'staff']) {
        expect(ENEMIES.find(row => row.id === id)!.drops).toContainEqual({ itemId: `${id}_${weapon}`, quantity: [1, 1], chance: .1 });
      }
    }
    expect(ORDRUN_PHASES).toEqual([
      { atHealthFraction: 1, armour: 62, attackSpeedMs: 3000, maxHit: 14 },
      { atHealthFraction: .55, armour: 50, attackSpeedMs: 2400, maxHit: 16,
        telegraphId: 'ground_slam', telegraphWindupMs: 1800, telegraphRadiusM: 6 },
    ]);
  });

  it('matches saved hunt predecessors only to encounters they previously occupied', () => {
    for (const [groupId, predecessors] of Object.entries(FANTASY_ENCOUNTER_LINEAGE)) {
      expect(huntEnemyDefMatches(groupId, groupId)).toBe(true);
      for (const oldId of predecessors) {
        expect(huntEnemyDefMatches(oldId, groupId), `${oldId}/${groupId}`).toBe(true);
        expect(huntEnemyDefMatches(groupId, oldId), `${groupId}/${oldId}`).toBe(false);
      }
    }
    expect(huntEnemyDefMatches('hog_t5', 'bramble_hogs')).toBe(true);
    expect(huntEnemyDefMatches('beetle_golem_t10', 'bramble_hogs')).toBe(true);
    // Both replacement encounters use Fen Crawlers, but only the first was a hog encounter.
    expect(BIOME_POPULATION_LEGACY_REPLACEMENTS.bramble_hogs).toBe(BIOME_POPULATION_LEGACY_REPLACEMENTS.bracken_tapir_residents);
    expect(huntEnemyDefMatches('hog_t5', 'bracken_tapir_residents')).toBe(false);
    expect(huntEnemyDefMatches('hog_t5', 'fen_crawler_t5')).toBe(false);
    expect(huntEnemyDefMatches('hog_t5', 'new_fen_pack')).toBe(false);
  });
});
