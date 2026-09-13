import { REGIONAL_VARIANT_GROUPS, REGIONAL_VARIANT_HABITATS, AMETHYST_CAVE_GROUP } from "./regionalVariantHabitats.js";
import { LEGACY_CAVE_FLOOR_INTENTS } from './legacyEncounterPlacements.js';
/**
 * The five surface regions and Stone Cavern, as pure data.
 *
 * Nothing here imports Three.js, reads the store, or computes terrain. This file is the authored
 * truth for *where things are and what they mean*; `world/regionBuilder.ts` turns it into
 * `SemanticEntity` objects, and the render layer draws those by reading `view.assetId`.
 *
 * Sources: runs/corealm/PRD.md section 4 (names, lore, feature lists), section 2.6 (node numbers),
 * section 2.8 (the route-optimisation flip), and runs/corealm/architecture.md correction R2
 * (Agility obstacles are route-graph edges, not navmesh off-mesh links).
 *
 * ---------------------------------------------------------------------------------------------
 * COORDINATE SYSTEM
 * ---------------------------------------------------------------------------------------------
 * One connected world. X grows east, Z grows north, Y is up. All units are metres.
 * The five surface regions tile a single 700 x 900 m rectangle with no overlap and no gaps:
 *
 *        z=+700  +---------------------------------------------------+
 *                |          WILDERNESS ? NIGHT / DEADWOOD             |
 *                |               x [-350,350] z [460,700]            |
 *        z=+460  +---------------------------------------------------+
 *                |                     KILNHALT                      |
 *                |               x [-350,350] z [200,460]            |
 *        z=+200  +-------------------+-------------------------------+
 *                |                   |                               |
 *                |                   |          VELLENWOOD           |
 *                |                   |     x [-20,350] z [10,200]    |
 *                |    FALLOWMARCH    |                               |
 *        z=+10   |  x [-350,-20]     +-------------------------------+
 *                |  z [-200,200]     |                               |
 *                |                   |          KARROWMOOR           |
 *                |                   |    x [-20,350] z [-200,10]    |
 *        z=-200  +-------------------+-------------------------------+
 *              x=-350             x=-20                          x=350
 *
 * The Kilnhalt seam at z = +200 is deliberately OPEN: no gates, walls, portals or level checks.
 * Terrain blends continuously across the whole 700 m line, and the route graph crosses it at
 * three semantic links (from Fallowmarch and Vellenwood), but a player can walk in at any x.
 *
 * Fallowmarch is middle-west, Vellenwood north-east of it, Karrowmoor east and south-east and
 * considerably higher. The regions share terrain edges, so the navmesh is continuous: a path from
 * the Coldbrace bank to the Upper Karrow seam crosses two borders and runs ~360 m in a straight
 * line, which is what acceptance check B3 measures (it expects 380-460 m once the Karrowmoor
 * terraces force the walk to switch back).
 *
 * PRD section 4 sizes the regions at 420/380/460 m square, which is 1.3 km of world. The root
 * fixed Phase 1 at 700 x 400 m, so lateral feature spacing is compressed where it had to be
 * (mainly east-west inside Fallowmarch) and preserved where it mattered. Every distance a game
 * rule depends on is preserved exactly and stated in the DISTANCE LEDGER below.
 *
 * ---------------------------------------------------------------------------------------------
 * DISTANCE LEDGER - the route-optimisation flip (PRD 2.8)
 * ---------------------------------------------------------------------------------------------
 * This is a product pillar, not decoration: a tier 5 seam next to its bank must out-XP a tier 10
 * seam that is far from its bank, until an Agility shortcut reverses it. The numbers below are
 * measured off the coordinates in this file, not copied from the PRD.
 *
 *   Hollowcut Seam (tier 5) -> Rootfall bank chest
 *     (94,145) -> (60,128)                                   = 38.0 m
 *
 *   Upper Karrow Seam (tier 10) -> Highcairn bank, by road
 *     (194,-132) -> ramp_three (118,-138)                    =  76.2 m
 *     ramp_three -> ramp_two    (100,-80)                    =  60.7 m
 *     ramp_two   -> highcairn_bank (150,-70)                 =  51.0 m
 *                                                      total = 187.9 m
 *
 *   Upper Karrow Seam -> Highcairn bank, via SUNDER LEDGE (Agility 10)
 *     highcairn_bank (150,-70) -> ledge entrance (170,-74)   =  20.4 m
 *     ledge exit (176,-114)    -> seam (194,-132)            =  25.5 m
 *                                        total walking       =  45.9 m + a 6.0 s climb
 *
 * Working the PRD 2.5 gathering model at Mining 12, no tool, 28-slot load, 6 s of banking per
 * trip, 4.2 m/s, 1.8 s gather tick:
 *
 *   successChance = 0.30 + 0.016 * (level - reqLevel)
 *   tier  5 @ 12: 0.412 -> 4.369 s/yield -> 28 yields = 122.3 s;
 *                 travel 2*38.0/4.2 = 18.1 s; bank 6 s; total 146.4 s; 28*24 XP = 16,524 XP/hr
 *   tier 10 @ 12: 0.332 -> 5.422 s/yield -> 28 yields = 151.8 s;
 *                 travel 2*187.9/4.2 = 89.5 s; bank 6 s; total 247.3 s; 28*35 XP = 14,266 XP/hr
 *   tier 10 via ledge: travel 2*(45.9/4.2 + 6.0) = 33.9 s; total 191.7 s     = 18,412 XP/hr
 *
 *   Before Agility 10:  tier 5 beats tier 10 by 15.8%.
 *   After  Agility 10:  tier 10 beats tier 5 by 11.4%.
 *
 * That reproduces the PRD's stated "about 16% then about 12%" reversal to within a fraction of a
 * point, and it is a property of the coordinates in this file, so it cannot drift without someone
 * moving a seam. Every other obstacle's `savesMeters` is likewise measured, not asserted; where
 * the PRD quoted a figure its own 420 m regions could not geometrically produce, the measured
 * value is used and the discrepancy is noted at the obstacle.
 */
import type { ItemId, QuestId, RecipeId, RegionId, SkillId, StationKind } from "../contracts.js";
import { PLAYER_SPEED } from "../app/config.js";
import {
  COMPOSITION_IDS, KIT_IDS, MODULE_METRES, PREFAB_IDS, compositionPartAssetIds, isCompositionId,
  isKitId, isPrefabId, prefabPartAssetIds, type CompositionId, type KitId, type PrefabId,
} from "../render/buildings.js";
// The three settlements are data, and each one is a whole town's worth of it. They live in
// `content/settlements/` so three people can lay out three towns without touching the same file;
// the types, the region wiring and `validateRegions` stay here, which is the only thing all three
// share. Those files import `SettlementDef` back from here with `import type`, so the cycle is
// erased at compile time and there is no runtime import loop.
import { COLDBRACE } from "./settlements/coldbrace.js";
import { EMBERFAST } from "./settlements/emberfast.js";
import { HIGHCAIRN } from "./settlements/highcairn.js";
import { ROOTFALL } from "./settlements/rootfall.js";
import { resourceDef } from "./resources.js";
import { CREATURE_ENEMY_GROUPS, CREATURE_HABITATS } from "./creatureHabitats.js";
import { STARTER_GROUPS } from "./starterHabitats.js";
import { RED_WORM_GROUP } from './redWormHabitat.js';
import { WILDERNESS } from "./wilderness.js";
import { CROWNWARD } from './crownward.js';
import { FAIRY_REGIONS } from './fairyRegions.js';
export { FAIRY_REGIONS } from './fairyRegions.js';
import { fantasyEncounter } from "./fantasyEncounters.js";
import { BIOME_POPULATION, resolveBiomePopulation } from "./biomePopulation.js";
import { CREATURE_SPECIES } from "./creatureSpecies.js";
import { populationGroup } from './encounterPlacement.js';
import { remapReservedEncounterGroup } from '../world/universalMinibossSockets.js';
import { WILDERNESS_DEPTH } from './wildernessDepth.js';

// ------------------------------------------------------------------ primitives

/**
 * An authored ground position: `[x, z]` in metres. Y is deliberately absent.
 *
 * The world layer does not own terrain. `buildWorld` is handed a `heightAt(regionId, x, z)` by the
 * root and resolves every Spot to a `Vec3` at build time, so an entity can never end up floating
 * because two files disagreed about where the ground was.
 */
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

/**
 * Buildings are composed, not loaded: the Medieval Village kit ships no prebuilt house, only a 2 m
 * modular grid (asset-report, "No prebuilt house or cottage"). A placement names a prefab and a
 * pose; `render/buildings.ts` turns that into an ordered list of part placements on the kit's 2 m /
 * 3.123 m grid, and `world/regionBuilder.ts` emits one instanced entity per part.
 */
export interface BuildingDef {
  id: string;
  name: string;
  prefab: PrefabId;
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
  shopKind: "general" | "smith";
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
  settlement?: SettlementDef;
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

// =============================================================== FALLOWMARCH

/**
 * Tier 1 frontier plains. Coldbrace sits centre-south with the March Road running north to the
 * Bracken Pit and on to the region gate.
 *
 * Feature spacing from the town square at (-160,-80), against PRD section 4:
 *   Bracken Pit      (-160,  80)  160 m north      (PRD: 160 m north)   exact
 *   Redsill Shallows ( -40, -60)  121.7 m east     (PRD: 120 m east)    exact
 *   Marchfield       ( -96, -22)   86.4 m NE       (PRD:  90 m NE)      close
 *   Palewood Copse   (-334, -64)  174.7 m west     (PRD: 190 m west)    compressed to fit x
 */
const FALLOWMARCH: RegionDef = {
  id: "fallowmarch",
  name: "Farmland",
  tier: 1,
  lore:
    "The last surveyed land before the maps stop being useful. Two generations ago the Trade " +
    "Company drove a road north, planted a bank vault at the end of it, walled a town around the " +
    "vault, and then stopped answering letters. What is left is Millfield: two hundred people " +
    "pulling Copper ore out of a shallow pit and pretending the wind off the northern moor " +
    "does not sound like anything.",
  bounds: { min: [-350, -200], max: [-20, 200] },
  terrainSeed: 0x0f411,
  terrainAmplitude: 14,
  baseHeight: 0,
  // Bleached grass greens, weathered grey-brown timber, one warm copper-orange accent on the roofs.
  groundPalette: ["#8f9468", "#a7a97c", "#6f7a4e", "#5c6242", "#8a7f6a", "#6d5f4c", "#c07a3c", "#d8d2c0"],
  fogStart: 180,
  // Just outside the south gate, facing the town. Screen centre lands on the road, which the
  // harness needs: smoke check `inputChangesState` clicks (640,360) then holds W.
  spawnPoint: [-160, -118],
  // Coldbrace South Gate is (-160,-108), dead north of spawn; the vault tower door is (-168,-94.5),
  // 0.51 rad west of it. -0.14 rad splits them: the gatehouse sits just right of screen centre and
  // the tower rises just left of it, both inside a 55-degree horizontal FOV at 10-25 m.
  spawnFacingRad: -0.14,
  respawnPointId: "coldbrace",

  locations: [
    { id: "spawn", name: "Farm Road End", position: [-160, -118], kind: "junction", routeNode: true,
      blurb: "Where the Trade Company road gives out, a stone throw south of Millfield." },
    { id: "town_entrance", name: "Millfield South Gate", position: [-160, -108], kind: "gate", routeNode: true,
      blurb: "The south gate of Millfield. The only one the carters use." },
    { id: "town_center", name: "Millfield Square", position: [-160, -80], kind: "settlement", routeNode: true,
      blurb: "The town square, built around the Trade Company vault." },
    { id: "bank_interior", name: "Millfield Bank", position: [-160, -88], kind: "bank", routeNode: true,
      blurb: "The Trade Company vault counter. Twelve windows, one very deep store." },
    { id: "coldbrace_east_gate", name: "Millfield East Gate", position: [-134, -80], kind: "gate", routeNode: true,
      blurb: "The gate the pit road leaves by." },
    { id: "north_milestone", name: "The Broken Milestone", position: [-108, -8], kind: "landmark", routeNode: true,
      blurb: "A snapped Trade Company marker where the pit road bends around the rise." },
    { id: "bracken_pit", name: "Copper Pit", position: [-160, 80], kind: "seam", routeNode: true,
      blurb: "A shallow Copper pit 160 m north of Millfield. Six seams and two stone faces." },
    { id: "fallowmarch_kiln_road", name: "Kiln Road South", position: [-160, 192], kind: "junction", routeNode: true,
      blurb: "Where the pit track runs on toward the ember foothills. No gate; the border is open ground." },
    { id: "palewood_copse", name: "Pine Grove", position: [-334, -64], kind: "grove", routeNode: true,
      blurb: "Eight pine trees on the western track. The only shade on the plain." },
    { id: "redsill_shallows", name: "River Shallows", position: [-40, -60], kind: "water", routeNode: true,
      blurb: "Where Iron Brook runs thin over red silt. Minnow water." },
    { id: "corven_ford", name: "River Crossing", position: [-72, -146], kind: "junction", routeNode: true,
      blurb: "The only cart crossing of Iron Brook, well south of the shallows." },
    { id: "marchfield", name: "Farm Fields", position: [-96, -22], kind: "landmark", routeNode: true,
      blurb: "A weathered homestead with two fenced yards inside the old wall line." },
    { id: "west_track", name: "West Track", position: [-230, -60], kind: "junction", routeNode: true,
      blurb: "Where the copse track leaves the town road." },
    { id: "open_march_camp", name: "Open Meadow", position: [-250, 30], kind: "camp", routeNode: true,
      blurb: "Open tussock. Frogs down in the wet, billy goats on the rise." },
    { id: "fallowmarch_air_cache", name: "Air Essence Cache", position: [-250, -150], kind: "landmark", routeNode: true,
      blurb: "A wind-scoured stone cache far beyond the west track, bright with trapped air essence." },
    { id: "fallowmarch_north_gate", name: "North Gate", position: [-26, 118], kind: "gate", routeNode: true,
      blurb: "The top of the Farm Road, and the way into Woodlands." },
  ],

  // Road legs. Straight-line cost between the two nodes unless `meters` overrides.
  roads: [
    { from: "spawn", to: "town_entrance" },
    { from: "town_entrance", to: "town_center" },
    { from: "town_center", to: "bank_interior" },
    { from: "town_center", to: "coldbrace_east_gate" },
    { from: "coldbrace_east_gate", to: "north_milestone" },
    { from: "coldbrace_east_gate", to: "marchfield" },
    { from: "north_milestone", to: "marchfield" },
    { from: "north_milestone", to: "bracken_pit" },
    { from: "bracken_pit", to: "fallowmarch_north_gate" },
    { from: "bracken_pit", to: "fallowmarch_kiln_road" },
    { from: "town_entrance", to: "corven_ford" },
    { from: "corven_ford", to: "redsill_shallows" },
    { from: "town_center", to: "west_track" },
    { from: "west_track", to: "palewood_copse" },
    { from: "west_track", to: "open_march_camp" },
    { from: "west_track", to: "fallowmarch_air_cache" },
    { from: "open_march_camp", to: "bracken_pit" },
  ],

  clusters: [
    {
      id: "bracken_pit_grithe", resourceId: "ore_grithe",
      count: 6, centre: [-160, 80], radius: 11,
      // No pack ships a mineable vein (asset-report gap 2). The rock meshes tagged `ore-node` are
      // single-material, so the render layer tints them per `view.materialTier`.
      // No `depletedAssetId`. A worked-out node keeps the silhouette the player walked up to:
      // the render layer derives the spent look from this same mesh (`buildSpentParts` in
      // render/entityViews.ts) by dropping the ore vein, cutting a tree back to its stump, or
      // cutting a crop back to stubble. Swapping in a smaller rock read as the seam vanishing, and
      // swapping a tree for `anvil_log` — which is an anvil sitting on a log — put a blacksmith's
      // anvil where every felled tree had been.
      locationId: "bracken_pit",
    },
    {
      id: "bracken_pit_stone", resourceId: "ore_marchstone",
      count: 2, centre: [-146, 88], radius: 5,
      locationId: "bracken_pit",
    },
    {
      id: "palewood_copse_trees", resourceId: "tree_palewood",
      count: 8, centre: [-334, -64], radius: 15,
      locationId: "palewood_copse",
    },
    {
      id: "redsill_spots", resourceId: "fish_silt_minnow",
      count: 4, centre: [-40, -60], radius: 9,
      // Fish schools render below the canonical solved water surface. The semantic entity remains
      // the surface interaction proxy, so cluster placement must stay inside the authored pond.
      locationId: "redsill_shallows",
    },
    {
      id: "fallowmarch_air_essence_cache", resourceId: "essence_air",
      count: 5, centre: [-250, -150], radius: 12, ringRadius: 12,
      essenceElement: "wind",
      locationId: "fallowmarch_air_cache",
    },
  ],

  stations: [REGIONAL_ESSENCE_ALTARS.fallowmarch],
  settlement: COLDBRACE,

  obstacles: [
    {
      // Bank -> Redsill by road runs down to Corven Ford and back up: 115.0 + 91.8 = 206.8 m.
      // Over the planks: 100.4 m to the entrance + 40.5 m off the far bank = 140.9 m + 2.0 s.
      // Saves 65.9 m. PRD 2.8 quoted 205 -> 130; the 205 reproduces, the 130 does not fit a
      // brook this far east, so the measured 141 is used.
      id: "brookvault_planks", name: "Brook Planks", reqLevel: 1,
      position: [-78, -30], exitPosition: [-62, -26],
      durationMs: 2000, savesMeters: 66,
      assetId: "floor_wood", scale: 1.6, rotationY: 0.25,
      fromLocationId: "bank_interior", toLocationId: "redsill_shallows",
      interaction: "vault",
    },
    {
      // Bank -> Bracken Pit by road leaves through the east gate and bends at the milestone:
      // 27.2 + 76.5 + 102.2 = 205.9 m. Over the north wall: 32.0 + 130.0 = 162.0 m + 2.5 s.
      // Saves 43.9 m. PRD quoted 178 -> 118, but the pit is 160 m north of a town square that
      // contains the bank, so 118 m of walking is geometrically impossible. Measured values used.
      id: "wall_vault", name: "Wall Vault", reqLevel: 3,
      position: [-160, -56], exitPosition: [-160, -50],
      durationMs: 2500, savesMeters: 44,
      assetId: "wall_plaster_straight", scale: 1,
      fromLocationId: "bank_interior", toLocationId: "bracken_pit",
      interaction: "vault",
    },
  ],

    enemyGroups: [
    // Fallowmarch is the plain: hens, cattle, goats and coneys on open grass, frogs on the water at
    // its edges, and one adder in the copse. Nothing here is large, and only the goats start a
    // fight in the open.
    {
      // On the Redsill shallows, which is the water the Fishing tutorial already sends you to. The
      // group centre sits 23 m south-west of the pond centre so the spread straddles the bank
      // rather than sinking into the basin floor: the shoreline is at radius 21 and this spans
      // roughly 11 to 35 m out.
      //
      // This is the first thing most characters kill. PRD 2.4 solves two of its rows against these
      // exact numbers, so the frog inherited them whole - see `frog_t1` in content/enemies.ts.
      id: "redsill_frogs", family: "frog", name: "Frog", tier: 1,
      count: 6, centre: [-56, -72], radius: 12,
      // 0.32 m of frog native. 2.2 x 0.90 draws it 0.63 m long, which is a big frog and a small
      // enemy - readable on the bank without pretending to be dangerous.
      assetId: "animal_frog", scale: 2.2,
    },
    {
      // The smaller gated pen inside the Marchfield farm yard. Twelve hens make it read as a real
      // flock at a glance; passive at 3 m, so the enclosure stays harmless unless attacked.
      id: "marchfield_hens", family: "hen", name: "Hen", tier: 1,
      count: 12, centre: [-93, -21], radius: 2.1,
      assetId: "animal_chicken", scale: 1.0,
    },
    {
      // A second flock on the Bracken Pit track, on the speckled texture so the two groups do not
      // read as one flock spread over 100 m.
      id: "bracken_hens", family: "hen", name: "Speckled Hen", tier: 1,
      count: 4, centre: [-152, 44], radius: 16,
      assetId: "animal_chicken_speckled", scale: 1.0,
    },
    {
      // The aggressive tier 1 spawn, on the west track between Coldbrace and the Open March camp.
      // 77 m from the square at its nearest, so it cannot become the closest enemy to town.
      id: "open_march_goats", family: "goat", name: "Goat", tier: 1,
      count: 4, centre: [-250, 30], radius: 26,
      // 1.29 m of goat native. 0.85 x 0.90 draws a 0.99 m animal against a 1.82 m player.
      assetId: "animal_goat", scale: 0.85,
    },
    {
      // A few cattle graze south-west of the homestead, clear of the road and close enough to read
      // as part of the same yard. Territorial at 5 m, so they do not start an early-game fight.
      id: "redsill_cattle", family: "cattle", name: "Cow", tier: 1,
      count: 4, centre: [-110, -34], radius: 5,
      // 1.57 m native, drawn at 1.41 m. Shorter than the player and roughly three times the mass.
      assetId: "animal_cattle", scale: 1.0,
    },
    {
      // RARE on the plain, by design and by the brief. Two of them, spread over a 22 m radius of
      // open ground between the Bracken Pit track and the Marchfield, so meeting one is luck. The
      // forest group at Rootfall is the one a player can rely on finding.
      id: "marchfield_coneys", family: "coney", name: "Rabbit", tier: 1,
      count: 2, centre: [-140, 10], radius: 22,
      assetId: "animal_rabbit", scale: 0.9,
    },
    {
      // The dead ground south of the Palewood Copse, 37 m from the woodcutting cluster: close
      // enough to be the reason you look up, territorial so it is not the reason you die.
      id: "palewood_adders", family: "viper", name: "Viper", tier: 1,
      count: 4, centre: [-320, -98], radius: 16,
      // 1.51 m of snake native, drawn 1.50 m long and 7 cm tall. Low to the ground on purpose.
      assetId: "animal_viper", scale: 1.1,
    },
    {
      // The one human threat in Fallowmarch, unchanged. Humanoid, via the same body + parts path
      // the NPCs use: `render/entityViews.ts` maps a clothes-only outfit id onto `base_male` and
      // layers a per-entity hair pick on top, which is why three Reavers standing together are
      // three different men rather than three copies.
      id: "march_road_reavers", family: "reaver", name: "Road Bandit", tier: 1,
      count: 3, centre: [-234, -24], radius: 16,
      assetId: "outfit_male_peasant", scale: 1.12,
    },
    {
      // West of the cache and well clear of its approach road. The four-metre hovering silhouette
      // is visible over the plain before its territorial leash can pull a traveller into combat.
      id: "tempest_roc", family: "tempest_roc", name: "Storm Scarab", tier: 1,
      count: 1, centre: [-292, -156], radius: 0,
      // 2.63 m of rig. Boss scaling in `world/regionBuilder.ts` is 1.6x on top of this, and the
      // tier 1 silhouette is 0.90, so it is drawn 3.79 m long — the biggest thing in Fallowmarch
      // by a distance, which is the whole point of a region boss on a map of hens and coneys.
      // Health, aggro radius, behaviour and the displayed level all come from `tempest_roc_t1` in
      // content/enemies.ts, never from here.
      assetId: "boss_rhino_air", scale: 1,
      boss: true,
    },
    {
      // The tier 1 regional miniboss, on the open rise north-west of the Palewood Copse — well
      // off every road and outside the copse cluster, so meeting it is a choice. `miniBoss` keeps
      // the "boss" archetype and respawn window but draws at 1.3x rather than 1.6x and stamps
      // `meta.rank: "miniboss"`. Stats, drops and the 10% rare-weapon rolls live on
      // `galeskin_t1` in content/enemies.ts.
      id: "galeskin", family: "galeskin", name: "Plains Ogre", tier: 1,
      count: 1, centre: [-300, 145], radius: 0,
      assetId: "miniboss_galeskin", scale: 1,
      miniBoss: true,
    },
  ],

  landmarks: [
    {
      id: "fallowmarch_air_altar_ruins", name: "Air Altar Ruins", position: [-250, -150],
      assetId: "altar_ruins_site", scale: 1, rotationY: 0, solid: false, originOnGround: true,
      blurb: "A dormant stone court ringed by Air Essence. The Storm Scarab's Orb is its missing light.",
    },
    {
      // Round-1 critique finding 8: this was a bare `roof_tower` cone standing on the grass - the
      // "floating red cone" in r1-town-center. The tower's mass now comes from the `coldbrace_vault`
      // building (prefab `tower`, two brick storeys under the spire) at (-168,-90), and the landmark
      // moved 3.3 m south onto its doorway - a hero mesh that belongs at ground level, facing the
      // south gate the player spawns at.
      id: "march_vault_tower", name: "Trade Company Vault Tower", position: [-168, -93.3],
      assetId: "door_frame_round", scale: 1.5, rotationY: Math.PI,
      composition: "vault_door",
      blurb: "The tallest thing on the plain. Visible from 300 m, which is the entire point of it.",
    },
    {
      id: "broken_milestone", name: "The Broken North Milestone", position: [-108, -8],
      // No sign or milestone mesh exists (asset-report gap 11). A short brick wall reads as a
      // snapped stone marker; the composition puts the broken-off top on the ground beside it and
      // kerbs the road, so it reads as a marker rather than a random piece of wall.
      assetId: "wall_brick_straight", scale: 0.7, rotationY: 0.4,
      composition: "milestone",
      blurb: "Snapped off at the knee. Whatever it counted down to, nobody here has been there.",
    },
    {
      // Five metres off the three-way junction, facing the road back to Coldbrace. The compact
      // marker stays about 3.8 m from the nearest stamped lane centre, close enough to read as a
      // shoulder waypost without putting its post in the 3.2 m cart track.
      id: "west_track", name: "West Track Waypost", position: [-233, -64],
      assetId: "corner_wood", scale: 0.9, rotationY: 1.8,
      composition: "path_waypoint",
      blurb: "Three weathered arms: Millfield, Pine, and Open Meadow.",
    },
    {
      id: "lone_dead_palewood", name: "The Lone Pine", position: [-196, 24],
      assetId: "tree_dead_3", scale: 0.85,
      blurb: "One dead Pine at the top of the rise. Every direction from here looks the same.",
    },
    {
      // Farming gameplay stays retired. The old composition is useful scenery on its own: a
      // farmhouse, an outer paddock, a second gated chicken pen, and ordinary yard clutter. Crop
      // beds were separate resource entities and remain absent from the authored clusters above.
      id: "marchfield_farmstead", name: "Meadow Farm", position: [-96, -22],
      assetId: "farm_crate_empty", scale: 0.8, rotationY: 0,
      composition: "farm_yard",
      blurb: "A weathered farmhouse with two fenced yards, a crowded hen pen, and cattle nearby.",
    },
  ],

  gates: [
    {
      id: "fallowmarch_north_gate", name: "North Gate", position: [-26, 118],
      assetId: "wall_arch", toRegionId: "vellenwood", toLocationId: "vellenwood_marchgate",
      rotationY: Math.PI / 2, composition: "region_gate",
    },
  ],

  adjacency: [
    { toRegionId: "vellenwood", fromLocationId: "fallowmarch_north_gate", toLocationId: "vellenwood_marchgate", meters: 14.6 },
    // The open Kilnhalt seam: a route edge with no gate entity, because the border is walkable
    // at any x. (-160,192) -> (-160,214) is 22 m of plain ground.
    { toRegionId: "kilnhalt", fromLocationId: "fallowmarch_kiln_road", toLocationId: "kilnhalt_south_track", meters: 22 },
  ],
};

// =============================================================== VELLENWOOD

/**
 * Tier 5 deep woodland. The gorge runs north-west to south-east from (110,200) to (250,20); every
 * feature is placed on a known side of it, which is what gives the three Agility shortcuts here
 * something real to shorten. Rootfall, the Duskoak Stand, and Blackwater Pools are west of the
 * gorge; the Thornline is east, reachable on foot only by the ford at (230,44) or the head at
 * (104,192).
 */
const VELLENWOOD: RegionDef = {
  id: "vellenwood",
  name: "Woodlands",
  tier: 5,
  lore:
    "Within two hundred metres of the gate the sky closes. The Ash here are old enough that " +
    "the Trade Company surveyors marked them as terrain rather than trees. Oakwood is the only " +
    "settlement: nine buildings and a bank chest built on and around a stump so large the stump " +
    "is the town square. The people there will tell you which paths are safe. They will not tell " +
    "you why the stags only move at the edges of the clearings.",
  bounds: { min: [-20, 10], max: [350, 200] },
  terrainSeed: 0x5e11d,
  terrainAmplitude: 26,
  baseHeight: 4,
  // Deep desaturated greens, bark browns pushed purple, a hard value break for shafted light.
  groundPalette: ["#3c5340", "#2b3a2e", "#4f6b4a", "#5c4a55", "#3a2f38", "#6f7f52", "#8fa26a", "#1d241f"],
  fogStart: 55,
  spawnPoint: [-12, 122],
  // Marchgate looks east down the track to Rootfall (60,120): atan2(72, -2) = 1.60 rad.
  spawnFacingRad: 1.6,
  respawnPointId: "rootfall",

  locations: [
    { id: "vellenwood_marchgate", name: "Forest Gate", position: [-12, 122], kind: "gate", routeNode: true,
      blurb: "Woodlands's gate onto the Farm Road. Named for the direction, not the compass." },
    { id: "rootfall_hamlet", name: "Oakwood", position: [64, 127], kind: "settlement", routeNode: true,
      blurb: "Nine buildings around a Ash stump the size of a square." },
    { id: "rootfall_bank", name: "Oakwood Bank Chest", position: [60, 128], kind: "bank", routeNode: true,
      blurb: "One chest, set into the stump. Thirty-eight metres from the Forest Quarry." },
    { id: "hollowcut_seam", name: "Forest Quarry", position: [94, 145], kind: "seam", routeNode: true,
      blurb: "Five Iron seams, 38 m from the bank chest. The best XP in the game until Agility 10." },
    { id: "vellenwood_canopy", name: "Ash Grove", position: [14, 166], kind: "grove", routeNode: true,
      blurb: "Ten ash trees. The canopy closes hard enough here that pathing is the puzzle." },
    { id: "mire_skirt", name: "Marsh Edge", position: [-6, 120], kind: "junction", routeNode: true,
      blurb: "The long dry way around the standing water below the stand." },
    { id: "blackwater_pools", name: "Blackwater Pools", position: [128, 84], kind: "water", routeNode: true,
      blurb: "Five pools, deeper than they look. Trout." },
    { id: "gorge_ford", name: "Gorge Ford", position: [230, 44], kind: "junction", routeNode: true,
      blurb: "The southern crossing of the gorge. Slow, wet, and the only way across without Agility." },
    { id: "gorge_head", name: "Gorge Head", position: [104, 192], kind: "junction", routeNode: true,
      blurb: "Where the gorge peters out against the northern ridge." },
    { id: "thornline_camp", name: "The Thicket", position: [196, 152], kind: "camp", routeNode: true,
      blurb: "The edge the vipers keep to. They do not enter the clearings and nobody says why." },
    { id: "vellenwood_earth_cache", name: "Earth Essence Cache", position: [262, 176], kind: "landmark", routeNode: true,
      blurb: "An old stone heart under the eastern canopy, split through with earth essence." },
    { id: "vellenwood_east_gate", name: "Mountain Gate", position: [250, 24], kind: "gate", routeNode: true,
      blurb: "The east gate. On a clear day you can see the Highlands ridge from it." },
    { id: "vellenwood_kiln_path", name: "Kiln Path", position: [150, 194], kind: "junction", routeNode: true,
      blurb: "A foot track over the northern ridge toward the ember foothills. No gate; it never needed one." },
    { id: "vellenwood_ember_edge", name: "Ash Border", position: [286, 194], kind: "junction", routeNode: true,
      blurb: "The canopy's last shade line. North of here the trees stand scorched and far apart." },
  ],

  roads: [
    { from: "vellenwood_marchgate", to: "rootfall_hamlet" },
    { from: "rootfall_hamlet", to: "rootfall_bank" },
    { from: "rootfall_bank", to: "hollowcut_seam" },
    { from: "rootfall_hamlet", to: "mire_skirt" },
    { from: "mire_skirt", to: "vellenwood_canopy" },
    { from: "rootfall_hamlet", to: "blackwater_pools" },
    { from: "blackwater_pools", to: "gorge_ford" },
    { from: "gorge_ford", to: "thornline_camp" },
    { from: "gorge_ford", to: "vellenwood_east_gate" },
    { from: "rootfall_hamlet", to: "gorge_head" },
    { from: "gorge_head", to: "thornline_camp" },
    { from: "thornline_camp", to: "vellenwood_earth_cache" },
    { from: "thornline_camp", to: "vellenwood_east_gate" },
    { from: "gorge_head", to: "vellenwood_kiln_path" },
    { from: "vellenwood_earth_cache", to: "vellenwood_ember_edge" },
  ],

  clusters: [
    {
      id: "hollowcut_corven", resourceId: "ore_corven",
      count: 5, centre: [94, 145], radius: 9,
      locationId: "hollowcut_seam",
    },
    {
      id: "duskoak_stand_trees", resourceId: "tree_duskoak",
      count: 10, centre: [14, 166], radius: 20,
      // Was tree_twisted_1. That family carries the `Leaves_TwistedTree` texture, whose sampled
      // mean is rgb(105,79,84) — an autumn tree. Ten of them at the heart of the region is what
      // made Vellenwood read crimson, and the tier tint cannot fix it: tinting multiplies
      // `material.color` against the texture, so it can darken a red leaf but can never re-hue one.
      // tree_common_2 carries the green `Leaves_NormalTree` texture, and staying off the scatter
      // canopy's 3 and 5 keeps the choppable tree distinguishable from the dressing. Scale 1.15
      // holds the old-growth read that 0.55 on a larger source mesh was buying.
      locationId: "vellenwood_canopy",
    },
    {
      id: "blackwater_spots", resourceId: "fish_bramble_trout",
      count: 5, centre: [128, 84], radius: 12,
      locationId: "blackwater_pools",
    },
    {
      id: "vellenwood_earth_essence_cache", resourceId: "essence_earth",
      count: 5, centre: [262, 176], radius: 12, ringRadius: 12,
      essenceElement: "earth",
      locationId: "vellenwood_earth_cache",
    },
  ],

  stations: [REGIONAL_ESSENCE_ALTARS.vellenwood],
  settlement: ROOTFALL,

  obstacles: [
    {
      // Rootfall -> Duskoak Stand on foot has to skirt the standing water via Mire Skirt:
      // 66.0 + 50.2 = 116.2 m. Over the canopy: 26.9 to the first platform + 11.7 off the last
      // = 38.6 m + 4.0 s. Saves 77.6 m, and 27.7 s of walking becomes 13.2 s.
      id: "canopy_walk", name: "Canopy Walk", reqLevel: 6,
      position: [40, 138], exitPosition: [24, 172],
      durationMs: 4000, savesMeters: 78,
      // The straight line to Rootfall crosses its west wall, so face the stair down the actual
      // approach from the west gate at (44,124): obstacle -> gate is (+4,-14), bearing 2.86.
      // A stair hero reads as an actual climb start; the former balcony hero was a loose fence.
      assetId: "stairs_exterior", composition: "canopy_walk_entrance", scale: 1.4, rotationY: 2.86,
      fromLocationId: "rootfall_hamlet", toLocationId: "vellenwood_canopy",
      interaction: "climb",
    },
    {
      // Blackwater Pools -> Thornline on foot goes right round to the ford: 109.6 + 113.2 =
      // 222.8 m. Over the fallen tree: 52.0 + 56.1 = 108.1 m + 3.0 s. Saves 114.7 m.
      // PRD quoted 85 m; that assumed a 380 m region. Measured value used.
      id: "fallen_duskoak", name: "The Fallen Ash", reqLevel: 5,
      position: [176, 104], exitPosition: [200, 96],
      durationMs: 3000, savesMeters: 115,
      // `roof_log` is a 10.7 m timber beam - the only asset in the library shaped like a felled
      // trunk lying across a gap. The tree meshes cannot be laid flat: `view` has rotationY only.
      assetId: "roof_log", scale: 1.5, rotationY: -0.32,
      fromLocationId: "blackwater_pools", toLocationId: "thornline_camp",
      interaction: "climb",
    },
    {
      // Oakwood -> Thornline on foot goes round the gorge head: 176.6 m.
      // The entrance now stands outside the Hollowcut Postern instead of being pinched between
      // the forge, townhouse and gate. Through the roots: 24.6 + 8.2 m + 3.5 s, saving
      // about 144 m while giving the authored arch an unobstructed approach.
      id: "root_tunnel", name: "Root Tunnel", reqLevel: 8,
      position: [86, 138], exitPosition: [188, 154],
      durationMs: 3500, savesMeters: 144,
      // Local +Z faces west through the postern, the direction players actually approach from.
      assetId: "wall_arch", composition: "root_tunnel_entrance", scale: 1.2, rotationY: -Math.PI / 2,
      fromLocationId: "rootfall_hamlet", toLocationId: "thornline_camp",
      interaction: "enter",
    },
  ],

    enemyGroups: [
    // Vellenwood is the forest: deer and coyotes under the canopy, hogs in the bramble, coneys in
    // numbers, adders on the Thornline, and frogs on the Blackwater Pools.
    {
      // The Duskoak Stand. Territorial at 9 m, which is a rutting hart: the one deer that does not
      // run. Carries PRD 2.4's tier 5 defensive row (defenceLevel 7 / armour 10) verbatim.
      id: "duskoak_stags", family: "deer", name: "Stag", tier: 5,
      count: 5, centre: [10, 186], radius: 18,
      // 1.87 m native including the antlers. 0.85 x 1.075 draws a 1.71 m animal, just under the
      // player's eye line, and the antler silhouette does the rest.
      assetId: "animal_deer", scale: 0.85,
    },
    {
      // The bramble between Rootfall and the Thornline. magicArmour 55 makes this the tier's "put
      // the staff away" fight, and aggressive at only 7 m makes it the one you walk into.
      id: "bramble_hogs", family: "hog", name: "Pig", tier: 5,
      count: 5, centre: [150, 128], radius: 20,
      assetId: "animal_hog", scale: 1.0,
    },
    {
      // Deep wood north-west of Rootfall. The pack hunter, and the block a staff answers:
      // magicArmour 8 against the hog's 55, 100 m apart.
      id: "deepwood_coyotes", family: "coyote", name: "Forest Wolf", tier: 5,
      count: 4, centre: [46, 158], radius: 22,
      assetId: "animal_coyote", scale: 0.9,
    },
    {
      // On the Blackwater Pools, 20 m off the pond centre so the spread sits on the bank. The tier
      // 5 swarm, on the same 1200 ms cadence as the Marchfield hens.
      id: "blackwater_frogs", family: "frog", name: "Green Frog", tier: 5,
      count: 7, centre: [112, 96], radius: 14,
      assetId: "animal_frog_green", scale: 2.4,
    },
    {
      // COMMON in the forest, which is the other half of the coney rule: six here against two on
      // the whole Fallowmarch plain. Still the cheapest thing in the region to kill, and still
      // passive at 2 m.
      id: "rootfall_coneys", family: "coney", name: "Forest Rabbit", tier: 5,
      count: 6, centre: [76, 150], radius: 26,
      assetId: "animal_rabbit_dark", scale: 0.9,
    },
    {
      // The Thornline. Armour 6 is the lowest in Vellenwood and max hit 8 is the biggest single
      // blow in it: it dies fast and takes a quarter of your health with it if the roll goes badly.
      id: "thornline_adders", family: "viper", name: "Forest Viper", tier: 5,
      count: 4, centre: [196, 152], radius: 18,
      assetId: "animal_viper", scale: 1.2,
    },
    {
      id: "gorge_reavers", family: "reaver", name: "Forest Bandit", tier: 5,
      count: 3, centre: [214, 64], radius: 16,
      assetId: "outfit_female_ranger", scale: 0.95,
    },
    {
      // East of the cache, outside the cache ring and its Thornline approach. The scaled old-growth
      // tree is a six-metre combat silhouette without placing its roots across the route.
      id: "rootheart", family: "rootheart", name: "Rootbound Colossus", tier: 5,
      count: 1, centre: [304, 158], radius: 0,
      // The same rig as the Tempest Roc, in earth. Drawn 4.52 m long here against Fallowmarch's
      // 3.79, because the tier 5 silhouette is 1.075 against tier 1's 0.90: one creature, three
      // powers, and it grows with the tier that fields it. Stats come from `rootheart_t5`.
      assetId: "boss_rhino_earth", scale: 1,
      boss: true,
    },
    {
      // The tier 5 regional miniboss, on the dry ground south-east of the Thornline where the
      // canopy opens — clear of the gorge reavers' patrol and the two east roads. Same rig as the
      // other three minibosses in this pack's moss variant; stats and the rare rolls live on
      // `mossbound_t5` in content/enemies.ts.
      id: "mossbound", family: "mossbound", name: "Forest Ogre", tier: 5,
      count: 1, centre: [318, 72], radius: 0,
      assetId: "miniboss_mossbound", scale: 1,
      miniBoss: true,
    },
  ],

  landmarks: [
    {
      id: "vellenwood_earth_altar_ruins", name: "Earth Altar Ruins", position: [262, 176],
      assetId: "altar_ruins_site", scale: 1, rotationY: 0, solid: false, originOnGround: true,
      blurb: "A root-bound stone court ringed by Earth Essence. Rootbound Colossus's Orb can wake it.",
    },
    {
      id: "rootfall_stump", name: "The Oakwood Stump", position: [60, 120],
      // Native cut face and four stone flights share exact geometry with the navigation source.
      assetId: "corealm_stump_oak", scale: 4, solid: false, originOnGround: true,
      composition: "rootfall_stump",
      blurb: "The stump is the square. Stone steps climb its southeast face.",
    },
    {
      id: "split_duskoak", name: "The Split Ash", position: [170, 112],
      assetId: "tree_twisted_2", scale: 0.8, rotationY: 1.1,
      blurb: "Split top to root by something, a long time ago. It is still alive on one side.",
    },
    {
      // The dry wedge between the east-west trail and the canopy branch. Both stamped lane
      // centrelines stay about four metres away, so the marker reads as the junction's shoulder
      // without blocking either route.
      id: "mire_skirt", name: "Marsh Edge Trailhead", position: [0, 124],
      assetId: "corner_wood", scale: 1.0, rotationY: Math.PI / 2,
      composition: "path_waypoint",
      blurb: "A moss-dark trail marker where the dry path skirts the standing water.",
    },
    {
      id: "thornline_stones", name: "The Thicket Stones", position: [206, 168],
      // Was `boulder_medium` at 1.1, which is one of the six untextured platformer rocks: a 5.3 m
      // smooth tan cone standing in the middle of four textured grey ones. `rock_medium_2` carries
      // TEXCOORD_0 and the shared Rocks atlas, so the hero belongs to its own ring.
      assetId: "rock_medium_2", scale: 1.35,
      composition: "standing_stones",
      blurb: "Standing stones at the clearing edge. The stags will not cross them.",
    },
  ],

  gates: [
    { id: "vellenwood_marchgate", name: "Forest Gate", position: [-12, 122], assetId: "wall_arch", toRegionId: "fallowmarch", toLocationId: "fallowmarch_north_gate", rotationY: Math.PI / 2, composition: "region_gate" },
    { id: "vellenwood_east_gate", name: "Mountain Gate", position: [250, 24], assetId: "wall_arch", toRegionId: "karrowmoor", toLocationId: "karrowmoor_north_gate", rotationY: 0, composition: "region_gate" },
  ],

  adjacency: [
    { toRegionId: "fallowmarch", fromLocationId: "vellenwood_marchgate", toLocationId: "fallowmarch_north_gate", meters: 14.6 },
    { toRegionId: "karrowmoor", fromLocationId: "vellenwood_east_gate", toLocationId: "karrowmoor_north_gate", meters: 22.8 },
    // Two open crossings of the Kilnhalt seam, gateless like Fallowmarch's.
    { toRegionId: "kilnhalt", fromLocationId: "vellenwood_kiln_path", toLocationId: "kilnhalt_vellen_track", meters: 20 },
    { toRegionId: "kilnhalt", fromLocationId: "vellenwood_ember_edge", toLocationId: "kilnhalt_east_track", meters: 20.4 },
  ],
};

// =============================================================== KARROWMOOR

/**
 * Tier 10 stone highlands. Four terraces climbing southward, 62 m of elevation across them.
 * The terrace bands are what make the road from Highcairn to the Upper Karrow Seam 188 m long
 * while the straight line is only 61 m - which is the whole reason Sunder Ledge is worth 10
 * Agility levels. See the DISTANCE LEDGER at the top of this file.
 */
const KARROWMOOR: RegionDef = {
  id: "karrowmoor",
  name: "Highlands",
  tier: 10,
  lore:
    "Farmland tilted sixty degrees with the soil taken away. The moor climbs in terraces of " +
    "grey slate and every flat surface on it is covered in cairns nobody in Hillcrest built and " +
    "nobody in Hillcrest will move. The outpost is a quarry camp with a wall, kept alive by " +
    "Cobalt and by the fact that the crew stopped digging six months ago. What they hit was the " +
    "Stone Cavern. They have a rota for who watches the entrance. They have never discussed sealing it.",
  bounds: { min: [-20, -200], max: [350, 10] },
  terrainSeed: 0x0ca770,
  terrainAmplitude: 62,
  baseHeight: 8,
  terraces: [
    { index: 1, minZ: -40, maxZ: 10, height: 0 },
    { index: 2, minZ: -76, maxZ: -40, height: 18 },
    { index: 3, minZ: -112, maxZ: -76, height: 36 },
    { index: 4, minZ: -200, maxZ: -112, height: 54 },
  ],
  // Cold blue-grey slate, lichen green-yellow, one warm firelight per camp.
  groundPalette: ["#6b7480", "#525a66", "#7d8791", "#8e9a86", "#a8b06a", "#3e444d", "#c8813c", "#d3d8dd"],
  fogStart: 140,
  spawnPoint: [256, 4],
  // Moorgate looks WSW down the quarry road to the Moor Road Bend (170,-6): atan2(-86,-10) = -1.69.
  spawnFacingRad: -1.69,
  respawnPointId: "highcairn",

  locations: [
    { id: "karrowmoor_north_gate", name: "Highland Gate", position: [256, 4], kind: "gate", routeNode: true,
      blurb: "Where the Woodlands road tips over onto the first terrace." },
    { id: "moor_road_bend", name: "Moor Road Bend", position: [170, -6], kind: "junction", routeNode: true,
      blurb: "The quarry road forks here: down to the Lower Quarry, or up to Hillcrest." },
    { id: "karrowmoor_terraces", name: "Lower Quarry", position: [140, -16], kind: "seam", routeNode: true,
      blurb: "Terrace one. Five Cobalt faces, and the hole the crew stopped digging." },
    { id: "gravelmaw_entrance", name: "Stone Cavern", position: [46, -24], kind: "dungeon", routeNode: true,
      blurb: "A twelve-metre black wound in grey stone. Visible from anywhere on terrace one." },
    { id: "highcairn_outpost", name: "Hillcrest", position: [144, -66], kind: "settlement", routeNode: true,
      blurb: "Terrace two. A quarry camp with a wall around it and a crane it no longer uses." },
    { id: "highcairn_bank", name: "Hillcrest Bank", position: [150, -70], kind: "bank", routeNode: true,
      blurb: "One counter. 188 m from the Upper Cobalt Seam by road, 46 m over Broken Ledge." },
    { id: "karrow_ramp_two", name: "Second Ramp", position: [100, -80], kind: "junction", routeNode: true,
      blurb: "The slate ramp from terrace two to terrace three." },
    { id: "karrow_ramp_three", name: "Third Ramp", position: [118, -138], kind: "junction", routeNode: true,
      blurb: "The long ramp onto terrace four. Everything above here is exposed." },
    { id: "upper_karrow_seam", name: "Upper Cobalt Seam", position: [194, -132], kind: "seam", routeNode: true,
      blurb: "Three Cobalt faces on terrace four. A small seam - it genuinely runs dry above Mining 20." },
    { id: "great_cairn", name: "The Great Cairn", position: [140, -176], kind: "landmark", routeNode: true,
      blurb: "The largest cairn on the moor. Nobody will say who is under it." },
    { id: "cairn_tarns", name: "Mountain Lakes", position: [206, -88], kind: "water", routeNode: true,
      blurb: "Two black tarns on the terrace two lip. Perch in both." },
    { id: "ridge_pines", name: "Ridge Oaks", position: [250, -96], kind: "grove", routeNode: true,
      blurb: "Eight oak trees on terrace three, all bent the same way." },
    { id: "far_tarn", name: "Far Lake", position: [284, -110], kind: "water", routeNode: true,
      blurb: "Across the terrace three gap. Two more tarns, and nobody fishing them." },
    { id: "tarn_track", name: "Lake Trail", position: [300, -80], kind: "junction", routeNode: true,
      blurb: "The long way round the terrace three gap." },
    { id: "karrowmoor_water_cache", name: "Water Essence Cache", position: [328, -176], kind: "landmark", routeNode: true,
      blurb: "A blue-lit cache at the moor's far edge, where water essence beads on dry slate." },
  ],

  roads: [
    { from: "karrowmoor_north_gate", to: "moor_road_bend" },
    { from: "moor_road_bend", to: "karrowmoor_terraces" },
    { from: "karrowmoor_terraces", to: "gravelmaw_entrance" },
    { from: "moor_road_bend", to: "highcairn_outpost" },
    { from: "karrowmoor_terraces", to: "highcairn_outpost" },
    { from: "highcairn_outpost", to: "highcairn_bank" },
    { from: "highcairn_bank", to: "karrow_ramp_two" },
    { from: "karrow_ramp_two", to: "karrow_ramp_three" },
    { from: "karrow_ramp_three", to: "upper_karrow_seam" },
    { from: "karrow_ramp_three", to: "great_cairn" },
    { from: "highcairn_outpost", to: "cairn_tarns" },
    { from: "cairn_tarns", to: "ridge_pines" },
    { from: "ridge_pines", to: "tarn_track" },
    { from: "tarn_track", to: "far_tarn" },
    { from: "far_tarn", to: "karrowmoor_water_cache" },
  ],

  clusters: [
    {
      id: "lower_quarry_kaldite", resourceId: "ore_kaldite",
      count: 5, centre: [140, -16], radius: 10,
      locationId: "karrowmoor_terraces",
    },
    {
      // Three nodes on purpose. Architecture R5: this seam genuinely runs dry above Mining 20,
      // which is what pushes a player back to the Lower Quarry or onto the Sunder Ledge circuit.
      id: "upper_karrow_kaldite", resourceId: "ore_kaldite",
      count: 3, centre: [194, -132], radius: 7,
      locationId: "upper_karrow_seam",
    },
    {
      id: "ridge_pines_trees", resourceId: "tree_cairnpine",
      count: 8, centre: [250, -96], radius: 18,
      locationId: "ridge_pines",
    },
    {
      id: "cairn_tarn_spots", resourceId: "fish_cragfin",
      count: 2, centre: [206, -88], radius: 8,
      locationId: "cairn_tarns",
    },
    {
      id: "far_tarn_spots", resourceId: "fish_cragfin",
      count: 2, centre: [284, -110], radius: 7,
      locationId: "far_tarn",
    },
    {
      id: "karrowmoor_water_essence_cache", resourceId: "essence_water",
      count: 5, centre: [328, -176], radius: 12, ringRadius: 12,
      essenceElement: "water",
      locationId: "karrowmoor_water_cache",
    },
  ],

  stations: [REGIONAL_ESSENCE_ALTARS.karrowmoor],
  settlement: HIGHCAIRN,

  obstacles: [
    {
      // THE FLIP. Road: 51.0 + 60.7 + 76.2 = 187.9 m. Ledge: 20.4 + 25.5 = 45.9 m + 6.0 s.
      // Saves 142.0 m. See the DISTANCE LEDGER at the top of this file for the XP/hr arithmetic.
      id: "sunder_ledge", name: "Broken Ledge", reqLevel: 10,
      position: [170, -74], exitPosition: [176, -114],
      durationMs: 6000, savesMeters: 142,
      // The Stylized Nature kit tops out at a 3.2 m rock; the platformer pack's cliff steps are
      // the only 5-7 m stone in the library (asset-report gap 9). Tinted to the slate palette.
      assetId: "cliff_step_2", scale: 1.2, rotationY: 0.4,
      fromLocationId: "highcairn_bank", toLocationId: "upper_karrow_seam",
      interaction: "climb",
    },
    {
      // One-way downhill to the open apron west of the relocated quarry. The route graph
      // measures both approaches from the authored endpoints when choosing this shortcut.
      id: "scree_slide", name: "Rockslide", reqLevel: 12,
      position: [96, -170], exitPosition: [108, -24],
      // Current road ledger: 213 m around minus 77.39 m of entry/exit approaches.
      durationMs: 3200, savesMeters: 136,
      assetId: "cliff_step_3", scale: 1.3,
      fromLocationId: "great_cairn", toLocationId: "karrowmoor_terraces",
      oneWay: true,
      interaction: "climb",
    },
    {
      // Opens the second tarn pair as a fishing circuit. Round the gap: 52.5 + 34.0 = 86.5 m.
      // Across it: 8.9 + 14.4 = 23.3 m + 3.0 s. Saves 63.2 m.
      id: "cairn_leap", name: "Cairn Leap", reqLevel: 14,
      position: [246, -104], exitPosition: [272, -118],
      durationMs: 3000, savesMeters: 63,
      // Same swap as `thornline_stones`: `boulder_medium` has no UVs and cannot be tinted or
      // textured at any tier. `rock_medium_3` at 1.5 is the same 5.1 m mass and reads as stone.
      assetId: "rock_medium_3", scale: 1.5,
      fromLocationId: "ridge_pines", toLocationId: "far_tarn",
      interaction: "vault",
    },
  ],

    enemyGroups: [
    // Karrowmoor is rock: bears and boar on the scree, ibex on the ridge, the last aurochs herd on
    // the terraces, and coyotes down at the tarns. Everything here is big.
    {
      // The cairn fields. Carries PRD 2.4's "Melee 12 Kaldite sword, 46%, 33 s" row (defenceLevel
      // 11 / armour 55), and its magicArmour 10 against that armour 55 is the half of the magic
      // gate where the staff wins by 27%. Aggressive at 10 m and the largest silhouette on the moor.
      id: "highcairn_bears", family: "bear", name: "Brown Bear", tier: 10,
      count: 4, centre: [100, -110], radius: 26,
      // 2.46 m of bear native. 1.0 x 1.15 draws it 2.83 m long and 1.62 m tall - shorter than the
      // player at the shoulder and about four times the volume.
      assetId: "animal_bear", scale: 1.0,
    },
    {
      // The scree south of Highcairn. The other half of the magic gate: armour 30 against
      // magicArmour 115, so melee wins here by 10% and the staff is the wrong tool.
      id: "scree_boars", family: "boar", name: "Wild Boar", tier: 10,
      count: 6, centre: [170, -160], radius: 24,
      assetId: "animal_boar", scale: 1.0,
    },
    {
      // The ridge line above the far tarn. 44 health is the biggest ordinary pool on the surface
      // and the resistances are symmetric, so this is the block you simply have to out-fight.
      id: "ridge_ibex", family: "ibex", name: "Ibex", tier: 10,
      count: 3, centre: [268, -140], radius: 18,
      assetId: "animal_ibex", scale: 0.95,
    },
    {
      // The terraces above the lower quarry. Armour 78 against magicArmour 0 is the widest split in
      // the game, and at 1.1 x 1.15 this is the largest non-boss animal in Corealm at 3.20 m long:
      // the last aurochs herd anywhere, and it reads like it.
      id: "terrace_aurochs", family: "aurochs", name: "Aurochs", tier: 10,
      count: 3, centre: [72, -44], radius: 14,
      assetId: "animal_aurochs", scale: 1.1,
    },
    {
      // Down at the Cairn Tarns, where the fishing is. 1800 ms is the fastest tier 10 cadence, so
      // this is the thing that punishes standing still at the water's edge.
      id: "tarn_coyotes", family: "coyote", name: "Dire Wolf", tier: 10,
      count: 4, centre: [228, -70], radius: 14,
      assetId: "animal_coyote", scale: 0.95,
    },
    {
      id: "karrow_reavers", family: "reaver", name: "Highland Bandit", tier: 10,
      count: 4, centre: [148, -128], radius: 12,
      assetId: "outfit_male_ranger", scale: 0.90,
    },
    {
      // The tier 10 regional miniboss, on the bare top-terrace shelf west of the Great Cairn —
      // above the Scree Slide entrance and away from every road, so the climb to it is deliberate.
      // Stats and the rare rolls live on `tideworn_t10` in content/enemies.ts.
      id: "tideworn", family: "tideworn", name: "Cave Ogre", tier: 10,
      count: 1, centre: [18, -164], radius: 0,
      assetId: "miniboss_tideworn", scale: 1,
      miniBoss: true,
    },
  ],

  landmarks: [
    {
      id: "karrowmoor_water_altar_ruins", name: "Water Altar Ruins", position: [328, -176],
      assetId: "altar_ruins_site", scale: 1, rotationY: 0, solid: false, originOnGround: true,
      blurb: "A rain-cut stone court ringed by Water Essence. Quarry Warden's Orb can wake it.",
    },
    {
      // North shoulder of the long Moor Road descent, 4.5 m from its centreline and outside the
      // Kaldite cluster. A slate post over a cairn foot now reads as part of the quarry arrival.
      id: "lower_quarry_waystone", name: "Lower Quarry Waystone", position: [157, -14],
      assetId: "corner_brick", scale: 0.85, rotationY: 1.5,
      composition: "path_waypoint",
      blurb: "A quarry cairn marking the split between Hillcrest and Stone Cavern road.",
    },
    {
      // Southwest shoulder of the upper-ramp junction. The actual route node remains at
      // (118,-138); this marker is offset far enough that its side cairns cannot pinch either leg.
      id: "karrow_ramp_three", name: "Third Ramp Waystone", position: [110, -146],
      assetId: "corner_brick", scale: 0.78, rotationY: Math.PI / 4,
      composition: "path_waypoint",
      blurb: "A low slate marker at the last sheltered turn before the upper moor.",
    },
    {
      id: "highcairn_crane", name: "The Hillcrest Crane", position: [156, -64],
      // No crane mesh. Round 1 used `support_beam` at 3x, which floats: that asset's pivot is
      // 1.211 m BELOW the post, so a 3x copy started 3.6 m in the air. `corner_wood` is the only
      // asset in the library that is a plain vertical post standing on its own origin - at 3.2x it
      // is a 9.6 m mast, and the composition hangs a 9 m jib and the drum off it.
      assetId: "corner_wood", scale: 3.2, rotationY: 0.3,
      composition: "highcairn_crane",
      blurb: "It has not turned in six months. The rope is still on the drum.",
    },
    {
      id: "great_cairn_stone", name: "The Great Cairn", position: [140, -176],
      // The platformer boulder is an untextured truncated cone and remained visible through the
      // dressed ring. Use the same textured rock family as the composition so the semantic anchor
      // belongs to the cairn instead of reading as a placeholder at its centre.
      assetId: "rock_medium_2", scale: 1.8,
      composition: "great_cairn",
      blurb: "Head height and forty paces round. It was already old when the quarry opened.",
    },
    // The Gravelmaw mouth is a PRD landmark but it is not listed here: it is already the dungeon
    // portal entity, at the same position with the same mesh. Two entities stacked on one spot
    // would be two draw calls and two highlight rings for one thing the player sees.
  ],

  gates: [
    { id: "karrowmoor_north_gate", name: "Highland Gate", position: [256, 4], assetId: "wall_arch", toRegionId: "vellenwood", toLocationId: "vellenwood_east_gate", rotationY: 0, composition: "region_gate" },
  ],

  adjacency: [
    { toRegionId: "vellenwood", fromLocationId: "karrowmoor_north_gate", toLocationId: "vellenwood_east_gate", meters: 22.8 },
  ],

  dungeon: {
    id: "gravelmaw",
    name: "Stone Cavern",
    tier: 10,
    entrance: [46, -24],
    // `wall_brick_door` is a real masonry arch module. At 3x it fits inside the dressed rock face;
    // the surrounding quarry composition carries the broader twelve-metre silhouette.
    // Round 1 drew it unrotated and unaccompanied, which is why it read as a wooden door frame on
    // open ground. It now faces the approach from the Lower Quarry (60,-16): atan2(14,8) = 1.05.
    entranceAssetId: "wall_brick_door",
    entranceRotationY: 1.05,
    entranceScale: 3,
    entranceComposition: "gravelmaw_mouth",
    palette: ["#3a3f47", "#2a2e35", "#4a505a", "#5a6250", "#1b1e23", "#7a6a52", "#c86a2a", "#8f97a1"],
    chambers: [
      // The complete roof and partition walls stay beneath the lowest overlying terrain,
      // with at least one metre of rock cover. Relative chamber slopes remain unchanged.
      { id: "gravelmaw_chamber1", name: "The Lit Gallery", centre: [40, -40], radius: 11, floorOffset: -23.2, lit: true },
      { id: "gravelmaw_chamber2", name: "The Collapse", centre: [30, -58], radius: 12, floorOffset: -27.2, lit: false },
      { id: "gravelmaw_chamber3", name: "The Cairn Hall", centre: [22, -76], radius: 12, floorOffset: -31.2, lit: false },
      { id: "gravelmaw_arena", name: "The Quarry Warden's Floor", centre: [10, -96], radius: 12, floorOffset: -33.2, lit: true },
    ],
    doors: [
      {
        id: "gravelmaw_stone_door", name: "The Three-Lever Door", position: [26, -68], floorOffset: -29.2,
        // `cage` is the library's portcullis stand-in (asset-report gap 8).
        assetId: "cage", state: "locked",
        lockedReason: "Three stone levers hold it. The Long Cairn's fifth stage describes them.",
      },
      {
        id: "ordrun_gate", name: "The Quarry Warden's Gate", position: [14, -88], floorOffset: -32.2,
        assetId: "cage", state: "sealed",
        lockedReason: "Sealed until The Long Cairn is complete.",
      },
    ],
    obstacles: [
      {
        // This one is not about distance. Chamber 2 to chamber 3 is only 19.7 m on foot, but that
        // walk goes through the three-lever door, so below Agility 14 it is not a walk at all -
        // it is a puzzle. The chimney is 8.9 + 4.0 = 12.9 m of scramble plus 3.8 s, saving 6.8 m
        // and the whole lever sequence. It is the only route-graph edge between the two chambers,
        // on purpose; round 5 adds a conditional walk edge when the door is opened.
        id: "chimney_climb", name: "Chimney Climb", reqLevel: 14,
        position: [34, -66], exitPosition: [22, -80],
        durationMs: 3800, savesMeters: 7,
        assetId: "stairs_stone", scale: 1.1, rotationY: Math.PI,
        fromLocationId: "gravelmaw_chamber2", toLocationId: "gravelmaw_chamber3",
        interaction: "climb",
      },
    ],
        enemyGroups: [
      // Underground, and stocked to read as one: rats in the entry drifts, scorpions in the middle
      // workings, crabs in the flooded sump, and two cave bears standing between you and Ordrun.
      {
        id: "gravelmaw_ch1_rats", family: "rat", name: "Giant Rat", tier: 10,
        count: 4, centre: [40, -40], radius: 8,
        // 0.60 m of rat native. 1.8 x 1.15 draws it 1.24 m long and 0.29 m tall: low, quick and
        // clearly not an ordinary rat.
        assetId: "animal_rat", scale: 1.8,
      },
      {
        id: "gravelmaw_ch1_reavers", family: "reaver", name: "Highland Bandit", tier: 10,
        count: 2, centre: [44, -36], radius: 5,
        assetId: "outfit_male_ranger", scale: 0.90,
      },
      {
        // The middle workings. High armour AND high magicArmour, the only block in the game with
        // both, so nothing answers a scorpion cheaply and a player already committed to the dungeon
        // cannot re-kit to solve it.
        id: "gravelmaw_ch2_scorpions", family: "scorpion", name: "Giant Scorpion", tier: 10,
        count: 6, centre: [30, -58], radius: 9,
        assetId: "animal_scorpion", scale: 2.2,
      },
      {
        // The flooded sump. Armour 82 is the highest in the game.
        id: "gravelmaw_ch2_crabs", family: "crab", name: "Giant Crab", tier: 10,
        count: 3, centre: [27, -54], radius: 4,
        // 0.32 m across native, which is a rock-pool crab. 4.0 x 1.15 draws it 1.47 m across.
        assetId: "animal_crab", scale: 4.0,
      },
      {
        // The last room before the boss. Territorial rather than aggressive, so the fight is the
        // player's choice right up to the door.
        id: "gravelmaw_ch3_bears", family: "bear", name: "Cave Bear", tier: 10,
        count: 2, centre: [22, -76], radius: 7,
        assetId: "animal_bear", scale: 1.05,
      },
      {
        // The third of the same rig, in water, and drawn 4.84 m long on the tier 10 silhouette.
        //
        // He was a man in ranger's clothes, which was the right call while the dungeon was full of
        // invented monsters and being the one HUMAN thing carried the room. It reads differently
        // now: on a floor of rats, scorpions and crabs he was the only thing that was not an
        // animal, and looked like a lost hiker rather than what holds the Water Orb. Sharing the
        // orb bosses' silhouette says what he is before he moves.
        id: "ordrun", family: "quarrykeeper", name: "Quarry Warden", tier: 10,
        count: 1, centre: [10, -96], radius: 0,
        assetId: "boss_rhino_water", scale: 1, boss: true,
      },
    ],
    locations: [
      { id: "gravelmaw_chamber1", name: "The Lit Gallery", position: [40, -40], kind: "dungeon", routeNode: true,
        blurb: "Chamber one. Someone has kept the torches burning, which is worse than if they had not." },
      { id: "gravelmaw_chamber2", name: "The Collapse", position: [30, -58], kind: "dungeon", routeNode: true,
        blurb: "Chamber two. Dark, fallen in, and a stone door with three levers." },
      { id: "gravelmaw_chamber3", name: "The Cairn Hall", position: [22, -76], kind: "dungeon", routeNode: true,
        blurb: "Chamber three. Cairns, indoors, arranged since the crew left." },
      { id: "gravelmaw_arena", name: "The Quarry Warden's Floor", position: [10, -96], kind: "dungeon", routeNode: true,
        blurb: "A twenty-four metre circle of swept stone." },
    ],
    roads: [
      { from: "gravelmaw_entrance", to: "gravelmaw_chamber1" },
      { from: "gravelmaw_chamber1", to: "gravelmaw_chamber2" },
      // No walk edge from chamber 2 to chamber 3: the three-lever door stands in it. The Chimney
      // Climb is the only route-graph link until round 5 opens the door.
      { from: "gravelmaw_chamber3", to: "gravelmaw_arena" },
    ],
  },
};

// =============================================================== KILNHALT

/**
 * Tier 20 ember foothills, the Phase 2 amendment's region: the full 700 m width above the old
 * northern edge, z [200,460]. The southern border is OPEN — no gates, no walls, no checks — and
 * the terrain blends continuously across the whole z = 200 seam, so the region is entered by
 * walking north anywhere. Three semantic route links cross the seam (one from Fallowmarch, two
 * from Vellenwood); they are guidance, not doors.
 *
 * Layout, per the amendment: Emberfast at the centre with the complete station set, the Emberite
 * quarry west, the Cinderpine stand east, the Ashfin springs south-east, and the Fire altar ruins
 * and Cinderwake's arena in the north-east.
 */
const KILNHALT: RegionDef = {
  id: "kilnhalt",
  name: "Ashlands",
  tier: 20,
  lore:
    "The foothills north of the old survey line, where the ground runs warm and the pines grow " +
    "back scorched. Somebody fired kilns here long before the Trade Company drew its maps, and " +
    "the ground never entirely went out. Ashford is the camp that grew up on the warm flat in " +
    "the middle: smiths, mostly, because Titanium is the first metal since Cobalt worth the " +
    "walk, and the walk is why they stay. Nobody watches the southern border. There is no " +
    "border. You just notice, somewhere past the last milestone, that the wind has gone warm.",
  bounds: { min: [-350, 200], max: [350, 460] },
  terrainSeed: 0x1c11a7,
  terrainAmplitude: 34,
  baseHeight: 6,
  // Warm dark soil, dark rock, dry brush, charred timber, one ember-orange accent.
  groundPalette: ["#6e5f4b", "#87755a", "#5a4a3a", "#463c34", "#7d7248", "#4c3f36", "#d06a34", "#d8cdbb"],
  fogStart: 170,
  spawnPoint: [0, 254],
  // The Kilnroad fork looks north at Emberfast's south rampart: atan2(2, 71) = 0.03.
  spawnFacingRad: 0.03,
  respawnPointId: "emberfast",

  locations: [
    { id: "kilnhalt_south_track", name: "Kiln Road South", position: [-160, 214], kind: "junction", routeNode: true,
      blurb: "The pit track out of Farmland, on warm ground now. The border is somewhere behind you." },
    { id: "kilnhalt_vellen_track", name: "Ridge Track", position: [150, 214], kind: "junction", routeNode: true,
      blurb: "The foot track down off the Woodlands ridge. The first scorched pines start here." },
    { id: "kilnhalt_east_track", name: "Ash Border Track", position: [290, 214], kind: "junction", routeNode: true,
      blurb: "Where the canopy shade gives out for good. The springs lie north-west of here." },
    { id: "kilnroad_fork", name: "Kiln Road Fork", position: [0, 254], kind: "junction", routeNode: true,
      blurb: "Both southern tracks meet here. Ashford's rampart torches are visible up the road." },
    { id: "emberfast_south_bend", name: "South Bend", position: [40, 300], kind: "junction", routeNode: true,
      blurb: "The road swings east around Ashford's rampart to reach the gate." },
    { id: "emberfast_town", name: "Ashford", position: [2, 325], kind: "settlement", routeNode: true,
      blurb: "A walled kiln camp with a bank, market, and workshops for titanium and walnut." },
    { id: "emberfast_bank", name: "Ashford Bank", position: [8, 321], kind: "bank", routeNode: true,
      blurb: "One chest under a porch. The vault ledger smells faintly of smoke." },
    { id: "emberfast_east_gate", name: "Ashford Gate", position: [24, 333], kind: "gate", routeNode: true,
      blurb: "The east gatehouse. Carts to the stand and the springs leave this way." },
    { id: "emberfast_west_postern", name: "Quarry Postern", position: [-24, 333], kind: "gate", routeNode: true,
      blurb: "The west gatehouse, opening onto the plots and the quarry road." },
    { id: "clinker_quarry", name: "Volcanic Quarry", position: [-250, 330], kind: "seam", routeNode: true,
      blurb: "Six Titanium seams and two Flux Stone faces, still warm at the break." },
    { id: "ashfin_springs", name: "Hot Springs", position: [210, 250], kind: "water", routeNode: true,
      blurb: "Four warm pools where the bass run heavy. The water steams at dawn." },
    { id: "cinderpine_stand", name: "Walnut Grove", position: [240, 340], kind: "grove", routeNode: true,
      blurb: "Eight walnut trees with weathered bark and sound heartwood." },
    { id: "kilnhalt_fire_cache", name: "Fire Essence Cache", position: [290, 400], kind: "landmark", routeNode: true,
      blurb: "A ruined stone court where fire essence beads out of the warm rock. The altar is dark." },
    { id: "cinderwake_arena", name: "Fire Ogre Arena", position: [286, 420], kind: "landmark", routeNode: true,
      blurb: "A swept circle of scorched stone past the altar court. Something keeps it swept." },
  ],

  roads: [
    { from: "kilnhalt_south_track", to: "kilnroad_fork" },
    { from: "kilnhalt_vellen_track", to: "kilnroad_fork" },
    { from: "kilnhalt_vellen_track", to: "ashfin_springs" },
    { from: "kilnhalt_east_track", to: "ashfin_springs" },
    { from: "kilnroad_fork", to: "emberfast_south_bend" },
    { from: "emberfast_south_bend", to: "emberfast_east_gate" },
    { from: "emberfast_east_gate", to: "emberfast_town" },
    { from: "emberfast_town", to: "emberfast_bank" },
    { from: "emberfast_town", to: "emberfast_west_postern" },
    { from: "emberfast_west_postern", to: "clinker_quarry" },
    { from: "emberfast_east_gate", to: "cinderpine_stand" },
    { from: "emberfast_south_bend", to: "ashfin_springs" },
    { from: "ashfin_springs", to: "cinderpine_stand" },
    { from: "cinderpine_stand", to: "kilnhalt_fire_cache" },
    { from: "kilnhalt_fire_cache", to: "cinderwake_arena" },
  ],

  clusters: [
    {
      id: "clinker_emberite", resourceId: "ore_emberite",
      count: 6, centre: [-250, 330], radius: 12,
      locationId: "clinker_quarry",
    },
    {
      // The tier's flux, mined beside the ore the way March Stone sits beside the Grithe pit.
      id: "clinker_kilnstone", resourceId: "ore_kilnstone",
      count: 2, centre: [-238, 318], radius: 6,
      locationId: "clinker_quarry",
    },
    {
      id: "cinderpine_stand_trees", resourceId: "tree_cinderpine",
      count: 8, centre: [240, 340], radius: 18,
      locationId: "cinderpine_stand",
    },
    {
      id: "ashfin_spring_spots", resourceId: "fish_ashfin",
      count: 4, centre: [210, 250], radius: 9,
      locationId: "ashfin_springs",
    },
    {
      id: "kilnhalt_fire_essence_cache", resourceId: "essence_fire",
      count: 5, centre: [290, 400], radius: 12, ringRadius: 12,
      essenceElement: "fire",
      locationId: "kilnhalt_fire_cache",
    },
  ],

  stations: [REGIONAL_ESSENCE_ALTARS.kilnhalt],
  settlement: EMBERFAST,

  // No new Agility obstacles ship with the amendment; the region's routes are open ground, and
  // the shortcut vocabulary stays a Phase 1-3 lever rather than a per-region obligation.
  obstacles: [],

  enemyGroups: [
    // Kilnhalt is warm open foothill: bears on the ash slopes, boar in the burned woodland,
    // ibex on the western rise, adders around the springs, and reavers working the Kilnroad.
    {
      // The staff answer at tier 20, and the region's biggest ordinary silhouette.
      id: "ashback_bears", family: "bear", name: "Dire Bear", tier: 20,
      count: 4, centre: [-120, 400], radius: 26,
      assetId: "animal_bear", scale: 1.05,
    },
    {
      // The sword answer: the boar's mud-caked rule continues at tier 20.
      id: "cinder_boars", family: "boar", name: "Dire Boar", tier: 20,
      count: 5, centre: [80, 380], radius: 24,
      assetId: "animal_boar", scale: 1.05,
    },
    {
      id: "emberhorn_ibex", family: "ibex", name: "Large Ibex", tier: 20,
      count: 3, centre: [-260, 420], radius: 18,
      assetId: "animal_ibex", scale: 1.0,
    },
    {
      // Around the warm water, where the fishing is: the springs' standing risk.
      id: "cinder_adders", family: "viper", name: "Giant Viper", tier: 20,
      count: 3, centre: [170, 300], radius: 14,
      assetId: "animal_viper", scale: 1.25,
    },
    {
      id: "kilnroad_reavers", family: "reaver", name: "Quarry Bandit", tier: 20,
      count: 4, centre: [-40, 262], radius: 14,
      assetId: "outfit_male_ranger", scale: 0.90,
    },
    {
      // The tier 20 miniboss and the Fire Orb's keeper, alone on its swept arena floor past the
      // altar court. Stats, the guaranteed singleton Orb, and the rare rolls live on
      // `cinderwake_t20` in content/enemies.ts.
      id: "cinderwake", family: "cinderwake", name: "Fire Ogre", tier: 20,
      count: 1, centre: [286, 420], radius: 0,
      assetId: "miniboss_cinderwake", scale: 1,
      miniBoss: true,
    },
  ],

  landmarks: [
    {
      id: "kilnhalt_fire_altar_ruins", name: "Fire Altar Ruins", position: [290, 400],
      assetId: "altar_ruins_site", scale: 1, rotationY: 0, solid: false, originOnGround: true,
      blurb: "A heat-cracked stone court ringed by Fire Essence. Fire Ogre's Orb is its missing light.",
    },
    {
      // The fork waystone, same composition vocabulary as the other regions' road markers.
      id: "kilnroad_waystone", name: "Kiln Road Waystone", position: [6, 248],
      assetId: "corner_brick", scale: 0.85, rotationY: 0.8,
      composition: "path_waypoint",
      blurb: "Three arms: Farmland, the ridge, and Ashford. The southern arm is newest.",
    },
    {
      // The arena's edge stone: a semantic anchor a player can inspect from outside the fight.
      id: "cinderwake_ring_stone", name: "Arena Ring Stone", position: [274, 414],
      assetId: "rock_medium_2", scale: 1.6, rotationY: 1.1,
      blurb: "One of the ring stones. The scorch marks on it are layered, oldest at the bottom.",
    },
  ],

  // The southern border is open: no gate entities, only the three adjacency links above it.
  gates: [],

  adjacency: [
    { toRegionId: "fallowmarch", fromLocationId: "kilnhalt_south_track", toLocationId: "fallowmarch_kiln_road", meters: 22 },
    { toRegionId: "vellenwood", fromLocationId: "kilnhalt_vellen_track", toLocationId: "vellenwood_kiln_path", meters: 20 },
    { toRegionId: "vellenwood", fromLocationId: "kilnhalt_east_track", toLocationId: "vellenwood_ember_edge", meters: 20.4 },
  ],
};

// ------------------------------------------------------------------- exports

/** Original source bodies remain available for isolated animation regression fixtures. */
export const SOURCE_REGIONS: readonly RegionDef[] = [FALLOWMARCH, VELLENWOOD, KARROWMOOR, {
  ...KILNHALT,
  locations:[...KILNHALT.locations,{id:'kilnhalt_north_bend',name:'North Road Bend',position:[64,395] as Spot,kind:'junction' as const,routeNode:true},{id:'kilnhalt_north_track',name:'North Ash Track',position:[64,455] as Spot,kind:'junction' as const,routeNode:true}],
  roads:[...KILNHALT.roads,{from:'emberfast_east_gate',to:'kilnhalt_north_bend'},{from:'kilnhalt_north_bend',to:'kilnhalt_north_track'}],
  adjacency:[...KILNHALT.adjacency,{toRegionId:'wilderness' as const,fromLocationId:'kilnhalt_north_track',toLocationId:'wilderness_south_track',meters:69.5}],
}, WILDERNESS, CROWNWARD, ...FAIRY_REGIONS].map((region) => ({
  ...region,
  dungeon: region.dungeon ? { ...region.dungeon, enemyGroups: [...region.dungeon.enemyGroups, AMETHYST_CAVE_GROUP] } : undefined,
  enemyGroups: [...region.enemyGroups, ...REGIONAL_VARIANT_GROUPS.filter(group => REGIONAL_VARIANT_HABITATS.some(h => h.groupId === group.id && h.regionId === region.id)), ...(region.id === "fallowmarch" ? [...STARTER_GROUPS, RED_WORM_GROUP] : []), ...CREATURE_ENEMY_GROUPS.filter((group) =>
    CREATURE_HABITATS.some((habitat) => habitat.groupId === group.id && habitat.regionId === region.id))],
}));

/** The five surface regions. World builders use only the accepted encounter projection. */
const POPULATION_GROUPS = resolveBiomePopulation(CREATURE_SPECIES);
export const REGIONS: readonly RegionDef[] = SOURCE_REGIONS.map(region => ({ ...region,
  enemyGroups: [...region.enemyGroups.map(fantasyEncounter), ...POPULATION_GROUPS.filter(group =>
    BIOME_POPULATION.some(pack => pack.id === group.id && pack.regionId === region.id))].map(remapReservedEncounterGroup).map(populationGroup),
  dungeon: region.dungeon ? { ...region.dungeon,
    chambers: region.dungeon.chambers.map(chamber => ({ ...chamber,
      radius: LEGACY_CAVE_FLOOR_INTENTS.find(intent => intent.id === chamber.id)?.radius ?? chamber.radius,
    })),
    enemyGroups: region.dungeon.enemyGroups.map(fantasyEncounter).map(remapReservedEncounterGroup).map(populationGroup),
  } : undefined,
}));

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

    if (region.settlement) {
    if (!inBounds(region.bounds, region.settlement.centre)) {
      problems.push(`${region.id}: settlement ${region.settlement.id} is outside the region bounds`);
    }

    // Buildings. An unknown prefab, a zero footprint, or a building outside its own region all
    // produce a settlement that is invisible or in the wrong place, and all three are silent.
    const settlement = region.settlement;
    if (!isKitId(settlement.kit)) {
      problems.push(
        `${region.id}: settlement ${settlement.id} names unknown building kit ` +
        `"${String(settlement.kit)}" (known: ${KIT_IDS.join(", ")})`,
      );
    }
    for (const building of settlement.buildings) {
      if (seenIds.has(building.id)) problems.push(`duplicate building id ${building.id}`);
      seenIds.add(building.id);
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
