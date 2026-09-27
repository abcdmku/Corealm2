import type { Archetype, RegionId, SemanticEntity } from '../../../game/src/contracts.js';
import { CREATURE_CATALOG } from '../../../game/src/content/creatureRuntime.js';
import { enemyCombatLevel } from '../../../game/src/content/index.js';
import { WORLD_CONTENT } from '../../../game/src/content/worldData.js';
import type { EnemyGroupDef } from '../../../game/src/content/regions.js';

/**
 * The semantic entity the game would hand `EntityViews` for one creature definition.
 *
 * A placed creature is drawn from its world group: the placement decides boss rank (1.6x, or 1.3x
 * for a miniboss), level, scale multiplier and the entity id that seeds its dye. The same fields as
 * `world/regionBuilder.ts: buildEnemyGroup`, for the group's first resident. A definition with no
 * placement (a base or a lab creature) is drawn the way the lab stages a species: an ordinary enemy
 * at its own level and presentation scale, with its own id as the dye seed.
 */
export interface ActorSpec {
  entity: SemanticEntity;
  /** The world group this look comes from, or null for an unplaced definition. */
  groupId: string | null;
  rank: 'boss' | 'miniboss' | null;
}

const RANK_ORDER = { boss: 0, miniboss: 1, none: 2 } as const;

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

export function actorSpec(creatureId: string): ActorSpec {
  const creature = CREATURE_CATALOG.byCreatureId.get(creatureId);
  if (!creature) throw new Error(`Unknown creature ${creatureId}`);
  if (!creature.assetId) throw new Error(`${creatureId} has no model`);
  const placed = placedGroup(creatureId);
  const group = placed?.group;
  const stats = group ? WORLD_CONTENT.creatureByGroup.get(group.id)!.stats : creature.enemy;
  const rank = group?.boss ? 'boss' as const : group?.miniBoss ? 'miniboss' as const : null;
  const archetype: Archetype = rank ? 'boss' : 'enemy';
  const baseScale = group?.scale ?? creature.scale ?? 1;
  const viewScale = rank === 'boss' ? baseScale * 1.6 : rank === 'miniboss' ? baseScale * 1.3 : baseScale;
  const tier = group?.tier ?? creature.level;
  const id = group ? ((group.legacyCount ?? group.count) === 1 ? group.id : `${group.id}_1`) : creatureId;
  return {
    groupId: group?.id ?? null,
    rank,
    entity: {
      id, archetype, name: stats.name, tier,
      regionId: (placed?.regionId ?? 'fallowmarch') as RegionId,
      position: [0, 0, 0], state: 'alive', interactions: ['inspect', 'attack'],
      combat: {
        health: stats.maxHealth, maxHealth: stats.maxHealth, level: enemyCombatLevel(stats), aggroRadius: stats.aggroRadius,
        ...(stats.moveSpeedMps === undefined ? {} : { moveSpeedMps: stats.moveSpeedMps }),
        ...(stats.walkSpeedMps === undefined ? {} : { walkSpeedMps: stats.walkSpeedMps }),
      },
      view: { assetId: group?.assetId ?? creature.assetId, scale: viewScale, rotationY: 0, materialTier: tier, labelHeight: rank ? 3.4 : 2.2 },
      meta: { family: stats.family, enemyDefId: stats.id, ...(group ? { groupId: group.id } : {}), behaviour: stats.behaviour, ...(rank ? { rank } : {}) },
    },
  };
}
