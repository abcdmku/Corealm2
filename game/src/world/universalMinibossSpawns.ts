import type { RegionId } from '../contracts.js';
import type { EnemyGroupDef, Spot } from '../content/regions.js';
import { Rng } from '../core/rng.js';
import { FAIRY_MINIBOSS_POOLS } from '../content/fairyMinibossForms.js';
import {
  UNIVERSAL_MINIBOSS_ROSTER, UNIVERSAL_MINIBOSSES_PER_REGION, universalMinibossSpecies,
} from '../content/universalMinibosses.js';

export interface UniversalMinibossSocket {
  readonly id: string;
  readonly regionId: RegionId;
  readonly position: Spot;
}

export function universalMinibossMinimumSeparation(regionId: RegionId): number {
  return regionId === 'gravelmaw' ? 28 : 56;
}

function regionSeed(seed: number, regionId: RegionId): number {
  let value = (seed ^ 0x91b055) >>> 0;
  for (const char of regionId) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}

/** Call once at boot/reset using terrain-validated sockets. Live ticks never reroll a resident. */
export function buildUniversalMinibossGroups(
  regionId: RegionId, seed: number, sockets: readonly UniversalMinibossSocket[],
): EnemyGroupDef[] {
  const candidates = [...new Map(sockets.filter(socket => socket.regionId === regionId)
    .map(socket => [`${socket.position[0]}:${socket.position[1]}`, socket])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.some(socket => !socket.position.every(Number.isFinite))) {
    throw new Error(`Invalid universal miniboss socket in ${regionId}`);
  }
  // Select a pair together: one unlucky first roll cannot consume the only valid partner.
  const minimumSeparation = universalMinibossMinimumSeparation(regionId);
  const pairs = candidates.flatMap((first, index) => candidates.slice(index + 1)
    .filter(second => Math.hypot(first.position[0] - second.position[0], first.position[1] - second.position[1]) >= minimumSeparation)
    .map(second => [first, second] as const));
  const rng = new Rng(regionSeed(seed, regionId));
  const pair = rng.pick(pairs);
  if (!pair) throw new Error(`${regionId} needs two valid miniboss sockets at least ${minimumSeparation} m apart`);
  const fairyPool: readonly string[] | undefined = regionId === 'gloamgarden' || regionId === 'faeholme'
    ? FAIRY_MINIBOSS_POOLS[regionId] : undefined;
  const bodies = UNIVERSAL_MINIBOSS_ROSTER.filter(row => !fairyPool || fairyPool.includes(row.number));
  return Array.from({ length: UNIVERSAL_MINIBOSSES_PER_REGION }, (_, index) => {
    const row = bodies.splice(rng.int(0, bodies.length - 1), 1)[0]!;
    const species = universalMinibossSpecies(row.number, regionId);
    return {
      id: `universal_miniboss_${regionId}_${index + 1}`, family: species.stats.family,
      name: species.stats.name, tier: species.stats.tier, assetId: species.assetId,
      scale: species.scale / 1.3, centre: [...pair[index]!.position] as Spot,
      count: 1, radius: 0, miniBoss: true,
    };
  });
}
