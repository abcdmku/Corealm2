import type { SemanticEntity, Vec3 } from '../contracts.js';
import type { HabitatDef } from '../content/worldHabitats.js';
import type { GenerationCachePort } from './generationCache.js';
import { spreadMobSpawns, type MobSpawnSpacingPorts } from './mobSpawnSpacing.js';

type Placement = { id: string; position: Vec3; groupId: string; habitatId: string };
type CachedSpawns = { signature: string; placements: Placement[]; habitats: HabitatDef[] };

/** Cache authored spawn positions only. Save rehydration still owns health, death and respawn. */
export async function spreadMobSpawnsCached(cache: GenerationCachePort, entities: readonly SemanticEntity[],
  habitats: readonly HabitatDef[], ports: MobSpawnSpacingPorts): Promise<HabitatDef[]> {
  const mobs = entities.filter(entity => entity.archetype === 'enemy' || entity.archetype === 'boss');
  const ordinary = mobs.filter(entity => entity.archetype === 'enemy');
  const signature = JSON.stringify({ habitats, mobs: mobs.map(entity => ({
    id: entity.id, archetype: entity.archetype, region: entity.regionId, position: entity.position,
    radius: entity.combat?.bodyRadius ?? .5, group: entity.meta?.groupId ?? entity.id,
    underground: ports.underground(entity.regionId),
  })) });
  const finitePoint = (value: unknown, length: number): boolean => Array.isArray(value)
    && value.length === length && value.every(Number.isFinite);
  const cached = await cache.get<CachedSpawns>('spawns/world', (value): value is CachedSpawns => {
    const data = value as CachedSpawns | null;
    return !!data && data.signature === signature && Array.isArray(data.placements)
      && data.placements.length === ordinary.length && data.placements.every((placement, index) =>
        placement?.id === ordinary[index]!.id && finitePoint(placement.position, 3)
        && typeof placement.groupId === 'string' && typeof placement.habitatId === 'string')
      && Array.isArray(data.habitats) && (data.habitats.length > 0) === (ordinary.length > 0)
      && data.habitats.every(habitat => habitat && typeof habitat.id === 'string'
        && typeof habitat.groupId === 'string' && typeof habitat.regionId === 'string'
        && finitePoint(habitat.centre, 2) && Number.isFinite(habitat.radius) && habitat.radius >= 0
        && Array.isArray(habitat.anchors) && habitat.anchors.every(point => finitePoint(point, 2))
        && ['graze', 'forage', 'prowl', 'patrol'].includes(habitat.activity)
        && Array.isArray(habitat.dressing) && Number.isFinite(habitat.roamRadius));
  });
  if (cached) {
    for (const [index, placement] of cached.placements.entries()) {
      const entity = ordinary[index]!;
      entity.position = [...placement.position];
      entity.meta = { ...entity.meta, groupId: placement.groupId, habitatId: placement.habitatId,
        spawnX: placement.position[0], spawnZ: placement.position[2] };
    }
    return cached.habitats;
  }
  const result = spreadMobSpawns(entities, habitats, ports);
  await cache.put('spawns/world', { signature, habitats: result, placements: ordinary.map(entity => ({
    id: entity.id, position: [...entity.position], groupId: String(entity.meta!.groupId),
    habitatId: String(entity.meta!.habitatId),
  })) } satisfies CachedSpawns);
  return result;
}
