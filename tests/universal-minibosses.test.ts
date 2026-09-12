import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SKILL_IDS, ok, type EquipmentBonuses, type RegionId, type SemanticEntity, type SkillId } from '../game/src/contracts.js';
import { content, enemyCombatLevel, type ContentTables } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { REGION_COMBAT_TIERS } from '../game/src/content/encounterBalance.js';
import { FAIRY_CREATURE_SPECIES } from '../game/src/content/fairyCreatures.js';
import { MINIBOSS_JEWELLERY } from '../game/src/content/universalMinibossLoot.js';
import {
  UNIVERSAL_MINIBOSS_ENEMIES, UNIVERSAL_MINIBOSS_ROSTER, UNIVERSAL_MINIBOSS_SPECIES,
  isReservedUniversalMinibossAsset, universalMinibossSpecies,
} from '../game/src/content/universalMinibosses.js';
import { EventBus } from '../game/src/core/events.js';
import { RngStreams } from '../game/src/core/rng.js';
import { rehydrateEnemyRuntimes } from '../game/src/persistence/worldContainers.js';
import { Store } from '../game/src/state/store.js';
import { CombatSystem } from '../game/src/systems/combat.js';
import { EnemyAiSystem } from '../game/src/systems/enemyAI.js';
import { InteractionDispatcher } from '../game/src/world/interactions.js';
import { buildUniversalMinibossGroups, universalMinibossMinimumSeparation, type UniversalMinibossSocket } from '../game/src/world/universalMinibossSpawns.js';

const original: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()], recipes: [...content.allRecipes()],
  spells: [...content.allSpells()], enemies: [...content.allEnemies()], shops: [...content.allShops()],
};
beforeAll(() => content.register({ items: [...ALL_ITEMS, ...MINIBOSS_JEWELLERY], enemies: UNIVERSAL_MINIBOSS_ENEMIES }));
afterAll(() => content.register(original));
afterEach(() => vi.restoreAllMocks());

const hero: EquipmentBonuses = {
  accuracy: 500, power: 500, armour: 500, magicAccuracy: 0, magicPower: 0, magicArmour: 500, vitality: 0,
};

function encounter(seed = 7) {
  const store = new Store(seed, 0), state = store.get();
  state.skills.melee.level = 99;
  state.equipment.mainHand = { itemId: 'worn_sword', quantity: 1 };
  state.player.regionId = 'gloamgarden';
  state.player.position = [0, 0, 0];
  state.player.health = state.player.maxHealth = 10_000;
  const species = universalMinibossSpecies('01', 'gloamgarden');
  const target: SemanticEntity = {
    id: 'universal_miniboss_gloamgarden_1', name: species.stats.name, tier: 30, regionId: 'gloamgarden',
    archetype: 'boss', position: [0, 0, 1.2], state: 'alive', interactions: ['inspect', 'attack'],
    combat: { health: 1, maxHealth: 1, level: enemyCombatLevel(species.stats), aggroRadius: 0 },
    view: { assetId: species.assetId },
    meta: { enemyDefId: species.stats.id, family: species.stats.family, rank: 'miniboss', behaviour: 'territorial' },
  };
  const entities = { get: (id: string) => id === target.id ? target : undefined, all: () => [target],
    add: () => undefined, remove: () => false };
  const events = new EventBus();
  const combat = new CombatSystem({
    store, events, entities, rng: new RngStreams(seed),
    equipment: { totals: () => hero, slots: () => state.equipment },
    inventory: {
      addItem: (_id, quantity) => ok(quantity), removeItem: (_id, quantity) => ok(quantity),
      countItem: () => 0, freeSlots: () => 28, hasRoomFor: () => true,
    },
    dispatcher: new InteractionDispatcher({
      get: entities.get, playerPosition: () => state.player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, state.skills[id].level])) as Record<SkillId, number>,
    }),
  });
  const ai = new EnemyAiSystem({ store, events, entities, combat,
    nav: { nearestWalkable: wanted => [...wanted] } });
  function kill() {
    expect(combat.attack(target.id).ok).toBe(true);
    for (let atMs = 0; atMs < 30_000 && target.state !== 'dead'; atMs += 100) combat.tick(100, atMs);
    expect(target.state).toBe('dead');
    return state.world.enemies[target.id]!;
  }
  return { store, state, target, combat, ai, entities, kill };
}

describe('universal miniboss placement and rewards', () => {
  it('selects exactly two distinct bodies and sockets in every region without consuming other streams', () => {
    const allBodies = new Set<string>();
    for (const regionId of Object.keys(REGION_COMBAT_TIERS) as RegionId[]) {
      const sockets: UniversalMinibossSocket[] = [0, 1, 2, 3].map(index => ({
        id: `${regionId}_${index}`, regionId, position: [index * 80, index % 2 * 90],
      }));
      const first = buildUniversalMinibossGroups(regionId, 42, sockets);
      expect(first).toEqual(buildUniversalMinibossGroups(regionId, 42, [...sockets].reverse()));
      expect(first).toHaveLength(2);
      expect(new Set(first.map(group => group.assetId)).size).toBe(2);
      expect(new Set(first.map(group => group.centre.join(':'))).size).toBe(2);
      expect(first.every(group => group.miniBoss && group.count === 1 && group.radius === 0)).toBe(true);
      expect(first.every(group => group.tier === REGION_COMBAT_TIERS[regionId])).toBe(true);
      const choices = new Set<string>();
      for (let seed = 1; seed <= 50; seed++) {
        const groups = buildUniversalMinibossGroups(regionId, seed, sockets);
        groups.forEach(group => allBodies.add(group.assetId));
        choices.add(JSON.stringify(groups.map(group => [group.assetId, group.centre])));
      }
      expect(choices.size).toBeGreaterThan(10);
    }
    expect(allBodies.size).toBe(9);
  });

  it('rejects crowded, missing, and nonfinite spawn sockets', () => {
    const socket = { id: 'a', regionId: 'faeholme' as const, position: [10, 10] as const };
    expect(() => buildUniversalMinibossGroups('faeholme', 7, [socket])).toThrow('two valid');
    expect(() => buildUniversalMinibossGroups('faeholme', 7, [socket, { ...socket, id: 'b', position: [11, 11] }])).toThrow('56 m');
    expect(() => buildUniversalMinibossGroups('faeholme', 7, [{ ...socket, position: [NaN, 10] }])).toThrow('Invalid');
  });

  it('uses the chamber-scale pair separation in Gravelmaw and the longer outdoor separation', () => {
    const sockets: UniversalMinibossSocket[] = [
      { id: 'first', regionId: 'gravelmaw', position: [0, 0] },
      { id: 'second', regionId: 'gravelmaw', position: [28, 0] },
    ];
    expect(universalMinibossMinimumSeparation('gravelmaw')).toBe(28);
    expect(universalMinibossMinimumSeparation('faeholme')).toBe(56);
    expect(buildUniversalMinibossGroups('gravelmaw', 42, sockets)).toHaveLength(2);
    expect(() => buildUniversalMinibossGroups('gravelmaw', 42, [sockets[0]!, { ...sockets[1]!, position: [27.99, 0] }])).toThrow('28 m');
    expect(() => buildUniversalMinibossGroups('faeholme', 42, sockets.map(socket => ({ ...socket, regionId: 'faeholme' })))).toThrow('56 m');
  });

  it('keeps every source body at miniboss strength and its jewellery on the regional ladder', () => {
    for (const species of UNIVERSAL_MINIBOSS_SPECIES) {
      expect(species.stats.tier).toBe(REGION_COMBAT_TIERS[species.regionId]);
      expect(enemyCombatLevel(species.stats)).toBe(Math.max(12, Math.round(species.stats.tier * 2.5)));
      expect(species.stats.respawnSeconds).toBe(1800);
      const [standardDrop, uniqueDrop] = species.stats.drops;
      expect(standardDrop!.chance).toBe(1);
      expect(uniqueDrop!.chance).toBe(.02);
      const standard = MINIBOSS_JEWELLERY.find(item => item.id === standardDrop!.itemId)!;
      const unique = MINIBOSS_JEWELLERY.find(item => item.id === uniqueDrop!.itemId)!;
      expect(standard.tier).toBe(species.stats.tier);
      expect(unique.tier).toBe(species.stats.tier);
      for (const key of ['armour', 'magicArmour', 'vitality'] as const) {
        expect(unique.equip!.bonuses[key]).toBeGreaterThan(standard.equip!.bonuses[key]);
      }
      const power = species.stats.attackStyle === 'magic' ? 'magicPower' : 'power';
      expect(unique.equip!.bonuses[power]).toBeGreaterThan(standard.equip!.bonuses[power]);
    }
    expect(new Set(MINIBOSS_JEWELLERY.map(item => item.id)).size).toBe(MINIBOSS_JEWELLERY.length);
    for (const item of MINIBOSS_JEWELLERY) {
      expect(item.name).not.toMatch(/\bT\d+\b|\btier\b/i);
      expect(item.name).toMatch(/Ring|Pendant/);
    }
    expect(MINIBOSS_JEWELLERY.find(item => item.id === 'unique_jewellery_01_t30')!.name).toBe('Moonpetal Brambleheart Ring');
    expect(MINIBOSS_JEWELLERY.find(item => item.id === 'unique_jewellery_01_t60')!.name).toBe('Starwoven Brambleheart Ring');
  });

  it('uses the distinct ordinary pack for both fairy tiers and makes remote creatures stronger', () => {
    expect(FAIRY_CREATURE_SPECIES).toHaveLength(12);
    for (const regionId of ['gloamgarden', 'faeholme']) {
      const species = FAIRY_CREATURE_SPECIES.filter(row => row.regionId === regionId);
      expect(species).toHaveLength(6);
      expect(species.every(row => !isReservedUniversalMinibossAsset(row.assetId))).toBe(true);
      expect(enemyCombatLevel(species[5]!.stats)).toBeGreaterThan(enemyCombatLevel(species[0]!.stats));
      expect(species[5]!.stats.behaviour).toBe('aggressive');
    }
    for (const row of UNIVERSAL_MINIBOSS_ROSTER) expect(isReservedUniversalMinibossAsset(`fantasy_monster_${row.number}`)).toBe(true);
    for (const id of ['creature_cinder_ravager', 'creature_basalt_maw', 'creature_gorge_mantis', 'creature_hollow_star', 'creature_amethyst_sovereign']) {
      expect(isReservedUniversalMinibossAsset(id)).toBe(true);
    }
  });

  it('rolls guaranteed standard jewellery and rare independent unique jewellery through real kills', () => {
    let uniqueCount = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const sim = encounter(seed);
      sim.kill();
      const items = Object.values(sim.state.world.lootPiles).flatMap(pile => pile.items);
      expect(items.find(item => item.itemId === 'warden_jewellery_01_t30')?.quantity).toBe(1);
      if (items.some(item => item.itemId === 'unique_jewellery_01_t30')) uniqueCount++;
    }
    expect(uniqueCount).toBeGreaterThan(0);
    expect(uniqueCount).toBeLessThan(15);
  });
});

describe('thirty-minute production cooldown', () => {
  it('schedules death plus 1800 seconds and respawns only at that deadline', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const sim = encounter(), runtime = sim.kill();
    expect(runtime.respawnAtMs! - runtime.diedAtMs!).toBe(1_800_000);
    expect(runtime.respawnAtWallMs).toBe(2_800_000);
    const deadline = runtime.respawnAtMs!;
    sim.ai.tick(1, deadline - 1);
    expect(sim.target.state).toBe('dead');
    sim.ai.tick(1, deadline);
    expect(sim.target.state).toBe('alive');
    expect(runtime.respawnAtMs).toBeNull();
    expect(runtime.respawnAtWallMs).toBeUndefined();
  });

  it('preserves the remaining wall deadline over repeated reloads and allows overdue respawn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const sim = encounter(), runtime = sim.kill();
    rehydrateEnemyRuntimes(sim.state, sim.entities, 0, 1_600_000);
    expect(runtime.respawnAtMs).toBe(1_200_000);
    rehydrateEnemyRuntimes(sim.state, sim.entities, 100, 2_200_000);
    expect(runtime.respawnAtMs).toBe(600_100);
    expect(runtime.respawnAtWallMs).toBe(2_800_000);
    rehydrateEnemyRuntimes(sim.state, sim.entities, 200, 2_800_001);
    expect(runtime.respawnAtMs).toBe(200);
    sim.ai.tick(1, 200);
    expect(sim.target.state).toBe('alive');
  });

  it('gives legacy custom cooldown saves one full interval and a reusable wall deadline', () => {
    const sim = encounter(), runtime = sim.kill();
    delete runtime.respawnAtWallMs;
    rehydrateEnemyRuntimes(sim.state, sim.entities, 500, 10_000_000);
    expect(runtime.respawnAtMs).toBe(1_800_500);
    expect(runtime.respawnAtWallMs).toBe(11_800_000);
    rehydrateEnemyRuntimes(sim.state, sim.entities, 0, 10_300_000);
    expect(runtime.respawnAtMs).toBe(1_500_000);
  });
});
