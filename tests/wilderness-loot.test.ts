import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EquipSlot, ItemDef, SemanticEntity, SkillId } from '../game/src/contracts.js';
import { SKILL_IDS } from '../game/src/contracts.js';
import { content, toolBonus } from '../game/src/content/index.js';
import type { RecipeDef } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { RECIPES } from '../game/src/content/recipes.js';
import { SPELL_RUNES } from '../game/src/content/spells.js';
import { WILDERNESS_RUNE_KEEPERS } from '../game/src/content/wildernessDepth.js';
import {
  WILDERNESS_CRAFTING_TIERS, WILDERNESS_KEEPER_COMPONENTS, WILDERNESS_LOOT_ITEMS,
  WILDERNESS_LOOT_RECIPES, WILDERNESS_STRUCTURE_COMPONENTS, wildernessDrops,
} from '../game/src/content/wildernessLoot.js';
import { EventBus } from '../game/src/core/events.js';
import { RngStreams } from '../game/src/core/rng.js';
import { Store, setSkillLevel } from '../game/src/state/store.js';
import { ActivitySystem } from '../game/src/systems/activity.js';
import { InventorySystem } from '../game/src/systems/inventory.js';
import { ProductionSystem } from '../game/src/systems/production.js';
import { InteractionDispatcher } from '../game/src/world/interactions.js';

const ITEMS = new Map<string, ItemDef>([...ALL_ITEMS, ...WILDERNESS_LOOT_ITEMS].map((item) => [item.id, item]));
const COMBINED_RECIPES = [...new Map([...RECIPES, ...WILDERNESS_LOOT_RECIPES].map((row) => [row.id, row])).values()];

beforeEach(() => content.register({ items: [...ITEMS.values()], recipes: COMBINED_RECIPES }));
afterAll(() => content.register({ items: ALL_ITEMS, recipes: RECIPES }));

function productionFixture(recipe: RecipeDef, level = recipe.reqLevel) {
  const store = new Store(7431, 0);
  store.get().inventory.slots.fill(null);
  store.get().player.position = [0, 0, 0];
  store.get().player.regionId = 'wilderness';
  setSkillLevel(store.get(), recipe.skill, level);
  const station: SemanticEntity = {
    id: 'wilderness_loot_test_station', archetype: 'station', name: 'Wilderness test station',
    tier: recipe.tier, regionId: 'wilderness', position: [0, 0, 0], state: 'ready', interactions: ['produce'],
    station: { kind: recipe.stations![0]!, skill: recipe.skill, recipeIds: [recipe.id] },
  };
  const events = new EventBus();
  const activity = new ActivitySystem(store, events);
  const inventory = new InventorySystem({ store, events, now: () => 0 });
  const entities = { get: (id: string) => id === station.id ? station : undefined, all: () => [station] };
  const dispatcher = new InteractionDispatcher({
    get: entities.get, playerPosition: () => store.get().player.position,
    skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, store.get().skills[id].level])) as Record<SkillId, number>,
  });
  const production = new ProductionSystem({
    store, events, inventory, activity, dispatcher, entities, rng: new RngStreams(7431),
  });
  for (const input of recipe.inputs) expect(inventory.addItem(input.itemId, input.quantity).ok).toBe(true);
  return { store, station, events, activity, inventory, production };
}

describe('Wilderness loot production', () => {
  it.each(WILDERNESS_LOOT_RECIPES)('makes $id through the production activity with exact ingredient and XP transactions', (recipe) => {
    const h = productionFixture(recipe);
    const xpBefore = h.store.get().skills[recipe.skill].xp;
    const result = h.production.produceAt(h.station.id, recipe.id, 1);
    expect(result, `${recipe.id}: ${JSON.stringify(result)}`).toMatchObject({ ok: true });
    // Starting the activity does not grant its result or remove inputs early.
    for (const input of recipe.inputs) expect(h.inventory.countItem(input.itemId)).toBe(input.quantity);
    expect(h.inventory.countItem(recipe.output.itemId)).toBe(0);
    h.activity.tick(recipe.durationMs, recipe.durationMs);
    h.events.flush();
    for (const input of recipe.inputs) expect(h.inventory.countItem(input.itemId), input.itemId).toBe(0);
    expect(h.inventory.countItem(recipe.output.itemId)).toBe(recipe.output.quantity);
    expect(h.store.get().skills[recipe.skill].xp - xpBefore).toBe(recipe.xp);
    expect(h.events.since(0, ['production.completed']).events).toHaveLength(1);
  });

  it.each([50, 70])('rejects a tier %i recipe below its actual production requirement without consuming loot', (tier) => {
    const recipe = WILDERNESS_LOOT_RECIPES.find((row) => row.tier === tier && row.kind === 'smith')!;
    const h = productionFixture(recipe, tier - 1);
    expect(h.production.produceAt(h.station.id, recipe.id, 1)).toMatchObject({
      ok: false, error: { code: 'REQUIREMENTS_NOT_MET' },
    });
    for (const input of recipe.inputs) expect(h.inventory.countItem(input.itemId)).toBe(input.quantity);
    expect(h.store.get().activity).toBeNull();
  });

  it('has unique item and recipe ids with no dangling ingredients or orphan materials', () => {
    expect(new Set(WILDERNESS_LOOT_ITEMS.map((item) => item.id)).size).toBe(WILDERNESS_LOOT_ITEMS.length);
    expect(new Set(WILDERNESS_LOOT_RECIPES.map((row) => row.id)).size).toBe(WILDERNESS_LOOT_RECIPES.length);
    for (const row of WILDERNESS_LOOT_RECIPES) {
      for (const input of row.inputs) {
        expect(ITEMS.has(input.itemId), `${row.id}: ${input.itemId}`).toBe(true);
        expect(input.quantity).toBeGreaterThan(0);
        expect(Number.isInteger(input.quantity)).toBe(true);
      }
      expect(ITEMS.has(row.output.itemId), row.id).toBe(true);
      expect(row.reqLevel).toBe(row.tier);
      expect(row.stations?.length).toBeGreaterThan(0);
    }
    for (const item of WILDERNESS_LOOT_ITEMS) {
      if (item.category === 'equipment' || item.category === 'tool') {
        expect(WILDERNESS_LOOT_RECIPES.some((row) => row.output.itemId === item.id), item.id).toBe(true);
      } else {
        expect(WILDERNESS_LOOT_RECIPES.some((row) => row.inputs.some((input) => input.itemId === item.id)), item.id).toBe(true);
      }
    }
  });

  it('can produce every new item from mines, trees, gems and obtainable monster materials without a crafting cycle', () => {
    const obtainable = new Set(['cindervein_ore', 'nightglass_ore', 'teak_log', 'magic_log', 'fire_opal']);
    for (const tier of [50, 70]) {
      for (const species of ['basalt_golem', 'red_dragon', 'grave_spirit']) {
        for (const drop of wildernessDrops(species, tier)) obtainable.add(drop.itemId);
      }
    }
    for (const keeper of WILDERNESS_RUNE_KEEPERS) {
      for (const drop of wildernessDrops(keeper.id, keeper.tier, keeper.id)) obtainable.add(drop.itemId);
    }
    let count: number;
    do {
      count = obtainable.size;
      for (const row of WILDERNESS_LOOT_RECIPES) {
        if (row.inputs.every((input) => obtainable.has(input.itemId))) obtainable.add(row.output.itemId);
      }
    } while (obtainable.size > count);
    expect(WILDERNESS_LOOT_ITEMS.filter((item) => !obtainable.has(item.id)).map((item) => item.id)).toEqual([]);
  });
});

describe('Wilderness equipment tiers', () => {
  it.each(WILDERNESS_CRAFTING_TIERS)('provides full melee and magic kits, both cast cadences and gathering tools at T$tier', (def) => {
    const rows = WILDERNESS_LOOT_ITEMS.filter((item) => item.tier === def.tier);
    for (const skill of ['melee', 'magic'] as const) {
      const gear = rows.filter((item) => item.equip?.requires[skill] === def.tier);
      const slots = new Set(gear.map((item) => item.equip!.slot));
      const expected: EquipSlot[] = ['mainHand', 'head', 'body', 'legs', 'feet', 'hands'];
      if (skill === 'melee') expected.push('offHand');
      for (const slot of expected) expect(slots.has(slot), `${def.tier} ${skill}: ${slot}`).toBe(true);
    }
    const wand = ITEMS.get(`${def.wood}_wand`)!;
    const staff = ITEMS.get(`${def.wood}_staff`)!;
    expect(wand.magicWeapon).toEqual({ kind: 'wand', hands: 1 });
    expect(staff.magicWeapon).toEqual({ kind: 'staff', hands: 2 });
    expect(wand.equip!.attackSpeedMs).toBeLessThan(staff.equip!.attackSpeedMs!);
    expect(wand.equip!.bonuses.magicPower).toBeLessThan(staff.equip!.bonuses.magicPower);
    for (const tool of ['pickaxe', 'hatchet']) {
      expect(ITEMS.get(`${def.metal}_${tool}`)?.tool?.gatherBonus).toBe(toolBonus(def.tier));
    }
  });

  it('improves the preceding gear without letting melee armour add weapon damage', () => {
    const stats = (id: string) => ITEMS.get(id)!.equip!.bonuses;
    expect(stats('cindersteel_sword').meleePower).toBeGreaterThan(stats('emberite_sword').meleePower);
    expect(stats('nightglass_sword').meleePower).toBeGreaterThan(stats('cindersteel_sword').meleePower);
    expect(stats('starhide_robe').defence).toBeGreaterThan(stats('dragonhide_robe').defence);
    for (const def of WILDERNESS_CRAFTING_TIERS) {
      for (const part of ['helm', 'plate', 'greaves', 'boots', 'gauntlets']) expect(stats(`${def.metal}_${part}`).meleePower).toBe(0);
    }
    expect(stats('chainbound_sword').meleePower).toBeGreaterThan(stats('nightglass_sword').meleePower);
    expect(stats('nightmarshal_plate').defence).toBeGreaterThan(stats('nightglass_plate').defence);
    expect(stats('hollowstar_staff').magicPower).toBeGreaterThan(stats('magic_staff').magicPower);
  });
});

describe('Wilderness rune and material drops', () => {
  it.each(WILDERNESS_RUNE_KEEPERS)('$id supplies its existing invocation rune, Cosmic Runes and a usable unique component', (keeper) => {
    const drops = wildernessDrops(keeper.id, keeper.tier, keeper.id);
    const invocation = drops.find((row) => row.itemId === keeper.rune)!;
    expect(SPELL_RUNES.some((rune) => rune.itemId === keeper.rune)).toBe(true);
    expect(invocation.chance).toBe(1);
    expect(invocation.quantity[0]).toBeGreaterThanOrEqual(20);
    expect(drops.find((row) => row.itemId === 'cosmic_rune')).toMatchObject({ chance: 1, quantity: [24, 40] });
    const material = WILDERNESS_KEEPER_COMPONENTS[keeper.id];
    expect(drops.find((row) => row.itemId === material)).toMatchObject({ chance: 1, quantity: [1, 2] });
    expect(WILDERNESS_LOOT_RECIPES.some((row) => row.inputs.some((input) => input.itemId === material))).toBe(true);
    for (const row of drops) expect(ITEMS.has(row.itemId), row.itemId).toBe(true);
  });

  it('gives ordinary packs renewable rune supplies and creature-appropriate useful material', () => {
    const cases = [
      ['baby_lava_dragon', 50, 'dragonhide'], ['red_dragon', 70, 'starhide'],
      ['basalt_golem', 50, 'molten_heart'], ['nightglass_colossus', 70, 'astral_core'],
      ['furnace_grazer', 50, 'molten_heart'], ['rift_carapace', 70, 'astral_core'],
      ['grave_spirit', 50, 'grave_thread'], ['void_ghost', 70, 'void_thread'],
    ] as const;
    for (const [species, tier, material] of cases) {
      const drops = wildernessDrops(species, tier);
      expect(drops.find((row) => row.itemId === material)).toMatchObject({ chance: 1, quantity: [1, 3] });
      const runes = drops.filter((row) => row.itemId.endsWith('_rune')).map((row) => row.itemId).sort();
      expect(runes).toEqual((tier === 50 ? ['mind_rune', 'chaos_rune', 'cosmic_rune']
        : ['death_rune', 'blood_rune', 'wrath_rune', 'cosmic_rune']).sort());
      for (const row of drops) {
        expect(ITEMS.has(row.itemId), row.itemId).toBe(true);
        expect(row.chance).toBeGreaterThan(0);
        expect(row.chance).toBeLessThanOrEqual(1);
        expect(row.quantity[0]).toBeGreaterThan(0);
        expect(row.quantity[1]).toBeGreaterThanOrEqual(row.quantity[0]);
      }
    }
  });

  it('gives each fortress guard pack its local component and keeps it out of open-world packs', () => {
    for (const [id, component] of Object.entries(WILDERNESS_STRUCTURE_COMPONENTS)) {
      const drops = wildernessDrops('night_guard', 70, undefined, id as keyof typeof WILDERNESS_STRUCTURE_COMPONENTS);
      expect(drops.find((row) => row.itemId === component)).toMatchObject({ chance: .12, quantity: [1, 1] });
      expect(wildernessDrops('night_guard', 70).some((row) => row.itemId === component)).toBe(false);
    }
    expect(() => wildernessDrops('unknown', 70, 'misspelled_keeper')).toThrow('Unknown Wilderness rune keeper');
  });
});
