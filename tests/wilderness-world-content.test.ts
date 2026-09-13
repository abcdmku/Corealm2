import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SemanticEntity } from '../game/src/contracts.js';
import { content, enemyCombatLevel, type EnemyDef } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { RECIPES } from '../game/src/content/recipes.js';
import { RESOURCES } from '../game/src/content/resources.js';
import { ENEMIES, enemyBlockFor, enemyIdFor } from '../game/src/content/enemies.js';
import { CREATURE_SPECIES } from '../game/src/content/creatureSpecies.js';
import { REGIONS, type EnemyGroupDef } from '../game/src/content/regions.js';
import { REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { REGIONAL_BOSS_BODIES } from '../game/src/content/regionalBossBodies.js';
import { DEEP_WILDERNESS_KEEPERS, DEEP_WILDERNESS_PACKS } from '../game/src/content/deepWildernessEncounters.js';
import { wildernessExpansionGroups } from '../game/src/content/wildernessExpansion.js';
import { isReservedUniversalMinibossAsset } from '../game/src/content/universalMinibosses.js';
import { WILDERNESS_DEPTH, WILDERNESS_RUNE_KEEPERS, wildernessTierAt } from '../game/src/content/wildernessDepth.js';
import {
  WILDERNESS_KEEPER_COMPONENTS, WILDERNESS_LOOT_ITEMS, WILDERNESS_LOOT_RECIPES, WILDERNESS_STRUCTURE_COMPONENTS,
} from '../game/src/content/wildernessLoot.js';
import { buildWorld, type BuiltWorld } from '../game/src/world/regionBuilder.js';
import { remapReservedEncounterGroup } from '../game/src/world/universalMinibossSockets.js';

// Only production tables enter this registry. Adding candidate tables here would hide a missed
// final-world registration, which is the failure this suite needs to detect.
const previous = { items: content.allItems(), recipes: content.allRecipes(), resources: content.allResources(), enemies: content.allEnemies() };
let world: BuiltWorld;
beforeAll(() => {
  content.register({ items: ALL_ITEMS, recipes: RECIPES, resources: RESOURCES, enemies: ENEMIES });
  // Flat ground isolates semantic content wiring. Terrain and placement clearance have separate gates.
  world = buildWorld(1337, () => 0);
});
afterAll(() => content.register(previous));

const wilderness = REGIONS.find(region => region.id === 'wilderness')!;
const allGroups = REGIONS.flatMap(region => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]);
const groupById = new Map(allGroups.map(group => [group.id, group]));
const enemyById = new Map(ENEMIES.map(enemy => [enemy.id, enemy]));
const keeperIds = new Set<string>(WILDERNESS_RUNE_KEEPERS.map(keeper => keeper.id));
const ordinaryMaterialIds = new Set(['molten_heart', 'dragonhide', 'grave_thread', 'astral_core', 'starhide', 'void_thread']);
const fortressMaterialIds = new Set(Object.values(WILDERNESS_STRUCTURE_COMPONENTS));
const authoredExpansionById = new Map(wildernessExpansionGroups(CREATURE_SPECIES).map(group => [group.id, group]));

function registeredGroup(id: string): EnemyGroupDef {
  const group = groupById.get(id);
  expect(group, `Missing final-world encounter ${id}`).toBeDefined();
  return group!;
}
function registeredEnemy(group: EnemyGroupDef): EnemyDef {
  const block = enemyBlockFor(group.id, group.family, group.tier);
  expect(block, `Missing combat block for ${group.id}`).toBeDefined();
  expect(content.enemy(group.id), `Missing exact registry alias ${group.id}`).toBe(block);
  expect(block!.tier, group.id).toBe(group.tier);
  return block!;
}
function residents(group: EnemyGroupDef): SemanticEntity[] {
  return world.entities.filter(entity => entity.combat && entity.meta?.groupId === group.id);
}
function canonicalDropItems(block: EnemyDef): void {
  for (const drop of block.drops) {
    expect(content.item(drop.itemId), `${block.id} drops unregistered ${drop.itemId}`).toBeDefined();
    expect(drop.chance, `${block.id}/${drop.itemId}`).toBeGreaterThan(0);
    expect(drop.quantity[0]).toBeGreaterThan(0);
    expect(drop.quantity[1]).toBeGreaterThanOrEqual(drop.quantity[0]);
  }
}

describe('final Wilderness content integration', () => {
  it('publishes all 62 items and 49 recipes once, with real items and usable world stations', () => {
    expect(WILDERNESS_LOOT_ITEMS).toHaveLength(54);
    expect(WILDERNESS_LOOT_RECIPES).toHaveLength(41);
    for (const item of WILDERNESS_LOOT_ITEMS) {
      expect(ALL_ITEMS.filter(row => row.id === item.id), item.id).toHaveLength(1);
      expect(content.item(item.id)).toEqual(item);
      if (!item.equip && !item.tool) expect(RECIPES.some(recipe => recipe.inputs.some(input => input.itemId === item.id)), `${item.id} has no recipe use`).toBe(true);
    }
    for (const authored of WILDERNESS_LOOT_RECIPES) {
      expect(RECIPES.filter(row => row.id === authored.id), authored.id).toHaveLength(1);
      const recipe = content.recipe(authored.id)!;
      expect(recipe).toEqual(authored);
      expect(content.item(recipe.output.itemId), recipe.id).toBeDefined();
      for (const input of recipe.inputs) expect(content.item(input.itemId), `${recipe.id}/${input.itemId}`).toBeDefined();
      expect(world.entities.some(entity => entity.station?.skill === recipe.skill
        && (recipe.stations === null || recipe.stations.includes(entity.station.kind))
        && (entity.station.recipeIds.length === 0 || entity.station.recipeIds.includes(recipe.id))), `${recipe.id} has no production station`).toBe(true);
    }
  });

  it('makes every new item reachable from actual world gathering, creature drops and registered recipes', () => {
    const obtainable = new Set(world.entities.flatMap(entity => entity.resource ? [entity.resource.itemId] : []));
    for (const group of allGroups) {
      const block = enemyBlockFor(group.id, group.family, group.tier);
      if (residents(group).length > 0) for (const drop of block?.drops ?? []) if (drop.chance > 0) obtainable.add(drop.itemId);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const recipe of RECIPES) if (!obtainable.has(recipe.output.itemId)
        && recipe.inputs.every(input => obtainable.has(input.itemId))) {
        obtainable.add(recipe.output.itemId); grew = true;
      }
    }
    expect(WILDERNESS_LOOT_ITEMS.filter(item => !obtainable.has(item.id)).map(item => item.id)).toEqual([]);
  });

  it('uses T50 shallow and T70 deep combat blocks, including useful drops on legacy Wilderness groups', () => {
    expect(wilderness.bounds.min[1]).toBe(WILDERNESS_DEPTH.south);
    expect(wilderness.bounds.max[1]).toBe(WILDERNESS_DEPTH.north);
    const ordinary = wilderness.enemyGroups.filter(group => !group.boss && !group.miniBoss);
    expect(new Set(ordinary.map(group => group.tier))).toEqual(new Set([50, 70]));
    for (const group of ordinary) {
      const tier = wildernessTierAt(group.centre[1]);
      expect(group.tier, group.id).toBe(tier);
      const block = registeredEnemy(group);
      const canonical = content.enemy(enemyIdFor(group.family, tier));
      expect(canonical, `${group.id} lacks a canonical family block`).toBeDefined();
      expect(canonical!.tier).toBe(tier);
      expect(enemyCombatLevel(block), group.id).toBeGreaterThanOrEqual(tier === 50 ? 48 : 69);
      expect(enemyCombatLevel(block), group.id).toBeLessThanOrEqual(tier === 50 ? 61 : 81);
      const material = block.drops.find(drop => ordinaryMaterialIds.has(drop.itemId));
      expect(material, `${group.id} has no guaranteed useful material`).toMatchObject({ chance: 1, quantity: [1, 3] });
      expect(content.item(material!.itemId)!.tier).toBe(tier);
      const runes = tier === 50 ? ['mind_rune', 'chaos_rune'] : ['death_rune', 'blood_rune', 'wrath_rune'];
      for (const rune of [...runes, 'cosmic_rune']) expect(block.drops.some(drop => drop.itemId === rune && drop.chance > 0), `${group.id}/${rune}`).toBe(true);
      canonicalDropItems(block);
    }
  });

  it('does not make northern encounters of the same family weaker', () => {
    const families = new Map<string, EnemyGroupDef[]>();
    for (const group of wilderness.enemyGroups.filter(group => !group.boss && !group.miniBoss)) {
      const rows = families.get(group.family) ?? []; rows.push(group); families.set(group.family, rows);
    }
    let compared = 0, increases = 0;
    for (const rows of families.values()) {
      rows.sort((a, b) => a.centre[1] - b.centre[1]);
      for (let index = 1; index < rows.length; index++) {
        const south = rows[index - 1]!, north = rows[index]!;
        const before = enemyCombatLevel(registeredEnemy(south)), after = enemyCombatLevel(registeredEnemy(north));
        expect(after, `${north.id} lies north of ${south.id}`).toBeGreaterThanOrEqual(before);
        compared++; if (after > before) increases++;
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(increases).toBeGreaterThan(0);
  });

  it('registers all 24 authored packs with their final body projection, saved identity and matching spawned stats', () => {
    expect(DEEP_WILDERNESS_PACKS).toHaveLength(24);
    expect(new Set(DEEP_WILDERNESS_PACKS.map(pack => pack.id)).size).toBe(24);
    for (const pack of DEEP_WILDERNESS_PACKS) {
      const group = registeredGroup(pack.id);
      const species = CREATURE_SPECIES.find(row => row.id === pack.speciesId);
      expect(species, `Missing accepted species ${pack.speciesId}`).toBeDefined();
      const projected = remapReservedEncounterGroup(authoredExpansionById.get(pack.id)!);
      expect(group).toMatchObject({ id: pack.id, family: species!.stats.family,
        assetId: projected.assetId, scale: projected.scale, count: pack.count, centre: pack.centre });
      const block = registeredEnemy(group), actors = residents(group);
      expect(actors, pack.id).toHaveLength(pack.count);
      for (const actor of actors) {
        expect(actor).toMatchObject({ regionId: 'wilderness', tier: group.tier, archetype: 'enemy', view: { assetId: group.assetId },
          combat: { level: enemyCombatLevel(block), health: block.maxHealth, maxHealth: block.maxHealth },
          meta: { groupId: group.id, family: group.family, enemyDefId: block.id } });
      }
      canonicalDropItems(block);
    }
  });

  it('keeps the three hatchling variants shallow and the three full dragon variants deep', () => {
    const bands = {
      baby_red_dragon: 50, baby_black_dragon: 50, baby_lava_dragon: 50,
      red_wilderness_dragon: 70, black_wilderness_dragon: 70, purple_wilderness_dragon: 70,
    } as const;
    for (const [speciesId, tier] of Object.entries(bands)) {
      const groups = wilderness.enemyGroups.filter(group => group.family === speciesId);
      expect(groups.length, speciesId).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.tier, group.id).toBe(tier);
        expect(wildernessTierAt(group.centre[1]), group.id).toBe(tier);
        expect(registeredEnemy(group).drops).toContainEqual({ itemId: tier === 50 ? 'dragonhide' : 'starhide', quantity: [1, 3], chance: 1 });
      }
    }
  });

  it.each(WILDERNESS_RUNE_KEEPERS)('spawns $id at its exact computed level with its guaranteed rune supply', keeper => {
    const group = registeredGroup(keeper.id), block = registeredEnemy(group);
    const plan = DEEP_WILDERNESS_KEEPERS.find(row => row.id === keeper.id)!;
    expect(group.count).toBe(1);
    expect(group.boss || group.miniBoss).toBe(true);
    expect(group.centre).toEqual(plan.centre);
    expect(group.tier).toBe(keeper.tier);
    const projected = remapReservedEncounterGroup(authoredExpansionById.get(keeper.id)!);
    expect(group).toMatchObject({ id: keeper.id, family: projected.family,
      assetId: projected.assetId, scale: projected.scale });
    expect(wildernessTierAt(group.centre[1])).toBe(keeper.tier);
    const expectedLevel = { ashseal_warden: 150, furnace_regent: 200, chainbound_archon: 210, nightforge_marshal: 280, hollow_star: 350 }[keeper.id];
    expect(enemyCombatLevel(block)).toBe(expectedLevel);
    const canonical = content.enemy(enemyIdFor(group.family, keeper.tier));
    expect(canonical).toBeDefined();
    expect(enemyCombatLevel(canonical!)).toBe(expectedLevel);
    for (const row of [block, canonical!]) {
      expect(row.drops).toContainEqual({ itemId: keeper.rune, quantity: [24, 40], chance: 1 });
      expect(row.drops).toContainEqual({ itemId: 'cosmic_rune', quantity: [24, 40], chance: 1 });
      expect(row.drops).toContainEqual({ itemId: WILDERNESS_KEEPER_COMPONENTS[keeper.id], quantity: [1, 2], chance: 1 });
      canonicalDropItems(row);
    }
    expect(residents(group)).toHaveLength(1);
    expect(residents(group)[0]).toMatchObject({ id: keeper.id, archetype: 'boss', tier: keeper.tier, view: { assetId: group.assetId },
      combat: { level: expectedLevel, maxHealth: block.maxHealth }, meta: { groupId: keeper.id, enemyDefId: block.id } });
  });

  it('reserves Fantasy Monster 01-09 bodies for universal slots while retaining named encounters', () => {
    for (const group of allGroups) if (isReservedUniversalMinibossAsset(group.assetId)) {
      expect(group.id.startsWith('universal_miniboss_'), group.id).toBe(true);
      expect(group.miniBoss, group.id).toBe(true);
      expect(group.count, group.id).toBe(1);
    }
    for (const actor of world.entities.filter(entity => entity.combat && entity.view
      && isReservedUniversalMinibossAsset(entity.view.assetId))) {
      expect(String(actor.meta?.groupId).startsWith('universal_miniboss_'), actor.id).toBe(true);
      expect(actor.archetype, actor.id).toBe('boss');
    }
    for (const id of ['wilderness_basalt_maw_hollow', 'hollow_star']) {
      const authored = authoredExpansionById.get(id)!;
      const group = registeredGroup(id);
      expect(isReservedUniversalMinibossAsset(authored.assetId), id).toBe(true);
      expect(isReservedUniversalMinibossAsset(group.assetId), id).toBe(false);
      expect(group).toMatchObject({ id: authored.id, family: authored.family, tier: authored.tier,
        count: authored.count, centre: authored.centre });
      expect(residents(group), id).toHaveLength(authored.count);
      canonicalDropItems(registeredEnemy(group));
    }
  });

  it('limits fortress components to the six exact court packs and their rune keepers', () => {
    const courtPacks = DEEP_WILDERNESS_PACKS.filter(pack => pack.siteId);
    expect(courtPacks).toHaveLength(6);
    for (const pack of courtPacks) {
      const component = WILDERNESS_STRUCTURE_COMPONENTS[pack.siteId as keyof typeof WILDERNESS_STRUCTURE_COMPONENTS];
      expect(pack.id).toBe(`${pack.siteId}_${pack.court}_conclave`);
      expect(registeredEnemy(registeredGroup(pack.id)).drops.filter(drop => fortressMaterialIds.has(drop.itemId)))
        .toEqual([{ itemId: component, quantity: [1, 1], chance: .12 }]);
      expect(content.allRecipes().some(recipe => recipe.inputs.some(input => input.itemId === component)
        && content.item(recipe.output.itemId)?.equip), `${component} has no equipment use`).toBe(true);
    }
    const courtIds = new Set(courtPacks.map(pack => pack.id));
    for (const group of wilderness.enemyGroups) if (!courtIds.has(group.id) && !keeperIds.has(group.id)) {
      expect(registeredEnemy(group).drops.filter(drop => fortressMaterialIds.has(drop.itemId)), group.id).toEqual([]);
    }
  });
});

const legacyBossRewards: Readonly<Record<keyof typeof REGIONAL_BOSS_LEVELS, readonly (readonly [string, number])[]>> = {
  galeskin: [['galeskin_sword', .1], ['galeskin_staff', .1]],
  tempest_roc: [['air_orb', 1]],
  mossbound: [['mossbound_sword', .1], ['mossbound_staff', .1]],
  rootheart: [['earth_orb', 1]],
  tideworn: [['tideworn_sword', .1], ['tideworn_staff', .1]],
  ordrun: [['water_orb', 1], ['kaldite_sword', 1]],
  cinderwake: [['fire_orb', 1], ['cinderwake_sword', .1], ['cinderwake_staff', .1]],
};

describe('regional boss world progression', () => {
  it.each(Object.entries(REGIONAL_BOSS_LEVELS))('preserves the saved %s encounter and progression rewards under its new body', (id, level) => {
    const key = id as keyof typeof REGIONAL_BOSS_LEVELS;
    const group = registeredGroup(id), block = registeredEnemy(group), actors = residents(group);
    expect(enemyById.get(id)).toBe(block);
    expect(group.family).toBe(id === 'ordrun' ? 'quarrykeeper' : id);
    expect(group.tier).toBe(level.tier);
    expect(group.boss || group.miniBoss).toBe(true);
    expect(group.assetId).toBe(REGIONAL_BOSS_BODIES[key].assetId);
    expect(enemyCombatLevel(block)).toBe(level.tier * level.multiplier);
    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({ id, archetype: 'boss', tier: level.tier, view: { assetId: group.assetId },
      combat: { level: level.tier * level.multiplier, maxHealth: block.maxHealth }, meta: { family: group.family, groupId: id } });
    for (const [itemId, chance] of legacyBossRewards[key]) {
      expect(block.drops).toContainEqual({ itemId, quantity: [1, 1], chance });
      expect(content.item(itemId)).toBeDefined();
    }
  });
});
