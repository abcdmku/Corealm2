/**
 * Original Corealm geology, authored as fractured beds rather than round boulders.
 *
 * Run: npx tsx tools/build-corealm-geology.ts
 * Stage one asset: npx tsx tools/build-corealm-geology.ts --only corealm_sunder_ledge --out test-results/sunder-ledge
 * Writes only this family's GLBs and its separate integration catalogue. The game manifest is
 * deliberately not changed here: the production feature lab must accept these meshes first.
 *
 * Continuous heightfields form unequal geological terraces, broad quarry faces and fractured
 * talus. Ore follows narrow branching fissures with a separate metallic core and worked scar.
 * Active and spent resources share the perimeter and fixed host-face attachment contract.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { weld } from "@gltf-transform/functions";
import { Color, MeshBasicMaterial, ShapeUtils, Vector2, Vector3 } from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import type { AssetEntry } from "../game/src/render/assets.js";

type V = Vector3;
type Colour = [number, number, number];
type Triangle = {
  points: [V, V, V];
  colours: [Colour, Colour, Colour];
  mineral: boolean;
  faceNormal?: V;
  vertexNormals?: [V, V, V];
};
type Spec = {
  id: string;
  seed: number;
  size: [number, number, number];
  kind: "outcrop" | "cliff" | "scree" | "ore";
  variant?: number;
  mineral?: keyof typeof MINERALS;
  spent?: boolean;
  placement?: { replacesAssetId: string; translation: [number, number, number] };
};

export type GeologyAssetEntry = AssetEntry & {
  sha256: string;
  triangles: number;
  blocks: number;
  mineralFaces: number;
  placement?: { replacesAssetId: string; translation: [number, number, number] };
};

export interface GeologyBuildOptions {
  readonly only?: readonly string[];
  readonly out?: string;
  readonly oresOnly?: boolean;
  readonly representative?: boolean;
}

export interface GeologyOutputPaths {
  readonly modelsDirectory: string;
  readonly catalogFile: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = "models/corealm/geology";
const OUTPUT = path.join(ROOT, "game/public/assets", DIRECTORY);
const PACK = {
  id: "corealm-original-geology",
  name: "Corealm fractured strata and mineral workings",
  author: "Corealm",
  source: "tools/build-corealm-geology.ts",
  license: "Original project artwork; no third-party assets",
};
const MINERALS = {
  grithe: { host: 0x74756c, ore: 0x9b855f, pale: 0xc0a777, metalness: 0.30 },
  corven: { host: 0x6e7473, ore: 0x929c99, pale: 0xb9c1b6, metalness: 0.38 },
  kaldite: { host: 0x6d7478, ore: 0x657f8e, pale: 0x9bb0b6, metalness: 0.32 },
  emberite: { host: 0x6c6963, ore: 0x9a6550, pale: 0xbf956e, metalness: 0.25 },
  stone: { host: 0x7b7a70, ore: 0x939388, pale: 0xb3b2a1, metalness: 0.03 },
  kilnstone: { host: 0x625e5a, ore: 0x827665, pale: 0xad9371, metalness: 0.06 },
};

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let z = state;
    z = Math.imul(z ^ z >>> 15, z | 1);
    z ^= z + Math.imul(z ^ z >>> 7, z | 61);
    return ((z ^ z >>> 14) >>> 0) / 4294967296;
  };
}

function colour(hex: number, multiplier = 1): Colour {
  const c = new Color(hex).multiplyScalar(multiplier);
  return [c.r, c.g, c.b];
}

function mix(a: Colour, b: Colour, amount: number): Colour {
  return a.map((v, i) => v + (b[i]! - v) * amount) as Colour;
}

function stoneNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(x - ix), ty = smooth(y - iy), tz = smooth(z - iz);
  const hash = (a: number, b: number, c: number) => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ seed;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 2147483647.5 - 1;
  };
  let value = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    value += hash(ix + dx, iy + dy, iz + dz)
      * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
  }
  return value;
}

/** Nearly isotropic surface cells avoid the long repeated triangles of a subdivided polygon fan. */
function surfaceGrid(outline: Vector2[], spacing: number, seed: number, concave = false): Array<[Vector2, Vector2, Vector2]> {
  const minX = Math.min(...outline.map((p) => p.x)), maxX = Math.max(...outline.map((p) => p.x));
  const minY = Math.min(...outline.map((p) => p.y)), maxY = Math.max(...outline.map((p) => p.y));
  const nx = Math.ceil((maxX - minX) / spacing), ny = Math.ceil((maxY - minY) / spacing);
  const dx = (maxX - minX) / nx, dy = (maxY - minY) / ny;
  const grid = Array.from({ length: ny + 1 }, (_, y) => Array.from({ length: nx + 1 }, (_, x) =>
    new Vector2(minX + x * dx + (x > 0 && x < nx ? Math.sin(x * 13.1 + y * 7.3 + seed) * dx * 0.13 : 0),
      minY + y * dy + (y > 0 && y < ny ? Math.sin(x * 8.7 - y * 17.2 + seed) * dy * 0.13 : 0))));
  const triangles: Array<[Vector2, Vector2, Vector2]> = [];
  const contours = concave ? ShapeUtils.triangulateShape(outline, []).map(indices => indices.map(i => outline[i]!)) : [outline];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    // Concave cutbacks are clipped as disjoint convex pieces on the same global grid.
    // Shared fracture edges therefore get matching vertices instead of long cap triangles.
    for (const contour of contours) {
      let cell = [grid[y]![x]!, grid[y]![x + 1]!, grid[y + 1]![x + 1]!, grid[y + 1]![x]!].map((p) => p.clone());
      for (let edge = 0; edge < contour.length && cell.length; edge++) {
        const a = contour[edge]!, b = contour[(edge + 1) % contour.length]!;
        const side = (p: Vector2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const clipped: Vector2[] = [];
        for (let i = 0; i < cell.length; i++) {
          const p = cell[i]!, q = cell[(i + 1) % cell.length]!, ps = side(p), qs = side(q);
          if (ps >= -1e-9) clipped.push(p.clone());
          if ((ps >= -1e-9) !== (qs >= -1e-9)) clipped.push(p.clone().lerp(q, ps / (ps - qs)));
        }
        cell = clipped;
      }
      for (let i = 1; i < cell.length - 1; i++) {
        const a = cell[0]!, b = cell[i]!, c = cell[i + 1]!;
        if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-10) continue;
        triangles.push([a, b, c]);
      }
    }
  }
  return triangles;
}

class Geology {
  readonly triangles: Triangle[] = [];
  readonly random: () => number;
  readonly host: number;
  blocks = 0;
  mineralFaces = 0;

  constructor(readonly spec: Spec) {
    this.random = rng(spec.seed);
    // The substrate belongs to the same host formation in every biome. Mineral identity lives
    // in the exposed deposit, not a differently coloured miniature boulder around it.
    this.host = 0x787a70;
  }

  stone(p: V, bed: number, bevel: boolean): Colour {
    const broad = Math.sin(p.x * 1.51 + p.z * 0.84) * 0.042
      + Math.sin(p.z * 3.20 - p.y * 2.09) * 0.020;
    const grain = Math.sin(p.x * 23.1 + p.y * 31.8 + p.z * 19.4) * 0.012;
    const bedding = Math.sin(bed * 3.37) * 0.022;
    return colour(this.host, 0.96 + broad + grain + bedding + (bevel ? 0.035 : 0));
  }

  tri(a: V, b: V, c: V, ca: Colour, cb: Colour, cc: Colour, mineral = false, faceNormal?: V): void {
    if (new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).lengthSq() < 1e-12) return;
    this.triangles.push({ points: [a.clone(), b.clone(), c.clone()], colours: [ca, cb, cc], mineral,
      ...(faceNormal && faceNormal.lengthSq() > 0.9 ? { faceNormal: faceNormal.clone() } : {}) });
  }

  buildOreSlab(): void {
    const material = MINERALS[this.spec.mineral!];
    const phase = (this.spec.seed % 37) * 0.07;
    // An irregular wall exposure, not a freestanding crown and toe. The cut-foot authored by
    // the world builder meets local Z=+0.12: every perimeter vertex is behind that plane while
    // the worked interior remains in front. The closed substrate continues to Z=-0.325.
    const outline = [
      [-1.30, 0.15], [-0.74, 0], [0.63, 0.035], [1.30, 0.43],
      [1.16, 1.25], [0.44, 1.60], [-0.39, 1.45], [-1.27, 1.02],
    ].map(([x, y]) => new Vector2(x!, y!));
    type FracturePoint = { point: Vector2; width: number };
    const branch = (coordinates: Array<[number, number, number]>, seed: number): FracturePoint[] => {
      const points = coordinates.map(([x, y, width], index) => ({
        point: new Vector2(x + Math.sin(index * 2.4 + phase + seed) * 0.045,
          y + Math.sin(index * 3.1 + phase * 1.7 + seed) * 0.055),
        width: width * (0.68 + Math.sin(index * 1.7 + phase + seed) * 0.11),
      }));
      return points.flatMap((a, index): FracturePoint[] => {
        const b = points[index + 1];
        if (!b) return [a];
        const tangent = b.point.clone().sub(a.point).normalize();
        const normal = new Vector2(-tangent.y, tangent.x);
        return [a, ...[0.31, 0.68].map((t) => ({
          point: a.point.clone().lerp(b.point, t).addScaledVector(normal,
            Math.sin(index * 5.1 + t * 7.3 + phase + seed) * 0.024),
          width: (a.width + (b.width - a.width) * t) * (0.93 + Math.sin(index * 4.2 + t * 3.9) * 0.10),
        }))];
      });
    };
    const fractures = [
      branch([[-1.42, 0.25, 0.14], [-0.91, 0.47, 0.18], [-0.58, 0.43, 0.14],
        [-0.17, 0.72, 0.22], [0.22, 0.78, 0.16], [0.52, 1.01, 0.18],
        [0.92, 1.17, 0.13], [1.42, 1.10, 0.10]], 0.0),
      branch([[-0.22, 0.69, 0.14], [-0.43, 0.98, 0.12], [-0.25, 1.27, 0.09],
        [-0.60, 1.72, 0.06]], 0.8),
      branch([[0.20, 0.80, 0.13], [0.50, 0.56, 0.13], [0.94, 0.53, 0.09],
        [1.37, 0.23, 0.055]], 1.3),
      branch([[-0.91, 0.47, 0.105], [-1.13, 0.80, 0.085], [-1.45, 0.98, 0.045]], 2.4),
      branch([[-0.51, 0.45, 0.065], [-0.60, 0.24, 0.036], [-0.45, -0.03, 0.018]], 3.2),
      branch([[0.61, 1.06, 0.060], [0.79, 1.35, 0.036], [0.66, 1.65, 0.018]], 4.5),
    ];
    const veinField = (p: Vector2): number => {
      let field = 0;
      for (const fracture of fractures) {
        for (let i = 0; i < fracture.length - 1; i++) {
          const a = fracture[i]!, b = fracture[i + 1]!;
          const segment = b.point.clone().sub(a.point);
          const t = Math.max(0, Math.min(1, p.clone().sub(a.point).dot(segment) / segment.lengthSq()));
          const nearest = a.point.clone().addScaledVector(segment, t);
          const width = a.width + (b.width - a.width) * t;
          const brokenEdge = Math.sin(p.x * 6.1 + p.y * 4.7 + phase) * 0.0025;
          field = Math.max(field, 1 - (p.distanceTo(nearest) + brokenEdge) / width);
        }
      }
      return Math.max(0, Math.min(1, field));
    };
    const exposure = (p: Vector2): number => {
      let fill = 0;
      for (let branchIndex = 0; branchIndex < fractures.length; branchIndex++) {
        const fracture = fractures[branchIndex]!;
        for (let i = 0; i < fracture.length - 1; i++) {
          const a = fracture[i]!, b = fracture[i + 1]!, segment = b.point.clone().sub(a.point);
          const t = Math.max(0, Math.min(1, p.clone().sub(a.point).dot(segment) / segment.lengthSq()));
          const nearest = a.point.clone().addScaledVector(segment, t);
          const fractureWidth = a.width + (b.width - a.width) * t;
          const fillWidth = fractureWidth * (0.18 + Math.sin(i * 1.73 + t * 2.8 + phase) * 0.085);
          const interruption = 0.73 + Math.sin(p.x * 7.3 + p.y * 5.2 + branchIndex) * 0.27;
          fill = Math.max(fill, Math.max(0, 1 - p.distanceTo(nearest) / fillWidth) * interruption);
        }
      }
      return Math.max(0, Math.min(1, fill));
    };
    const edgeDistance = (p: Vector2): number => Math.min(...outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      const edge = b.clone().sub(a);
      const fraction = Math.max(0, Math.min(1, p.clone().sub(a).dot(edge) / edge.lengthSq()));
      return p.distanceTo(a.clone().addScaledVector(edge, fraction));
    }));
    let stoneChip: Vector2 | undefined;
    const front = (p: Vector2): V => {
      const rim = Math.max(0, Math.min(1, edgeDistance(p) / 0.075));
      const field = veinField(p) * rim;
      // Most substrate stays behind the mating plane. Only the angular branching fracture
      // network breaks the wall surface: stone shoulders enclose a lower mineral-bearing core.
      const lip = Math.max(0, Math.min(1, field / 0.42));
      const shoulder = lip * lip * (3 - 2 * lip) * 0.10;
      const cut = Math.max(0, Math.min(1, (field - 0.62) / 0.34));
      const channel = cut * cut * (3 - 2 * cut) * (this.spec.spent ? 0.018 : 0.006);
      const grain = stoneNoise(p.x * 12, p.y * 12, 0, this.spec.seed) * field * 0.0018;
      const chipRadius = stoneChip ? Math.abs(p.x - stoneChip.x) / 0.085
        + Math.abs(p.y - stoneChip.y) / 0.145 : Infinity;
      const chip = Math.max(0, Math.min(1, (1 - chipRadius) / 0.63));
      const z = Math.min(0.325, Math.max(0.055 + shoulder - channel + grain, 0.055 + chip * 0.27));
      return new Vector3(p.x, p.y, z);
    };
    const tint = (p: Vector2): Colour => {
      const stone = this.stone(new Vector3(p.x, p.y, 0.2), 0, false);
      const amount = exposure(p);
      if (this.spec.spent) return mix(stone, colour(this.host, 0.31), amount * 0.92);
      const fleck = 0.34 + Math.sin(p.x * 13.6 + p.y * 10.8 + phase) * 0.16;
      return mix(stone, mix(colour(material.ore), colour(material.pale), fleck), amount * 0.97);
    };
    const surface = surfaceGrid(outline, 0.027, this.spec.seed);
    let bestChip = Infinity;
    for (const point of surface.flat()) {
      const field = veinField(point);
      if (field < 0.44 || field > 0.62) continue;
      const score = point.distanceToSquared(new Vector2(-0.17, 0.63));
      if (score < bestChip) { bestChip = score; stoneChip = point; }
    }
    if (!stoneChip) throw new Error(`${this.spec.id}: no fracture shoulder for the shared stone chip`);
    for (const [a, b, c] of surface) {
      const centre = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      const ore = exposure(centre) > 0.075;
      if (ore) this.mineralFaces++;
      this.tri(front(a), front(b), front(c), tint(a), tint(b), tint(c), ore && !this.spec.spent, new Vector3(0, 0, 1));
    }
    // Closed rear and sides share the exact active/spent perimeter. There is no decorative
    // rubble or front toe to separate the exposure visually from its host face.
    for (const indices of ShapeUtils.triangulateShape(outline, [])) {
      const [a, b, c] = indices.map((i) => new Vector3(outline[i]!.x, outline[i]!.y, -0.325)) as [V, V, V];
      this.tri(c, b, a, this.stone(c, 0, false), this.stone(b, 0, false), this.stone(a, 0, false));
    }
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
      const af = front(a), bf = front(b), ar = new Vector3(a.x, a.y, -0.325), br = new Vector3(b.x, b.y, -0.325);
      const shade = this.stone(af, 0, false);
      this.tri(ar, br, af, shade, shade, shade);
      this.tri(br, bf, af, shade, shade, shade);
    }
    this.blocks = 1;
  }

  buildTerracedOutcrop(): void {
    const outline = [[-2.70, -0.90], [-1.65, -1.70], [0.60, -1.62], [2.36, -0.90],
      [2.70, 0.20], [1.95, 1.27], [0.64, 1.70], [-1.41, 1.51], [-2.45, 0.72]]
      .map(([x, z]) => new Vector2(x!, z!));
    const smooth = (a: number, b: number, value: number) => {
      const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const levels = [0, 0.34, 0.89, 1.38, 2.08, 2.61, 3.22, 3.85];
    const height = (p: Vector2) => {
      const x = p.x, z = p.y, nx = x / 2.7, nz = z / 1.7;
      const main = 1 - Math.abs(nx + 0.22) * 0.70 - Math.abs(nz + 0.36) * 0.34
        - Math.max(0, nz + 0.08) * 0.34;
      const shoulder = 0.62 - Math.abs(nx - 0.43) * 0.79 - Math.abs(nz + 0.04) * 0.61;
      const raw = Math.max(0, Math.max(main, shoulder) * 3.75
        + stoneNoise(x * 0.95, 0, z * 0.95, this.spec.seed) * 0.19);
      let terrace = raw;
      for (let i = 0; i < levels.length - 1; i++) {
        const low = levels[i]!, high = levels[i + 1]!;
        if (raw < low || raw > high) continue;
        const t = (raw - low) / (high - low);
        terrace = low + (high - low) * (t * 0.24 + smooth(0.49, 0.87, t) * 0.76);
        break;
      }
      const breakout = Math.max(0, 1 - Math.abs(x * 0.68 - z * 0.37 - 0.14
        + Math.sin(z * 3.7) * 0.055) / 0.13) * 0.31;
      const split = Math.max(0, 1 - Math.abs(x + z * 0.65 + 1.18) / 0.09)
        * (1 - smooth(0.1, 0.9, z)) * 0.18;
      const edge = Math.min(...outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length]!, ab = b.clone().sub(a);
        const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
        return p.distanceTo(a.clone().addScaledVector(ab, t));
      }));
      const grain = stoneNoise(x * 6.8, 0, z * 6.8, this.spec.seed + 61) * 0.021;
      return Math.max(0, terrace + x * 0.075 - z * 0.055 - breakout - split + grain)
        * smooth(0, 0.27, edge);
    };
    const point = (p: Vector2) => new Vector3(p.x, height(p), p.y);
    for (const [a, b, c] of surfaceGrid(outline, 0.075, this.spec.seed)) {
      const pa = point(a), pb = point(b), pc = point(c);
      const n = new Vector3().crossVectors(pc.clone().sub(pa), pb.clone().sub(pa)).normalize();
      const shade = (p: V) => this.stone(p, Math.floor((p.y - p.x * 0.075 + p.z * 0.055) / 0.60), false);
      this.tri(pa, pc, pb, shade(pa), shade(pc), shade(pb), false, n);
    }
    for (const indices of ShapeUtils.triangulateShape(outline, [])) {
      const [a, b, c] = indices.map((i) => new Vector3(outline[i]!.x, 0, outline[i]!.y)) as [V, V, V];
      const shade = colour(this.host, 0.82);
      this.tri(a, b, c, shade, shade, shade, false, new Vector3(0, -1, 0));
    }
    this.blocks = 1;
  }

  /** Each host profile is authored at its own proportions; cliffs keep long exposed beds. */
  buildStratifiedFormation(): void {
    const cliff = this.spec.kind === "cliff", variant = this.spec.variant ?? 1;
    const [width, height, depth] = this.spec.size;
    const footprint = cliff ? (variant === 1
      ? [[-1, -.64], [-.77, -1], [.56, -.91], [.97, -.45], [1, .33], [.69, .86], [-.25, 1], [-.91, .58]]
      : [[-1, -.43], [-.66, -1], [.42, -.94], [.92, -.61], [1, .13], [.72, .81], [-.27, 1], [-.88, .48]])
      : variant === 2
        ? [[-1, -.39], [-.68, -.91], [.19, -1], [.83, -.62], [1, .13], [.61, .88], [-.26, 1], [-.87, .56]]
        : [[-1, -.52], [-.64, -1], [.38, -.91], [.96, -.45], [1, .18], [.62, .82], [-.43, 1], [-.90, .55]];
    const outline = footprint.map(([x, z]) => new Vector2(x! * width / 2, z! * depth / 2));
    const smooth = (a: number, b: number, value: number) => {
      const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const beds = cliff ? (variant === 1
      ? [0, .073, .19, .31, .395, .58, .70, .82, 1.08]
      : [0, .12, .23, .37, .455, .62, .76, .88, 1.10])
      : variant === 2 ? [0, .11, .27, .43, .61, .72, .95, 1.1]
        : [0, .14, .24, .45, .57, .78, 1.1];
    const field = (p: Vector2): number => {
      const x = p.x, z = p.y, nx = x / (width / 2), nz = z / (depth / 2);
      let raw: number;
      if (cliff) {
        // The broad plateau spans most of X. A fault offsets one end, while the foreground
        // falls through unequal bedding shelves. There is no radial or single-peak falloff.
        const crest = variant === 1
          ? .94 - .10 * smooth(-.22, .63, nx) + .045 * Math.sin(nx * 5.1 + .9)
          : .87 + .12 * smooth(-.56, -.07, nx) - .13 * smooth(.30, .78, nx);
        const frontLine = (variant === 1 ? .12 : .01) + nx * (variant === 1 ? .085 : -.11)
          + Math.sin(nx * 4.3 + variant) * .055;
        const foreground = 1 - smooth(frontLine - .47, frontLine + .76, nz) * .87;
        raw = crest * foreground;
        raw -= Math.max(0, 1 - Math.abs(nx + .40 + nz * .075) / .075) * .065;
      } else if (variant === 2) {
        // A broad southwest shoulder and a lower broken eastern bench form a split saddle.
        const west = .91 - Math.max(0, nx + .28) * .58 - Math.max(0, -nx - .48) * .53
          - Math.abs(nz + .16) * .33;
        const east = .61 - Math.abs(nx - .44) * .65 - Math.abs(nz - .17) * .29;
        raw = Math.max(west, east) - Math.max(0, 1 - Math.abs(nx + .05 + nz * .22) / .18) * .13;
      } else {
        // A long, low tilted bed ends in an offset raised shoulder and a thin forward shelf.
        const bench = .78 - Math.max(0, Math.abs(nx + .04) - .51) * .72
          - Math.max(0, nz + .24) * .49 - Math.max(0, -nz - .38) * .23;
        const shoulder = .96 - Math.abs(nx - .42) * .61 - Math.abs(nz + .22) * .63;
        raw = Math.max(bench, shoulder);
      }
      raw += stoneNoise(x * .83, 0, z * .83, this.spec.seed) * (cliff ? .026 : .039);
      raw = Math.max(0, raw);
      let terrace = raw;
      for (let i = 0; i < beds.length - 1; i++) {
        const low = beds[i]!, high = beds[i + 1]!;
        if (raw < low || raw > high) continue;
        const t = (raw - low) / (high - low);
        const wornEdge = .51 + Math.sin(x * .73 + i * 2.3) * .045;
        terrace = low + (high - low) * (t * .25 + smooth(wornEdge, .88, t) * .75);
        break;
      }
      const jointLine = x * (cliff ? .81 : .71) - z * .39 - width * (variant === 1 ? -.13 : .10)
        + Math.sin(z * 3.1) * .042;
      const joint = Math.max(0, 1 - Math.abs(jointLine) / (cliff ? .17 : .105)) * (cliff ? .35 : .20);
      const split = Math.max(0, 1 - Math.abs(x + z * .56 + width * .29) / (cliff ? .12 : .085))
        * (1 - smooth(-depth * .12, depth * .36, z)) * (cliff ? .25 : .14);
      const edge = Math.min(...outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length]!, ab = b.clone().sub(a);
        const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
        return p.distanceTo(a.clone().addScaledVector(ab, t));
      }));
      const grain = stoneNoise(x * 6.8, 0, z * 6.8, this.spec.seed + 61) * .020;
      const beddingTilt = x * (variant === 1 ? .051 : -.045) - z * .032;
      return Math.max(0, terrace * height + beddingTilt - joint - split + grain)
        * smooth(0, cliff ? .32 : .23, edge);
    };
    const point = (p: Vector2) => new Vector3(p.x, field(p), p.y);
    for (const [a, b, c] of surfaceGrid(outline, cliff ? .11 : .077, this.spec.seed)) {
      const pa = point(a), pb = point(b), pc = point(c);
      const n = new Vector3().crossVectors(pc.clone().sub(pa), pb.clone().sub(pa)).normalize();
      const shade = (p: V) => this.stone(p, Math.floor((p.y - p.x * .051 + p.z * .032) / .65), false);
      this.tri(pa, pc, pb, shade(pa), shade(pc), shade(pb), false, n);
    }
    for (const indices of ShapeUtils.triangulateShape(outline, [])) {
      const [a, b, c] = indices.map((i) => new Vector3(outline[i]!.x, 0, outline[i]!.y)) as [V, V, V];
      const shade = colour(this.host, .82);
      this.tri(a, b, c, shade, shade, shade, false, new Vector3(0, -1, 0));
    }
    this.blocks = 1;
  }

  /** One carved cliff solid, or a downhill rubble wedge, with no repeated height profiles. */
  buildShortcutFormation(slide: boolean): void {
    const [width, height, depth] = this.spec.size;
    type Field = (x: number, y: number, z: number) => number;
    type Plane = readonly [x: number, y: number, z: number, distance: number];
    const convex = (planes: readonly Plane[]): Field => {
      const normalized = planes.map(([x, y, z, distance]) => {
        const length = Math.hypot(x, y, z);
        return [x / length, y / length, z / length, distance / length] as const;
      });
      return (x, y, z) => {
        let farthest = -Infinity;
        for (const [nx, ny, nz, distance] of normalized) {
          farthest = Math.max(farthest, nx * x + ny * y + nz * z - distance);
        }
        return farthest;
      };
    };
    // Every face cuts through the body at its own inclination. Three intersecting roof
    // planes make one eroded crown and a lower connected shoulder, not flat-topped posts.
    const body = slide ? convex([
      [0, -1, 0, 0], [0, 1, .76, 2.18], [-.38, 1, .24, 3.68], [.24, 1, -.20, 4.21],
      [.78, 1, -.11, 2.12],
      [-1, .09, -.32, 1.47], [1, .10, -.32, 1.72],
      [.13, .32, -1, 2.49], [-.37, .24, -1, 2.72],
      [.20, .30, 1, 2.85], [-.23, .34, 1, 2.82],
    ]) : convex([
      [0, -1, 0, 0], [.33, 1, .18, 3.13], [-.39, 1, .27, 4.42], [.08, 1, -.36, 3.79],
      [-1, .13, .11, 4.16], [1, .20, -.17, 4.25],
      [-.32, .18, -1, 2.66], [.29, .12, -1, 2.58],
      [.18, .44, 1, 2.85], [-.36, .25, 1, 2.81],
    ]);
    const toe = slide ? convex([
      [0, -1, 0, 0], [0, 1, .20, .72], [-1, .14, -.31, 1.68], [1, .16, -.25, 1.83],
      [0, 0, -1, -.45], [.19, .25, 1, 2.80], [-.22, .21, 1, 2.74],
    ]) : convex([
      [0, -1, 0, 0], [.12, 1, .24, 1.51], [-1, .08, .16, 3.78], [1, .14, -.19, 3.72],
      [0, 0, -1, .15], [.24, .20, 1, 3.07], [-.20, .20, 1, 3.01],
    ]);
    const fractureCuts: Field[] = slide ? [
      // Rear fractures stop inside the connected mass; they do not split it into pillars.
      convex([[1, .38, -.21, -.14], [-1, -.38, .21, .47], [0, 0, 1, -.43], [0, -1, 0, -.63]]),
      convex([[1, -.24, .34, 1.30], [-1, .24, -.34, -.98], [0, 0, 1, -.72], [0, -1, 0, -.35]]),
      convex([[.31, 1, .21, 1.12], [-.31, -1, -.21, -.88], [-1, 0, 0, 1.75],
        [1, 0, 0, -.32], [0, 0, -1, -.10]]),
    ] : [
      convex([[1, .32, -.22, .61], [-1, -.32, .22, -.11], [0, -.18, -1, .62], [0, -1, 0, -.82]]),
      convex([[1, .11, .40, -1.10], [-1, -.11, -.40, 1.46], [0, 0, 1, -.63], [0, -1, 0, -.44]]),
      convex([[.18, 1, .17, 1.40], [-.18, -1, -.17, -1.13], [-1, 0, 0, 3.93],
        [1, 0, 0, -.31], [0, 0, -1, -.21]]),
      convex([[1, -.24, -.31, 2.74], [-1, .24, .31, -2.39], [0, 0, -1, .06], [0, -1, 0, -.32]]),
    ];
    // Irregular shallow crown losses cross the larger tilted planes at different angles.
    const crownCuts: Field[] = slide ? [
      convex([[.52, -1, .19, -3.30], [-1, 0, -.25, .75], [1, 0, .25, -.21], [0, 0, 1, -.30]]),
      convex([[-.26, -1, -.34, -3.12], [1, 0, -.32, .95], [-1, 0, .32, -.45], [0, 0, -1, 1.85]]),
    ] : [
      convex([[.44, -1, .15, -3.65], [-1, 0, .28, 2.06], [1, 0, -.28, -1.38], [0, 0, 1, -.25]]),
      convex([[-.21, -1, .38, -3.34], [-1, 0, -.24, .80], [1, 0, .24, -.20], [0, 0, -1, 1.73]]),
      convex([[.31, -1, -.26, -2.69], [-1, 0, .22, -1.20], [1, 0, -.22, 1.84], [0, 0, 1, 1.31]]),
    ];
    const approach: Field = slide
      ? convex([[-1, 0, 0, -.85], [0, 0, 1, -.05], [0, 0, -1, 1.16], [0, 1, 0, 1.88], [0, -1, 0, -.04]])
      : convex([[1, 0, 0, -.62], [-.20, 0, 1, .23], [.20, 0, -1, 1.04], [0, 1, 0, 2.08], [0, -1, 0, -.04]]);
    const mainField: Field = (x, y, z) => {
      let distance = Math.min(body(x, y, z), toe(x, y, z));
      for (const cut of fractureCuts) distance = Math.max(distance, -cut(x, y, z));
      for (const cut of crownCuts) distance = Math.max(distance, -cut(x, y, z));
      return Math.max(distance, -approach(x, y, z));
    };
    const topAt = (x: number, z: number): number => {
      // Locate the existing solid before attaching debris, so fragments sit in the slope.
      let previous = height + .5;
      for (let y = previous - .05; y >= 0; y -= .05) {
        if (mainField(x, y, z) <= 0) {
          let low = y, high = previous;
          for (let step = 0; step < 10; step++) {
            const middle = (low + high) / 2;
            if (mainField(x, middle, z) <= 0) low = middle; else high = middle;
          }
          return low;
        }
        previous = y;
      }
      return 0;
    };
    type Fragment = { x: number; y: number; z: number; w: number; h: number; d: number;
      yaw: number; pitch: number; roll: number; field: Field };
    const fragments: Fragment[] = [];
    const locations = slide
      ? [[-.89, -.53], [-.12, -.31], [.68, -.27], [-1.31, .04], [-.47, .18], [.40, .10], [1.22, .26],
        [-1.72, .59], [-.92, .65], [-.12, .57], [.73, .70], [1.60, .74],
        [-2.15, 1.10], [-1.35, 1.09], [-.58, 1.17], [.24, 1.14], [1.08, 1.18], [1.99, 1.18],
        [-2.17, 1.78], [-1.58, 1.64], [-.83, 1.86], [-.11, 1.72], [.56, 1.86], [1.38, 1.73], [2.19, 1.78],
        [-1.78, 2.23], [-1.07, 2.28], [-.41, 2.41], [.28, 2.28], [.99, 2.32], [1.72, 2.23]]
      : [[-3.77, .83], [-3.03, 1.37], [-2.37, 1.94], [-1.61, 2.17], [-.67, 2.49], [.25, 2.31],
        [1.31, 2.09], [2.36, 1.77], [3.27, 1.12], [3.84, .38], [2.63, -1.72], [-3.62, -1.93]];
    for (let i = 0; i < locations.length; i++) {
      const [px, pz] = locations[i]!;
      const x = px! + (this.random() - .5) * .34, z = pz! + (this.random() - .5) * .35;
      const w = (slide ? .43 : .57) + this.random() * (slide ? .69 : .62);
      const d = w * (.55 + this.random() * .50), h = w * (.25 + this.random() * .39);
      const yaw = this.random() * Math.PI * 2, pitch = (this.random() - .5) * .61;
      const roll = (this.random() - .5) * .69, y = Math.max(.018, topAt(x, z) - h * .22);
      const profile = convex([[0, -1, 0, .08], [0, 1, .19, .77], [.24, 1, -.17, .87],
        [1, .24, .13, .49], [-1, .18, -.19, .46], [.16, .28, 1, .49], [-.17, .22, -1, .47],
        [.72, .20, .70, .51 + this.random() * .13], [-.64, .14, -.75, .53 + this.random() * .11],
        [.45, 1, .34, .67 + this.random() * .18]]);
      fragments.push({ x, y, z, w, h, d, yaw, pitch, roll, field: profile });
    }
    const field: Field = (x, y, z) => {
      let distance = mainField(x, y, z);
      for (const fragment of fragments) {
        if (Math.abs(x - fragment.x) > fragment.w * 1.2 || Math.abs(z - fragment.z) > fragment.w * 1.2
          || Math.abs(y - fragment.y) > fragment.h + fragment.w * .4) continue;
        const cosine = Math.cos(fragment.yaw), sine = Math.sin(fragment.yaw);
        const dx = x - fragment.x, dz = z - fragment.z;
        const yawX = dx * cosine - dz * sine, yawZ = dx * sine + dz * cosine;
        const dy = y - fragment.y - fragment.h * .3;
        const pitchY = dy * Math.cos(fragment.pitch) - yawZ * Math.sin(fragment.pitch);
        const pitchZ = dy * Math.sin(fragment.pitch) + yawZ * Math.cos(fragment.pitch);
        const local = fragment.field((yawX * Math.cos(fragment.roll) - pitchY * Math.sin(fragment.roll)) / fragment.w,
          (yawX * Math.sin(fragment.roll) + pitchY * Math.cos(fragment.roll)) / fragment.h + .3, pitchZ / fragment.d);
        distance = Math.min(distance, local * Math.min(fragment.w, fragment.h, fragment.d));
      }
      // Keep all debris inside the established envelope. Each boundary is buried in the foot.
      return Math.max(distance, Math.abs(x) - width / 2, -y, Math.abs(z) - depth / 2);
    };
    // Hard Boolean intersections preserve fracture planes. Grid interpolation adds only a
    // small chamfer at their meeting edges; no smoothing union or displacement noise is used.
    const resolution = 64, padding = .40;
    const extent = new Vector3(width + padding * 2, height + padding * 2, depth + padding * 2);
    const material = new MeshBasicMaterial();
    const surface = new MarchingCubes(resolution, material, false, false, 80_000);
    surface.isolation = 0;
    for (let iz = 0; iz < resolution; iz++) for (let iy = 0; iy < resolution; iy++) for (let ix = 0; ix < resolution; ix++) {
      const x = (ix / resolution - .5) * extent.x;
      const y = iy / resolution * extent.y - padding;
      const z = (iz / resolution - .5) * extent.z;
      surface.field[iz * resolution * resolution + iy * resolution + ix] = -field(x, y, z);
    }
    surface.update();
    if (surface.count / 3 >= 80_000) throw new Error(`${this.spec.id}: geology surface exceeded its triangle buffer`);
    const positions = surface.geometry.getAttribute("position");
    const point = (index: number): V => new Vector3(positions.getX(index) * extent.x / 2,
      (positions.getY(index) + 1) * extent.y / 2 - padding, positions.getZ(index) * extent.z / 2);
    for (let i = 0; i < surface.count; i += 3) {
      const a = point(i), b = point(i + 1), c = point(i + 2);
      const normal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const shade = (p: V): Colour => this.stone(p, Math.floor((p.y - p.x * .24 + p.z * .31) / .77), false);
      this.tri(a, b, c, shade(a), shade(b), shade(c), false, normal);
    }
    surface.geometry.dispose(); material.dispose();
    // Native normalization fits the actual closed solid. There is no flat bounding card.
    this.blocks = 1 + fragments.length;
  }

  buildScree(): void {
    const [width, , depth] = this.spec.size;
    const pieces: Array<{ x: number; z: number; radius: number }> = [];
    const count = this.spec.variant === 1 ? 27 : 22;
    for (let i = 0; i < count; i++) {
      const large = i < 5;
      const w = large ? .51 + this.random() * .35 : .15 + this.random() * .29;
      const d = w * (.51 + this.random() * .32), radius = w * .43;
      let x = 0, z = 0, placed = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        x = (this.random() - .5) * (width - w);
        z = (this.random() - .5) * (depth - d);
        if ((x / (width * .48)) ** 2 + (z / (depth * .48)) ** 2 > 1) continue;
        if (pieces.some((p) => Math.hypot(p.x - x, p.z - z) < (p.radius + radius) * .80)) continue;
        placed = true;
        break;
      }
      if (!placed) continue;
      pieces.push({ x, z, radius });
      const yaw = this.random() * Math.PI * 2, c = Math.cos(yaw), s = Math.sin(yaw);
      const h = large ? w * (.34 + this.random() * .13) : w * (.18 + this.random() * .18);
      const seed = this.spec.seed + i * 173;
      const outline = [[-.50, -.19], [-.24, -.50], [.27, -.43], [.50, -.07], [.28, .43], [-.21, .50], [-.46, .21]]
        .map(([px, pz]) => new Vector2(px! * w, pz! * d));
      const point = (p: Vector2) => {
        const edge = Math.min(...outline.map((a, j) => {
          const b = outline[(j + 1) % outline.length]!, ab = b.clone().sub(a);
          const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
          return p.distanceTo(a.clone().addScaledVector(ab, t));
        }));
        const rim = Math.max(0, Math.min(1, edge / (w * .16)));
        const worn = rim * rim * (3 - 2 * rim);
        const top = h * (.84 + p.x / w * .29 - p.y / d * .21)
          + stoneNoise(p.x * 22, 0, p.y * 22, seed) * h * .065;
        return new Vector3(x + p.x * c - p.y * s, Math.max(0, top * worn), z + p.x * s + p.y * c);
      };
      for (const [a, b, cp] of surfaceGrid(outline, large ? .035 : .026, seed)) {
        const pa = point(a), pb = point(b), pc = point(cp);
        const n = new Vector3().crossVectors(pc.clone().sub(pa), pb.clone().sub(pa)).normalize();
        this.tri(pa, pc, pb, this.stone(pa, i, false), this.stone(pc, i, false), this.stone(pb, i, false), false, n);
      }
      for (const indices of ShapeUtils.triangulateShape(outline, [])) {
        const [a, b, cp] = indices.map((j) => point(outline[j]!)) as [V, V, V];
        a.y = b.y = cp.y = 0;
        const shade = colour(this.host, .82);
        this.tri(a, b, cp, shade, shade, shade, false, new Vector3(0, -1, 0));
      }
      this.blocks++;
    }
  }

  build(): void {
    if (this.spec.id === "corealm_sunder_ledge" || this.spec.id === "corealm_scree_slide") {
      this.buildShortcutFormation(this.spec.id === "corealm_scree_slide");
      return;
    }
    if (this.spec.id === "corealm_rock_strata_1") {
      this.buildTerracedOutcrop();
      return;
    }
    if (this.spec.kind === "ore") {
      this.buildOreSlab();
      return;
    }
    if (this.spec.kind === "scree") {
      this.buildScree();
      return;
    }
    this.buildStratifiedFormation();
  }

  normalize(): void {
    // Slab dimensions and mating plane are authored directly in native metres.
    if (this.spec.kind === "ore") return;
    const points = this.triangles.flatMap((t) => t.points);
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of points) { min.min(p); max.max(p); }
    const extent = max.clone().sub(min), mid = min.clone().add(max).multiplyScalar(0.5);
    const scale = new Vector3(...this.spec.size).divide(extent);
    for (const p of points) {
      p.x = (p.x - mid.x) * scale.x;
      p.y = (p.y - min.y) * scale.y;
      p.z = (p.z - mid.z) * scale.z;
    }
    for (const triangle of this.triangles) triangle.faceNormal?.divide(scale).normalize();
  }

  smoothWeatheredNormals(): void {
    const adjacency = new Map<string, V[]>();
    const normals = this.triangles.map((triangle) => {
      const [a, b, c] = triangle.points;
      return new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    });
    const key = (p: V) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
    for (let i = 0; i < this.triangles.length; i++) for (const p of this.triangles[i]!.points) {
      const k = key(p), bucket = adjacency.get(k) ?? [];
      bucket.push(normals[i]!);
      adjacency.set(k, bucket);
    }
    const creaseAngle = this.spec.placement ? 25 : 48;
    const cosine = Math.cos(creaseAngle * Math.PI / 180);
    for (let i = 0; i < this.triangles.length; i++) {
      const normal = normals[i]!;
      this.triangles[i]!.vertexNormals = this.triangles[i]!.points.map((p) => {
        const smooth = new Vector3();
        for (const neighbour of adjacency.get(key(p))!) {
          if (normal.dot(neighbour) >= cosine) smooth.add(neighbour);
        }
        return smooth.normalize();
      }) as [V, V, V];
    }
  }

  /** Placement offsets preserve the legacy ground pivot after native normalization. */
  translate(translation: V): void {
    for (const triangle of this.triangles) {
      for (const point of triangle.points) point.add(translation);
    }
  }
}

const specs: Spec[] = [
  { id: "corealm_rock_strata_1", kind: "outcrop", seed: 1201, variant: 1, size: [5.4, 3.7, 3.4] },
  { id: "corealm_rock_strata_2", kind: "outcrop", seed: 2894, variant: 2, size: [4.5, 2.65, 4.0] },
  { id: "corealm_rock_strata_3", kind: "outcrop", seed: 3572, variant: 3, size: [6.1, 2.4, 2.8] },
  { id: "corealm_cliff_strata_1", kind: "cliff", seed: 4507, variant: 1, size: [12, 7, 4.8] },
  { id: "corealm_cliff_strata_2", kind: "cliff", seed: 5659, variant: 2, size: [9, 8.6, 5.2] },
  {
    id: "corealm_sunder_ledge", kind: "cliff", seed: 4507, variant: 1,
    size: [9.319, 4.448, 6.735],
    placement: { replacesAssetId: "cliff_step_2", translation: [-0.0425, -0.19, 0.4585] },
  },
  {
    id: "corealm_scree_slide", kind: "cliff", seed: 6397, variant: 2,
    size: [5.996, 4.382, 5.44],
    placement: { replacesAssetId: "cliff_step_3", translation: [0.057, -0.124, 0.402] },
  },
  { id: "corealm_scree_1", kind: "scree", seed: 6073, variant: 1, size: [3.4, 0.60, 2.3] },
  { id: "corealm_scree_2", kind: "scree", seed: 7881, variant: 2, size: [2.7, 0.50, 2.8] },
  ...Object.keys(MINERALS).flatMap((key, index): Spec[] => {
    const mineral = key as keyof typeof MINERALS;
    return [false, true].map((spent) => ({
      id: `corealm_ore_${mineral}${spent ? "_spent" : ""}`, mineral, spent,
      kind: "ore", seed: 8219 + index * 719, size: [2.6, 1.6, 0.65],
    }));
  }),
];

const io = new NodeIO();

export const GEOLOGY_ASSET_IDS: readonly string[] = specs.map(spec => spec.id);

async function serializeGeology(spec: Spec, rock: Geology): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene(spec.id);
  document.getRoot().setDefaultScene(scene);
  const mesh = document.createMesh(spec.id);
  const mineral = spec.mineral ? MINERALS[spec.mineral] : undefined;
  for (const useMineral of [false, true]) {
    const triangles = rock.triangles.filter((t) => t.mineral === useMineral);
    if (!triangles.length) continue;
    const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [];
    for (const triangle of triangles) {
      const [a, b, c] = triangle.points;
      const geometricNormal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const projectionNormal = triangle.faceNormal ?? geometricNormal;
      for (let i = 0; i < 3; i++) {
        const p = triangle.points[i]!;
        const normal = triangle.vertexNormals?.[i] ?? geometricNormal;
        positions.push(p.x, p.y, p.z);
        normals.push(normal.x, normal.y, normal.z);
        colours.push(...triangle.colours[i]!);
        // Planar world-metre UVs maintain comparable texel density on differently sized rocks.
        if (Math.abs(projectionNormal.y) > 0.7) uvs.push(p.x, p.z);
        else if (Math.abs(projectionNormal.x) > 0.7) uvs.push(p.z, p.y);
        else uvs.push(p.x, p.y);
      }
    }
    const material = document.createMaterial(useMineral ? "Corealm mineral seam" : "Corealm weathered strata")
      .setBaseColorFactor([1, 1, 1, 1])
      .setRoughnessFactor(useMineral ? 0.70 : 0.94)
      .setMetallicFactor(useMineral ? mineral!.metalness : 0)
      .setEmissiveFactor([0, 0, 0]);
    const attribute = (name: string, type: "VEC2" | "VEC3", values: number[]) =>
      document.createAccessor(name).setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
    mesh.addPrimitive(document.createPrimitive().setMaterial(material)
      .setAttribute("POSITION", attribute("position", "VEC3", positions))
      .setAttribute("NORMAL", attribute("normal", "VEC3", normals))
      .setAttribute("COLOR_0", attribute("colour", "VEC3", colours))
      .setAttribute("TEXCOORD_0", attribute("uv", "VEC2", uvs)));
  }
  scene.addChild(document.createNode(spec.id).setMesh(mesh));
  await document.transform(weld());
  return io.writeBinary(document);
}

/** Source generation is deterministic and has no filesystem writes, including fitted variants. */
export async function buildGeologyAsset(assetId: string): Promise<{ glb: Uint8Array; entry: GeologyAssetEntry }> {
  const spec = specs.find(entry => entry.id === assetId);
  if (!spec) throw new Error(`Unknown Corealm geology asset: ${assetId}`);
  const rock = new Geology(spec);
  rock.build();
  rock.normalize();
  rock.smoothWeatheredNormals();
  if (spec.placement) rock.translate(new Vector3(...spec.placement.translation));
  const glb = await serializeGeology(spec, rock);
  const offset = spec.placement?.translation ?? [0, 0, 0];
  // Retain declared placement measurements without binary floating-point tails.
  const coordinate = (value: number): number => spec.placement ? Number(value.toFixed(6)) : value;
  const entry: GeologyAssetEntry = {
    id: spec.id, file: `${DIRECTORY}/${spec.id}.glb`, pack: PACK.id, category: "rock",
    is: spec.kind === "ore" ? "ore" : spec.kind === "cliff" ? "cliff" : "rock",
    tags: [spec.kind === "ore" ? "ore" : spec.kind === "cliff" ? "cliff" : "rock", "strata", "geology",
      ...(spec.mineral ? [spec.mineral, spec.spent ? "depleted" : "resource"] : ["environment"])],
    bytes: glb.byteLength,
    size: { x: spec.size[0], y: spec.size[1], z: spec.size[2] },
    base: { x: coordinate(-spec.size[0] / 2 + offset[0]!), y: coordinate(offset[1]!), z: coordinate(-spec.size[2] / 2 + offset[2]!) },
    animations: [], materials: [false, true]
      .filter(useMineral => rock.triangles.some(triangle => triangle.mineral === useMineral))
      .map(useMineral => useMineral ? "Corealm mineral seam" : "Corealm weathered strata"),
    sha256: createHash("sha256").update(glb).digest("hex"),
    triangles: rock.triangles.length, blocks: rock.blocks, mineralFaces: rock.mineralFaces,
    ...(spec.placement ? { placement: { ...spec.placement, translation: [...spec.placement.translation] } } : {}),
  };
  return { glb, entry };
}

/** Staging never reads or overwrites the production catalogue or any public GLB. */
export function geologyOutputPaths(out?: string): GeologyOutputPaths {
  if (out === undefined) return { modelsDirectory: OUTPUT, catalogFile: path.join(ROOT, "tools/data/corealm-geology.json") };
  const stagingRoots = [path.resolve(ROOT, "test-results"), path.resolve(ROOT, "art/rebuild/candidates")];
  const outputRoot = path.resolve(ROOT, out);
  const contained = stagingRoots.some(staging => {
    const relative = path.relative(staging, outputRoot);
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  });
  if (!out.trim() || !contained) {
    throw new Error("Geology --out must stay inside test-results or art/rebuild/candidates");
  }
  return { modelsDirectory: path.join(outputRoot, DIRECTORY), catalogFile: path.join(outputRoot, "corealm-geology.json") };
}

function selectSpecs(options: GeologyBuildOptions): readonly Spec[] {
  const selectors = Number(options.only !== undefined) + Number(options.oresOnly === true) + Number(options.representative === true);
  if (selectors > 1) throw new Error("Choose one geology selector: --only, --ores-only or --representative");
  if (options.only) {
    if (options.only.length === 0 || new Set(options.only).size !== options.only.length) {
      throw new Error("Geology --only requires nonempty, distinct exact asset IDs");
    }
    const unknown = options.only.filter(id => !GEOLOGY_ASSET_IDS.includes(id));
    if (unknown.length > 0) throw new Error(`Unknown Corealm geology asset(s): ${unknown.join(", ")}`);
    return specs.filter(spec => options.only!.includes(spec.id));
  }
  if (options.representative) return specs.filter(spec => ["corealm_rock_strata_1", "corealm_ore_grithe", "corealm_ore_grithe_spent"].includes(spec.id));
  return options.oresOnly ? specs.filter(spec => spec.kind === "ore") : specs;
}

export function parseGeologyBuildOptions(args: readonly string[]): GeologyBuildOptions {
  const values = new Map<string, string>();
  const modes = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--ores-only" || flag === "--representative") {
      if (modes.has(flag)) throw new Error(`Duplicate geology option: ${flag}`);
      modes.add(flag);
      continue;
    }
    if (flag !== "--only" && flag !== "--out") throw new Error(`Unknown geology option: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate geology option: ${flag}`);
    const value = args[++i];
    if (!value?.trim() || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
  }
  const options: GeologyBuildOptions = {
    ...(modes.has("--ores-only") ? { oresOnly: true } : {}),
    ...(modes.has("--representative") ? { representative: true } : {}),
    ...(values.has("--only") ? { only: values.get("--only")!.split(",").map(id => id.trim()) } : {}),
    ...(values.has("--out") ? { out: values.get("--out")! } : {}),
  };
  selectSpecs(options);
  geologyOutputPaths(options.out);
  return options;
}

export async function buildCorealmGeology(options: GeologyBuildOptions = {}): Promise<{
  entries: readonly GeologyAssetEntry[];
  paths: GeologyOutputPaths;
}> {
  const selected = selectSpecs(options);
  const paths = geologyOutputPaths(options.out);
  const entries: GeologyAssetEntry[] = [];
  if (options.out === undefined && selected.length < specs.length) {
    const existing = JSON.parse(await readFile(paths.catalogFile, "utf8")) as { assets: GeologyAssetEntry[] };
    entries.push(...existing.assets.filter(entry => !selected.some(spec => spec.id === entry.id)));
  }
  await mkdir(paths.modelsDirectory, { recursive: true });
  for (const spec of selected) {
    const { glb, entry } = await buildGeologyAsset(spec.id);
    await writeFile(path.join(paths.modelsDirectory, `${spec.id}.glb`), glb);
    entries.push(entry);
    console.log(`${spec.id.padEnd(29)} ${String(entry.triangles).padStart(5)} tris  ${(glb.byteLength / 1024).toFixed(0)} KiB`);
  }
  const sourceHash = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  await mkdir(path.dirname(paths.catalogFile), { recursive: true });
  await writeFile(paths.catalogFile, `${JSON.stringify({
    pack: PACK,
    generator: "npx tsx tools/build-corealm-geology.ts",
    generatorSha256: sourceHash,
    coordinates: "Metres, Y-up. Native formations are centred XZ with minimum Y=0; fitted variants retain their declared legacy base and pivot. Ore worked faces point +Z; back geology toward -Z.",
    oreMount: {
      matingPlaneZ: 0.12,
      perimeterZ: 0.055,
      substrateBackZ: -0.325,
      instruction: "Place a real continuous host face at local Z=+0.12 times asset scale. It must swallow the identical active/spent perimeter while leaving interior mineral relief exposed. An overlapping host bounding box is not attachment proof.",
    },
    construction: "Continuous terraced outcrops use distinct shoulders, split saddles and elongated tilted beds. Broad quarry cliffs retain unequal bedding shelves and oblique breakout joints. Sunder is one closed cliff body cut by intersecting tilted fracture planes and approach recesses. Scree Slide is a descending solid wedge with an uneven widening fan of tumbled angular debris. Their actual rock volumes are fitted to legacy placement bounds without flat boundary sheets. Scree patches consist of separate worn fracture flakes. Ore uses narrow irregular branching fissures with lower metallic cores, recut spent scars and identical active/spent perimeters. All exposed surfaces carry metre-density UVs, restrained vertex colour variation and angle-limited smooth normals; hard fracture boundaries remain sharp.",
    assets: entries,
  }, null, 2)}\n`);
  return { entries, paths };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await buildCorealmGeology(parseGeologyBuildOptions(process.argv.slice(2)));
}
