/** Additive armour, in metres in the upright socket frame. No bone rest tilt is baked in. */
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { EquipmentFaces } from "./equipmentDetails.js";

type Tier = 1 | 5 | 10 | 20;
type Role = "metal" | "leather" | "cloth";
type Point = readonly [number, number, number];
type Row = readonly [radius: number, y: number];
const QUARTER = Math.PI / 2;

export const ARMOUR_TIER_PART_IDS = [
  "proc_armour_collar_5", "proc_armour_collar_10", "proc_armour_collar_20",
  "proc_armour_fauld_1", "proc_armour_fauld_5", "proc_armour_fauld_10", "proc_armour_fauld_20",
  "proc_hide_yoke_5", "proc_hide_yoke_10", "proc_hide_yoke_20",
  "proc_hide_skirt_1", "proc_hide_skirt_5", "proc_hide_skirt_10", "proc_hide_skirt_20",
] as const;

/**
 * Author a quadrant and reflect its triangles, including their winding and vertex tones.
 * This guarantees both X and Z reflection symmetry, including small fittings. In particular,
 * front/back means Z reflection, not a Y reflection across the horizontal XZ plane.
 * All transforms are baked into positions; the returned group has an identity transform.
 */
class Parts {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, {
    role: Role; colour: number; positions: number[]; colors: number[];
  }>();

  constructor(name: string) { this.group.name = name; }

  add(name: string, role: Role, geometry: THREE.BufferGeometry, colour = 0xffffff,
    reflectX = true): void {
    let batch = this.batches.get(name);
    if (!batch) {
      batch = { role, colour, positions: [], colors: [] };
      this.batches.set(name, batch);
    }
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const positions = flat.getAttribute("position");
    const colors = flat.getAttribute("color");
    const albedo = new THREE.Color(colour);
    for (const x of reflectX ? [1, -1] : [1]) {
      for (const z of [1, -1]) {
        for (let triangle = 0; triangle < positions.count; triangle += 3) {
          const order = x * z < 0 ? [0, 2, 1] : [0, 1, 2];
          for (const offset of order) {
            const i = triangle + offset;
            const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i);
            batch.positions.push(px * x, py, pz * z);
            const tone = colors ? colors.getX(i)
              : .86 + .11 * Math.cos(Math.abs(px) * 191 + py * 127 + Math.abs(pz) * 137);
            batch.colors.push(albedo.r * tone, albedo.g * tone, albedo.b * tone);
          }
        }
      }
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  }

  finish(): THREE.Group {
    for (const [name, batch] of this.batches) {
      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(batch.colors, 3));
      // Share corners within each vertex-colour region, retaining tone seams.
      // Generate normals after indexing so lofts and small fittings shade smoothly.
      const indexed = mergeVertices(geometry, 1e-6);
      geometry.dispose();
      geometry = indexed;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        name: `armour-tier-${this.group.name}-${name}`, color: 0xffffff, vertexColors: true,
        metalness: batch.role === "metal" ? .78 : 0,
        roughness: batch.role === "metal" ? .38 : .92,
      });
      material.userData.equipmentRole = batch.role;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.userData.equipmentRole = batch.role;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return this.group;
  }
}

function radial(radius: number, y: number, angle: number): Point {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

/** Hollow section loft: top/bottom close only across wall thickness, never across the bore. */
function band(rows: readonly Row[], thickness = .004, start = 0, end = QUARTER,
  scallop = 0, flute = 0, quarterSteps = 24): THREE.BufferGeometry {
  const faces = new EquipmentFaces();
  const steps = Math.max(4, Math.ceil((end - start) / QUARTER * quarterSteps));
  const point = (row: number, step: number, inner: boolean): Point => {
    const angle = start + (end - start) * step / steps;
    const [radius, y] = rows[row]!;
    const lower = row === rows.length - 1 ? scallop * (.5 + .5 * Math.cos(angle * 12)) : 0;
    const crest = row === 0 ? flute * (.5 + .5 * Math.cos(angle * 24)) : 0;
    return radial(radius - (inner ? thickness : 0) + crest * .35, y - lower + crest, angle);
  };
  for (let step = 0; step < steps; step++) {
    for (let row = 0; row < rows.length - 1; row++) {
      const tone = .86 + .10 * Math.cos(step * .9 + row * .7);
      faces.quad(point(row, step, false), point(row, step + 1, false),
        point(row + 1, step + 1, false), point(row + 1, step, false), tone);
      faces.quad(point(row, step, true), point(row + 1, step, true),
        point(row + 1, step + 1, true), point(row, step + 1, true), .70);
    }
    const last = rows.length - 1;
    faces.quad(point(0, step, true), point(0, step + 1, true),
      point(0, step + 1, false), point(0, step, false), .98);
    faces.quad(point(last, step, false), point(last, step + 1, false),
      point(last, step + 1, true), point(last, step, true), .76);
  }
  // Reflection closes quadrant boundaries. Only actual panel gaps need end walls.
  for (const step of [0, steps]) {
    if ((step === 0 && start === 0) || (step === steps && end === QUARTER)) continue;
    for (let row = 0; row < rows.length - 1; row++) {
      const a = point(row, step, false), b = point(row + 1, step, false);
      const c = point(row + 1, step, true), d = point(row, step, true);
      if (step === 0) faces.quad(a, b, c, d, .8);
      else faces.quad(d, c, b, a, .8);
    }
  }
  return faces.geometry();
}

function segment(start: Point, end: Point, radius: number, tipRadius = radius): THREE.BufferGeometry {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const delta = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(tipRadius, radius, delta.length(), 8);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), delta.normalize()));
  return geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
}

function studs(parts: Parts, name: string, radius: number, heights: readonly number[], count = 8): void {
  for (const y of heights) {
    for (let i = 0; i < count; i++) {
      const angle = (i + .5) / count * QUARTER;
      const stud = new THREE.SphereGeometry(.0045, 8, 6);
      stud.scale(1, 1, .55);
      stud.rotateY(QUARTER - angle);
      stud.translate(...radial(radius, y, angle));
      parts.add(name, "metal", stud);
    }
  }
}

function mail(parts: Parts): void {
  parts.add("neck-band", "metal", band([[.092, .189], [.092, .169]], .005));
  studs(parts, "band-rivets", .094, [.18], 6);
  // A thin, dark curtain carries five rows of octagonal ring relief. Each ring has
  // a bright rim and recessed dark centre, with no tube or hidden torus surface.
  parts.add("mail-ring-rows", "metal", band(
    [[.094, .177], [.151, .073]], .002, 0, QUARTER, .008, 0, 16), 0x646464);
  for (let row = 0; row < 5; row++) {
    const radius = .101 + row * .011;
    for (let i = 0; i < 8; i++) {
      const angle = (i + .5) / 8 * QUARTER;
      const y = .165 - row * .019 - Math.max(0, row - 2) * .004 * (.5 + .5 * Math.cos(angle * 12));
      const positions: number[] = [], colors: number[] = [], indices: number[] = [];
      const point = (across: number, up: number, relief: number): Point => {
        const r = radius - up * .011 / .019 + relief;
        return [Math.cos(angle) * r - Math.sin(angle) * across, y + up,
          Math.sin(angle) * r + Math.cos(angle) * across];
      };
      for (const inner of [false, true]) {
        for (let side = 0; side < 8; side++) {
          const theta = side / 8 * Math.PI * 2;
          const size = inner ? .0055 : .010;
          positions.push(...point(Math.cos(theta) * size, Math.sin(theta) * size * 1.12,
            inner ? .001 : .0025));
          const tone = inner ? .24 : .82 + .16 * Math.sin(theta + (row % 2 ? .3 : -.3));
          colors.push(tone, tone, tone);
        }
      }
      positions.push(...point(0, 0, .0008));
      colors.push(.20, .20, .20);
      for (let side = 0; side < 8; side++) {
        const next = (side + 1) % 8;
        // Across runs along the circumference; reverse winding to face outwards.
        indices.push(side, next + 8, next, side, side + 8, next + 8,
          side + 8, 16, next + 8);
      }
      const ring = new THREE.BufferGeometry();
      ring.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      ring.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      ring.setIndex(indices);
      parts.add("mail-ring-rows", "metal", ring);
      // A four-vertex rivet retains the crown glint without a capped cylinder.
      const rivet = new THREE.TetrahedronGeometry(.0022);
      rivet.translate(...point(0, .010, .003));
      parts.add("mail-rivets", "metal", rivet);
    }
  }
}

/** Metal torso additions, centered on spine_03; tier 1 deliberately has no collar. */
export function buildArmourCollar(tier: Tier): THREE.Group {
  const parts = new Parts(`armour-collar-${tier}`);
  if (tier === 1) return parts.finish();
  if (tier === 5 || tier === 10) mail(parts);
  if (tier === 10) {
    for (let i = 0; i < 2; i++) {
      const y = .174 - i * .034, r = .108 + i * .021;
      parts.add(`gorget-lame-${i + 1}`, "metal",
        band([[r, y], [r + .004, y - .005], [r + .020, y - .039]], .005, .48, QUARTER));
    }
  }
  if (tier === 20) {
    for (let i = 0; i < 3; i++) {
      const y = .185 - i * .032, r = .094 + i * .025;
      parts.add(`gorget-lame-${i + 1}`, "metal",
        band([[r, y], [r + .002, y - .005], [r + .029, y - .039]], .005));
    }
    parts.add("standing-fluted-collar", "metal",
      band([[.088, .247], [.084, .225], [.089, .182]], .005, 0, QUARTER, 0, .012));
  }
  return parts.finish();
}

/** Hip plates ride pelvis. The smallest inner radius is .157 m, leaving the bore open. */
export function buildArmourFauld(tier: Tier): THREE.Group {
  const parts = new Parts(`armour-fauld-${tier}`);
  parts.add("leather-belt", "leather", band([[.164, .039], [.167, .002]], .007), 0x64442e);
  if (tier === 1) {
    // A broad buckle at both Z faces, split at X=0 for exact reflection without overlap.
    parts.add("iron-buckle-plate", "metal",
      band([[.173, .035], [.175, .029], [.175, .008], [.173, .002]], .007, 1.32, QUARTER));
  } else {
    const count = tier === 5 ? 2 : tier === 10 ? 3 : 4;
    for (let i = 0; i < count; i++) {
      const r = .173 + i * .010, y = .027 - i * .042;
      parts.add(`fauld-lame-${i + 1}`, "metal", band(
        [[r, y], [r + .002, y - .006], [r + .010, y - .050]], .005,
        0, QUARTER, tier === 10 && i === count - 1 ? .016 : 0));
      studs(parts, "lame-rivets", r + .004, [y - .011], 6);
    }
    if (tier === 20) {
      parts.add("tasset-hangers", "leather",
        band([[.214, -.093], [.218, -.164]], .005, .12, .20), 0x59402d);
      parts.add("hip-tassets", "metal", band(
        [[.218, -.143], [.228, -.154], [.231, -.214], [.219, -.230]], .006, 0, .36));
      parts.add("tasset-center-ridge", "metal", band(
        [[.231, -.155], [.234, -.204], [.224, -.221]], .003, 0, .035));
    }
  }
  return parts.finish();
}

/** Closed diamond strands have a broad root, a bent ridge and a sharp, non-degenerate tip. */
function strand(angle: number, radius: number, y: number, length: number,
  spread: number, width: number): THREE.BufferGeometry {
  const faces = new EquipmentFaces();
  const point = (r: number, h: number, across: number): Point => {
    const [x, , z] = radial(r, h, angle);
    return [x - Math.sin(angle) * across, h, z + Math.cos(angle) * across];
  };
  const root: Point[] = [point(radius, y, -width), point(radius + .005, y + .003, 0),
    point(radius, y, width), point(radius - .003, y - .003, 0)];
  const middle: Point[] = [point(radius + spread * .55, y - length * .48, -width * .65),
    point(radius + spread * .55 + .006, y - length * .44, 0),
    point(radius + spread * .55, y - length * .48, width * .65),
    point(radius + spread * .55 - .002, y - length * .52, 0)];
  const tip = point(radius + spread, y - length, 0);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.quad(root[i]!, root[j]!, middle[j]!, middle[i]!, .72 + i * .07);
    faces.triangle(middle[i]!, middle[j]!, tip, .78 + i * .06);
  }
  faces.quad(root[3]!, root[2]!, root[1]!, root[0]!, .7);
  return faces.geometry();
}

function fur(parts: Parts, name: string, radius: number, y: number, length: number,
  spread: number, count = 18): void {
  for (let i = 0; i < count; i++) {
    const angle = (i + .5) / count * QUARTER;
    const variation = .88 + .12 * Math.cos(i * 2.1);
    parts.add(name, "cloth", strand(angle, radius, y, length * variation, spread,
      radius * QUARTER / count * .62));
  }
}

function mantle(parts: Parts, heavy: boolean): void {
  parts.add("mantle-body", "cloth", band(
    [[.089, .187], [.117, .155], [.167, .091], [heavy ? .192 : .178, heavy ? .014 : .040]],
    .011, 0, QUARTER, 0, 0, heavy ? 12 : 24));
  fur(parts, "neck-fur", .097, .186, .072, .036, 14);
  fur(parts, "shoulder-fur", .133, .141, .087, .047, 18);
  fur(parts, "mantle-fringe", heavy ? .178 : .165, .076,
    heavy ? .128 : .093, .025, 22);
  if (heavy) fur(parts, "outer-fur-layer", .159, .108, .114, .043, 20);
}

function hornToggle(x: number): THREE.BufferGeometry {
  // Alternating narrow grooves are carved into a swollen, tapered horn profile.
  const faces = new EquipmentFaces();
  const point = (row: number, side: number): Point => {
    const t = row / 12, angle = side / 6 * Math.PI * 2;
    const radius = (.003 + .005 * Math.sin(t * Math.PI))
      * (Math.min(row, 12 - row) % 3 === 1 ? .73 : 1);
    return [x - .021 + t * .042, .104 + Math.cos(angle) * radius, .169 + Math.sin(angle) * radius];
  };
  for (let side = 0; side < 6; side++) {
    for (let row = 0; row < 12; row++) {
      faces.quad(point(row, side), point(row, side + 1),
        point(row + 1, side + 1), point(row + 1, side), .80 + .12 * Math.cos(side * 1.7));
    }
    // Explicit tip fans avoid the zero-area pole quads produced by a lathed zero radius.
    faces.triangle([x - .024, .104, .169], point(0, side + 1), point(0, side), .9);
    faces.triangle([x + .024, .104, .169], point(12, side), point(12, side + 1), .9);
  }
  return faces.geometry();
}

/** Hide torso additions, centered on spine_03; every closure is repeated on the back. */
export function buildHideYoke(tier: Tier): THREE.Group {
  const parts = new Parts(`hide-yoke-${tier}`);
  if (tier === 1) return parts.finish();
  if (tier === 5) {
    parts.add("leather-shoulder-yoke", "leather",
      band([[.092, .169], [.127, .138], [.175, .083]], .009), 0x755137);
    studs(parts, "double-stud-rows", .130, [.139], 10);
    studs(parts, "double-stud-rows", .165, [.098], 12);
  } else {
    mantle(parts, tier === 20);
    if (tier === 20) {
      // Horn uses the non-tinted leather role: the allowed role set has no bone/horn role.
      parts.add("horn-toggles", "leather", hornToggle(0), 0xcbb991, false);
      parts.add("horn-toggles", "leather", hornToggle(.057), 0xcbb991);
      for (const x of [0, .057]) {
        const loop = new THREE.TorusGeometry(.010, .0025, 6, 12);
        loop.scale(.65, 1.25, 1);
        loop.translate(x, .103, .171);
        parts.add("toggle-loops", "leather", loop, 0x513522, x !== 0);
      }
    }
  }
  return parts.finish();
}

function panels(parts: Parts, name: string, radius: number, top: number, bottom: number,
  count: number, scallop = .009): void {
  for (let i = 0; i < count; i++) {
    const start = i / count * QUARTER + .016;
    const end = (i + 1) / count * QUARTER - .016;
    parts.add(name, "cloth", band([[radius, top], [radius + .011, top - .035],
      [radius + .027, bottom]], .005, start, end, scallop));
  }
}

function cordBelt(parts: Parts): void {
  // Quarter torus follows the entire waist after reflection.
  const cord = new THREE.TorusGeometry(.170, .0034, 8, 24, QUARTER);
  cord.rotateX(QUARTER);
  cord.translate(0, .022, 0);
  parts.add("knotted-cord", "leather", cord, 0xa28459);
  const knot = new THREE.TorusGeometry(.007, .0028, 6, 12);
  knot.scale(.8, 1, 1);
  knot.translate(.005, .020, .176);
  parts.add("knotted-cord", "leather", knot, 0xa28459);
  parts.add("knotted-cord", "leather", segment([.006, .014, .175], [.020, -.029, .184], .0028), 0xa28459);
}

/** Hide hip additions, centered on pelvis. Panels flare away from the upper thighs. */
export function buildHideSkirt(tier: Tier): THREE.Group {
  const parts = new Parts(`hide-skirt-${tier}`);
  parts.add("waist-belt", "leather", band([[.165, .041], [.171, -.003]], .007), 0x63442d);
  if (tier === 1) {
    parts.add("plain-hide-panel-ring", "cloth", band([[.164, .003], [.183, -.065], [.195, -.147]], .006));
    cordBelt(parts);
  } else {
    panels(parts, "lower-hide-panels", .170, .007, tier === 20 ? -.212 : -.162, 4);
    if (tier === 5) studs(parts, "belt-stud-rows", .172, [.030, .009], 12);
    if (tier === 10) fur(parts, "fur-hem", .195, -.143, .066, .018, 28);
    if (tier === 20) {
      panels(parts, "overlapping-upper-panels", .181, .015, -.112, 3, .014);
      for (let i = 0; i < 3; i++) {
        const angle = (i + .5) / 3 * QUARTER;
        parts.add("hanging-strap-ends", "leather", band(
          [[.185, .023], [.215, -.120], [.216, -.230]], .004, angle - .023, angle + .023), 0x513622);
      }
    }
  }
  return parts.finish();
}

/** Exact allowlist lookup: empty baselines and malformed ids are not registered assets. */
export function buildArmourTierPart(assetId: string): THREE.Group {
  if (!(ARMOUR_TIER_PART_IDS as readonly string[]).includes(assetId)) {
    throw new Error(`Unknown armour tier part: ${assetId}`);
  }
  const tier = Number(assetId.slice(assetId.lastIndexOf("_") + 1)) as Tier;
  if (assetId.startsWith("proc_armour_collar_")) return buildArmourCollar(tier);
  if (assetId.startsWith("proc_armour_fauld_")) return buildArmourFauld(tier);
  if (assetId.startsWith("proc_hide_yoke_")) return buildHideYoke(tier);
  return buildHideSkirt(tier);
}
