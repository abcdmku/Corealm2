/**
 * Original Corealm nature geometry. Run: npx tsx tools/build-corealm-nature.ts
 *
 * Trees grow from an explicit trunk / branch / twig hierarchy. The canopy is
 * small alpha-cutout cards with textured leaf detail. Each
 * species has an authored branching habit; seeds only vary it within that habit.
 * Output contains vertex-coloured wood and masked foliage, UVs, and grounded pivots.
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Document, NodeIO, getBounds } from "@gltf-transform/core";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import { weld } from "@gltf-transform/functions";
import { Color } from "three";
import sharp from "sharp";
import { gameRoot, repoRoot } from "./lib/paths.js";

type V = [number, number, number];
type UV = [number, number];
type Role = "bark" | "leaves" | "cutwood" | "stem" | "flowers";
type Kind = "oak" | "pine" | "deadwood" | "stump" | "fern" | "grass" | "shrub" | "flower";
interface Spec { id: string; kind: Kind; seed: number; variant: number; description: string }
interface Skin { positions: number[]; normals: number[]; colours: number[]; uvs: number[] }
interface Ring { p: V; radius: number }
interface BladeOptions { segments?: number; midribStride?: number; curve?: number; curl?: number; twist?: number; lobes?: number; lobeDepth?: number; lobePhase?: number; role?: Role; spray?: number }
const TAU = Math.PI * 2;
// Candidate builds never touch live models or their production catalogue.
const stageIndex = process.argv.indexOf("--stage");
const stageArgument = stageIndex < 0 ? undefined : process.argv[stageIndex + 1];
if (stageIndex >= 0 && (!stageArgument || stageArgument.startsWith("--"))) throw new Error("--stage requires an output directory");
const stageRoot = stageArgument ? path.resolve(repoRoot, stageArgument) : undefined;
const outDir = stageRoot ? path.join(stageRoot, "models/corealm/nature") : path.join(gameRoot, "public/assets/models/corealm/nature");
const catalogueFile = stageRoot ? path.join(stageRoot, "catalog.json") : path.join(repoRoot, "tools/data/corealm-nature.json");
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const checkOnly = process.argv.includes("--check-only");
const pendingWrites: Array<{ destination: string; binary: Uint8Array }> = [];
const productionBounds: Record<string, { min: V; max: V }> = {
  "corealm_oak_1": {
    "min": [
      -3.2961,
      0,
      -3.1075
    ],
    "max": [
      3.5169,
      7.9465,
      3.2986
    ]
  },
  "corealm_oak_2": {
    "min": [
      -3.581,
      0,
      -3.4813
    ],
    "max": [
      3.8867,
      8.5595,
      3.9155
    ]
  },
  "corealm_oak_3": {
    "min": [
      -2.6443,
      0,
      -2.3622
    ],
    "max": [
      2.6519,
      6.5614,
      2.7944
    ]
  },
  "corealm_pine_1": {
    "min": [
      -3.364,
      0,
      -3.5697
    ],
    "max": [
      3.5677,
      10.5469,
      3.8359
    ]
  },
  "corealm_pine_2": {
    "min": [
      -2.7851,
      0,
      -2.9892
    ],
    "max": [
      3.5941,
      9.7286,
      2.9001
    ]
  },
  "corealm_pine_3": {
    "min": [
      -2.5151,
      0,
      -2.5209
    ],
    "max": [
      2.7279,
      7.6918,
      2.4292
    ]
  },
  "corealm_deadwood_1": {
    "min": [
      -1.3719,
      0,
      -1.3914
    ],
    "max": [
      1.3766,
      6.3722,
      1.3005
    ]
  },
  "corealm_deadwood_2": {
    "min": [
      -0.7807,
      0,
      -1.0062
    ],
    "max": [
      1.1556,
      5.7264,
      0.9159
    ]
  },
  "corealm_stump_oak": {
    "min": [
      -1.0209,
      0,
      -0.9352
    ],
    "max": [
      1.0677,
      0.8818,
      0.9447
    ]
  },
  "corealm_stump_pine": {
    "min": [
      -0.6597,
      0,
      -0.6634
    ],
    "max": [
      0.7174,
      0.6318,
      0.7083
    ]
  },
  "corealm_fern_1": {
    "min": [
      -0.9791,
      0.0147,
      -0.982
    ],
    "max": [
      0.9413,
      0.6441,
      0.7839
    ]
  },
  "corealm_fern_2": {
    "min": [
      -0.4782,
      0.0163,
      -0.5176
    ],
    "max": [
      0.5217,
      0.773,
      0.4661
    ]
  },
  "corealm_grass_1": {
    "min": [
      -0.3953,
      0.005,
      -0.1799
    ],
    "max": [
      0.1674,
      0.4057,
      0.3155
    ]
  },
  "corealm_grass_2": {
    "min": [
      -0.5321,
      0.005,
      -0.34
    ],
    "max": [
      0.4928,
      0.6446,
      0.3989
    ]
  },
  "corealm_shrub_1": {
    "min": [
      -0.7885,
      0,
      -0.73
    ],
    "max": [
      0.7892,
      1.2026,
      0.7638
    ]
  },
  "corealm_shrub_2": {
    "min": [
      -0.5108,
      0.0012,
      -0.5237
    ],
    "max": [
      0.5245,
      0.7269,
      0.4584
    ]
  },
  "corealm_flower_1": {
    "min": [
      -0.3143,
      0.0099,
      -0.3179
    ],
    "max": [
      0.2316,
      0.5202,
      0.2533
    ]
  }
};


const specs: Spec[] = [
  { id: "corealm_oak_1", kind: "oak", seed: 7241, variant: 0, description: "Mature spreading oak with a low divided trunk, lifted secondary boughs and an open, broad crown." },
  { id: "corealm_oak_2", kind: "oak", seed: 1927, variant: 1, description: "Tall leaning oak with a dominant side bough and uneven ascending crown." },
  { id: "corealm_oak_3", kind: "oak", seed: 8359, variant: 2, description: "Young woodland oak with a narrower raised crown and slender, visibly branching trunk." },
  { id: "corealm_oak_4", kind: "oak", seed: 3157, variant: 3, description: "Open-grown oak with a low, one-sided crown and a long exposed lateral bough." },
  { id: "corealm_oak_5", kind: "oak", seed: 6113, variant: 4, description: "Forked woodland oak with two unequal upright crowns and an open central notch." },
  { id: "corealm_pine_1", kind: "pine", seed: 5843, variant: 0, description: "Mature pine with irregular horizontal branch whorls, distinct spaces between boughs and a rising leader." },
  { id: "corealm_pine_2", kind: "pine", seed: 2399, variant: 1, description: "Wind-shaped pine with a gently leaning leader and unequal layered boughs." },
  { id: "corealm_pine_3", kind: "pine", seed: 9437, variant: 2, description: "Young pine with lifted lower branches and a slender, open conical crown." },
  { id: "corealm_pine_4", kind: "pine", seed: 4703, variant: 3, description: "Older open pine with a bare lower trunk and a wind-bent, interrupted crown." },
  { id: "corealm_pine_5", kind: "pine", seed: 1307, variant: 4, description: "Compact broad pine with drooping lower boughs and a dense short leader." },
  { id: "corealm_ash_1", kind: "oak", seed: 1373, variant: 0, description: "Mature ash with a round spreading crown, ascending limbs and opposite compound leaf sprays." },
  { id: "corealm_ash_2", kind: "oak", seed: 4162, variant: 2, description: "Young ash with a stronger upright leader, a narrower crown and fine lateral shoots." },
  { id: "corealm_walnut_1", kind: "oak", seed: 2590, variant: 0, description: "Large walnut with a heavy clear bole, high spreading limbs and alternate compound foliage." },
  { id: "corealm_walnut_2", kind: "oak", seed: 5379, variant: 2, description: "Younger walnut with a tall continuous trunk and smaller asymmetric upper crown." },
  { id: "corealm_willow_1", kind: "oak", seed: 3807, variant: 0, description: "Mature weeping willow with arching supporting limbs and long, unequal leafy pendant shoots." },
  { id: "corealm_willow_2", kind: "oak", seed: 6596, variant: 2, description: "Young willow with a smaller dome and separated curtains of narrow hanging leaves." },
  { id: "corealm_maple_1", kind: "oak", seed: 5024, variant: 0, description: "Rounded mature red maple with ascending limbs, smaller lateral branches and paired lobed foliage." },
  { id: "corealm_maple_2", kind: "oak", seed: 7813, variant: 2, description: "Young red maple with an upright oval crown and a slender continuous leader." },
  { id: "corealm_teak_1", kind: "oak", seed: 6241, variant: 0, description: "Mature teak with a tall clear trunk, spreading upper limbs and large opposite oval leaves." },
  { id: "corealm_teak_2", kind: "oak", seed: 9030, variant: 2, description: "Young teak with a narrower high crown and large paired leaves on rising shoots." },
  { id: "corealm_yew_1", kind: "oak", seed: 7458, variant: 0, description: "Broad mature yew with low spreading limbs, a narrowing upper crown and flat evergreen needle sprays." },
  { id: "corealm_yew_2", kind: "oak", seed: 10247, variant: 2, description: "Young yew with a narrower conical crown and short horizontal needle-bearing branches." },
  { id: "corealm_magic_1", kind: "oak", seed: 8675, variant: 0, description: "Old magic tree with a heavy crooked bole, unequal spreading limbs, flowing bark motes and shimmering silver-veined foliage." },
  { id: "corealm_magic_2", kind: "oak", seed: 11464, variant: 2, description: "Younger magic tree with a narrower rising crown, fine side shoots and the same living bark and leaf shimmer." },
  { id: "corealm_deadwood_1", kind: "deadwood", seed: 3989, variant: 0, description: "Weathered standing oak snag with root flare, a splintered top and asymmetric broken boughs." },
  { id: "corealm_deadwood_2", kind: "deadwood", seed: 6823, variant: 1, description: "Leaning dead pine with a snapped leader, exposed branch ends and grounded spreading roots." },
  { id: "corealm_stump_oak", kind: "stump", seed: 1139, variant: 0, description: "Low oak stump with buttress roots, an uneven cut rim and visible concentric growth grain." },
  { id: "corealm_stump_pine", kind: "stump", seed: 1291, variant: 1, description: "Slender pine stump with a sloping cut face and weathered root flare." },
  { id: "corealm_fern_1", kind: "fern", seed: 7727, variant: 0, description: "Spreading woodland fern with arched rachises and graduated, folded pairs of pinnae." },
  { id: "corealm_fern_2", kind: "fern", seed: 2711, variant: 1, description: "Upright young fern with tightly grouped fronds, tapered leaflets and two uncurling stems." },
  { id: "corealm_grass_1", kind: "grass", seed: 6229, variant: 0, description: "Low tuft of broad grass blades in three unequal fans with bent tips and folded centres." },
  { id: "corealm_grass_2", kind: "grass", seed: 3529, variant: 1, description: "Taller meadow grass with separated blade fans and a few warm, dry tips." },
  { id: "corealm_shrub_1", kind: "shrub", seed: 6791, variant: 0, description: "Spreading hazel-like shrub with exposed woody stems and separate matte leaf sprays." },
  { id: "corealm_shrub_2", kind: "shrub", seed: 7963, variant: 1, description: "Compact heath-edge shrub with rising red-brown shoots and small folded oval leaves." },
  { id: "corealm_flower_1", kind: "flower", seed: 8629, variant: 0, description: "Small woodland flower patch with cream petals, ochre centres and narrow basal leaves." },
];

function add(a: V, b: V): V { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: V, b: V): V { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul(a: V, n: number): V { return [a[0] * n, a[1] * n, a[2] * n]; }
function mix(a: V, b: V, t: number): V { return add(mul(a, 1 - t), mul(b, t)); }
function norm(a: V): V { const l = Math.hypot(...a); return l > 0 ? mul(a, 1 / l) : [0, 1, 0]; }
function cross(a: V, b: V): V { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function polar(a: number, radius: number, y = 0): V { return [Math.cos(a) * radius, y, Math.sin(a) * radius]; }
function colour(hex: number): V { const c = new Color(hex); return [c.r, c.g, c.b]; }
function tint(c: V, gain: number): V { return c.map(v => Math.min(1, Math.max(0, v * gain))) as V; }
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let n = state; n = Math.imul(n ^ (n >>> 15), n | 1); n ^= n + Math.imul(n ^ (n >>> 7), n | 61); return ((n ^ (n >>> 14)) >>> 0) / 4294967296; };
}
function curve(a: V, control: V, b: V, t: number): V { return add(add(mul(a, (1 - t) ** 2), mul(control, 2 * t * (1 - t))), mul(b, t * t)); }

const woodCurves = new WeakMap<V, { b: V; before: V; after: V; c1: V; c2: V; c3: V }>();
function woodPoint(a: V, b: V, before: V, after: V, t: number): V {
  let curve = woodCurves.get(a);
  if (!curve || curve.b !== b || curve.before !== before || curve.after !== after) {
    const length = Math.hypot(...sub(b, a));
    const tangent = (from: V, to: V) => {
      const delta = sub(to, from), span = Math.hypot(...delta);
      return mul(delta, span > 0 ? Math.min(length * .90 / span, .5) : 0);
    };
    const c1 = tangent(before, b), m1 = tangent(a, after);
    const c2 = sub(mul(sub(b, a), 3), add(mul(c1, 2), m1));
    const c3 = add(mul(sub(a, b), 2), add(c1, m1));
    curve = { b, before, after, c1, c2, c3 };
    woodCurves.set(a, curve);
  }
  const { c1, c2, c3 } = curve;
  return [a[0] + t * (c1[0] + t * (c2[0] + t * c3[0])),
    a[1] + t * (c1[1] + t * (c2[1] + t * c3[1])), a[2] + t * (c1[2] + t * (c2[2] + t * c3[2]))];
}

class Plant {
  readonly skins: Record<Role, Skin> = {
    bark: { positions: [], normals: [], colours: [], uvs: [] },
    leaves: { positions: [], normals: [], colours: [], uvs: [] },
    cutwood: { positions: [], normals: [], colours: [], uvs: [] },
    stem: { positions: [], normals: [], colours: [], uvs: [] },
    flowers: { positions: [], normals: [], colours: [], uvs: [] },
  };
  readonly leafSprays: Array<[number, number, number]> = [];
  spraySerial = 0;
  readonly random: () => number;
  readonly bark: V;
  readonly leaf: V;
  constructor(readonly spec: Spec) {
    this.random = rng(spec.seed);
    const speciesBark: Record<string, number> = { oak: 0x746b59, ash: 0x8b8979, walnut: 0x554b40,
      willow: 0x786e52, maple: 0x817363, teak: 0x938477, yew: 0x865644, magic: 0x635f79 };
    this.bark = colour(spec.kind === "pine" ? 0x73604a : spec.kind === "deadwood" ? 0x817868
      : speciesBark[spec.id.split("_")[1]!] ?? 0x72604b);
    this.leaf = colour(spec.kind === "pine" ? 0x587451 : spec.kind === "fern" ? 0x799b55 : spec.kind === "grass" ? 0x7f8c57 : 0x6c8647);
  }
  triangle(role: Role, a: V, b: V, c: V, col: V, uv: [UV, UV, UV] = [[0, 0], [1, 0], [0.5, 1]], normals?: [V, V, V]): void {
    let n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...n) < 1e-9) throw new Error(`${this.spec.id}: degenerate triangle`);
    const normal = norm(n);
    const skin = this.skins[role];
    for (let i = 0; i < 3; i++) {
      skin.positions.push(...[a, b, c][i]!);
      skin.normals.push(...(normals?.[i] ?? normal));
      skin.colours.push(...col);
      skin.uvs.push(...uv[i]!);
    }
  }
  /** Smooth swept wood with longitudinal contour and metre-based grain coordinates. */
  branch(authored: Ring[], sides: number, base = this.bark, cap = true, role: Role = "bark", phase = this.random() * TAU): V[] {
    const largest = Math.max(...authored.map(r => r.radius));
    sides = largest < 0.008 ? 4 : Math.max(sides, largest > 0.20 ? 20 : largest > 0.07 ? 14 : largest > 0.022 ? 9 : 5);
    if (this.spec.kind === "oak" || this.spec.kind === "pine") sides = largest < .022 ? 4 : largest < .07 ? 6 : largest < .20 ? 8 : 12;
    const rings: Ring[] = [];
    for (let i = 0; i < authored.length - 1; i++) {
      const a = authored[i]!, b = authored[i + 1]!;
      const before = authored[Math.max(0, i - 1)]!, after = authored[Math.min(authored.length - 1, i + 2)]!;
      const upperTree = (this.spec.kind === "oak" || this.spec.kind === "pine")
        && authored[0]!.p[1] > (this.spec.id.startsWith("corealm_yew_") ? .8 : 1.9);
      const upperSpacing = /^corealm_(oak|walnut|willow)_/.test(this.spec.id) ? .65 : this.spec.id.startsWith("corealm_yew_") ? .55 : .40;
      const entering = norm(sub(b.p, before.p)), leaving = norm(sub(after.p, a.p));
      const bend = Math.acos(Math.max(-1, Math.min(1, entering.reduce((sum, v, axis) => sum + v * leaving[axis]!, 0))));
      const curveSteps = upperTree ? Math.ceil(bend / .22) : 1;
      const steps = Math.max(curveSteps, 1, Math.min(6, Math.ceil(Math.hypot(...sub(b.p, a.p)) / (upperTree ? upperSpacing : largest > 0.05 ? 0.18 : largest > 0.008 ? 0.16 : 0.35))));
      for (let n = 0; n < steps; n++) {
        const t = n / steps, t2 = t * t, t3 = t2 * t;
        const m0 = mul(sub(b.p, before.p), 0.5), m1 = mul(sub(after.p, a.p), 0.5);
        const point = this.spec.kind === "oak" || this.spec.kind === "pine" ? woodPoint(a.p, b.p, before.p, after.p, t)
          : add(add(mul(a.p, 2 * t3 - 3 * t2 + 1), mul(m0, t3 - 2 * t2 + t)), add(mul(b.p, -2 * t3 + 3 * t2), mul(m1, t3 - t2)));
        rings.push({ p: point, radius: a.radius * (1 - t) + b.radius * t });
      }
    }
    rings.push(authored[authored.length - 1]!);
    const vertices: V[][] = [], normals: V[][] = [], arcs = [0];
    let frameU: V | undefined;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]!;
      if (i) arcs.push(arcs[i - 1]! + Math.hypot(...sub(ring.p, rings[i - 1]!.p)));
      const previous = rings[Math.max(0, i - 1)]!, next = rings[Math.min(rings.length - 1, i + 1)]!;
      const tangent = norm(sub(next.p, previous.p));
      if (!frameU) frameU = norm(cross(tangent, Math.abs(tangent[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]));
      else frameU = norm(sub(frameU, mul(tangent, frameU[0] * tangent[0] + frameU[1] * tangent[1] + frameU[2] * tangent[2])));
      const u = frameU, v = norm(cross(tangent, u));
      const slope = (previous.radius - next.radius) / Math.max(0.001, Math.hypot(...sub(next.p, previous.p)));
      const ringNormals: V[] = [];
      vertices.push(Array.from({ length: sides }, (_, j) => {
        const theta = j * TAU / sides + phase;
        // Uneven axial ridges follow the sweep, with stronger root fluting at ground contact.
        const rootFlare = Math.exp(-Math.max(0, ring.p[1]) * 2.3) * (largest > 0.2 ? 0.12 : 0);
        const contour = 1 + (0.032 + rootFlare) * Math.sin(theta * 5 + arcs[i]! * 0.67) + 0.027 * Math.sin(theta * 9 - arcs[i]! * 1.1 + phase);
        const radial = add(mul(u, Math.cos(theta)), mul(v, Math.sin(theta)));
        const p = add(ring.p, mul(radial, ring.radius * contour));
        ringNormals.push(norm(add(radial, mul(tangent, slope))));
        p[1] = Math.max(0, p[1]);
        return p;
      }));
      normals.push(ringNormals);
    }
    if (this.spec.kind === "oak" || this.spec.kind === "pine") {
      // At a growth elbow the surface normal differs from the ideal cylinder radius.
      // Weight the actual adjoining faces by corner angle so a long segment cannot pull
      // a short collar's lighting normal through its surface. Keep end caps separate.
      for (let i = 0; i < normals.length; i++) normals[i] = vertices[i]!.map(() => [0, 0, 0]);
      const accumulate = (indices: Array<[number, number]>) => {
        const points = indices.map(([i, j]) => vertices[i]![j]!);
        const face = norm(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!)));
        for (let k = 0; k < 3; k++) {
          const a = norm(sub(points[(k + 1) % 3]!, points[k]!)), b = norm(sub(points[(k + 2) % 3]!, points[k]!));
          const angle = Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, v, axis) => sum + v * b[axis]!, 0))));
          const [i, j] = indices[k]!;
          normals[i]![j] = add(normals[i]![j]!, mul(face, angle));
        }
      };
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
        const k = (j + 1) % sides;
        accumulate([[i, j], [i, k], [i + 1, j]]);
        accumulate([[i, k], [i + 1, k], [i + 1, j]]);
      }
      for (let i = 0; i < normals.length; i++) normals[i] = normals[i]!.map(norm);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const a = vertices[i]![j]!, b = vertices[i]![k]!, c = vertices[i + 1]![j]!, d = vertices[i + 1]![k]!;
      const c0 = tint(base, 0.97 + 0.035 * Math.sin(j * TAU / sides * 3 + phase));
      const u0 = j / sides * TAU * rings[i]!.radius, u1 = (j + 1) / sides * TAU * rings[i]!.radius;
      const u2 = j / sides * TAU * rings[i + 1]!.radius, u3 = (j + 1) / sides * TAU * rings[i + 1]!.radius;
      this.triangle(role, a, b, c, c0, [[u0, arcs[i]!], [u1, arcs[i]!], [u2, arcs[i + 1]!]], [normals[i]![j]!, normals[i]![k]!, normals[i + 1]![j]!]);
      this.triangle(role, b, d, c, c0, [[u1, arcs[i]!], [u3, arcs[i + 1]!], [u2, arcs[i + 1]!]], [normals[i]![k]!, normals[i + 1]![k]!, normals[i + 1]![j]!]);
    }
    if (cap) {
      const end = rings.length - 1;
      for (let j = 0; j < sides; j++) this.triangle(role, rings[end]!.p, vertices[end]![j]!, vertices[end]![(j + 1) % sides]!, tint(base, 1.04));
    }
    return vertices[vertices.length - 1]!;
  }
  twig(a: V, control: V, b: V, radius: number, sides = 5, role: Role = "bark"): void {
    const count = radius > 0.03 ? 9 : radius > 0.006 ? 5 : 3;
    this.branch(Array.from({ length: count }, (_, i) => { const t = i / (count - 1); return { p: curve(a, control, b, t), radius: radius * (1 - t * 0.94) ** 0.9 }; }), sides, role === "stem" ? tint(this.leaf, 0.75) : this.bark, true, role);
  }
  /** A gently folded branch spray. The texture carries the leaves and fine twig structure. */
  foliageCard(base: V, direction: V, length: number, width: number, roll: number, gain: number): void {
    const forward = norm(direction);
    const lateral = norm(cross(forward, Math.abs(forward[1]) > 0.94 ? [0, 0, 1] : [0, 1, 0]));
    const vertical = norm(cross(lateral, forward));
    const across = add(mul(lateral, Math.cos(roll)), mul(vertical, Math.sin(roll)));
    const face = norm(cross(across, forward));
    const first = this.skins.leaves.positions.length / 9;
    const colour: V = this.spec.id.startsWith("corealm_magic_") ? [gain * .86, gain * .97, gain] : this.spec.id.startsWith("corealm_walnut_") ? [gain * .92, gain, gain * .88] : [gain, gain, gain];
    // One shallow spray, rooted at its texture's stem. Fine transparent gaps supply
    // the silhouette; never inflate it into an opaque lens around a branch.
    for (const sign of [1]) {
      const points: V[][] = [], normals: V[][] = [];
      for (let row = 0; row < 3; row++) {
        points[row] = []; normals[row] = [];
        for (let col = 0; col < 3; col++) {
          const u = col - 1, v = row - 1;
          const depth = sign * length * .035 * (1 - u * u) * (1 - v * v);
          points[row]![col] = add(add(add(base, mul(forward, length * row * .5)), mul(across, u * width * .5)), mul(face, depth));
          const du = sign * length * -.07 * u * (1 - v * v) / (width * .5);
          const dv = sign * -.14 * v * (1 - u * u);
          normals[row]![col] = mul(norm(sub(sub(face, mul(across, du)), mul(forward, dv))), sign);
        }
      }
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        const a = points[row]![col]!, b = points[row]![col + 1]!, c = points[row + 1]![col]!, d = points[row + 1]![col + 1]!;
        const na = normals[row]![col]!, nb = normals[row]![col + 1]!, nc = normals[row + 1]![col]!, nd = normals[row + 1]![col + 1]!;
        const ua: UV = [col * .5, 1 - row * .5], ub: UV = [(col + 1) * .5, 1 - row * .5];
        const uc: UV = [col * .5, .5 - row * .5], ud: UV = [(col + 1) * .5, .5 - row * .5];
        if (sign > 0) {
          this.triangle("leaves", a,b,c,colour,[ua,ub,uc],[na,nb,nc]);
          this.triangle("leaves", b,d,c,colour,[ub,ud,uc],[nb,nd,nc]);
        } else {
          this.triangle("leaves", a,c,b,colour,[ua,uc,ub],[na,nc,nb]);
          this.triangle("leaves", b,c,d,colour,[ub,uc,ud],[nb,nc,nd]);
        }
      }
    }
    this.leafSprays.push([first,8,++this.spraySerial]);
  }

  /** Continuous curved lamina; the midrib, tapered margin and normal share one UV frame. */
  blade(base: V, direction: V, length: number, width: number, col: V, roll = 0, options: BladeOptions = {}): void {
    const firstTriangle = this.skins.leaves.positions.length / 9;
    const forward = norm(direction);
    const side = norm(cross(forward, Math.abs(forward[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0]));
    const up = norm(cross(side, forward));
    const segments = options.segments ?? 6;
    const bend = options.curve ?? 0.12, curl = options.curl ?? -0.14, twist = options.twist ?? 0.30;
    const point = (t: number, u: number): V => {
      const theta = roll + twist * (t - 0.2);
      const across = add(mul(side, Math.cos(theta)), mul(up, Math.sin(theta)));
      const raised = norm(cross(across, forward));
      const profile = Math.max(0, Math.sin(Math.PI * t)) ** 0.73 * (1 - t * 0.18);
      const lobe = 1 + (options.lobes ? (options.lobeDepth ?? 0.11) * Math.sin(t * Math.PI * options.lobes + (options.lobePhase ?? 0)) : 0);
      const w = width * 0.5 * profile * lobe;
      const arch = length * (bend * Math.sin(Math.PI * t) + curl * t * t);
      const fold = width * 0.14 * Math.sin(Math.PI * t) * (1 - Math.abs(u) ** 1.35);
      return add(add(add(base, mul(forward, length * t)), mul(across, u * w)), mul(raised, arch + fold));
    };
    const normalAt = (t: number, u: number): V => {
      const lo = Math.max(0.0001, t - 0.001), hi = Math.min(0.9999, t + 0.001);
      return norm(cross(sub(point(Math.min(0.9999, Math.max(0.0001, t)), u + 0.001), point(Math.min(0.9999, Math.max(0.0001, t)), u - 0.001)), sub(point(hi, u), point(lo, u))));
    };
    const vertex = (t: number, u: number) => ({ p: point(t, u), n: normalAt(t, u), uv: [t === 0 || t === 1 ? 0.5 : (u + 1) * 0.5, t] as UV });
    const emit = (a: ReturnType<typeof vertex>, b: ReturnType<typeof vertex>, c: ReturnType<typeof vertex>) => this.triangle(options.role ?? "leaves", a.p, b.p, c.p, col, [a.uv, b.uv, c.uv], [a.n, b.n, c.n]);
    if (options.midribStride === 2) {
      // Small fern pinnules retain every serrated margin sample. Fewer interior
      // midrib vertices describe their shallow fold without changing the outline.
      for (let i = 0; i < segments; i += 2) for (const sign of [-1, 1]) {
        const end = Math.min(segments, i + 2), a = vertex(i / segments, i ? 0 : sign);
        const face = (b: ReturnType<typeof vertex>, c: ReturnType<typeof vertex>) => sign < 0 ? emit(a, c, b) : emit(a, b, c);
        for (let edge = i; edge < end; edge++) {
          if (edge) face(vertex(edge / segments, sign), vertex((edge + 1) / segments, edge + 1 === segments ? 0 : sign));
        }
        if (end < segments) face(vertex(end / segments, sign), vertex(end / segments, 0));
      }
    } else for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      for (const sign of [-1, 1]) {
        const a = vertex(t0, 0), b = vertex(t0, sign), c = vertex(t1, 0), d = vertex(t1, sign);
        // Split from the midrib consistently; endpoints are single shared vertices.
        if (sign < 0) { if (i) emit(a, c, b); if (i < segments - 1) emit(b, c, d); }
        else { if (i) emit(a, b, c); if (i < segments - 1) emit(b, d, c); }
      }
    }
    if (!options.role || options.role === "leaves") this.leafSprays.push([firstTriangle, this.skins.leaves.positions.length / 9 - firstTriangle, options.spray ?? ++this.spraySerial]);
  }
  /** Fine curved shoots fill a rounded crown lobe at several scales. */
  crownCluster(origin: V, bearing: number, size: number): void {
    for (let shoot = 0; shoot < 5; shoot++) {
      const a = bearing + shoot * 2.39996 + (this.random() - 0.5) * 0.5;
      const end = add(origin, polar(a, size * (0.48 + this.random() * 0.20), size * ([-0.28, 0.38, 0.06, 0.55, -0.10][shoot]! + this.random() * 0.10)));
      const arch = add(mix(origin, end, 0.5), [0, size * 0.12, 0]);
      this.twig(origin, arch, end, size * 0.009, 5);
      const direction = norm(sub(end, origin));
      for (let sprig = 0; sprig < 4; sprig++) {
        const t = 0.16 + sprig * 0.25;
        const start = curve(origin, arch, end, t);
        const angle = a + (sprig % 2 ? -1 : 1) * (0.65 + this.random() * 0.35);
        const tip = add(start, polar(angle, size * (0.20 + this.random() * 0.10), size * (this.random() * 0.27 - 0.14)));
        const control = add(mix(start, tip, 0.5), [0, size * 0.065, 0]);
        this.twig(start, control, tip, size * 0.0035, 5);
        const f = norm(sub(tip, start)), lateral = norm(cross(f, [0, 1, 0])), vertical = norm(cross(lateral, f));
        const spray = ++this.spraySerial;
        for (let l = 0; l < 10; l++) {
          const shrub = this.spec.kind === "shrub";
          // Four well-spaced nodes keep the shrub's individual leaves readable.
          // Consume the same random samples so its woody scaffold stays fixed.
          const q = 0.06 + l * 0.094, phi = (shrub ? l / 3 : l) * 2.39996 + shoot * 0.4;
          const at = curve(start, control, tip, q);
          const d = add(add(mul(f, 0.36), mul(lateral, Math.cos(phi))), mul(vertical, Math.sin(phi) * 0.68 - q * 0.22));
          const leafLength = size * (0.15 + this.random() * 0.065) * (1 - q * 0.16);
          const col = tint(this.leaf, 0.86 + this.random() * 0.28), roll = (this.random() - 0.5) * 1.8;
          const bend = 0.07 + this.random() * 0.08, twist = (this.random() - 0.5) * 0.65;
          if (!shrub || l % 3 === 0) this.blade(at, d, leafLength, leafLength * (shrub ? 0.66 : 0.59), col, roll, { spray, segments: shrub ? 5 : 6, curve: bend, curl: -0.10 - q * 0.09, twist, lobes: this.spec.kind === "oak" ? 10 : 0 });
        }
      }
      this.blade(end, add(direction, [0, -0.12, 0]), size * 0.13, size * 0.073, this.leaf, 0.2, { segments: this.spec.kind === "shrub" ? 5 : 6 });
    }
  }
  /** Curved branchlets carry slender needles in paired, offset fascicles. */
  needleSpray(origin: V, end: V, size: number): void {
    const forward = norm(sub(end, origin));
    const side = norm(cross(forward, [0, 1, 0])), up = norm(cross(side, forward));
    const arch = add(mix(origin, end, 0.5), mul(up, size * 0.14));
    this.twig(origin, arch, end, size * 0.014, 5);
    for (let branchlet = 0; branchlet < 5; branchlet++) {
      const t = 0.12 + branchlet * 0.205, sign = branchlet % 2 ? -1 : 1;
      const start = curve(origin, arch, end, t);
      const tip = add(start, add(add(mul(forward, size * 0.42), mul(side, sign * size * (0.80 - t * 0.37))), mul(up, size * (0.15 + Math.sin(branchlet * 2.3) * 0.29))));
      const control = add(mix(start, tip, 0.5), mul(up, size * 0.12));
      this.twig(start, control, tip, size * 0.005, 5);
      const f = norm(sub(tip, start)), right = norm(cross(f, up));
      const spray = ++this.spraySerial;
      for (let node = 0; node < 5; node++) {
        const q = 0.04 + node * 0.23, at = curve(start, control, tip, q);
        for (const n of [-1, 1]) {
          const dir = add(add(mul(f, 0.50 + q * 0.24), mul(right, n * (0.8 - q * 0.22))), mul(up, Math.sin(node * 2.39996 + branchlet) * 0.42));
          const len = size * (0.46 + this.random() * 0.18) * (1 - q * 0.23);
          this.blade(at, dir, len, len * 0.35, tint(this.leaf, 0.90 + this.random() * 0.24), n * 0.24 + Math.sin(node) * 0.35, { spray, segments: 3, curve: 0.10, curl: -0.065, twist: n * 0.4 });
        }
      }
    }
  }
  roots(radius: number, spread: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = i * TAU / count + (this.random() - 0.5) * 0.68;
      const reach = spread * (0.48 + this.random() * 0.35);
      this.branch([
        { p: polar(a, radius * 0.30, radius * 0.90), radius: radius * 0.45 },
        { p: polar(a + 0.04, reach * 0.32, radius * 0.52), radius: radius * 0.34 },
        { p: polar(a + 0.12, reach * 0.60, radius * 0.16), radius: radius * 0.17 },
        { p: polar(a + 0.24, reach * 0.84, radius * 0.05), radius: radius * 0.068 },
        { p: polar(a + 0.42, reach, 0.004), radius: 0.004 },
      ], 10, tint(this.bark, 0.94));
    }
  }

}

interface TreeAxis {
  id: number;
  parent: number | null;
  attachment: number;
  attachmentFraction: number;
  order: number;
  rings: Ring[];
  leafBearing: boolean;
  stem: boolean;
  phase: number;
}

/** Tree-only growth records: every fork starts within the wood that carries it. */
function treeAxis(plant: Plant, axes: TreeAxis[], rings: Ring[], parent: TreeAxis | null = null, attachment = 0, attachmentFraction = 0, stem = parent === null): TreeAxis {
  const axis = { id: axes.length, parent: parent?.id ?? null, attachment, attachmentFraction,
    order: parent ? parent.order + 1 : 0, rings, leafBearing: false, stem, phase: plant.random() * TAU };
  axes.push(axis);
  // Broadleaf stems are swept after their daughters exist, so a divided bole can
  // continue through the fork without an exposed full-width end cap.
  if (plant.spec.kind !== "oak") plant.branch(rings, parent ? 7 : 9, plant.bark, rings.at(-1)!.radius >= .0001, "bark", axis.phase);
  return axis;
}

interface TreeWoodSweep { axisIds: number[]; rings: Ring[]; phase: number }

/** One continuous surface through each main fork. Biological axes remain separate
 * for crown construction; their rendered wood shares the same ring at the join.
 */
function treeWoodSweeps(axes: TreeAxis[]): TreeWoodSweep[] {
  const continuations = new Map<number, TreeAxis>();
  for (const axis of axes) if (axis.parent !== null && axis.stem) {
    const current = continuations.get(axis.parent);
    if (!current || axis.attachment + axis.attachmentFraction > current.attachment + current.attachmentFraction)
      continuations.set(axis.parent, axis);
  }
  const continued = new Set([...continuations.values()].map(axis => axis.id));
  return axes.filter(axis => !continued.has(axis.id)).map(root => {
    const sweep: TreeWoodSweep = { axisIds: [], rings: [], phase: root.phase };
    let axis = root, extra = 0, blendLength = 1;
    if (root.stem && root.parent !== null) {
      const parent = treeJoint(axes[root.parent]!, root.attachment, root.attachmentFraction);
      extra = Math.max(0, parent.radius * .92 - root.rings[0]!.radius);
      blendLength = parent.radius * 4;
    }
    while (true) {
      sweep.axisIds.push(axis.id);
      const next = continuations.get(axis.id);
      const rings = next ? axis.rings.slice(0, next.attachment + 1) : axis.rings;
      const section = next && next.attachmentFraction > 0
        ? [...rings, treeJoint(axis, next.attachment, next.attachmentFraction)] : rings;
      let arc = 0;
      for (let i = 0; i < section.length; i++) {
        if (i) arc += Math.hypot(...sub(section[i]!.p, section[i - 1]!.p));
        const ring = section[i]!;
        const radius = ring.radius + extra * Math.pow(Math.max(0, 1 - arc / blendLength), 2);
        // The daughter's origin is the parent's final ring, not a second smaller
        // circumference placed on top of it. Keep only that shared ring.
        if (i || sweep.axisIds.length === 1) sweep.rings.push({ p: ring.p, radius });
      }
      if (!next) break;
      const join = sweep.rings.at(-1)!;
      extra = Math.max(0, join.radius - next.rings[0]!.radius);
      blendLength = Math.max(.25, join.radius * 4);
      axis = next;
    }
    return sweep;
  });
}

/** Attachment on the same Hermite centreline emitted by Plant.branch. */
function treeJoint(parent: TreeAxis, segment: number, t = 0): Ring {
  const a = parent.rings[segment]!, b = parent.rings[segment + 1]!;
  if (t === 0) return a;
  const before = parent.rings[Math.max(0, segment - 1)]!, after = parent.rings[Math.min(parent.rings.length - 1, segment + 2)]!;
  return { p: woodPoint(a.p, b.p, before.p, after.p, t), radius: a.radius * (1 - t) + b.radius * t };
}

/** Unequal growth extensions leave elbows where the advancing shoot changed direction.
 * The wood sweep rounds those joints, while the long stretches between them stay firm.
 * Offsets have only two major turns; adding noise to every ring makes rope-like branches.
 */
function grownLimbRings(start: V, end: V, radius: number, departure: V, random: () => number,
  character: number, arch: number, tipLift: number, junctionRadius = 0): Ring[] {
  const delta = sub(end, start), length = Math.hypot(...delta), forward = norm(delta);
  character *= Math.min(1, length / (radius * 25)) * (.65 + random() * .55);
  const side = norm(cross(forward, Math.abs(forward[1]) > .97 ? [0, 0, 1] : [0, 1, 0]));
  const up = norm(cross(side, forward));
  const hand = random() < .5 ? -1 : 1;
  const firstTurn = hand * length * character * (.07 + random() * .07);
  const secondTurn = firstTurn * (.18 + random() * .62) + (random() - .5) * length * character * .10;
  const firstLift = arch - length * character * (.025 + random() * .075);
  const secondLift = arch * (.25 + random() * .5) + length * character * (random() - .35) * .12;
  const collar = .09 + random() * .025;
  const fractions = [0, collar, .23 + random() * .11, .52 + random() * .13, .79 + random() * .09, 1];
  const sideways = [0, 0, firstTurn, secondTurn, secondTurn * .18, 0];
  const lifts = [0, 0, firstLift, secondLift, -length * tipLift * .065, 0];
  let points = fractions.map((t, i) => i === 1 ? add(start, mul(departure, length * t))
    : add(mix(start, end, t), add(mul(side, sideways[i]!), mul(up, lifts[i]!))));
  // A substantial daughter initially follows the trunk grain, then turns into its
  // first growth extension. Confine that easing to the collar; later elbows keep
  // their authored headings. Small laterals already depart toward that extension.
  const collarLength = junctionRadius > 0 ? Math.min(length * collar, junctionRadius * 1.6) : length * collar;
  const departureBlend = junctionRadius > 0 ? .14 : .82;
  points[1] = add(start, mul(norm(mix(departure, norm(sub(points[2]!, start)), departureBlend)), collarLength));
  if (random() < .30) points.splice(4, 1);
  // A thick limb cannot carry the same concentrated elbow as a twig. Round its
  // control polygon over a broad part of both adjoining growth sections, then let
  // the normal wood sweep interpolate the fillet. Fine outer wood keeps its turns.
  const rounded = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]!, before = points[i - 1]!, after = points[i + 1]!;
    const thickness = radius * (1 - Math.min(1, Math.hypot(...sub(point, start)) / length));
    const rounding = Math.min(.32, Math.max(0, (thickness - .055) / .32));
    if (rounding < .025) { rounded.push(point); continue; }
    const enter = mix(point, before, rounding), leave = mix(point, after, rounding);
    rounded.push(enter, mix(mix(enter, point, .5), mix(point, leave, .5), .5), leave);
  }
  rounded.push(points.at(-1)!);
  points = rounded;
  const arcs = [0];
  for (let i = 1; i < points.length; i++) arcs.push(arcs[i - 1]! + Math.hypot(...sub(points[i]!, points[i - 1]!)));
  const taper = .88 + random() * .32;
  return points.map((p, i) => ({ p,
    radius: Math.max(.00002, radius * Math.pow(1 - .992 * arcs[i]! / arcs.at(-1)!, taper)),
  }));
}

function treeFork(plant: Plant, axes: TreeAxis[], parent: TreeAxis, attachment: number,
  bearing: number, reach: number, rise: number, ratio: number, turn: number, attachmentFraction = 0): TreeAxis {
  const joint = treeJoint(parent, attachment, attachmentFraction);
  const tangent = parent.order === 0
    ? norm(sub(parent.rings[Math.min(6, parent.rings.length - 1)]!.p, parent.rings[0]!.p))
    : norm(sub(parent.rings[Math.min(parent.rings.length - 1, attachment + 1)]!.p,
      parent.rings[Math.max(0, attachment - 1)]!.p));
  const base = joint.radius * ratio;
  const end = add(joint.p, polar(bearing + turn, reach, rise));
  const departure = norm(add(norm(sub(end, joint.p)), mul(tangent, .18)));
  const random = rng(plant.spec.seed ^ Math.imul(axes.length + 1, 0x45d9f3b));
  return treeAxis(plant, axes, grownLimbRings(joint.p, end, base, departure, random,
    parent.order === 0 ? .65 : .95, -reach * .035, .18), parent, attachment, attachmentFraction);
}

function treeForkAt(plant: Plant, axes: TreeAxis[], parent: TreeAxis, at: number,
  bearing: number, reach: number, rise: number, ratio: number, turn: number): TreeAxis {
  const u = Math.max(0, Math.min(0.9999, at)) * (parent.rings.length - 1);
  return treeFork(plant, axes, parent, Math.floor(u), bearing, reach, rise, ratio, turn, u - Math.floor(u));
}

/** Anchor the textured spray's twig base on the same curved branch as its wood. */
function treeSpray(plant: Plant, axis: TreeAxis, at: number, bearing: number, rise: number, length: number, width: number, roll: number): void {
  const u = Math.min(.9999, at) * (axis.rings.length - 1);
  const base = treeJoint(axis, Math.floor(u), u % 1).p;
  axis.leafBearing = true;
  plant.foliageCard(base, polar(bearing, 1, rise), length, width, roll, .88 + plant.random() * .12);
}

// Additional age silhouettes derive envelopes before the deliberate mature-oak enlargement.
for (const [id, source, width, height] of [
  ["corealm_oak_4", "corealm_oak_1", 1.18, .87],
  ["corealm_oak_5", "corealm_oak_2", .83, 1.08],
  ["corealm_pine_4", "corealm_pine_1", .88, 1.12],
  ["corealm_pine_5", "corealm_pine_3", 1.22, .88],
] as const) {
  const original = productionBounds[source]!;
  productionBounds[id] = {
    min: [original.min[0] * width, original.min[1], original.min[2] * width],
    max: [original.max[0] * width, original.max[1] * height, original.max[2] * width],
  };

}

// Mature oaks are large spreading trees. Preserve grounded pivots, but deliberately replace
// the old sapling-sized envelope for every oak age variant.
for (const [id, bounds] of Object.entries(productionBounds)) if (/^corealm_oak_\d+$/.test(id)) {
  bounds.min = [bounds.min[0] * 2.05, 0, bounds.min[2] * 2.05];
  bounds.max = [bounds.max[0] * 2.05, bounds.max[1] * 1.95, bounds.max[2] * 2.05];
}

interface CrownHabit {
  width: number; height: number; base: number; radius: number; spray: number;
  boughs: number; spread: number; shoots: number; opposite: boolean;
}
const crownHabits: Record<string, CrownHabit> = {
  oak: { width: 6.8, height: 15.2, base: 3.4, radius: .58, spray: 1.02, boughs: 11, spread: .85, shoots: 5, opposite: false },
  ash: { width: 4.2, height: 10.8, base: 3.4, radius: .22, spray: .76, boughs: 10, spread: .65, shoots: 5, opposite: true },
  walnut: { width: 6.8, height: 16.2, base: 5.8, radius: .52, spray: 1.08, boughs: 10, spread: .80, shoots: 5, opposite: false },
  willow: { width: 5.2, height: 9.4, base: 2.9, radius: .42, spray: .72, boughs: 10, spread: .88, shoots: 5, opposite: false },
  maple: { width: 4.2, height: 10.5, base: 3.3, radius: .24, spray: .72, boughs: 11, spread: .66, shoots: 5, opposite: true },
  teak: { width: 4.1, height: 12, base: 5.5, radius: .22, spray: .90, boughs: 9, spread: .70, shoots: 4, opposite: true },
  yew: { width: 4.0, height: 7.5, base: 1.4, radius: .32, spray: .88, boughs: 13, spread: .90, shoots: 5, opposite: false },
  magic: { width: 6.0, height: 13.8, base: 3.2, radius: .72, spray: .92, boughs: 11, spread: .82, shoots: 5, opposite: false },
};

/** Continuous limbs with subordinate lateral growth. See art/foliage/tree-construction.md.
 * Bud arrangement controls small shoots. It does not duplicate equal adult scaffold forks.
 */
function oak(plant: Plant): TreeAxis[] {
  const species = plant.spec.id.split("_")[1]!, habit = crownHabits[species]!;
  const v = plant.spec.variant, young = v === 2;
  const height = habit.height * [1, 1.12, .80, .90, 1.08][v]!;
  const width = habit.width * [1, .78, .70, 1.2, .87][v]!;
  const base = habit.base * [1, 1.20, .94, .65, 1.02][v]!;
  const girth = habit.radius * [1, .87, .65, 1.10, .9][v]!;
  const conical = species === "yew";
  const spreading = !young && (species === "oak" || species === "magic");
  const leaderHeight = height * (conical || young ? .95 : spreading ? .76 : species === "teak" ? .90 : .83);
  // Keep the geometry random stream independent of how many vertices a wood sweep emits.
  const random = rng(plant.spec.seed ^ 0x61a82bd7);
  const jitter = (span: number) => (random() - .5) * span;
  const axes: TreeAxis[] = [];
  const bearing0 = random() * TAU;
  const architecture = rng(plant.spec.seed ^ 0x795ab37);
  const splitChance = ({ oak: .68, ash: .48, walnut: .54, willow: .74, maple: .55, teak: .25, yew: .60, magic: .80 } as Record<string, number>)[species]!;
  const split = !young && (v === 4 || species === "magic" && v === 0 || architecture() < splitChance);
  const splitAgain = split && (v === 4 || species === "magic" && v === 0);
  const boleHeight = split ? base * (.90 + architecture() * .22) : leaderHeight;
  const lean = polar(bearing0 + .8, height * (v === 1 ? .085 : v === 3 ? .065 : .028));
  const crownShift = polar(bearing0 + (v === 4 ? -.7 : .5), width * (spreading ? .34 : young ? .05 : .15));
  const clearT = Math.min(.70, base * .90 / boleHeight);
  const lowLean = mul(lean, clearT * .28);
  const upperEnd = add(lean, crownShift);
  const trunkGrowth = [
    { t: 0, p: [0, 0, 0] as V },
    { t: clearT, p: lowLean },
    { t: clearT + (1 - clearT) * (.32 + architecture() * .07), p: add(mix(lowLean, upperEnd, .32), polar(bearing0 + 1.2, boleHeight * .012)) },
    { t: clearT + (1 - clearT) * (.68 + architecture() * .07), p: add(mix(lowLean, upperEnd, .68), polar(bearing0 - .65, boleHeight * .016)) },
    { t: 1, p: upperEnd },
  ];
  const trunkPoint = (t: number): V => {
    // The clear lower bole carries a mild lean. Large changes of heading belong to
    // upper stem growth, above the first scaffold limbs rather than at player height.
    if (split) return add(mul(lean, t * boleHeight / height * .28), [0, boleHeight * t, 0]);
    // Unequal firm stem sections, with local changes of heading instead of one polynomial bow.
    const i = Math.min(trunkGrowth.length - 2, trunkGrowth.findIndex((node, i) => i + 1 < trunkGrowth.length && trunkGrowth[i + 1]!.t >= t));
    const a = trunkGrowth[Math.max(0, i)]!, b = trunkGrowth[Math.max(0, i) + 1]!;
    const growth = mix(a.p, b.p, (t - a.t) / (b.t - a.t));
    return add(growth, [0, boleHeight * t, 0]);
  };
  plant.roots(girth, girth * 3.3, 6);
  const trunk = treeAxis(plant, axes, [0, .025, .08, .17, .28, .41, .55, .70, .83, .93, 1].map(t => ({
    p: trunkPoint(t), radius: girth * (split ? 1 - .27 * t : Math.pow(1 - t * .995, young ? .90 : .82)) * (1 + .28 * Math.exp(-t * boleHeight / .22)),
  })));

  const axisAt = (axis: TreeAxis, at: number) => {
    const u = Math.min(.9999, Math.max(0, at)) * (axis.rings.length - 1), segment = Math.floor(u);
    const fraction = u - segment;
    const joint = treeJoint(axis, segment, fraction);
    const tangent = norm(sub(treeJoint(axis, segment, Math.min(1, fraction + .015)).p,
      treeJoint(axis, segment, Math.max(0, fraction - .015)).p));
    return { segment, fraction, joint, tangent };
  };

  const stems = [trunk];
  const addStem = (parent: TreeAxis, at: number, end: V, ratio: number, divides = false) => {
    const { joint, tangent, segment, fraction } = axisAt(parent, at);
    const radius = joint.radius * ratio;
    const rings = grownLimbRings(joint.p, end, radius, tangent, architecture,
      species === "magic" || species === "oak" ? .55 : .45, 0, .24, joint.radius);
    if (divides) for (let i = 0; i < rings.length; i++) rings[i]!.radius = radius * (1 - .26 * i / (rings.length - 1));
    const stem = treeAxis(plant, axes, rings, parent, segment, fraction, true);
    stems.push(stem);
    return stem;
  };
  if (split) {
    const spread = width * (conical ? .25 : .38);
    const firstHeight = splitAgain ? base + (leaderHeight - base) * .48 : leaderHeight;
    const first = addStem(trunk, .86, add(polar(bearing0 + .35, spread, firstHeight), mul(lean, .65)), .76, splitAgain);
    addStem(trunk, .975, add(polar(bearing0 + 2.7, spread * 1.12, leaderHeight * (.91 + architecture() * .08)), mul(lean, .45)), .70);
    if (splitAgain) {
      addStem(first, .86, add(first.rings.at(-1)!.p, polar(bearing0 - .5, width * .24, leaderHeight - firstHeight)), .76);
      addStem(first, .973, add(first.rings.at(-1)!.p, polar(bearing0 + 1.1, width * .30, (leaderHeight - firstHeight) * .86)), .69);
    }
  }
  const terminals = stems.filter(stem => !stems.some(other => other.parent === stem.id));
  const atHeight = (axis: TreeAxis, y: number) => {
    const segment = Math.max(0, axis.rings.findIndex((ring, i) => i + 1 < axis.rings.length && axis.rings[i + 1]!.p[1] >= y));
    const a = axis.rings[segment]!, b = axis.rings[segment + 1]!;
    const fraction = Math.max(0, Math.min(.9999, (y - a.p[1]) / Math.max(.001, b.p[1] - a.p[1])));
    return (segment + fraction) / (axis.rings.length - 1);
  };

  const limb = (parent: TreeAxis, at: number, end: V, ratio: number, arch: number, tipLift: number): TreeAxis => {
    const { segment, fraction, joint, tangent } = axisAt(parent, at);
    const direction = norm(sub(end, joint.p));
    // Tangential emergence and a short collar connect the smaller branch to a continuing limb.
    // Neither child direction nor radius is mirrored around the parent.
    const departure = norm(add(mul(tangent, parent.stem ? spreading ? .22 : .48 : .32), direction));
    const radius = joint.radius * ratio;
    const character = (species === "magic" ? 1.30 : spreading ? 1.15 : species === "willow" ? .52 : .90)
      * (parent.stem ? .64 : 1.12) * (young ? .75 : 1);
    const rings = grownLimbRings(joint.p, end, radius, departure, random, character, arch, tipLift);
    return treeAxis(plant, axes, rings, parent, segment, fraction);
  };

  const leaves = (axis: TreeAxis, size: number, count: number, start = .24, pendant = false) => {
    axis.leafBearing = true;
    const phase = random() * TAU;
    for (let i = 0; i < count; i++) {
      // Opposite buds retain their paired pattern only on this fine, leaf-bearing growth.
      const pair = habit.opposite ? Math.floor(i / 2) : i;
      const steps = habit.opposite ? Math.ceil(count / 2) : count;
      const at = start + (1 - start) * (pair + .18 + random() * .44) / steps;
      const { joint, tangent } = axisAt(axis, at);
      const direction = Math.atan2(tangent[2], tangent[0]);
      const sign = i % 2 ? -1 : 1;
      const angle = pendant ? direction + jitter(1.8) : direction + sign * (.42 + random() * .66) + jitter(.35);
      const rise = pendant ? -2.5 - random() * 2 : species === "yew" ? .02 + random() * .20 : .16 + random() * .60;
      const cardSize = size * (.80 + random() * .38);
      plant.foliageCard(joint.p, polar(angle, 1, rise), cardSize,
        cardSize * (pendant ? .53 : species === "walnut" ? .79 : species === "yew" ? .87 : .96),
        Math.sin(phase + i * 2.4) * .48, .87 + random() * .13);
    }
  };

  const boughCount = habit.boughs - (young ? 2 : 0) + (v === 3 ? 1 : v === 4 ? -1 : 0);
  const primaryAxes: Array<{ axis: TreeAxis; reach: number }> = [];
  for (let b = 0; b < boughCount; b++) {
    const q = (b + .20 + random() * .42) / boughCount;
    const y = Math.max(base, boleHeight * (split ? 1.05 : 0)) + (leaderHeight - base) * q * .79;
    // Locate by actual height, not equal ring indexes, because trunk rings are nonuniform.
    const supports = stems.filter(stem => stem.rings[0]!.p[1] < y && stem.rings.at(-1)!.p[1] > y);
    const support = supports[b % supports.length] ?? terminals[0]!;
    const at = atHeight(support, y);
    const bearing = bearing0 + b * 2.399963 + jitter(.65);
    const shape = species === "yew" ? Math.pow(1 - q * .90, .65)
      : Math.sqrt(Math.max(.13, 1 - Math.pow(q * 1.3 - .20, 2)));
    const reach = width * shape * habit.spread * (.78 + random() * .27) * (v === 3 && Math.cos(bearing - bearing0) > 0 ? 1.18 : 1);
    const crownTop = base + (height - base) * (.51 + q * .34 + jitter(.10));
    const rise = conical ? (height - y) * (.08 + random() * .14)
      : species === "willow" ? crownTop - y - height * .07
          : (crownTop - y) * (spreading ? .60 + q * .40 : 1);
    const origin = axisAt(support, at).joint.p;
    const end = add(origin, polar(bearing + jitter(.35), reach, rise));
    const ratio = (species === "oak" || species === "magic" ? .54 : species === "walnut" ? .50 : .40) * (.80 + random() * .30);
    const axis = limb(support, at, end, ratio, reach * (species === "willow" ? .24 : .04), species === "willow" ? -.6 : .38);
    primaryAxes.push({ axis, reach });
  }
  for (const { axis, reach } of primaryAxes) {
    // Outer continuation stays intact. Side branches bud at different distances down the limb.
    const secondaryCount = habit.shoots - 2 + Math.floor(random() * 4);
    const gaps = Array.from({ length: secondaryCount + 1 }, () => .30 + random() * 1.40);
    const gapTotal = gaps.reduce((a, b) => a + b, 0);
    let growth = 0, side = random() < .5 ? -1 : 1;
    for (let j = 0; j < secondaryCount; j++) {
      growth += gaps[j]!;
      const at = .13 + growth / gapTotal * .78;
      const { joint, tangent } = axisAt(axis, at);
      if (random() > .23) side *= -1;
      const angle = Math.atan2(tangent[2], tangent[0]) + side * (.38 + random() * 1.02);
      const vigour = random();
      const distance = reach * (.20 + vigour * .35) * (1 - at * .38);
      const rise = species === "yew" ? distance * (.03 + random() * .18)
        : species === "willow" ? -distance * (.10 + random() * .25)
          : distance * (-.12 + random() * 1.10);
      const secondary = limb(axis, at, add(joint.p, polar(angle, distance, rise)), .32 + vigour * .29,
        distance * (species === "willow" ? .32 : .07), species === "willow" ? -1.2 : .38);
      const spraySize = habit.spray * (young ? .95 : 1.06);
      leaves(secondary, spraySize * 1.14, species === "teak" ? 9 : 8, .30);
      const tertiaryCount = species === "willow" ? 4 : 2 + Math.floor(random() * 3);
      const twigGaps = Array.from({ length: tertiaryCount + 1 }, () => .35 + random() * 1.3);
      const twigTotal = twigGaps.reduce((a, b) => a + b, 0);
      let twigGrowth = 0;
      for (let k = 0; k < tertiaryCount; k++) {
        twigGrowth += twigGaps[k]!;
        const at2 = .14 + twigGrowth / twigTotal * .78;
        const local = axisAt(secondary, at2), start = local.joint.p;
        const twigAngle = Math.atan2(local.tangent[2], local.tangent[0]) + (random() < .5 ? -1 : 1) * (.35 + random() * 1.04);
        const pendant = species === "willow";
        const twigLength = pendant ? Math.min(start[1] - .7, height * (.17 + random() * .17))
          : distance * (.25 + random() * .55) + spraySize * .18;
        const tip = pendant ? add(start, polar(twigAngle, .25 + random() * .40, -twigLength))
          : add(start, polar(twigAngle, twigLength, twigLength * (species === "yew" ? .02 + random() * .2 : -.12 + random() * 1.18)));
        const twig = limb(secondary, at2, tip, .30 + random() * .20, pendant ? twigLength * .10 : 0, pendant ? -2 : .2);
        leaves(twig, spraySize * (pendant ? 1.12 : 1.08), pendant ? 8 : 7 + (habit.opposite ? 1 : 0), .06, pendant);
      }
    }
    leaves(axis, habit.spray * 1.28, 7, .66);
  }
  // Small ascending shoots around the continuing leader close the upper crown naturally.
  const leaderShoots = young ? 5 : Math.ceil(7 / terminals.length);
  for (const leader of terminals) for (let i = 0; i < leaderShoots; i++) {
    const at = .80 + i / leaderShoots * .175;
    const start = axisAt(leader, at).joint.p, angle = bearing0 + i * 2.399963;
    const reach = width * (conical || young ? .27 - i / leaderShoots * .16 : .33 - i / leaderShoots * .05);
    const shoot = limb(leader, at, add(start, polar(angle, reach, reach * .58)), .30 + random() * .12, 0, .6);
    leaves(shoot, habit.spray * 1.18, 10, .05);
  }
  for (const sweep of treeWoodSweeps(axes)) plant.branch(sweep.rings, 9, plant.bark,
    sweep.rings.at(-1)!.radius >= .0001, "bark", sweep.phase);
  return axes;
}


function pine(plant: Plant): TreeAxis[] {
  const { variant } = plant.spec;
  const h = [10.3, 9.5, 7.5, 10.3, 7.5][variant]!;
  const radius = [0.23, 0.21, 0.15, .22, .17][variant]!;
  const lean: V = variant === 1 ? [0.9, 0, -0.25] : [-0.18, 0, 0.13];
  const trunk = (t: number): V => add(mul(lean, t * t), [0, h * t, 0]);
  plant.roots(radius, radius * 2.9, 5);
  const axes: TreeAxis[] = [];
  const trunkRings = [0, 0.04, 0.16, 0.38, 0.59, 0.80, 1].map((t, i) => ({ p: trunk(t), radius: radius * [1.22, 1, 0.86, 0.65, 0.43, 0.22, 0.021][i]! }));
  const bole = treeAxis(plant, axes, trunkRings);
  const tiers = [10, 9, 8, 7, 10][variant]!;
  for (let level = 0; level < tiers; level++) {
    const crownBase = variant === 3 ? .48 : variant === 2 || variant === 4 ? .38 : .30;
    const height = crownBase + level / (tiers - 1) * (.95 - crownBase);
    const count = variant === 3 ? 3 : level < 3 ? 5 : level < 6 ? 4 : 3;
    for (let b = 0; b < count; b++) {
      const angle = b * TAU / count + level * 2.1 + (plant.random() - .5) * .6;
      const t = height + (plant.random() - .5) * .075;
      const segment = trunkRings.findIndex((ring, i) => i < 6 && trunkRings[i + 1]!.p[1] >= h * t);
      const fraction = (h * t - trunkRings[segment]!.p[1]) / (trunkRings[segment+1]!.p[1] - trunkRings[segment]!.p[1]);
      const reach = h * .32 * Math.pow(1 - t, .8) * (.8 + plant.random() * .35);
      const primary = treeFork(plant, axes, bole, segment, angle, reach, reach * (.02 + plant.random() * .13), .29, (plant.random() - .5) * .35, fraction);
      const size = h * (.115 - t * .045);
      for (let j = 0; j < 3; j++) {
        const side = j % 2 ? -1 : 1;
        const a = angle + side * (.5 + plant.random() * .25);
        const secondary = treeForkAt(plant, axes, primary, .25 + j * .25, a, reach * (.32 + plant.random() * .15), size * (plant.random() - .35) * .4, .48, side * .15);
        for (let node = 0; node < 5; node++) {
          treeSpray(plant, secondary, .16 + node * .19, a + (node % 2 ? .40 : -.40),
            -.35 + node * .18 + plant.random() * .12, size * 1.08, size * .95,
            -.65 + node * .32 + (plant.random() - .5) * .12);
        }
      }
      treeSpray(plant, primary, .92, angle, .3, size, size * .75, .15);
    }
  }
  for (let i = 0; i < 5; i++) treeSpray(plant, bole, .92 + i * .013, i * 2.39996, 1.1, h * .06, h * .047, i * .8);
  return axes;
}

function deadwood(plant: Plant): void {
  const h = plant.spec.variant ? 5.4 : 6.1;
  const radius = plant.spec.variant ? 0.31 : 0.46;
  const lean: V = plant.spec.variant ? [0.65, 0, 0.23] : [0.18, 0, -0.31];
  plant.roots(radius, radius * 3, 6);
  const trunk = (t: number): V => add(mul(lean, t * t), [0, h * t, 0]);
  plant.branch([0, 0.045, 0.15, 0.36, 0.58, 0.78, 1].map((t, i) => ({ p: trunk(t), radius: radius * [1.5, 1.06, 0.92, 0.78, 0.59, 0.43, 0.25][i]! })), 9, plant.bark, false);
  const top = trunk(1);
  for (let s = 0; s < 7; s++) {
    const a = s * TAU / 7;
    const root = add(top, polar(a, radius * 0.17));
    plant.twig(root, add(root, [0, 0.07, 0]), add(root, polar(a + 0.25, 0.05, 0.13 + plant.random() * 0.20)), radius * 0.07, 3);
  }
  for (let b = 0; b < 7; b++) {
    const a = b * 2.39996;
    const start = trunk(0.32 + b * 0.087);
    const tip = add(start, polar(a, h * (0.20 - b * 0.012), h * (0.07 + plant.random() * 0.1)));
    plant.twig(start, add(mix(start, tip, 0.5), [0, -0.14, 0]), tip, radius * (0.44 - b * 0.037), 6);
    if (b < 4) {
      const joint = mix(start, tip, 0.69);
      plant.twig(joint, add(joint, [0, 0.20, 0]), add(joint, polar(a + 0.65, h * 0.065, h * 0.12)), radius * 0.11, 5);
    }
  }
}

function stump(plant: Plant): void {
  const oak = plant.spec.variant === 0;
  const radius = oak ? 0.46 : 0.32;
  const height = oak ? 0.85 : 0.60;
  plant.roots(radius, radius * 2.45, oak ? 6 : 5);
  const rim = plant.branch([
    { p: [0, 0, 0], radius: radius * 1.43 },
    { p: [0, height * 0.25, 0], radius: radius * 1.06 },
    { p: [0.045, height * 0.63, -0.02], radius: radius * 0.91 },
    { p: [0.065, height, -0.035], radius: radius * 0.84 },
  ], 12, plant.bark, false);
  const centre: V = [0.065, height + 0.004, -0.035];
  const cut = colour(oak ? 0xb29b70 : 0xbca076);
  // Grain terminates on the actual fluted bark rim; separate analytic circles
  // leave visible slivers between the cut face and the irregular trunk mesh.
  const surface = (fraction: number, segment: number): V => mix(centre, rim[segment % rim.length]!, fraction);
  for (let ring = 0; ring < 6; ring++) {
    const r0 = ring / 6, r1 = (ring + 1) / 6;
    for (let s = 0; s < rim.length; s++) {
      const c = tint(cut, ring % 2 ? 0.85 : 1.0);
      if (ring === 0) plant.triangle("cutwood", centre, surface(r1, s), surface(r1, s + 1), c);
      else {
        plant.triangle("cutwood", surface(r0, s), surface(r1, s), surface(r0, s + 1), c);
        plant.triangle("cutwood", surface(r0, s + 1), surface(r1, s), surface(r1, s + 1), c);
      }
    }
  }
}

function fern(plant: Plant): void {
  const upright = plant.spec.variant === 1;
  for (let f = 0; f < 8; f++) {
    const angle = f * 2.39996 + plant.random() * 0.12;
    const length = (upright ? 0.86 : 1.10) * (0.77 + plant.random() * 0.23);
    const start: V = polar(angle, 0.025, 0.014);
    const end = polar(angle, length * (upright ? 0.57 : 0.92), length * (upright ? 0.77 : 0.34));
    const control = polar(angle, length * 0.31, length * (upright ? 1.18 : 0.94));
    plant.twig(start, control, end, 0.006, 6, "stem");
    const pairs = upright ? 15 : 10;
    for (let p = 0; p < pairs; p++) {
      const t = 0.10 + p * 0.86 / (pairs - 1);
      const base = curve(start, control, end, t);
      const forward = norm(sub(curve(start, control, end, Math.min(1, t + 0.02)), base));
      const side = norm(cross(forward, [0, 1, 0]));
      const pinna = length * 0.35 * Math.sin(Math.PI * (t + 0.01)) ** 0.66 * (1 - t * 0.30);
      for (const sign of [-1, 1]) {
        const spray = ++plant.spraySerial;
        const direction = norm(add(mul(side, sign), mul(forward, 0.34)));
        const leafColour = tint(plant.leaf, 0.92 + p * 0.008 + plant.random() * 0.08);
        if (upright) {
          plant.blade(base, direction, pinna, pinna * 0.38, leafColour, sign * 0.16, { spray, segments: 12, curve: 0.075, curl: -0.11, twist: sign * 0.30, lobes: 18 });
          continue;
        }
        const tip = add(base, mul(direction, pinna));
        const arch = add(mix(base, tip, 0.5), [0, pinna * 0.11, 0]);
        plant.twig(base, arch, tip, 0.0017, 5, "stem");
        const across = norm(cross(direction, [0, 1, 0]));
        // Woodland fern pinnae divide again into narrow curved pinnules.
        for (let q = 0; q < 4; q++) {
          const u = 0.09 + q * 0.22, at = curve(base, arch, tip, u);
          const leaflet = pinna * 0.44 * Math.sin((u * 0.82 + 0.12) * Math.PI) ** 0.8;
          for (const n of [-1, 1]) plant.blade(at, add(mul(direction, 0.45), mul(across, n)), leaflet, leaflet * 0.72, leafColour, n * 0.19, { spray, segments: 5, midribStride: 2, curve: 0.09, curl: -0.13, twist: sign * n * 0.20, lobes: 6 });
        }
        plant.blade(curve(base, arch, tip, 0.86), direction, pinna * 0.20, pinna * 0.052, leafColour, 0, { spray, segments: 4, curve: 0.06, curl: -0.11 });
      }
    }
    plant.blade(curve(start, control, end, 0.95), sub(end, curve(start, control, end, 0.9)), length * 0.10, length * 0.021, plant.leaf, 0, { segments: 7, lobes: 10 });
  }
}

function grass(plant: Plant): void {
  const tall = plant.spec.variant === 1;
  for (let fan = 0; fan < 3; fan++) {
    const origin = polar(fan * 2.4, fan ? 0.15 : 0, 0.005);
    const count = [3, 2, 1][fan]!;
    const bearing = fan * 2.1 + 0.4;
    for (let i = 0; i < count; i++) {
      const a = bearing + (i / Math.max(1, count - 1) - 0.5) * 2.9;
      const h = (tall ? 0.85 : 0.53) * (0.58 + plant.random() * 0.42);
      const reach = h * (0.27 + plant.random() * 0.53);
      const root = add(origin, polar(a, plant.random() * 0.045));
      const direction = polar(a, reach, h);
      const c = tint(plant.leaf, 0.85 + plant.random() * 0.25);
      plant.blade(root, direction, Math.hypot(reach, h), tall ? 0.045 : 0.033, c, 0.18 * (i - 1), { segments: 4, curve: 0.19, curl: -0.28, twist: (i - 1) * 0.38 });
    }
  }
}

function shrub(plant: Plant): void {
  const small = plant.spec.variant === 1;
  for (let s = 0; s < 7; s++) {
    const a = s * 2.39996;
    const start = polar(a, 0.055, 0.01);
    const end = polar(a, (small ? 0.27 : 0.42) * (0.7 + plant.random() * 0.3), (small ? 0.65 : 1.05) * (0.40 + plant.random() * 0.50));
    const arch = add(mix(start, end, 0.5), polar(a + 0.7, 0.035, 0.10));
    plant.twig(start, arch, end, small ? 0.010 : 0.014, 7);
    plant.crownCluster(end, a, small ? 0.34 : 0.48);
    for (let b = 0; b < 3; b++) {
      const joint = curve(start, arch, end, 0.23 + b * 0.17);
      const tip = add(joint, polar(a + (b % 2 ? -0.8 : 0.8), small ? 0.17 : 0.25, small ? 0.065 : 0.11));
      const control = add(mix(joint, tip, 0.5), [0, 0.025, 0]);
      plant.twig(joint, control, tip, 0.004, 5);
      const direction = norm(sub(tip, joint)), side = norm(cross(direction, [0, 1, 0]));
      const spray = ++plant.spraySerial;
      for (let l = 0; l < 9; l++) {
        const t = 0.12 + l * 0.10;
        const leafLength = (small ? 0.065 : 0.092) * (0.8 + plant.random() * 0.3);
        plant.blade(curve(joint, control, tip, t), add(mul(direction, 0.35), mul(side, l % 2 ? -1 : 1)), leafLength, leafLength * 0.68, tint(plant.leaf, 0.89 + plant.random() * 0.20), (plant.random() - 0.5) * 0.65, { spray, segments: 5, curl: -0.17 });
      }
    }
  }
}

function flower(plant: Plant): void {
  const petals = colour(0xded7b9), centre = colour(0xb29545);
  for (let f = 0; f < 5; f++) {
    const a = f * 2.39996;
    const start = polar(a, f ? 0.16 : 0, 0.01);
    const top = add(start, polar(a, 0.07, 0.34 + plant.random() * 0.18));
    plant.twig(start, add(mix(start, top, 0.5), polar(a, -0.055)), top, 0.0045, 6, "stem");
    for (let p = 0; p < 5; p++) {
      const angle = p * TAU / 5 + a;
      plant.blade(top, polar(angle, 1, 0.18), 0.077, 0.065, tint(petals, 0.96 + plant.random() * 0.08), 0, { segments: 8, curve: 0.06, curl: 0.04, twist: 0, role: "flowers" });
    }
    for (let p = 0; p < 20; p++) {
      const angle = p * TAU / 20;
      plant.triangle("flowers", add(top, [0, 0.018, 0]), add(top, polar(angle + TAU / 20, 0.015, 0.009)), add(top, polar(angle, 0.015, 0.009)), centre);
    }
    for (let l = 0; l < 5; l++) plant.blade(add(start, [0, 0.01 + l * 0.039, 0]), polar(a + l * 2.4, 0.65, 0.55), 0.17 + plant.random() * 0.05, 0.042, tint(plant.leaf, 0.94 + l * 0.035), l * 0.31, { segments: 7, curve: 0.13, curl: -0.10 });
  }
}

const budgets: Record<Kind, number> = { oak: 18000, pine: 22000, deadwood: 8000, stump: 3000, fern: 30000, grass: 80, shrub: 40000, flower: 2000 };
// Fuller crowns spend geometry on leaf-bearing branches as well as the mature wood scaffold.
const largeTreeBudgets: Record<string, number> = { oak: 42000, walnut: 42000, willow: 42000, ash: 32000, maple: 36000, teak: 32000, yew: 36000, magic: 42000 };

/** Preserve the accepted placement envelope and trunk origin through the art rebuild. */
function fitProductionBounds(plant: Plant): void {
  const target = productionBounds[plant.spec.id];
  if (target) {
    const min: V = [Infinity, Infinity, Infinity], max: V = [-Infinity, -Infinity, -Infinity];
    for (const skin of Object.values(plant.skins)) for (let i = 0; i < skin.positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, skin.positions[i + axis]!); max[axis] = Math.max(max[axis]!, skin.positions[i + axis]!);
    }
    for (const skin of Object.values(plant.skins)) for (let i = 0; i < skin.positions.length; i += 3) {
      const scale: V = [1, 1, 1];
      for (let axis = 0; axis < 3; axis++) {
        const v = skin.positions[i + axis]!;
        if (axis === 1) { scale[axis] = (target.max[axis] - target.min[axis]) / (max[axis]! - min[axis]!); skin.positions[i + axis] = target.min[axis] + (v - min[axis]!) * scale[axis]; }
        else { scale[axis] = v < 0 ? target.min[axis]! / min[axis]! : target.max[axis]! / max[axis]!; skin.positions[i + axis] = v * scale[axis]!; }
      }
      const n = norm([skin.normals[i]! / scale[0], skin.normals[i + 1]! / scale[1], skin.normals[i + 2]! / scale[2]]);
      skin.normals.splice(i, 3, ...n);
    }
  }
  if (plant.spec.kind === "oak" || plant.spec.kind === "pine") {
    // Retain a crease at tight growth joints. Smoothing across a nearly perpendicular
    // adjoining face is wrong, especially after fitting an asymmetric planting envelope.
    const { positions, normals } = plant.skins.bark;
    for (let i = 0; i < positions.length; i += 9) {
      const a = positions.slice(i, i + 3) as V, b = positions.slice(i + 3, i + 6) as V, c = positions.slice(i + 6, i + 9) as V;
      const face = norm(cross(sub(b, a), sub(c, a)));
      for (let v = i; v < i + 9; v += 3) {
        const alignment = face[0] * normals[v]! + face[1] * normals[v + 1]! + face[2] * normals[v + 2]!;
        if (alignment < .25) { normals[v] = face[0]; normals[v + 1] = face[1]; normals[v + 2] = face[2]; }
      }
    }
  }
}

function validateGeometry(plant: Plant): number {
  let triangles = 0, minY = Infinity;
  for (const [role, skin] of Object.entries(plant.skins)) {
    if (skin.positions.length % 9 !== 0 || skin.normals.length !== skin.positions.length || skin.colours.length !== skin.positions.length || skin.uvs.length * 3 !== skin.positions.length * 2) throw new Error(`${plant.spec.id}/${role}: invalid attribute counts`);
    for (const attribute of Object.values(skin)) if (attribute.some((v: number) => !Number.isFinite(v))) throw new Error(`${plant.spec.id}/${role}: non-finite attribute`);
    for (let i = 0; i < skin.positions.length; i += 3) {
      minY = Math.min(minY, skin.positions[i + 1]!);
      if (Math.abs(Math.hypot(skin.normals[i]!, skin.normals[i + 1]!, skin.normals[i + 2]!) - 1) > 1e-5) throw new Error(`${plant.spec.id}: invalid normal`);
    }
    for (let i = 0; i < skin.positions.length; i += 9) {
      const a = skin.positions.slice(i, i + 3) as V, b = skin.positions.slice(i + 3, i + 6) as V, c = skin.positions.slice(i + 6, i + 9) as V;
      const face = cross(sub(b, a), sub(c, a));
      if (Math.hypot(...face) < 1e-10) throw new Error(`${plant.spec.id}/${role}: collapsed fitted face`);
      const n = norm(face);
      for (let v = i; v < i + 9; v += 3) if (n[0] * skin.normals[v]! + n[1] * skin.normals[v + 1]! + n[2] * skin.normals[v + 2]! < -0.001) throw new Error(`${plant.spec.id}/${role}: inverted smooth normal at ${skin.positions.slice(i, i+9)}`);
    }
    if ((role === "leaves" || role === "flowers") && skin.uvs.some(v => v < -0.00001 || v > 1.00001)) throw new Error(`${plant.spec.id}: blade UV outside continuous lamina frame`);
    if (skin.colours.some(v => v < 0 || v > 1)) throw new Error(`${plant.spec.id}: vertex colour out of range`);
    triangles += skin.positions.length / 9;
  }
  if (minY < -0.00001 || minY > 0.035) throw new Error(`${plant.spec.id}: ungrounded pivot (${minY})`);
  let leafCursor = 0;
  for (const [firstTriangle, triangleCount, sprayId] of plant.leafSprays) {
    if (firstTriangle !== leafCursor || triangleCount < 2 || sprayId < 1) throw new Error(`${plant.spec.id}: invalid botanical spray provenance`);
    leafCursor += triangleCount;
  }
  if (leafCursor !== plant.skins.leaves.positions.length / 9) throw new Error(`${plant.spec.id}: uncovered botanical lamina`);
  const budget = largeTreeBudgets[plant.spec.id.split("_")[1]!] ?? budgets[plant.spec.kind];
  if (triangles > budget) throw new Error(`${plant.spec.id}: ${triangles} triangles exceeds ${budget}`);
  return triangles;
}

interface EncodingReference { semantic: string; primitive: number; array: Float32Array; elementSize: number }

/** Pack attributes directly; positions and root transforms are never quantized or recentered. */
function packAttributes(doc: Document): EncodingReference[] {
  const reference: EncodingReference[] = [];
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  let primitiveIndex = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const leafUV = /^(Leaves_|Flowers_)/.test(primitive.getMaterial()!.getName());
    for (const semantic of ["POSITION", "NORMAL", "COLOR_0", "TEXCOORD_0"]) {
      const accessor = primitive.getAttribute(semantic)!;
      const source = Float32Array.from(accessor.getArray()!);
      reference.push({ semantic, primitive: primitiveIndex, array: source, elementSize: accessor.getElementSize() });
      if (semantic === "NORMAL") accessor.setArray(Int8Array.from(source, v => Math.round(Math.max(-1, Math.min(1, v)) * 127))).setNormalized(true);
      else if (semantic === "COLOR_0") accessor.setArray(Uint8Array.from(source, v => Math.round(Math.max(0, Math.min(1, v)) * 255))).setNormalized(true);
      else if (semantic === "TEXCOORD_0" && leafUV) {
        if (source.some(v => v < 0 || v > 1)) throw new Error("Cannot encode blade UV outside 0..1");
        accessor.setArray(Uint16Array.from(source, v => Math.round(v * 65535))).setNormalized(true);
      }
    }
    primitiveIndex++;
  }
  return reference;
}

function validateEncoding(doc: Document, reference: EncodingReference[]) {
  const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives());
  let maxLinearColourError = 0, maxBladeUVError = 0, maxNormalAngle = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (node.getTranslation().some(v => v !== 0) || node.getScale().some(v => v !== 1) || node.getRotation().some((v, i) => v !== (i === 3 ? 1 : 0))) throw new Error("Attribute encoding changed the grounded node transform");
  }
  for (const source of reference) {
    const accessor = primitives[source.primitive]!.getAttribute(source.semantic)!;
    if (accessor.getCount() * source.elementSize !== source.array.length) throw new Error("Attribute encoding changed vertex count");
    const value: number[] = [];
    for (let i = 0; i < accessor.getCount(); i++) {
      accessor.getElement(i, value);
      if (source.semantic === "NORMAL") {
        const n = norm(value as V), original = norm(Array.from(source.array.subarray(i * 3, i * 3 + 3)) as V);
        const cosine = Math.max(-1, Math.min(1, n[0] * original[0] + n[1] * original[1] + n[2] * original[2]));
        maxNormalAngle = Math.max(maxNormalAngle, Math.acos(cosine) * 180 / Math.PI);
      }
      for (let c = 0; c < source.elementSize; c++) {
        const error = Math.abs(value[c]! - source.array[i * source.elementSize + c]!);
        if (source.semantic === "POSITION" && error !== 0) throw new Error("Attribute encoding moved a vertex");
        if (source.semantic === "COLOR_0") maxLinearColourError = Math.max(maxLinearColourError, error);
        if (source.semantic === "TEXCOORD_0") {
          if (accessor.getNormalized()) maxBladeUVError = Math.max(maxBladeUVError, error);
          else if (error !== 0) throw new Error("Attribute encoding changed physical wood UVs");
        }
      }
    }
  }
  if (maxNormalAngle > 0.4 || maxLinearColourError > 0.5 / 255 + 1e-8 || maxBladeUVError > 0.5 / 65535 + 1e-8) throw new Error("Packed botanical attributes exceed precision budget");
  const rounded = (n: number) => Number(n.toFixed(10));
  return { positions: "Float32 unchanged", normals: "normalized Int8", linearColours: "normalized Uint8", bladeUV: "normalized Uint16", woodUV: "Float32 unchanged", maxNormalAngleDegrees: rounded(maxNormalAngle), maxLinearColourError: rounded(maxLinearColourError), maxBladeUVError: rounded(maxBladeUVError), groundedIdentityTransform: true };
}

const foliageTextureCache = new Map<string, Promise<Buffer>>();
function foliageTexture(kind: string): Promise<Buffer> {
  let pending = foliageTextureCache.get(kind);
  if (!pending) {
    // Final atlas is build-time resampling only; preserve the source alpha exactly.
    const source = kind === "pine" ? "pine-spray-v2" : kind === "maple" ? "maple-red-spray-source"
      : `${kind}-spray-source`;
    pending = sharp(path.join(repoRoot, `art/foliage/${source}.png`)).resize(1024,1024).png().toBuffer();
    foliageTextureCache.set(kind, pending);
  }
  return pending;
}

async function exportPlant(spec: Spec) {
  const plant = new Plant(spec);
  ({ oak, pine, deadwood, stump, fern, grass, shrub, flower })[spec.kind](plant);
  fitProductionBounds(plant);
  const triangles = validateGeometry(plant);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("Corealm nature");
  const mesh = doc.createMesh(spec.id).setExtras({ corealmLeafSprays: plant.leafSprays, corealmLeafSprayLayout: "[firstTriangle, triangleCount, sprayId] in leaf primitive triangle order" });
  for (const [role, skin] of Object.entries(plant.skins)) {
    if (!skin.positions.length) continue;
    const leafFamily = spec.kind === "pine" ? "needle" : spec.kind === "oak" ? `broadleaf_${spec.id.split("_")[1]}` : spec.kind === "fern" ? "fern" : spec.kind === "grass" ? "grass" : "broadleaf";
    const materialName = role === "bark" ? "Bark_Corealm" : role === "cutwood" ? "Cutwood_Corealm" : role === "stem" ? "Stem_Corealm" : role === "flowers" ? "Flowers_Corealm" : `Leaves_Corealm_${leafFamily}`;
    const treeCard = role === "leaves" && (spec.kind === "oak" || spec.kind === "pine");
    const material = doc.createMaterial(treeCard ? `${materialName}_cutout` : materialName).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(role === "leaves" ? 0.87 : 0.94).setDoubleSided(role === "leaves" || role === "flowers");
    if (spec.id.startsWith("corealm_magic_") && (role === "bark" || role === "leaves")) material.setExtras({ corealmMagicTree: true });
    if (role === "bark" && (spec.kind === "oak" || spec.kind === "pine")) {
      material.setExtras({ ...material.getExtras(), corealmBarkRelief: true });
      material.setBaseColorTexture(doc.createTexture("Mature bark ridges")
        .setImage(await sharp(path.join(repoRoot, "art/foliage/bark-ridges-source.png")).resize(1024, 1024).jpeg({ quality: 86 }).toBuffer()).setMimeType("image/jpeg"));
      material.getBaseColorTextureInfo()!.setWrapS(10497).setWrapT(10497);
      // The scan supplies the bark's albedo; vertex colour retains each species' hue.
      const peak = Math.max(...plant.bark);
      for (let c = 0; c < skin.colours.length; c++) skin.colours[c] = Math.min(1, skin.colours[c]! / peak);
    }
    if (treeCard) {
      material.setBaseColorTexture(doc.createTexture(`${spec.id.split("_")[1]} foliage cutout`).setImage(await foliageTexture(spec.id.split("_")[1]!)).setMimeType("image/png"))
        .setAlphaMode("MASK").setAlphaCutoff(0.32);
    }
    const accessor = (name: string, type: "VEC2" | "VEC3", array: number[]) => doc.createAccessor(`${spec.id}-${role}-${name}`).setBuffer(buffer).setType(type).setArray(new Float32Array(array));
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute("POSITION", accessor("position", "VEC3", skin.positions))
      .setAttribute("NORMAL", accessor("normal", "VEC3", skin.normals))
      .setAttribute("COLOR_0", accessor("colour", "VEC3", skin.colours))
      .setAttribute("TEXCOORD_0", accessor("uv", "VEC2", skin.uvs))
      .setMaterial(material));
  }
  scene.addChild(doc.createNode(spec.id).setMesh(mesh));
  await doc.transform(weld());
  const unpackedBytes = (await io.writeBinary(doc)).byteLength;
  const encodingReference = packAttributes(doc);
  const binary = await io.writeBinary(doc);
  const roundTrip = await io.readBinary(binary);
  const encoding = { ...validateEncoding(roundTrip, encodingReference), unpackedBytes };
  const bounds = getBounds(roundTrip.getRoot().listScenes()[0]!);
  if ([...bounds.min, ...bounds.max].some(v => !Number.isFinite(v))) throw new Error(`${spec.id}: exported bounds invalid`);
  let exportedTriangles = 0;
  for (const exportedMesh of roundTrip.getRoot().listMeshes()) for (const primitive of exportedMesh.listPrimitives()) exportedTriangles += (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")!.getCount()) / 3;
  if (exportedTriangles !== triangles) throw new Error(`${spec.id}: export changed triangle count`);
  const file = `models/corealm/nature/${spec.id}.glb`;
  const destination = path.join(outDir, `${spec.id}.glb`);
  const existing = await readFile(destination).catch(() => null);
  // A deterministic rebuild should not invalidate every open lab and model cache.
  if (!existing || !existing.equals(binary)) pendingWrites.push({ destination, binary });
  const rounded = (v: number) => Number(v.toFixed(4));
  // Conservative horizontal bole envelope at walking height, excluding surface roots.
  let trunkRadius = 0;
  if (spec.kind === "oak" || spec.kind === "pine") {
    const bark = plant.skins.bark.positions;
    for (let i = 0; i < bark.length; i += 3) if (bark[i + 1]! >= .65 && bark[i + 1]! <= 1.1) {
      trunkRadius = Math.max(trunkRadius, Math.hypot(bark[i]!, bark[i + 2]!));
    }
  }
  return {
    id: spec.id, file, pack: "corealm-original-nature", category: "nature", is: spec.description,
    tags: [spec.kind === "oak" ? spec.id.split("_")[1]! : spec.kind, "corealm", "original", "stylized", ...(spec.kind === "oak" || spec.kind === "pine" ? ["tree", "woodland"] : ["dressing"])],
    bytes: binary.byteLength, encoding,
    size: { x: rounded(bounds.max[0] - bounds.min[0]), y: rounded(bounds.max[1] - bounds.min[1]), z: rounded(bounds.max[2] - bounds.min[2]) },
    base: { x: rounded(bounds.min[0]), y: rounded(bounds.min[1]), z: rounded(bounds.min[2]) },
    animations: [], materials: roundTrip.getRoot().listMaterials().map(material => material.getName()),
    sha256: createHash("sha256").update(binary).digest("hex"), triangles, seed: spec.seed,
    ...(trunkRadius > 0 ? { trunkRadius: Math.ceil(trunkRadius * 10000) / 10000 } : {}),
    laminae: plant.leafSprays.length, botanicalSprays: new Set(plant.leafSprays.map(record => record[2])).size,
  };
}

if (!checkOnly) await mkdir(outDir, { recursive: true });
const previous = await readFile(catalogueFile, "utf8").catch(() => "");
const assets = [];
for (const spec of specs) {
  const asset = await exportPlant(spec);
  assets.push(asset);
  console.log(`${asset.id}: ${asset.triangles} triangles, ${(asset.bytes / 1024).toFixed(1)} KiB, ${asset.size.x} × ${asset.size.y} × ${asset.size.z} m`);
}
console.log(JSON.stringify({ assets: assets.length, bytesBeforeEncoding: assets.reduce((sum, asset) => sum + asset.encoding.unpackedBytes, 0), bytesAfterEncoding: assets.reduce((sum, asset) => sum + asset.bytes, 0), maxNormalAngleDegrees: Math.max(...assets.map(asset => asset.encoding.maxNormalAngleDegrees)), maxLinearColourError: Math.max(...assets.map(asset => asset.encoding.maxLinearColourError)), maxBladeUVError: Math.max(...assets.map(asset => asset.encoding.maxBladeUVError)), positionError: 0, groundedIdentityTransforms: true }));
const catalogue = JSON.stringify({
  pack: { id: "corealm-original-nature", name: "Corealm authored nature", author: "Corealm project", source: "tools/build-corealm-nature.ts", license: "Original project geometry; no third-party source assets or textures" },
  generator: { command: "npx tsx tools/build-corealm-nature.ts", version: 21, deterministic: true, coordinateSystem: "+Y up; metres; origin at ground contact under the trunk or plant base" },
  artStatement: "Continuous dominant wood axes with staggered, subordinate laterals and species-specific crown architecture; leader-dominated pines with unequal needle boughs. Eight-triangle alpha sprays overlap along fine growth, not only branch tips. Species differ in crown habit, height, age, texture and branch response. Mature bark scans supply albedo and relief; magic has a crooked bole and dedicated silver-veined foliage.",
  validation: { finiteAttributes: true, unitNormals: true, nonDegenerateTriangles: true, outwardSmoothNormals: true, groundedPivots: true, roundTripBounds: true, triangleBudgets: { ...budgets, ...largeTreeBudgets }, preservedProductionBounds: false, matureOakEnvelopeScale: [2.05, 1.95, 2.05], botanicalSprayProvenance: true, coherentLeafUV: "U across blade, midrib .5, V base 0 to tip 1", barkUV: "U circumference metres, V arc-length metres before small envelope fit" },
  assets,
}, null, 2) + "\n";
// All geometry and export checks passed before any live asset can change.
if (!checkOnly) {
  for (const { destination, binary } of pendingWrites) await writeFile(destination, binary);
  if (previous !== catalogue) await writeFile(catalogueFile, catalogue);
}
console.log(checkOnly ? "Check-only build passed; no live GLBs or catalogue changed." : previous === catalogue ? "Rebuild is byte-for-byte deterministic against the previous catalogue and GLB hashes." : "Catalogue and geometry written. Run again to verify deterministic GLB hashes.");
