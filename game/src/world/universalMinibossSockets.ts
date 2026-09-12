import type { RegionId, SemanticEntity, SolidVolume } from '../contracts.js';
import type { EnemyGroupDef, RegionDef, Spot } from '../content/regions.js';
import { CREATURE_SPECIES } from '../content/creatureSpecies.js';
import { isReservedUniversalMinibossAsset } from '../content/universalMinibosses.js';
import { tierSilhouetteScale } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { seedFromText } from './organicFields.js';
import { universalMinibossMinimumSeparation, type UniversalMinibossSocket } from './universalMinibossSpawns.js';

export interface UniversalMinibossSocketOptions {
  readonly seed: number;
  /** Production graded ground for this region, not a second terrain approximation. */
  readonly heightAt: (x: number, z: number) => number;
  readonly entities?: readonly SemanticEntity[];
  readonly solids?: readonly SolidVolume[];
  /** Reject water or disconnected terrain using the production water/navigation sampler. */
  readonly canStand?: (x: number, z: number) => boolean;
}

const BODY_RADIUS = 2;
const BODY_HEIGHT = 3.8;
const MAX_SLOPE = .5;
const distance = (a: Spot, b: Spot): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function overlapsSolid(point: Spot, groundY: number, solid: SolidVolume): boolean {
  const top = solid.position[1] + (solid.kind === 'box' ? solid.size[1] : solid.height);
  if (top <= groundY + .1 || solid.position[1] >= groundY + BODY_HEIGHT) return false;
  const dx = point[0] - solid.position[0], dz = point[1] - solid.position[2];
  if (solid.kind === 'cylinder') return Math.hypot(dx, dz) < solid.radius + BODY_RADIUS;
  const cosine = Math.cos(solid.rotationY), sine = Math.sin(solid.rotationY);
  const localX = dx * cosine - dz * sine, localZ = dx * sine + dz * cosine;
  const edgeX = Math.max(0, Math.abs(localX) - solid.size[0] / 2);
  const edgeZ = Math.max(0, Math.abs(localZ) - solid.size[2] / 2);
  return Math.hypot(edgeX, edgeZ) < BODY_RADIUS;
}

/** Authored fairy and cave sockets can use the same footprint and collision rejection. */
export function validUniversalMinibossFootprint(
  regionId: RegionId, point: Spot, options: UniversalMinibossSocketOptions,
): boolean {
  const groundY = options.heightAt(...point);
  if (!Number.isFinite(groundY) || options.canStand?.(...point) === false) return false;
  for (const radius of [1, BODY_RADIUS]) for (let step = 0; step < 8; step++) {
    const angle = step * Math.PI / 4;
    const x = point[0] + Math.cos(angle) * radius, z = point[1] + Math.sin(angle) * radius;
    const height = options.heightAt(x, z);
    if (!Number.isFinite(height) || Math.abs(height - groundY) / radius >= MAX_SLOPE
      || options.canStand?.(x, z) === false) return false;
  }
  for (const entity of options.entities ?? []) {
    if (entity.regionId !== regionId) continue;
    if (entity.archetype !== 'enemy' && entity.archetype !== 'boss' && entity.archetype !== 'npc'
      && !entity.resource) continue;
    let clearance = (entity.archetype === 'boss' ? 15 : 12)
      + Math.max(0, (entity.combat?.bodyRadius ?? 0) - BODY_RADIUS);
    if (regionId === 'gravelmaw') {
      const solids = (options.solids ?? []).filter(solid => solid.id === entity.id);
      const solidRadius = Math.max(0, ...solids.map(solid => solid.kind === 'cylinder' ? solid.radius
        : Math.hypot(solid.size[0], solid.size[2]) / 2));
      const trunkRadius = typeof entity.meta?.trunkRadius === 'number' ? entity.meta.trunkRadius : 0;
      const otherRadius = Math.max(solidRadius, trunkRadius,
        entity.combat?.bodyRadius ?? (entity.archetype === 'npc' ? .45 : entity.resource ? .8 : .75));
      // Production cave spacing keeps a 5 m root separation and 3.5 m between body bounds.
      clearance = Math.max(5, BODY_RADIUS + otherRadius + 3.5);
    }
    if (distance(point, [entity.position[0], entity.position[2]])
      < clearance) return false;
  }
  return !(options.solids ?? []).some(solid => overlapsSolid(point, groundY, solid));
}

function clearOfAuthoredContent(region: RegionDef, point: Spot): boolean {
  if (region.settlement && distance(point, region.settlement.centre) < 45) return false;
  if (region.locations.some(location => location.kind === 'settlement' && distance(point, location.position) < 45)) return false;
  if (distance(point, region.spawnPoint) < 32) return false;
  if (region.clusters.some(cluster => distance(point, cluster.centre) < cluster.radius + 14)) return false;
  return !region.enemyGroups.some(group => !group.id.startsWith('universal_miniboss_')
    && distance(point, group.centre) < group.radius + (group.boss || group.miniBoss ? 15 : 12));
}

/**
 * World placement only. The root calls this after semantic residents and solids are built.
 * Exhaust the normal grid, then a finer grid if necessary; never weaken collision exclusions.
 */
export function deriveUniversalMinibossSockets(
  region: RegionDef, options: UniversalMinibossSocketOptions,
): UniversalMinibossSocket[] {
  const candidates: UniversalMinibossSocket[] = [];
  const minimumSeparation = universalMinibossMinimumSeparation(region.id);
  for (const spacing of [24, 12]) {
    const rng = new Rng(options.seed ^ seedFromText(`universal-miniboss-sockets:${region.id}:${spacing}`));
    for (let x = region.bounds.min[0] + 8; x <= region.bounds.max[0] - 8; x += spacing) {
      for (let z = region.bounds.min[1] + 8; z <= region.bounds.max[1] - 8; z += spacing) {
        const point: Spot = [Math.round((x + rng.float(-3, 3)) * 100) / 100,
          Math.round((z + rng.float(-3, 3)) * 100) / 100];
        if (!clearOfAuthoredContent(region, point) || !validUniversalMinibossFootprint(region.id, point, options)) continue;
        candidates.push({ id: `${region.id}_guardian_socket_${spacing}_${x}_${z}`, regionId: region.id, position: point });
      }
    }
    if (candidates.some((first, index) => candidates.slice(index + 1).some(second => distance(first.position, second.position) >= minimumSeparation))) break;
  }
  const pair = candidates.flatMap((first, index) => {
    const second = candidates.slice(index + 1).find(candidate => distance(first.position, candidate.position) >= minimumSeparation);
    return second ? [[first, second] as const] : [];
  })[0];
  if (!pair) {
    throw new Error(`No separated safe miniboss sockets in ${region.id}; author two clear sockets instead of bypassing terrain or residents`);
  }
  // Bound downstream pair selection while retaining a seed-stable spread across the full region.
  const ranked = candidates.filter(candidate => candidate !== pair[0] && candidate !== pair[1])
    .sort((a, b) => seedFromText(`${options.seed}:${a.id}`) - seedFromText(`${options.seed}:${b.id}`));
  return [...pair, ...ranked.slice(0, 126)];
}

const RESERVED_SOURCE_REPLACEMENTS: Readonly<Record<string, string>> = {
  creature_basalt_maw: 'furnace_grazer', creature_cinder_ravager: 'kiln_marrow',
  creature_gorge_mantis: 'slag_crawler', creature_hollow_star: 'voidstone_colossus',
  creature_amethyst_sovereign: 'bloomheart_matriarch',
};

/** Only the two universal slots may keep source bodies 01-09. Named encounters keep their rules. */
export function remapReservedEncounterGroup(group: EnemyGroupDef): EnemyGroupDef {
  if (group.id.startsWith('universal_miniboss_') || !isReservedUniversalMinibossAsset(group.assetId)) return group;
  const replacementId = RESERVED_SOURCE_REPLACEMENTS[group.assetId] ?? 'kiln_marrow';
  const replacement = CREATURE_SPECIES.find(species => species.id === replacementId);
  if (!replacement || isReservedUniversalMinibossAsset(replacement.assetId)) {
    throw new Error(`Missing accepted replacement ${replacementId} for ${group.id}`);
  }
  const rankScale = group.boss ? 1.6 : group.miniBoss ? 1.3 : 1;
  return { ...group, assetId: replacement.assetId,
    scale: replacement.scale * tierSilhouetteScale(replacement.stats.tier)
      / tierSilhouetteScale(group.tier) / rankScale };
}
