/**
 * Mechanical geometry lint for every production structure recipe.
 *
 * The feature lab shows what a structure looks like; this says what it is made of. It runs the
 * production `buildPrefab` / `buildComposition` / `buildWallRun` recipes across every shipped
 * footprint, kit and variant seed, turns each `PartPlacement` into a world-space box using the
 * asset manifest's measured `size` and `base`, and reports the defects that can be found without
 * an opinion:
 *
 *   - FLOATING     a connected group of parts that never reaches the ground plane
 *   - SUNKEN       a part almost entirely below ground
 *   - DUPLICATE    two parts drawing the same asset at nearly the same transform (z-fighting)
 *   - THIN_PLANE   a near-zero-thickness plane used where the recipe wants mass
 *   - NEAR_MISS    two parts that line up on two axes and stop just short on the third
 *
 * Contact is decided on the axis-aligned envelope of each part's rotated box, so the test is
 * deliberately generous: it will not claim a gap that a slightly-rotated part actually closes.
 */
import {
  BUILDING_KITS,
  KIT_IDS,
  PREFAB_IDS,
  buildComposition,
  buildPrefab,
  buildWallRun,
  type KitId,
  type PartPlacement,
  type PrefabId,
} from "../../game/src/render/buildings.js";
import { COMPOSITION_IDS, type CompositionId } from "../../game/src/render/compositionIds.js";
import { structureVariantCount } from "../../game/src/render/structures/catalog.js";
import { compositionHero } from "../../game/src/featureLab/structures.js";
import manifest from "../../game/public/assets/manifest.json" with { type: "json" };

interface AssetBox {
  readonly size: readonly [number, number, number];
  readonly base: readonly [number, number, number];
}

interface WorldBox {
  readonly tag: string;
  readonly assetId: string;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface Defect {
  readonly kind: "FLOATING" | "SUNKEN" | "DUPLICATE" | "THIN_PLANE" | "NEAR_MISS" | "MISSING_ASSET";
  readonly tags: readonly string[];
  readonly assetId: string;
  readonly detail: string;
}

/** Contact slack. Two boxes this close count as joined; a part this far up counts as grounded. */
const CONTACT_EPSILON = 0.03;
/** A part is only reported as floating when its group clears the ground by more than this. */
const FLOAT_REPORT_METRES = 0.12;
/** Same asset within this distance and this angle is a stacked duplicate, not a deliberate pair. */
const DUPLICATE_DISTANCE = 0.06;
const DUPLICATE_ANGLE = 0.05;
/** Anything thinner than this on its smallest horizontal axis reads as a card from the side. */
const THIN_PLANE_METRES = 0.12;
/** A joint that misses by more than this on one axis while lining up on the other two. */
const NEAR_MISS_MIN = CONTACT_EPSILON;
const NEAR_MISS_MAX = 0.3;
/**
 * Both parts must share this much face on the other two axes for the miss to read as a joint.
 *
 * A barrel standing 0.1 m off a barn wall is dressing, not a failed joint, so near-miss is scored
 * only between load-bearing kit pieces that share most of a face.
 */
const NEAR_MISS_SHARED_FACE = 0.6;

const ASSETS = new Map<string, AssetBox>();
/** Load-bearing kit pieces. Only these are held to a joint; dressing is allowed to stand clear. */
const STRUCTURAL = new Set<string>(["support_beam"]);
for (const asset of (manifest as {
  assets: readonly {
    id: string;
    category?: string;
    size?: { x: number; y: number; z: number };
    base?: { x: number; y: number; z: number };
  }[];
}).assets) {
  if (!asset.size || !asset.base) continue;
  ASSETS.set(asset.id, {
    size: [asset.size.x, asset.size.y, asset.size.z],
    base: [asset.base.x, asset.base.y, asset.base.z],
  });
  if (asset.category === "building" || asset.category === "dungeon") STRUCTURAL.add(asset.id);
}

/** Footprints the authored world places, plus the lab defaults for the prefabs it does not. */
const LINT_FOOTPRINTS: Readonly<Record<PrefabId, readonly (readonly [number, number])[]>> = {
  cottage: [[6, 4]],
  townhouse: [[6, 4]],
  hall: [[12, 6]],
  tower: [[4, 4], [6, 6]],
  stall: [[3, 2]],
  wall_segment: [[8, 2]],
  gatehouse: [[8, 4]],
  shed: [[4, 4]],
  ruin: [[6, 4]],
  quarry_hut: [[6, 4]],
  forge: [[6, 4], [6, 5]],
  porch: [[4, 2.2], [4, 3], [6, 2.2], [6, 3]],
  arcade: [[6, 3], [8, 3]],
  market_row: [[9, 3]],
  well: [[2, 2]],
  farmstead: [[10, 6]],
};

function worldBox(part: PartPlacement): WorldBox | null {
  const asset = ASSETS.get(part.assetId);
  if (!asset) return null;
  const sx = part.scale * (part.scaleAxes?.[0] ?? 1);
  const sy = part.scale * (part.scaleAxes?.[1] ?? 1);
  const sz = part.scale * (part.scaleAxes?.[2] ?? 1);
  const x0 = asset.base[0] * sx;
  const x1 = x0 + asset.size[0] * sx;
  const z0 = asset.base[2] * sz;
  const z1 = z0 + asset.size[2] * sz;
  const cos = Math.cos(part.rotationY);
  const sin = Math.sin(part.rotationY);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  // Three.js rotates local (x, z) to (x cos + z sin, -x sin + z cos); take the envelope of all four
  // corners so a diagonal post is measured by the box it really occupies.
  for (const corner of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]] as const) {
    const wx = corner[0] * cos + corner[1] * sin;
    const wz = -corner[0] * sin + corner[1] * cos;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    minZ = Math.min(minZ, wz);
    maxZ = Math.max(maxZ, wz);
  }
  const lowY = part.dy + asset.base[1] * sy;
  return {
    tag: part.tag,
    assetId: part.assetId,
    min: [part.dx + minX, lowY, part.dz + minZ],
    max: [part.dx + maxX, lowY + asset.size[1] * sy, part.dz + maxZ],
  };
}

function touches(a: WorldBox, b: WorldBox): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if (a.min[axis]! - CONTACT_EPSILON > b.max[axis]!) return false;
    if (b.min[axis]! - CONTACT_EPSILON > a.max[axis]!) return false;
  }
  return true;
}

/** Groups parts into rigid assemblies by contact, then reports the ones that never reach y = 0. */
function floatingGroups(boxes: readonly WorldBox[]): WorldBox[][] {
  const parent = boxes.map((_box, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    let walk = index;
    while (parent[walk] !== root) {
      const next = parent[walk]!;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (touches(boxes[i]!, boxes[j]!)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, WorldBox[]>();
  for (let i = 0; i < boxes.length; i += 1) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(boxes[i]!);
    else groups.set(root, [boxes[i]!]);
  }
  return [...groups.values()].filter((group) => (
    Math.min(...group.map((box) => box.min[1]!)) > FLOAT_REPORT_METRES
  ));
}

const AXIS_NAMES = ["X", "Y", "Z"] as const;

/**
 * Two parts that share a face on two axes and stop short on the third.
 *
 * This is the "should have joined and did not" signature: a wing that ends 0.2 m from its pier, a
 * lintel resting 0.04 m above the posts under it. Parts that miss on more than one axis are not
 * making a joint at all, so they are left to the floating check.
 */
function nearMiss(a: WorldBox, b: WorldBox, all: readonly WorldBox[]): string | null {
  if (!STRUCTURAL.has(a.assetId) || !STRUCTURAL.has(b.assetId)) return null;
  let missAxis = -1;
  let missBy = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const gap = Math.max(a.min[axis]! - b.max[axis]!, b.min[axis]! - a.max[axis]!);
    if (gap <= NEAR_MISS_MIN) {
      // Overlapping or touching on this axis; it also has to be a real shared face, not a corner.
      const overlap = Math.min(a.max[axis]!, b.max[axis]!) - Math.max(a.min[axis]!, b.min[axis]!);
      if (overlap < NEAR_MISS_SHARED_FACE) return null;
      continue;
    }
    if (gap > NEAR_MISS_MAX || missAxis >= 0) return null;
    missAxis = axis;
    missBy = gap;
  }
  if (missAxis < 0) return null;
  // A shutter standing proud of its wall is not a hole when the window insert fills the space
  // between them. Only report a gap nothing else already occupies.
  const low = Math.min(a.max[missAxis]!, b.max[missAxis]!);
  const high = Math.max(a.min[missAxis]!, b.min[missAxis]!);
  for (const other of all) {
    if (other === a || other === b) continue;
    if (other.min[missAxis]! > low + 0.01 || other.max[missAxis]! < high - 0.01) continue;
    let bridges = true;
    for (let axis = 0; axis < 3 && bridges; axis += 1) {
      if (axis === missAxis) continue;
      const shared = Math.min(a.max[axis]!, b.max[axis]!) - Math.max(a.min[axis]!, b.min[axis]!);
      const covered = Math.min(Math.min(a.max[axis]!, b.max[axis]!), other.max[axis]!)
        - Math.max(Math.max(a.min[axis]!, b.min[axis]!), other.min[axis]!);
      if (covered < Math.min(shared, NEAR_MISS_SHARED_FACE) * 0.5) bridges = false;
    }
    if (bridges) return null;
  }
  return `line up on the other two axes but leave a ${missBy.toFixed(3)} m gap along ${AXIS_NAMES[missAxis]}`;
}

/**
 * True when something thicker sits against this plane on both of its thin faces.
 *
 * A 0.09 m arch card standing alone reads as a cutout; the same card with a metre of masonry
 * behind it and in front of it is the face of a portal, so it is not a defect.
 */
function sandwiched(plane: WorldBox, boxes: readonly WorldBox[]): boolean {
  const axis = (plane.max[0]! - plane.min[0]!) <= (plane.max[2]! - plane.min[2]!) ? 0 : 2;
  const other = axis === 0 ? 2 : 0;
  let behind = false;
  let ahead = false;
  for (const box of boxes) {
    if (box === plane) continue;
    if (box.min[1]! - CONTACT_EPSILON > plane.max[1]! || box.max[1]! + CONTACT_EPSILON < plane.min[1]!) continue;
    const shared = Math.min(box.max[other]!, plane.max[other]!) - Math.max(box.min[other]!, plane.min[other]!);
    if (shared < (plane.max[other]! - plane.min[other]!) * 0.5) continue;
    if (box.max[axis]! >= plane.min[axis]! - CONTACT_EPSILON && box.min[axis]! < plane.min[axis]!) behind = true;
    if (box.min[axis]! <= plane.max[axis]! + CONTACT_EPSILON && box.max[axis]! > plane.max[axis]!) ahead = true;
  }
  return behind && ahead;
}

export function lintParts(parts: readonly PartPlacement[]): Defect[] {
  const defects: Defect[] = [];
  const boxes: WorldBox[] = [];
  const drawn: PartPlacement[] = [];
  for (const part of parts) {
    const box = worldBox(part);
    if (!box) {
      defects.push({
        kind: "MISSING_ASSET",
        tags: [part.tag],
        assetId: part.assetId,
        detail: "no manifest entry, so the renderer draws nothing",
      });
      continue;
    }
    boxes.push(box);
    drawn.push(part);
  }

  // The per-part checks need every box, because whether a plane is a card depends on what is
  // standing against it.
  for (const [index, part] of drawn.entries()) {
    const box = boxes[index]!;
    // Strictly below the ground plane, not merely flush: a 2 cm threshold plank laid on the dirt
    // is a threshold plank, while a paving tile whose top is at -0.013 m costs a draw call and
    // renders nothing at all.
    if (box.max[1]! <= 0) {
      defects.push({
        kind: "SUNKEN",
        tags: [part.tag],
        assetId: part.assetId,
        detail: `top is ${box.max[1]!.toFixed(3)} m, entirely below ground`,
      });
    }
    const asset = ASSETS.get(part.assetId)!;
    const thinX = asset.size[0] * part.scale * (part.scaleAxes?.[0] ?? 1);
    const thinZ = asset.size[2] * part.scale * (part.scaleAxes?.[2] ?? 1);
    const thin = Math.min(thinX, thinZ);
    const tall = box.max[1]! - box.min[1]!;
    // Cloth, vines and railings are meant to be thin. Only masonry and joinery families are held
    // to having depth, because those are the ones a recipe reaches for when it wants mass.
    const wantsMass = /^(wall|roof|stairs|door|floor)_/.test(part.assetId);
    if (wantsMass && thin < THIN_PLANE_METRES && tall > 1.5 && !sandwiched(box, boxes)) {
      defects.push({
        kind: "THIN_PLANE",
        tags: [part.tag],
        assetId: part.assetId,
        detail: `${tall.toFixed(2)} m tall but only ${thin.toFixed(3)} m thick; reads as a card edge-on`,
      });
    }
  }

  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const a = parts[i]!;
      const b = parts[j]!;
      if (a.assetId !== b.assetId || Math.abs(a.scale - b.scale) > 0.02) continue;
      const distance = Math.hypot(a.dx - b.dx, a.dy - b.dy, a.dz - b.dz);
      const angle = Math.abs(Math.atan2(Math.sin(a.rotationY - b.rotationY), Math.cos(a.rotationY - b.rotationY)));
      if (distance <= DUPLICATE_DISTANCE && angle <= DUPLICATE_ANGLE) {
        defects.push({
          kind: "DUPLICATE",
          tags: [a.tag, b.tag],
          assetId: a.assetId,
          detail: `same asset ${distance.toFixed(3)} m apart at the same yaw; the two surfaces z-fight`,
        });
      }
    }
  }

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const miss = nearMiss(boxes[i]!, boxes[j]!, boxes);
      if (miss) {
        defects.push({
          kind: "NEAR_MISS",
          tags: [boxes[i]!.tag, boxes[j]!.tag],
          assetId: `${boxes[i]!.assetId}+${boxes[j]!.assetId}`,
          detail: miss,
        });
      }
    }
  }

  for (const group of floatingGroups(boxes)) {
    const lowest = Math.min(...group.map((box) => box.min[1]!));
    defects.push({
      kind: "FLOATING",
      tags: group.map((box) => box.tag),
      assetId: group.map((box) => box.assetId).join("+"),
      detail: `${group.length} part(s) form an assembly whose lowest point is ${lowest.toFixed(3)} m `
        + "above ground and which touches nothing that reaches the ground",
    });
  }

  return defects;
}

export interface LintCase {
  readonly key: string;
  readonly parts: readonly PartPlacement[];
}

export function structureCases(): LintCase[] {
  const out: LintCase[] = [];
  for (const prefab of PREFAB_IDS) {
    for (const footprint of LINT_FOOTPRINTS[prefab]) {
      for (const kit of KIT_IDS) {
        const seeds = Math.max(1, structureVariantCount(prefab, footprint, BUILDING_KITS[kit]));
        for (let seed = 0; seed < seeds; seed += 1) {
          out.push({
            key: `prefab ${prefab} ${footprint[0]}x${footprint[1]} ${kit} seed${seed}`,
            parts: buildPrefab(prefab, footprint, seed, kit),
          });
        }
      }
    }
  }
  for (const composition of COMPOSITION_IDS) {
    for (const kit of KIT_IDS) {
      // The dressing recipe is only half of a composition: the world and the lab both pair it with
      // a hero mesh at the origin. Linting the parts alone reports every prop that leans on the
      // hero as floating, so the hero goes in as a synthetic part.
      const hero = compositionHero({
        kind: "composition", id: composition, kit, width: 6, depth: 4, seed: 0,
      });
      const heroAsset = hero ? ASSETS.get(hero.assetId) : undefined;
      const heroPart: PartPlacement[] = hero && heroAsset
        ? [{
          tag: "hero",
          assetId: hero.assetId,
          dx: 0,
          dy: -heroAsset.base[1] * hero.scale,
          dz: 0,
          rotationY: 0,
          scale: hero.scale,
        }]
        : [];
      for (const seed of [0, 1, 2, 3, 4, 5]) {
        out.push({
          key: `composition ${composition} ${kit} seed${seed}`,
          parts: [...heroPart, ...buildComposition(composition as CompositionId, seed, kit as KitId)],
        });
      }
    }
  }
  for (const kit of KIT_IDS) {
    for (const width of [6, 10, 18, 30]) {
      for (const gap of [2, 4, 6]) {
        if (gap > width - 4) continue;
        out.push({
          key: `wall-run ${width}m gap${gap} ${kit}`,
          parts: buildWallRun(width, [{ at: width / 2, width: gap }], BUILDING_KITS[kit], 2),
        });
      }
    }
  }
  return out;
}


export interface LintRow {
  readonly key: string;
  readonly defects: readonly Defect[];
}

/** Runs every case and returns only the ones that carry a defect. */
export function lintStructures(filter?: string): LintRow[] {
  const rows: LintRow[] = [];
  for (const entry of structureCases()) {
    if (filter && !entry.key.includes(filter)) continue;
    const defects = lintParts(entry.parts);
    if (defects.length > 0) rows.push({ key: entry.key, defects });
  }
  return rows;
}

export function structureCaseCount(filter?: string): number {
  return structureCases().filter((entry) => !filter || entry.key.includes(filter)).length;
}
