import type { RegionId, SemanticEntity } from "../contracts.js";
import type { CompiledWorld } from "../content/worldData.js";
import type { HabitatDef } from "../content/worldHabitats.js";
import { Rng } from "../core/rng.js";
import { refineCreaturePopulation } from "../world/creaturePopulation.js";
import { hashId } from "../world/habitatMovement.js";
import { spreadMobSpawns, type MobSpawnSpacingPorts } from "../world/mobSpawnSpacing.js";
import { buildEnemyGroup } from "../world/regionBuilder.js";

/**
 * Spawn groups rebuilt while a world runs.
 *
 * A publish that moves, resizes, adds or removes a placement changes a few spawn groups. Only those
 * are built again, from the new catalog's world table, and spaced among the residents that keep their
 * spawn. The result is a plan: `HeadlessWorld.applySpawns` hands each creature its new spawn when it
 * next respawns, so nothing alive moves.
 */
export interface SpawnPlan {
  /** The groups this plan speaks for. A resident of one of them that the plan does not name is retired. Null means every group. */
  groupIds: ReadonlySet<string> | null;
  /** Creatures as a fresh world would build them, already spaced. */
  spawns: readonly SemanticEntity[];
  /** The spaced habitats of those groups, which replace the ones the world holds. */
  habitats: readonly HabitatDef[];
}

/**
 * What placing a creature needs from the world a server built, kept for the life of that world.
 * The authored world answers all of it from the server world pack: `floorAt` from the baked terrain
 * sampler, `baseY` and `assetSize` from the baked asset measurements, and `spacing` over the pack's
 * navmesh and solids. See `worldAssembly.ts`.
 */
export interface SpawnContext {
  seed: number;
  /** The walked floor under a spot: terrain outdoors, the chamber floor underground. */
  floorAt(regionId: RegionId, x: number, z: number): number;
  /** Distance from an asset's origin to the bottom of its box, at scale 1. */
  baseY(assetId: string): number;
  assetSize(assetId: string): { x: number; y: number; z: number } | null;
  spacing(habitats: readonly HabitatDef[]): MobSpawnSpacingPorts;
  /** The authored world trims crowded groups to a resident budget. A lab pad keeps every member. */
  refinePopulation: boolean;
}

const mob = (entity: SemanticEntity): boolean => entity.archetype === "enemy" || entity.archetype === "boss";
export const spawnGroupOf = (entity: SemanticEntity): string => String(entity.meta?.groupId ?? entity.id);

function signatures(world: CompiledWorld): Map<string, { regionId: string; signature: string }> {
  const habitats = new Map(world.habitats.map(habitat => [habitat.groupId, habitat]));
  const found = new Map<string, { regionId: string; signature: string }>();
  for (const [regionId, groups] of Object.entries(world.groupsByRegion)) for (const group of groups) {
    const creature = world.creatureByGroup[group.id];
    // Loot is read from the registry at each kill, so a loot edit must not rebuild a spawn.
    const { lootRolls: _rolls, gold: _gold, ...stats } = creature?.stats ?? {} as Partial<NonNullable<typeof creature>["stats"]>;
    found.set(group.id, { regionId, signature: JSON.stringify([regionId, group, habitats.get(group.id) ?? null, creature && { ...creature, stats }]) });
  }
  return found;
}

/** Groups whose placement, habitat or creature differs between two world tables, with the regions they are in. */
export function changedSpawnGroups(before: CompiledWorld, after: CompiledWorld): { groupIds: Set<string>; regionIds: string[] } {
  const old = signatures(before), next = signatures(after), groupIds = new Set<string>(), regionIds = new Set<string>();
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (old.get(id)?.signature === next.get(id)?.signature) continue;
    groupIds.add(id);
    for (const entry of [old.get(id), next.get(id)]) if (entry) regionIds.add(entry.regionId);
  }
  return { groupIds, regionIds: [...regionIds].sort() };
}

/**
 * Builds the named groups from `world` and spaces them among `residents`. Works on its own entities
 * only, so the live store is never touched. Throws when a creature has no walkable floor, which the
 * caller reports as a refused publish.
 */
export function planSpawns(context: SpawnContext, world: CompiledWorld, groupIds: ReadonlySet<string>, residents: readonly SemanticEntity[]): SpawnPlan {
  const habitats = new Map(world.habitats.map(habitat => [habitat.groupId, habitat]));
  const built: SemanticEntity[] = [];
  for (const [region, groups] of Object.entries(world.groupsByRegion)) for (const group of groups) {
    if (!groupIds.has(group.id)) continue;
    const regionId = region as RegionId;
    buildEnemyGroup(regionId, group, new Rng((hashId(group.id) ^ context.seed) >>> 0),
      (spot, assetId, scale) => [spot[0], Math.round((context.floorAt(regionId, spot[0], spot[1]) - context.baseY(assetId) * scale) * 100) / 100, spot[1]],
      built, context.assetSize, { habitat: habitats.get(group.id) ?? null, ...(world.creatureByGroup[group.id] ? { stats: world.creatureByGroup[group.id]!.stats } : {}) });
  }
  const spawns = context.refinePopulation ? refineCreaturePopulation(built, undefined, context.assetSize) : built;
  const sources = [...groupIds].flatMap(id => habitats.get(id) ?? []);
  const settled = residents.filter(entity => mob(entity) && !groupIds.has(spawnGroupOf(entity)));
  return { groupIds, spawns, habitats: spreadMobSpawns(spawns, sources, context.spacing(sources), settled) };
}

/** What a creature is built with, ignoring what changes while it lives. Equal signatures mean a respawn would change nothing. */
export function spawnSignature(entity: SemanticEntity): string {
  const { combat, view, meta } = entity;
  return JSON.stringify([entity.archetype, entity.name, entity.tier, entity.regionId,
    combat && [combat.maxHealth, combat.level, combat.aggroRadius, combat.moveSpeedMps ?? null, combat.walkSpeedMps ?? null, combat.bodyRadius ?? null],
    view && [view.assetId, view.scale ?? null, view.materialTier ?? null, view.labelHeight ?? null],
    meta && [meta.family, meta.enemyDefId, meta.groupId, meta.habitatId, meta.behaviour, meta.spawnX, meta.spawnZ, meta.rank].map(value => value ?? null)]);
}
