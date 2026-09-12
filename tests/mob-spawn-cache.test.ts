import { describe, expect, it, vi } from 'vitest';
import type { SemanticEntity, Vec3 } from '../game/src/contracts.js';
import { spreadMobSpawnsCached } from '../game/src/world/mobSpawnCache.js';
import { spreadMobSpawns } from '../game/src/world/mobSpawnSpacing.js';
import { MemoryGenerationCache } from './support/generation-cache.js';

const actors = (): SemanticEntity[] => Array.from({ length: 8 }, (_, i) => ({
  id: `mob-${i}`, archetype: i === 0 ? 'boss' : 'enemy', name: 'Mob', regionId: 'fallowmarch',
  tier: 1, state: 'alive', position: [i, 0, 0], interactions: ['attack'], meta: { groupId: 'pack', loot: 'retained' },
  combat: { health: 10, maxHealth: 10, level: 1, aggroRadius: 3, bodyRadius: 1 },
}));
const ports = { underground: () => false,
  place: (_entity: SemanticEntity, x: number, z: number): Vec3 | null => x < 0 ? null : [x, 0, z] };

describe('cached authored mob placement', () => {
  it('replaces caches made by the old uniform placement pass', async () => {
    const cache = new MemoryGenerationCache();
    await spreadMobSpawnsCached(cache, actors(), [], ports);
    const record = cache.entries.get('spawns/world') as { signature: string };
    const signature = JSON.parse(record.signature);
    delete signature.placementVersion;
    record.signature = JSON.stringify(signature);
    const place = vi.fn(ports.place);
    await spreadMobSpawnsCached(cache, actors(), [], { ...ports, place });
    expect(place).toHaveBeenCalled();
    expect(cache.hits).toBe(0);
  });

  it('restores exact receiving floors and habitats without rerunning searches or overwriting live state', async () => {
    const cache = new MemoryGenerationCache();
    const reference = actors(), cold = actors();
    const habitats = spreadMobSpawns(reference, [], ports);
    expect(await spreadMobSpawnsCached(cache, cold, [], ports)).toEqual(habitats);
    expect(cold).toEqual(reference);
    const returning = actors();
    returning[2]!.combat!.health = 3;
    returning[2]!.meta!.loot = 'different';
    const place = vi.fn(() => { throw new Error('warm boot must not search floors'); });
    expect(await spreadMobSpawnsCached(cache, returning, [], { ...ports, place })).toEqual(habitats);
    expect(cache.hits).toBe(1);
    expect(place).not.toHaveBeenCalled();
    expect(returning.map(actor => actor.position)).toEqual(reference.map(actor => actor.position));
    expect(returning[0]).toEqual(reference[0]);
    expect(returning[2]!.combat!.health).toBe(3);
    expect(returning[2]!.meta!.loot).toBe('different');
    expect(returning[2]!.meta!.spawnX).toBe(reference[2]!.position[0]);
  });

  it('regenerates changed placements and malformed derived records', async () => {
    const cache = new MemoryGenerationCache();
    await spreadMobSpawnsCached(cache, actors(), [], ports);
    const changed = actors(); changed[0]!.position = [100, 0, 0];
    const place = vi.fn(ports.place);
    await spreadMobSpawnsCached(cache, changed, [], { ...ports, place });
    expect(place).toHaveBeenCalled(); expect(cache.hits).toBe(0);
    (cache.entries.get('spawns/world') as any).placements[0].position[0] = NaN;
    const repeat = actors(); repeat[0]!.position = [100, 0, 0]; place.mockClear();
    await spreadMobSpawnsCached(cache, repeat, [], { ...ports, place });
    expect(place).toHaveBeenCalled(); expect(cache.hits).toBe(0);
    expect(repeat).toEqual(changed);
  });
});
