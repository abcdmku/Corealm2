import {
  EQUIP_SLOTS,
  SKILL_IDS,
  type EntityId,
  type FeatureLabCatalog,
  type FeatureLabPreset,
  type RegionId,
  type SemanticEntity,
  type Vec3,
} from "../contracts.js";
import { tierSilhouetteScale } from "../core/math.js";
import { enemyCombatLevel } from "../content/index.js";
import { enemyBlockFor } from "../content/enemies.js";
import { CREATURE_SPECIES } from "../content/creatureSpecies.js";
import { ALL_ITEMS } from "../content/items.js";
import { QUESTS } from "../content/quests.js";
import {
  REGIONS,
  type EnemyGroupDef,
  type NpcStandDef,
} from "../content/regions.js";
import { SKILLS } from "../content/skills.js";
import { SPELLS } from "../content/spells.js";
import { npcOutfitParts } from "../render/characterAppearances.js";
import { FEATURE_LAB_STRUCTURE_CATALOG } from "./structures.js";

interface NpcTargetSource {
  readonly kind: "npc";
  readonly preset: FeatureLabPreset;
  readonly regionId: RegionId;
  readonly settlementId: string;
  readonly npc: NpcStandDef;
}

interface CreatureTargetSource {
  readonly kind: "creature";
  readonly preset: FeatureLabPreset;
  readonly regionId: RegionId;
  readonly dungeonName: string | null;
  readonly group: EnemyGroupDef;
}

type TargetSource = NpcTargetSource | CreatureTargetSource;

function creatureOptionLabel(group: EnemyGroupDef): string {
  const stats = enemyBlockFor(group.id, group.family, group.tier);
  return stats ? `${group.name} (Level ${enemyCombatLevel(stats)})` : group.name;
}

const NPC_SOURCES: readonly NpcTargetSource[] = REGIONS.flatMap((region) => (
  region.settlement.npcs.map((npc) => ({
    kind: "npc" as const,
    preset: {
      id: npc.id,
      label: npc.name,
      kind: "npc" as const,
      tier: region.tier,
    },
    regionId: region.id,
    settlementId: region.settlement.id,
    npc,
  }))
));

const CREATURE_SOURCES: readonly CreatureTargetSource[] = [...REGIONS.flatMap((region) => {
  const surface = region.enemyGroups.map((group) => ({
    kind: "creature" as const,
    preset: {
      id: group.id,
      label: creatureOptionLabel(group),
      kind: "creature" as const,
      tier: group.tier,
    },
    regionId: region.id,
    dungeonName: null,
    group,
  }));
  const dungeon = region.dungeon;
  if (dungeon === undefined) return surface;
  return [
    ...surface,
    ...dungeon.enemyGroups.map((group) => ({
      kind: "creature" as const,
      preset: {
        id: `${dungeon.id}:${group.id}`,
        label: `${creatureOptionLabel(group)} - ${dungeon.name}`,
        kind: "creature" as const,
        tier: group.tier,
      },
      regionId: dungeon.id,
      dungeonName: dungeon.name,
      group,
    })),
  ];
}), ...CREATURE_SPECIES.map((species): CreatureTargetSource => ({
  kind: "creature",
  preset: { id: `species:${species.id}`, label: `${species.stats.name} (Level ${enemyCombatLevel(species.stats)})`, kind: "creature", tier: species.stats.tier },
  regionId: species.regionId,
  dungeonName: null,
  group: {
    id: `species:${species.id}`, family: species.stats.family, name: species.stats.name,
    tier: species.stats.tier, assetId: species.assetId, scale: species.scale,
    count: 1, centre: [0, 0], radius: 0,
  },
}))];

const TARGET_SOURCE_BY_KEY = new Map<string, TargetSource>();
for (const source of [...NPC_SOURCES, ...CREATURE_SOURCES]) {
  const key = targetKey(source.preset);
  if (TARGET_SOURCE_BY_KEY.has(key)) {
    throw new Error(`Duplicate feature-lab target preset: ${key}`);
  }
  TARGET_SOURCE_BY_KEY.set(key, source);
}

/**
 * Every selectable actor, equipment item, skill, and spell in the real-engine lab.
 *
 * The rows are projections of production content rather than a second authored catalog. Target
 * presets intentionally expose only the frozen setup contract; the source placement, rendering,
 * NPC, and combat data are resolved by `createFeatureLabEntity`.
 */
export const FEATURE_LAB_CATALOG = {
  targets: {
    npc: NPC_SOURCES.map((source) => source.preset),
    creature: CREATURE_SOURCES.map((source) => source.preset),
  },
  equipment: EQUIP_SLOTS.map((slot) => ({
    slot,
    label: titleCaseIdentifier(slot),
    items: ALL_ITEMS
      .filter((item) => item.equip?.slot === slot)
      .map((item) => ({ id: item.id, label: item.name })),
  })),
  skills: SKILL_IDS.map((id) => ({ id, label: SKILLS[id].name })),
  spells: SPELLS.map((spell) => ({
    id: spell.id,
    label: `${spell.name} - ${spell.element} ${spell.rung}`,
  })),
  structures: FEATURE_LAB_STRUCTURE_CATALOG,
} satisfies FeatureLabCatalog;

/**
 * Where to stand an actor `distance` metres from the player, offset off the camera centreline.
 *
 * `distance` is RADIAL. The lateral offset keeps melee contact and spell silhouettes readable
 * instead of stacking the actor into the player's own shape, and the forward leg is then solved so
 * the straight-line distance is the one that was asked for. That matters because the only reason a
 * caller picks a distance is to sit inside or outside an authored aggro radius, and an offset that
 * quietly added a metre would decide those tests instead of the content doing it.
 *
 * Lives here rather than in `runtime.ts` because it is arithmetic with no engine in it.
 */
export function featureLabTargetOffset(
  distance: number,
  lateral: number,
): { lateral: number; forward: number } {
  const squared = distance * distance - lateral * lateral;
  // A distance shorter than the offset cannot be reached off the centreline. Standing the actor
  // straight ahead is the closest honest answer, and it is still exactly the requested distance.
  if (squared <= 0) return { lateral: 0, forward: distance };
  return { lateral, forward: Math.sqrt(squared) };
}

/** Placement inputs owned by the empty flat session, not by authored world content. */
export interface FeatureLabEntityPlacement {
  /** The caller owns uniqueness so repeated spawns never collide in the entity table. */
  readonly entityId: EntityId;
  /** The flat floor point under the asset, in world-space metres. */
  readonly groundPosition: Vec3;
  /**
   * The loaded asset's bounding-box minimum Y, or a resolver for it. The resolver form lets the
   * catalog keep render data behind the preset id while still using `AssetRegistry.baseY` directly.
   */
  readonly baseY: number | ((assetId: string) => number);
  /**
   * The asset's measured bounding box in metres, or a resolver for it. Creatures only.
   *
   * `world/regionBuilder.ts` derives `combat.bodyRadius` from this, and `systems/enemyAI.ts` uses
   * that radius for separation and for how close a pursuer stops. Omitting it leaves the AI on its
   * own fallback, which is a different creature footprint from the one the world spawns — so the
   * lab passes it for the same reason production does.
   */
  readonly assetSize?: ((assetId: string) => { x: number; y: number; z: number } | null)
    | { x: number; y: number; z: number } | null;
  /** Optional lab-facing override. NPCs otherwise use authored facing; creatures default to zero. */
  readonly rotationY?: number;
}

/**
 * Builds the same semantic NPC/enemy shape as `world/regionBuilder.ts`, at a caller-owned spawn.
 *
 * This does not register or simulate the entity. The real lab engine owns insertion, views,
 * navigation, AI, interaction, and combat after receiving the returned production entity shape.
 */
export function createFeatureLabEntity(
  preset: FeatureLabPreset,
  placement: FeatureLabEntityPlacement,
): SemanticEntity {
  if (placement.entityId.trim().length === 0) {
    throw new Error("Feature-lab entity id must be non-empty");
  }
  assertFiniteVec3("Feature-lab ground position", placement.groundPosition);
  if (placement.rotationY !== undefined) {
    assertFinite("Feature-lab rotation", placement.rotationY);
  }

  const source = TARGET_SOURCE_BY_KEY.get(targetKey(preset));
  if (source === undefined) {
    throw new Error(`Unknown feature-lab ${preset.kind} preset: ${preset.id}`);
  }

  const assetId = source.kind === "npc" ? source.npc.assetId : source.group.assetId;
  const baseY = typeof placement.baseY === "function"
    ? placement.baseY(assetId)
    : placement.baseY;
  assertFinite(`Feature-lab base Y for ${assetId}`, baseY);

  return source.kind === "npc"
    ? createNpcEntity(source, placement, baseY)
    : createCreatureEntity(source, placement, baseY);
}

function createNpcEntity(
  source: NpcTargetSource,
  placement: FeatureLabEntityPlacement,
  baseY: number,
): SemanticEntity {
  const { npc } = source;
  const questIds = npc.questIds.length > 0
    ? [...npc.questIds]
    : QUESTS.filter((quest) => quest.giverNpcId === npc.id).map((quest) => quest.id);
  return {
    id: placement.entityId,
    archetype: "npc",
    name: npc.name,
    tier: source.preset.tier,
    regionId: source.regionId,
    position: placeOnFlatGround(placement.groundPosition, baseY, 1),
    state: "idle",
    interactions: ["inspect", "talk"],
    npc: {
      dialogueRootId: npc.dialogueRootId,
      questIds,
    },
    view: {
      assetId: npc.assetId,
      partAssetIds: npcOutfitParts(npc.id, npc.assetId),
      rotationY: placement.rotationY ?? npc.facingRad,
      labelHeight: 2.2,
    },
    meta: { settlementId: source.settlementId },
  };
}

function createCreatureEntity(
  source: CreatureTargetSource,
  placement: FeatureLabEntityPlacement,
  baseY: number,
): SemanticEntity {
  const { group } = source;
  // Same lookup and the same failure as `world/regionBuilder.ts: buildEnemyGroup`. Combat stats do
  // not live on `EnemyGroupDef` any more, so there is no placement-hint fallback to fall back to:
  // a group with no stat block is a content bug, and the lab must report it rather than spawn a
  // creature whose numbers differ from the one in the world.
  const stats = enemyBlockFor(group.id, group.family, group.tier);
  if (!stats) {
    throw new Error(
      `Enemy group "${group.id}" (family "${group.family}", tier ${group.tier}) has no stat block in content/enemies.ts`,
    );
  }
  // Same rank rule as `buildEnemyGroup`: minibosses share the boss archetype at 1.3x scale.
  const bossRank = group.boss ? "boss" as const : group.miniBoss ? "miniboss" as const : null;
  const archetype = bossRank === null ? "enemy" as const : "boss" as const;
  const viewScale = bossRank === "boss" ? group.scale * 1.6
    : bossRank === "miniboss" ? group.scale * 1.3
    : group.scale;
  const drawnScale = viewScale * tierSilhouetteScale(group.tier);
  const position = placeOnFlatGround(placement.groundPosition, baseY, drawnScale);
  // Widest ground axis, halved, at the size the creature is actually drawn. Same derivation as
  // `buildEnemyGroup`; null when the caller supplies no box, which leaves the AI on its fallback.
  const box = typeof placement.assetSize === "function"
    ? placement.assetSize(group.assetId)
    : placement.assetSize ?? null;
  const bodyRadius = box ? (Math.max(box.x, box.z) / 2) * drawnScale : null;
  return {
    id: placement.entityId,
    archetype,
    name: group.name,
    tier: group.tier,
    regionId: source.regionId,
    position,
    state: "alive",
    interactions: ["inspect", "attack"],
    combat: {
      health: stats.maxHealth,
      maxHealth: stats.maxHealth,
      // Computed from the stat block, never authored. See `content/index.ts: enemyCombatLevel`.
      level: enemyCombatLevel(stats),
      aggroRadius: stats.aggroRadius,
      ...(stats.moveSpeedMps === undefined ? {} : { moveSpeedMps: stats.moveSpeedMps }),
      ...(stats.walkSpeedMps === undefined ? {} : { walkSpeedMps: stats.walkSpeedMps }),
      ...(bodyRadius === null ? {} : { bodyRadius }),
    },
    view: {
      assetId: group.assetId,
      scale: viewScale,
      rotationY: round2(placement.rotationY ?? 0),
      materialTier: group.tier,
      labelHeight: bossRank !== null ? 3.4 : 2.2,
    },
    meta: {
      family: group.family,
      enemyDefId: stats.id,
      groupId: group.id,
      behaviour: stats.behaviour,
      spawnX: round2(position[0]),
      spawnZ: round2(position[2]),
      ...(bossRank === null ? {} : { rank: bossRank }),
    },
  };
}

function targetKey(preset: Pick<FeatureLabPreset, "kind" | "id">): string {
  return `${preset.kind}:${preset.id}`;
}

function placeOnFlatGround(ground: Vec3, baseY: number, drawnScale: number): Vec3 {
  return [ground[0], round2(ground[1] - baseY * drawnScale), ground[2]];
}

function titleCaseIdentifier(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replaceAll("_", " ");
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assertFiniteVec3(label: string, value: Vec3): void {
  for (const coordinate of value) assertFinite(label, coordinate);
}

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
