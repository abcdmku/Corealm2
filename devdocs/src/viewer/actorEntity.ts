import type { Archetype, RegionId, SemanticEntity } from '../../../game/src/contracts.js';
import { CREATURE_CATALOG } from '../../../game/src/content/creatureRuntime.js';
import { enemyCombatLevel } from '../../../game/src/content/index.js';
import { WORLD_CONTENT } from '../../../game/src/content/worldData.js';
import { rollCreatureLook, type CreatureVariation } from '../../../game/src/content/creatureVariation.js';
import type { CreatureSpeciesDef } from '../../../game/src/content/creatureSpecies.js';
import type { EnemyGroupDef } from '../../../game/src/content/regions.js';
import type { ActorDraft } from './types.js';

/**
 * The semantic entities the game would hand `EntityViews` for one creature definition.
 *
 * A placed creature is drawn from its world group: the placement decides boss rank (1.6x, or 1.3x
 * for a miniboss), level, scale multiplier and the entity id that seeds its dye. The same fields as
 * `world/regionBuilder.ts: buildEnemyGroup`, for the group's first resident. A definition with no
 * placement (a base or a lab creature) is drawn the way the lab stages a species: an ordinary enemy
 * at its own level and presentation scale, with its own id as the dye seed.
 *
 * Every individual's look is rolled from its id with `rollCreatureLook`, as the world layer does.
 */
export interface ActorSpec {
  /** The first individual: the one the game draws for this definition's first resident. */
  entity: SemanticEntity;
  /** Every individual on the stage; `entities[0] === entity`. Positioned at the origin. */
  entities: SemanticEntity[];
  /** The world group this look comes from, or null for an unplaced definition. */
  groupId: string | null;
  rank: 'boss' | 'miniboss' | null;
  /** The variation range the individuals were rolled from, after the draft. */
  variation: CreatureVariation | null;
}

/** The most individuals a crowd preview draws. */
export const MAX_CROWD = 12;
const RANK_ORDER = { boss: 0, miniboss: 1, none: 2 } as const;
const RANK_SCALE = { boss: 1.6, miniboss: 1.3 } as const;

function placedGroup(creatureId: string): { regionId: string; group: EnemyGroupDef } | null {
  let best: { regionId: string; group: EnemyGroupDef } | null = null;
  const rank = (group: EnemyGroupDef) => RANK_ORDER[group.boss ? 'boss' : group.miniBoss ? 'miniboss' : 'none'];
  for (const [regionId, groups] of WORLD_CONTENT.groupsByRegion) {
    for (const group of groups) {
      if (WORLD_CONTENT.creatureByGroup.get(group.id)?.id !== creatureId) continue;
      if (!best || rank(group) < rank(best.group) || (rank(group) === rank(best.group) && group.id < best.group.id)) best = { regionId, group };
    }
  }
  return best;
}

export function crowdSize(draft?: ActorDraft): number {
  return Math.max(1, Math.min(MAX_CROWD, Math.floor(draft?.crowd ?? 1)));
}

/**
 * The entity id of crowd member `index`. The first member with no seed keeps the definition's own
 * id, so a crowd starts with the individual the single view shows; every other id is new.
 */
export function crowdEntityId(baseId: string, seed: number | undefined, index: number): string {
  return !seed && index === 0 ? baseId : `${baseId}~s${seed ?? 0}~${index}`;
}

/** Slots for `count` individuals in rows facing +Z (the camera side), `spacing` apart, centred on the origin. */
export function crowdLayout(count: number, spacing: number): [number, number][] {
  const columns = count <= 3 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    // The last row may be short; centre it too.
    const inRow = row === rows - 1 ? count - row * columns : columns;
    const column = index % columns;
    return [(column - (inRow - 1) / 2) * spacing, ((rows - 1) / 2 - row) * spacing];
  });
}

export function actorSpec(creatureId: string, draft?: ActorDraft): ActorSpec {
  const creature = CREATURE_CATALOG.byCreatureId.get(creatureId);
  if (!creature) throw new Error(`Unknown creature ${creatureId}`);
  if (!creature.assetId) throw new Error(`${creatureId} has no model`);
  const placed = placedGroup(creatureId);
  const group = placed?.group;
  const stats = group ? WORLD_CONTENT.creatureByGroup.get(group.id)!.stats : creature.enemy;
  const rank = group?.boss ? 'boss' as const : group?.miniBoss ? 'miniboss' as const : null;
  const archetype: Archetype = rank ? 'boss' : 'enemy';
  const own = creature.presentation as Partial<CreatureSpeciesDef> | undefined;
  const override = draft?.presentation;
  // A draft scale replaces the definition's; a placement's own adjustment of it carries over.
  const definitionScale = creature.scale ?? 1;
  const placedScale = group?.scale ?? definitionScale;
  const baseScale = override?.scale === undefined ? placedScale : placedScale * override.scale / definitionScale;
  const skinId = override?.skinId === undefined ? own?.skinId : override.skinId ?? undefined;
  const variation = override?.variation === undefined ? own?.variation ?? null : override.variation;
  const tier = group?.tier ?? creature.level;
  const firstId = group ? ((group.legacyCount ?? group.count) === 1 ? group.id : `${group.id}_1`) : creatureId;
  const entities = Array.from({ length: crowdSize(draft) }, (_, index): SemanticEntity => {
    const id = crowdEntityId(firstId, draft?.seed, index);
    // Always the rolled look, even for one individual: the stage shows what the game draws for
    // this id, so a definition with a variation range shows its first resident's roll.
    const look = rollCreatureLook({ scale: baseScale, ...(skinId ? { skinId } : {}), ...(variation ? { variation } : {}) }, id);
    return {
      id, archetype, name: stats.name, tier,
      regionId: (placed?.regionId ?? 'fallowmarch') as RegionId,
      position: [0, 0, 0], state: 'alive', interactions: ['inspect', 'attack'],
      combat: {
        health: stats.maxHealth, maxHealth: stats.maxHealth, level: enemyCombatLevel(stats), aggroRadius: stats.aggroRadius,
        ...(stats.moveSpeedMps === undefined ? {} : { moveSpeedMps: stats.moveSpeedMps }),
        ...(stats.walkSpeedMps === undefined ? {} : { walkSpeedMps: stats.walkSpeedMps }),
      },
      view: {
        assetId: group?.assetId ?? creature.assetId!, scale: look.scale * (rank ? RANK_SCALE[rank] : 1), rotationY: 0, materialTier: tier, labelHeight: rank ? 3.4 : 2.2,
        ...(look.skinId ? { skinId: look.skinId } : {}), ...(look.colour ? { colour: look.colour } : {}),
      },
      meta: { family: stats.family, enemyDefId: stats.id, ...(group ? { groupId: group.id } : {}), behaviour: stats.behaviour, ...(rank ? { rank } : {}) },
    };
  });
  return { entity: entities[0]!, entities, groupId: group?.id ?? null, rank, variation };
}
