import { RPG_BESTIARY_BY_ID } from "./rpgBestiary.js";
import { CREATURE_SPECIES } from "./creatureSpecies.js";
import { enemyCombatLevel } from "./index.js";
import {
  REGIONAL_PACKS, REGIONAL_PACK_VARIANTS, type RegionalPackDef, type RegionalPackRegionId,
  type RegionalPackVariant,
} from "./regionalPacks.js";
import { tierSilhouetteScale } from "../core/math.js";
import { hashId } from "../world/habitatMovement.js";
import { REGIONAL_PACK_LAYOUT } from "./regionalPackLayout.js";
import type { RegionalPackCatalogue } from "../world/regionalPackEntities.js";
import { createEncounterFormation, encounterPopulationCount, EncounterFormationError } from "./encounterPopulation.js";
import type { EnemyGroupDef } from "./regions.js";

/** Stable setting IDs keep their existing coordinates and member save identities. Null retains
 * the wildlife already authored there. These assignments stage RPG occupants, not public assets. */
const assignments: Readonly<Record<RegionalPackRegionId, readonly (string | null)[]>> = {
  fallowmarch: [
    "goblin_archer", "grass_viper", null, "goblin_scout", "goblin_shaman", "field_wasp",
    "creek_crab", "briar_spider", "granary_rat", "grass_viper", "granary_rat", null,
    null, "field_wasp", "granary_rat", null, "briar_spider", "grass_viper", "granary_rat",
    null, "creek_crab", "creek_crab", "field_wasp", "briar_spider",
  ],
  vellenwood: [
    "webweaver_spider", null, "skeleton_soldier", "duskoak_lynx", "marsh_wasp", null,
    "rootdelve_badger", "grave_ghoul", "wraith", "skeleton_archer", "bracken_tapir", "marsh_wasp",
    "skeleton_soldier", null, "webweaver_spider", "wraith", "rootdelve_badger", "marsh_wasp", null,
    "duskoak_lynx", "grave_ghoul", "webweaver_spider", "skeleton_archer", "bracken_tapir",
  ],
  karrowmoor: [
    "stone_golem", "quillback_porcupine", "iron_golem", "slateback_tortoise", "cairn_bighorn", "stone_golem",
    null, "antler_beetle", "stone_golem", "slateback_tortoise", null, "quillback_porcupine",
    "stone_golem", "iron_golem", "slateback_tortoise", null, "cairn_bighorn", "antler_beetle",
    "iron_golem", null, "quillback_porcupine", "stone_golem", "slateback_tortoise", "cairn_bighorn",
  ],
  kilnhalt: [
    "skeleton_mage", "kiln_salamander", "revenant", "plague_zombie", "gorge_mantis", "cinder_ravager",
    "fire_golem", "banshee", "basalt_drake", null, "revenant", "kiln_salamander",
    "skeleton_mage", "gorge_mantis", "banshee", null, "fire_golem", "slag_centipede",
    "kiln_salamander", "revenant", "plague_zombie", "banshee", "cinder_ravager", "basalt_drake",
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

function requireMeasurement(assetId: string, measurement: (assetId: string) => RpgPackModelMeasurement | null): RpgPackModelMeasurement {
  const model = measurement(assetId);
  if (!model || !Object.values(model.size).every(value => Number.isFinite(value) && value > 0)
    || !Object.values(model.base).every(Number.isFinite)) throw new Error(`RPG pack requires measured model: ${assetId}`);
  return model;
}

/** Root-relative bounds cover an offset tail or shell at every facing direction. */
function measuredRadius(model: RpgPackModelMeasurement, sx = 1, sz = sx): number {
  return Math.hypot(
    Math.max(Math.abs(model.base.x), Math.abs(model.base.x + model.size.x)) * sx,
    Math.max(Math.abs(model.base.z), Math.abs(model.base.z + model.size.z)) * sz,
  );
}

/** Existing assignments still decide which pockets have props. Population changes never add them. */
function packDressing(pack: RegionalPackDef) {
  return CREATURE_SPECIES.some(row => row.id === pack.speciesId) ? [] : REGIONAL_PACK_LAYOUT[pack.id]!.dressing;
}

function populatePack(pack: RegionalPackDef, variants: Map<string, RegionalPackVariant>,
  measurement: (assetId: string) => RpgPackModelMeasurement | null): RegionalPackDef {
  const stats = variants.get(pack.members[0]!.variantId)!.stats;
  const group: EnemyGroupDef = { id: pack.id, family: stats.family, name: stats.name, tier: stats.tier,
    count: pack.members.length, centre: pack.centre, radius: pack.radius, assetId: pack.assetId, scale: pack.scale };
  const model = requireMeasurement(pack.assetId, measurement);
  const maxScale = Math.max(...pack.members.map(member => {
    const variant = variants.get(member.variantId)!;
    return pack.scale * tierSilhouetteScale(variant.stats.tier) * variant.scaleMultiplier;
  }));
  // The activity circuit can move a resident 45cm off its anchor. Both moving bodies need that
  // allowance, in addition to the shared formation gap, rather than just protecting their roots.
  const bodyRadius = measuredRadius(model, maxScale) + .45;
  const occupied = packDressing(pack).map(piece => {
    const prop = requireMeasurement(piece.assetId, measurement);
    const sx = typeof piece.scale === "number" ? piece.scale : piece.scale[0];
    const sz = typeof piece.scale === "number" ? piece.scale : piece.scale[2];
    // A root-relative circle includes the complete rotated prop, including an offset wall base.
    return { position: [piece.x, piece.z] as const, bodyRadius: measuredRadius(prop, sx, sz) };
  });
  const count = encounterPopulationCount(group);
  const settingRadius = Math.max(0, ...occupied.map(prop =>
    Math.hypot(prop.position[0] - pack.centre[0], prop.position[1] - pack.centre[1]) + prop.bodyRadius + .15));
  const minimumRadius = Math.max(pack.radius, settingRadius);
  if (bodyRadius > pack.radius)
    throw new Error(`RPG pack model or dressing exceeds habitat: ${pack.id}; author a larger pocket`);
  // Fifteen residents fit inside two hexagonal rings. Include the setting's full extent so a
  // large body can route the formation around it. World acceptance owns adjacent reservations.
  const maximumRadius = Math.ceil(Math.max(minimumRadius, bodyRadius * 5 + 1 + settingRadius) * 2) / 2;
  let formation: ReturnType<typeof createEncounterFormation> | undefined;
  // Try the authored reservation first. Half-metre growth stops as soon as the complete pack fits.
  for (let radius = minimumRadius; radius <= maximumRadius + 1e-6; radius += .5) {
    // The sparse old ring can obstruct a safe interior lattice. Prefer existing positions where
    // possible, then repack the same saved IDs before increasing the world reservation.
    for (const preferredAnchors of [pack.anchors, []] as const) {
      try {
        formation = createEncounterFormation(group, { bodyRadius, occupied, count,
          preferredAnchors, maxRadius: radius });
        break;
      } catch (error) {
        if (!(error instanceof EncounterFormationError)) throw error;
        if (radius + .5 > maximumRadius + 1e-6 && preferredAnchors.length === 0) throw error;
      }
    }
    if (formation) break;
  }
  if (!formation) throw new EncounterFormationError(pack.id, count, 0, maximumRadius);
  const ordinary = [...variants.values()].find(variant => variant.baseEnemyDefId === pack.baseEnemyDefId
    && variant.rank === "ordinary");
  if (!ordinary) throw new Error(`RPG pack has no ordinary rank: ${pack.id}`);
  const members = formation.anchors.map((_, index) => pack.members[index]
    ?? { id: formation.actorIds[index]!, anchorIndex: index, variantId: ordinary.id });
  return { ...pack, radius: Math.max(minimumRadius, formation.group.radius), anchors: formation.anchors, members };
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
      return populatePack(original, variants, measurement);
    }
    const species = RPG_BESTIARY_BY_ID.get(speciesId) ?? CREATURE_SPECIES.find(row => row.id === speciesId);
    if (!species || species.regionId !== original.regionId) throw new Error(`Invalid RPG pack species: ${speciesId}`);
    const model = requireMeasurement(species.assetId, measurement);
    const wildlife = CREATURE_SPECIES.some(row => row.id === speciesId);
    const residents = original.members;
    const previousCount = wildlife ? Math.min(3, residents.length) : residents.length;
    const maxScale = species.scale * tierSilhouetteScale(species.stats.tier) * 1.04;
    const visualRadius = measuredRadius(model, maxScale);
    const ring = original.radius - visualRadius - 0.6;
    const phase = (hashId(original.id) % 360) * Math.PI / 180;
    const anchors = ring <= 0 ? [] : Array.from({ length: previousCount }, (_, index) => {
      const angle = phase + index * Math.PI * 2 / previousCount;
      return [original.centre[0] + Math.cos(angle) * ring, original.centre[1] + Math.sin(angle) * ring] as const;
    });
    const members = residents.map((member, index) => {
      // Keep the three already-spawned wildlife ranks, then restore the uncapped source members
      // with their authored ranks. Appended residents below receive the ordinary variant.
      const step = index < previousCount ? (index === previousCount - 1 ? 2 : index === 1 ? 1 : 0)
        : (["ordinary", "seasoned", "mature"] as const).indexOf(legacyVariants.get(member.variantId)!.rank);
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
    return populatePack({ ...original, speciesId, baseGroupId: `${speciesId}_residents`, baseEnemyDefId: species.stats.id,
      assetId: species.assetId, scale: species.scale, activity: species.activity, anchors, members,
      rationale: `${species.description} ${wildlife ? "An undressed creature pocket." : REGIONAL_PACK_LAYOUT[original.id]!.purpose}`,
      placementRisks: [...original.placementRisks, "RPG models and encounter dressing are candidates until production lab acceptance."],
      levelRange: [Math.min(...levels), Math.max(...levels)],
    }, variants, measurement);
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
      dressing: packDressing(pack) })),
  };
}
