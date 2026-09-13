import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BALANCE_SCHEMAS } from '../game/src/content/schema/balance.js';
import { parseValue, type Schema } from '../game/src/content/schema/core.js';
import { EQUIPMENT, ELEMENTAL_MAGIC_WEAPONS, RARE_MINIBOSS_WEAPONS } from '../game/src/content/equipment.js';
import { RECIPES } from '../game/src/content/recipes.js';
import { CRAFTED_JEWELRY, JEWELRY_RECIPES } from '../game/src/content/jewelry.js';
import { MINIBOSS_JEWELLERY } from '../game/src/content/universalMinibossLoot.js';
import { EQUIPMENT_SETS } from '../game/src/content/equipmentSets.js';
import { CREATURE_LOOT_ITEMS } from '../game/src/content/creatureLoot.js';
import { gatherXp, recipeXp, healAmount, toolBonus, enemyCombatLevel } from '../game/src/content/index.js';
import { GATHERING_PRODUCTION_TIERS } from '../game/src/content/gatheringProductionTiers.js';
import { REGIONAL_CRAFTING_TIERS, regionalFabricDrops } from '../game/src/content/regionalTierEquipment.js';
import { WILDERNESS_CRAFTING_TIERS, wildernessDrops } from '../game/src/content/wildernessLoot.js';
import { bossArmorDrops } from '../game/src/content/bossArmor.js';
import { ENCOUNTER_POPULATION_LIMITS, createEncounterFormation } from '../game/src/content/encounterPopulation.js';
import { REGION_COMBAT_TIERS, REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { ENEMY_BLOCKS, FANTASY_TIER_BLOCKS } from '../game/src/content/enemies.js';
import { FOREST_CREATURE_REDESIGNS } from '../game/src/content/forestCreatureRedesigns.js';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';
import type { EnemyGroupDef } from '../game/src/content/regions.js';

const root = new URL('../game/content/data/balance/', import.meta.url);
const raw = (name: string): unknown => JSON.parse(readFileSync(new URL(`${name}.json`, root), 'utf8'));
const gear = parseValue(BALANCE_SCHEMAS.gear, raw('gear'), 'gear');
const recipes = parseValue(BALANCE_SCHEMAS.recipes, raw('recipes'), 'recipes');
const sets = parseValue(BALANCE_SCHEMAS.sets, raw('sets'), 'sets');
const loot = parseValue(BALANCE_SCHEMAS.loot, raw('loot'), 'loot');
const enemies = parseValue(BALANCE_SCHEMAS.enemies, raw('enemies'), 'enemies');
const jewelry = parseValue(BALANCE_SCHEMAS.jewelry, raw('jewelry'), 'jewelry');
const formation = parseValue(BALANCE_SCHEMAS.formation, raw('formation'), 'formation');

describe('M0 balance parameter extraction', () => {
  it('validates every balance file and rejects unknown or invalid fields', () => {
    expect(readdirSync(root).filter(name => name.endsWith('.json')).sort())
      .toEqual(Object.keys(BALANCE_SCHEMAS).map(name => `${name}.json`).sort());
    for (const [name, schema] of Object.entries(BALANCE_SCHEMAS)) {
      expect(() => parseValue(schema as Schema, raw(name), name)).not.toThrow();
      expect(() => parseValue(schema as Schema, { ...(raw(name) as object), typo: 1 }, name)).toThrow();
    }
    expect(() => parseValue(BALANCE_SCHEMAS.recipes, { ...recipes, toolBonus: { ...recipes.toolBonus, maximum: -1 } }, 'recipes')).toThrow('toolBonus.maximum');
    expect(() => parseValue(BALANCE_SCHEMAS.formation, { ...formation, populationHashRange: 2 }, 'formation')).toThrow('hash range');
    expect(() => parseValue(BALANCE_SCHEMAS.loot, { ...loot, regionalFabric: { ...loot.regionalFabric, boss: { quantity: [7, 4], chance: 1.2 } } }, 'loot')).toThrow();
    expect(() => parseValue(BALANCE_SCHEMAS.enemies, { ...enemies, combatLevel: { ...enemies.combatLevel, healthWeight: 0.5 } }, 'enemies')).toThrow('sum to one');
  });

  it('captures the authored base gear rows and live tier ladders', () => {
    const excluded = new Set([...CRAFTED_JEWELRY, ...ELEMENTAL_MAGIC_WEAPONS, ...RARE_MINIBOSS_WEAPONS].map(row => row.id));
    expect(gear.baselines).toEqual(EQUIPMENT.filter(row => !excluded.has(row.id)).map(row => ({
      id: row.id, tier: row.tier, value: row.value, slot: row.equip!.slot,
      requires: row.equip!.requires, bonuses: row.equip!.bonuses,
    })));
    for (const item of EQUIPMENT.filter(row => row.equip?.attackSpeedMs !== undefined)) {
      expect(item.equip!.attackSpeedMs).toBe(gear.attackSpeedMs[item.magicWeapon?.kind ?? 'melee']);
    }
    expect(gear.gatheringTiers).toEqual(GATHERING_PRODUCTION_TIERS.map(row => row.tier));
    expect(gear.craftingTiers).toEqual([...GATHERING_PRODUCTION_TIERS, ...REGIONAL_CRAFTING_TIERS, ...WILDERNESS_CRAFTING_TIERS].map(row => row.tier).sort((a, b) => a - b));
  });

  it('matches recipe weights and durations to current production recipes', () => {
    for (const tier of GATHERING_PRODUCTION_TIERS) {
      const inputs = [
        ['bar', 'smeltBar'], ['dagger', 'dagger'], ['sword', 'sword'], ['body', 'bodyOrLegs'],
        ['helm', 'helmBootsGloves'], ['pickaxe', 'toolHead'], ['cookedFish', 'cookedFood'],
        ['robe', 'leatherBody'], ['staff', 'staff'], ['wand', 'wand'], ['handle', 'toolHandle'],
        ['rod', 'fishingRod'], ['shield', 'woodenShield'],
      ] as const;
      for (const [itemKey, weightKey] of inputs) {
        const recipe = RECIPES.find(row => row.output.itemId === tier.items[itemKey]);
        expect(recipe, tier.items[itemKey]).toBeDefined();
        expect(recipe!.xp).toBe(recipeXp(tier.tier, recipes.weights[weightKey].weight));
        expect(recipe!.durationMs).toBe(recipes.weights[weightKey].ms);
      }
    }
  });

  it('reproduces rounded XP, healing and capped tools across the supported ladder', () => {
    for (let tier = 1; tier <= 100; tier++) {
      const xp = Math.round(recipes.gatherXp.multiplier * tier ** recipes.gatherXp.exponent);
      expect(xp).toBe(gatherXp(tier));
      for (const entry of Object.values(recipes.weights)) expect(Math.round(xp * entry.weight)).toBe(recipeXp(tier, entry.weight));
      expect(Math.round(recipes.healAmount.base + recipes.healAmount.multiplier * tier ** recipes.healAmount.exponent)).toBe(healAmount(tier));
      expect(Math.min(recipes.toolBonus.maximum, Math.round(recipes.toolBonus.base + recipes.toolBonus.perTier * tier))).toBe(toolBonus(tier));
    }
  });

  it('reproduces every set threshold including bareheaded boss sets', () => {
    for (const set of EQUIPMENT_SETS) {
      const params = sets.byTier.find(row => row.tier === set.tier)!;
      expect(params, set.id).toBeDefined();
      const bareheaded = Object.keys(set.members).length === 4;
      const defencePieces = bareheaded ? sets.thresholds.bareheadedDefencePieces : sets.thresholds.defencePieces;
      const healthPieces = bareheaded ? sets.thresholds.bareheadedHealthPieces : sets.thresholds.healthPieces;
      expect(set.thresholds.map(row => ({ pieces: row.pieces, defence: row.bonuses.defence, health: row.bonuses.health })))
        .toEqual([{ pieces: defencePieces[0], defence: params.defence, health: 0 },
          { pieces: healthPieces, defence: 0, health: params.health },
          { pieces: defencePieces[1], defence: params.defence, health: 0 }]);
    }
  });

  it('matches crafted and miniboss jewelry profiles and recipe costs', () => {
    for (const item of CRAFTED_JEWELRY) {
      const profile = jewelry.crafted.profiles.find(row => row.tier === item.tier)!;
      expect(item.value).toBe(item.tier * jewelry.crafted.valuePerTier);
      expect(item.equip!.requires).toEqual({ [profile.requirementSkill]: item.tier });
      expect(Object.entries(item.equip!.bonuses).filter(([, value]) => value !== 0)).toEqual([[profile.stat,
        item.tier / jewelry.crafted.bonusTierDivisor * (profile.stat === 'health' ? jewelry.crafted.healthMultiplier : jewelry.crafted.otherMultiplier)]]);
      const recipe = JEWELRY_RECIPES.find(row => row.output.itemId === item.id)!;
      expect(recipe.durationMs).toBe(jewelry.crafted.recipeDurationMs);
      expect(recipe.xp).toBe(recipeXp(item.tier, jewelry.crafted.recipeWeight));
      expect(recipe.inputs).toEqual([profile.bar, profile.gem].map(itemId => ({ itemId, quantity: jewelry.crafted.ingredientQuantity })));
      expect(recipe.output.quantity).toBe(jewelry.crafted.outputQuantity);
    }
    for (const item of MINIBOSS_JEWELLERY) {
      const profile = jewelry.miniboss.profiles.find(row => row.tier === item.tier)!;
      expect(item.value).toBe(item.tier * jewelry.miniboss.valuePerTier);
      expect(item.equip!.requires).toEqual({ [profile.requirementSkill]: item.tier });
      expect(Object.fromEntries(Object.entries(item.equip!.bonuses).filter(([, value]) => value !== 0)))
        .toEqual(Object.fromEntries(profile.stats.map(stat => [stat, jewelry.miniboss.bonusPerStat])));
    }
  });

  it('matches material values and production loot rolls', () => {
    const materials = CREATURE_LOOT_ITEMS.filter(row => row.category === 'component');
    expect(materials.length).toBeGreaterThan(0);
    for (const item of materials) {
      expect(item.value).toBe(loot.materialValues.find(row => row.tier === item.tier)!.value);
    }
    for (const tier of [50, 70] as const) {
      expect(bossArmorDrops(tier).reduce((total, row) => total + row.chance, 0)).toBeCloseTo(loot.bossArmorExpectedPieces);
    }
    for (const tier of REGIONAL_CRAFTING_TIERS.map(row => row.tier)) for (const boss of [false, true]) {
      const { quantity, chance } = regionalFabricDrops(tier, boss)[0]!;
      expect({ quantity, chance }).toEqual(loot.regionalFabric[boss ? 'boss' : 'ordinary']);
    }
    for (const tier of [50, 70]) {
      const drops = wildernessDrops('dragon', tier);
      const { material, cosmicRune, gem, runes } = loot.wilderness.ordinary;
      const selectedRunes = runes.filter(row => tier >= loot.wilderness.deepTier ? row.rank >= 3 : row.rank <= 2);
      expect(drops.map(({ quantity, chance }) => ({ quantity, chance })))
        .toEqual([material, cosmicRune, ...selectedRunes.map(({ quantity, chance }) => ({ quantity, chance })), gem]);
    }
  });

  it('reproduces fantasy scaling and displayed levels without changing enemy records', () => {
    const species = [...FOREST_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS];
    const keys = ['maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit'] as const;
    for (const row of FANTASY_TIER_BLOCKS) {
      const base = species.find(value => value.stats.family === row.family)!.stats;
      expect(enemies.fantasy.tiers).toContain(row.tier);
      for (const key of keys) expect(row[key]).toBe(Math.max(enemies.fantasy.minimums[key], Math.round(base[key] * row.tier / base.tier)));
    }
    const p = enemies.combatLevel;
    for (const row of ENEMY_BLOCKS) {
      const offence = (row.attackLevel + p.rollLevelOffset) * (1 + row.accuracy / p.bonusDivisor) - p.rollLevelOffset;
      const defence = (row.defenceLevel + p.rollLevelOffset) * (1 + (row.armour + row.magicArmour) / p.defenceStyleCount / p.bonusDivisor) - p.rollLevelOffset;
      expect(Math.max(p.minimum, Math.round(offence * p.offenceWeight + defence * p.defenceWeight + row.maxHealth / p.healthPerLevel * p.healthWeight))).toBe(enemyCombatLevel(row));
    }
    expect(enemies.regionCombatTiers).toEqual(REGION_COMBAT_TIERS);
    expect(enemies.regionalBossLevels).toEqual(REGIONAL_BOSS_LEVELS);
  });

  it('matches formation defaults and body separation in the production generator', () => {
    expect({ minimum: formation.minimum, maximum: formation.maximum, bodyGap: formation.bodyGap }).toEqual(ENCOUNTER_POPULATION_LIMITS);
    const group: EnemyGroupDef = { id: 'balance_formation', family: 'frog', name: 'Balance fixture', tier: 1,
      centre: [0, 0], radius: 1, count: 7, assetId: 'fixture', scale: 1 };
    const result = createEncounterFormation(group, { bodyRadius: 1, rotationY: 0 });
    expect(result.anchors).toHaveLength(formation.minimum);
    expect(result.minimumSeparation).toBe(2 + formation.bodyGap);
    expect(createEncounterFormation({ ...group, boss: true }, { bodyRadius: 1 }).anchors).toHaveLength(formation.bossCount);
  });
});
