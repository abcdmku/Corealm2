import { describe, expect, it } from 'vitest';
import { createGroundMotionFixture, GROUND_MOTION_ACTORS, LEGACY_GROUND_MOTION_ACTORS } from '../game/src/featureLab/groundMotion.js';
import { enemyBlockFor } from '../game/src/content/enemies.js';
import MANIFEST from '../game/public/assets/manifest.json' with { type: 'json' };
import { Store } from '../game/src/state/store.js';
import { EventBus } from '../game/src/core/events.js';
import { RngStreams } from '../game/src/core/rng.js';
import { CombatSystem } from '../game/src/systems/combat.js';
import { EnemyAiSystem } from '../game/src/systems/enemyAI.js';
import { InteractionDispatcher } from '../game/src/world/interactions.js';
import { ok } from '../game/src/contracts.js';

const entries = new Map(MANIFEST.assets.map(asset => [asset.id, asset]));
const make = (cohort: 'ground' | 'legacy' = 'ground') => createGroundMotionFixture({ cohort, heightAt: () => 0, baseY: id => entries.get(id)!.groundY ?? entries.get(id)!.base.y, assetSize: id => entries.get(id)?.size ?? null });

describe('production ground motion circuits', () => {
  it('constructs only selected residents without changing their production bindings', () => {
    const fixture = createGroundMotionFixture({ cohort: 'legacy', assetIds: ['animal_ibex', 'animal_rabbit'], heightAt: () => 0, baseY: id => entries.get(id)!.groundY ?? entries.get(id)!.base.y, assetSize: id => entries.get(id)?.size ?? null });
    expect(fixture.actors.map(actor => actor.assetId)).toEqual(['animal_ibex', 'animal_rabbit']);
    expect(fixture.entities).toHaveLength(2); expect(fixture.habitats).toHaveLength(2);
    for (const entity of fixture.entities) {
      const original = make('legacy').entities.find(row => row.id === entity.id)!;
      expect(entity).toEqual(original);
    }
  });
  it.each(['ground', 'legacy'] as const)('keeps %s actor speeds and same-realm patrol habitats around their spawn', (cohort) => {
    const fixture = make(cohort), expected = cohort === 'legacy' ? LEGACY_GROUND_MOTION_ACTORS : GROUND_MOTION_ACTORS;
    expect(fixture.entities).toHaveLength(expected.length);
    for (const actor of fixture.entities) {
      const habitat = fixture.habitatForEntity(actor)!;
      expect(actor.regionId).toBe(habitat.regionId);
      expect(habitat.activity).toBe('patrol');
      expect(Math.hypot(actor.position[0] - habitat.centre[0], actor.position[2] - habitat.centre[1])).toBeLessThan(habitat.radius);
      const stats = enemyBlockFor(String(actor.meta!.enemyDefId), String(actor.meta!.family), actor.tier)!;
      expect(actor.combat!.walkSpeedMps).toBe(stats.walkSpeedMps);
      expect(actor.combat!.moveSpeedMps).toBe(stats.moveSpeedMps);
      expect(actor.meta!.galleryMotion).not.toBe(true);
      expect(actor.position.every(Number.isFinite)).toBe(true);
    }
    expect(fixture.actors.map(actor => actor.assetId)).toEqual(expected.map(actor => actor.assetId));
  });

  it('does not assign test habitats to ordinary world actors', () => {
    const fixture = make();
    const unrelated = { ...fixture.entities[0]!, id: 'world-frog' };
    expect(fixture.habitatForEntity(unrelated)).toBeNull();
  });

  it.each(['ground', 'legacy'] as const)('walks every %s patrol through real AI on a flat navigable yard', (cohort) => {
    const fixture = make(cohort), store = new Store(7, 0), state = store.get(), events = new EventBus();
    state.player.position = [...fixture.spawn]; state.player.regionId = 'fallowmarch';
    const entities = { all: () => fixture.entities, get: (id: string) => fixture.entities.find(actor => actor.id === id) };
    const combat = new CombatSystem({ store, events, entities, rng: new RngStreams(7),
      equipment: { totals: () => ({ meleeAccuracy: 0, meleePower: 0,  magicAccuracy: 0, magicPower: 0, defence: 0, health: 0 , vitality: 0 }), slots: () => state.equipment },
      inventory: { addItem: (_id, count) => ok(count), removeItem: (_id, count) => ok(count), countItem: () => 0, freeSlots: () => 28, hasRoomFor: () => true },
      dispatcher: new InteractionDispatcher({ get: entities.get, playerPosition: () => state.player.position, skillLevels: () => Object.fromEntries(Object.entries(state.skills).map(([id, skill]) => [id, skill.level])) as any }),
    });
    const ai = new EnemyAiSystem({ store, events, entities, combat, habitatForEntity: fixture.habitatForEntity,
      nav: { nearestWalkable: point => [point[0], 0, point[2]] }, groundHeightAt: () => 0 });
    const travel = new Map(fixture.entities.map(actor => [actor.id, 0]));
    for (let elapsed = 0; elapsed < 16_000; elapsed += 100) {
      const before = fixture.entities.map(actor => [...actor.position]);
      ai.tick(100, elapsed);
      fixture.entities.forEach((actor, i) => travel.set(actor.id, travel.get(actor.id)! + Math.hypot(actor.position[0] - before[i]![0]!, actor.position[2] - before[i]![2]!)));
    }
    for (const actor of fixture.entities) {
      expect(travel.get(actor.id), actor.id).toBeGreaterThan(1);
      expect(actor.state).toBe('alive');
    }
  });
});


