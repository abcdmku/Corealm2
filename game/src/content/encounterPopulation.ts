import type { EnemyGroupDef, Spot } from './regions.js';

/** Counts apply to real simultaneous residents. Bosses never gain ordinary pack members. */
export const ENCOUNTER_POPULATION_LIMITS = { minimum: 7, maximum: 15, bodyGap: .5 } as const;

function hashId(id: string): number {
  let value = 2166136261;
  for (let index = 0; index < id.length; index++) value = Math.imul(value ^ id.charCodeAt(index), 16777619);
  return value >>> 0;
}

export function encounterPopulationCount(group: Pick<EnemyGroupDef, 'id' | 'count' | 'countPolicy' | 'boss' | 'miniBoss'>): number {
  if (group.boss || group.miniBoss) return 1;
  if (group.countPolicy === 'fixed') {
    if (!Number.isInteger(group.count) || group.count < 1 || group.count > ENCOUNTER_POPULATION_LIMITS.maximum)
      throw new Error(`${group.id}: fixed resident count must be between 1 and ${ENCOUNTER_POPULATION_LIMITS.maximum}`);
    return group.count;
  }
  if (Number.isInteger(group.count) && group.count >= 7 && group.count <= 15) return group.count;
  return ENCOUNTER_POPULATION_LIMITS.minimum + hashId(group.id) % 9;
}

/** An old one-member group used its bare group ID. Keep that first actor when adding residents. */
export function encounterActorId(group: Pick<EnemyGroupDef, 'id' | 'count' | 'legacyCount'>, index: number,
  legacyCount = group.legacyCount ?? group.count): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`${group.id}: invalid actor index`);
  return legacyCount === 1 && index === 0 ? group.id : `${group.id}_${index + 1}`;
}

export interface EncounterFormationOptions {
  /** Maximum animated horizontal extent from the actor root, already at production scale. */
  readonly bodyRadius: number;
  /** Keep these world-space positions first when they fit. Existing actor indices stay in order. */
  readonly preferredAnchors?: readonly Spot[];
  /** Occupied actor circles from adjacent packs, including their animation envelope. */
  readonly occupied?: readonly { readonly position: Spot; readonly bodyRadius: number }[];
  /** Whole-envelope placement predicate. The caller owns terrain, structure and water authority. */
  readonly accepts?: (position: Spot, bodyRadius: number) => boolean;
  /** Maximum distance of the animated body from group.centre, e.g. a cave chamber or clear court. */
  readonly maxRadius?: number;
  /** Fixed groups allow 1–15; other ordinary groups allow 7–15. Bosses still resolve to one. */
  readonly count?: number;
  readonly rotationY?: number;
  readonly bodyGap?: number;
}

export interface EncounterFormation {
  readonly group: EnemyGroupDef;
  readonly anchors: readonly Spot[];
  readonly actorIds: readonly string[];
  readonly bodyRadius: number;
  readonly minimumSeparation: number;
}

/** A constrained room must be enlarged or re-authored, never silently filled with overlapping actors. */
export class EncounterFormationError extends Error {
  constructor(readonly groupId: string, readonly required: number, readonly placed: number, readonly maxRadius: number) {
    super(`${groupId}: only ${placed}/${required} residents fit inside ${maxRadius.toFixed(2)} m; enlarge or move the encounter`);
    this.name = 'EncounterFormationError';
  }
}

/**
 * A count-independent hexagonal spiral preserves initial actor ordering when a pack grows.
 * Production callers supply actual receiving-floor clearance; this module does not duplicate it.
 */
export function createEncounterFormation(group: EnemyGroupDef, options: EncounterFormationOptions): EncounterFormation {
  const boss = group.boss || group.miniBoss;
  const count = boss ? 1 : options.count ?? encounterPopulationCount(group);
  if (!Number.isFinite(options.bodyRadius) || options.bodyRadius <= 0) throw new Error(`${group.id}: invalid moving body radius`);
  const minimum = group.countPolicy === 'fixed' ? 1 : ENCOUNTER_POPULATION_LIMITS.minimum;
  if (!boss && (!Number.isInteger(count) || count < minimum || count > 15))
    throw new Error(`${group.id}: ordinary population must be ${minimum}–15`);
  const gap = options.bodyGap ?? ENCOUNTER_POPULATION_LIMITS.bodyGap;
  if (!Number.isFinite(gap) || gap < 0) throw new Error(`${group.id}: invalid body gap`);
  const spacing = options.bodyRadius * 2 + gap;
  const maximum = options.maxRadius ?? Math.max(group.radius, spacing * 4 + options.bodyRadius);
  if (!Number.isFinite(maximum) || maximum < options.bodyRadius) throw new Error(`${group.id}: invalid formation radius`);
  const angle = options.rotationY ?? hashId(group.id) / 0x100000000 * Math.PI * 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const anchors: Spot[] = [];
  const permitted = (point: Spot): boolean => {
    if (!point.every(Number.isFinite)) return false;
    if (Math.hypot(point[0] - group.centre[0], point[1] - group.centre[1]) + options.bodyRadius > maximum + 1e-6) return false;
    if (anchors.some(other => Math.hypot(point[0] - other[0], point[1] - other[1]) < spacing - 1e-6)) return false;
    if (options.occupied?.some(other => Math.hypot(point[0] - other.position[0], point[1] - other.position[1])
      < options.bodyRadius + other.bodyRadius + gap - 1e-6)) return false;
    return options.accepts?.(point, options.bodyRadius) ?? true;
  };
  const add = (point: Spot): void => { if (anchors.length < count && permitted(point)) anchors.push(point); };
  for (const point of options.preferredAnchors ?? []) add(point);
  // The axial grid is ordered by ring rather than requested count. Its first seven positions
  // remain the same for counts eight through fifteen and after deterministic regeneration.
  const candidate = (q: number, r: number): void => {
    const x = spacing * (q + r * .5), z = spacing * r * Math.sqrt(3) * .5;
    add([group.centre[0] + x * cos - z * sin, group.centre[1] + x * sin + z * cos]);
  };
  candidate(0, 0);
  const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
  const rings = Math.min(128, Math.ceil(maximum / (spacing * Math.sqrt(3) * .5)) + 1);
  for (let ring = 1; ring <= rings && anchors.length < count; ring++) {
    let q = 0, r = -ring;
    for (const [dq, dr] of directions) for (let side = 0; side < ring; side++) {
      candidate(q, r); q += dq; r += dr;
    }
  }
  // Greedily retained old anchors can obstruct an otherwise valid formation.
  // Retry the same floor and clearance constraints using only the ordered grid.
  if (anchors.length !== count && options.preferredAnchors?.length) {
    return createEncounterFormation(group, { ...options, preferredAnchors: [] });
  }
  if (anchors.length !== count) throw new EncounterFormationError(group.id, count, anchors.length, maximum);
  const envelope = Math.max(...anchors.map(point => Math.hypot(point[0] - group.centre[0], point[1] - group.centre[1])))
    + options.bodyRadius;
  return { group: { ...group, count, radius: Math.max(Math.min(group.radius, maximum), envelope) },
    anchors, actorIds: anchors.map((_, index) => encounterActorId(group, index)),
    bodyRadius: options.bodyRadius, minimumSeparation: spacing };
}

/** Terrain/scatter reservation uses the same circles as the actual spawn formation. */
export function encounterFormationClearance(formation: EncounterFormation, position: Spot): number {
  return Math.min(...formation.anchors.map(anchor => Math.hypot(position[0] - anchor[0], position[1] - anchor[1])
    - formation.bodyRadius));
}
