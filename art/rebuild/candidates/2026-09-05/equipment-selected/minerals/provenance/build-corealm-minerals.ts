/**
 * Native inventory minerals. Run: npx tsx tools/build-corealm-minerals.ts
 * Writes only test-results/mineral-items. Root promotes the staged catalogue after lab/icon review.
 * Ore is a hand-sized fracture from the accepted host formation, not a scaled mine exposure.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsTransmission, KHRMaterialsVolume, KHRMaterialsIOR, KHRMaterialsIridescence } from "@gltf-transform/extensions";
import { weld } from "@gltf-transform/functions";
import { Color, Matrix4, Vector2, Vector3 } from "three";
import sharp from "sharp";
import type { AssetEntry } from "../game/src/render/assets.js";

type V = Vector3;
type RGB = [number, number, number];
type Plane = { normal: V; distance: number };
type Face = { normal: V; points: V[] };
type Surface = "host" | "mineral" | "rind" | "gem" | "cloud" | "inclusion" | "film";
type Triangle = { points: [V, V, V]; normals: [V, V, V]; colours: [RGB, RGB, RGB]; surface: Surface };
type OreKind = "grithe" | "corven" | "kaldite" | "emberite";
type GemKind = "quartz" | "amber" | "garnet" | "opal";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = "models/corealm/minerals";
const PACK = {
  id: "corealm-original-minerals", name: "Corealm inventory ore fragments and gemstones",
  author: "Corealm", source: "tools/build-corealm-minerals.ts", license: "LicenseRef-Corealm-Original",
};

/** Source hues match the accepted geology; fresh cleavage has less oxide and stronger specularity. */
const ORES = {
  grithe: { colour: 0x9b855f, pale: 0xc0a777, metalness: 0.67, roughness: 0.30 },
  corven: { colour: 0x929c99, pale: 0xb9c1b6, metalness: 0.72, roughness: 0.23 },
  kaldite: { colour: 0x657f8e, pale: 0x9bb0b6, metalness: 0.58, roughness: 0.26 },
  emberite: { colour: 0x9a6550, pale: 0xbf956e, metalness: 0.63, roughness: 0.32 },
} as const;
const GEMS = {
  quartz: { colour: 0xf0f2ec, roughness: 0.17, transmission: 0.83, ior: 1.54, attenuation: 0xe4e9de, distance: 0.35 },
  // Let path-length absorption carry the resin hue. Saturated vertex colour multiplies
  // absorption again in Three's refraction shader and made v5 read as opaque caramel.
  amber: { colour: 0xfff9ed, roughness: 0.065, transmission: 0.96, ior: 1.54, attenuation: 0xffcf78, distance: 0.34 },
  garnet: { colour: 0xe5a1af, roughness: 0.10, transmission: 0.91, ior: 1.79, attenuation: 0x9f1838, distance: 0.17 },
  opal: { colour: 0xfff9ef, roughness: 0.10, transmission: 0.42, ior: 1.45, attenuation: 0xffc48b, distance: 0.38 },
} as const;

const SPECS = [
  { itemId: "grithe_ore", kind: "grithe", seed: 1147,
    description: "A broad broken ironstone flake with a warm granular mineral lode and exposed fracture edges." },
  { itemId: "corven_ore", kind: "corven", seed: 2819,
    description: "An oblique grey stone wedge carrying stepped silver-grey mineral cleavage blades." },
  { itemId: "kaldite_ore", kind: "kaldite", seed: 4337,
    description: "A narrow angular host fragment with short blue-grey lath crystals rooted in its fracture." },
  { itemId: "emberite_ore", kind: "emberite", seed: 6851,
    description: "An uneven weathered nodule with copper-brown mineral grains and a dark oxidised rind." },
  { itemId: "pale_quartz", kind: "quartz", seed: 7297,
    description: "An elongated unequal quartz growth with stepped broken prism faces, three rooted points, a milky growth core and internal healed fractures." },
  { itemId: "vell_amber", kind: "amber", seed: 8273,
    description: "A substantial asymmetrical fossil-resin nugget with a continuous transmitting shell, curved fracture shoulders, a suspended seed inclusion and small separate fines." },
  { itemId: "cairn_garnet", kind: "garnet", seed: 9157,
    description: "Five unequal overlapping garnet crystals with rhombic and trapezohedral growth faces, absorbing transmitted depth and a small irregular stone fracture root." },
  { itemId: "fire_opal", kind: "opal", seed: 10273,
    description: "A thick irregular ironstone matrix enclosing a convex polished fire-opal lens along a continuous shared contour, with absorbing transmission and an iridescent surface response." },
] as const;
type Spec = typeof SPECS[number];

export const MINERAL_ITEM_IDS: readonly string[] = SPECS.map(spec => spec.itemId);
export const MINERAL_ITEM_ASSET_IDS: readonly string[] = SPECS.map(spec => `corealm_item_${spec.itemId}`);
export interface MineralItemEntry extends AssetEntry {
  readonly itemId: string;
  readonly base: NonNullable<AssetEntry["base"]>;
  readonly sha256: string;
  readonly triangles: number;
  readonly construction: string;
  readonly surfaceTriangles: Readonly<Partial<Record<Surface, number>>>;
  readonly acceptance: { readonly labAccepted: false; readonly iconsAccepted: false };
}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const vec = (x: number, y: number, z: number): V => new Vector3(x, y, z);
const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value));
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let word = Math.imul(state ^ state >>> 15, 1 | state);
    word ^= word + Math.imul(word ^ word >>> 7, word | 61);
    return ((word ^ word >>> 14) >>> 0) / 4294967296;
  };
}
function noise(p: V, frequency: number, seed: number): number {
  const x = p.x * frequency, y = p.y * frequency, z = p.z * frequency;
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fade = (t: number): number => t * t * (3 - 2 * t);
  const tx = fade(x - ix), ty = fade(y - iy), tz = fade(z - iz);
  let value = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    let hash = Math.imul(ix + i, 374761393) ^ Math.imul(iy + j, 668265263) ^ Math.imul(iz + k, 2147483647) ^ seed;
    hash = Math.imul(hash ^ hash >>> 13, 1274126177);
    value += (((hash ^ hash >>> 16) >>> 0) / 4294967295)
      * (i ? tx : 1 - tx) * (j ? ty : 1 - ty) * (k ? tz : 1 - tz);
  }
  return value;
}
function rgb(hex: number, brightness = 1): RGB {
  const colour = new Color(hex).multiplyScalar(brightness);
  return [colour.r, colour.g, colour.b];
}
function mix(a: RGB, b: RGB, fraction: number): RGB {
  return a.map((channel, i) => channel + (b[i]! - channel) * fraction) as RGB;
}

/** Half-space intersections retain real, coplanar cleavage faces instead of triangulated spheres. */
function plane(x: number, y: number, z: number, distance: number): Plane {
  const normal = vec(x, y, z), length = normal.length();
  return { normal: normal.divideScalar(length), distance: distance / length };
}
function facesOf(planes: readonly Plane[]): Face[] {
  const vertices: V[] = [];
  for (let a = 0; a < planes.length; a++) for (let b = a + 1; b < planes.length; b++) for (let c = b + 1; c < planes.length; c++) {
    const pa = planes[a]!, pb = planes[b]!, pc = planes[c]!;
    const cross = pb.normal.clone().cross(pc.normal), determinant = pa.normal.dot(cross);
    if (Math.abs(determinant) < 1e-8) continue;
    const point = cross.multiplyScalar(pa.distance)
      .add(pc.normal.clone().cross(pa.normal).multiplyScalar(pb.distance))
      .add(pa.normal.clone().cross(pb.normal).multiplyScalar(pc.distance)).divideScalar(determinant);
    if (planes.some(p => p.normal.dot(point) - p.distance > 1e-6)) continue;
    if (!vertices.some(p => p.distanceToSquared(point) < 1e-12)) vertices.push(point);
  }
  return planes.flatMap(({ normal, distance }) => {
    const points = vertices.filter(p => Math.abs(normal.dot(p) - distance) < 1e-5);
    if (points.length < 3) return [];
    const centre = points.reduce((sum, p) => sum.add(p), vec(0, 0, 0)).divideScalar(points.length);
    const u = points[0]!.clone().sub(centre).normalize(), v = normal.clone().cross(u);
    points.sort((a, b) => Math.atan2(a.clone().sub(centre).dot(v), a.clone().sub(centre).dot(u))
      - Math.atan2(b.clone().sub(centre).dot(v), b.clone().sub(centre).dot(u)));
    return [{ normal, points }];
  });
}
function bevel(planes: readonly Plane[], amount: number): Plane[] {
  const faces = facesOf(planes), cuts: Plane[] = [];
  for (let a = 0; a < faces.length; a++) for (let b = a + 1; b < faces.length; b++) {
    const fa = faces[a]!, fb = faces[b]!;
    const shared = fa.points.filter(p => fb.points.some(q => p.distanceToSquared(q) < 1e-10));
    if (shared.length !== 2) continue;
    const normal = fa.normal.clone().add(fb.normal).normalize();
    cuts.push({ normal, distance: normal.dot(shared[0]!) - amount });
  }
  return [...planes, ...cuts];
}
function cubePlanes(chips = true): Plane[] {
  return [plane(1, 0, 0, 1), plane(-1, 0, 0, 1), plane(0, 1, 0, 1), plane(0, -1, 0, 1),
    plane(0, 0, 1, 1), plane(0, 0, -1, 1), ...(chips ? [plane(1, 1, 1, 2.15), plane(-1, -1, 1, 2.30), plane(1, -1, -1, 2.44)] : [])];
}
function prism(sides: number, tip: number, phase = 0): Plane[] {
  const planes = [plane(0, 0, -1, 0.55)];
  for (let i = 0; i < sides; i++) {
    const angle = phase + i / sides * Math.PI * 2, x = Math.cos(angle), y = Math.sin(angle);
    planes.push(plane(x, y, 0, 1), plane(x * 0.70, y * 0.70, 1, tip));
  }
  return planes;
}
function nodule(seed: number, squash: number): Plane[] {
  const rng = random(seed), planes = [plane(0, -1, 0, 0.72), plane(0, 1, 0, 0.91)];
  for (let ring = 0; ring < 5; ring++) {
    const y = -0.80 + ring * 0.4, radius = Math.sqrt(1 - y * y);
    for (let step = 0; step < 11; step++) {
      const angle = step / 11 * Math.PI * 2 + ring * 0.16;
      planes.push(plane(Math.cos(angle) * radius, y * squash, Math.sin(angle) * radius, 0.88 + rng() * 0.09));
    }
  }
  return planes;
}

/** Clip one shared grid to the fracture outline. Front and rear use identical boundary vertices. */
function fractureGrid(outline: Vector2[], spacing: number, seed: number): Array<[Vector2, Vector2, Vector2]> {
  const lo = new Vector2(Infinity, Infinity), hi = new Vector2(-Infinity, -Infinity);
  outline.forEach(p => { lo.min(p); hi.max(p); });
  const nx = Math.ceil((hi.x - lo.x) / spacing), ny = Math.ceil((hi.y - lo.y) / spacing);
  const dx = (hi.x - lo.x) / nx, dy = (hi.y - lo.y) / ny;
  const grid = Array.from({ length: ny + 1 }, (_, y) => Array.from({ length: nx + 1 }, (_, x) =>
    new Vector2(lo.x + x * dx + (x && x < nx ? Math.sin(x * 13.1 + y * 7.3 + seed) * dx * 0.14 : 0),
      lo.y + y * dy + (y && y < ny ? Math.sin(x * 8.7 - y * 17.2 + seed) * dy * 0.14 : 0))));
  const triangles: Array<[Vector2, Vector2, Vector2]> = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let cell = [grid[y]![x]!, grid[y]![x + 1]!, grid[y + 1]![x + 1]!, grid[y + 1]![x]!];
    for (let edge = 0; edge < outline.length && cell.length; edge++) {
      const a = outline[edge]!, b = outline[(edge + 1) % outline.length]!;
      const side = (p: Vector2): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const clipped: Vector2[] = [];
      for (let i = 0; i < cell.length; i++) {
        const p = cell[i]!, q = cell[(i + 1) % cell.length]!, ps = side(p), qs = side(q);
        if (ps >= -1e-10) clipped.push(p.clone());
        if ((ps >= -1e-10) !== (qs >= -1e-10)) clipped.push(p.clone().lerp(q, ps / (ps - qs)));
      }
      cell = clipped;
    }
    for (let i = 1; i < cell.length - 1; i++) {
      const a = cell[0]!, b = cell[i]!, c = cell[i + 1]!;
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-12) triangles.push([a, b, c]);
    }
  }
  return triangles;
}

const pose = (position: V, scale: V, rotation: V = vec(0, 0, 0)): Matrix4 => new Matrix4().makeTranslation(...position.toArray())
  .multiply(new Matrix4().makeRotationZ(rotation.z)).multiply(new Matrix4().makeRotationY(rotation.y))
  .multiply(new Matrix4().makeRotationX(rotation.x)).multiply(new Matrix4().makeScale(...scale.toArray()));

function garnetPlanes(): Plane[] {
  const result: Plane[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    result.push(plane(a, b, 0, 1), plane(a, 0, b, 1), plane(0, a, b, 1));
  }
  return result;
}

class MineralShape {
  readonly triangles: Triangle[] = [];
  constructor(readonly spec: Spec) {}

  paint(point: V, surface: Surface): RGB {
    const broad = noise(point, 3.2, this.spec.seed), grain = noise(point, 28, this.spec.seed + 3);
    if (surface === "host") return rgb(0x787a70, 0.84 + broad * 0.19 + grain * 0.055);
    if (surface === "rind") return rgb(this.spec.kind === "opal" ? 0x958a71 : this.spec.kind === "amber" ? 0x86572b : 0x564b41,
      0.83 + broad * 0.25 + grain * 0.08);
    if (surface === "mineral") {
      const ore = ORES[this.spec.kind as OreKind];
      return mix(rgb(ore.colour, 0.93 + grain * 0.09), rgb(ore.pale), clamp((broad - 0.30) * 0.90));
    }
    const kind = this.spec.kind as GemKind;
    if (surface === "inclusion") return rgb(kind === "amber" ? 0x583617 : kind === "garnet" ? 0x4c1528 : 0xa7aaa0, 0.82 + broad * 0.25);
    if (surface === "cloud") return rgb(kind === "quartz" ? 0xd3dcd6 : kind === "amber" ? 0xe3a643 : kind === "garnet" ? 0x8c2436 : 0xf0bd79,
      0.90 + broad * 0.10);
    if (surface === "film") return kind === "opal" ? mix(rgb(0x79bca4),rgb(0xe3bf73),clamp((broad-0.29)*2.4))
      : rgb(kind === "quartz" ? 0xf2f5e8 : kind === "amber" ? 0xeaba5a : 0xb04945);
    // Bulk colour comes from path-length absorption. The surface carries only gentle growth zoning.
    return rgb(GEMS[kind].colour, 0.97 + broad * 0.035);
  }

  triangle(points: [V, V, V], surface: Surface): void {
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    if (normal.lengthSq() < 0.9) return;
    this.triangles.push({ points: points.map(p => p.clone()) as [V, V, V], normals: [normal.clone(), normal.clone(), normal.clone()],
      colours: points.map(p => this.paint(p.clone().multiplyScalar(5), surface)) as [RGB, RGB, RGB], surface });
  }

  solid(planes: readonly Plane[], transform: Matrix4, surface: Surface | ((normal: V, point: V) => Surface),
    steps = 5, smoothDegrees = 0): void {
    const faces = facesOf(planes), normalMatrix = transform.clone().invert().transpose();
    const threshold = Math.cos(smoothDegrees * Math.PI / 180);
    const localNormal = (point: V, face: Face): V => smoothDegrees === 0 ? face.normal.clone()
      : faces.filter(other => other.normal.clone().transformDirection(normalMatrix).dot(face.normal.clone().transformDirection(normalMatrix)) >= threshold
        && other.points.some(p => p.distanceToSquared(point) < 1e-10))
        .reduce((sum, other) => sum.add(other.normal), vec(0, 0, 0)).normalize();
    for (const face of faces) {
      const centre = face.points.reduce((sum, point) => sum.add(point), vec(0, 0, 0)).divideScalar(face.points.length);
      const material = typeof surface === "function" ? surface(face.normal, centre) : surface;
      for (let edge = 0; edge < face.points.length; edge++) {
        const corners = [centre, face.points[edge]!, face.points[(edge + 1) % face.points.length]!] as const;
        const normals = [face.normal, localNormal(corners[1], face), localNormal(corners[2], face)] as const;
        const at = (i: number, j: number): { point: V; normal: V; colour: RGB } => {
          const weights = [1 - (i + j) / steps, i / steps, j / steps];
          const local = vec(0, 0, 0), n = vec(0, 0, 0);
          for (let k = 0; k < 3; k++) { local.addScaledVector(corners[k]!, weights[k]!); n.addScaledVector(normals[k]!, weights[k]!); }
          // Author colour in specimen space so adjoining faces share pigment at their edges.
          const point = local.clone().applyMatrix4(transform);
          return { point, normal: n.transformDirection(normalMatrix), colour: this.paint(point.clone().multiplyScalar(5), material) };
        };
        const triangle = (a: ReturnType<typeof at>, b: ReturnType<typeof at>, c: ReturnType<typeof at>): void => {
          // Keep narrow closed bevel facets. Their area is small at hand-item scale, not zero.
          if (b.point.clone().sub(a.point).cross(c.point.clone().sub(a.point)).lengthSq() < 1e-28) return;
          this.triangles.push({ points: [a.point, b.point, c.point], normals: [a.normal, b.normal, c.normal],
            colours: [a.colour, b.colour, c.colour], surface: material });
        };
        for (let i = 0; i < steps; i++) for (let j = 0; j < steps - i; j++) {
          triangle(at(i, j), at(i + 1, j), at(i, j + 1));
          if (i + j < steps - 1) triangle(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
        }
      }
    }
  }

  ore(): void {
    const kind = this.spec.kind as OreKind, rng = random(this.spec.seed);
    const profile = {
      grithe: { scale: vec(0.172, 0.122, 0.103), tilt: 0.13,
        outline: [[-1,-0.42],[-0.70,-0.88],[0.37,-0.81],[0.95,-0.24],[0.77,0.51],[0.06,0.94],[-0.72,0.56]],
        branches: [[[-1.1,-0.34,0.26],[-0.40,-0.08,0.39],[0.13,0.19,0.40],[0.87,0.28,0.22]],
          [[-0.22,0.02,0.28],[-0.39,0.54,0.23],[-0.12,1.02,0.15]]], grows: 5 },
      corven: { scale: vec(0.192, 0.127, 0.087), tilt: -0.15,
        outline: [[-0.95,-0.55],[-0.37,-0.85],[0.62,-0.73],[1,0.14],[0.16,0.84],[-0.70,0.52]],
        branches: [[[-0.95,-0.55,0.30],[-0.36,-0.27,0.45],[0.08,0.19,0.40],[0.28,0.89,0.22]],
          [[-0.21,-0.03,0.32],[0.44,-0.15,0.30],[1.1,0.13,0.15]]], grows: 4 },
      kaldite: { scale: vec(0.131, 0.174, 0.100), tilt: 0.09,
        outline: [[-0.84,-0.59],[-0.35,-0.97],[0.59,-0.62],[0.81,0.17],[0.16,0.93],[-0.62,0.48]],
        branches: [[[-0.31,-1.03,0.19],[-0.16,-0.41,0.35],[0.13,-0.03,0.43],[0.02,0.68,0.29],[0.22,1,0.15]],
          [[-0.12,-0.13,0.32],[-0.69,0.30,0.24],[-1,0.25,0.12]]], grows: 5 },
      emberite: { scale: vec(0.157, 0.141, 0.124), tilt: -0.08,
        outline: [[-0.88,-0.29],[-0.47,-0.94],[0.49,-0.79],[0.98,-0.03],[0.50,0.73],[-0.31,0.90],[-0.92,0.37]],
        branches: [[[-1,-0.10,0.16],[-0.41,-0.23,0.42],[0.16,0.03,0.53],[0.68,0.44,0.27]],
          [[0.04,-0.13,0.32],[0.34,-0.64,0.23],[0.5,-1,0.09]],
          [[-0.23,0.09,0.31],[-0.29,0.57,0.27],[-0.1,1,0.12]]], grows: 6 },
    }[kind];
    const outline = profile.outline.map(([x,y]) => new Vector2(x!, y!));
    const cells = fractureGrid(outline, 0.062, this.spec.seed);
    const frame = pose(vec(0, 0, 0), profile.scale, vec(-0.12, 0.14, profile.tilt));
    const branches = profile.branches.map(branch => branch.map(([x, y, width]) => ({ p: new Vector2(x!, y!), width: width! })));
    const lode = (p: Vector2): number => {
      let nearest = Infinity;
      for (const branch of branches) for (let i = 0; i < branch.length - 1; i++) {
        const a = branch[i]!, b = branch[i + 1]!, delta = b.p.clone().sub(a.p);
        const t = clamp(p.clone().sub(a.p).dot(delta) / delta.lengthSq());
        const centre = a.p.clone().addScaledVector(delta, t), width = a.width + (b.width - a.width) * t;
        nearest = Math.min(nearest, p.distanceTo(centre) / width);
      }
      // The pocket narrows at angular pinch points; it is not a uniform ribbon.
      return nearest + (noise(vec(p.x, p.y, 0), 8, this.spec.seed) - 0.5) * 0.25;
    };
    const grains = Array.from({ length: kind === "corven" ? 17 : 27 }, () => ({
      x: (rng() - 0.5) * 1.8, y: (rng() - 0.5) * 1.6,
      height: 0.12 + rng() * 0.20, nx: (rng() - 0.5) * 0.55, ny: (rng() - 0.5) * 0.65,
    }));
    const fracture = (p: Vector2): number => {
      const mineral = lode(p), face = grains.reduce((best, cell) =>
        (p.x-cell.x)**2 + (p.y-cell.y)**2 < (p.x-best.x)**2 + (p.y-best.y)**2 ? cell : best, grains[0]!);
      const stepped = face.height + face.nx * (p.x-face.x) + face.ny * (p.y-face.y);
      const edge = clamp((mineral - 0.52) / 0.70);
      // A fractured depression with uneven exposed cleavage, bounded by the original host lip.
      const host = 0.62 - 0.13 * p.x + 0.055 * p.y - Math.max(0, Math.abs(p.x) + Math.abs(p.y) - 0.85) * 0.24;
      return stepped * (1-edge) + host * edge + (noise(vec(p.x,p.y,0), 17, this.spec.seed+8)-0.5) * (edge * 0.035);
    };
    const rear = (p: Vector2): number => -0.57 + Math.max(0, Math.abs(p.x)*0.74 + Math.abs(p.y)*0.65 - 0.57) * 0.28
      + 0.045 * p.x - 0.04 * p.y;
    const vertex = (p: Vector2, front: boolean): V => vec(p.x,p.y,front ? fracture(p) : rear(p)).applyMatrix4(frame);
    const edges = new Map<string, { a: Vector2; b: Vector2; count: number }>();
    const key = (p: Vector2): string => `${Math.round(p.x*1e8)},${Math.round(p.y*1e8)}`;
    for (const cell of cells) {
      const centre = cell.reduce((sum,p) => sum.add(p), new Vector2()).divideScalar(3);
      const surface: Surface = lode(centre) < 0.96 ? "mineral" : "host";
      this.triangle(cell.map(p => vertex(p,true)) as [V,V,V], surface);
      this.triangle([vertex(cell[2],false),vertex(cell[1],false),vertex(cell[0],false)], "host");
      for (let i=0;i<3;i++) {
        const a=cell[i]!, b=cell[(i+1)%3]!, id=[key(a),key(b)].sort().join("|");
        const old=edges.get(id); if(old) old.count++; else edges.set(id,{a,b,count:1});
      }
    }
    for (const {a,b,count} of edges.values()) if(count===1) {
      const af=vertex(a,true),bf=vertex(b,true),ar=vertex(a,false),br=vertex(b,false);
      // Mineral crosses broken edges into the section, physically part of the same specimen.
      this.triangle([af,ar,bf],"host"); this.triangle([ar,br,bf],"host");
    }
    // Sparse unequal intergrowth rises out of the cavity. Roots begin below the fracture surface.
    const anchors: Array<[number,number]> = kind === "grithe" ? [[-0.39,-0.02],[-0.12,0.24],[0.17,0.13],[0.42,0.22],[-0.32,0.51]]
      : kind === "corven" ? [[-0.35,-0.28],[-0.03,0.09],[0.31,-0.09],[0.17,0.41]]
      : kind === "kaldite" ? [[-0.14,-0.35],[0.09,-0.03],[-0.21,0.14],[-0.10,0.33],[0.16,0.27]]
      : [[-0.39,-0.20],[-0.13,0.03],[0.21,0.03],[0.07,-0.34],[-0.22,0.37],[0.40,0.24]];
    anchors.slice(0,profile.grows).forEach(([x,y],index) => {
      const p=new Vector2(x,y), z=fracture(p)-0.14;
      let planes: Plane[], scale: V, turn: V;
      if(kind==="kaldite") {
        planes=[...prism(4,1.47,Math.PI/4),plane(0.25,-0.35,1,1.34),plane(-0.8,0.1,-1,0.72)];
        scale=vec(0.13+index*0.008,0.095,0.39-index*0.032);
        turn=vec(-0.46+index*0.18,-0.42+index*0.17,-0.6+index*0.3);
      } else if(kind==="corven") {
        planes=[...cubePlanes(),plane(0.18,0.2,1,0.72),plane(-0.7,0.1,1,0.97)];
        scale=vec(0.25-index*0.017,0.18+index*0.012,0.22);
        turn=vec(0.12+index*0.14,-0.24+index*0.08,0.42+index*0.15);
      } else {
        planes=kind==="grithe" ? [...cubePlanes(),plane(0.15,0.3,1,0.8)] : garnetPlanes();
        scale=vec(0.19+index%2*0.035,0.19-index*0.006,0.24+index%3*0.025);
        turn=vec(index*0.31,-0.20+index*0.11,index*0.68);
      }
      this.solid(bevel(planes,0.017),frame.clone().multiply(pose(vec(x,y,z),scale,turn)),"mineral",2);
    });
  }

  gem(): void {
    const kind = this.spec.kind as GemKind;
    if (kind === "quartz") {
      const main = pose(vec(0.023,0.036,0.006),vec(0.054,0.060,0.155),vec(-1.31,-0.08,-0.14));
      const planes=[...prism(6,1.40,0.14),plane(-0.21,-0.29,1,1.29),plane(0.68,-0.13,0.3,0.83),plane(-0.35,0.1,-1,0.51)];
      this.solid(bevel(planes,0.008),main,(n,p)=>p.z < -0.36 && n.z < -0.2 ? "rind":"gem",3);
      // A broad, irregular milky core stops below the transparent termination and edge faces.
      this.solid([...prism(6,0.99,0.14),plane(0.4,0.2,1,0.91)],main.clone().multiply(pose(vec(-0.05,0,-0.06),vec(0.73,0.74,0.77))),"cloud",3,15);
      for (const [x,y,z,radius,length,turn] of [[-0.054,-0.012,0.012,0.041,0.099,-0.46],[0.071,-0.007,-0.007,0.034,0.082,0.38],[-0.008,-0.039,0.032,0.029,0.059,-0.16]]) {
        const companion=pose(vec(x!,y!,z!),vec(radius!,radius!*0.9,length!),vec(-1.34,0.04,turn!));
        this.solid(bevel(prism(6,1.47,0.1),0.008),companion,(n,p)=>p.z < -0.3 && n.z<0 ? "rind":"gem",2);
        this.solid(prism(6,0.91,0.1),companion.clone().multiply(pose(vec(0,0,-0.04),vec(0.61,0.61,0.76))),"cloud",2);
      }
      // Healed internal fractures are thin closed volumes with angled boundaries, below the outer faces.
      for(let i=0;i<3;i++) this.solid(cubePlanes(),main.clone().multiply(pose(vec(0.04,-0.07,0.17+i*0.24),vec(0.56,0.58,0.012),vec(0.11+i*0.07,-0.19,0.08))),"film",1);
    } else if (kind === "amber") {
      const frame=pose(vec(0,0,0),vec(0.137,0.169,0.132),vec(-0.12,0.26,-0.16));
      this.amberNugget(frame);
      this.solid(bevel([...prism(7,0.90),plane(0.2,0.5,1,0.67)],0.025),frame.clone().multiply(pose(vec(0.03,0.11,0.21),vec(0.095,0.175,0.080),vec(0.64,0.10,-0.53))),"inclusion",2,20);
      // The tapered dark fragment and separate fines are visibly suspended at different depths.
      this.solid(prism(5,1.12),frame.clone().multiply(pose(vec(-0.045,-0.03,0.17),vec(0.027,0.020,0.11),vec(-0.72,0.05,-0.40))),"inclusion",2);
      for(let i=0;i<4;i++) this.solid(nodule(500+i,1.2),frame.clone().multiply(pose(vec(-0.22+i*0.16,-0.38+i*0.10,-0.05+i*0.036),vec(0.016+0.006*(i%2),0.027,0.018))),"inclusion",1,30);
    } else if (kind === "garnet") {
      const habit=(seed:number):Plane[]=> {
        const rng=random(seed), faces=garnetPlanes().map(p=>({...p,distance:p.distance*(0.95+rng()*0.11)}));
        // Natural garnet combines {110} rhombic and {211} trapezohedral growth faces.
        // Large unequal truncations remove the square block silhouette of the previous specimen.
        for(let axis=0;axis<3;axis++) for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]) {
          const n=[x,y,z];n[axis]=n[axis]!*2;faces.push(plane(n[0]!,n[1]!,n[2]!,1.57+rng()*0.14));
        }
        return [...faces,plane(-0.15,-1,0.23,0.76),plane(0.71,0.15,1,0.91)];
      };
      const crystal=(frame:Matrix4,seed:number):void=> {
        const start=this.triangles.length;
        this.solid(bevel(habit(seed),0.006),frame,"gem",2);
        for(const triangle of this.triangles.slice(start)) if(triangle.surface==="gem") {
          const n=triangle.normals[0];
          // Growth zoning follows cleavage faces, separate from their real specular light response.
          const zone=0.91+noise(n.clone().multiplyScalar(2),2.7,seed)*0.12;
          triangle.colours=triangle.colours.map(c=>c.map(channel=>channel*zone) as RGB) as [RGB,RGB,RGB];
        }
      };
      crystal(pose(vec(-0.014,0.033,-0.007),vec(0.112,0.124,0.112),vec(0.34,0.49,-0.29)),9157);
      crystal(pose(vec(0.070,0.002,0.037),vec(0.096,0.103,0.095),vec(-0.19,0.08,0.40)),9173);
      crystal(pose(vec(-0.076,-0.016,0.046),vec(0.086,0.091,0.082),vec(0.43,0.75,-0.34)),9189);
      crystal(pose(vec(-0.008,-0.046,0.077),vec(0.074,0.078,0.067),vec(-0.31,-0.43,0.24)),9203);
      crystal(pose(vec(0.031,-0.037,-0.071),vec(0.071,0.082,0.073),vec(0.23,0.41,0.53)),9217);
      // A small irregular fracture root intersects the crystals, without a straight-sided display base.
      this.solid([...nodule(9361,1.11),plane(-0.6,-0.3,1,0.84),plane(0.6,0.7,0.3,0.91)],
        pose(vec(-0.004,-0.072,-0.009),vec(0.103,0.053,0.085),vec(0.13,-0.19,-0.08)),"host",2,27);

    } else {
      const frame=pose(vec(0,0,0),vec(0.174,0.142,0.148),vec(-0.18,-0.24,0.18));
      this.opalMatrix(frame);

    }
  }

  amberNugget(frame: Matrix4): void {
    const rings=26, segments=44, start=this.triangles.length;
    const point=(ring:number,segment:number):V=> {
      const phi=ring/rings*Math.PI,theta=(segment%segments)/segments*Math.PI*2;
      const s=Math.sin(phi),y=Math.cos(phi);
      const r=1+0.047*Math.sin(theta*3+0.6)*s*s+0.027*Math.sin(theta*5-0.2)*s*s*s;
      let x=s*Math.cos(theta)*r*(0.94+0.055*y)+0.065*s*s*(y+0.4);
      let z=s*Math.sin(theta)*r*(0.95-0.035*y);
      // A conchoidal break bends inward across one shoulder; the rest is a rounded natural nugget.
      const cut=0.71+0.18*(x+0.34)**2+0.13*(y-0.15)**2+0.014*Math.sin(Math.hypot(x+0.45,y-0.55)*14);
      const blend=clamp((0.075-Math.abs(z-cut))/0.075);
      z=Math.min(z,cut)-blend*blend*0.01875;
      x=Math.min(x,0.82-0.13*y+0.09*z);
      const shapedY=Math.max(y*0.98+0.022*s*s,-0.81+0.12*x-0.08*z);
      return vec(x,shapedY,z).applyMatrix4(frame);
    };
    const add=(indices:Array<[number,number]>):void=> {
      // The whole outer shell transmits. A triangle-selected opaque cortex would create a jagged cutout.
      this.triangle(indices.map(([ring,segment])=>point(ring,segment)).reverse() as [V,V,V],"gem");
    };
    for(let ring=0;ring<rings;ring++)for(let segment=0;segment<segments;segment++) {
      if(ring>0)add([[ring,segment],[ring+1,segment],[ring,segment+1]]);
      if(ring<rings-1)add([[ring,segment+1],[ring+1,segment],[ring+1,segment+1]]);
    }
    this.smoothSurface(start,0.72);
  }

  opalMatrix(frame: Matrix4): void {
    const outline=[[-0.95,-0.33],[-0.51,-0.89],[0.43,-0.76],[0.92,-0.14],[0.65,0.67],[-0.12,0.91],[-0.84,0.45]].map(([x,y])=>new Vector2(x!,y!));
    const centre=new Vector2(-0.12,0.12),tau=Math.PI*2;
    // Both materials share this authored contour. Rays are clipped to the host polygon, including
    // its exact corners, so neither the lens edge nor outer rock edge follows selected triangles.
    const angles=[...Array.from({length:256},(_,i)=>i/256*tau),...outline.map(p=>(Math.atan2(p.y-centre.y,p.x-centre.x)+tau)%tau)]
      .sort((a,b)=>a-b).filter((a,i,all)=>i===0||Math.abs(a-all[i-1]!)>1e-8);
    const contour=angles.map(angle=> {
      const direction=new Vector2(Math.cos(angle),Math.sin(angle));
      let reach=Infinity;
      for(let i=0;i<outline.length;i++) {
        const a=outline[i]!,b=outline[(i+1)%outline.length]!,edge=b.clone().sub(a);
        const divisor=edge.x*direction.y-edge.y*direction.x;
        if(divisor>=-1e-8)continue;
        const offset=centre.clone().sub(a),distance=-(edge.x*offset.y-edge.y*offset.x)/divisor;
        reach=Math.min(reach,distance);
      }
      // Unequal lobes and inward host tongues follow the broken exposure, not a cabochon oval.
      // Rounded, unequal bites keep one positive radial contour. Extra samples resolve
      // the deep tongues without turning neighbouring edges into sawteeth.
      const tongue=(direction:number,width:number,depth:number):number=>
        depth*Math.exp((Math.cos(angle-direction)-1)/(width*width));
      const radius=(1+0.15*Math.sin(angle*3+0.4)+0.075*Math.cos(angle*5)+0.045*Math.sin(angle*2-0.8)
        +0.025*Math.sin(angle*7+0.6)+0.018*Math.cos(angle*9-0.3)
        -tongue(0.62,0.24,0.34)-tongue(2.58,0.29,0.43)-tongue(4.52,0.22,0.28))
        /Math.hypot(direction.x/0.59,direction.y/0.63);
      return {inner:centre.clone().addScaledVector(direction,radius),outer:centre.clone().addScaledVector(direction,reach)};
    });
    type Section={p:Vector2;t:number;inside:boolean};
    const rings:Section[][]=[];
    for(let radial=1;radial<=10;radial++)rings.push(contour.map(({inner})=>({p:centre.clone().lerp(inner,radial/10),t:radial/10,inside:true})));
    for(let radial=1;radial<=5;radial++)rings.push(contour.map(({inner,outer})=>({p:inner.clone().lerp(outer,radial/5),t:radial/5,inside:false})));
    const host=(p:Vector2):number=>Math.min(0.46-0.19*p.x+0.11*p.y,0.61+0.29*p.x-0.21*p.y,0.71-0.14*p.x-0.34*p.y);
    const vertex=(section:Section,front:boolean):V=> {
      const p=section.p;
      const angle=Math.atan2(p.y-centre.y,p.x-centre.x);
      const seam=0.28+0.025*Math.sin(angle*3+0.4);
      // The exposed opal stays below the highest matrix ridges. The host rises over its edges.
      const z=front ? section.inside ? 0.28+0.025*Math.sin(angle*3+0.4)*section.t
          +0.205*Math.pow(Math.max(0,1-section.t*section.t),0.85)
        : seam+(host(p)-seam)*Math.sqrt(section.t)
        : -0.71+Math.max(0,Math.abs(p.x)*0.86+Math.abs(p.y)*0.74-0.61)*0.47-0.06*p.x;
      return vec(p.x,p.y,z).applyMatrix4(frame);
    };
    const start=this.triangles.length,count=contour.length,origin:Section={p:centre,t:0,inside:true};
    for(let i=0;i<count;i++) {
      const next=(i+1)%count;
      this.triangle([vertex(origin,true),vertex(rings[0]![i]!,true),vertex(rings[0]![next]!,true)],"gem");
      this.triangle([vertex(origin,false),vertex(rings[0]![next]!,false),vertex(rings[0]![i]!,false)],"host");
      for(let radial=0;radial<rings.length-1;radial++) {
        const a=rings[radial]![i]!,b=rings[radial+1]![i]!,c=rings[radial+1]![next]!,d=rings[radial]![next]!;
        const surface:Surface=radial<9?"gem":"host";
        this.triangle([vertex(a,true),vertex(b,true),vertex(c,true)],surface);
        this.triangle([vertex(a,true),vertex(c,true),vertex(d,true)],surface);
        this.triangle([vertex(a,false),vertex(c,false),vertex(b,false)],"host");
        this.triangle([vertex(a,false),vertex(d,false),vertex(c,false)],"host");
      }
      const a=rings.at(-1)![i]!,b=rings.at(-1)![next]!;
      this.triangle([vertex(a,true),vertex(a,false),vertex(b,true)],"host");
      this.triangle([vertex(a,false),vertex(b,false),vertex(b,true)],"host");
    }
    this.smoothSurface(start,0.69,new Set<Surface>(["gem"]));
  }

  smoothSurface(start: number, threshold: number, surfaces?: Set<Surface>): void {
    const normals=new Map<string,V[]>(),key=(p:V):string=>p.toArray().map(v=>Math.round(v*1e8)).join(",");
    const selected=this.triangles.slice(start).filter(t=>!surfaces||surfaces.has(t.surface));
    for(const triangle of selected)for(const p of triangle.points){const id=`${triangle.surface}:${key(p)}`,values=normals.get(id)??[];values.push(triangle.normals[0]);normals.set(id,values);}
    for(const triangle of selected){const face=triangle.normals[0];triangle.normals=triangle.points.map(p=>normals.get(`${triangle.surface}:${key(p)}`)!
      .filter(n=>n.dot(face)>threshold).reduce((sum,n)=>sum.add(n),vec(0,0,0)).normalize()) as [V,V,V];}
  }

  ground(): { size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } } {
    const min = vec(Infinity, Infinity, Infinity), max = vec(-Infinity, -Infinity, -Infinity);
    for (const triangle of this.triangles) for (const p of triangle.points) { min.min(p); max.max(p); }
    const shift = vec(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    for (const triangle of this.triangles) for (const p of triangle.points) p.add(shift);
    const size = max.sub(min);
    return { size: { x: size.x, y: size.y, z: size.z }, base: { x: -size.x / 2, y: 0, z: -size.z / 2 } };
  }
}

/** Restrained growth striations and micro-roughness. Geometry carries the broad cleavage planes. */
async function fractureMaps(kind: GemKind | OreKind): Promise<{ normal: Uint8Array; roughness: Uint8Array }> {
  const size = 128, normal = Buffer.alloc(size * size * 3), roughness = Buffer.alloc(size * size * 3);
  const height = (x: number, y: number): number => {
    const u = (x + size) % size / size * Math.PI * 2, v = (y + size) % size / size * Math.PI * 2;
    return Math.sin(u * 19 + Math.sin(v * 3) * 0.8) * (kind === "quartz" || kind === "kaldite" ? 0.25 : kind === "corven" ? 0.18 : 0.08)
      + Math.sin(u * 31 + v * 27) * 0.035 + Math.cos(u * 13 - v * 21) * 0.045;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 3;
    const n = vec((height(x - 1, y) - height(x + 1, y)) * 0.20,
      (height(x, y - 1) - height(x, y + 1)) * 0.20, 1).normalize();
    normal[offset] = Math.round((n.x * 0.5 + 0.5) * 255);
    normal[offset + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
    normal[offset + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
    roughness[offset] = 255;
    roughness[offset + 1] = Math.round((0.88 + height(x, y) * 0.14) * 255);
    roughness[offset + 2] = kind in ORES ? 255 : 0;
  }
  const png = (bytes: Buffer): Promise<Buffer> => sharp(bytes, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  const [n, r] = await Promise.all([png(normal), png(roughness)]);
  return { normal: n, roughness: r };
}

type OpalCell = { x: number; y: number; colour: number; thickness: number; active: boolean };

/** Both maps evaluate the same unwarped, angular Voronoi mosaic. */
function opalFlashLayout(): (u: number, v: number) => { colour: number; thickness: number; flash: number; body: number } {
  const rng = random(10273);
  const palette = [0xd97836, 0xe79a50, 0xc46030, 0xf1d5b2, 0xb56837, 0xdf8a42, 0xeab77c, 0xce713c, 0xa3abb0];
  const cells = (count: number, coverage: number): OpalCell[] => Array.from({ length: count }, (_, i) => ({
    x: rng(), y: rng(), colour: palette[i % palette.length]!,
    thickness: clamp((rng() - 0.5) * 1.12 + 0.5), active: rng() < coverage,
  }));
  const coarse = cells(56, 0.38), fine = cells(560, 0.10);
  const nearest = (layer: OpalCell[], u: number, v: number): { cell: OpalCell; edge: number } => {
    let first = Infinity, second = Infinity, cell = layer[0]!;
    for (const candidate of layer) {
      const distance = (u - candidate.x) ** 2 + ((v - candidate.y) * 1.3) ** 2;
      if (distance < first) { second = first; first = distance; cell = candidate; }
      else if (distance < second) second = distance;
    }
    return { cell, edge: Math.sqrt(second) - Math.sqrt(first) };
  };
  return (u, v) => {
    const large = nearest(coarse, u, v), small = nearest(fine, u, v);
    // Sparse pinfire interrupts the larger optical domains.
    const domain = small.cell.active ? small : large;
    // Film boundaries stay narrow; the absorbing body has softer, darker seams.
    const flash = domain.cell.active ? clamp((domain.edge - 0.0012) / 0.0012) : 0;
    const variation = 0.004 * Math.sin(u * 113 + v * 71);
    const interior = clamp(domain.edge / 0.018);
    return { colour: domain.cell.colour, thickness: clamp(domain.cell.thickness + variation), flash,
      body: interior * interior * (3 - 2 * interior) };
  };
}

/** Green stores cell-constant film thickness; red masks iridescence to those flashes. */
async function opalThicknessMap(): Promise<Uint8Array> {
  const size = 256, pixels = Buffer.alloc(size * size * 3), sample = opalFlashLayout();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const domain = sample(x / (size - 1), y / (size - 1));
    const offset = (y * size + x) * 3;
    pixels[offset] = Math.round(domain.flash * 255);
    pixels[offset + 1] = Math.round(domain.thickness * 255); pixels[offset + 2] = 255;
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** Warm absorbing body with soft cloudy domains. Spectral colour belongs to the film. */
async function opalColourMap(): Promise<Uint8Array> {
  const size = 256, pixels = Buffer.alloc(size * size * 3), sample = opalFlashLayout();
  const seam = 0x71391d;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), domain = sample(u, v);
    const variation = 0.96 + 0.04 * Math.sin(u * 19 + Math.sin(v * 13));
    for (let c = 0; c < 3; c++) {
      const shift = 16 - c * 8, dark = seam >> shift & 255, body = domain.colour >> shift & 255;
      pixels[(y * size + x) * 3 + c] = Math.round((dark + (body - dark) * domain.body) * variation);
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** Pure deterministic generation. No production data is read or written. */
export async function buildMineralItemAsset(assetId: string): Promise<{ glb: Uint8Array; entry: MineralItemEntry }> {
  const spec = SPECS.find(spec => `corealm_item_${spec.itemId}` === assetId);
  if (!spec) throw new Error(`Unknown inventory mineral: ${assetId}`);
  const shape = new MineralShape(spec), ore = spec.kind in ORES;
  if (ore) shape.ore(); else shape.gem();
  const bounds = shape.ground();
  const document = new Document(), buffer = document.createBuffer(), mesh = document.createMesh(assetId);
  const scene = document.createScene(assetId);
  document.getRoot().setDefaultScene(scene);
  scene.addChild(document.createNode(assetId).setMesh(mesh));
  const counts: Partial<Record<Surface, number>> = {};
  for (const surface of ["host", "mineral", "rind", "gem", "cloud", "inclusion", "film"] as const) {
    const triangles = shape.triangles.filter(triangle => triangle.surface === surface);
    if (triangles.length === 0) continue;
    counts[surface] = triangles.length;
    const name = surface === "host" ? "Corealm weathered strata" : surface === "mineral" ? `Corealm exposed ${spec.kind} mineral`
      : surface === "rind" ? `Corealm ${spec.kind} weathered cortex` : surface === "gem" ? `Corealm ${spec.kind} dielectric`
        : `Corealm ${spec.kind} internal ${surface}`;
    const material = document.createMaterial(name).setBaseColorFactor([1, 1, 1, 1]).setDoubleSided(false)
      .setMetallicFactor(surface === "mineral" ? ORES[spec.kind as OreKind].metalness : 0)
      .setRoughnessFactor(surface === "host" ? 0.94 : surface === "mineral" ? ORES[spec.kind as OreKind].roughness
        : surface === "rind" ? 0.91 : surface === "gem" ? GEMS[spec.kind as GemKind].roughness : surface === "cloud" ? 0.44 : surface === "film" ? 0.19 : 0.73)
      .setEmissiveFactor([0, 0, 0]);
    if (surface === "gem" || surface === "mineral") {
      const maps = await fractureMaps(spec.kind);
      material.setNormalTexture(document.createTexture(`${spec.kind} growth striations`).setImage(maps.normal).setMimeType("image/png"));
      material.setMetallicRoughnessTexture(document.createTexture(`${spec.kind} fracture roughness`).setImage(maps.roughness).setMimeType("image/png"));
    }
    if (surface === "gem") {
      const gem = GEMS[spec.kind as GemKind];
      material.setExtension("KHR_materials_transmission", document.createExtension(KHRMaterialsTransmission).createTransmission().setTransmissionFactor(gem.transmission));
      material.setExtension("KHR_materials_ior", document.createExtension(KHRMaterialsIOR).createIOR().setIOR(gem.ior));
      material.setExtension("KHR_materials_volume", document.createExtension(KHRMaterialsVolume).createVolume()
        .setThicknessFactor(spec.kind === "quartz" ? 0.085 : spec.kind === "garnet" ? 0.14 : spec.kind === "amber" ? 0.17 : 0.12)
        .setAttenuationDistance(gem.distance).setAttenuationColor(rgb(gem.attenuation)));
    }
    if (surface === "gem" && spec.kind === "opal") {
      material.setBaseColorTexture(document.createTexture("opal warm cloudy body")
        .setImage(await opalColourMap()).setMimeType("image/png"));
      material.getBaseColorTextureInfo()!.setTexCoord(1);
      const thickness = document.createTexture("opal optical thickness domains").setImage(await opalThicknessMap()).setMimeType("image/png");
      const iridescence = document.createExtension(KHRMaterialsIridescence).createIridescence()
        .setIridescenceFactor(0.75).setIridescenceIOR(1.8).setIridescenceThicknessMinimum(180).setIridescenceThicknessMaximum(1100)
        .setIridescenceTexture(thickness)
        .setIridescenceThicknessTexture(thickness);
      iridescence.getIridescenceThicknessTextureInfo()!.setTexCoord(1);
      iridescence.getIridescenceTextureInfo()!.setTexCoord(1);
      material.setExtension("KHR_materials_iridescence", iridescence);
    }
    const positions: number[] = [], normals: number[] = [], colours: number[] = [], uv: number[] = [], opticalUv: number[] = [];
    for (const triangle of triangles) {
      const normal = triangle.points[1].clone().sub(triangle.points[0]).cross(triangle.points[2].clone().sub(triangle.points[0])).normalize();
      for (let corner = 0; corner < 3; corner++) {
        const point = triangle.points[corner]!;
        positions.push(...point.toArray()); normals.push(...triangle.normals[corner]!.toArray()); colours.push(...triangle.colours[corner]!);
        if (spec.kind === "opal" && surface === "gem") opticalUv.push(point.x / bounds.size.x + 0.5, point.y / bounds.size.y);
        // Source stone uses metre-density UVs; small gemstones repeat fine growth detail per 4 cm.
        const scale = surface === "gem" || surface === "mineral" ? 25 : 1;
        if (Math.abs(normal.y) > 0.7) uv.push(point.x * scale, point.z * scale);
        else if (Math.abs(normal.x) > 0.7) uv.push(point.z * scale, point.y * scale);
        else uv.push(point.x * scale, point.y * scale);
      }
    }
    const attribute = (name: string, type: "VEC2" | "VEC3", data: number[]) =>
      document.createAccessor(name).setType(type).setArray(new Float32Array(data)).setBuffer(buffer);
    const primitive = document.createPrimitive().setMaterial(material)
      .setAttribute("POSITION", attribute("position", "VEC3", positions))
      .setAttribute("NORMAL", attribute("normal", "VEC3", normals))
      .setAttribute("COLOR_0", attribute("colour", "VEC3", colours))
      .setAttribute("TEXCOORD_0", attribute("uv", "VEC2", uv));
    if (opticalUv.length) primitive.setAttribute("TEXCOORD_1", attribute("optical uv", "VEC2", opticalUv));
    mesh.addPrimitive(primitive);
  }
  await document.transform(weld());
  const glb = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
  return { glb, entry: {
    id: assetId, itemId: spec.itemId, file: `${DIRECTORY}/${assetId}.glb`, pack: PACK.id, category: "rock",
    is: ore ? "inventory ore fragment" : "inventory gemstone", tags: ["corealm", "original", "inventory", ore ? "ore" : "gem", spec.kind],
    bytes: glb.byteLength, ...bounds, animations: [], materials: document.getRoot().listMaterials().map(material => material.getName()),
    sha256: digest(glb), triangles: shape.triangles.length, construction: spec.description, surfaceTriangles: counts,
    acceptance: { labAccepted: false, iconsAccepted: false },
  } };
}

/** The builder has no public-assets mode. Promotion belongs to the root's later acceptance step. */
export function mineralItemOutputPaths(out = "test-results/mineral-items"): { modelsDirectory: string; catalogFile: string } {
  const staging = path.resolve(ROOT, "test-results"), target = path.resolve(ROOT, out);
  const relative = path.relative(staging, target);
  if (!out.trim() || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Inventory mineral output must remain inside test-results");
  }
  return { modelsDirectory: path.join(target, DIRECTORY), catalogFile: path.join(target, "catalog.json") };
}

export async function buildCorealmMinerals(out?: string, itemIds?: readonly string[]): Promise<{ assets: MineralItemEntry[]; catalogFile: string }> {
  const paths = mineralItemOutputPaths(out), assets: MineralItemEntry[] = [];
  if (itemIds && (itemIds.length === 0 || itemIds.some(id => !MINERAL_ITEM_IDS.includes(id)))) {
    throw new Error("--items must contain known inventory mineral item IDs");
  }
  const selected = itemIds ? new Set(itemIds.map(id => `corealm_item_${id}`)) : null;
  const previous = selected ? JSON.parse(await readFile(paths.catalogFile, "utf8")) as { assets: MineralItemEntry[] } : null;
  // A partial revision verifies retained source bytes first, and never rewrites accepted GLBs.
  for (const assetId of MINERAL_ITEM_ASSET_IDS) if (selected && !selected.has(assetId)) {
    const retained = previous?.assets.find(entry => entry.id === assetId);
    if (!retained || digest(await readFile(path.join(paths.modelsDirectory, `${assetId}.glb`))) !== retained.sha256) {
      throw new Error(`Cannot preserve changed or missing staged mineral: ${assetId}`);
    }
  }
  await mkdir(paths.modelsDirectory, { recursive: true });
  for (const assetId of MINERAL_ITEM_ASSET_IDS) {
    if (selected && !selected.has(assetId)) {
      assets.push(previous!.assets.find(entry => entry.id === assetId)!);
      continue;
    }
    const result = await buildMineralItemAsset(assetId);
    await writeFile(path.join(paths.modelsDirectory, `${assetId}.glb`), result.glb);
    assets.push(result.entry);
    console.log(`${assetId}: ${result.entry.triangles} triangles, ${(result.glb.byteLength / 1024).toFixed(1)} KiB`);
  }
  const generatorSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
  await writeFile(paths.catalogFile, `${JSON.stringify({
    // Also at the top level: `promote-finish-assets.ts` prefers the pack already in the manifest
    // and only takes a fresh generator hash from this field, so a catalogue built after the
    // generator moved could not be promoted without it.
    generatorSha256,
    pack: { ...PACK, generatorSha256 }, generator: `npx tsx tools/build-corealm-minerals.ts${itemIds ? ` --items ${itemIds.join(",")}` : ""}`,
    preservedAssetIds: selected ? MINERAL_ITEM_ASSET_IDS.filter(id => !selected.has(id)) : [],
    coordinates: "Metres, Y-up; centered XZ, lowest triangle vertex at Y=0. Mineral-bearing fracture faces point generally +Z.",
    materials: "Ore host uses accepted production stone maps. Fresh mineral cleavage retains geology hues with independent metallic specularity and lower roughness; its distinct material name prevents the stone-seam override. Gem shells are zero-metal dielectrics with embedded growth normal/roughness maps and KHR transmission, IOR and absorbing volume. Accepted quartz retains its internal growth core. Amber contains only small seed and fine inclusions; its shell transmits continuously. Garnet and opal have no opaque inner cores or sheets. Opal carries physical thin-film iridescence on its polished lens. No material emits light.",
    iconMapping: Object.fromEntries(assets.map(asset => [asset.itemId, { assetId: asset.id, colour: null }])),
    acceptance: "Staged source only. Root must inspect actual production lab models, 256px icon masters and 48px results before promotion.", assets,
  }, null, 2)}\n`);
  return { assets, catalogFile: paths.catalogFile };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  let out: string | undefined, items: string[] | undefined;
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--out" && args[i + 1]) out = args[i + 1];
    else if (args[i] === "--items" && args[i + 1]) items = args[i + 1]!.split(",");
    else throw new Error("Usage: build-corealm-minerals.ts [--out test-results/path] [--items itemId,itemId]");
  }
  buildCorealmMinerals(out, items).catch(error => { console.error(error); process.exitCode = 1; });
}
