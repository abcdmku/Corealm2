/**
 * Prefab assembly: a prefab name plus a footprint, out comes an ordered list of part placements.
 *
 * The Medieval Village MegaKit ships **no prebuilt house** (asset-report, gap 4). It is a strictly
 * modular kit on a **2 m grid with a 3.123 m storey**, measured off the real GLBs rather than
 * assumed:
 *
 *   wall_*            2.000 x 3.123 x 0.406, pivot centred in X, on the floor in Y, outward face
 *                     at z = +0.093 with the panel body running back to z = -0.314
 *   corner_wood       0.210 x 3.000 x 0.240, pivot centred, on the floor
 *   corner_brick      0.531 x 3.016 x 0.576, pivot near the inner corner
 *   wall_bottom_trim  2.000 x 0.238 x 0.432, straddles y = 0
 *   roof_tiles_4x6    covers a 4 (X) x 6 (Z) building; bbox 5.513 x 4.234 x 7.572, eaves included
 *   roof_tiles_6x12   covers a 6 (X) x 12 (Z) building; bbox 8.250 x 5.672 x 13.658
 *   roof_tower        bbox 5.651 x 7.361 x 5.427, base at y = -0.572
 *   chimney           0.946 x 3.178 x 1.000, on the floor
 *   door_round_1/2    pivot on the LEFT jamb (x = 0 .. 1.07), so a centred door needs dx -= 0.55
 *   roof_log          pivot 3.85 m BELOW the beam; the beam runs along local Z, +-5.35
 *   support_beam      a horizontal beam at y 1.709 with a knee brace and a stub foot at z -0.118,
 *                     pivot 1.21 m BELOW the beam - a bracket, not a post
 *   overhang_plaster  2.000 x 3.028 x 2.200; a whole wall panel whose canopy reaches z +2.0
 *   overhang_brick    2.000 x 0.266 x 2.022; a bare slab, no wall, pivot 0.324 above its underside
 *   wall_arch         2.000 x 3.000 x 0.064, clear opening only 1.44 m wide - 72% of the panel at
 *                     every scale, which is why it cannot frame a 4 m gate (see `gatehouse`)
 *   roof_wood_plank   2.258 x 1.560 mono-pitch, high at its own z 0, low at z 1.56
 *   kerb_straight     2.000 x 0.134 x 0.700, body entirely on the +Z side of the pivot
 *
 * WHY THE TOWNS READ AS OPEN SHELLS, in order of how much daylight each leak is worth. Measured on
 * the shipped data with runs/corealm/audit/shell-audit.ts:
 *
 *   1. THE GABLES WERE OPEN. 415 m2 of it, which is the whole answer. A `roof_tiles_*` is a prism
 *      of tiles - two primitives, MI_WoodTrim and MI_RoundTiles, and no end face in either - and
 *      the wall ring stops at 3.123 m, so every pitched roof in the game had a triangle of nothing
 *      at each end: 9.00 m2 per end on a 6 x 4 cottage, 17.39 on the March Company Hall, 5.76 on
 *      the drying shed. You looked in one gable, through the house, and out the other. Only the
 *      stone kit closed its gables at all, and it sized them off the footprint rather than off the
 *      roof, so they fell 0.36 m short of the ridge and one of each pair faced backwards.
 *      `gableEnds` closes all of them; the audit puts what is left at 0.054 m2 per end.
 *   2. MODULE JOINTS AND EAVES. Older world placement divided part scale by tier silhouette
 *      scale while leaving the 2 m grid unchanged, opening full-height joints and eaves bands.
 *      `regionBuilder` now preserves authored part scales. `jointStuds` and `eavesPlate` remain
 *      as timber construction details; do not add inverse tier compensation to these recipes.
 *   3. A WINDOW OPPOSITE THE FRONT DOOR. `ringWindows` refuses to put a window opposite a window,
 *      but the doorway was never in its plan, and every ring prefab puts the door at the mirror
 *      index of its own entry face. Measured at the drawn scale: a 0.98 m column straight through
 *      all six Highcairn quarry huts, 0.20 m through the Coldbrace cottages and the vault tower.
 *   4. APERTURED AND HALF-TIMBERED PANELS USED AS WALLS. Fixed in an earlier pass; the panel
 *      table below is why.
 *
 * WHICH PANELS ARE ACTUALLY SOLID. A bounding box says every `wall_*` is 2.000 x 3.123 x 0.406.
 * Per-primitive material spans, measured off the GLBs with @gltf-transform/core
 * (runs/corealm/audit/bld-prims.mjs):
 *
 *   wall_plaster_straight  MI_Plaster covers y 0.00-3.00 on both faces. Solid.
 *   wall_plaster_base      MI_Plaster y 0.00-3.00 plus an MI_Brick apron y 0.00-0.88. Solid.
 *   wall_brick_straight    MI_UnevenBrick y 0.00-3.00 outside, MI_Plaster y 0.00-3.00 inside. Solid.
 *   wall_plaster_timber    MI_Plaster covers ONLY y 0.00-0.84. The other 2.28 m is 386 verts of
 *                          MI_WoodTrim - studs and braces with NOTHING BETWEEN THEM. It is
 *                          half-timbering to lay OVER a wall, not a wall. Used as `wall` by the
 *                          timber kit and as `wallFeature` by the plaster kit, it is why both
 *                          flanking houses in runs/corealm/screenshots/w1-rootfall.png and the
 *                          March Company Hall are see-through.
 *   wall_*_window          the aperture is a hole in the mesh; there is no glass primitive. One
 *                          window is fine because the far wall behind it is opaque. A prefab whose
 *                          DEFAULT panel is a window - `quarry_hut` took `kit.wallFeature`, and the
 *                          stone kit's was `wall_brick_window` - is a building with holes on every
 *                          side, which is w1-highcairn.png's "open pavilions".
 *   wall_plaster_window    also carries a loose MI_Brick apron quad at y 0.00-0.88, z = 0. On a
 *                          panel standing on the ground it is the sill course; on the gatehouse's
 *                          head course, three metres up over an open passage, it is the floating
 *                          framed panel in the middle of wire-town_entrance.png.
 *
 * Nothing in here invents an asset id. Every id below appears in game/public/assets/manifest.json
 * and was measured with @gltf-transform/core, not guessed. `prefabPartAssetIds()` and
 * `compositionPartAssetIds()` are the lists `content/regions.ts` validates against a real manifest.
 *
 * This module emits **data**, never meshes. A part is (assetId, local offset, local yaw, scale);
 * the world layer turns each into a `SemanticEntity.view` and the existing `render/entityViews.ts`
 * instancing path batches hundreds of wall segments into a handful of draw calls. Adding Three.js
 * here would defeat that, so this file imports nothing from Three.
 *
 * Local frame convention, shared by every prefab and composition:
 *   +X right, +Y up, +Z **forward, out of the building's front face**.
 *   The caller rotates the whole list by the authored `rotationY` and translates it to the
 *   building's ground position, so a prefab is authored once facing +Z and reused at any bearing.
 */
import { Rng } from "../core/rng.js";
import { ROOTFALL_STUMP } from "../world/rootfallStump.js";
import { wallMountedBanner } from "./bannerPlacement.js";
import { buildCanopyWalkComposition } from "./compositions/canopyWalk.js";
import {
  buildGravelmawExitComposition, buildGravelmawMouthComposition,
} from "./compositions/gravelmawMouth.js";
import { buildPathWaypointComposition } from "./compositions/pathWaypoint.js";
import { buildRegionGateComposition } from "./compositions/regionGate.js";
import { buildRootTunnelComposition } from "./compositions/rootTunnel.js";
import { applyStructureVariant, structureVariantCount } from "./structures/catalog.js";

// ------------------------------------------------------------------ constants

/** The kit's horizontal module. Structural footprints snap to this so pieces meet cleanly. */
export const MODULE_METRES = 2;

/** Measured wall height. Stack storeys on this exactly. */
export const STOREY_METRES = 3.123;

/** Where a wall's outward face sits relative to its pivot. */
const WALL_FACE = 0.093;

/** Measured panel thickness: a wall runs from z = +WALL_FACE back to z = WALL_FACE - 0.406. */
const WALL_THICKNESS = 0.406;

/** `door_round_*` pivot on their left jamb; this centres them in a 2 m module. */
const DOOR_LEAF_OFFSET = -0.55;

/**
 * Clear width of a gate passage, in metres. Was an inline `2` in two places.
 *
 * Measured: the world is 700 m across, so `navigation.ts` picks the 0.45 m large-world cell, and
 * `NAV_CONFIG.walkableRadius` erodes the navmesh by one cell per side. At the old walkableRadius 2
 * that was 0.90 m per side, which left a 2 m arch with 0.20 m of walkable floor - less than one
 * cell, so Recast dropped it entirely and `getNavPath` detoured 4-5 m around all three gates in the
 * game, including the one the player spawns in front of. At walkableRadius 1 the erosion is 0.45 m
 * per side, so this 4 m gap leaves a 3.10 m corridor against a 0.35 m PLAYER_RADIUS.
 *
 * `gateGeometry()` is the single place that turns this into pier positions, and both `gatehouse()`
 * and `prefabCollision("gatehouse")` call it, so the drawn gap and the collided gap are the same
 * number by construction. A gatehouse needs an [8,3] footprint to reach it; at [6,3] there is only
 * room for one 2 m pier per side and a 2 m gap.
 */
export const GATE_GAP_METRES = 4;

/**
 * How far a tiled roof overhangs the footprint it covers, per side, in the worst case any authored
 * settlement footprint reaches.
 *
 * 0.79 was measured off `roof_tiles_4x6` alone - bbox 5.513 x 7.572 over a nominal 4 x 6 building,
 * so eaves of (5.513 - 4) / 2 = 0.757 m and (7.572 - 6) / 2 = 0.786 m - and it is only right for a
 * 6 x 4 cottage in the plaster or timber kit. It is wrong everywhere else, in two ways that matter
 * to whoever is spacing buildings right now:
 *
 *   - The stone kit roofs with `roof_tiles_6x8`, bbox 8.250 x 9.683 over a nominal 6 x 8, so its
 *     eaves are 1.125 m and 0.842 m at scale 1. Highcairn is 43% deeper in the eaves than 0.79.
 *   - `roofFit` scales uniformly off the tighter of the two ratios, so any plan squarer than the
 *     asset's own aspect over-runs on the other axis. A 6 x 5 forge in the plaster kit fits at
 *     1.25 and therefore draws a roof 9.47 m along the 6 m axis: an eave of 1.73 m, not 0.79.
 *
 * Use `roofOverhang(prefab, footprint, kitId)` for the real per-axis number; `ROOF_EAVE_BY_KIT`
 * for a single safe number per vernacular; this constant only for "no roof in the game reaches
 * further than this". Author neighbouring buildings at least `footprint + 2 * overhang` apart.
 *
 * All three are the authored scale. The game currently draws every building part at
 * `1 / tierSilhouetteScale(tier)` (regionBuilder.ts `emitParts`), so the eave a player sees is
 * 1.111x these numbers in Coldbrace, 0.930x in Rootfall and 0.869x in Highcairn - see the note on
 * `MODULE_METRES`.
 */
export const ROOF_EAVE_METRES = 1.79;

/**
 * How far a covered bay's canopy reaches out from the wall it hangs on.
 *
 * Measured on both kit overhangs so `porch`, `arcade` and `bank_counter` can put a post under the
 * front edge without knowing which kit they are in: `overhang_plaster`'s canopy runs from z +0.2 to
 * z +2.0, and `overhang_brick`'s slab spans z -1.022 to +1.000 about its pivot. Placed as
 * `coveredBay` places them, both stop at 2.0 m.
 */
const CANOPY_DEPTH_METRES = 2;

// ------------------------------------------------------------------- types

/**
 * One placed piece of a prefab. Offsets are metres in the prefab's local frame, before the
 * building's own rotation and translation. `scale` is a true metre multiplier: 1 means the asset's
 * authored size. `scaleAxes`, when present, is a local-axis correction multiplied after it.
 */
export interface PartPlacement {
  /** Unique within one prefab instance. Becomes the entity id suffix, so it must be stable. */
  readonly tag: string;
  readonly assetId: string;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** Added to the parent's rotation. */
  readonly rotationY: number;
  readonly scale: number;
  readonly scaleAxes?: readonly [number, number, number];
}

/**
 * Every prefab the authored data may name.
 *
 * This union used to live in `content/regions.ts` and be imported here, which meant the render
 * layer could not add a building type without the content layer being edited in the same change.
 * It is defined here now because this is the file that knows how to assemble one; `content` keeps
 * its own `PrefabId` for `BuildingDef.prefab` and every value it can hold is a member of this one,
 * which the compiler checks at `buildPrefab`'s call site in `world/regionBuilder.ts`.
 *
 * The last five are the open structures. The diagnosis measured why they exist rather than real
 * interiors: a 6x4 cottage's interior erodes to 4.7 m² of navmesh, which is enough floor, but its
 * 2 m doorway erodes to 0.20 m, so Recast leaves that floor as an island the player can never path
 * to. `forge`, `porch`, `arcade`, `market_row` and `well` are all walkable at the current nav
 * config precisely because none of them has a doorway to pinch shut.
 */
export type PrefabId =
  | "cottage" | "townhouse" | "hall" | "tower" | "stall" | "wall_segment"
  | "gatehouse" | "shed" | "ruin" | "quarry_hut"
  | "forge" | "porch" | "arcade" | "market_row" | "well" | "farmstead";

export const PREFAB_IDS: readonly PrefabId[] = [
  "cottage", "townhouse", "hall", "tower", "stall", "wall_segment", "gatehouse", "shed", "ruin", "quarry_hut",
  "forge", "porch", "arcade", "market_row", "well", "farmstead",
] as const;

export function isPrefabId(value: string): value is PrefabId {
  return (PREFAB_IDS as readonly string[]).includes(value);
}

/**
 * A hand-authored set-dressing group for a landmark, a region gate, or the dungeon mouth.
 *
 * Finding 8 of the round-1 critique: a landmark drawn as one stand-in prop gives the player no
 * silhouette to navigate by. Each id here is a small composition of real parts around the
 * landmark's own hero mesh.
 */
export type CompositionId =
  | "essence_altar_ruins"
  | "vault_door"
  | "milestone"
  | "highcairn_crane"
  | "gravelmaw_mouth"
  | "gravelmaw_exit"
  | "great_cairn"
  | "standing_stones"
  | "rootfall_stump"
  | "region_gate"
  | "path_waypoint"
  | "root_tunnel_entrance"
  | "canopy_walk_entrance"
  | "bank_counter"
  | "forge_yard"
  | "market_pitch"
  | "wood_pile"
  | "garden"
  | "farm_yard";

export const COMPOSITION_IDS: readonly CompositionId[] = [
  "essence_altar_ruins", "vault_door", "milestone", "highcairn_crane", "gravelmaw_mouth", "gravelmaw_exit",
  "great_cairn", "standing_stones", "rootfall_stump", "region_gate", "path_waypoint",
  "root_tunnel_entrance", "canopy_walk_entrance",
  "bank_counter", "forge_yard", "market_pitch", "wood_pile", "garden", "farm_yard",
] as const;

export function isCompositionId(value: string): value is CompositionId {
  return (COMPOSITION_IDS as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ helpers

/**
 * Deterministic 32-bit hash of an entity id. Prefab variation is seeded from the building's own id
 * rather than from the shared `"world"` RNG stream, so adding a building cannot shift the node
 * jitter or enemy placement of anything built before it. Same seed in, same wall layout out.
 */
export function variantSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** How many 2 m modules a side of the given length takes. Never zero. */
function moduleCount(length: number): number {
  return Math.max(1, Math.round(length / MODULE_METRES));
}

interface Side {
  /** Outward yaw: 0 = +Z, PI/2 = +X, PI = -Z, -PI/2 = -X. */
  yaw: number;
  /** Distance from the footprint centre to this face. */
  half: number;
  /** Run of the face, in metres. */
  length: number;
}

/** North, east, south, west, in that fixed order. Index 2 is always the entry face. */
function ringSides(width: number, depth: number): Side[] {
  return [
    { yaw: 0, half: depth / 2, length: width },
    { yaw: Math.PI / 2, half: width / 2, length: depth },
    { yaw: Math.PI, half: depth / 2, length: width },
    { yaw: -Math.PI / 2, half: width / 2, length: depth },
  ];
}

/**
 * Position of module `index` of `count` on a side, pushed `out` metres beyond the face and lifted
 * to `y`. `along` shifts within the module (a door leaf, a lamp beside it).
 */
function onSide(
  side: Side,
  count: number,
  index: number,
  y: number,
  out: number,
  along = 0,
): { dx: number; dy: number; dz: number } {
  const spacing = side.length / count;
  const offset = (index + 0.5) * spacing - side.length / 2 + along;
  const outX = Math.sin(side.yaw);
  const outZ = Math.cos(side.yaw);
  // The wall's local +X after a yaw rotation.
  const alongX = Math.cos(side.yaw);
  const alongZ = -Math.sin(side.yaw);
  return {
    dx: outX * (side.half + out) + alongX * offset,
    dy: y,
    dz: outZ * (side.half + out) + alongZ * offset,
  };
}

function part(
  tag: string,
  assetId: string,
  at: { dx: number; dy: number; dz: number },
  rotationY: number,
  scale = 1,
): PartPlacement {
  return { tag, assetId, dx: r3(at.dx), dy: r3(at.dy), dz: r3(at.dz), rotationY: r4(rotationY), scale: r4(scale) };
}

function loose(tag: string, assetId: string, dx: number, dy: number, dz: number, rotationY = 0, scale = 1): PartPlacement {
  return { tag, assetId, dx: r3(dx), dy: r3(dy), dz: r3(dz), rotationY: r4(rotationY), scale: r4(scale) };
}

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The plinth course under one wall module.
 *
 * WHY EVERY WALL GETS ONE NOW. In runs/corealm/screenshots/baseline-town_entrance.png every panel
 * meets the grass on a straight cut, so the cottages read as slabs standing on the ground instead
 * of buildings coming out of it - and `checkBuildingFooting()` reports worst = 0 for all 36
 * buildings, so the pads are right and the missing thing is geometry, not height. `wall_bottom_trim`
 * is the kit's own answer: 2.000 x 0.238 x 0.432 straddling y = 0 from -0.117 to +0.121, and it
 * was used on exactly one face of exactly one prefab (`hall`). It is offset 0.01 m out from the
 * panel face so the two coplanar surfaces do not z-fight.
 *
 * Cost: one instance per module, and one draw call per (region, tier) that did not already draw
 * the asset - measured at +2 across the whole game, because Coldbrace's hall already had it.
 */
function trimUnder(
  out: PartPlacement[], tag: string, side: Side, count: number, index: number,
): void {
  out.push(part(tag, "wall_bottom_trim", onSide(side, count, index, 0, 0.01), side.yaw));
}

/**
 * One module of a ring wall: the panel, its plinth, and the kit's half-timbering over it.
 *
 * The frame goes on 0.02 m proud of the panel face rather than coplanar with it - both meshes
 * carry MI_WoodTrim between z -0.31 and +0.09, and drawn at the same z the two frames z-fight
 * along every stud. It is only laid over SOLID panels: `wall_plaster_timber`'s braces cross the
 * middle of the module, which would put an X through a window or a door.
 */
function wallModule(
  out: PartPlacement[],
  tag: string,
  assetId: string,
  side: Side,
  count: number,
  index: number,
  kit: BuildingKit,
  y = 0,
  // The tower's plinth predates the storey prefix on its panels, and a part tag is an entity id.
  trimTag = tag,
): void {
  out.push(part(`w${tag}`, assetId, onSide(side, count, index, y, 0), side.yaw));
  if (y === 0) trimUnder(out, `t${trimTag}`, side, count, index);
  if (assetId === kit.wallWindow) {
    // The wall modules contain the aperture but no frame or glass. `window_wide` is the matching
    // complete insert (1.365 x 1.726 m), set a few centimetres proud so its frame does not z-fight
    // the panel.
    out.push(part(`g${tag}`, "window_wide", onSide(side, count, index, y, 0.03), side.yaw));
  }
  if (kit.frame !== null && assetId !== kit.wallWindow && assetId !== kit.wallDoor) {
    out.push(part(`f${tag}`, kit.frame, onSide(side, count, index, y, 0.02), side.yaw));
  }
}

/**
 * Which modules of a four-sided ring get a window, with the one rule that keeps the building
 * opaque: never a window opposite a window.
 *
 * A `wall_*_window` aperture is a hole in the mesh and the kit ships no glass, so a single window
 * is only ever as transparent as whatever stands behind it - and what stands behind it is the far
 * wall, from the inside. Two windows on opposite faces at the same offset line up, and the player
 * sees the terrain through the house. On a 6 x 4 cottage at the old flat 45% chance that happened
 * on about one building in three; on a 6 x 6 tower it happened every time, because the storey-1
 * window was `floor(count / 2)` on all four sides and `floor(3 / 2) = 1` faces itself.
 *
 * `onSide` runs side 0 along +X and side 2 along -X, so module `i` of side 0 faces module
 * `count - 1 - i` of side 2; sides 1 and 3 pair the same way. The entry facade (side 2) is planned
 * first so a rear aperture cannot erase its whole elevation. If its rolls still produce no window,
 * one eligible bay is selected deterministically; the opposite wall then gives way to it.
 *
 * THE DOORWAY IS AN APERTURE TOO, and it was not in the plan. `skip` marks the modules that do not
 * roll, and the doorway is one of them, so it stayed `false` and side 0 was free to put a window
 * opposite it. Every ring prefab puts its door at `floor(count / 2)` of side 2, and on a 3-module
 * side `count - 1 - 1` is 1 - the door faces its own mirror index. Measured at the drawn scale with
 * runs/corealm/audit/w4-leak.ts: a 0.98 m column of daylight straight through all six Highcairn
 * quarry huts and 0.20 m through the Coldbrace cottages and the vault tower, in at the front door
 * and out the back wall. `aperture` is the separate question "is this skipped module a HOLE", which
 * is the door here and NOT the hall's solid window band, and it is what the opposite side now
 * gives way to.
 */
function ringWindows(
  sides: readonly Side[],
  rng: Rng,
  chance: number,
  skip: (side: number, index: number) => boolean = () => false,
  aperture: (side: number, index: number) => boolean = skip,
): boolean[][] {
  const plan: boolean[][] = sides.map((side) => new Array<boolean>(moduleCount(side.length)).fill(false));
  const holes: boolean[][] = sides.map((side, s) => (
    Array.from({ length: moduleCount(side.length) }, (_unused, index) => aperture(s, index))
  ));
  for (const s of [2, 1, 0, 3]) {
    const side = sides[s]!;
    const count = moduleCount(side.length);
    const facing = holes[(s + 2) % 4]!;
    for (let index = 0; index < count; index += 1) {
      const roll = rng.chance(chance);
      if (skip(s, index)) continue;
      const opposite = facing[count - 1 - index] === true;
      const isWindow = roll && !opposite;
      plan[s]![index] = isWindow;
      if (isWindow) holes[s]![index] = true;
    }
    if (s === 2 && chance > 0 && !plan[s]!.some(Boolean)) {
      const eligible = Array.from({ length: count }, (_unused, index) => index).filter((index) => (
        !skip(s, index) && facing[count - 1 - index] !== true
      ));
      const fallback = rng.pick(eligible);
      if (fallback !== undefined) {
        plan[s]![fallback] = true;
        holes[s]![fallback] = true;
      }
    }
  }
  return plan;
}

/** Corner posts at the four footprint corners, each turned to face its diagonal. */
function corners(
  out: PartPlacement[],
  width: number,
  depth: number,
  assetId: string,
  y: number,
  scale: number,
  tagPrefix: string,
): void {
  const signs: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [index, sign] of signs.entries()) {
    const sx = sign[0];
    const sz = sign[1];
    out.push(loose(
      `${tagPrefix}${index}`, assetId,
      (width / 2) * sx, y, (depth / 2) * sz,
      Math.atan2(sx, sz), scale,
    ));
  }
}

/**
 * Uniform scale for a tiled roof over `width` x `depth`, given the building size the roof asset is
 * authored to cover. The asset's ridge runs along its local Z, so a building wider than it is deep
 * takes a quarter turn.
 *
 * Checked against finding 11 ("houses 5 and 6 have interpenetrating roofs"): this does NOT
 * over-scale them. A 6x4 cottage in the plaster kit returns exactly 1.0, and the 1.57 x 1.51 m of
 * overlapping tile comes from `ROOF_EAVE_METRES` - the asset carries 0.76-0.79 m of eaves in its
 * own bbox - plus a layout that placed the two footprints corner to corner with zero gap. The fix
 * is spacing, in the settlement data, not scale here.
 *
 * What IS worth knowing before authoring a footprint: because the scale is uniform and takes the
 * larger of the two ratios, a plan squarer than the asset's own 4:6 over-runs on the other axis. A
 * 6x5 forge in the plaster kit scales to 1.25 to cover its 5 m depth and therefore draws a roof
 * 9.47 m long over a 6 m building - an eave of 1.73 m per end, not the 0.79 the constant used to
 * claim, and this comment used to say 7.5 m, which is the covered span and not the drawn bbox.
 * Author open structures nearer the asset's aspect, or budget for it: `roofOverhang` returns the
 * real per-axis number for any (prefab, footprint, kit).
 */
function roofFit(
  width: number,
  depth: number,
  coversShort: number,
  coversLong: number,
): { scale: number; rotationY: number } {
  const long = Math.max(width, depth);
  const short = Math.min(width, depth);
  const scale = Math.max(short / coversShort, long / coversLong);
  return { scale, rotationY: width >= depth ? Math.PI / 2 : 0 };
}

/**
 * A tiled roof once it has been placed: the cross-section a gable has to close.
 *
 * `roofFit` returns a scale and a quarter turn; on its own that is not enough to fit anything to
 * the roof, because the asset's ridge height, eave drop and half-span are three different numbers
 * and only the first was ever exported. All three are metres at the placement height.
 */
interface PlacedRoof {
  scale: number;
  rotationY: number;
  /** True when the ridge runs along local Z, i.e. `roofFit` did NOT turn the asset. */
  alongZ: boolean;
  /** Metres from the placement height up to the ridge. */
  apex: number;
  /** Metres the eave hangs below the placement height. */
  drop: number;
  /** Half the roof's span ACROSS the ridge, measured at the eave. */
  acrossHalf: number;
  /** Metres up to where the STRAIGHT tile plane extrapolates. See `RoofPitch`. */
  pitchApex: number;
  /** Half-span where the same straight tile plane crosses the placement height. */
  pitchHalf: number;
}

function placeRoof(
  fit: { scale: number; rotationY: number },
  box: readonly [number, number],
  apex: number,
  drop: number,
  pitch: RoofPitch,
): PlacedRoof {
  // box[0] is the asset's X bbox, which is always the across-ridge span; the quarter turn swaps
  // which world axis that lands on but not which of the asset's own axes it is.
  return {
    scale: fit.scale,
    rotationY: fit.rotationY,
    alongZ: fit.rotationY === 0,
    apex: apex * fit.scale,
    drop: drop * fit.scale,
    acrossHalf: (box[0] / 2) * fit.scale,
    pitchApex: pitch[0] * fit.scale,
    pitchHalf: pitch[1] * fit.scale,
  };
}

/** The 4x6-class roof fitted to a footprint. `tighten` is the quarry hut's deliberate 0.98. */
function smallRoof(kit: BuildingKit, width: number, depth: number, tighten = 1): PlacedRoof {
  const fit = roofFit(width, depth, kit.roofSmallCovers[0], kit.roofSmallCovers[1]);
  return placeRoof(
    { scale: fit.scale * tighten, rotationY: fit.rotationY },
    kit.roofSmallBox, kit.roofSmallApex, kit.roofSmallDrop, kit.roofSmallPitch,
  );
}

/** The hall roof fitted to a footprint. */
function largeRoof(kit: BuildingKit, width: number, depth: number): PlacedRoof {
  const fit = roofFit(width, depth, kit.roofLargeCovers[0], kit.roofLargeCovers[1]);
  return placeRoof(
    fit, kit.roofLargeBox, kit.roofLargeApex, kit.roofLargeDrop, kit.roofLargePitch,
  );
}

/**
 * `roof_gable_brick` sliced off the GLB (runs/corealm/audit/sp/probe-slice.ts): a SOLID triangle,
 * not a frame. Its plaster face runs from |x| = 3.123 at y = 0.30 down to |x| = 0.053 at y = 4.30,
 * so the raking line is |x| = 3.353 - 0.7675 y: half-width 3.353 at the pivot, apex at 4.369. The
 * bbox is slightly bigger than both (3.347 at the bottom rail, 4.384 at the finial) and fitting to
 * the BBOX rather than to the rake is a 0.3% error, which is not the one that mattered. Despite the
 * id the materials are MI_Plaster and MI_WoodTrim - a plastered, timber-framed gable - which is why
 * all three kits close their gables with it and only the region tint tells them apart.
 */
const GABLE_RAKE_APEX = 4.369;
const GABLE_RAKE_HALF = 3.353;

/**
 * How far inside the tile plane a gable is set, as a fraction.
 *
 * The rake and the tiles are the same straight line once the gable is fitted to `RoofPitch`, and
 * two coplanar surfaces z-fight. 0.96 drops the rake about 0.14 m below the tiles on a cottage and
 * 0.18 m on a hall, which is inside the tile slab's own thickness, so the gable disappears under
 * the roof instead of flickering along it. It also pulls the gable's bottom rail - a 0.28 m band at
 * the full half-width, and the one part of the asset that is not on the rake - back under the
 * fascia, which at a flush fit stood 0.11 m proud at each eave corner.
 *
 * Swept against the form audit: 0.97 leaves 34 pierces of up to 0.042 m where the pantile
 * corrugation runs shallow, 0.96 leaves none, and by 0.70 the gable has shrunk far enough that
 * 20-23% of the end is see-through again - which is the hole `gableEnds` was written to close, so
 * the margin is bounded on both sides and this is measured, not chosen.
 */
const GABLE_TILE_INSET = 0.96;

/**
 * The straight tile plane of one roof asset: `[apex, half]` in metres at scale 1.
 *
 * A `roof_tiles_*` is NOT a triangle, and assuming it was is why every pitched roof in the game had
 * plaster sticking through it. Measured with runs/corealm/audit/sp/probe-pitch.ts, which fits a
 * line to the slope between a fifth and nine tenths of the half-span - the part that is actually
 * straight - and extrapolates: `roof_tiles_4x6` runs at 1.387 and extrapolates to 3.441 m over a
 * 2.479 m half-span, but its bbox tops out at 3.718 because the ridge is a rounded CAP standing
 * 0.28 m above the plane the tiles were heading for. The 6-wide roofs are worse: 4.396 against a
 * bbox 4.890, so the cap is 0.49 m.
 *
 * `roofSmallApex` is that bbox number, and `gableEnds` used it, so every gable was fitted to the
 * cap and its rake rode 0.09-0.26 m over the tiles for its whole length (form audit, PIERCE). A
 * gable is a wall under a roof plane, so it is sized to the PLANE.
 */
type RoofPitch = readonly [apex: number, half: number];

/** Compact shed roof fit. 0.80 let wall frames and stone corner caps pierce the tile surface. */
const SHED_ROOF_FIT = 0.88;

/**
 * Uniform scale of a shed's roof: the compact fit, floored at what covers the shed's own posts.
 *
 * One function so `shed()` and `roofOverhang("shed", ...)` cannot disagree, which they would have
 * to have done otherwise - a settlement author spaces buildings by `roofOverhang` and the shed now
 * draws a bigger roof in the stone kit than the old constant claimed.
 */
function shedRoofScale(kit: BuildingKit, width: number, depth: number): number {
  const tighten = SHED_ROOF_FIT * (4 / kit.roofSmallCovers[0]);
  const cover = (
    Math.min(width, depth) / 2 + kit.cornerReach * storeyPostScale(kit) + 0.08
  ) / kit.roofSmallPitch[1];
  return Math.max(tighten, cover);
}

/**
 * Close both ends of a pitched roof.
 *
 * THIS IS WHY THE TOWNS WERE SEE-THROUGH. A `roof_tiles_*` is a prism of tiles and wood trim with
 * nothing at its ends (bld-prims.mjs: two primitives, MI_WoodTrim and MI_RoundTiles, and no gable
 * face in either), and the wall ring stops dead at 3.123 m. Measured with
 * runs/corealm/audit/shell-audit.ts before this existed: 9.00 m2 of open triangle per end on a
 * 6 x 4 cottage, 17.39 on the March Company Hall, 5.76 on the drying shed - 415 m2 of daylight
 * across the three settlements, which is exactly the hole you look through in
 * runs/corealm/screenshots/w2-rootfall.png. Only the stone kit closed its gables at all, and it
 * sized them off the footprint (`span / 6.694 * 1.08`) rather than off the roof, so they were
 * 0.36 m short of the ridge AND one of each pair faced backwards.
 *
 * SIZING. The shipped gable's rake (4.369 / 3.353 = 1.303) is not the roofs' (1.387 on
 * roof_tiles_4x6, 1.237 on the 6-wide pair). Uniform fitting therefore either leaves a triangular
 * hole or pushes the gable through the tiles. Fit local X and local Y independently; local Z
 * follows X so the timber frame keeps a sensible thickness.
 *
 * AND FIT IT TO THE TILE PLANE, NOT TO THE BOUNDING BOX. This was wrong for as long as the function
 * has existed. `headHalf` modelled the roof as a triangle from the eave corner to the top of the
 * bbox and put the gable's apex on that top - but the top of the bbox is the rounded RIDGE CAP,
 * which stands 0.28 m (4x6) to 0.49 m (6-wide) above the straight plane the tiles run in. The gable
 * IS straight, so a rake pinned to the cap rides over the tiles for its whole length: measured at
 * 0.169 m on a plaster cottage, 0.224 m on a stone one, 0.264 m on the March Company Hall, on every
 * building in all three settlements. `RoofPitch` is the measured plane and this fits to it.
 *
 * ORIENTATION. The asset's plaster face looks down its own local -Z, so the two ends need
 * different yaws. They had the same one, so half of Highcairn's gables were inside out.
 */
function gableEnds(
  out: PartPlacement[],
  width: number,
  depth: number,
  roof: PlacedRoof,
  kit: BuildingKit,
  baseY = STOREY_METRES,
): void {
  // The straight tile plane, set a little inside the tiles so the two surfaces do not z-fight.
  const acrossScale = (roof.pitchHalf / GABLE_RAKE_HALF) * GABLE_TILE_INSET;
  const heightScale = (roof.pitchApex / GABLE_RAKE_APEX) * GABLE_TILE_INSET;
  const ridgeLength = roof.alongZ ? depth : width;
  for (const [index, sign] of [-1, 1].entries()) {
    out.push({
      ...loose(
      `gable${index}`, "roof_gable_brick",
      roof.alongZ ? 0 : (ridgeLength / 2) * sign,
      baseY,
      roof.alongZ ? (ridgeLength / 2) * sign : 0,
      roof.alongZ ? (sign < 0 ? 0 : Math.PI) : (sign < 0 ? Math.PI / 2 : -Math.PI / 2),
      1,
      ),
      scaleAxes: [acrossScale, heightScale, acrossScale],
    });
  }
  eavesPlate(out, width, depth, roof, kit, baseY);
}

/**
 * Pivot height of the eaves plate, in metres.
 *
 * THE LETTERBOX. The gable now starts at STOREY_METRES and the ring wall now stops at
 * `STOREY_METRES * (1 / tierSilhouetteScale(tier))`, because `world/regionBuilder.ts` `emitParts`
 * scales the panel MESH by that compensation and leaves the placement height alone. Those are not
 * the same number anywhere but Coldbrace: measured with runs/corealm/audit/w4-leak.ts, the wall
 * head is 2.905 m at Rootfall against a 3.123 m gable base and 2.714 m at Highcairn, so a
 * horizontal slot 0.218 m and 0.409 m tall runs the full width of BOTH gable ends of every
 * building in those two towns. The eave hides the same band on the two long sides - the tiles are
 * out over it - but at a gable end the prism is open below the gable, so you look in one end,
 * over the wall head, under the tiles, and out the other.
 *
 * 2.915 is the one pivot that works at all three tiers. `wall_bottom_trim` straddles its pivot from
 * -0.117 to +0.121 at scale 1 and the plate is drawn at `((side + 0.3) / 2) * compensation`, so the
 * worst case is Highcairn's short 4 m gable end: 0.219 m below the pivot and 0.226 above it, which
 * spans 2.696 to 3.141 against a band of 2.714 to 3.123. The margin is 18 mm at the bottom and
 * 18 mm at the top; the 0.3 m in the scale is what buys it, and it also returns the plate 0.15 m
 * past each corner, which is what a wall plate does.
 *
 * When the root drops `compensation` this becomes decoration rather than a fix, and that is fine:
 * a plate under the eaves is what stops a wall head reading as a cut edge.
 */
const EAVES_PLATE_Y = 2.915;

/**
 * A wall plate along the head of the two GABLE-END walls.
 *
 * `wall_bottom_trim` carries one uniform scale, so stretching a single piece to the full gable also
 * made it several times too tall and deep. Tiling authored-size modules keeps the plate slim and
 * avoids a shelf intersecting the roof.
 *
 * Not on the eave sides: the tiles already cover that band there, and two more parts per building
 * on a hidden face is two more parts per building.
 */
function eavesPlate(
  out: PartPlacement[],
  width: number,
  depth: number,
  roof: PlacedRoof,
  kit: BuildingKit,
  baseY = STOREY_METRES,
): void {
  const sides = ringSides(width, depth);
  // The gable ends are the two faces the ridge runs INTO, which is the pair `gableEnds` closes.
  for (const [index, s] of (roof.alongZ ? [0, 2] : [1, 3]).entries()) {
    const side = sides[s]!;
    const count = moduleCount(side.length);
    for (let module = 0; module < count; module += 1) {
      // The shipped gable is a plaster-and-timber triangle even though its asset id says brick.
      // On Highcairn's stone shells that material change is useful vernacular, but it needs a
      // masonry collar beneath it or it reads as an accidental swap. kerb_straight is the kit's
      // low-cost RockTrim course; its rear-edge pivot is pulled 0.46 m into the wall so its 0.7 m
      // depth caps the brick head without projecting as a shelf. Plaster/timber buildings retain
      // their slender timber wall plate.
      const stone = kit.id === "stone";
      out.push(part(
        `plate${index}_${module}`, stone ? "kerb_straight" : "wall_bottom_trim",
        onSide(
          side,
          count,
          module,
          stone ? baseY - (STOREY_METRES - 2.989) : baseY - (STOREY_METRES - EAVES_PLATE_Y),
          stone ? -0.46 : 0.01,
        ),
        side.yaw,
      ));
    }
  }
}

/**
 * A post at every joint between two wall modules of one side.
 *
 * A ring side is `length / count` metres per slot and a panel is 2 m, so the joints meet exactly
 * only when the side is a whole number of modules AND the panel is drawn at its authored size.
 * It is not: `world/regionBuilder.ts` emits every building part at `1 / tierSilhouetteScale(tier)`,
 * so a 2 m panel draws 1.860 m at Rootfall and 1.738 m at Highcairn on 2 m centres. Measured with
 * shell-audit.ts: a full-height 0.140 m slot at every joint of every Rootfall building and 0.262 m
 * at Highcairn - four of them per quarry hut. The real fix is one line in `emitParts` and is not in
 * this file; a stud in the joint closes it either way, and a post where two panels meet is what
 * half-timbering actually looks like.
 *
 * Scaled to the storey so it reaches the wall head: `corner_wood` is 3.000 m and `corner_brick`
 * 3.016 against a 3.123 m wall. One instance per joint of an asset the building already draws four
 * of, so no new draw call.
 */
function jointStuds(
  out: PartPlacement[], tagPrefix: string, side: Side, count: number, kit: BuildingKit, y = 0,
): void {
  const spacing = side.length / count;
  for (let index = 0; index + 1 < count; index += 1) {
    out.push(part(
      `${tagPrefix}${index}`, kit.corner,
      onSide(side, count, index, y, 0, spacing / 2),
      side.yaw,
      storeyPostScale(kit),
    ));
  }
}

/** Scale the kit's structural post to meet the measured 3.123 m wall head. */
function storeyPostScale(kit: BuildingKit): number {
  return STOREY_METRES / kit.cornerHeight;
}

/** Gate jambs may use a different post family from the walls around them. */
function gatePostScale(kit: BuildingKit): number {
  return STOREY_METRES / kit.gateJambHeight;
}

// -------------------------------------------------------------- building kits

/**
 * The vernacular of one region: which wall family, which corner post, which roof, what a house is
 * made of.
 *
 * Phase 1 built every settlement out of one kit. Highcairn is a tier-10 quarry town forty metres
 * up a slate terrace and Coldbrace is a tier-1 frontier village on a river plain, and they were the
 * same eight cottages with the same plaster panels under the same orange pantiles; only the ground
 * colour told them apart. Nine more regions on top of that would have multiplied the problem by
 * nine, which is why the Phase 1 report put this before Phase 2 rather than in it.
 *
 * What the free kit actually gives us, measured rather than hoped for: two complete wall families
 * (plaster and brick), two corner posts, and three tiled roofs at two different pitches
 * (`roof_tiles_4x6` is 4.234 / 5.513 = 0.77; the 6-wide roofs are 5.672 / 8.250 = 0.69). It does
 * NOT ship a second roof covering — `roof_wood_plank` is a single 2.3 m board and
 * `roof_gable_brick` is a gable END, not a roof. So a kit differs in wall family, corner, roof
 * pitch, roof trim, and eaves; the tile texture itself is shared and re-coloured by the material
 * layer, which is the only thing the tint rule permits.
 */
export interface BuildingKit {
  id: KitId;
  /**
   * The default body panel. MUST be a panel whose plaster or brick primitive spans the full
   * 3.123 m storey - see the panel table at the top of this file. A frame (`wall_plaster_timber`)
   * or an apertured panel (`wall_*_window`) here makes every building in the settlement
   * see-through, which is what it did.
   */
  wall: string;
  wallWindow: string;
  wallDoor: string;
  /** The richer wall used on halls and civic buildings. Same solidity rule as `wall`. */
  wallFeature: string;
  /**
   * Half-timbering laid 0.02 m proud of a solid panel, or null.
   *
   * `wall_plaster_timber` is the only asset in the kit that is a frame rather than a wall: its
   * plaster infill stops at y 0.84 and the studs above it enclose nothing. Drawn ON a solid panel
   * it is exactly what it looks like - a timber frame on a wall - and it is the whole of
   * Rootfall's vernacular, so the logging town keeps its exposed frame and stops being
   * transparent. One extra instance per solid module, in an asset the settlement already draws.
   */
  frame: string | null;
  /**
   * The pier and jamb masonry of a gatehouse, whatever the houses are made of.
   *
   * In runs/corealm/screenshots/baseline-town_entrance.png the gate is grey masonry piers under a
   * timber arch; threading the house kit through `gatehouse()` turned it into pale plaster infill
   * with timber framing, which reads as a house facade with a hole in it. A town gate is the
   * heaviest thing in the wall and the kit's only full-height masonry wall family is brick, so all
   * three vernaculars build their gate out of the same stone and differ in what hangs on it.
   */
  gatePier: string;
  gateJamb: string;
  /** Height of `gateJamb` at scale 1. */
  gateJambHeight: number;
  /** How far `gateJamb` reaches along its local +Z from the pivot. */
  gateJambForward: number;
  corner: string;
  door: string;
  /** The 4x6-class roof, for cottages, sheds and huts. */
  roofSmall: string;
  /** Metres the small roof covers, short side then long. */
  roofSmallCovers: readonly [number, number];
  /**
   * The small roof's own bbox in X then Z at scale 1, eaves included.
   *
   * `roofSmallCovers` is the building it is meant to sit on; this is the tile the asset actually
   * draws, and the difference between the two is the eave. They are not proportional across the
   * kits - `roof_tiles_4x6` is 1.38x its cover in X and 1.26x in Z, `roof_tiles_6x8` is 1.38x and
   * 1.21x - so `roofOverhang` needs both numbers and cannot derive one from the other.
   */
  roofSmallBox: readonly [number, number];
  /**
   * Metres from the small roof's placement height to its ridge, at scale 1.
   *
   * Measured off the manifest bounds, not derived: these roofs pivot above their own eaves, so the
   * bbox height is not the distance from where the part is placed to where its ridge is.
   * `roof_tiles_4x6` is base y -0.516 + height 4.234, so its ridge is 3.718 above the pivot;
   * `roof_tiles_6x8` is -0.782 + 5.672, so 4.890. (This field said 4.97 for the stone kit, which is
   * 0.08 m of nothing.) Anything that has to sit ON the ridge — a log, a finial, a gable — needs it.
   */
  roofSmallApex: number;
  /**
   * Metres the small roof's lowest point hangs BELOW its placement height, at scale 1.
   *
   * The other half of the roof's cross-section, and the reason a gable can be fitted at all: the
   * roof is a triangle from `-roofSmallDrop` at the eave to `+roofSmallApex` at the ridge over
   * `roofSmallBox[0] / 2` of half-span, so its width where it crosses the wall head is
   * `acrossHalf * apex / (apex + drop)` and NOT the eave half-span. On a 6 x 4 plaster cottage
   * that is 2.421 m against an eave of 2.757 m: sizing a gable to the eave would stand it 0.34 m
   * proud of the tiles.
   */
  roofSmallDrop: number;
  /**
   * The straight tile plane of the small roof: `[apex, half]` at scale 1. See `RoofPitch`.
   *
   * NOT `[roofSmallApex, roofSmallBox[0] / 2]`. Those two are the bounding box, which is the top of
   * the ridge cap and the outer tip of the fascia; the plane the tiles actually run in is lower and
   * narrower, and it is the plane a gable has to lie in.
   */
  roofSmallPitch: RoofPitch;
  /** The long roof, for halls. */
  roofLarge: string;
  roofLargeCovers: readonly [number, number];
  /** The long roof's own bbox in X then Z at scale 1, eaves included. */
  roofLargeBox: readonly [number, number];
  /** Metres from the long roof's placement height to its ridge, at scale 1. */
  roofLargeApex: number;
  /** Metres the long roof's lowest point hangs below its placement height, at scale 1. */
  roofLargeDrop: number;
  /** The straight tile plane of the long roof: `[apex, half]` at scale 1. See `RoofPitch`. */
  roofLargePitch: RoofPitch;
  /**
   * Height of `corner`, at scale 1. `corner_wood` is 3.000 and `corner_brick` 3.016 against a
   * 3.123 m storey, so a post has to be scaled to reach the wall head rather than left 0.12 m short.
   */
  cornerHeight: number;
  /**
   * How far `corner` reaches past the footprint corner it stands on, at scale 1, in metres.
   *
   * `corners()` turns each post to face its own diagonal, so the reach is not half the bbox: on
   * `corner_brick` (x -0.353..0.178, z -0.199..0.377) a quarter turn puts the far edge at
   * (0.377 + 0.353) / sqrt(2) = 0.516 m from the pivot, against 0.159 m for `corner_wood`. A roof
   * fitted to the footprint alone therefore covers a plaster shed and leaves brick corner caps
   * standing through the tiles, which is what `shed[4x4] stone` did by 0.24 m.
   */
  cornerReach: number;
  /** Trim laid along the ridge line. Empty when the kit has none. */
  ridge: string | null;
  /** A dormer or gable end that changes the roofline. Empty when the kit has none. */
  roofFeature: string | null;
}

export type KitId = "plaster" | "timber" | "stone";

export const BUILDING_KITS: Record<KitId, BuildingKit> = {
  // Coldbrace. Lime-washed plaster over a timber frame, fired pantiles, a steep pitch to shed rain
  // off the river plain. The oldest and plainest of the three.
  plaster: {
    id: "plaster",
    wall: "wall_plaster_straight",
    wallWindow: "wall_plaster_window",
    wallDoor: "wall_plaster_door",
    // Was `wall_plaster_timber`, which has no infill above y 0.84, so the March Company Hall - the
    // 12 x 6 building in the middle of the square - was a frame you could see the far side of.
    // `wall_plaster_base` is the same plaster panel with a brick apron course, solid top to bottom,
    // and it was sitting unused in the manifest.
    wallFeature: "wall_plaster_base",
    frame: null,
    gatePier: "wall_brick_straight",
    gateJamb: "corner_brick",
    gateJambHeight: 3.016,
    gateJambForward: 0.377,
    corner: "corner_wood",
    door: "door_round_1",
    roofSmall: "roof_tiles_4x6",
    roofSmallCovers: [4, 6],
    roofSmallBox: [5.513, 7.572],
    roofSmallApex: 3.718,
    roofSmallDrop: 0.516,
    roofSmallPitch: [3.441, 2.479],
    roofLarge: "roof_tiles_6x12",
    roofLargeCovers: [6, 12],
    roofLargeBox: [8.25, 13.658],
    roofLargeApex: 4.89,
    roofLargeDrop: 0.782,
    roofLargePitch: [4.367, 3.538],
    cornerHeight: 3,
    cornerReach: 0.159,
    ridge: null,
    roofFeature: null,
  },
  // Rootfall. A logging town: every wall is exposed frame, every corner is a post, and the roofs
  // carry a felled log along the ridge because that is what the town has to spare. Dormers break
  // the roofline, which is what makes Rootfall read as a different place from the ridge above it.
  timber: {
    id: "timber",
    // The exposed frame is now the `frame` overlay, not the wall itself: `wall_plaster_timber`
    // encloses nothing above y 0.84, so every house in Rootfall was a lantern. The body is the
    // plain plaster panel and the frame goes on top of it, which is both what half-timbering is
    // and what the screenshot needed.
    wall: "wall_plaster_straight",
    wallWindow: "wall_plaster_window",
    wallDoor: "wall_plaster_door",
    wallFeature: "wall_plaster_base",
    frame: "wall_plaster_timber",
    gatePier: "wall_brick_straight",
    gateJamb: "corner_brick",
    gateJambHeight: 3.016,
    gateJambForward: 0.377,
    corner: "corner_wood",
    door: "door_round_2",
    roofSmall: "roof_tiles_4x6",
    roofSmallCovers: [4, 6],
    roofSmallBox: [5.513, 7.572],
    roofSmallApex: 3.718,
    roofSmallDrop: 0.516,
    roofSmallPitch: [3.441, 2.479],
    roofLarge: "roof_tiles_6x12",
    roofLargeCovers: [6, 12],
    roofLargeBox: [8.25, 13.658],
    roofLargeApex: 4.89,
    roofLargeDrop: 0.782,
    roofLargePitch: [4.367, 3.538],
    cornerHeight: 3,
    cornerReach: 0.159,
    ridge: "roof_log",
    roofFeature: "roof_dormer",
  },
  // Highcairn. Built out of the quarry it works: brick and cut stone to the eaves, brick corner
  // piers, and the shallower 6-wide roof, which reads as a lower, heavier building even at the
  // distance the whole terrace is seen from.
  stone: {
    id: "stone",
    wall: "wall_brick_straight",
    wallWindow: "wall_brick_window",
    wallDoor: "wall_brick_door",
    // Was `wall_brick_window`. `quarry_hut` and `hall` take `wallFeature` as their DEFAULT panel,
    // so the stone kit's feature wall being an apertured one meant every side of every Highcairn
    // hut was a window and you looked straight through the hut. The kit ships no second solid
    // brick panel, so the feature wall is the same masonry and the huts are differentiated by the
    // brick gable ends and the props, which is what already carried them at 40 m.
    wallFeature: "wall_brick_straight",
    frame: null,
    gatePier: "wall_brick_straight",
    gateJamb: "corner_brick",
    gateJambHeight: 3.016,
    gateJambForward: 0.377,
    corner: "corner_brick",
    door: "door_flat_1",
    roofSmall: "roof_tiles_6x8",
    roofSmallCovers: [6, 8],
    roofSmallBox: [8.25, 9.683],
    roofSmallApex: 4.89,
    roofSmallDrop: 0.782,
    roofSmallPitch: [4.396, 3.555],
    roofLarge: "roof_tiles_6x12",
    roofLargeCovers: [6, 12],
    roofLargeBox: [8.25, 13.658],
    roofLargeApex: 4.89,
    roofLargeDrop: 0.782,
    roofLargePitch: [4.367, 3.538],
    cornerHeight: 3.016,
    cornerReach: 0.516,
    ridge: null,
    // Was "roof_gable_brick". Closing the gable is no longer a stone-kit FEATURE, it is what every
    // pitched roof in the game now does (`gableEnds`), because leaving it open is what made the
    // towns see-through. What still separates Highcairn's roofline is the shallower 6-wide roof and
    // the region's own material tint.
    roofFeature: null,
  },
};

export const KIT_IDS: readonly KitId[] = ["plaster", "timber", "stone"] as const;

export function isKitId(value: string): value is KitId {
  return (KIT_IDS as readonly string[]).includes(value);
}

/**
 * How far this prefab's roof projects past its own footprint, per local axis, at this kit.
 *
 * The number a settlement author actually needs. Two buildings clear each other when the gap
 * between their footprints is at least the sum of the overhangs facing each other; Coldbrace
 * houses 5 and 6 were placed corner to corner with gapX = gapZ = 0.00 and interpenetrate over
 * 1.57 x 1.51 m of tile, which is exactly 2 x 0.786 and 2 x 0.757.
 *
 * Local axes: X is the footprint's width, Z its depth, before the building's own `rotationY`.
 * Anything without a tiled roof - a wall segment, ruin, stall, market row, porch, arcade or
 * wellhead - answers zero, because what those draw above the footprint is a canopy the caller
 * already sized (`CANOPY_DEPTH_METRES`) or nothing at all. Gatehouses use the same fitted long roof
 * as civic halls so their authored wall openings transition into a finished silhouette.
 */
export function roofOverhang(
  prefab: PrefabId,
  footprint: readonly [number, number],
  kitId: KitId = "plaster",
): { x: number; z: number } {
  const width = Math.max(MODULE_METRES, footprint[0]);
  const depth = Math.max(MODULE_METRES, footprint[1]);
  const kit = BUILDING_KITS[kitId];
  const beyond = (
    box: readonly [number, number],
    fit: { scale: number; rotationY: number },
  ): { x: number; z: number } => {
    // `roofFit` turns the asset a quarter when the plan is wider than it is deep, which swaps
    // which of the asset's axes covers the width.
    const spanX = (fit.rotationY === 0 ? box[0] : box[1]) * fit.scale;
    const spanZ = (fit.rotationY === 0 ? box[1] : box[0]) * fit.scale;
    return { x: r3(Math.max(0, (spanX - width) / 2)), z: r3(Math.max(0, (spanZ - depth) / 2)) };
  };
  const small = (): { scale: number; rotationY: number } =>
    roofFit(width, depth, kit.roofSmallCovers[0], kit.roofSmallCovers[1]);

  switch (prefab) {
    case "cottage":
    case "townhouse":
    case "forge":
      return beyond(kit.roofSmallBox, small());
    case "quarry_hut": {
      const fit = small();
      return beyond(kit.roofSmallBox, { scale: fit.scale * 0.98, rotationY: fit.rotationY });
    }
    case "hall":
    case "farmstead":
    case "gatehouse":
      return beyond(kit.roofLargeBox, roofFit(width, depth, kit.roofLargeCovers[0], kit.roofLargeCovers[1]));
    case "shed":
      return beyond(kit.roofSmallBox, {
        scale: shedRoofScale(kit, width, depth),
        rotationY: width >= depth ? Math.PI / 2 : 0,
      });
    // roof_tower is 5.651 x 7.361 x 5.427 and `tower` oversizes it by 0.6 m so the eaves clear the
    // walls, so its overhang is 0.30 m in X and less in Z whatever the footprint.
    case "tower":
      return beyond([5.651, 5.427], { scale: (Math.max(width, depth) + 0.6) / 5.651, rotationY: 0 });
    default:
      return { x: 0, z: 0 };
  }
}

/**
 * The single number to space buildings by in each vernacular: the deepest eave any prefab reaches
 * at the footprints the three settlements are authored with.
 *
 * Computed, not typed in, so it cannot drift from `roofOverhang`. Measured today: plaster and
 * timber 1.733 m (the 6 x 5 forge), stone 1.213 m (the 6 x 4 cottage). The 0.79 that
 * `ROOF_EAVE_METRES` used to be is the 6 x 4 plaster cottage and nothing else.
 */
export const ROOF_EAVE_BY_KIT: Record<KitId, number> = (() => {
  const authored: readonly (readonly [PrefabId, readonly [number, number]])[] = [
    ["cottage", [6, 4]], ["townhouse", [6, 4]], ["hall", [12, 6]], ["tower", [6, 6]], ["shed", [4, 4]],
    ["quarry_hut", [6, 4]], ["forge", [6, 4]], ["forge", [4, 4]], ["farmstead", [10, 6]],
  ];
  const worst = {} as Record<KitId, number>;
  for (const kitId of KIT_IDS) {
    worst[kitId] = authored.reduce((acc, [prefab, footprint]) => {
      const over = roofOverhang(prefab, footprint, kitId);
      return Math.max(acc, over.x, over.z);
    }, 0);
  }
  return worst;
})();

// ------------------------------------------------------------------ prefabs

/**
 * Assemble a prefab. Deterministic: the same `(prefab, footprint, seed, kit)` always returns the
 * same ordered list, so a rebuild at the same world seed is byte-identical.
 */
export function buildPrefab(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
  kitId: KitId = "plaster",
): PartPlacement[] {
  const width = Math.max(MODULE_METRES, footprint[0]);
  const depth = Math.max(MODULE_METRES, footprint[1]);
  const rng = new Rng(seed);
  const kit = BUILDING_KITS[kitId];
  let base: PartPlacement[];
  switch (prefab) {
    case "cottage": base = cottage(width, depth, rng, kit); break;
    case "townhouse": base = townhouse(width, depth, rng, kit); break;
    case "hall": base = hall(width, depth, rng, kit); break;
    case "tower": base = tower(width, depth, rng, kit); break;
    case "shed": base = shed(width, depth, rng, kit); break;
    case "quarry_hut": base = quarryHut(width, depth, rng, kit); break;
    case "gatehouse": base = gatehouse(width, depth, kit); break;
    case "wall_segment": base = wallSegment(width, kit); break;
    case "stall": base = stall(rng); break;
    case "ruin": base = ruin(width, depth, rng, kit); break;
    case "forge": base = forge(width, depth, rng, kit); break;
    case "porch": base = porch(width, depth, kit); break;
    case "arcade": base = arcade(width, depth, kit); break;
    case "market_row": base = marketRow(width, depth, rng); break;
    case "well": base = well(kit); break;
    case "farmstead": base = farmstead(width, depth, rng, kit); break;
  }
  return applyStructureVariant(prefab, footprint, seed, kit, base);
}

/** Solid height in metres, for the collision box the root builds from the same footprint. */
export function prefabHeight(prefab: PrefabId): number {
  switch (prefab) {
    case "tower": return 2 * STOREY_METRES + 6.8;
    case "hall": return STOREY_METRES + 4.9;
    case "cottage": return STOREY_METRES + 3.7;
    case "townhouse": return 2 * STOREY_METRES + 3.7;
    case "quarry_hut": return STOREY_METRES + 3.2;
    case "shed": return STOREY_METRES + 2.8;
    // Active gatehouses are [8,4]. Their 6x12 roof fits at 2/3 scale and rises 3.26 m above the
    // two-storey wall head. Keep a little clearance for the ridge tiles and regional recolouring.
    case "gatehouse": return 2 * STOREY_METRES + 3.35;
    case "wall_segment": return STOREY_METRES;
    case "ruin": return STOREY_METRES;
    case "stall": return 2.7;
    case "forge": return STOREY_METRES + 3.0;
    // The porch and the arcade are roofs you walk under; the number is the height of the thing that
    // is actually solid, which for both is the back wall, not the canopy over your head.
    case "porch": return STOREY_METRES;
    case "arcade": return STOREY_METRES;
    case "market_row": return 2.7;
    // The curb is solid; its walk-under roof is handled separately by camera cover. 0.25 was the
    // old flat trim ring; the curb now stands 0.55 m out of the ground, so the box has to as well
    // or the player walks through masonry they can see.
    case "well": return WELL_CURB_SHOW;
    // A barn is one tall storey under the kit's LARGE roof, so it clears the hall by the difference
    // between `roofLargeApex` and the hall's own roof: 3.123 + 5.4 against the hall's 3.123 + 4.9.
    case "farmstead": return STOREY_METRES + 5.4;
  }
}

/** Sparse, walk-through planting at the foundation; front slots stay clear of the centre door. */
function foundationGreenery(
  out: PartPlacement[], width: number, depth: number, rng: Rng, count: number,
): void {
  const slots: readonly (readonly [number, number])[] = [
    [-width / 2 + 0.65, -depth / 2 - 0.4], [width / 2 - 0.65, -depth / 2 - 0.4],
    [-width / 2 + 0.65, depth / 2 + 0.36], [width / 2 - 0.65, depth / 2 + 0.36],
    [-width / 2 - 0.36, -depth * 0.2], [-width / 2 - 0.36, depth * 0.2],
    [width / 2 + 0.36, -depth * 0.2], [width / 2 + 0.36, depth * 0.2],
  ];
  const start = rng.int(0, slots.length - 1);
  for (let index = 0; index < Math.min(count, slots.length); index += 1) {
    const [dx, dz] = slots[(start + index * 3) % slots.length]!;
    const assetId = rng.chance(0.72) ? "plant_leafy_small" : "plant_broad_small";
    const scale = rng.float(0.42, 0.62);
    const dy = assetId === "plant_leafy_small" ? 0.035 * scale : -0.079 * scale;
    out.push(loose(`foundation_plant_${index}`, assetId, dx, dy, dz, rng.float(0, Math.PI * 2), scale));
  }

  const sides = ringSides(width, depth);
  const sideIndex = [0, 1, 3][rng.int(0, 2)]!;
  const side = sides[sideIndex]!;
  const modules = moduleCount(side.length);
  out.push(part(
    "foundation_vine", "vine_1",
    // vine_1 reaches 2.121 m below its pivot. Seat the scaled roots on the foundation rather than
    // leaving a 16 cm strip of daylight beneath every cottage vine.
    onSide(side, modules, rng.int(0, modules - 1), 2.121 * 0.75, 0.1),
    side.yaw, 0.75,
  ));
}

/**
 * Six by four, one storey, tiled roof, chimney on the eave slope. Windows and the door module move
 * with the seed so eight cottages on one street are not eight copies of the same elevation.
 */
function cottage(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  const windows = ringWindows(sides, rng, 0.45, (s, index) => s === 2 && index === doorIndex);
  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      const assetId = isDoor ? kit.wallDoor : windows[s]![index] === true ? kit.wallWindow : kit.wall;
      wallModule(out, `${s}_${index}`, assetId, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }

  corners(out, width, depth, kit.corner, 0, storeyPostScale(kit), "c");

  const roof = smallRoof(kit, width, depth);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit);

  // On the eave slope, a quarter of the way in from the gable, so it clears the tiles and still
  // reads against the sky rather than hiding behind the ridge.
  out.push(loose(
    "chimney", "chimney",
    (width >= depth ? width : depth) * 0.26 * (rng.chance(0.5) ? 1 : -1),
    STOREY_METRES - 0.3,
    (width >= depth ? depth : width) / 2 - 0.55,
    0, 1,
  ));

  out.push(part(
    "door", kit.door,
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));
  foundationGreenery(out, width, depth, rng, 3);

  return out;
}

/**
 * A compact two-storey street house: brick ground floor, plaster-and-timber upper floor, a closed
 * tiled roof with one dormer, and a 4 x 2 m balcony aligned with both entrance doors.
 */
function townhouse(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);
  const isDoor = (s: number, index: number): boolean => s === 2 && index === doorIndex;
  const lowerKit: BuildingKit = {
    ...kit,
    wall: "wall_brick_straight",
    wallWindow: "wall_brick_window",
    wallDoor: "wall_brick_door",
    wallFeature: "wall_brick_straight",
    frame: null,
    corner: "corner_brick",
    cornerHeight: 3.016,
  };
  const upperKit: BuildingKit = {
    ...kit,
    wall: "wall_plaster_base",
    wallWindow: "wall_plaster_window",
    wallDoor: "wall_plaster_door",
    wallFeature: "wall_plaster_base",
    frame: "wall_plaster_timber",
    corner: "corner_wood",
    cornerHeight: 3,
  };
  const storeys: readonly { kit: BuildingKit; y: number; windows: boolean[][] }[] = [
    { kit: lowerKit, y: 0, windows: ringWindows(sides, rng, 0.38, isDoor) },
    { kit: upperKit, y: STOREY_METRES, windows: ringWindows(sides, rng, 0.55, isDoor) },
  ];

  for (const [storey, layer] of storeys.entries()) {
    for (const [s, side] of sides.entries()) {
      const modules = moduleCount(side.length);
      for (let index = 0; index < modules; index += 1) {
        const assetId = isDoor(s, index)
          ? layer.kit.wallDoor
          : layer.windows[s]![index] === true ? layer.kit.wallWindow : layer.kit.wall;
        wallModule(out, `${storey}_${s}_${index}`, assetId, side, modules, index, layer.kit, layer.y, `${s}_${index}`);
      }
      jointStuds(out, `j${storey}_${s}_`, side, modules, layer.kit, layer.y);
    }
    corners(out, width, depth, layer.kit.corner, layer.y, storeyPostScale(layer.kit), `c${storey}_`);
  }

  // The brick corner posts are more than twice the footprint of the upper timber posts. A slim
  // continuous ledger hides that abrupt step and makes the material change read as a deliberate
  // jettied storey. Tiling the authored two-metre trim keeps its height and depth unchanged.
  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      out.push(part(
        `belt_${s}_${index}`,
        "wall_bottom_trim",
        onSide(side, count, index, STOREY_METRES - 0.0615, 0.01),
        side.yaw,
      ));
    }
  }

  out.push(part("door_ground", kit.door, onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));
  out.push(part("door_balcony", kit.door, onSide(entry, entryCount, doorIndex, STOREY_METRES + 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));

  if (width >= 4) {
    const deckY = STOREY_METRES + 0.01;
    const railY = STOREY_METRES + 0.105;
    for (const [index, along] of [-1, 1].entries()) {
      out.push(part(`balcony_floor_${index}`, "floor_wood", onSide(entry, 1, 0, deckY, 1, along), entry.yaw));
      out.push(part(`balcony_front_${index}`, "balcony_straight", onSide(entry, 1, 0, railY, 1, along), entry.yaw));
    }
    out.push(part("balcony_side_l", "balcony_straight", onSide(entry, 1, 0, railY, 1, 1), entry.yaw + Math.PI / 2));
    out.push(part("balcony_side_r", "balcony_straight", onSide(entry, 1, 0, railY, 1, -1), entry.yaw - Math.PI / 2));
  }

  const roof = smallRoof(kit, width, depth);
  out.push(loose("roof", kit.roofSmall, 0, 2 * STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit, 2 * STOREY_METRES, true);
  out.push(loose("chimney", "chimney", width * 0.28, 2 * STOREY_METRES - 0.3, depth / 2 - 0.55, 0, 1));
  foundationGreenery(out, width, depth, rng, 4);
  return out;
}

/**
 * Close the roof and then give it the region's own line.
 *
 * The library ships one tiled covering at two pitches and nothing else — `roof_wood_plank` is a
 * single 2.3 m board — so the ROOFLINE is where a settlement gets its silhouette. Every roof is
 * closed at both ends now (`gableEnds`, which is the see-through fix); on top of that Rootfall
 * lays a felled log along the ridge and breaks the slope with a dormer, and Highcairn is the
 * shallower 6-wide pitch. Seen from the hillside above, that is the difference between "a village"
 * and "this village".
 */
function addRoofline(
  out: PartPlacement[],
  width: number,
  depth: number,
  roof: PlacedRoof,
  kit: BuildingKit,
  baseY = STOREY_METRES,
  forceDormer = false,
): void {
  gableEnds(out, width, depth, roof, kit, baseY);
  const alongZ = roof.alongZ;
  const ridgeLength = alongZ ? depth : width;
  const ridgeY = baseY + roof.apex;

  if (kit.ridge === "roof_log") {
    // roof_log's pivot is 3.85 m below the beam, and the beam runs along local Z for +-5.35 m, so
    // the log is scaled to the ridge it lies on and then dropped by its own pivot. Getting the
    // apex wrong buries it in the tiles and pushes its ends out through the eaves, which is
    // exactly how it looked before `roofSmallApex` was measured rather than guessed at.
    const logScale = Math.min(1, ridgeLength / 10.7);
    out.push(loose(
      "ridge", kit.ridge,
      // Bedded 0.2 m INTO the tiles: a ridge log is laid on the roof, not balanced on top of it.
      0, ridgeY - 3.85 * logScale - 0.2, 0,
      alongZ ? 0 : Math.PI / 2, logScale,
    ));
  }

  if (forceDormer || kit.roofFeature === "roof_dormer") {
    // roof_dormer's window faces local +X. Turn that axis down the entrance-side slope and keep
    // the pivot near the ridge; its 1.9 m forward reach then lands inside the tiled eave. The old
    // yaw ran the dormer along the ridge, burying one side and leaving the other floating.
    const compact = kit.id === "stone";
    const cross = compact ? 0.58 : 0.5;
    const dormerScale = compact ? 0.8 : 1;
    out.push(loose(
      "dormer", "roof_dormer",
      alongZ ? -cross : 0,
      baseY + (compact ? 0.58 : 0.19),
      alongZ ? 0 : -cross,
      alongZ ? Math.PI : Math.PI / 2,
      dormerScale,
    ));
  }

}

/** Twelve by six timber-framed hall: the biggest thing in Coldbrace after the vault tower. */
function hall(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  // A window band on alternate modules, which is the hall's elevation, minus any that would line
  // up with one across the building. On the 12 m faces `i` and `count - 1 - i` are always opposite
  // parities so the band survives intact; on the 6 m gable ends they are the same parity, so the
  // rule takes the two windows out of the second gable and the hall stops being a colonnade.
  const band = rng.chance(0.5) ? 0 : 1;
  // The off-band modules are skipped because they are SOLID, not because they are holes, so only
  // the doorway is declared an aperture. Handing the whole skip set to the opposite-side rule
  // would have the band give way to plain wall.
  const windows = ringWindows(
    sides, rng, 1,
    (s, index) => (s === 2 && index === doorIndex) || index % 2 !== band,
    (s, index) => s === 2 && index === doorIndex,
  );
  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      const assetId = isDoor
        ? kit.wallDoor
        : windows[s]![index] === true ? kit.wallWindow : kit.wallFeature;
      // Trim was long faces only, on the theory that the gable ends are not where the player
      // walks. Wrong on the measurement: the hall is 12 x 6 in the middle of an open square, so
      // both gable ends are seen from 8 m away, and the four modules saved were four modules of
      // untrimmed wall next to trimmed wall on the same building.
      wallModule(out, `${s}_${index}`, assetId, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }

  corners(out, width, depth, kit.corner, 0, storeyPostScale(kit), "c");

  const roof = largeRoof(kit, width, depth);
  out.push(loose("roof", kit.roofLarge, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  // The hall never had a roofline at all, so the biggest building in Coldbrace was the biggest
  // hole: 17.39 m2 of open gable per end, seen from the middle of the square.
  addRoofline(out, width, depth, roof, kit);
  out.push(loose("chimney", "chimney", width * 0.3, STOREY_METRES - 0.3, depth / 2 - 0.55, 0, 1.1));

  out.push(part(
    "door", kit.door,
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));
  // The kit banner is a projecting bracket: its rail mounts to the facade and local +X reaches
  // outward. Fit the full native rail beneath the sloping eave, whose outer underside drops
  // below the wall head. The compact lanterns retain 2.06 m walking clearance at their bottoms.
  out.push(wallMountedBanner(
    "banner_l", "banner_1", onSide(entry, entryCount, doorIndex, 1.80, WALL_FACE + 0.01, -2), entry.yaw, 0.72,
  ));
  out.push(wallMountedBanner(
    "banner_r", "banner_1", onSide(entry, entryCount, doorIndex, 1.80, WALL_FACE + 0.01, 2), entry.yaw, 0.72,
  ));
  out.push(part("lamp_l", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.06 - 0.082 * 0.37, WALL_FACE + 0.051 * 0.37, -1.2), entry.yaw, 0.37));
  out.push(part("lamp_r", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.06 - 0.082 * 0.37, WALL_FACE + 0.051 * 0.37, 1.2), entry.yaw, 0.37));
  foundationGreenery(out, width, depth, rng, 4);

  return out;
}

/**
 * Two storeys under a spire. "Visible from 300 m, which is the entire point of it" - 6.25 m of wall
 * plus a 7.9 m roof puts the finial at about 14 m, the tallest thing in Fallowmarch.
 *
 * It used to hardcode `wall_brick_straight` and `corner_brick` regardless of kit, which is why
 * Coldbrace's lime-plaster village had a brick vault tower in the middle of it. Same fix as
 * `wallSegment`, `gatehouse` and `ruin`.
 */
function tower(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  // Storey 1's lookout window used to be `floor(count / 2)` on all four sides. On the authored
  // 6 x 6 vault that is module 1 of 3 on every side, and module 1 faces module 1, so the tower had
  // two clear lines of sight straight through its belfry. Both storeys go through `ringWindows`,
  // which will not put a window opposite one.
  const plans = [
    ringWindows(sides, rng, 0.25, (s, index) => s === 2 && index === doorIndex),
    // Storey 1 skips everything but the lookout module, and every one of those skips is solid wall,
    // so nothing up here is a forced aperture.
    ringWindows(
      sides, rng, 1,
      (_s, index) => index !== Math.floor(moduleCount(sides[0]!.length) / 2),
      () => false,
    ),
  ];
  for (let storey = 0; storey < 2; storey += 1) {
    const y = storey * STOREY_METRES;
    const windows = plans[storey]!;
    for (const [s, side] of sides.entries()) {
      const count = moduleCount(side.length);
      for (let index = 0; index < count; index += 1) {
        const isDoor = storey === 0 && s === 2 && index === doorIndex;
        const assetId = isDoor
          ? kit.wallDoor
          : windows[s]![index] === true ? kit.wallWindow : kit.wall;
        wallModule(out, `${storey}_${s}_${index}`, assetId, side, count, index, kit, y, `${s}_${index}`);
      }
      jointStuds(out, `j${storey}_${s}_`, side, count, kit, y);
    }
    corners(out, width, depth, kit.corner, y, storeyPostScale(kit), `c${storey}_`);
  }

  // roof_tower's bbox is 5.651 across; oversize it slightly so the eaves clear the walls.
  out.push(loose("spire", "roof_tower", 0, 2 * STOREY_METRES, 0, 0, (Math.max(width, depth) + 0.6) / 5.651));

  out.push(part(
    "door", kit.door,
    onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET),
    entry.yaw,
  ));
  // Flank the door by whatever the facade actually has room for. A hard-coded 1.3 m is wider
  // than the half-width of a 4 m tower face, so at the shipped `tower [4,4]` both lamps hung
  // off the ends of the elevation with nothing behind them.
  const doorOffset = (doorIndex + 0.5) * (entry.length / entryCount) - entry.length / 2;
  const flank = Math.min(1.3, entry.length / 2 - 0.25 - Math.abs(doorOffset));
  out.push(part("lamp_l", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.1, 0.08, -flank), entry.yaw, 1.2));
  out.push(part("lamp_r", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.1, 0.08, flank), entry.yaw, 1.2));

  return out;
}

/** Four by four store shed. Plain walls, plank roof, a crate against the back wall. */
function shed(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = rng.int(0, Math.max(0, entryCount - 1));

  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      wallModule(out, `${s}_${index}`, isDoor ? kit.wallDoor : kit.wall, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }

  corners(out, width, depth, kit.corner, 0, storeyPostScale(kit), "c");
  // A 0.80 fit left the high timber frames and stone corner caps above the actual tile surface, and
  // 0.88 only looked like enough because it was measured against the roof's BOUNDING BOX. Against
  // the tile plane (`RoofPitch`) the stone kit's 0.88 x 4/6 = 0.587 drew a 3.52 m roof over a 4 m
  // shed: both brick corner caps and a joint stud stood 0.18-0.24 m through the tiles, and the
  // walls themselves were outside the covered span. A tightened roof is a look choice; a roof
  // narrower than its own building is a defect, so the fit is floored at what the posts need.
  const shedScale = shedRoofScale(kit, width, depth);
  const shedRoof = placeRoof(
    { scale: shedScale, rotationY: width >= depth ? Math.PI / 2 : 0 },
    kit.roofSmallBox, kit.roofSmallApex, kit.roofSmallDrop, kit.roofSmallPitch,
  );
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, shedRoof.rotationY, shedRoof.scale));
  // Gables only: a ridge log and a dormer on a 4 m store shed would out-dress the houses around it.
  gableEnds(out, width, depth, shedRoof, kit);
  out.push(part("door", kit.door, onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));
  const doorAt = onSide(entry, entryCount, doorIndex, 0, 0);
  const crateX = doorAt.dx >= 0 ? -width * 0.3 : width * 0.3;
  out.push(loose("crate", "crate_village", crateX, 0, depth / 2 + 0.65, rng.float(0, Math.PI), 1));

  return out;
}

/** Five by four quarry crew hut: timber walls, a plank roof, props and a tool crate. */
function quarryHut(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);

  // The body was `kit.wallFeature`, which in the stone kit was `wall_brick_window`: every module of
  // every Highcairn hut was an aperture, which is why the huts read as open pavilions from the
  // plateau. The body is the kit's solid wall now and the windows are the seeded exception.
  const windows = ringWindows(sides, rng, 0.35, (s, index) => s === 2 && index === doorIndex);
  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = s === 2 && index === doorIndex;
      const assetId = isDoor ? kit.wallDoor : windows[s]![index] === true ? kit.wallWindow : kit.wall;
      wallModule(out, `${s}_${index}`, assetId, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }

  corners(out, width, depth, kit.corner, 0, storeyPostScale(kit), "c");
  // The 0.98 is the hut's own tightened roof, and `addRoofline` used to be handed the UNtightened
  // fit, so every gable and ridge on a quarry hut was sized to a roof 2% bigger than the one drawn.
  const hutRoof = smallRoof(kit, width, depth, 0.98);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, hutRoof.rotationY, hutRoof.scale));
  addRoofline(out, width, depth, hutRoof, kit);
  out.push(part("door", kit.door, onSide(entry, entryCount, doorIndex, 0.02, 0.02, DOOR_LEAF_OFFSET), entry.yaw));

  // support_beam's pivot is 1.211 m under the post, so it has to be dropped to stand on the ground.
  out.push(loose("prop_l", "support_beam", -width / 2 - 0.35, -1.211 * 1.3, depth * 0.2, Math.PI / 2, 1.3));
  out.push(loose("prop_r", "support_beam", width / 2 + 0.35, -1.211 * 1.3, -depth * 0.2, -Math.PI / 2, 1.3));
  out.push(loose("crate", "crate_metal", -width * 0.25, 0, -depth / 2 - 0.6, rng.float(0, Math.PI), 1.2));

  return out;
}

/**
 * A barn. One tall storey of solid wall under the kit's LARGE roof, cart doors on the entry face,
 * and the yard clutter a working farm leaves outside them.
 *
 * WHY IT EXISTS. The structure lab needs a barn silhouette, and the library ships no farm building
 * at all - the asset report's gap 5. What it
 * does ship is the same modular kit every other building here is made of, so a barn is a `hall`
 * plan (long roof, one storey) with the hall's civic dressing taken off and a cart, crates, sacks
 * and a fodder barrel put in front of the doors instead. `roofLarge` rather than `roofSmall` is the
 * whole read: at a [10,6] footprint the plaster kit draws a 13.7 m ridge over a 10 m building,
 * which is a barn silhouette and not a cottage one.
 *
 * The door is on side 2, which is LOCAL -Z, exactly like `cottage`, `hall`, `shed` and
 * `quarry_hut`, so a settlement author points a farmstead at a yard with the same `rotationY` they
 * would use for a house. (The open-fronted prefabs - `forge`, `porch`, `arcade` - use +Z for their
 * mouth instead, which is the file's one standing inconsistency and is not mine to change here.)
 *
 * Windows are seeded at 0.3 and go through `ringWindows`, so no window ever faces the cart doors:
 * a barn is the deepest building in the settlement and a hole straight through it would be seen
 * from further away than any cottage's.
 */
function farmstead(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);
  const entry = sides[2]!;
  const entryCount = moduleCount(entry.length);
  const doorIndex = Math.floor(entryCount / 2);
  // An eight-metre barn gets a pair of adjacent door modules. The kit has no cart-door asset, but
  // two leaves read as a working loading entrance and preserve the opaque wall-module contract.
  const doorIndices = entryCount >= 4
    ? new Set([Math.floor((entryCount - 1) / 2), Math.floor(entryCount / 2)])
    : new Set([doorIndex]);
  const isCartDoor = (s: number, index: number): boolean => s === 2 && doorIndices.has(index);

  const windows = ringWindows(sides, rng, 0.3, isCartDoor);
  for (const [s, side] of sides.entries()) {
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const isDoor = isCartDoor(s, index);
      const assetId = isDoor
        ? kit.wallDoor
        : windows[s]![index] === true ? kit.wallWindow : kit.wall;
      wallModule(out, `${s}_${index}`, assetId, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }
  corners(out, width, depth, kit.corner, 0, storeyPostScale(kit), "c");

  const roof = largeRoof(kit, width, depth);
  out.push(loose("roof", kit.roofLarge, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit);

  // Keep the gable solid. `window_shutters` is only an overlay; placing it here without cutting a
  // window into `roof_gable_brick` produced the barn's most obvious fake aperture. Farmstead
  // recipes can still vary the loading facade and roofline without pasting shutters onto masonry.
  for (const index of [...doorIndices].sort((a, b) => a - b)) {
    out.push(part(
      index === doorIndex ? "door" : `door_${index}`,
      kit.door,
      onSide(entry, entryCount, index, 0.02, 0.02, DOOR_LEAF_OFFSET),
      entry.yaw,
    ));
  }
  out.push(part("lamp", "lamp_wall", onSide(entry, entryCount, doorIndex, 2.1, 0.08, 1.35), entry.yaw, 1.15));

  // The yard side. Everything here sits OUTSIDE the footprint, so it is outside the prefab's own
  // collision box and stays walk-through dressing, the same way `shed` puts its crate at
  // -depth / 2 - 0.65. The door module is the middle of the entry face, so the load is stacked to
  // one side of it and the cart is parked at the far corner rather than across the threshold.
  const front = -depth / 2;
  const load = width * 0.3;
  // `wagon` is 1.95 x 1.53 x 4.02 with its bed running along local Z, so a quarter turn lays it
  // along the front of the barn instead of pointing at the doors.
  out.push(loose("wagon", "wagon", -width / 2 + 1.2, 0, front - 2.4, Math.PI / 2 + rng.float(-0.12, 0.12), 1));
  out.push(loose("crate", "crate_village", load, 0, front - 1.0, rng.float(0, Math.PI)));
  out.push(loose("crate_apple", "farm_crate_apple", load + 0.95, 0, front - 1.5, rng.float(0, Math.PI)));
  out.push(loose("crate_carrot", "farm_crate_carrot", load - 0.85, 0, front - 1.7, rng.float(0, Math.PI)));
  out.push(loose("sack_l", "sack", load - 0.2, 0, front - 2.3, rng.float(0, Math.PI)));
  out.push(loose("sack_r", "sack", load + 0.5, 0, front - 2.5, rng.float(0, Math.PI)));
  out.push(loose("barrel", "barrel", -width / 2 + 0.55, 0, front - 0.75, rng.float(0, Math.PI)));
  // Two panels of the same fence the yard uses, running off each gable end, so the barn reads as
  // part of an enclosure even when it is placed on its own.
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(
      `fence${index}`, "fence_wood_single",
      (width / 2 + 1.03) * sx, -0.1, front + 0.4, 0,
    ));
  }

  return out;
}

/**
 * How a gatehouse of a given footprint width divides into two piers and the gap between them.
 *
 * The one place the gate's clear width is decided. `gatehouse()` draws to it and
 * `prefabCollision("gatehouse")` collides to it, so the hole you can see and the hole you can walk
 * through are the same hole - which they were not: the drawn arch was 4 m wide and the collision
 * gap was 2 m, and after navmesh erosion the walkable part of it was 0.20 m.
 *
 * Piers are always whole unscaled 2 m modules. Scaling a wall panel to make a pier fit would scale
 * its height too (a 1 m pier is a 1.56 m wall), so the gap absorbs the remainder instead and the
 * floor is one module per side. `width - 2 * pierWidth` is therefore never narrower than
 * GATE_GAP_METRES once the footprint is 8 m or more, and at 6 m it is 2 m, which is the widest a
 * 6 m gatehouse can be.
 */
function gateGeometry(width: number): { pierWidth: number; gap: number } {
  // Snapped to the module grid, then floored at 6 m: below that there is no room for two piers and
  // a passage at all, and off-grid the head course would need a fractional panel. Both callers
  // clamp identically, so an off-grid footprint still gets collision that matches its geometry.
  const usable = Math.max(3 * MODULE_METRES, MODULE_METRES * Math.round(width / MODULE_METRES));
  const roomFor = Math.max(1, Math.floor((usable - MODULE_METRES) / (2 * MODULE_METRES)));
  const wanted = Math.floor((usable - GATE_GAP_METRES) / (2 * MODULE_METRES));
  const pierWidth = Math.max(1, Math.min(roomFor, wanted)) * MODULE_METRES;
  return { pierWidth, gap: usable - 2 * pierWidth };
}

/**
 * A walled gate: two piers two storeys high, with the upper storey carried across the gap so there
 * is a chamber over the road instead of a hole in the skyline.
 *
 * WHY THE `wall_arch` PANEL IS GONE. It was the obvious thing to span the gap with and it is the
 * reason the gate never worked. Measured off the GLB: the panel is 2.000 x 3.000 x 0.064 with solid
 * jambs from |x| = 0.72 outwards, so its clear opening is 1.44 m of a 2 m panel - 72%, fixed, at
 * every scale. To show a 4 m opening it has to be 5.56 m wide and therefore 8.33 m tall, which is
 * 2.1 m above a two-storey gatehouse; scaled to fit the height instead it shows a 3.0 m opening in
 * front of a 4 m gap, so the player's shoulder passes through the jamb. There is no scale at which
 * the arch's opening, the pier gap and the collision box agree. A kit head course over an open gap
 * makes all three exactly GATE_GAP_METRES.
 *
 * WHY THE GATE IS MASONRY IN ALL THREE KITS. Threading the house kit through this prefab - which is
 * finding 7 of the settlement diagnosis, and correct as far as the walls and the tower go - turned
 * the Coldbrace south gate into plaster infill in a timber frame, i.e. a house facade with a hole
 * punched in it, against a baseline (baseline-town_entrance.png) of grey piers under a timber arch.
 * A gate is the heaviest thing in a wall and it is the first building a player ever sees. It is
 * still per-kit data - `kit.gatePier` and `kit.gateJamb` - so a fourth vernacular can build its
 * gate out of something else; all three today name the kit's only full-height masonry.
 *
 * The head course is masonry too, and deliberately has no window in it. The middle head panel used
 * to be `kit.wallWindow`, and `wall_plaster_window` carries a loose brick apron quad across its own
 * bottom 0.88 m: on a panel standing on the ground that is the sill, and three metres up over an
 * open passage it is the small framed panel floating in the arch in wire-town_entrance.png.
 */
function gatehouse(width: number, depth: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const { pierWidth, gap } = gateGeometry(width);
  const usable = gap + 2 * pierWidth;
  const pierModules = Math.round(pierWidth / MODULE_METRES);
  const faceZ = depth / 2;
  const sideModules = moduleCount(depth);
  const sideSpacing = depth / sideModules;
  const jambScale = gatePostScale(kit);
  // The passage jamb pivots sit their measured forward reach inside
  // the pier so the visible masonry stops on the same +/-gap/2 line as the collision boxes.
  const passageJambInset = kit.gateJambForward * jambScale;
  // A wall panel's outward face is WALL_FACE past its pivot, so trim placed 0.01 further out sits
  // on the face rather than inside it; `outward` carries the flip for the -Z elevation.
  const faces: readonly (readonly [string, number, number])[] = [["f", faceZ, 0], ["b", -faceZ, Math.PI]];
  // The outer face and the passage face of each pier. A gate built from front and back elevations
  // alone is two scenery cards with 2.37 m of daylight through each side at the authored 3 m
  // depth. These four returns make each pier a closed masonry shell without narrowing the 4 m
  // collision passage.
  const returns: readonly (readonly [string, number, number, number])[] = [
    ["ol", -usable / 2, -Math.PI / 2, -1],
    ["il", -gap / 2 - WALL_FACE, Math.PI / 2, 1],
    ["ir", gap / 2 + WALL_FACE, -Math.PI / 2, -1],
    ["or", usable / 2, Math.PI / 2, 1],
  ];

  for (let storey = 0; storey < 2; storey += 1) {
    const y = storey * STOREY_METRES;
    for (const [name, z, yaw] of faces) {
      const outward = Math.sign(z);
      for (const [index, sx] of [-1, 1].entries()) {
        for (let m = 0; m < pierModules; m += 1) {
          const x = sx * (usable / 2 - (m + 0.5) * MODULE_METRES);
          out.push(loose(`p${name}${storey}_${index}_${m}`, kit.gatePier, x, y, z, yaw));
          if (storey === 0) {
            out.push(loose(`q${name}${index}_${m}`, "wall_bottom_trim", x, 0, z + outward * 0.01, yaw));
          }
        }
      }
      // The head: the upper storey carried across the gap. Clear headroom under it is one full
      // storey, 3.123 m, against a 1.8 m player.
      if (storey === 1) {
        // `gateGeometry` snaps the width to the module grid, so the gap is a whole number of
        // modules and every head panel is unscaled.
        const headModules = Math.max(1, Math.round(gap / MODULE_METRES));
        for (let m = 0; m < headModules; m += 1) {
          const x = (m + 0.5) * MODULE_METRES - gap / 2;
          out.push(loose(`h${name}_${m}`, kit.gatePier, x, y, z, yaw));
        }
      }
    }

    for (const [name, x, yaw, outward] of returns) {
      for (let m = 0; m < sideModules; m += 1) {
        const z = (m + 0.5) * sideSpacing - depth / 2;
        out.push(loose(`r${name}${storey}_${m}`, kit.gatePier, x, y, z, yaw));
        if (storey === 0) {
          out.push(loose(
            `u${name}_${m}`, "wall_bottom_trim", x + outward * 0.01, 0, z, yaw,
          ));
        }
      }
      // A post at each return-wall module joint keeps the masonry course legible.
      for (let m = 1; m < sideModules; m += 1) {
        const jointX = name === "il"
          ? -gap / 2 - passageJambInset
          : name === "ir" ? gap / 2 + passageJambInset : x;
        out.push(loose(
          `j${name}${storey}_${m - 1}`, kit.gateJamb,
          jointX, y, -depth / 2 + m * sideSpacing, yaw, jambScale,
        ));
      }
    }

    corners(out, usable, depth, kit.gateJamb, y, jambScale, `c${storey}_`);
    // The four passage corners are not footprint corners, so `corners` cannot place their jambs.
    let innerCorner = 0;
    for (const sx of [-1, 1]) {
      const yaw = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
      for (const sz of [-1, 1]) {
        out.push(loose(
          `i${storey}_${innerCorner}`, kit.gateJamb,
          sx * (gap / 2 + passageJambInset), y, sz * faceZ,
          yaw, jambScale,
        ));
        innerCorner += 1;
      }
    }
  }

  // A masonry ceiling over the passage and a flat top deck. `floor_brick` is exactly 2 x 2 m, and
  // authored gate depths snap to that grid. X remains on the same grid and the passage stays four
  // metres wide.
  const deck = (tag: string, span: number, y: number): void => {
    const columns = Math.max(1, Math.round(span / MODULE_METRES));
    for (let zIndex = 0; zIndex < sideModules; zIndex += 1) {
      const z = (zIndex + 0.5) * sideSpacing - depth / 2;
      for (let xIndex = 0; xIndex < columns; xIndex += 1) {
        const x = (xIndex + 0.5) * MODULE_METRES - span / 2;
        out.push(loose(`${tag}_${zIndex}_${xIndex}`, "floor_brick", x, y, z));
      }
    }
  };
  deck("ceiling", gap, STOREY_METRES);
  // floor_brick extends 0.01 m below its pivot; lift the roof deck so its underside meets the wall.
  deck("deck", usable, 2 * STOREY_METRES + 0.01);

  // Finish the gate as a building, not a wall box with its top sliced off. The shared 6x12 civic
  // roof fits an 8x4 gate at exactly two-thirds scale, giving modest eaves rather than the enormous
  // front/back overhang the cottage roof produces on this aspect ratio. Its gables and regional
  // trim use the same kit as the settlement, so the gate belongs to the town while its load-bearing
  // piers remain masonry.
  const roof = largeRoof(kit, usable, depth);
  out.push(loose("roof", kit.roofLarge, 0, 2 * STOREY_METRES, 0, roof.rotationY, roof.scale));
  gableEnds(out, usable, depth, roof, kit, 2 * STOREY_METRES);

  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(`lamp${index}`, "lamp_wall", (gap / 2 + 0.45) * sx, 2.3, faceZ + 0.12, 0, 1.2));
    out.push(wallMountedBanner(
      `banner${index}`,
      "banner_1",
      { dx: sx * (gap / 2 + pierWidth / 2), dy: STOREY_METRES + 2.0, dz: faceZ + WALL_FACE + 0.01 },
      0,
      1.05,
    ));
  }

  return out;
}

/**
 * A straight run of town wall with a corner post at each end and trim along the base.
 *
 * Kept for the authored `wall_segment` buildings that predate `buildWallRun`. New settlements
 * should author a `WallRunDef` instead - four of these is 32 m of wall on a 212 m circuit, which is
 * the measured state of Coldbrace and the reason the player called it "a random gate without a
 * wall".
 */
function wallSegment(width: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const count = moduleCount(width);
  const spacing = width / count;
  for (let index = 0; index < count; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    out.push(loose(`w${index}`, kit.wall, x, 0, 0, 0));
    out.push(loose(`t${index}`, "wall_bottom_trim", x, 0, 0.01, 0));
    if (kit.frame !== null) out.push(loose(`f${index}`, kit.frame, x, 0, 0.02, 0));
  }
  out.push(loose("end_l", kit.corner, -width / 2, 0, 0, -Math.PI / 4, storeyPostScale(kit)));
  out.push(loose("end_r", kit.corner, width / 2, 0, 0, Math.PI / 4, storeyPostScale(kit)));
  return out;
}

/** A market pitch. No authored settlement uses it yet; kept so the prefab table is total. */
function stall(rng: Rng): PartPlacement[] {
  return [
    loose("stall", "market_stall", 0, 0, 0, 0, 1),
    loose("crate", "crate_wood", -1.1, 0, -0.7, rng.float(0, Math.PI), 1),
    loose("barrel", "barrel", 1.1, 0, -0.6, rng.float(0, Math.PI), 1),
    loose("sack", "sack", 0.9, 0, 0.5, rng.float(0, Math.PI), 1),
  ];
}

/** A collapsed shell: two standing walls, a fallen corner, rubble and vines. */
function ruin(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const count = moduleCount(width);
  const spacing = width / count;
  const returnZ = depth / 2 - MODULE_METRES / 2;
  for (let index = 0; index < count; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    const lean = rng.float(-0.05, 0.05);
    out.push(loose(`w${index}`, kit.wall, x, 0, depth / 2, lean));
    // A ruin needs its footing more than anything else does: without it the standing panels read as
    // props dropped on grass rather than the last two walls of something that was built here. Same
    // lean as the panel above it, or the plinth shears away from the wall it is under.
    out.push(loose(`t${index}`, "wall_bottom_trim", x, 0, depth / 2 + 0.01, lean));
  }
  out.push(loose("side", kit.wall, -width / 2, 0, returnZ, -Math.PI / 2));
  // The returning wall had no plinth, so one of the ruin's two standing panels came out of the
  // ground and the other was stuck in it. Same yaw as the panel it sits under, pushed 0.01 out
  // along that panel's own outward normal (-X) so the two faces do not z-fight.
  out.push(loose("side_trim", "wall_bottom_trim", -width / 2 - 0.01, 0, returnZ, -Math.PI / 2));
  out.push(loose(
    "post", kit.corner, width / 2, 0, depth / 2, Math.PI / 4, storeyPostScale(kit),
  ));
  out.push(loose("rub1", "rubble_brick_1", rng.float(-1.5, 1.5), 0, rng.float(-2, 0), rng.float(0, Math.PI), 2.4));
  out.push(loose("rub2", "rubble_brick_2", rng.float(-1.5, 1.5), 0, rng.float(-2, 0), rng.float(0, Math.PI), 2.2));
  out.push(loose("vine", "vine_1", -width / 2 + 0.2, 3.0, returnZ - 0.6, -Math.PI / 2, 1.3));
  return out;
}

// ----------------------------------------------------------- open structures

/** A native wall, footing and full-depth slab share the same bay contract in every kit.
 * Separate walls let window variants retain the same canopy and plinth as adjacent bays.
 */
function coveredBay(
  out: PartPlacement[], tag: string, kit: BuildingKit, dx: number, backZ: number,
): void {
  out.push(loose(`${tag}w`, kit.wall, dx, 0, backZ, 0));
  out.push(loose(`${tag}t`, "wall_bottom_trim", dx, 0, backZ + 0.01, 0));
  // Native upward rays put the main deck underside at about -.069, while the -.324 bounding
  // minimum belongs to its hanging brackets. Seat the deck itself on the wall/post heads.
  const reach = CANOPY_DEPTH_METRES + WALL_THICKNESS - WALL_FACE;
  const stretch = r4(reach / 2.022);
  out.push({
    ...loose(
      `${tag}o`, "overhang_brick",
      dx, STOREY_METRES + 0.074, r3(backZ - WALL_THICKNESS + WALL_FACE + 1.022 * stretch), 0,
    ),
    scaleAxes: [1, 1, stretch],
  });
}

/** How many whole 2 m bays a covered structure of this width gets, at least `low`, at most `high`. */
function bayCount(width: number, low: number, high: number): number {
  return clamp(Math.round(width / MODULE_METRES), low, high);
}

/**
 * A working forge: walls on three sides, the fourth face wide open, and the anvil standing in the
 * mouth of it.
 *
 * This is the prefab that answers "a random bank chest and anvil just tossed in the middle of
 * town". Measured nearest building surface to the Coldbrace anvil today: 8.56 m of open grass. The
 * open face is LOCAL +Z, so a settlement author points it at the square with the same `rotationY`
 * they would use to point a cottage door at it, and there is no doorway to erode: the mouth is
 * `width - 1.2` m wide, which at a 6 m footprint leaves 4.8 m of opening and a 3.9 x 3.5 m navmesh
 * island connected to the square, instead of the 0.20 m a real door would have left.
 */
function forge(width: number, depth: number, rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const sides = ringSides(width, depth);

  // Sides 1, 2, 3 only. Side 0 is +Z and stays open.
  //
  // The back centre used to be forced to `kit.wallWindow`, which put a hole straight through the
  // wall the anvil stands against - the one face of a forge the player looks at from the square.
  // Windows are the seeded exception on the two side walls, and `ringWindows` keeps the left and
  // right walls from lining up a pair.
  // Side 0 is skipped because it is the open mouth - a hole - and side 2 because the back wall the
  // anvil stands against must stay solid, so only side 0 is declared an aperture.
  const windows = ringWindows(sides, rng, 0.3, (s) => s === 0 || s === 2, (s) => s === 0);
  for (const s of [1, 2, 3]) {
    const side = sides[s]!;
    const count = moduleCount(side.length);
    for (let index = 0; index < count; index += 1) {
      const assetId = windows[s]![index] === true ? kit.wallWindow : kit.wall;
      wallModule(out, `${s}_${index}`, assetId, side, count, index, kit);
    }
    jointStuds(out, `j${s}_`, side, count, kit);
  }

  corners(out, width, depth, kit.corner, 0, storeyPostScale(kit), "c");

  const roof = smallRoof(kit, width, depth);
  out.push(loose("roof", kit.roofSmall, 0, STOREY_METRES, 0, roof.rotationY, roof.scale));
  addRoofline(out, width, depth, roof, kit);

  // support_beam is a horizontal beam at y 1.709 (at scale 1) with a knee brace and a stub foot at
  // its own z = -0.118; dropping it by 1.211 puts that foot on the ground. Two of them run back
  // from the mouth along each side wall, which is what stops the open face reading as a missing
  // wall. Scaled off the depth so the beam always ends inside the building.
  const strut = clamp(depth / 3, 1.2, 1.9);
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(
      `strut${index}`, "support_beam",
      (width / 2 - 0.3) * sx, -1.211 * strut, depth / 2 - 0.2, Math.PI, strut,
    ));
  }

  // On the back wall, facing out of the mouth: the only light source inside the structure.
  out.push(loose("lamp", "lamp_wall", -width * 0.22, 2.15, -depth / 2 + 0.4, 0, 1.15));

  return out;
}

/**
 * A roof on two posts and nothing else you can walk into. Two or three covered bays over a back
 * wall, a lamp and a banner.
 *
 * The canopy always projects exactly CANOPY_DEPTH_METRES from the footprint's back edge, so author
 * porch footprints 2.2-3.0 m deep; anything deeper leaves uncovered ground inside its own
 * exclusion rectangle. The bays snap to whole 2 m modules, so a [4,3] porch is two bays and a
 * [6,3] is three regardless of the exact authored width.
 */
/** How far a covered bay's back wall face stands in front of the bay's authored anchor. */
export function bayWallFace(_kit: BuildingKit): number {
  return WALL_FACE;
}

/** The whole native lantern fits above headroom and below the supported slab. */
const BAY_LAMP_SCALE = 0.55;
const BAY_LAMP_HEAD_Y = 2.1 + 1.337 * BAY_LAMP_SCALE;
const LAMP_WALL_BASE_Y = 0.082;
const LAMP_WALL_HEIGHT = 1.337;
const LAMP_WALL_PLATE_Z = -0.051;

function bayLamp(tag: string, kit: BuildingKit, dx: number, backZ: number): PartPlacement {
  return loose(
    tag,
    "lamp_wall",
    dx,
    r3(BAY_LAMP_HEAD_Y - (LAMP_WALL_BASE_Y + LAMP_WALL_HEIGHT) * BAY_LAMP_SCALE),
    r3(backZ + bayWallFace(kit) - LAMP_WALL_PLATE_Z * BAY_LAMP_SCALE),
    0,
    BAY_LAMP_SCALE,
  );
}

function porch(width: number, depth: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const bays = bayCount(width, 2, 3);
  const span = bays * MODULE_METRES;
  const backZ = -depth / 2;
  const frontZ = backZ + CANOPY_DEPTH_METRES;

  for (let index = 0; index < bays; index += 1) {
    coveredBay(out, `b${index}_`, kit, (index + 0.5) * MODULE_METRES - span / 2, backZ);
  }
  // Scale the kit post to the wall head. The raw wood and brick posts stop 0.123 m and 0.107 m
  // short respectively, which leaves the stone canopy visibly unsupported from a low camera.
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(
      `post${index}`, kit.corner,
      (span / 2 - 0.12) * sx, 0, frontZ - 0.12,
      Math.atan2(sx, 1), storeyPostScale(kit),
    ));
  }
  out.push(bayLamp("lamp", kit, -span / 2 + 0.7, backZ));
  out.push(wallMountedBanner(
    "banner", "banner_1",
    { dx: span / 2 - 0.55, dy: 2.38, dz: backZ + WALL_FACE + 0.01 },
    0,
    0.75,
  ));

  return out;
}

/** A covered market row: n bays of canopy over one back wall, on a colonnade. */
function arcade(width: number, depth: number, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const bays = bayCount(width, 2, 8);
  const span = bays * MODULE_METRES;
  const backZ = -depth / 2;
  const frontZ = backZ + CANOPY_DEPTH_METRES;

  for (let index = 0; index < bays; index += 1) {
    coveredBay(out, `b${index}_`, kit, (index + 0.5) * MODULE_METRES - span / 2, backZ);
  }
  // A post at every bay joint, not just the ends: the colonnade is the silhouette, and the posts
  // are the only thing that tells you at 40 m that the row is roofed rather than walled.
  for (let index = 0; index <= bays; index += 1) {
    const x = index * MODULE_METRES - span / 2;
    out.push(loose(`post${index}`, kit.corner, x, 0, frontZ - 0.12, 0, storeyPostScale(kit)));
  }
  out.push(loose("end_l", kit.corner, -span / 2, 0, backZ, -Math.PI / 4, storeyPostScale(kit)));
  out.push(loose("end_r", kit.corner, span / 2, 0, backZ, Math.PI / 4, storeyPostScale(kit)));
  out.push(bayLamp("lamp_l", kit, -span / 2 + 1, backZ));
  out.push(bayLamp("lamp_r", kit, span / 2 - 1, backZ));

  return out;
}

/**
 * A row of market pitches with goods stacked between them and a kerb along the customer side.
 *
 * Pitches sit on ~3 m centres, which is `market_stall`'s 1.845 m body plus room to stand between
 * two of them.
 */
function marketRow(width: number, depth: number, rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const pitches = Math.max(1, Math.round(width / 3));
  const spacing = width / pitches;
  const backZ = -depth / 2 + 0.55;

  for (let index = 0; index < pitches; index += 1) {
    const x = (index + 0.5) * spacing - width / 2;
    out.push(loose(`stall${index}`, "market_stall", x, 0, backZ, 0));
    if (index === pitches - 1) continue;
    // Goods go on the joint between two pitches, never in front of one, or they block the counter
    // the shop's interaction is anchored to.
    const bx = (index + 1) * spacing - width / 2;
    const pick = rng.int(0, 2);
    const first = pick === 0 ? "crate_wood" : pick === 1 ? "barrel" : "sack";
    const second = pick === 0 ? "sack" : "crate_wood";
    out.push(loose(`goods${index}a`, first, bx - 0.25, 0, backZ + 0.15, rng.float(0, Math.PI)));
    out.push(loose(`goods${index}b`, second, bx + 0.45, 0, backZ + 0.75, rng.float(0, Math.PI)));
  }

  const kerbs = Math.max(1, Math.round(width / MODULE_METRES));
  const kerbSpacing = width / kerbs;
  for (let index = 0; index < kerbs; index += 1) {
    // kerb_straight is 2.000 x 0.134 x 0.700 with its body entirely on the +Z side of its pivot.
    out.push(loose(
      `kerb${index}`, "kerb_straight",
      (index + 0.5) * kerbSpacing - width / 2, 0, depth / 2 - 0.7, 0, kerbSpacing / MODULE_METRES,
    ));
  }

  return out;
}

/**
 * Scale of the four wall panels that make the wellhead curb. 1.4 m a side on a 2 m module.
 */
const WELL_CURB_SCALE = 0.7;

/**
 * The curb is masonry in every vernacular, like a gatehouse pier.
 *
 * Built from `kit.wall` it came out of Coldbrace as a lime-plaster box in the middle of a cobbled
 * square: a rendered planter, not a well. A shaft is lined with stone wherever the houses around it
 * are made of plaster, timber or brick, and `wall_brick_straight` is the kit's only full-height
 * masonry panel - the same reasoning `gatePier` already carries.
 */
const WELL_CURB_ASSET = "wall_brick_straight";

/**
 * How much of `kerb_straight`'s 0.7 m depth the coping keeps, as a fraction.
 *
 * The full depth at 0.7 scale is 0.49 m laid on a 0.284 m wall, which closed a 1.4 m wellhead down
 * to a 0.42 m hole and read as a bench. 0.82 caps the wall with about 3 cm of overhang inside and
 * 8 cm out, and leaves a 0.76 m mouth: a well you could actually drop a bucket down.
 */
const WELL_COPING_DEPTH = 0.82;

/** Metres of curb standing out of the ground. Mirrored by `prefabHeight("well")`. */
const WELL_CURB_SHOW = 0.55;

/**
 * A wellhead. There is no well asset in the library, so it is composed: a 1.4 m curb of kit corner
 * posts and trim, two beams across it, a plank roof, a bucket and a coil of chain.
 *
 * Sizes are all measured. `wall_bottom_trim` is 2.000 long, so at 0.7 it is exactly the 1.4 m ring
 * and four of them close it. `roof_wood_plank` is a mono-pitch 2.258 x 1.560 that is high at its own
 * z = 0 and low at z = 1.56, so two of them back to back at the same point make a gable with the
 * ridge over the shaft. The corner posts are scaled to 0.76 (2.28 m), leaving about 13 mm below
 * the measured plank underside at their footprints. Those four posts are the complete support system; the old
 * extra pair of `support_beam` assemblies duplicated them almost from ground to eave.
 */
function well(kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const ring = 0.7;

  const signs: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [index, sign] of signs.entries()) {
    out.push(loose(
      `post${index}`, kit.corner,
      ring * sign[0], 0, ring * sign[1], Math.atan2(sign[0], sign[1]), 0.76,
    ));
  }

  // THE CURB HAD NO HEIGHT. Four `wall_bottom_trim` at 0.7 is a 0.167 m band, and on a cobbled
  // square that is entirely lost in the paving: the wellhead read as a roof on four sticks with a
  // bucket beside it, which is the whole landmark missing. A kit wall panel at 0.7 is 1.40 x 2.19 x
  // 0.28 - the right plan and far too tall - so it is SUNK 1.64 m and only the top 0.55 m stands
  // out of the ground. The buried courses are under the terrain mesh, which occludes them, and the
  // result is a real masonry curb of the right section at no new asset and no new draw call.
  const curbSink = r3(WELL_CURB_SHOW - STOREY_METRES * WELL_CURB_SCALE);
  const face = WALL_FACE * WELL_CURB_SCALE;
  // `kerb_straight` is 0.134 tall and 0.700 deep at scale 1, with its body entirely on +Z of its
  // pivot; at 0.7 that is a 0.094 x 0.490 coping, laid pointing INWARD from 0.08 m outside the
  // curb face so it caps the masonry with a shadow line under its outer edge.
  const copingOverhang = 0.08;
  for (const [index, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
    const outX = Math.sin(yaw);
    const outZ = Math.cos(yaw);
    out.push(loose(
      `curb${index}`, WELL_CURB_ASSET,
      outX * (ring - face), curbSink, outZ * (ring - face), yaw, WELL_CURB_SCALE,
    ));
    out.push({
      ...loose(
        `coping${index}`, "kerb_straight",
        outX * (ring + copingOverhang), r3(WELL_CURB_SHOW - 0.134 * WELL_CURB_SCALE),
        outZ * (ring + copingOverhang),
        yaw + Math.PI, WELL_CURB_SCALE,
      ),
      // Runs to +-0.780 so the four pieces lap at the corners. Left at 1 they stopped at
      // +-0.700 and left an 80 mm open column at each corner of the ring.
      scaleAxes: [1.1143, 1, WELL_COPING_DEPTH],
    });
  }

  // The windlass: a drum carried on the two front posts, which is what the bucket and chain are
  // for and what turns a roof on sticks into a well. `roof_log` pivots 3.849 m below its own axis
  // and runs along local Z, so 0.135 gives a 1.44 m drum 0.155 m thick - just long enough to land
  // on both posts - and the dy puts its axis at 1.55 m, a comfortable winding height.
  const drum = 0.135;
  out.push(loose("windlass", "roof_log", 0, r3(1.55 - 3.849 * drum), ring, Math.PI / 2, drum));

  // The two halves overlap 0.03 m past the ridge rather than meeting on it: two coincident faces at
  // z = 0 would z-fight along the whole ridge line.
  out.push(loose("roof_f", "roof_wood_plank", 0, 2.4, -0.03, 0, 0.75));
  out.push(loose("roof_b", "roof_wood_plank", 0, 2.4, 0.03, Math.PI, 0.75));
  // The coping's top is `WELL_CURB_SHOW`, so both stand on the curb rather than in the air.
  out.push(loose("bucket", "bucket_wood", 0.1, WELL_CURB_SHOW, 0.62, 0.6));
  // On the coping band, not over the corner: at 0.95 and a diagonal offset two thirds of the
  // coil overhung the shaft with nothing under it.
  out.push(loose("chain", "chain_coil", -0.579, WELL_CURB_SHOW, 0, 1.2, 0.38));

  return out;
}

// --------------------------------------------------------------- wall runs

/**
 * A straight run of town wall along LOCAL +X, from dx = 0 to dx = `length` at dz = 0, with gates
 * cut out of it.
 *
 * WHY THIS EXISTS. Measured on the shipped data: Coldbrace has 44 m of wall on a 212 m circuit
 * (79% open, largest single gap 46 m), Highcairn 30 m of 139 m, Rootfall none at all, and all four
 * corners are open in both. The stubs are net-negative - `getNavPath(144,-40 -> 144,-90)` detours
 * to x = 149.5 to walk around two free-standing panels in open moor. There was no way to author a
 * wall, only to author individual `wall_segment` buildings with an 8 m footprint.
 *
 * `openings` are `{ at, width }` in metres along the run, `at` at the CENTRE of the gap, matching
 * `WallOpeningDef` in content/regions.ts. A module is skipped when its 2 m span overlaps an
 * opening, so an opening rounds OUTWARD to whole modules and a gatehouse never has half a wall
 * panel standing in its arch.
 *
 * Every built module gets a `wall_bottom_trim` under it, which is the point of the asset and the
 * reason it was in the manifest unused: without it a 50 m run is 25 panels stuck upright in grass.
 * Gatehouses own the two jambs at every opening. The wall run used to add `kit.corner` posts at
 * those same coordinates, producing a timber sliver through a masonry gate in Coldbrace and
 * Rootfall and two almost-coplanar posts in Highcairn. The run now owns only its outer end posts;
 * the gate's return-wall joint closes each authored cutout exactly once.
 *
 * WHAT BREAKS UP A 52 M RUN. Seeded per-panel decoration produced isolated dark bars and facade
 * swaps with no construction logic. These walls now use fixed regional patterns anchored to the
 * physical two-metre slot: Coldbrace is one continuous plaster/apron wall, Rootfall repeats paired
 * framed bays followed by two plain bays under one continuous rail, and Highcairn is uninterrupted
 * masonry with sparse sixteen-metre buttresses. Open household-window panels remain excluded.
 *
 * AND IT IS CAPPED. `kerb_straight` is 2.000 x 0.134 x 0.700 with its body entirely on the +Z side
 * of its pivot; laid along the wall head it overhangs the 0.406 m panel by 0.147 m on each face,
 * which is a coping course with a shadow line under it. Without one the head is a straight cut and
 * the wall reads as a strip of cardboard on edge, which is what runs/corealm/screenshots/
 * w2-rootfall.png shows along the whole east palisade.
 */
export function buildWallRun(
  length: number,
  openings: readonly { at: number; width: number }[],
  kit: BuildingKit,
  _seed: number,
): PartPlacement[] {
  const out: PartPlacement[] = [];
  const modules = wallRunModules(length, openings);
  // A town wall is one authored construction, not a bag of house panels. The pattern is tied to the
  // original physical slot rather than this filtered array index, so a gate opening cannot restart
  // or shift the facade phase on the far side of the road.

  for (const [index, module] of modules.entries()) {
    const centre = (module.from + module.to) / 2;
    const scale = (module.to - module.from) / MODULE_METRES;
    const physicalSlot = Math.round(module.from / MODULE_METRES);
    const timberPhase = ((physicalSlot % 4) + 4) % 4;
    const wallAsset = kit.id === "stone"
      ? kit.wall
      : kit.id === "timber" && timberPhase !== 0 ? kit.wall : kit.wallFeature;
    // Fortification walls use only solid panels. The kit's window is an unglazed household-sized
    // aperture, not an arrow loop, and a solid collision box behind it makes the opening lie.
    out.push(loose(`w${index}`, wallAsset, centre, 0, 0, 0, scale));
    out.push(loose(`t${index}`, "wall_bottom_trim", centre, 0, 0.01, 0, scale));
    // The coping. Its own y and z are unscaled by the module's length scale in everything but the
    // asset's uniform scale, so a short end module still gets a proportionate cap.
    out.push(loose(`k${index}`, "kerb_straight", centre, STOREY_METRES - 0.134 * scale, -0.11 - 0.35 * scale, 0, scale));
    // Rootfall's frames arrive as deliberate pairs. A frame on every two-metre bay is deterministic
    // but still wallpaper; two framed and two plain bays make an eight-metre construction rhythm.
    if (kit.frame !== null && timberPhase < 2) {
      out.push(loose(`f${index}`, kit.frame, centre, 0, 0.02, 0, scale));
    }
    if (kit.id === "timber") {
      // One continuous rail locks framed and plain bays together. This is every module, never a
      // seeded subset, so the line cannot break into arbitrary dark bars.
      out.push(loose(
        `s${index}`, "wall_bottom_trim", centre, 1.55, 0.02, 0, scale,
      ));
    }
  }

  // A post at both ends of the run AND at both jambs of every opening.
  //
  // This used to be the two endpoints only, on the assumption that "every current opening is
  // occupied by a gatehouse, whose outer return joint supplies the transition post". That is not
  // something `buildWallRun` can know: the building lab builds bare runs, and any authored run
  // whose opening is a plain gap gets two raw sawn panel ends facing each other across the road.
  // `regionBuilder` already de-duplicates `p*` posts by world position, so where a gatehouse does
  // stand in the opening this adds nothing.
  const posts = [0, length, ...mergeSpans(modules).flatMap((span) => (
    [span.from, span.to].filter((edge) => edge > 1e-6 && edge < length - 1e-6)
  ))];
  for (const [postIndex, x] of posts.entries()) {
    out.push(loose(
      `p${postIndex}`, kit.corner, r3(x), 0, 0, Math.PI / 4, storeyPostScale(kit),
    ));
  }

  // Buttresses mark a deliberate cadence rather than every panel joint. The old every-joint stone
  // rhythm repeated a 3,102-triangle brick post every two metres and made Highcairn's wall read as
  // a picket fence.
  //
  // The cadence used to be every fourth joint for timber/plaster and every eighth for stone, and
  // `contiguousJoints` resets at every opening - so a run had to be 10 m of unbroken wall before
  // the first buttress and 18 m for stone. The lab's 18 m run with a 6 m gate is three modules a
  // side, which is two contiguous joints: it emitted no buttress at all and read as two blank
  // slabs. Every third joint (6 m) and every fourth (8 m) still leaves plain wall between them.
  let buttress = 0;
  let contiguousJoints = 0;
  const buttressCadence = kit.id === "stone" ? 4 : 3;
  for (const [index, module] of modules.entries()) {
    const next = modules[index + 1];
    if (next === undefined || Math.abs(next.from - module.to) > 1e-6) {
      contiguousJoints = 0;
      continue;
    }
    contiguousJoints += 1;
    if (contiguousJoints % buttressCadence !== 0) continue;
    out.push(loose(`b${buttress}`, kit.corner, r3(module.to), 0, 0, 0, storeyPostScale(kit)));
    buttress += 1;
  }

  return out;
}

/**
 * Collision for the same run in the same local frame: one thin box per built span, so a 26-module
 * wall with one gate is two boxes rather than 26.
 *
 * The measured 0.406 m panel thickness and -0.110 m centre match `prefabCollision("wall_segment")`
 * exactly. `dx` is the span's CENTRE measured from the run's start, which is the same origin
 * `buildWallRun` uses - unlike the prefab boxes, whose frame is centred on the footprint.
 */
export function wallRunCollision(
  length: number,
  openings: readonly { at: number; width: number }[],
): PrefabBox[] {
  return mergeSpans(wallRunModules(length, openings)).map((span, index) => ({
    tag: `run${index}`,
    dx: r3((span.from + span.to) / 2),
    dz: r3(WALL_FACE - WALL_THICKNESS / 2),
    sizeX: r3(span.to - span.from),
    sizeZ: WALL_THICKNESS,
    height: STOREY_METRES,
  }));
}

interface Span { from: number; to: number }

/**
 * The modules of a run that actually get built: the run divided into `round(length / 2)` equal
 * modules, minus every module whose span overlaps an opening.
 *
 * One function so `buildWallRun` and `wallRunCollision` cannot disagree about where the wall is,
 * which is the gatehouse's drawn-4-collided-2 bug one scale up. The spacing is `length / count`
 * rather than a flat 2 m so a run always starts at exactly 0 and ends at exactly `length`; author
 * runs in whole 2 m multiples and the two are the same number.
 */
function wallRunModules(
  length: number,
  openings: readonly { at: number; width: number }[],
): Span[] {
  const count = Math.max(1, Math.round(length / MODULE_METRES));
  const spacing = length / count;
  const built: Span[] = [];
  for (let index = 0; index < count; index += 1) {
    const from = index * spacing;
    const to = from + spacing;
    const cut = openings.some((opening) => (
      from < opening.at + opening.width / 2 - 1e-6 && to > opening.at - opening.width / 2 + 1e-6
    ));
    if (!cut) built.push({ from, to });
  }
  return built;
}

/** Contiguous modules merged, so each gate costs one box and one pair of jambs rather than n. */
function mergeSpans(modules: readonly Span[]): Span[] {
  const spans: Span[] = [];
  for (const module of modules) {
    const last = spans[spans.length - 1];
    if (last !== undefined && Math.abs(last.to - module.from) < 1e-6) last.to = module.to;
    else spans.push({ from: module.from, to: module.to });
  }
  return spans;
}

// ------------------------------------------------------------- compositions

/**
 * Set dressing around a landmark's own hero mesh. The landmark entity keeps its `view`, so it is
 * still one clickable, inspectable, highlightable thing; these parts give it a silhouette.
 */
export function buildComposition(
  id: CompositionId,
  seed: number,
  // Optional and last for compatibility with tooling. Runtime callers pass the region's settlement
  // kit so portals, waypoints, traversal anchors and town fixtures share one vernacular.
  kitId: KitId = "plaster",
): PartPlacement[] {
  const rng = new Rng(seed);
  const kit = BUILDING_KITS[kitId];
  switch (id) {
    case "essence_altar_ruins": return essenceAltarRuins();
    case "vault_door": return vaultDoor();
    case "milestone": return milestone();
    case "highcairn_crane": return highcairnCrane();
    case "gravelmaw_mouth": return buildGravelmawMouthComposition(seed, kit);
    case "gravelmaw_exit": return buildGravelmawExitComposition(seed, kit);
    case "great_cairn": return greatCairn();
    case "standing_stones": return standingStones(rng);
    case "rootfall_stump": return rootfallStump();
    case "region_gate": return buildRegionGateComposition(seed, kit);
    case "path_waypoint": return buildPathWaypointComposition(seed, kit);
    case "root_tunnel_entrance": return buildRootTunnelComposition(seed, kit);
    case "canopy_walk_entrance": return buildCanopyWalkComposition(seed, kit);
    case "bank_counter": return bankCounter(kit);
    case "forge_yard": return forgeYard(rng);
    case "market_pitch": return marketPitch(rng);
    case "wood_pile": return woodPile();
    case "garden": return garden(rng);
    case "farm_yard": return farmYard(rng, kit);
  }
}

/** Imported altar court with five mineable Essence positions surrounding its semantic altar. */
function essenceAltarRuins(): PartPlacement[] {
  const parts: PartPlacement[] = [
    loose("ruin_site", "altar_ruins_site", 0, 0, 0, 0, 1),
  ];
  const count = 5;
  const radius = 12;
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    parts.push(loose(
      `essence_${index + 1}`,
      "rocks_free_essence_node",
      r3(Math.cos(angle) * radius),
      1.06,
      r3(Math.sin(angle) * radius),
      angle + 0.4,
      0.42,
    ));
  }
  return parts;
}

/**
 * The vault tower's door: two braziers, two company banners, a kerbed approach.
 *
 * Local +Z is the court. The composition origin is 0.207 m beyond the tower's south wall, which is
 * the plane every wall-mounted part here has to land on - `VAULT_WALL_Z`. The banners already used
 * it; the braziers did not, and at `dz 0.4` their mounting plates hung 0.607 m out in the open air
 * in front of the masonry they are bracketed to.
 */
const VAULT_WALL_Z = -0.207;

function vaultDoor(): PartPlacement[] {
  return [
    loose("torch_l", "torch", -1.5, 1.9, VAULT_WALL_Z, 0, 2.6),
    loose("torch_r", "torch", 1.5, 1.9, VAULT_WALL_Z, 0, 2.6),
    // The composition origin is 0.207 m beyond the tower's south wall. Seat each mounting rail on
    // that wall and let the bracket project out into the court instead of laying the cloth flat.
    wallMountedBanner("banner_l", "banner_1", { dx: -2.35, dy: 3.3, dz: -0.19 }, 0, 1.1),
    wallMountedBanner("banner_r", "banner_1", { dx: 2.35, dy: 3.3, dz: -0.19 }, 0, 1.1),
    // ONE threshold step, not two rails out in the court.
    //
    // The kerbs were a pair at +-1.9 m turned the same way, so the left one laid its 0.7 m body
    // into the approach and the right one laid it away: a 3.1 m path whose centre line missed the
    // door by 0.35 m, made of two 13 cm plates that touched nothing and read as paving slabs
    // dropped on the square. `kerb_straight` at 1.6 is a 3.2 x 1.12 m stone doorstep; sunk 0.10 m
    // it stands 0.11 m proud, runs the full width of the vault's masonry, and meets the door frame
    // it belongs to.
    loose("threshold", "kerb_straight", 0, -0.1, 0.3, 0, 1.6),
  ];
}

/**
 * A snapped March Company marker: a masonry stump, its broken top in the grass, and a kerbed verge.
 *
 * WHAT WAS WRONG. The hero mesh is `wall_brick_straight` at 0.7 - a 1.40 x 2.19 x 0.28 m panel - so
 * the marker was a CARD, and from the road you saw it edge on as a 28 cm line of brick. Around it
 * the composition put a `corner_brick` standing upright 0.57 m from anything else (the "broken-off
 * top", drawn as a second, thinner pillar) and two `kerb_straight` plates 5.2 m apart facing the
 * same way, which read as two paving slabs dropped in a field. Nothing touched anything.
 *
 * WHAT IT IS NOW. The hero panel is the front course of a real pier: a second course behind it and
 * a quoin at each end make a 1.40 x 0.70 m section with corners, and a coping course caps it. The
 * broken-off top is masonry rubble at the pier's foot, where a snapped stone would actually land -
 * `PartPlacement` carries yaw only, so a toppled post cannot be laid on its side and pretending
 * otherwise is what produced the second standing pillar. The verge kerb is one continuous 6 m run
 * on the road side, sunk 0.06 m, which is a kerb rather than three unrelated plates.
 */
function milestone(): PartPlacement[] {
  const stump = 0.7;
  const head = STOREY_METRES * stump;
  return [
    // The pier. The hero panel stands at z = 0 facing +Z; this is the course behind it.
    loose("back", "wall_brick_straight", 0, 0, -0.42, 0, stump),
    loose("trim_f", "wall_bottom_trim", 0, 0, 0.1, 0, stump),
    loose("trim_b", "wall_bottom_trim", 0, 0, -0.52, Math.PI, stump),
    loose("quoin_l", "corner_brick", -0.63, 0, -0.21, -Math.PI / 4, head / 3.016),
    loose("quoin_r", "corner_brick", 0.63, 0, -0.21, Math.PI / 4, head / 3.016),
    // `kerb_straight`'s body sits entirely on the +Z side of its pivot, so this lands the coping
    // across the pier's 0.70 m section with a 3 cm shadow line on each face.
    // The section it caps is 0.704 m deep (hero z -0.220..0.064 plus `back` at -0.640). At the
    // stump's own 0.7 scale the 0.700 m kerb body only reached 0.490 m and stopped 0.234 m
    // short of the front face, so the marker was capped at the back and open at the front.
    loose("cap", "kerb_straight", 0, r3(head - 0.02), -0.67, 0, 1.09),
    // The top, snapped off and lying where it fell.
    loose("shard_l", "rubble_brick_2", -1.1, 0, 0.7, 0.6, 3.1),
    loose("shard_r", "rubble_brick_3", -1.65, 0, 0.25, 2.3, 2.5),
    loose("chip", "rubble_brick_1", 0.8, 0, 0.75, 1.4, 2.0),
    loose("stone", "rock_medium_1", -2.5, -0.2, -1.0, 1.2, 0.5),
    // A footing course at the base, and NOT a kerb along the road.
    //
    // Three `kerb_straight` in a row put a 6 m dark ribbon 1.5 m from the marker, on a dirt track
    // that has no kerbs anywhere else in the world: from above it read as a painted stripe with a
    // stone next to it, which is the same isolated-flat-plate look the old two-kerb version had.
    // One course at the marker's own foot grounds it instead, and touches the thing it belongs to.
    loose("footing", "kerb_straight", 0, -0.05, 0.1, 0, 0.9),
  ];
}

/**
 * The Highcairn crane. The landmark's hero is a 9.6 m mast; this hangs a jib off it and leaves the
 * rope on the drum, which is what the blurb says and what the round-1 `support_beam` at 3x could
 * not say (that asset's pivot is 1.2 m under the post, so it floated).
 */
function highcairnCrane(): PartPlacement[] {
  return [
    // roof_log's pivot sits 3.85 m below the beam and the beam runs along local Z.
    loose("jib", "roof_log", 0, 8.4 - 3.85 * 0.85, 3.0, 0, 0.85),
    // Point away from the mast. The old yaws pointed both long beams inward, overlapping almost
    // their entire 3.25 m span and producing a flickering knot at the crane's foot.
    // The mast is the hero `corner_wood` at 3.2, which is x/z +-0.336/+-0.384. A quarter turn
    // maps a brace's post (asset z -0.118) onto -X, so dx +-0.525 lands each post exactly on a
    // mast face; at +-1.3 they stood 0.775 m clear of it and cantilevered 3 m over open grass.
    loose("brace_l", "support_beam", -0.525, -1.211 * 1.6, 0, -Math.PI / 2, 1.6),
    loose("brace_r", "support_beam", 0.525, -1.211 * 1.6, 0, Math.PI / 2, 1.6),
    loose("drum", "chain_coil", 1.4, 0.05, 2.6, 0.4, 2.2),
    loose("rope", "rope_coil", -0.4, 0.05, 5.4, 1.1, 2.4),
    loose("crate", "crate_metal", -2.4, 0, 1.4, 0.7, 1.3),
    loose("barrel", "barrel", 2.5, 0, 0.8, 0, 1.2),
  ];
}

/**
 * The Great Cairn: a clad heap. "Head height and forty paces round", and Karrowmoor's navigation
 * beacon, so it has to read as stacked stone against the sky from 30 m.
 *
 * The hero and every composed part now use the textured `rock_medium_*` family. Three courses make
 * the mass: eight stones on 45-degree centres at radius 3.3-3.6, five bedded into their tops at
 * dy 1.8, and a crown of four. The mixed assets, scales, and yaw keep it from reading as a ring of
 * duplicated props.
 *
 * Grounding, measured at (140, -176) with `__gameDebug.groundHeight`: the ground is level to
 * +-0.15 m at 3 m and falls 0.74 m at 5 m on one bearing only. A uniform dy of -0.55 therefore
 * buries every ring stone by 0.3-1.2 m, which is what a cairn's footings look like, and nothing
 * floats. The old five-part version put `flank_l` 4.75 m out at dy 0 and it floated 0.53 m.
 */
function greatCairn(): PartPlacement[] {
  const out: PartPlacement[] = [];
  // The lower course. Asset, radius, scale and yaw vary per index so the ring is not eight copies
  // of one silhouette; authored rather than seeded, because a landmark has to look the same in
  // every screenshot of it. Each stone tops out 2.4-2.7 m above the origin.
  const ring: readonly (readonly [string, number, number, number])[] = [
    ["rock_medium_1", 3.4, 1.85, 0.4],
    ["rock_medium_3", 3.6, 1.75, 2.1],
    ["rock_medium_2", 3.3, 1.90, 1.2],
    ["rock_medium_1", 3.5, 1.70, 2.9],
    ["rock_medium_3", 3.4, 1.80, 0.8],
    ["rock_medium_2", 3.6, 1.85, 2.4],
    ["rock_medium_1", 3.3, 1.75, 1.7],
    ["rock_medium_3", 3.5, 1.85, 0.2],
  ];
  for (const [index, entry] of ring.entries()) {
    const [assetId, radius, scale, yaw] = entry;
    const angle = (index / ring.length) * Math.PI * 2 + 0.26;
    out.push(loose(
      `ring${index}`, assetId,
      Math.cos(angle) * radius, -0.55, Math.sin(angle) * radius, yaw, scale,
    ));
  }
  // The second course is bedded into the first at 1.8 m and reaches roughly 4.4 m.
  const mid: readonly (readonly [string, number, number])[] = [
    ["rock_medium_2", 1.45, 2.6],
    ["rock_medium_1", 1.40, 0.9],
    ["rock_medium_3", 1.35, 1.9],
    ["rock_medium_2", 1.50, 0.3],
    ["rock_medium_1", 1.30, 2.2],
  ];
  for (const [index, entry] of mid.entries()) {
    const [assetId, scale, yaw] = entry;
    const angle = (index / mid.length) * Math.PI * 2 + 0.9;
    out.push(loose(
      `mid${index}`, assetId,
      Math.cos(angle) * 2.4, 1.8, Math.sin(angle) * 2.4, yaw, scale,
    ));
  }
  // The crown, and one capstone. 5.7 m above the ground at the top, which is what "visible against
  // the sky" from 30 m needs; the blurb's "head height" is content's number and predates the hero
  // mesh, which is 4.26 m on its own before anything is stacked on it.
  out.push(loose("crown_1", "rock_medium_1", 0.4, 3.4, 0.2, 1.4, 1.35));
  out.push(loose("crown_2", "rock_medium_3", -1.2, 3.3, -1.1, 2.7, 1.15));
  out.push(loose("crown_3", "rock_medium_2", 1.2, 3.6, -1.0, 0.5, 1.05));
  out.push(loose("cap", "rock_medium_2", 0.1, 4.4, -0.1, 1.9, 0.8));
  // The two outliers that make it read as a heap somebody built rather than a rock that grew there.
  out.push(loose("flank_l", "rock_medium_2", -5.4, -0.5, 1.4, 1.1, 0.95));
  out.push(loose("skirt", "rock_medium_1", 5.3, -0.5, 2.2, 0.3, 0.85));
  return out;
}

/**
 * Four uprights in a ring around the hero boulder. The edge the stags will not cross.
 *
 * `cliff_tall` was the upright and it is one of the six untextured platformer rocks
 * (`compositions/gravelmawMouth.ts` carries the measurement), so all four read as smooth tan cones.
 * Swapping to the
 * textured `rock_medium_*` fixed the material and lost the silhouette: a single 3.2 m boulder at
 * 1.15-1.45 is 2.6-3.3 m tall and 4 m wide, which is a boulder field and not a stone ring, and it
 * is what the clearing looked like - six lumps in the fern, with a pale untextured cone in the
 * middle of them because the LANDMARK's own hero was still `boulder_medium`.
 *
 * Each station is now TWO rocks, a base and a cap bedded 1.75 m into it, which is the same trick
 * `greatCairn` uses and the only way this library makes anything taller than it is wide. Four of
 * those reach 4.2-4.6 m against a 1.8 m player: uprights, seen over the ferns, in a ring.
 *
 * Each stone carries its own dy because the ground here is NOT level: measured at (206, 168) on the
 * ring radius the four bearings differ by 1.88 m (-0.94, +0.26, +0.23, +0.94), and one shared dy
 * either floats the low stone or buries the high one to its shoulders.
 */
function standingStones(rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const stones: readonly (readonly [string, string, number, number])[] = [
    ["rock_medium_1", "rock_medium_3", -1.49, 1.30],
    ["rock_medium_3", "rock_medium_2", -0.29, 1.18],
    ["rock_medium_1", "rock_medium_2", -0.32, 1.24],
    ["rock_medium_3", "rock_medium_1", 0.39, 1.12],
  ];
  const radius = 5.1;
  for (const [index, entry] of stones.entries()) {
    const [baseAsset, capAsset, dy, scale] = entry;
    const angle = (index / stones.length) * Math.PI * 2 + 0.4;
    const dx = Math.cos(angle) * radius;
    const dz = Math.sin(angle) * radius;
    out.push(loose(`stone${index}`, baseAsset, dx, dy, dz, rng.float(0, Math.PI * 2), scale));
    // The cap is bedded into the base rather than balanced on it, and offset a little so the two
    // silhouettes do not stack into one smooth cone.
    out.push(loose(
      `cap${index}`, capAsset,
      r3(dx + rng.float(-0.28, 0.28)), r3(dy + 1.75 * scale), r3(dz + rng.float(-0.28, 0.28)),
      rng.float(0, Math.PI * 2), r4(scale * 0.78),
    ));
  }
  // One of them came down. `wall_bottom_trim` is MI_WoodTrim, so the fallen stone is a rock too:
  // a low boulder half sunk in the turf where the fifth upright used to stand.
  out.push(loose("fallen", "rock_medium_2", 2.6, -0.9, 3.4, 1.1, 1.35));
  out.push(loose("stump", "rock_medium_1", -3.1, -0.55, -2.8, 2.5, 0.8));
  return out;
}

/** Somebody has cut steps into the north face of it. */
/** Four fitted stone flights reach the native oak stump's 3.527 m cut face. */
function rootfallStump(): PartPlacement[] {
  const stair = ROOTFALL_STUMP.stairScale;
  const yaw = ROOTFALL_STUMP.stairYaw;
  return [
    ...Array.from({length: ROOTFALL_STUMP.stairFlights}, (_, index) => ({...loose(`step_${index + 1}`, "stairs_exterior",
      Math.sin(yaw) * (ROOTFALL_STUMP.stairFrontZ - index * 2 * stair),
      index * stair,
      Math.cos(yaw) * (ROOTFALL_STUMP.stairFrontZ - index * 2 * stair), yaw, stair),scaleAxes:[ROOTFALL_STUMP.stairWidthScale,1,1] as const})),
    // Small brackets sit against the broad native trunk, away from the climbing route.
    loose("shelf_1", "mushroom_bracket", -2.45, 1.25, 0.45, 0.8, 0.68),
    loose("shelf_2", "mushroom_bracket", 2.35, 1.9, -0.65, 2.4, 0.6),
    // Side growth leaves the stone approach clear.
    loose("vine", "vine_1", -2.35, 0.45, 0.7, 1.9, 0.65),
  ];
}

// ------------------------------------------------- settlement compositions

/**
 * The thing that turns a chest on grass into a bank: two covered bays, a counter across the front,
 * two lamps, a banner and a kerb.
 *
 * Measured on the shipped data, this is the whole of finding 4. `chest_wood` draws 1.28 x 0.76 m
 * and the nearest building surface to the Coldbrace bank is 5.0 m of open grass; at Rootfall it is
 * 10.0 m. Local +Z faces the customer, so the composition is authored at the chest's own position
 * with the same rotation the chest has, and the counter lands between the player and the chest.
 * `porch` is the walk-under roof; this is the furniture under it.
 */
function bankCounter(kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const backZ = -1.2;
  for (const [index, sx] of [-1, 1].entries()) {
    coveredBay(out, `b${index}_`, kit, sx * (MODULE_METRES / 2), backZ);
  }
  for (const [index, sx] of [-1, 1].entries()) {
    out.push(loose(
      `post${index}`, kit.corner,
      1.9 * sx, 0, backZ + CANOPY_DEPTH_METRES - 0.12,
      Math.atan2(sx, 1), storeyPostScale(kit),
    ));
  }
  // table_large is 2.848 x 0.813 x 1.097 with its pivot centred, so this sits it across the bay
  // mouth with 1.5 m of standing room behind it and the chest behind that.
  out.push(loose("counter", "table_large", 0, 0, -0.15, 0, 1));
  out.push(bayLamp("lamp_l", kit, -1.5, backZ));
  out.push(bayLamp("lamp_r", kit, 1.5, backZ));
  out.push(wallMountedBanner(
    "banner", "banner_1", { dx: -0.65, dy: 2.38, dz: backZ + WALL_FACE + 0.01 }, 0, 0.75,
  ));
  out.push(loose("kerb_l", "kerb_straight", -1, 0, 1.05, 0));
  out.push(loose("kerb_r", "kerb_straight", 1, 0, 1.05, 0));
  return out;
}

/** The yard in front of a `forge`'s open face: what a smith leaves outside. Local +Z is the mouth. */
function forgeYard(rng: Rng): PartPlacement[] {
  return [
    loose("whetstone", "whetstone", -1.9, 0, 0.9, rng.float(0.3, 0.9)),
    loose("rack", "weapon_rack", 2.0, 0, 0.4, -Math.PI / 2),
    loose("barrel_l", "barrel", -2.3, 0, 2.0, rng.float(0, Math.PI)),
    loose("barrel_r", "barrel", 2.4, 0, 1.9, rng.float(0, Math.PI)),
    loose("dummy", "training_dummy", 0.4, 0, 3.1, rng.float(0.2, 0.7)),
    loose("sack", "sack", -1.4, 0, 2.3, rng.float(0, Math.PI)),
  ];
}

/**
 * Goods around one market pitch. The stall itself is the shop entity's own `view`, so this is only
 * what stands around it; emitting a second `market_stall` here would double-draw the hero mesh.
 */
function marketPitch(rng: Rng): PartPlacement[] {
  return [
    loose("crate_1", "crate_wood", -1.35, 0, -0.5, rng.float(0, Math.PI)),
    // crate_wood is 0.931 tall and its pivot is 0.052 below its base, so 0.88 stacks flush.
    loose("crate_2", "crate_wood", -1.28, 0.88, -0.46, rng.float(0, Math.PI), 0.92),
    loose("barrel", "barrel", 1.3, 0, -0.55, rng.float(0, Math.PI)),
    loose("apples", "barrel_apples", 1.45, 0, 0.55, rng.float(0, Math.PI)),
    loose("sack_l", "sack", -1.5, 0, 0.65, rng.float(0, Math.PI)),
    loose("sack_r", "sack", 0.95, 0, 0.9, rng.float(0, Math.PI)),
    loose("carrots", "farm_crate_carrot", 0.15, 0, 0.95, rng.float(0, Math.PI)),
  ];
}

/**
 * Four logs stacked against a gable.
 *
 * `roof_log` pivots 3.849 m BELOW the log and the log runs along its local Z for 10.696 m, so at
 * 0.26 it is a 2.78 m log 0.30 m thick and dy -1.00 lays it on the ground. Turned a quarter so the
 * stack runs along local X and the pile builds up in Z and Y.
 */
function woodPile(): PartPlacement[] {
  const scale = 0.26;
  const drop = -1.211 + 0.211;
  const thick = 1.149 * scale;
  return [
    loose("log_1", "roof_log", 0, drop, -thick, Math.PI / 2, scale),
    loose("log_2", "roof_log", 0, drop, 0, Math.PI / 2, scale),
    loose("log_3", "roof_log", 0, drop, thick, Math.PI / 2, scale),
    loose("log_4", "roof_log", 0.1, drop + thick * 0.86, thick / 2, Math.PI / 2, scale),
  ];
}

/**
 * A fenced kitchen garden: an L of `fence_wood_single` (2.064 m modules), two farm crates and a
 * clump of flowers. Local origin is the inside corner of the L.
 */
function garden(rng: Rng): PartPlacement[] {
  const out: PartPlacement[] = [];
  const module = 2.064;
  for (let index = 0; index < 3; index += 1) {
    out.push(loose(`fx${index}`, "fence_wood_single", (index - 1) * module, 0, -2.4, 0));
  }
  for (let index = 0; index < 2; index += 1) {
    // A part's rotationY turns its local +X toward (cos, -sin), so PI/2 lays the run along -Z.
    // 1.5 modules, not 2: a panel is 2.064 m about its centre, so the Z run's rail line has to
    // land on the X run's last panel END (x 3.097). At 2 * module it stood at x 4.068 and left
    // 0.971 m of daylight at the inside corner of a fence whose whole job is to be closed.
    out.push(loose(`fz${index}`, "fence_wood_single", 1.5 * module, 0, -2.4 + (index + 0.5) * module, Math.PI / 2));
  }
  out.push(loose("crate_1", "farm_crate_carrot", -1.2, 0, -1.2, rng.float(0, Math.PI)));
  out.push(loose("crate_2", "farm_crate_apple", -0.4, 0, -0.5, rng.float(0, Math.PI)));
  out.push(loose("flowers", "flower_a_group", 1.4, 0, -1.1, rng.float(0, Math.PI * 2), 0.9));
  return out;
}

/**
 * A whole farmstead as ONE placeable composition: a paddock fence, a barn at the back of it, the
 * yard between them, and a smaller gated chicken pen inside the paddock.
 *
 * Marchfield uses this as scenery after farming was retired. Crop beds are deliberately absent:
 * the composition is a house, fences, gates, and yard dressing, with no farm-plot entities or crop
 * lifecycle attached to it.
 *
 * SIZED TO THE GROUND IT STANDS ON, measured at Marchfield (-96, -22) with
 * `__gameDebug.groundHeight`: dead level out to 4 m, +-0.21 m at 8 m, and -0.62..+1.26 m at 12 m.
 * `emitParts` places every part at `origin.y + dy` with no terrain sample of its own, so a 12 m
 * enclosure would float one corner by 0.6 m and bury the opposite one to the top rail. The ring is
 * therefore radius 7.9 m - 24 panels of `fence_wood_single`, whose 2.064 m length is within 0.01 m
 * of the arc it has to cover at that radius - and the barn sits at local z -6.4, on the one bearing
 * that measures +-0.06 m at 12 m. Every part is inside 9.1 m of the origin.
 *
 * Local +Z is the way in: five panels are left out there for a 10 m gate, and three more behind,
 * where the barn closes the ring itself. The chicken pen fits inside the level eight-metre core,
 * so its rails share the same ground plane without floating over the surrounding slope.
 */
function farmYard(rng: Rng, kit: BuildingKit): PartPlacement[] {
  const out: PartPlacement[] = [];
  const panels = 24;
  const radius = 7.9;
  // Left out: the gate on local +Z, and the run the barn stands in.
  // 16 and 20 are omitted too: at 240 deg and 300 deg those panels cross x = +-4.0, which is
  // where the barn's side walls stand, and 0.87 m of each rail ran through the masonry.
  const gate = new Set([5, 6, 7, 16, 17, 18, 19, 20]);
  for (let index = 0; index < panels; index += 1) {
    if (gate.has(index)) continue;
    const angle = (index / panels) * Math.PI * 2;
    // A part's rotationY turns its local +X toward (cos, -sin); the tangent at `angle` is
    // (-sin, cos), and -angle - PI/2 is the rotation that lands one on the other.
    out.push(loose(
      `fence${index}`, "fence_wood_single",
      Math.cos(angle) * radius, -0.1, Math.sin(angle) * radius,
      -angle - Math.PI / 2,
    ));
  }
  // Gate posts at the two ends of the +Z opening. `kit.corner` is 3.0-3.02 m tall, so 0.4 is a
  // 1.2 m post: a head taller than the 0.84 m fence and not a fifth of the barn.
  // Half-steps: panel i is CENTRED on i * 15 deg, so the mouth's edges are at 67.5 and 112.5
  // deg, not 60 and 120. The posts used to stand 1.03 m inside the last rail either side.
  for (const [index, step] of [4.5, 8.5].entries()) {
    const angle = (step / panels) * Math.PI * 2;
    out.push(loose(
      `post${index}`, kit.corner,
      Math.cos(angle) * radius, 0, Math.sin(angle) * radius, -angle, 0.4,
    ));
  }

  // A second, smaller enclosure inside the main paddock. It occupies the east half of the yard,
  // with a four-metre opening toward the house. Two short corner posts make that opening read as a
  // gate without introducing a fake interactive door. The north-east and south-east corners stay
  // just inside the outer ring: hypot(6, 5) = 7.81 m against the ring's 7.9 m radius.
  for (const [edge, z] of [["south", -3], ["north", 5]] as const) {
    for (const [index, x] of [1, 3, 5].entries()) {
      out.push(loose(`fence_hen_${edge}_${index}`, "fence_wood_single", x, -0.1, z, 0));
    }
  }
  for (const [index, z] of [-2, 0, 2, 4].entries()) {
    out.push(loose(`fence_hen_east_${index}`, "fence_wood_single", 6, -0.1, z, Math.PI / 2));
  }
  // The west rail is the pen entrance. Leaving out the two middle panels gives the navmesh and a
  // player enough room to pass through instead of turning the decorative gate into a sealed box.
  for (const [index, z] of [-2, 4].entries()) {
    out.push(loose(`fence_hen_west_${index}`, "fence_wood_single", 0, -0.1, z, Math.PI / 2));
  }
  for (const [index, z] of [-0.8, 2.8].entries()) {
    out.push(loose(`post_hen_gate_${index}`, kit.corner, 0, 0, z, 0, 0.32));
  }

  // The barn, turned to face the yard. (-dx, -dz) with PI added to the yaw is a half turn about the
  // composition origin; the translation then puts its centre at local (0, -6.4). The standalone
  // farmstead recipes include their own workyard, but this composition authors a larger yard below,
  // so retain the shell/elevation packet and discard its ground dressing instead of stacking two
  // wagons, fences and crate piles in the same space.
  const barnDressingAssets = new Set([
    "wagon", "farm_crate_empty", "farm_crate_apple", "farm_crate_carrot", "crate_village",
    "sack", "barrel", "barrel_apples", "fence_wood_single", "fence_wood_extension",
    "workbench", "bucket_wood", "bucket_metal",
  ]);
  for (const placement of buildPrefab("farmstead", [8, 4], rng.int(1, 1_000_000), kit.id)) {
    if (barnDressingAssets.has(placement.assetId)) continue;
    out.push({
      // Spread the placement rather than listing its fields. The hand-written copy this replaces
      // dropped `scaleAxes`, and `gableEnds` is the one thing in the file that emits it, so both
      // of the barn's gables were re-emitted at scale 1: a 6.69 x 4.52 m plaster triangle on a
      // roof sized for 2.4 x 3.4, standing 1.32 m proud of the tiles with 84 of its vertices
      // outside the roof outline entirely. That is the pair of huge grey wedges over Marchfield.
      ...placement,
      tag: `barn_${placement.tag}`,
      dx: r3(-placement.dx),
      dz: r3(-placement.dz - 6.4),
      rotationY: r4(placement.rotationY + Math.PI),
    });
  }

  out.push(loose("scarecrow", "corealm_scarecrow", -3.4, 0, 2.6, rng.float(0, Math.PI * 2), 1.15));
  out.push(loose("trough", "corealm_water_trough", 3.9, 0, -0.8, rng.float(2.9, 3.4), 1.1));
  out.push(loose("yard_crate", "farm_crate_empty", 2.4, 0, -3.4, rng.float(0, Math.PI)));
  out.push(loose("yard_sack", "sack", 1.6, 0, -3.9, rng.float(0, Math.PI)));
  out.push(loose("yard_barrel", "barrel", -2.2, 0, -3.6, rng.float(0, Math.PI)));
  return out;
}

// -------------------------------------------------------------- collision

/**
 * Solid volume of a prefab, in its local frame. One box per solid mass, so a gatehouse is two piers
 * with a walkable gap between them rather than one block across the road.
 *
 * The world layer turns these into world-space boxes on `BuiltWorld.buildings`; the root turns
 * those into physics colliders and navmesh obstacles. Nothing here touches either - this file only
 * knows how big the thing it drew is.
 */
export interface PrefabBox {
  readonly tag: string;
  /** Centre of the box in the prefab's local XZ frame. */
  readonly dx: number;
  readonly dz: number;
  /** Full extents in metres. */
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly height: number;
}

export function prefabCollision(prefab: PrefabId, footprint: readonly [number, number]): PrefabBox[] {
  const width = Math.max(MODULE_METRES, footprint[0]);
  const depth = Math.max(MODULE_METRES, footprint[1]);
  const height = prefabHeight(prefab);

  if (prefab === "townhouse") {
    // The balcony and foundation planting are walk-through dressing. The two-storey body keeps the
    // same horizontal footprint contract as a cottage, so it cannot silently close the street.
    return [{ tag: "body", dx: 0, dz: 0, sizeX: width, sizeZ: depth, height }];
  }
  if (prefab === "gatehouse") {
    // Two piers, GATE_GAP_METRES apart, from the same `gateGeometry` the arch is drawn to. This is
    // finding 1: the piers used to be `(width - 2) / 2` wide whatever the drawn geometry did, so
    // the gate the player saw was 4 m and the gate the navmesh saw was 2 m, of which 0.20 m
    // survived erosion and all three arches were impassable.
    const { pierWidth } = gateGeometry(width);
    const usable = Math.max(3 * MODULE_METRES, MODULE_METRES * Math.round(width / MODULE_METRES));
    // Front and back facade panels project WALL_FACE beyond the authored depth on both sides.
    const renderedDepth = depth + 2 * WALL_FACE;
    return [
      { tag: "pier_l", dx: -(usable - pierWidth) / 2, dz: 0, sizeX: pierWidth, sizeZ: renderedDepth, height },
      { tag: "pier_r", dx: (usable - pierWidth) / 2, dz: 0, sizeX: pierWidth, sizeZ: renderedDepth, height },
    ];
  }
  if (prefab === "wall_segment") {
    // The wall run is only as thick as the panel, not as deep as the authored footprint.
    return [{
      tag: "wall", dx: 0, dz: r3(WALL_FACE - WALL_THICKNESS / 2),
      sizeX: width, sizeZ: WALL_THICKNESS, height,
    }];
  }
  if (prefab === "stall") {
    // The hero mesh stays at native scale for every footprint. Its measured bounds are
    // 1.845 x 2.627 x 0.932 m, with base [-0.922, -0.005, -0.461].
    // This box covers the structural counter; loose recipe goods are dressing.
    return [{ tag: "stall", dx: 0.0005, dz: 0.005, sizeX: 1.845, sizeZ: 0.932, height: 2.622 }];
  }
  if (prefab === "forge") {
    // Three walls and an open mouth. 0.6 m thick, which is the 0.406 m panel plus the corner posts
    // at its ends, and NOTHING across +Z - that is the entire point of the prefab: the player walks
    // in and stands at the anvil instead of interacting with it through a wall from 8.56 m away.
    const t = 0.6;
    const wallCentre = WALL_FACE - WALL_THICKNESS / 2;
    return [
      { tag: "back", dx: 0, dz: r3(-depth / 2 - wallCentre), sizeX: width, sizeZ: t, height },
      { tag: "left", dx: r3(-width / 2 - wallCentre), dz: 0, sizeX: t, sizeZ: depth, height },
      { tag: "right", dx: r3(width / 2 + wallCentre), dz: 0, sizeX: t, sizeZ: depth, height },
    ];
  }
  if (prefab === "ruin") {
    // Match the actual L-shaped shell. The old full-footprint box blocked the open courtyard.
    const wallCentre = WALL_FACE - WALL_THICKNESS / 2;
    return [
      {
        tag: "back", dx: 0, dz: r3(depth / 2 + wallCentre),
        sizeX: width, sizeZ: WALL_THICKNESS, height,
      },
      {
        tag: "return", dx: r3(-width / 2 - wallCentre), dz: r3(depth / 2 - MODULE_METRES / 2),
        sizeX: WALL_THICKNESS, sizeZ: MODULE_METRES, height,
      },
    ];
  }
  if (prefab === "porch") {
    // The roof is walk-under, so only the two posts and the back wall are solid. The diagnosis asks
    // for the posts alone; the back wall is here because `coveredBay` draws a real wall panel in
    // every kit and leaving it out would let the player walk through a wall they can see, which is
    // the class of bug this whole pass exists to remove.
    const bays = bayCount(width, 2, 3);
    const span = bays * MODULE_METRES;
    const front = -depth / 2 + CANOPY_DEPTH_METRES - 0.12;
    return [
      // The panel draws from the face plane out to WALL_FACE and back to WALL_FACE - 0.406, so the
      // box sits on the panel rather than straddling the footprint edge.
      { tag: "back", dx: 0, dz: r3(-depth / 2 + WALL_FACE - WALL_THICKNESS / 2), sizeX: span, sizeZ: WALL_THICKNESS, height },
      { tag: "post_l", dx: -(span / 2 - 0.12), dz: front, sizeX: 0.4, sizeZ: 0.4, height: 3 },
      { tag: "post_r", dx: span / 2 - 0.12, dz: front, sizeX: 0.4, sizeZ: 0.4, height: 3 },
    ];
  }
  if (prefab === "arcade") {
    // Back wall only. The colonnade posts are 0.21 m across and standing between two of them is the
    // whole idea of an arcade, so they are deliberately not colliders.
    const span = bayCount(width, 2, 8) * MODULE_METRES;
    return [{
      tag: "back", dx: 0, dz: r3(-depth / 2 + WALL_FACE - WALL_THICKNESS / 2),
      sizeX: span, sizeZ: WALL_THICKNESS, height,
    }];
  }
  if (prefab === "market_row") {
    // One thin counter per pitch, so the player walks between the stalls rather than around the row.
    const pitches = Math.max(1, Math.round(width / 3));
    const spacing = width / pitches;
    return Array.from({ length: pitches }, (_unused, index) => ({
      tag: `pitch${index}`,
      dx: r3((index + 0.5) * spacing - width / 2),
      dz: r3(-depth / 2 + 0.55),
      sizeX: 1.9,
      sizeZ: 0.7,
      height,
    }));
  }
  if (prefab === "well") {
    // 1.6 x 1.6 around the low 1.4 m curb. Half-diagonal 1.13 m, comfortably inside
    // INTERACT_RANGE 2.4 m, so a well can still be the target of moveTo({ entityId }).
    return [{ tag: "curb", dx: 0, dz: 0, sizeX: 1.6, sizeZ: 1.6, height }];
  }
  return [{ tag: "body", dx: 0, dz: 0, sizeX: width, sizeZ: depth, height }];
}

// -------------------------------------------------------------- validation

/**
 * Every manifest asset id any prefab can emit. `content/regions.ts` checks this against a real
 * manifest so a typo here is a boot-time content error, not a silently invisible building.
 */
export function prefabPartAssetIds(): string[] {
  const ids = new Set<string>();
  // Footprints that exercise every branch: an odd side, an even side, a one-module side, the [8,3]
  // gatehouse that GATE_GAP_METRES is sized for, the [6,5] forge and [6,3] arcade from the
  // replacement layouts, a two-bay [4,3] porch, a three-pitch market row and a minimum well.
  const probes: readonly (readonly [number, number])[] = [
    [6, 4], [6, 6], [12, 6], [5, 4], [4, 4], [8, 1], [3, 2],
    [8, 3], [8, 4], [6, 3], [6, 5], [4, 3], [9, 3], [2, 2], [10, 4], [16, 3],
  ];
  for (const prefab of PREFAB_IDS) {
    for (const footprint of probes) {
      // Several seeds, because window and door choices are seeded.
      // Every kit, or a wall family that only Highcairn uses is never checked against the manifest
      // and ships as a missing mesh in one region. Sequential seeds enumerate every registered
      // recipe because the selector uses unsigned seed modulo the compatible recipe count.
      for (const kit of KIT_IDS) {
        const recipeCount = structureVariantCount(prefab, footprint, BUILDING_KITS[kit]);
        const seeds = new Set([1, 7, 13, 29, 101, 977]);
        for (let seed = 0; seed < recipeCount; seed += 1) seeds.add(seed);
        for (const seed of seeds) {
          for (const placement of buildPrefab(prefab, footprint, seed, kit)) ids.add(placement.assetId);
        }
      }
    }
  }
  // Wall runs are not prefabs but they emit into the same manifest, and their asset choice is
  // seeded, so probe them here too rather than leave a whole town's perimeter unchecked. The
  // lengths cover a run with no opening, a run whose openings cut it into three, and a run short
  // enough that every module is cut.
  const runs: readonly (readonly [number, readonly { at: number; width: number }[]])[] = [
    [52, []],
    [52, [{ at: 26, width: 8 }]],
    [34, [{ at: 8, width: 4 }, { at: 26, width: 6 }]],
    [6, [{ at: 3, width: 8 }]],
  ];
  for (const [length, openings] of runs) {
    for (const seed of [0, 1, 2, 3, 4, 5, 7, 13, 29, 101, 977]) {
      for (const kit of KIT_IDS) {
        for (const placement of buildWallRun(length, openings, BUILDING_KITS[kit], seed)) {
          ids.add(placement.assetId);
        }
      }
    }
  }
  return [...ids].sort();
}

/** Every manifest asset id any landmark or settlement composition can emit. */
export function compositionPartAssetIds(): string[] {
  const ids = new Set<string>();
  for (const id of COMPOSITION_IDS) {
    for (const seed of [1, 7, 13, 29, 101, 977]) {
      // Every kit: `bank_counter` picks its overhang and its posts out of the kit, so probing one
      // would leave `overhang_brick` unchecked and Highcairn's bank would ship as a missing mesh.
      for (const kit of KIT_IDS) {
        for (const placement of buildComposition(id, seed, kit)) ids.add(placement.assetId);
      }
    }
  }
  return [...ids].sort();
}
