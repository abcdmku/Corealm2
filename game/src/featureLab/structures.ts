import { ROOTFALL_STUMP } from "../world/rootfallStump.js";
import type {
  FeatureLabCatalog,
  FeatureLabStructureKit,
  FeatureLabStructureKind,
  FeatureLabStructureSelection,
  RegionId,
  SemanticEntity,
  SolidVolume,
  Vec3,
} from "../contracts.js";
import { REGIONS } from "../content/regions.js";
import {
  BUILDING_KITS,
  COMPOSITION_IDS,
  KIT_IDS,
  PREFAB_IDS,
  STOREY_METRES,
  buildComposition,
  buildPrefab,
  buildWallRun,
  prefabCollision,
  prefabHeight,
  wallRunCollision,
  variantSeed,
  type CompositionId,
  type PartPlacement,
  type PrefabId,
} from "../render/buildings.js";
import { selectedStructureVariantId } from "../render/structures/catalog.js";
import {
  structureCollisionFromCompositionParts,
  structureCollisionFromAsset,
  structureCollisionFromBoxes,
  structureEntitiesFromParts,
  type StructureAssetMeasurements,
  type BuildingBox,
} from "../world/regionBuilder.js";

export interface FeatureLabStructureMeasurements extends StructureAssetMeasurements {
  readonly baseY: (assetId: string) => number;
}

export interface CompositionHero {
  readonly assetId: string;
  readonly scale: number;
  readonly clipFraction?: number;
  readonly solid: boolean;
}

const STRUCTURE_OWNER_ID = "feature-lab:structure";
const MIN_SIZE_METRES = 2;
const MAX_SIZE_METRES = 30;
const MAX_SEED = 0xffff_ffff;

const DEFAULT_FOOTPRINTS: Readonly<Record<PrefabId, readonly [number, number]>> = {
  cottage: [6, 4],
  townhouse: [6, 4],
  hall: [12, 6],
  tower: [6, 6],
  // 3 x 2, not 4 x 3. No settlement places a `stall` building, so this default IS the footprint the
  // prefab is ever built at - and `structures/stall.ts:fitsStall` admits width 3..3.5 and depth up
  // to 2.5, which is the pitch the recipe's own +-1.1 / +-0.9 prop offsets are authored for. At
  // 4 x 3 `structureVariantCount("stall", ...)` returned 0 for all three kits and every one of the
  // six stall recipes was unreachable.
  stall: [3, 2],
  wall_segment: [8, 2],
  gatehouse: [8, 4],
  shed: [4, 4],
  ruin: [6, 4],
  quarry_hut: [6, 4],
  forge: [6, 5],
  porch: [4, 3],
  arcade: [6, 3],
  market_row: [9, 3],
  well: [2, 2],
  farmstead: [10, 6],
};

const KIT_CONTEXT: Readonly<Record<FeatureLabStructureKit, {
  readonly regionId: RegionId;
  readonly tier: number;
}>> = {
  plaster: { regionId: "fallowmarch", tier: 1 },
  timber: { regionId: "vellenwood", tier: 2 },
  stone: { regionId: "karrowmoor", tier: 3 },
};

export const DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION: FeatureLabStructureSelection = Object.freeze({
  kind: "prefab",
  id: "cottage",
  kit: "plaster",
  width: 6,
  depth: 4,
  seed: 0,
});

export const FEATURE_LAB_STRUCTURE_CATALOG: FeatureLabCatalog["structures"] = Object.freeze({
  prefabs: Object.freeze(PREFAB_IDS.map((id) => Object.freeze({ id, label: titleCaseIdentifier(id) }))),
  compositions: Object.freeze(COMPOSITION_IDS.map((id) => Object.freeze({
    id,
    label: titleCaseIdentifier(id),
  }))),
  kits: Object.freeze([
    Object.freeze({ id: "plaster" as const, label: "Farmland plaster" }),
    Object.freeze({ id: "timber" as const, label: "Woodlands timber" }),
    Object.freeze({ id: "stone" as const, label: "Highlands stone" }),
  ]),
});

export interface FeatureLabStructureAssembly {
  readonly selection: FeatureLabStructureSelection;
  readonly variant: string | null;
  readonly entities: SemanticEntity[];
  readonly buildings: BuildingBox[];
  readonly solids: SolidVolume[];
  readonly assetIds: string[];
  readonly focus: Vec3;
}

/** Normalizes browser-controlled structure setup before it reaches production recipes. */
export function sanitizeFeatureLabStructureSelection(
  candidate: Partial<FeatureLabStructureSelection> | null | undefined,
): FeatureLabStructureSelection {
  const kind = structureKind(candidate?.kind);
  const id = structureId(kind, candidate?.id);
  const fallbackFootprint = kind === "prefab"
    ? DEFAULT_FOOTPRINTS[id as PrefabId]
    : kind === "wall-run" ? [18, 4] as const : [6, 4] as const;
  const width = kind === "wall-run"
    ? wallModuleSize(candidate?.width, fallbackFootprint[0], 6, MAX_SIZE_METRES)
    : structureSize(candidate?.width, fallbackFootprint[0]);
  const depth = kind === "wall-run"
    ? wallModuleSize(candidate?.depth, fallbackFootprint[1], 2, width - 4)
    : structureSize(candidate?.depth, fallbackFootprint[1]);

  return {
    kind,
    id,
    kit: structureKit(candidate?.kit),
    width,
    depth,
    seed: structureSeed(candidate?.seed),
  };
}

/**
 * Assembles one selectable lab structure through the same recipes, semantic entities, palette data,
 * and collision transforms used by the authored world.
 */
export function assembleFeatureLabStructure(
  selection: FeatureLabStructureSelection,
  origin: Vec3,
  measurements?: FeatureLabStructureMeasurements,
): FeatureLabStructureAssembly {
  const sanitized = sanitizeFeatureLabStructureSelection(selection);
  const context = KIT_CONTEXT[sanitized.kit];
  const name = titleCaseIdentifier(sanitized.id);
  const placementOrigin: Vec3 = sanitized.kind === "wall-run"
    ? [origin[0] - sanitized.width / 2, origin[1], origin[2]]
    : [...origin];
  const parts = buildFeatureLabStructureParts(sanitized);
  const entities = structureEntitiesFromParts(parts, {
    origin: placementOrigin,
    rotationY: 0,
    regionId: context.regionId,
    tier: context.tier,
    ownerId: STRUCTURE_OWNER_ID,
    name,
    meta: {
      scenery: true,
      featureLab: true,
      structureKind: sanitized.kind,
      structureId: sanitized.id,
    },
  });
  if (sanitized.kind === "composition" && sanitized.id === "vault_door") {
    const host = vaultHost();
    for (const entity of entities.filter(entity => entity.id.includes("#host_"))) {
      entity.regionId = host.region.id;
      entity.tier = host.region.tier;
      if (entity.view) entity.view = {...entity.view, materialTier:host.region.tier};
      entity.meta = {...entity.meta, buildingId:host.building.id, compositionHost:true};
    }
  }
  if (sanitized.kind === "composition" && sanitized.id === "essence_altar_ruins") {
    for (const entity of entities) {
      if (entity.view?.assetId === "altar_ruins_site") {
        entity.state = "dormant";
        entity.meta = {
          ...(entity.meta ?? {}),
          essenceAltarRuins: true,
          essenceAltarId: STRUCTURE_OWNER_ID,
          essenceElement: "wind",
        };
        continue;
      }
      if (entity.view?.assetId !== "rocks_free_essence_node") continue;
      entity.archetype = "ore";
      entity.name = "Air Essence";
      entity.state = "available";
      entity.interactions = ["inspect", "mine"];
      entity.requirements = { mining: 1 };
      entity.resource = {
        remaining: 12,
        maxYields: 12,
        respawnSeconds: 60,
        itemId: "air_essence",
      };
      entity.meta = {
        ...(entity.meta ?? {}),
        resourceId: "essence_air",
        essenceElement: "wind",
        essenceCache: true,
        featureLab: true,
      };
    }
  }
  const hero = sanitized.kind === "composition" ? compositionHero(sanitized) : null;
  if (hero) {
    entities.unshift(compositionHeroEntity(hero, sanitized, origin, context.regionId, context.tier, name, measurements));
  }

  const collision = collisionFor(
    sanitized, parts, placementOrigin, context.regionId, name, hero, measurements,
  );
  const variant = sanitized.kind === "prefab"
    ? selectedStructureVariantId(
      sanitized.id as PrefabId,
      [sanitized.width, sanitized.depth],
      sanitized.seed,
      BUILDING_KITS[sanitized.kit],
    ) ?? "classic"
    : null;

  return {
    selection: sanitized,
    variant,
    entities,
    buildings: collision.buildings,
    solids: collision.solids,
    assetIds: [...new Set([
      ...parts.map((part) => part.assetId),
      ...(hero ? [hero.assetId] : []),
    ])].sort(),
    focus: [origin[0], round2(origin[1] + focusHeight(sanitized, parts) / 2), origin[2] + (sanitized.kind === "composition" && sanitized.id === "vault_door" ? vaultHost().offset[2] / 2 : 0)],
  };
}

/** Exact selectable production parts, including a composition's authored structural host. */
export function buildFeatureLabStructureParts(selection: FeatureLabStructureSelection): PartPlacement[] {
  if (selection.kind === "prefab") {
    return buildPrefab(
      selection.id as PrefabId,
      [selection.width, selection.depth],
      selection.seed,
      selection.kit,
    );
  }
  if (selection.kind === "composition") {
    return [...buildComposition(selection.id as CompositionId, selection.seed, selection.kit), ...compositionHostParts(selection)];
  }
  return buildWallRun(
    selection.width,
    [{ at: selection.width / 2, width: Math.min(selection.depth, selection.width) }],
    BUILDING_KITS[selection.kit],
    selection.seed,
  );
}

/** Resolve the real tower relative to its south-facing landmark, preserving its authored seed. */
function vaultHost() {
  const region = REGIONS.find(region => region.settlement.buildings.some(building => building.id === "coldbrace_vault"));
  const building = region?.settlement.buildings.find(building => building.id === "coldbrace_vault");
  const landmark = region?.landmarks.find(landmark => landmark.id === "march_vault_tower");
  if (!region || !building || !landmark) throw new Error("Vault fixture requires authored coldbrace_vault and march_vault_tower");
  const yaw = landmark.rotationY ?? 0;
  const dx = building.position[0] - landmark.position[0];
  const dz = building.position[1] - landmark.position[1];
  const offset: Vec3 = [dx * Math.cos(yaw) - dz * Math.sin(yaw), 0, dx * Math.sin(yaw) + dz * Math.cos(yaw)];
  return {region, building, offset, rotationY:building.rotationY - yaw};
}

/** Native host geometry is shared with review fingerprints instead of hidden camera-only props. */
export function compositionHostParts(selection: FeatureLabStructureSelection): PartPlacement[] {
  if (selection.kind !== "composition" || selection.id !== "vault_door") return [];
  const host = vaultHost();
  const cos = Math.cos(host.rotationY); const sin = Math.sin(host.rotationY);
  return buildPrefab(host.building.prefab, host.building.footprint, variantSeed(host.building.id), host.region.settlement.kit).map(part => ({
    ...part, tag:`host_${part.tag}`,
    dx:host.offset[0] + part.dx*cos + part.dz*sin,
    dz:host.offset[2] - part.dx*sin + part.dz*cos,
    rotationY:part.rotationY + host.rotationY,
  }));
}

function collisionFor(
  selection: FeatureLabStructureSelection,
  parts: readonly PartPlacement[],
  origin: Vec3,
  regionId: RegionId,
  name: string,
  hero: CompositionHero | null,
  measurements?: FeatureLabStructureMeasurements,
): { buildings: BuildingBox[]; solids: SolidVolume[] } {
  if (selection.kind === "composition") {
    const solids = measurements
      ? structureCollisionFromCompositionParts(
          selection.id as CompositionId,
          parts.filter(part => !part.tag.startsWith("host_")),
          { origin, rotationY: 0, ownerId: STRUCTURE_OWNER_ID },
          measurements,
        )
      : [];
    if (hero?.solid && measurements) {
      const heroPosition: Vec3 = [
        origin[0],
        round2(origin[1] - measurements.baseY(hero.assetId) * hero.scale),
        origin[2],
      ];
      const heroSolid = structureCollisionFromAsset(
        STRUCTURE_OWNER_ID,
        heroPosition,
        hero.assetId,
        hero.scale,
        0,
        true,
        measurements,
      );
      if (heroSolid) solids.unshift(heroSolid);
    }
    if (selection.id === "vault_door") {
      const host = vaultHost();
      const hostCollision = structureCollisionFromBoxes(prefabCollision(host.building.prefab, host.building.footprint), {
        origin:[origin[0]+host.offset[0],origin[1],origin[2]+host.offset[2]],
        rotationY:host.rotationY,regionId:host.region.id,ownerId:`${STRUCTURE_OWNER_ID}:host`,
        name:host.building.name,prefab:host.building.prefab,
      });
      return {buildings:hostCollision.buildings,solids:[...solids,...hostCollision.solids]};
    }
    return {buildings:[],solids};
  }

  const prefab = selection.kind === "prefab" ? selection.id as PrefabId : "wall_segment";
  const boxes = selection.kind === "prefab"
    ? prefabCollision(prefab, [selection.width, selection.depth])
    : wallRunCollision(
      selection.width,
      [{ at: selection.width / 2, width: Math.min(selection.depth, selection.width) }],
    );
  return structureCollisionFromBoxes(boxes, {
    origin,
    rotationY: 0,
    regionId,
    ownerId: STRUCTURE_OWNER_ID,
    name,
    prefab,
  });
}

function compositionHeroEntity(
  hero: CompositionHero,
  selection: FeatureLabStructureSelection,
  origin: Vec3,
  regionId: RegionId,
  tier: number,
  name: string,
  measurements?: FeatureLabStructureMeasurements,
): SemanticEntity {
  const view: NonNullable<SemanticEntity["view"]> = {
    assetId: hero.assetId,
    scale: hero.scale,
    rotationY: 0,
    materialTier: tier,
    labelHeight: 3.4,
  };
  if (hero.clipFraction !== undefined) view.clipFraction = hero.clipFraction;
  if (selection.id === "essence_altar_ruins") {
    return {
      id: STRUCTURE_OWNER_ID,
      archetype: "station",
      name: "Air Essence Altar",
      tier: 1,
      regionId: "fallowmarch",
      position: [
        origin[0],
        round2(origin[1] - (measurements?.baseY(hero.assetId) ?? 0) * hero.scale),
        origin[2],
      ],
      state: "dormant",
      interactions: ["inspect", "awaken"],
      station: {
        kind: "essence_altar",
        skill: "magic",
        recipeIds: ["craft_air_wand", "craft_air_staff"],
      },
      view: { ...view, labelHeight: 1.6, materialTier: 1 },
      meta: {
        featureLab: true,
        compositionHero: true,
        structureKind: selection.kind,
        structureId: selection.id,
        essenceAltar: true,
        essenceElement: "wind",
        stationKind: "essence_altar",
      },
    };
  }
  return {
    id: STRUCTURE_OWNER_ID,
    archetype: "landmark",
    name,
    tier,
    regionId,
    position: [
      origin[0],
      round2(origin[1] - (measurements?.baseY(hero.assetId) ?? 0) * hero.scale),
      origin[2],
    ],
    state: "present",
    interactions: [],
    view,
    meta: {
      scenery: true,
      featureLab: true,
      compositionHero: true,
      structureKind: selection.kind,
      structureId: selection.id,
    },
  };
}

/** The actual semantic anchor paired with each production dressing recipe. */
export function compositionHero(selection: FeatureLabStructureSelection): CompositionHero | null {
  const fixed: Partial<Record<CompositionId, CompositionHero>> = {
    essence_altar_ruins: { assetId: "altar_ruins_altar", scale: 1, solid: true },
    vault_door: { assetId: "door_frame_round", scale: 1.5, solid: true },
    milestone: { assetId: "wall_brick_straight", scale: 0.7, solid: true },
    highcairn_crane: { assetId: "corner_wood", scale: 3.2, solid: true },
    gravelmaw_mouth: { assetId: "wall_brick_door", scale: 3, solid: false },
    gravelmaw_exit: { assetId: "wall_brick_door", scale: 2.2, solid: false },
    great_cairn: { assetId: "rock_medium_2", scale: 1.8, solid: true },
    // Must track content/regions.ts: the world moved off `boulder_medium` because it is one of
    // the six untextured platformer rocks and drew as a smooth tan cone.
    standing_stones: { assetId: "rock_medium_2", scale: 1.35, solid: true },
    rootfall_stump: {
      assetId: ROOTFALL_STUMP.assetId, scale: ROOTFALL_STUMP.scale, solid: false,
    },
    region_gate: { assetId: "wall_arch", scale: 1.4, solid: false },
    root_tunnel_entrance: { assetId: "wall_arch", scale: 1.2, solid: true },
    canopy_walk_entrance: { assetId: "stairs_exterior", scale: 1.4, solid: true },
    bank_counter: { assetId: "chest_wood", scale: 1, solid: true },
    forge_yard: { assetId: "anvil", scale: 1.4, solid: true },
    market_pitch: { assetId: "market_stall", scale: 1, solid: true },
    farm_yard: { assetId: "farm_crate_empty", scale: 0.8, solid: true },
  };
  if (selection.id === "path_waypoint") {
    return selection.kit === "stone"
      ? { assetId: "corner_brick", scale: 0.85, solid: true }
      : { assetId: "corner_wood", scale: selection.kit === "timber" ? 1 : 0.9, solid: true };
  }
  return fixed[selection.id as CompositionId] ?? null;
}

function focusHeight(selection: FeatureLabStructureSelection, parts: readonly PartPlacement[]): number {
  if (selection.kind === "composition" && selection.id === "vault_door") return prefabHeight(vaultHost().building.prefab);
  if (selection.kind === "prefab") return prefabHeight(selection.id as PrefabId);
  if (selection.kind === "wall-run") return STOREY_METRES;
  let top = 2;
  for (const part of parts) {
    const verticalScale = part.scale * (part.scaleAxes?.[1] ?? 1);
    top = Math.max(top, part.dy + 2 * verticalScale);
  }
  return top;
}

function structureKind(value: FeatureLabStructureKind | undefined): FeatureLabStructureKind {
  return value === "composition" || value === "wall-run" ? value : "prefab";
}

function structureId(kind: FeatureLabStructureKind, value: string | undefined): string {
  if (kind === "prefab") {
    return value !== undefined && (PREFAB_IDS as readonly string[]).includes(value) ? value : "cottage";
  }
  if (kind === "composition") {
    return value !== undefined && (COMPOSITION_IDS as readonly string[]).includes(value) ? value : "region_gate";
  }
  return "wall_run";
}

function structureKit(value: FeatureLabStructureKit | undefined): FeatureLabStructureKit {
  return value !== undefined && (KIT_IDS as readonly string[]).includes(value) ? value : "plaster";
}

function structureSize(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SIZE_METRES, Math.max(MIN_SIZE_METRES, value));
}

/** Wall recipes are authored on the two-metre module grid and retain a module either side. */
function wallModuleSize(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const snapped = Math.round(candidate / 2) * 2;
  return Math.min(max, Math.max(min, snapped));
}

function structureSeed(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_SEED, Math.max(0, Math.floor(value)));
}

function titleCaseIdentifier(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.length === 0 ? normalized : normalized[0]!.toUpperCase() + normalized.slice(1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
