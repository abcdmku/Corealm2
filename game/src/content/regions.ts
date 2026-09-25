/** World geometry and placement projections share one authored source per field. */
import type { BuildingModel, ItemId, QuestId, RecipeId, RegionId, SkillId, StationKind } from "../contracts.js";
import { PLAYER_SPEED } from "../app/config.js";
import {
  KIT_IDS, MODULE_METRES, PREFAB_IDS, compositionPartAssetIds, isKitId, isPrefabId, prefabPartAssetIds,
  type KitId, type PrefabId,
} from "../render/buildings.js";
import { COMPOSITION_IDS, isCompositionId, type CompositionId } from "../render/compositionIds.js";

import { resourceDef } from './resources.js';
import { WORLD_REGION_GEOMETRY, WORLD_CONTENT, RESOURCE_PLACEMENTS } from './worldData.js';
import { WILDERNESS_DEPTH } from './wildernessDepth.js';

export type Spot = readonly [number, number];

export interface RegionBounds {
  min: Spot;
  max: Spot;
}

export type LocationKind =
  | "settlement" | "bank" | "seam" | "grove" | "water"
  | "gate" | "landmark" | "camp" | "junction" | "dungeon";

/**
 * A named place. Every location with `routeNode: true` becomes a node in the route graph that
 * `Navigation.planRoute` runs Dijkstra over, and an id an agent can pass to
 * `moveTo({ locationId })`. Ids match the PRD's screenshot pose names where one exists.
 */
export interface LocationDef {
  id: string;
  name: string;
  position: Spot;
  kind: LocationKind;
  routeNode: boolean;
  /** One line for the Locations journal and for `searchDocs`. */
  blurb?: string;
}

/** A walkable link between two locations in the same region. Cost is derived from the positions. */
export interface RoadDef {
  from: string;
  to: string;
  /** Overrides the straight-line cost when the authored road is longer than the crow flies. */
  meters?: number;
}

export interface ResourceClusterDef {
  /** Fish in existing water instead of creating another basin at the cluster centre. */
  waterBodyId?: string;
  id: string;
  /** Canonical gatherable definition. Clusters own placement, not gameplay or presentation data. */
  resourceId: string;
  /** How many nodes to place. Positions come from a deterministic spiral plus seeded jitter. */
  count: number;
  centre: Spot;
  radius: number;
  /** Places every node on this ring instead of the filled spiral. Used around altar courts. */
  ringRadius?: number;
  /** Optional one-off centrepiece used by index 0; remaining nodes use the resource presentation. */
  heroAssetId?: string;
  /** Optional centrepiece scale; satellite size comes from the resource presentation. */
  heroScale?: number;
  /** Marks an essence cache for element-aware materials and inspection. */
  essenceElement?: import("../contracts.js").SpellElement;
  /** The route-graph node a player banks against when working this cluster. */
  locationId: string;
}

/**
 * Re-exported rather than declared, because there were two of these and only one could be right.
 *
 * `render/buildings.ts` owns the union: it is the file that has to have a `buildPrefab` branch, a
 * `prefabHeight` and a `prefabCollision` for every member, so a name it does not know is a name
 * nothing can draw. This file used to declare its own copy, which was a strict subset — so the five
 * prefabs added for the settlement work (`forge`, `porch`, `arcade`, `market_row`, `well`) existed,
 * were dispatched by `world/regionBuilder.ts`, and could not be named by any settlement without a
 * type error. `CompositionId` was already imported from the same place; this makes the pair
 * consistent.
 */
export type { PrefabId };

/** A building placement uses modular parts or a complete model with measured collision. */
export interface BuildingDef {
  id: string;
  name: string;
  prefab: PrefabId;
  /** Replaces the modular prefab with one complete authored model. */
  model?: BuildingModel;
  position: Spot;
  rotationY: number;
  /** Footprint in metres, used for scatter exclusion and collision boxes. */
  footprint: readonly [number, number];
}

/**
 * How close a thing has to be to whatever it says it is `attachedTo` before `validateRegions`
 * calls it a lie. Metres, measured to the *edge* of the attachment (a building's footprint
 * rectangle, a wall run's centreline, a prop's origin), not to its centre.
 *
 * 3 m is the diagnosis's number and it clears the layouts it was chosen for with a metre to spare.
 * Checked against the replacement layouts in
 * runs/corealm/diagnosis/settlement-layout-coldbrace-rootfall-hig.md using this exact metric: the
 * Coldbrace furnace and anvil and the Highcairn anvil measure 0.0 m (they stand inside their
 * forge's 6x5 footprint), the Rootfall smith's pitch measures 0.5 m, the Coldbrace bank counter
 * 1.4 m off the vault tower, and the worst case is the Coldbrace smith's cart in front of its
 * forge at 2.0 m.
 */
export const ATTACHMENT_MARGIN_METRES = 3;

export interface StationDef {
  id: string;
  name: string;
  kind: StationKind;
  skill: SkillId;
  position: Spot;
  rotationY: number;
  assetId: string;
  scale?: number;
  /** Filled in by round 3's `content/recipes.ts`. Empty here on purpose. */
  recipeIds: RecipeId[];
  /** Present only on a regional Essence Altar. */
  essenceElement?: import("../contracts.js").SpellElement;
  /**
   * The `BuildingDef.id`, `WallRunDef.id` or `PropDef.id` in the same settlement that this station
   * is part of: the forge it stands inside, the lean-to it stands under, the counter it stands
   * behind.
   *
   * This exists so that a claim can be checked. Measured today, all five Coldbrace stations stand
   * loose on grass — the Forge Shed's own door faces south while the furnace and anvil it serves
   * are 6 m away on its north side, and the fletching bench is a 68 cm drawer unit 6 m from
   * anything at all. Naming the structure lets `validateRegions`
   * assert the station is within `ATTACHMENT_MARGIN_METRES` of it, which is what stops the next
   * author dropping an anvil in a field. Optional, because nothing authored today attaches to
   * anything; once a settlement is re-laid out, everything in it should name its structure.
   */
  attachedTo?: string;
}

export interface BankDef {
  id: string;
  name: string;
  position: Spot;
  rotationY: number;
  assetId: string;
  /** See `StationDef.attachedTo`. The bank counter, porch or vault the chest belongs to. */
  attachedTo?: string;
}

export interface ShopDef {
  id: string;
  name: string;
  shopKind: "general" | "smith" | "potion" | "cloth" | "fish" | "meat" | "cosmic";
  position: Spot;
  rotationY: number;
  assetId: string;
  /** See `StationDef.attachedTo`. The arcade, market row or forge the pitch belongs to. */
  attachedTo?: string;
}

export interface NpcStandDef {
  id: string;
  name: string;
  position: Spot;
  facingRad: number;
  assetId: string;
  /** Round 5 (`content/dialogue.ts`) owns the tree behind this id. */
  dialogueRootId: string;
  questIds: QuestId[];
}

/**
 * A gap in a wall run: a gate, a postern, a collapsed span.
 *
 * `at` is metres along the run measured from `from`, at the CENTRE of the gap. `width` is the wall
 * cutout occupied by the whole gate structure, so `{ at: 26, width: 8 }` on a 52 m run leaves wall
 * from 0-22 m and 30-52 m. Author the opening's centre at the gatehouse's own position projected
 * onto the run, and its width at the gatehouse footprint's width, or the arch and the hole in the
 * wall will not line up.
 */
export interface WallOpeningDef {
  /** Metres along the run from `from`, at the centre of the gap. */
  at: number;
  /** Full wall cutout in metres. Rounds outward to whole 2 m modules; there is no half panel. */
  width: number;
}

/**
 * One straight run of town wall, from `from` to `to`, with gates cut out of it.
 *
 * WHY THIS TYPE EXISTS. There was no way to author a wall, only to author individual
 * `wall_segment` buildings with an 8 m footprint. Measured on the current data: Coldbrace has 44 m
 * of wall (four 8 m stubs plus two 6 m gatehouses) on a 212 m circuit — 79% open, largest single
 * gap 46 m, all four corners missing. Highcairn has 30 m of 139 m. Rootfall has none at all and no
 * gate. The stubs are worse than nothing: `getNavPath(144,-40 -> 144,-90)` detours to x = 149.5 to
 * walk around two free-standing panels in open moor. The player's complaint was, verbatim, "a
 * random gate without a wall". Four `WallRunDef`s close a whole circuit in four lines of data.
 *
 * INTENDED EMITTER SEMANTICS, for whoever writes it in `world/regionBuilder.ts`:
 *
 *   length   = spotDistance(from, to)
 *   count    = round(length / MODULE_METRES)      MODULE_METRES is 2, from render/buildings.ts;
 *                                                 author runs as whole multiples of 2 m
 *   module i = centre at (i + 0.5) / count along the run, i in [0, count)
 *   yaw      = atan2(-(to[1] - from[1]), to[0] - from[0])
 *
 * That yaw is the value that maps a part's LOCAL +X onto the run direction under the transform
 * `world = (dx*cos + dz*sin, -dx*sin + dz*cos)` that `regionBuilder.emitParts` applies — the same
 * convention `wallSegment()` in render/buildings.ts already lays its panels out in, which is why
 * `coldbrace_wall_w` at rotationY PI/2 runs north-south.
 *
 * Per kept module the emitter places the settlement kit's `wall` asset and one `wall_bottom_trim`
 * at the same XZ (`wallSegment` offsets the trim by dz 0.01 to stop it z-fighting the panel), and
 * pushes one `BuildingBox` 0.5 m thick along the run's normal and `prefabHeight`-tall — the same
 * 0.5 m the existing `prefabCollision("wall_segment")` uses, because the collider should be as
 * thick as the panel, not as deep as a footprint. `kit.corner` goes at both ends of the run, at
 * `from` and `to` exactly, so two runs meeting at a corner share a post instead of leaving a hole.
 *
 * A module is SKIPPED when its centre distance falls inside `[at - width/2, at + width/2]` of any
 * opening. Skipped modules emit no panel, no trim and no collision box, so the gatehouse standing
 * in the gap is the only thing there.
 *
 * The runs are authored per settlement and are not required to form a closed loop — a town on a
 * cliff edge (Highcairn's south side) may want one run standing on the lip and nothing behind it.
 */
export interface WallRunDef {
  id: string;
  name: string;
  from: Spot;
  to: Spot;
  /** Gates and posterns. Absent or empty means a solid run. */
  openings?: WallOpeningDef[];
}

/**
 * What a settlement paves in. Held as an asset id, and a union of the four floor meshes, because
 * two other systems read the choice: `audio/surface.ts` picks the footstep off it, and a settlement
 * author is genuinely choosing between cobble, brick and plank rather than between three numbers.
 *
 * No instance of these meshes is laid for paving any more. `app/worldSurface.ts` maps the id onto a
 * `PavingSurface` and the ground draws its own courses; see `PavingDef`.
 */
export type PavingAssetId = "floor_cobble" | "floor_brick" | "floor_wood" | "floor_wood_light";

/** An axis-aligned ground rectangle in world metres. */
export interface PavingRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * A paved area: a square, a street, a fork, a yard.
 *
 * WHY THIS TYPE EXISTS. Coldbrace's square is 7,238 m2 of ground with a measured relief of exactly
 * 0.0000 m — `settlementRadius()` flattens a disc and nothing then differentiates it from open
 * grass. There is no texture on the terrain material and the 46 m scatter-exclusion circle in
 * boot.ts forbids a single blade of grass, pebble or flower inside it, so the middle of every town
 * is a plain grey-green field with a bank chest standing alone in it.
 *
 * The rect is STAMPED, not tiled. It used to lay one 2 x 2 m slab per module at ground + 0.02, and
 * a flat slab on ground that is never quite flat floats at one corner, buries itself at the other,
 * and shows a mortar-width of terrain at every seam - which a player called out as tiles thrown on
 * a lawn. The paved surface is now the terrain's own vertex colour, splat weight and course
 * pattern, the same mechanism roads and waterlines use, so it follows the ground exactly, cannot
 * z-fight it, and costs no draw call at all.
 *
 * `kerb` rings the rect with `kerb_straight` (2.00 x 0.134 x 0.70 m, one per module edge, long
 * axis along the edge) and `kerb_corner` (0.70 x 0.13 x 0.70 m, one at each of the four corners).
 * Kerbs are dressing: no collision, or the player trips on a 13 cm lip walking into their own
 * town square.
 *
 * There is deliberately NO separate `square` field. The ground/terrain diagnosis asked for
 * `square?: { centre, radius, kind }` to stamp a cobble weight into the terrain splat; a union of
 * paving rects expresses that strictly better (it follows the streets, not just the plaza) and
 * `assetId` already carries the `kind`, so the splat stamp is driven off `paving` and a second
 * overlapping field would only be able to disagree with it.
 */
export interface PavingDef {
  id: string;
  rect: PavingRect;
  assetId: PavingAssetId;
  /** Ring the rect with `kerb_straight` plus `kerb_corner` at the corners. Never solid. */
  kerb?: boolean;
}

/**
 * One piece of set dressing: a barrel, a crate, a bench, a woodpile log, a wall lamp, a fence post.
 *
 * WHY THIS TYPE EXISTS. There was nowhere in the entire content layer to author a barrel.
 * `SettlementDef` had buildings, stations, a bank, shops and NPCs and nothing else, and
 * `render/buildings.ts` only emits props as fixed parts of a prefab or a landmark composition. So
 * the bank chest (drawn 1.28 x 0.76 m), the anvil (1.08 x 0.40 m), the furnace cauldron (0.99 x
 * 0.94 m) and both market pitches stand alone on open grass — that single missing array is the
 * whole reason. `table_large`, `bench`, `stool`, `chair`, `barrel`, `barrel_rack`, `barrel_apples`,
 * `crate_wood`, `crate_village`, `sack` and the `farm_crate_*` family all ship in the manifest and
 * are used by nothing.
 *
 * `dy` is metres above the resolved ground height, for the things that do not sit on it: a
 * `lamp_wall` at 2.4 m on a wall face, a `roof_log` laid flat in a woodpile at -1.00 (the log's
 * pivot is above its own axis). `scale` is a true metre multiplier in the same sense as
 * `PartPlacement.scale`. `solid` asks the root's boot wiring for a collider; leave it off for
 * anything the player should be able to walk over or through, which is most ground dressing.
 */
export interface PropDef {
  id: string;
  assetId: string;
  position: Spot;
  rotationY: number;
  scale?: number;
  /** Metres above the resolved ground height. Defaults to 0. */
  dy?: number;
  /** Give it a collider. Defaults to false: dressing you can walk through is better than a snag. */
  solid?: boolean;
}

/**
 * A rectangular flat pad instead of the default disc, in the settlement's own frame, centred on
 * `SettlementDef.centre` and rotated by `rotationY` about it.
 *
 * WHY THIS TYPE EXISTS. `worldSpec.settlementRadius()` sizes one circular pad from the furthest
 * thing the settlement places, and at Highcairn that disc spans the terrace 2 / terrace 3 boundary
 * at z = -76, where `KARROWMOOR.terraces` authors an 18 m riser. Measured: `getDrawnBounds` puts
 * `highcairn_wall_n#w0` and `highcairn_wall_s#w0` both at base y = 26.810 while standing 30 m
 * apart in z. The pad has flattened the single terrain feature the region is built around, and the
 * result reads on screen as a grey table with a hard arc cut into the hillside. A rectangle can be
 * kept wholly inside one terrace; a disc sized to reach the far corner of the town cannot.
 *
 * `halfX` / `halfZ` are half-extents in metres, so Highcairn's proposed 44 x 28 m pad is
 * `{ halfX: 22, halfZ: 14, rotationY: 0 }`. The existing blend width is unchanged and still
 * applies outside the rectangle.
 */
export interface PadShapeDef {
  halfX: number;
  halfZ: number;
  rotationY: number;
}

export interface SettlementDef {
  id: string;
  name: string;
  tier: number;
  bankLocationId: string;
  /**
   * Which building vernacular this settlement is made of. See `BUILDING_KITS` in
   * render/buildings.ts: wall family, corner post, roof pitch and roofline. Phase 1 shipped every
   * settlement on one kit, so tier 1 and tier 10 were the same eight cottages in different grass.
   */
  kit: KitId;
  centre: Spot;
  respawnPointId: string;
  buildings: BuildingDef[];
  stations: StationDef[];
  bank: BankDef;
  shops: ShopDef[];
  npcs: NpcStandDef[];
  /**
   * The town wall as runs rather than as free-standing panels. Optional so the current data keeps
   * typechecking while the emitter is written; a settlement with no `walls` is exactly what
   * Rootfall is today, which is the bug.
   */
  walls?: WallRunDef[];
  /** Paved ground. See `PavingDef`; this also feeds the terrain splat's cobble weight. */
  paving?: PavingDef[];
  /** Set dressing. See `PropDef`. */
  props?: PropDef[];
  /**
   * Override the circular flat pad with a rectangle. See `PadShapeDef`. Consumed by
   * `app/worldSpec.ts`, which is root-only.
   */
  padShape?: PadShapeDef;
}

/**
 * An Agility shortcut. Per architecture R2 these are semantic entities plus a route-graph edge, so
 * the flip in PRD 2.8 is a property of data rather than of Detour's off-mesh internals.
 *
 * `fromLocationId` / `toLocationId` are the route nodes the shortcut edge connects. Its cost is
 * `(dist(from, position) + dist(exitPosition, to)) / 4.2 + durationMs / 1000` - the brief's
 * "walk time to entrance plus duration", generalised so the walk off the far end is not free.
 */
export interface ObstacleDef {
  id: string;
  name: string;
  reqLevel: number;
  position: Spot;
  exitPosition: Spot;
  durationMs: number;
  /** Measured: the walking route this replaces, minus the walking the shortcut still costs. */
  savesMeters: number;
  assetId: string;
  /** Regional architectural dressing around the semantic traversal anchor. */
  composition?: CompositionId;
  scale?: number;
  rotationY?: number;
  fromLocationId: string;
  toLocationId: string;
  /** A slide you cannot climb back up. Emits one route edge instead of two. */
  oneWay?: boolean;
  interaction: "climb" | "vault" | "enter";
}

/**
 * A patrol group. `family` is the key round 4's `content/enemies.ts` looks up; the stats here are
 * provisional so round 1 can spawn something with a health bar and an aggro radius, and they are
 * superseded (not merged) when the real enemy table lands.
 */
export interface EnemyGroupDef {
  id: string;
  family: string;
  name: string;
  tier: number;
  count: number;
  /** Compact mixed habitats split a fixed resident budget across several species. */
  countPolicy?: 'fixed';
  /** Original one-member groups keep their bare entity ID when the pack gains residents. */
  legacyCount?: number;
  centre: Spot;
  radius: number;
  assetId: string;
  /**
   * Multiplier on the asset's own metres, before `tierSilhouetteScale(tier)`.
   *
   * The animal GLBs are measured from life, so this is usually near 1 and the comment it replaces
   * ("~0.7x next to a 1.82 m player") no longer applies. Drawn size is
   * `manifest.size * scale * tierSilhouetteScale(tier)`, and that silhouette factor is 0.90 at
   * tier 1, 1.075 at tier 5 and 1.15 at tier 10.
   */
  scale: number;
  boss?: boolean;
  /**
   * A regional miniboss: keeps the `"boss"` semantic archetype and the boss respawn window, but
   * draws at 1.3x authored scale (against a major boss's 1.6x) and publishes
   * `meta.rank: "miniboss"` so tools and tests can tell the two apart. Never set with `boss`.
   */
  miniBoss?: boolean;
}

/**
 * NO COMBAT STATS HERE, and that is the point.
 *
 * `level`, `maxHealth`, `aggroRadius` and `behaviour` used to live on this interface as placement
 * hints written before `content/enemies.ts` existed. They then disagreed with it in both
 * directions, and `world/regionBuilder.ts` had to pick a winner field by field. Every one of them
 * now comes from the stat block, and the displayed level is COMPUTED from that block by
 * `content/index.ts: enemyCombatLevel()` rather than typed anywhere. A group that has no matching
 * stat block throws at build time instead of spawning something with invented numbers.
 */

export interface LandmarkDef {
  id: string;
  name: string;
  position: Spot;
  assetId: string;
  scale?: number;
  rotationY?: number;
  /** Draw only the lowest fraction of the mesh. See `SemanticEntity.view.clipFraction`. */
  clipFraction?: number;
  blurb: string;
  /**
   * Set dressing built around the hero mesh by `render/buildings.ts`. Round-1 critique finding 8:
   * one stand-in prop gives the player nothing to navigate by, so the landmarks that matter carry
   * a small authored composition instead.
   */
  composition?: CompositionId;
  /** False for broad, walkable compositions whose central interactable owns collision. */
  solid?: boolean;
  /** The composition is the complete structure; the location marker has no extra hero mesh. */
  compositionOnly?: boolean;
  /** Keep the imported origin on terrain instead of lifting the asset's lowest buried detail. */
  originOnGround?: boolean;
}

/** A region gate. Two of these, one per side, make a crossing. */
export interface GateDef {
  id: string;
  name: string;
  position: Spot;
  assetId: string;
  toRegionId: RegionId;
  /** The location id on the far side. */
  toLocationId: string;
  rotationY?: number;
  composition?: CompositionId;
}

export interface RegionAdjacencyDef {
  toRegionId: RegionId;
  fromLocationId: string;
  toLocationId: string;
  /** Walking metres between the two gate nodes. */
  meters: number;
}

/** A stepped plateau. Karrowmoor's defining feature; the terrain generator reads these. */
export interface TerraceDef {
  index: number;
  /** Inclusive z band. */
  minZ: number;
  maxZ: number;
  /** Plateau height above the region's base height, before noise. */
  height: number;
}

export interface DungeonChamberDef {
  id: string;
  name: string;
  centre: Spot;
  radius: number;
  /** Floor height relative to the terrain at the dungeon entrance. Chambers descend. */
  floorOffset: number;
  lit: boolean;
}

export interface DungeonDoorDef {
  id: string;
  name: string;
  position: Spot;
  floorOffset: number;
  assetId: string;
  state: string;
  /** Plain text shown when the door refuses. */
  lockedReason: string;
}

/**
 * The Gravelmaw hangs off Karrowmoor rather than standing as a fourth `RegionDef`, because the
 * root's boot sequence builds terrain and a navmesh per region and the dungeon has neither - it is
 * carved interior geometry under the quarry face. Its entities still carry
 * `regionId: "gravelmaw"`, so `observe({ regionId: "gravelmaw" })` and the save format behave
 * exactly as the contract says.
 */
export interface DungeonDef {
  id: RegionId;
  name: string;
  tier: number;
  /** Surface position of the mouth, in the parent region. */
  entrance: Spot;
  entranceAssetId: string;
  /** Bearing the mouth opens toward, radians, 0 = +z. The composition is laid out around it. */
  entranceRotationY?: number;
  entranceScale?: number;
  /** Cliff, brow and brazier composition built around the mouth by `render/buildings.ts`. */
  entranceComposition?: CompositionId;
  palette: string[];
  chambers: DungeonChamberDef[];
  doors: DungeonDoorDef[];
  obstacles: ObstacleDef[];
  enemyGroups: EnemyGroupDef[];
  locations: LocationDef[];
  roads: RoadDef[];
}

export interface RegionDef {
  id: RegionId;
  name: string;
  tier: number;
  /** One paragraph, condensed from PRD section 4. Feeds `searchDocs` and the Locations panel. */
  lore: string;
  bounds: RegionBounds;
  /** Terrain noise seed. Independent of the world seed so terrain is stable across saves. */
  terrainSeed: number;
  /** Metres of elevation range across the region, per PRD section 4. */
  terrainAmplitude: number;
  /** Height of the region's floor above world zero, before noise and terraces. */
  baseHeight: number;
  terraces?: TerraceDef[];
  /** Exactly 8 swatches. `render/materials.ts` locks the region palette off these. */
  groundPalette: string[];
  /** Fog start in metres. Vellenwood's canopy is why this is per-region. */
  fogStart: number;
  spawnPoint: Spot;
  /**
   * Which way the player faces at frame 0, radians, in the same convention as `NpcStandDef.facingRad`
   * and `debug/shots.ts`: **0 looks toward +z (north), increasing clockwise seen from above**, so
   * `facing = atan2(targetX - x, targetZ - z)`.
   *
   * Round-1 critique finding 2: Fallowmarch spawns at z = -118 and Coldbrace Square is at z = -80,
   * i.e. *behind* a camera left at its hardcoded initial yaw. The camera sits opposite the facing,
   * so the root's boot sequence wants `camera.setPose(spawnFacingRad + Math.PI, ...)` alongside
   * `scene.syncPlayer(spawn, spawnFacingRad, true)` - exactly the relationship
   * `__gameDebug.focusCamera` already uses for named shots.
   */
  spawnFacingRad: number;
  respawnPointId: string;
  locations: LocationDef[];
  roads: RoadDef[];
  clusters: ResourceClusterDef[];
  /** Production stations outside the settlement, such as regional Essence Altars. */
  stations: StationDef[];
  settlements: SettlementDef[];
  obstacles: ObstacleDef[];
  enemyGroups: EnemyGroupDef[];
  landmarks: LandmarkDef[];
  gates: GateDef[];
  adjacency: RegionAdjacencyDef[];
  dungeon?: DungeonDef;
}

/** Movement speed the route graph costs walking edges at. Mirrors `app/config.ts` PLAYER_SPEED. */
export const WALK_SPEED_MPS = PLAYER_SPEED;

export const WORLD_BOUNDS: RegionBounds = { min: [-350, -200], max: [700, WILDERNESS_DEPTH.north] };

/** One boss-keyed crafting altar at each matching Essence Cache. */
export const ESSENCE_ALTAR_COURT_RADIUS = 16;
export const ESSENCE_ALTAR_COURT_BLEND = 14;
/** Keeps trees, shrubs, grass, flowers and loose litter outside the finished ritual court. */
export const ESSENCE_ALTAR_CLEAR_RADIUS = 19;

export const REGIONAL_ESSENCE_ALTARS = {
  fallowmarch: {
    id: "fallowmarch_air_altar", name: "Air Essence Altar", kind: "essence_altar", skill: "magic",
    position: [-250, -150], rotationY: 0, assetId: "altar_ruins_altar", scale: 1,
    recipeIds: ["craft_air_wand", "craft_air_staff"], essenceElement: "wind",
  },
  vellenwood: {
    id: "vellenwood_earth_altar", name: "Earth Essence Altar", kind: "essence_altar", skill: "magic",
    position: [262, 176], rotationY: 0, assetId: "altar_ruins_altar", scale: 1,
    recipeIds: ["craft_earth_wand", "craft_earth_staff"], essenceElement: "earth",
  },
  karrowmoor: {
    id: "karrowmoor_water_altar", name: "Water Essence Altar", kind: "essence_altar", skill: "magic",
    position: [328, -176], rotationY: 0, assetId: "altar_ruins_altar", scale: 1,
    recipeIds: ["craft_water_wand", "craft_water_staff"], essenceElement: "water",
  },
  kilnhalt: {
    id: "kilnhalt_fire_altar", name: "Fire Essence Altar", kind: "essence_altar", skill: "magic",
    position: [290, 400], rotationY: 0, assetId: "altar_ruins_altar", scale: 1,
    recipeIds: ["craft_fire_wand", "craft_fire_staff"], essenceElement: "fire",
  },
} as const satisfies Readonly<Record<"fallowmarch" | "vellenwood" | "karrowmoor" | "kilnhalt", StationDef>>;


export const REGIONS: readonly RegionDef[] = (WORLD_REGION_GEOMETRY as unknown as readonly Omit<RegionDef, 'enemyGroups' | 'clusters'>[]).map(region => ({ ...region,
  enemyGroups: WORLD_CONTENT.groupsByRegion.get(region.id) ?? [],
  clusters: RESOURCE_PLACEMENTS.filter(row => row.regionId === region.id).map(({ regionId, ...cluster }) => cluster),
  dungeon: region.dungeon ? { ...region.dungeon,
    enemyGroups: WORLD_CONTENT.groupsByRegion.get(region.dungeon.id) ?? [],
  } : undefined,
}));
/** The source gallery uses the same content as production. */
export const SOURCE_REGIONS = REGIONS;
export const FAIRY_REGIONS = REGIONS.filter(region => region.id === 'gloamgarden' || region.id === 'faeholme');

export const STARTING_REGION: RegionId = "fallowmarch";
export const SURFACE_REGIONS = REGIONS.filter(region => region.id !== 'gloamgarden' && region.id !== 'faeholme');

export function getRegion(id: RegionId): RegionDef | undefined {
  for (const region of REGIONS) if (region.id === id) return region;
  return undefined;
}

/** Every location across every region, including the dungeon's. Order is stable. */
export function allLocations(): { regionId: RegionId; location: LocationDef }[] {
  const out: { regionId: RegionId; location: LocationDef }[] = [];
  for (const region of REGIONS) {
    for (const location of region.locations) out.push({ regionId: region.id, location });
    const dungeon = region.dungeon;
    if (dungeon) {
      for (const location of dungeon.locations) out.push({ regionId: dungeon.id, location });
    }
  }
  return out;
}

export function findLocation(id: string): { regionId: RegionId; location: LocationDef } | undefined {
  for (const entry of allLocations()) if (entry.location.id === id) return entry;
  return undefined;
}

/** Horizontal distance between two authored ground positions. */
export function spotDistance(a: Spot, b: Spot): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Shortest distance from `point` to the segment `a`->`b`, in metres, clamped at both ends.
 */
function distanceToSegment(point: Spot, a: Spot, b: Spot): number {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq === 0) return spotDistance(point, a);
  const along = ((point[0] - a[0]) * abx + (point[1] - a[1]) * abz) / lengthSq;
  const t = Math.min(1, Math.max(0, along));
  return spotDistance(point, [a[0] + abx * t, a[1] + abz * t]);
}

/**
 * Shortest distance from `point` to a building's footprint rectangle. Zero when the point is
 * inside the building, which is the normal answer for a station under a roof.
 *
 * The footprint is authored in the building's own frame, so the point is rotated into that frame
 * first. The forward transform `world/regionBuilder.ts` applies to every prefab part is
 * `world = (dx*cos + dz*sin, -dx*sin + dz*cos)`; that matrix is orthogonal, so its inverse is its
 * transpose and the local coordinates are `(wx*cos - wz*sin, wx*sin + wz*cos)`.
 */
function distanceToFootprint(point: Spot, building: BuildingDef): number {
  const cos = Math.cos(building.rotationY);
  const sin = Math.sin(building.rotationY);
  const wx = point[0] - building.position[0];
  const wz = point[1] - building.position[1];
  const dx = wx * cos - wz * sin;
  const dz = wx * sin + wz * cos;
  const overX = Math.max(0, Math.abs(dx) - building.footprint[0] / 2);
  const overZ = Math.max(0, Math.abs(dz) - building.footprint[1] / 2);
  return Math.hypot(overX, overZ);
}

/**
 * Content validation, for `content/validate.ts` to call at boot. Returns a list of problems rather
 * than throwing, so the root can surface all of them at once in `getErrors()`.
 *
 * It checks the things that silently produce a broken world: a road pointing at a location that
 * does not exist, an obstacle wired to a missing route node, a cluster outside its region bounds,
 * a palette that is not eight swatches, or a settlement placed outside its own region.
 *
 * It also checks the settlement dressing vocabulary, because every one of those is silent too: a
 * wall run whose gate opening falls off the end of the run leaves the wall solid where the gate
 * should be, a degenerate paving rect paves nothing at all, a prop naming a missing asset draws
 * nothing, and a station `attachedTo` a building 6 m away is the "anvil standing in a field"
 * failure the field was added to catch.
 *
 * Pass `knownAssetIds` (`new Set(assetRegistry.ids())` once the manifest has loaded) and it also
 * checks every asset id the content names, including every part id the prefabs and landmark
 * compositions in `render/buildings.ts` can emit. Round-1 critique finding 1 was 37 buildings that
 * rendered as nothing; a prefab that names an asset the manifest does not have would fail the same
 * way, silently, so it is checked here rather than discovered in a screenshot.
 */
export function validateRegions(knownAssetIds?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  const checkAsset = (where: string, assetId: string | undefined): void => {
    if (!assetId || !knownAssetIds) return;
    if (!knownAssetIds.has(assetId)) problems.push(`${where}: unknown asset "${assetId}"`);
  };

  if (knownAssetIds) {
    for (const assetId of prefabPartAssetIds()) checkAsset("prefabs", assetId);
    for (const assetId of compositionPartAssetIds()) checkAsset("landmark compositions", assetId);
  }

  const inBounds = (bounds: RegionBounds, spot: Spot): boolean =>
    spot[0] >= bounds.min[0] && spot[0] <= bounds.max[0] &&
    spot[1] >= bounds.min[1] && spot[1] <= bounds.max[1];

  for (const region of REGIONS) {
    if (region.groundPalette.length !== 8) {
      problems.push(`${region.id}: groundPalette has ${region.groundPalette.length} swatches, expected 8`);
    }
    if (!inBounds(region.bounds, region.spawnPoint)) {
      problems.push(`${region.id}: spawnPoint is outside the region bounds`);
    }

    const locationIds = new Set(region.locations.map((location) => location.id));
    for (const location of region.locations) {
      if (seenIds.has(location.id)) problems.push(`duplicate location id ${location.id}`);
      seenIds.add(location.id);
      if (!inBounds(region.bounds, location.position)) {
        problems.push(`${region.id}: location ${location.id} is outside the region bounds`);
      }
    }

    for (const road of region.roads) {
      if (!locationIds.has(road.from)) problems.push(`${region.id}: road from unknown location ${road.from}`);
      if (!locationIds.has(road.to)) problems.push(`${region.id}: road to unknown location ${road.to}`);
    }

    for (const cluster of region.clusters) {
      if (cluster.count < 1) problems.push(`${region.id}: cluster ${cluster.id} has no nodes`);
      if (!locationIds.has(cluster.locationId)) {
        problems.push(`${region.id}: cluster ${cluster.id} references unknown location ${cluster.locationId}`);
      }
      if (!inBounds(region.bounds, cluster.centre)) {
        problems.push(`${region.id}: cluster ${cluster.id} is outside the region bounds`);
      }
    }

    for (const station of region.stations) {
      if (seenIds.has(station.id)) problems.push(`duplicate regional station id ${station.id}`);
      seenIds.add(station.id);
      if (!inBounds(region.bounds, station.position)) {
        problems.push(`${region.id}: regional station ${station.id} is outside the region bounds`);
      }
      checkAsset(`${region.id}: regional station ${station.id}`, station.assetId);
      if (station.kind === "essence_altar" && station.essenceElement === undefined) {
        problems.push(`${region.id}: Essence Altar ${station.id} has no essenceElement`);
      }
    }

    for (const obstacle of region.obstacles) {
      if (!locationIds.has(obstacle.fromLocationId)) {
        problems.push(`${region.id}: obstacle ${obstacle.id} starts at unknown location ${obstacle.fromLocationId}`);
      }
      if (!locationIds.has(obstacle.toLocationId)) {
        problems.push(`${region.id}: obstacle ${obstacle.id} ends at unknown location ${obstacle.toLocationId}`);
      }
      if (obstacle.durationMs <= 0) problems.push(`${region.id}: obstacle ${obstacle.id} has no duration`);
      if (obstacle.composition !== undefined && !isCompositionId(obstacle.composition)) {
        problems.push(
          `${region.id}: obstacle ${obstacle.id} names unknown composition ` +
          `"${String(obstacle.composition)}"`,
        );
      }
    }

    for (const gate of region.gates) {
      if (!locationIds.has(gate.id)) {
        problems.push(`${region.id}: gate ${gate.id} has no matching route node`);
      }
    }

    for (const adjacency of region.adjacency) {
      const target = getRegion(adjacency.toRegionId);
      if (!target) {
        problems.push(`${region.id}: adjacency points at unknown region ${adjacency.toRegionId}`);
        continue;
      }
      if (!target.locations.some((location) => location.id === adjacency.toLocationId)) {
        problems.push(`${region.id}: adjacency points at unknown location ${adjacency.toLocationId}`);
      }
    }

    for (const settlement of region.settlements) {
    if (!inBounds(region.bounds, settlement.centre)) {
      problems.push(`${region.id}: settlement ${settlement.id} is outside the region bounds`);
    }

    // Buildings. An unknown prefab, a zero footprint, or a building outside its own region all
    // produce a settlement that is invisible or in the wrong place, and all three are silent.
    if (!region.locations.some(location => location.id === settlement.bankLocationId && location.kind === "bank")) {
      problems.push(`${settlement.id}: missing bank approach ${settlement.bankLocationId}`);
    }
    if (!isKitId(settlement.kit)) {
      problems.push(
        `${region.id}: settlement ${settlement.id} names unknown building kit ` +
        `"${String(settlement.kit)}" (known: ${KIT_IDS.join(", ")})`,
      );
    }
    for (const building of settlement.buildings) {
      if (seenIds.has(building.id)) problems.push(`duplicate building id ${building.id}`);
      seenIds.add(building.id);
      if (building.model) checkAsset(building.id, building.model.assetId);
      if (!isPrefabId(building.prefab)) {
        problems.push(
          `${region.id}: building ${building.id} names unknown prefab "${String(building.prefab)}" ` +
          `(known: ${PREFAB_IDS.join(", ")})`,
        );
      }
      if (building.footprint[0] <= 0 || building.footprint[1] <= 0) {
        problems.push(`${region.id}: building ${building.id} has a zero footprint`);
      }
      if (!inBounds(region.bounds, building.position)) {
        problems.push(`${region.id}: building ${building.id} is outside the region bounds`);
      }
    }

    // Wall runs. Both failure modes here are invisible: a run that leaves the region gets built on
    // terrain the region never generated, and a gate opening that falls outside the run's length
    // leaves the wall solid where the gatehouse stands, which is the current bug in reverse.
    const wallRuns = settlement.walls ?? [];
    for (const run of wallRuns) {
      if (seenIds.has(run.id)) problems.push(`duplicate wall run id ${run.id}`);
      seenIds.add(run.id);
      if (!inBounds(region.bounds, run.from) || !inBounds(region.bounds, run.to)) {
        problems.push(`${region.id}: wall run ${run.id} leaves the region bounds`);
      }
      const runLength = spotDistance(run.from, run.to);
      if (runLength < MODULE_METRES) {
        problems.push(
          `${region.id}: wall run ${run.id} is ${runLength.toFixed(2)} m long, ` +
          `shorter than one ${MODULE_METRES} m wall module`,
        );
      }
      for (const opening of run.openings ?? []) {
        if (!(opening.width > 0)) {
          problems.push(`${region.id}: wall run ${run.id} has an opening of width ${opening.width}`);
          continue;
        }
        const start = opening.at - opening.width / 2;
        const end = opening.at + opening.width / 2;
        if (start < 0 || end > runLength) {
          problems.push(
            `${region.id}: wall run ${run.id} has a ${opening.width} m opening centred at ` +
            `${opening.at} m, which falls outside the run's ${runLength.toFixed(2)} m length`,
          );
        }
      }
    }

    // Paving. A rect with min >= max stamps nothing and reports nothing, so the square is silently
    // still bare grass.
    for (const paving of settlement.paving ?? []) {
      if (seenIds.has(paving.id)) problems.push(`duplicate paving id ${paving.id}`);
      seenIds.add(paving.id);
      checkAsset(`${region.id}: paving ${paving.id}`, paving.assetId);
      const rect = paving.rect;
      if (!(rect.maxX > rect.minX) || !(rect.maxZ > rect.minZ)) {
        problems.push(
          `${region.id}: paving ${paving.id} is degenerate: ` +
          `x [${rect.minX}, ${rect.maxX}] z [${rect.minZ}, ${rect.maxZ}]`,
        );
      }
      if (!inBounds(region.bounds, [rect.minX, rect.minZ]) ||
          !inBounds(region.bounds, [rect.maxX, rect.maxZ])) {
        problems.push(`${region.id}: paving ${paving.id} leaves the region bounds`);
      }
    }

    for (const prop of settlement.props ?? []) {
      if (seenIds.has(prop.id)) problems.push(`duplicate prop id ${prop.id}`);
      seenIds.add(prop.id);
      checkAsset(`${region.id}: prop ${prop.id}`, prop.assetId);
      if (!inBounds(region.bounds, prop.position)) {
        problems.push(`${region.id}: prop ${prop.id} is outside the region bounds`);
      }
      if (prop.scale !== undefined && !(prop.scale > 0)) {
        problems.push(`${region.id}: prop ${prop.id} has scale ${prop.scale}`);
      }
    }

    const padShape = settlement.padShape;
    if (padShape && (!(padShape.halfX > 0) || !(padShape.halfZ > 0) ||
        !Number.isFinite(padShape.rotationY))) {
      problems.push(
        `${region.id}: settlement ${settlement.id} padShape must have positive half-extents and a ` +
        `finite rotation, got halfX ${padShape.halfX}, halfZ ${padShape.halfZ}, ` +
        `rotationY ${padShape.rotationY}`,
      );
    }

    // `attachedTo` is a claim, and this is the check that makes the claim worth authoring. The
    // distance is measured to the edge of the structure - a building's footprint rectangle, a wall
    // run's centreline, a prop's origin - so a station standing under a roof measures 0.
    const attachmentDistance = (point: Spot, targetId: string): number | undefined => {
      const building = settlement.buildings.find((candidate) => candidate.id === targetId);
      if (building) return distanceToFootprint(point, building);
      const run = wallRuns.find((candidate) => candidate.id === targetId);
      if (run) return distanceToSegment(point, run.from, run.to);
      const prop = (settlement.props ?? []).find((candidate) => candidate.id === targetId);
      if (prop) return spotDistance(point, prop.position);
      return undefined;
    };
    const checkAttachment = (
      what: string, id: string, position: Spot, attachedTo: string | undefined,
    ): void => {
      if (attachedTo === undefined) return;
      const distance = attachmentDistance(position, attachedTo);
      if (distance === undefined) {
        problems.push(
          `${region.id}: ${what} ${id} is attachedTo "${attachedTo}", which is not a building, ` +
          `wall run or prop in settlement ${settlement.id}`,
        );
        return;
      }
      if (distance > ATTACHMENT_MARGIN_METRES) {
        problems.push(
          `${region.id}: ${what} ${id} claims to be attachedTo ${attachedTo} but stands ` +
          `${distance.toFixed(1)} m from it (limit ${ATTACHMENT_MARGIN_METRES} m)`,
        );
      }
    };
    for (const station of settlement.stations) {
      checkAttachment("station", station.id, station.position, station.attachedTo);
    }
    for (const shop of settlement.shops) {
      checkAttachment("shop", shop.id, shop.position, shop.attachedTo);
    }
    checkAttachment("bank", settlement.bank.id, settlement.bank.position, settlement.bank.attachedTo);

    for (const shop of settlement.shops) checkAsset(`${region.id}: shop ${shop.id}`, shop.assetId);
    for (const station of settlement.stations) checkAsset(`${region.id}: station ${station.id}`, station.assetId);
    for (const npc of settlement.npcs) checkAsset(`${region.id}: npc ${npc.id}`, npc.assetId);
    checkAsset(`${region.id}: bank ${settlement.bank.id}`, settlement.bank.assetId);
    }

    for (const cluster of region.clusters) {
      try {
        const resource = resourceDef(cluster.resourceId);
        for (const assetId of resource.presentation.availableAssetIds) {
          checkAsset(`${region.id}: cluster ${cluster.id}`, assetId);
        }
        if (resource.presentation.depletedAssetId) {
          checkAsset(`${region.id}: cluster ${cluster.id}`, resource.presentation.depletedAssetId);
        }
      } catch {
        problems.push(`${region.id}: cluster ${cluster.id} references missing resource ${cluster.resourceId}`);
      }
    }
    for (const group of region.enemyGroups) checkAsset(`${region.id}: enemies ${group.id}`, group.assetId);
    for (const obstacle of region.obstacles) checkAsset(`${region.id}: obstacle ${obstacle.id}`, obstacle.assetId);

    for (const landmark of region.landmarks) {
      checkAsset(`${region.id}: landmark ${landmark.id}`, landmark.assetId);
      if (landmark.composition !== undefined && !isCompositionId(landmark.composition)) {
        problems.push(
          `${region.id}: landmark ${landmark.id} names unknown composition ` +
          `"${String(landmark.composition)}" (known: ${COMPOSITION_IDS.join(", ")})`,
        );
      }
    }
    for (const gate of region.gates) {
      checkAsset(`${region.id}: gate ${gate.id}`, gate.assetId);
      if (gate.composition !== undefined && !isCompositionId(gate.composition)) {
        problems.push(`${region.id}: gate ${gate.id} names unknown composition "${String(gate.composition)}"`);
      }
    }

    const dungeon = region.dungeon;
    if (dungeon) {
      const dungeonIds = new Set([
        ...dungeon.locations.map((location) => location.id),
        ...region.locations.map((location) => location.id),
      ]);
      for (const road of dungeon.roads) {
        if (!dungeonIds.has(road.from)) problems.push(`${dungeon.id}: road from unknown location ${road.from}`);
        if (!dungeonIds.has(road.to)) problems.push(`${dungeon.id}: road to unknown location ${road.to}`);
      }
      for (const obstacle of dungeon.obstacles) {
        if (!dungeonIds.has(obstacle.fromLocationId) || !dungeonIds.has(obstacle.toLocationId)) {
          problems.push(`${dungeon.id}: obstacle ${obstacle.id} is wired to a location that does not exist`);
        }
        checkAsset(`${dungeon.id}: obstacle ${obstacle.id}`, obstacle.assetId);
        if (obstacle.composition !== undefined && !isCompositionId(obstacle.composition)) {
          problems.push(
            `${dungeon.id}: obstacle ${obstacle.id} names unknown composition ` +
            `"${String(obstacle.composition)}"`,
          );
        }
      }
      checkAsset(`${dungeon.id}: entrance`, dungeon.entranceAssetId);
      if (dungeon.entranceComposition !== undefined && !isCompositionId(dungeon.entranceComposition)) {
        problems.push(`${dungeon.id}: entrance names unknown composition "${String(dungeon.entranceComposition)}"`);
      }
      for (const door of dungeon.doors) checkAsset(`${dungeon.id}: door ${door.id}`, door.assetId);
      for (const group of dungeon.enemyGroups) checkAsset(`${dungeon.id}: enemies ${group.id}`, group.assetId);
    }
  }

  return problems;
}
