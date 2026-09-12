import { describe, expect, it } from 'vitest';
import type { SemanticEntity } from '../game/src/contracts.js';
import { spreadMobSpawns } from '../game/src/world/mobSpawnSpacing.js';
import { habitatIdleTargets } from '../game/src/world/habitatMovement.js';

const mob = (id: string, groupId = 'fixed'): SemanticEntity => ({ id, archetype: 'enemy', name: id,
  regionId: 'fallowmarch', tier: 1, state: 'alive', position: [0, 0, 0], interactions: ['attack'],
  combat: { health: 10, maxHealth: 10, level: 1, aggroRadius: 3, bodyRadius: 1 }, meta: { groupId } });
const ports = { underground: () => false, place: (_entity: SemanticEntity, x: number, z: number) => [x, 0, z] as [number, number, number] };

describe('all-source mob spacing', () => {
  it.each([false, true])('keeps a running lane after idle wandering, underground=%s', underground => {
    const actors = Array.from({ length: 7 }, (_, index) => ({ ...mob(`large-${index}`),
      combat: { ...mob('base').combat!, bodyRadius: 3 } }));
    const habitats = spreadMobSpawns(actors, [], { ...ports, underground: () => underground });
    const wander = habitats[0]!.roamRadius!;
    for (let i = 0; i < actors.length; i++) for (const other of actors.slice(i + 1)) {
      const a = actors[i]!;
      const lane = Math.hypot(a.position[0] - other.position[0], a.position[2] - other.position[2])
        - a.combat!.bodyRadius! - other.combat!.bodyRadius! - wander * 2;
      expect(lane).toBeGreaterThanOrEqual(2 - 1e-6);
    }
  });

  it('retains an already loose pack without multiplying its spread', () => {
    const actors = Array.from({ length: 7 }, (_, index) => ({ ...mob(`loose-${index}`),
      position: [Math.cos(index * Math.PI * 2 / 7) * 15, 0,
        Math.sin(index * Math.PI * 2 / 7) * 15] as [number, number, number] }));
    const original = actors.map(actor => [...actor.position]);
    spreadMobSpawns(actors, [], ports);
    expect(actors.map(actor => actor.position)).toEqual(original);
  });

  it('preserves wide Wilderness anchors when final floor placement must search again', () => {
    const actors: SemanticEntity[] = Array.from({ length: 3 }, (_, index) => ({ ...mob(`dragon-${index}`), regionId: 'wilderness' }));
    spreadMobSpawns(actors, [{ id: 'roost', groupId: 'fixed', regionId: 'wilderness', centre: [0, 0],
      radius: 34, anchors: [[0, 0], [24, 0], [0, 24]], activity: 'patrol', dressing: [] }], ports);
    for (let i = 0; i < actors.length; i++) for (const other of actors.slice(i + 1)) {
      expect(Math.hypot(actors[i]!.position[0] - other.position[0], actors[i]!.position[2] - other.position[2])).toBeGreaterThanOrEqual(24 - 1e-6);
    }
  });

  it('replaces tightly authored anchors and separates neighbouring packs without dropping actors', () => {
    const actors = Array.from({ length: 21 }, (_, index) => mob(`mob-${index}`, `pack-${index % 3}`));
    const habitats = spreadMobSpawns(actors, [], ports);
    expect(habitats).toHaveLength(3);
    expect(habitats.flatMap(h => h.anchors)).toHaveLength(21);
    for (let i = 0; i < actors.length; i++) for (const other of actors.slice(i + 1)) {
      expect(Math.hypot(actors[i]!.position[0] - other.position[0], actors[i]!.position[2] - other.position[2])).toBeGreaterThanOrEqual(10 - 1e-6);
    }
    const fresh = Array.from({ length: 21 }, (_, index) => mob(`mob-${index}`, `pack-${index % 3}`));
    spreadMobSpawns(fresh, [], ports);
    expect(fresh).toEqual(actors);
  });

  it('uses receiving-floor checks and gives old patrols their own idle patch', () => {
    const actors = Array.from({ length: 7 }, (_, index) => mob(`mob-${index}`));
    const habitats = spreadMobSpawns(actors, [], { ...ports,
      place: (entity, x, z) => x < 0 ? null : ports.place(entity, x, z) });
    for (const entity of actors) {
      expect(entity.position[0]).toBeGreaterThanOrEqual(0);
      const idle = habitatIdleTargets(entity.id, entity.position, habitats[0]!);
      expect(idle.ranging).toBe(false);
      expect(idle.candidates).toHaveLength(4);
      expect(Math.hypot(idle.candidates[0]!.position[0] - entity.position[0], idle.candidates[0]!.position[2] - entity.position[2])).toBeCloseTo(1.5);
      expect(entity.meta!.spawnX).toBe(entity.position[0]);
    }
  });
});
