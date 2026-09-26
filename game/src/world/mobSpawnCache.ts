import type { SemanticEntity, Vec3 } from '../contracts.js';
import type { HabitatDef } from '../content/worldHabitats.js';
import type { GenerationCachePort } from './generationCache.js';
import { spreadMobSpawns, type MobSpawnSpacingPorts } from './mobSpawnSpacing.js';

type Placement = { id: string; position: Vec3; groupId: string; habitatId: string };
/** `siteHabitats` are the habitats as they were BEFORE spreading: what the world's dressing was resolved around. */
type CachedSpawns = { signature: string; placements: Placement[]; habitats: HabitatDef[]; siteHabitats?: HabitatDef[] };

/** Cache authored spawn positions only. Save rehydration still owns health, death and respawn. */
/**
 * `trustBaked` is for the authored game page. It runs on the client catalog and has no habitat content, so it cannot rebuild
 * the signature, and it does not need to: the record is part of the shipped world data, whose revision was already checked.
 */
export async function spreadMobSpawnsCached(cache: GenerationCachePort, entities: readonly SemanticEntity[],
  habitats: readonly HabitatDef[], ports: MobSpawnSpacingPorts, options: { trustBaked?: boolean } = {}): Promise<HabitatDef[]> {
  const mobs = entities.filter(entity => entity.archetype === 'enemy' || entity.archetype === 'boss');
  const ordinary = mobs.filter(entity => entity.archetype === 'enemy');
  const signature = JSON.stringify({ placementVersion: 3, habitats, mobs: mobs.map(entity => ({
    id: entity.id, archetype: entity.archetype, region: entity.regionId, position: entity.position,
    radius: entity.combat?.bodyRadius ?? .5, group: entity.meta?.groupId ?? entity.id,
    level: entity.combat?.level, behaviour: entity.meta?.behaviour, aggroRadius: entity.combat?.aggroRadius,
    underground: ports.underground(entity.regionId),
  })) });
  const finitePoint = (value: unknown, length: number): boolean => Array.isArray(value)
    && value.length === length && value.every(Number.isFinite);
  const cached = await cache.get<CachedSpawns>('spawns/world', (value): value is CachedSpawns => {
    const data = value as CachedSpawns | null;
    return !!data && (options.trustBaked === true || data.signature === signature) && Array.isArray(data.placements)
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
  await cache.put('spawns/world', { signature, habitats: result, siteHabitats: [...habitats], placements: ordinary.map(entity => ({
    id: entity.id, position: [...entity.position], groupId: String(entity.meta!.groupId),
    habitatId: String(entity.meta!.habitatId),
  })), assetObjects: entities.filter(entity=>entity.view).map(entity=>({x:entity.position[0],z:entity.position[2],
    ids:[entity.view!.assetId,entity.view!.depletedAssetId,...(entity.view!.partAssetIds??[])].filter(Boolean)})) });
  return result;
}

/**
 * The habitats the baked world was dressed around, for a page with no habitat content of its own. Scatter tiles are accepted
 * only when the page reproduces the bake's exclusions exactly, and habitat dressing is part of them. Null when no record is shipped.
 */
export async function readBakedSiteHabitats(cache: GenerationCachePort): Promise<HabitatDef[] | null> {
  const baked = await cache.get<CachedSpawns>('spawns/world', (value): value is CachedSpawns => Array.isArray((value as CachedSpawns | null)?.siteHabitats));
  return baked?.siteHabitats ?? null;
}
