import { RPG_BESTIARY_BY_ID } from "./rpgBestiary.js";
import { enemyCombatLevel } from "./index.js";
import {
  REGIONAL_PACKS, REGIONAL_PACK_VARIANTS, type RegionalPackDef, type RegionalPackRegionId,
  type RegionalPackVariant,
} from "./regionalPacks.js";
import { tierSilhouetteScale } from "../core/math.js";
import { hashId } from "../world/habitatMovement.js";
import { REGIONAL_PACK_LAYOUT } from "./regionalPackLayout.js";
import type { RegionalPackCatalogue } from "../world/regionalPackEntities.js";

/** Stable setting IDs keep their existing coordinates and member save identities. Null retains
 * the wildlife already authored there. These assignments stage RPG occupants, not public assets. */
const assignments: Readonly<Record<RegionalPackRegionId, readonly (string | null)[]>> = {
  fallowmarch: [
    "goblin_archer", "goblin_scout", null, "goblin_scout", "goblin_shaman", "goblin_archer",
    "zombie", "goblin_shaman", "goblin_scout", "goblin_scout", "goblin_scout", null,
    null, "goblin_scout", "goblin_archer", null, "zombie", "zombie", "goblin_scout",
    null, "goblin_archer", "zombie", "goblin_scout", "goblin_shaman",
  ],
  vellenwood: [
    "skeleton_soldier", null, "skeleton_soldier", "skeleton_archer", "grave_ghoul", null,
    "skeleton_soldier", "grave_ghoul", "wraith", "skeleton_archer", "wraith", "skeleton_archer",
    "skeleton_soldier", null, "wraith", "wraith", "skeleton_soldier", "wraith", null,
    "wraith", "grave_ghoul", "skeleton_archer", "skeleton_archer", "skeleton_soldier",
  ],
  karrowmoor: [
    "stone_golem", "iron_golem", "iron_golem", "stone_golem", "iron_golem", "stone_golem",
    null, "stone_golem", "stone_golem", "iron_golem", null, "stone_golem",
    "stone_golem", "iron_golem", "iron_golem", null, "stone_golem", "iron_golem",
    "iron_golem", null, "iron_golem", "stone_golem", "stone_golem", "stone_golem",
  ],
  kilnhalt: [
    "skeleton_mage", "skeleton_mage", "revenant", "plague_zombie", "skeleton_mage", "revenant",
    "fire_golem", "banshee", "fire_golem", null, "revenant", "skeleton_mage",
    "skeleton_mage", "skeleton_mage", "banshee", null, "fire_golem", "skeleton_mage",
    "skeleton_mage", "revenant", "plague_zombie", "banshee", "revenant", "revenant",
  ],
};

/** Proposed inhabitants using promoted complete bodies. Population remains gated at root boot.
 * Named pockets preserve their authored setting and all saved member identities. */
export const RPG_ACCEPTED_SOURCE_PACK_ASSIGNMENTS: Readonly<Record<string, { speciesId: string; reason: string }>> = {
  pack_vellenwood_rootfall_south_stump_hollow: { speciesId: "mossback_sentinel", reason: "An undressed old woodland hollow around the stump." },
  pack_vellenwood_gorge_watch_northeast_roots: { speciesId: "beetle_golem", reason: "Armoured guardians occupy the existing weathered burial ruin." },
  pack_karrowmoor_outer_tarn_track_nightmares: { speciesId: "shale_elemental", reason: "Exposed stone workings beside the outer tarn track." },
  pack_karrowmoor_ridge_south_nightmares: { speciesId: "shale_elemental", reason: "A bare stone perch and fallen slab on the southern ridge." },
  pack_kilnhalt_clinker_southern_approach_west: { speciesId: "lava_golem", reason: "Cooling volcanic stone inhabits the large ruined approach court." },
  pack_vellenwood_marchgate_south_bramble: { speciesId: "webweaver_spider", reason: "Undressed bramble shelter beside the woodland approach." },
  pack_vellenwood_mossbound_west_bramble: { speciesId: "marsh_wasp", reason: "Open circulation around an undressed damp woodland margin." },
};

export const RPG_REGIONAL_PACK_PLAN = REGIONAL_PACKS.map((pack) => {
  const regionalIndex = REGIONAL_PACKS.filter((row) => row.regionId === pack.regionId).findIndex((row) => row.id === pack.id);
  return { packId: pack.id, speciesId: RPG_ACCEPTED_SOURCE_PACK_ASSIGNMENTS[pack.id]?.speciesId ?? assignments[pack.regionId][regionalIndex] ?? null };
});

/** Explicit species replacements keep placement independent of an evolving art roster.
 * Missing keys retain the staged assignment; null restores the original wildlife inhabitants.
 * A replacement must still satisfy region, measured body bounds and production navigation gates. */
export type RpgPackAssignmentOverrides = Readonly<Record<string, string | null>>;
export function regionalPackReplacements(
  replacements: Readonly<Record<string, string | null>>,
): RpgPackAssignmentOverrides {
  const known = new Set(RPG_REGIONAL_PACK_PLAN.flatMap(row => row.speciesId ? [row.speciesId] : []));
  for (const id of Object.keys(replacements)) if (!known.has(id)) throw new Error(`Unknown staged species replacement: ${id}`);
  return Object.fromEntries(RPG_REGIONAL_PACK_PLAN
    .filter(row => row.speciesId && Object.hasOwn(replacements, row.speciesId))
    .map(row => [row.packId, replacements[row.speciesId!]!]));
}

export interface RpgPackModelMeasurement {
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly base: { readonly x: number; readonly y: number; readonly z: number };
}

/** Build only with real candidate or promoted GLB measurements. This intentionally fails on
 * missing models and unsafe formations. Root registers the returned stats/habitats together,
 * proves the pack fixture, then audits the generated world before population registration. */
export function createRpgRegionalPackCatalogue(
  measurement: (assetId: string) => RpgPackModelMeasurement | null,
  /** A compact candidate lab can load one pack without requiring every unreviewed model. */
  packIds?: readonly string[],
  assignmentOverrides: RpgPackAssignmentOverrides = {},
): RegionalPackCatalogue {
  if (packIds?.some((id) => !REGIONAL_PACKS.some((pack) => pack.id === id)))
    throw new Error("Unknown RPG regional pack selection");
  for (const id of Object.keys(assignmentOverrides)) if (!REGIONAL_PACKS.some(pack => pack.id === id))
    throw new Error(`Unknown RPG regional pack assignment: ${id}`);
  const variants = new Map<string, RegionalPackVariant>();
  const legacyVariants = new Map(REGIONAL_PACK_VARIANTS.map((row) => [row.id, row]));
  const packs: RegionalPackDef[] = REGIONAL_PACKS.filter((pack) => !packIds || packIds.includes(pack.id)).map((original) => {
    const speciesId = Object.hasOwn(assignmentOverrides, original.id) ? assignmentOverrides[original.id]
      : RPG_REGIONAL_PACK_PLAN.find((row) => row.packId === original.id)!.speciesId;
    if (!speciesId) {
      for (const member of original.members) variants.set(member.variantId, legacyVariants.get(member.variantId)!);
      return original;
    }
    const species = RPG_BESTIARY_BY_ID.get(speciesId);
    if (!species || species.regionId !== original.regionId) throw new Error(`Invalid RPG pack species: ${speciesId}`);
    const model = measurement(species.assetId);
    if (!model || !Object.values(model.size).every((value) => Number.isFinite(value) && value > 0)
      || !Object.values(model.base).every(Number.isFinite)) throw new Error(`RPG pack requires measured model: ${species.assetId}`);
    const maxScale = species.scale * tierSilhouetteScale(species.stats.tier) * 1.04;
    const bodyRadius = Math.max(model.size.x, model.size.z) * maxScale / 2;
    const visualRadius = Math.hypot(
      Math.max(Math.abs(model.base.x), Math.abs(model.base.x + model.size.x)),
      Math.max(Math.abs(model.base.z), Math.abs(model.base.z + model.size.z)),
    ) * maxScale;
    const ring = original.radius - visualRadius - 0.6;
    if (ring <= 0) throw new Error(`RPG pack model exceeds habitat: ${original.id}/${speciesId}`);
    const phase = (hashId(original.id) % 360) * Math.PI / 180;
    const anchors = original.members.map((_, index) => {
      const angle = phase + index * Math.PI * 2 / original.members.length;
      return [original.centre[0] + Math.cos(angle) * ring, original.centre[1] + Math.sin(angle) * ring] as const;
    });
    for (let a = 0; a < anchors.length; a++) for (let b = a + 1; b < anchors.length; b++) {
      if (Math.hypot(anchors[a]![0] - anchors[b]![0], anchors[a]![1] - anchors[b]![1]) < bodyRadius * 2 + 0.3)
        throw new Error(`RPG pack bodies overlap: ${original.id}/${speciesId}; author a larger pocket or smaller resident count`);
    }
    const members = original.members.map((member, index) => {
      const step = index === original.members.length - 1 ? 2 : index === 1 ? 1 : 0;
      const rank = (["ordinary", "seasoned", "mature"] as const)[step]!;
      const id = `${species.stats.id}_pack_${rank}`;
      variants.set(id, { id, baseEnemyDefId: species.stats.id, rank, scaleMultiplier: 1 + step * 0.02,
        stats: { ...species.stats, id,
          maxHealth: Math.max(species.stats.maxHealth + step, Math.round(species.stats.maxHealth * (1 + step * 0.06))),
          attackLevel: species.stats.attackLevel + step, defenceLevel: species.stats.defenceLevel + step,
        } });
      return { ...member, variantId: id };
    });
    const levels = members.map((member) => enemyCombatLevel(variants.get(member.variantId)!.stats));
    return { ...original, speciesId, baseGroupId: `${speciesId}_residents`, baseEnemyDefId: species.stats.id,
      assetId: species.assetId, scale: species.scale, activity: species.activity, anchors, members,
      rationale: `${species.stats.name} residents require ${species.habitat}. ${REGIONAL_PACK_LAYOUT[original.id]!.purpose}`,
      placementRisks: [...original.placementRisks, "RPG models and encounter dressing are candidates until production lab acceptance."],
      levelRange: [Math.min(...levels), Math.max(...levels)],
    };
  });
  return {
    packs, variants: [...variants.values()],
    groups: packs.map((pack) => {
      const stats = variants.get(pack.members[0]!.variantId)!.stats;
      return { id: pack.id, family: stats.family, name: stats.name, tier: stats.tier,
        count: pack.members.length, centre: pack.centre, radius: pack.radius, assetId: pack.assetId, scale: pack.scale };
    }),
    habitats: packs.map((pack) => ({ id: `${pack.id}_habitat`, groupId: pack.id, regionId: pack.regionId,
      centre: pack.centre, radius: pack.radius, anchors: pack.anchors, activity: pack.activity,
      dressing: REGIONAL_PACK_LAYOUT[pack.id]!.dressing })),
  };
}
