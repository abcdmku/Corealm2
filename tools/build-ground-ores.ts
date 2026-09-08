/** Fractured mineral deposits. Stage only: npx tsx tools/build-ground-ores.ts */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { weld } from "@gltf-transform/functions";
import sharp from "sharp";
import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetEntry } from "../game/src/render/assets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = "models/corealm/geology";
const HOST_MATERIAL = "Corealm ground host stone";
const PACK = { id: "corealm-original-ground-ores", name: "Corealm fractured mineral deposits", author: "Corealm",
  source: "tools/build-ground-ores.ts", license: "LicenseRef-Corealm-Original" };
type Point = [number, number, number];
type Spec = { family: string; seed: number; size: Point; host: number; ore: number; pale: number; metalness: number; roughness: number };
export const GROUND_ORE_SPECS: readonly Spec[] = [
  { family: "grithe", seed: 8219, size: [1.55, 0.94, 1.12], host: 0x777b79, ore: 0xa46d35, pale: 0xd4a667, metalness: 0.90, roughness: 0.26 },
  { family: "corven", seed: 8938, size: [1.48, 0.87, 1.15], host: 0x434c55, ore: 0x758f98, pale: 0xa9bdc0, metalness: 0.92, roughness: 0.24 },
  { family: "kaldite", seed: 9657, size: [1.42, 1.02, 1.08], host: 0x434b61, ore: 0x246b81, pale: 0x5d9caa, metalness: 0.88, roughness: 0.28 },
  { family: "emberite", seed: 10376, size: [1.58, 0.89, 1.20], host: 0x393b48, ore: 0x962d22, pale: 0xce6535, metalness: 0.88, roughness: 0.28 },
  { family: "stone", seed: 11095, size: [1.50, 0.82, 1.26], host: 0x919187, ore: 0x95907a, pale: 0xb5af94, metalness: 0.02, roughness: 0.85 },
  { family: "kilnstone", seed: 11815, size: [1.48, 0.91, 1.16], host: 0x9b8574, ore: 0xb29160, pale: 0xd0b580, metalness: 0.02, roughness: 0.84 },
];
export const GROUND_ORE_ASSET_IDS: readonly string[] = GROUND_ORE_SPECS.flatMap(spec => [false, true].map(spent => `corealm_ore_${spec.family}${spent ? "_spent" : ""}`));
export interface GroundOreEntry extends AssetEntry {
  sha256: string; triangles: number; mineralFaces: number;
  presentation: { kind: "ground-boulder"; front: "+Z"; frontZ: number; footprint: Point[]; mineralAreaRatio: number; scarAreaRatio: number };
}
type Corner = { point: THREE.Vector3; uv: THREE.Vector2 };
type Triangle = { corners: [Corner, Corner, Corner]; mineral: boolean };
type BuiltRock = { spec: Spec; spent: boolean; triangles: Triangle[]; footprint: Point[] };
const io = new NodeIO();
const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, value: number): number => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function noise(p: THREE.Vector3, frequency: number, seed: number): number {
  const q = p.clone().multiplyScalar(frequency), ix = Math.floor(q.x), iy = Math.floor(q.y), iz = Math.floor(q.z);
  const t = [q.x - ix, q.y - iy, q.z - iz].map(value => value * value * (3 - 2 * value));
  let result = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    let h = Math.imul(ix + x, 374761393) ^ Math.imul(iy + y, 668265263) ^ Math.imul(iz + z, 2147483647) ^ seed;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    result += (((h ^ h >>> 16) >>> 0) / 2147483647.5 - 1)
      * (x ? t[0]! : 1 - t[0]!) * (y ? t[1]! : 1 - t[1]!) * (z ? t[2]! : 1 - t[2]!);
  }
  return result;
}

function resolve(assetId: string): { spec: Spec; spent: boolean } {
  if (!GROUND_ORE_ASSET_IDS.includes(assetId)) throw new Error(`Unknown ground ore asset: ${assetId}`);
  const spent = assetId.endsWith("_spent"), family = assetId.slice("corealm_ore_".length).replace(/_spent$/, "");
  return { spec: GROUND_ORE_SPECS.find(spec => spec.family === family)!, spent };
}
const interpolate = (a: Corner, b: Corner, t: number): Corner => ({ point: a.point.clone().lerp(b.point, t), uv: a.uv.clone().lerp(b.uv, t) });
const key = (point: THREE.Vector3): string => point.toArray().map(value => value.toFixed(6)).join(",");

/** Interlocking blunt fracture blocks, with broad chipped faces and a shared buried root. */
function fractureBody(spec: Spec): { triangles: Array<[Corner, Corner, Corner]>; footprint: Point[] } {
  const triangles: Array<[Corner, Corner, Corner]> = [];
  const variant = GROUND_ORE_SPECS.indexOf(spec);
  // Each family has a different fracture habit, while retaining the saved resource footprint.
  const habit = [1.0, 0.65, 1.25, 0.85, 0.55, 0.72][variant]!;
  const blocks = [
    [-0.27, 0, -0.16, 1.35, 1.25 * habit, 1.10, -0.16],
    [0.47, 0, -0.12, 0.91, 0.94, 0.89, 0.22],
    [-0.72, 0, 0.20, 0.70, 0.78, 0.83, -0.40],
    [0.03, 0, 0.49, 0.88, 0.63, 0.71, 0.18],
    [0.77, 0, 0.37, 0.60, 0.50, 0.62, -0.23],
    [-0.37, 0, 0.71, 0.48, 0.35, 0.43, 0.45],
  ];
  for (const [block, values] of blocks.entries()) {
    const [cx, cy, cz, width, height, depth, yaw] = values as [number, number, number, number, number, number, number];
    const points: THREE.Vector3[] = [];
    // Unequal fracture planes and chipped shoulders, with a broad buried base.
    // Seed each block independently so neither the crown nor the seam repeats.
    for (const [level, scale] of [[0,0.80],[0.16,1],[0.68,0.94],[1,0.52]]) {
      for (let side = 0; side < 9; side++) {
        const angle = side / 9 * Math.PI * 2;
        const sample = new THREE.Vector3(side * 1.77, block * 2.41, level! * 2.19);
        const jitter = noise(sample, 1, spec.seed) * 0.24;
        const radius = scale! * (0.5 + jitter);
        const px = Math.cos(angle) * radius, pz = Math.sin(angle) * radius;
        const top = level === 0 ? 0 : level! * (1 + noise(sample, 2, spec.seed + 9) * 0.22);
        const point = new THREE.Vector3((px + level! * (block % 2 ? 0.13 : -0.17)) * width,
          top * height, pz * depth);
        point.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw + variant * 0.31).add(new THREE.Vector3(cx, cy, cz));
        points.push(point);
      }
    }
    const coarse = new ConvexGeometry(points), coarsePositions = coarse.getAttribute("position"), bevelPoints: THREE.Vector3[] = [];
    for (let i = 0; i < coarsePositions.count; i += 3) {
      const face = [0,1,2].map(j => new THREE.Vector3().fromBufferAttribute(coarsePositions, i+j));
      const centre = face.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1/3);
      for (const point of face) bevelPoints.push(point.clone().lerp(centre, 0.10));
    }
    coarse.dispose();
    const hull = new ConvexGeometry(bevelPoints), positions = hull.getAttribute("position");
    for (let i = 0; i < positions.count; i += 3) {
      const face = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j));
      const n = face[1]!.clone().sub(face[0]!).cross(face[2]!.clone().sub(face[0]!)).normalize();
      const axis = Math.abs(n.y) > 0.7 ? "y" : Math.abs(n.x) > Math.abs(n.z) ? "x" : "z";
      triangles.push(face.map(point => ({ point, uv: new THREE.Vector2(
        axis === "x" ? point.z : point.x, axis === "y" ? point.z : point.y) })) as [Corner, Corner, Corner]);
    }
    hull.dispose();
  }
  const bounds = new THREE.Box3().setFromPoints(triangles.flatMap(triangle => triangle.map(corner => corner.point)));
  const size = bounds.getSize(new THREE.Vector3()), offset = bounds.getCenter(new THREE.Vector3()); offset.y = bounds.min.y;
  const fit = new THREE.Vector3(...spec.size).divide(size);
  for (const triangle of triangles) for (const corner of triangle) corner.point.sub(offset).multiply(fit);
  const foot = new Map<string, Point>();
  for (const triangle of triangles) for (const { point } of triangle) if (Math.abs(point.y) < 1e-6) foot.set(key(point), point.toArray() as Point);
  return { triangles, footprint: [...foot.values()] };
}

/** Oblique mineral seams and broad breakout pockets remain legible from the gameplay camera. */
function exposure(point: THREE.Vector3, spec: Spec): number {
  if (point.y < 0.10) return -1;
  const p = point.clone().multiplyScalar(1.65);
  const warp = noise(p, 2.8, spec.seed + 419) * 0.31;
  const seam = Math.abs(Math.sin((p.x * 0.54 + p.y * 1.15 + p.z * 0.34 + warp) * 4.2));
  const pocket = noise(p, 3.2, spec.seed + 463);
  return Math.max(0.32 - seam, pocket - 0.30);

}

function makeRock(assetId: string): BuiltRock {
  const { spec, spent } = resolve(assetId), body = fractureBody(spec), triangles: Triangle[] = [];
  const emit = (corners: [Corner, Corner, Corner], mineral: boolean): void => {
    if (corners[1].point.clone().sub(corners[0].point).cross(corners[2].point.clone().sub(corners[0].point)).lengthSq() < 1e-22) return;
    triangles.push({ corners, mineral });
  };
  const add = (corners: [Corner, Corner, Corner]): void => {
    const values = corners.map(corner => { const field = exposure(corner.point, spec); return Math.abs(field) < 0.005 ? 0 : field; });
    if (values.every(value => value === 0)) { emit(corners, false); return; }
    for (const mineral of [false, true]) {
      const polygon: Corner[] = [];
      for (let edge = 0; edge < 3; edge++) {
        const a = corners[edge]!, b = corners[(edge + 1) % 3]!, av = values[edge]!, bv = values[(edge + 1) % 3]!;
        const inside = mineral ? av >= 0 : av <= 0, nextInside = mineral ? bv >= 0 : bv <= 0;
        if (inside) polygon.push(a);
        if (inside !== nextInside) polygon.push(interpolate(a, b, av / (av - bv)));
      }
      for (let i = polygon.length - 1; i >= 0; i--) if (polygon.length > 1 && polygon[i]!.point.distanceToSquared(polygon[(i + 1) % polygon.length]!.point) < 1e-20) polygon.splice(i, 1);
      for (let i = 1; i < polygon.length - 1; i++) emit([polygon[0]!, polygon[i]!, polygon[i + 1]!], mineral);
    }
  };
  const subdivide = (triangle: [Corner, Corner, Corner], depth: number): void => {
    if (!depth) { add(triangle); return; }
    const [a, b, c] = triangle, ab = interpolate(a, b, 0.5), bc = interpolate(b, c, 0.5), ca = interpolate(c, a, 0.5);
    for (const child of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as Array<[Corner, Corner, Corner]>) subdivide(child, depth - 1);
  };
  for (const triangle of body.triangles) subdivide(triangle, 2);
  return { spec, spent, triangles, footprint: body.footprint };
}

function geometry(rock: BuiltRock): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
  for (const triangle of rock.triangles) {
    const triangleUvs = triangle.corners.map(corner => corner.uv);
    const uvArea = Math.abs(triangleUvs[1]!.clone().sub(triangleUvs[0]!).cross(triangleUvs[2]!.clone().sub(triangleUvs[0]!))) * 0.5;
    if (uvArea < 2e-10) {
      // Clipping can leave a subpixel UV sliver at an old atlas boundary. Give
      // that tiny face a valid local island without changing its geometric edge.
      const centre = triangleUvs.reduce((sum, uv) => sum.add(uv), new THREE.Vector2()).multiplyScalar(1 / 3);
      triangleUvs.splice(0, 3, centre.clone(), centre.clone().add(new THREE.Vector2(0.0001, 0)), centre.clone().add(new THREE.Vector2(0, 0.0001)));
    }
    for (const [cornerIndex, corner] of triangle.corners.entries()) {
    const original = corner.point, point = original.clone();
    const edge = Math.pow(Math.max(0, Math.sin((point.x / rock.spec.size[0] + 0.5) * Math.PI)
      * Math.sin(point.y / rock.spec.size[1] * Math.PI) * Math.sin((point.z / rock.spec.size[2] + 0.5) * Math.PI)), 0.5);
    // Small geometric erosion gives the host a chipped surface; the mineral
    // stands proud of its eroded matrix. A zero envelope preserves all bounds.
    const direction = original.clone().sub(new THREE.Vector3(0, rock.spec.size[1] * 0.43, 0)).normalize();
    const weather = (0.022 + (noise(original, 19, rock.spec.seed + 53) + 1) * 0.013)
      * (1 - smooth(-0.03, 0.15, exposure(original, rock.spec)));
    point.addScaledVector(direction, -weather * edge);
    if (rock.spent) point.addScaledVector(original.clone().sub(new THREE.Vector3(0, rock.spec.size[1] * 0.43, 0)).normalize(),
      -smooth(0, 0.19, exposure(original, rock.spec)) * edge * 0.026);
    const color = new THREE.Color(triangle.mineral && !rock.spent ? rock.spec.ore : rock.spec.host);
    if (triangle.mineral && !rock.spent) color.lerp(new THREE.Color(rock.spec.pale), 0.04 + smooth(-0.2, 0.55, noise(original, 12, rock.spec.seed + 541)) * 0.22);
    color.multiplyScalar(0.87 + noise(original, 10.9, rock.spec.seed + 77) * 0.23 + noise(original, 43, rock.spec.seed + 87) * 0.10);
    if (!triangle.mineral) {
      const boundary = 1 - smooth(-0.16, -0.015, -Math.abs(exposure(original, rock.spec)));
      const stain = rock.spec.family === "grithe" ? 0x4c7468 : rock.spec.family === "corven" ? 0x67564b : rock.spec.host;
      color.lerp(new THREE.Color(stain), boundary * 0.35);
      const fracture = Math.abs(Math.sin((original.y * 2.9 + original.x * 0.8 + noise(original, 9, rock.spec.seed)*0.055)*18));
      color.multiplyScalar(0.77 + smooth(0.025, 0.13, fracture)*0.23);
    }
    if (rock.spent && triangle.mineral) color.multiplyScalar(0.91);
    positions.push(...point.toArray()); colors.push(color.r, color.g, color.b); uvs.push(triangleUvs[cornerIndex]!.x, triangleUvs[cornerIndex]!.y);
    }
  }
  const albedoUvs = uvs.map((value, index) => (index % 2 === 0 ? 0.34 : 0.32) + value * 0.10);
  const raw = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    .setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)).setAttribute("uv", new THREE.Float32BufferAttribute(albedoUvs, 2))
    .setAttribute("uv1", new THREE.Float32BufferAttribute(uvs, 2));
  const smoothed = toCreasedNormals(raw, THREE.MathUtils.degToRad(48));
  if (raw !== smoothed) raw.dispose();
  return smoothed;
}

export function buildGroundOreGeometry(assetId: string): THREE.Group {
  const rock = makeRock(assetId), root = new THREE.Group(), mesh = new THREE.Mesh(geometry(rock), new THREE.MeshStandardMaterial({ vertexColors: true }));
  root.name = assetId; mesh.name = "continuous-grounded-host"; mesh.userData.mineralFaces = rock.triangles.map(triangle => triangle.mineral);
  root.add(mesh); return root;
}

let normalMap: Promise<Buffer> | undefined;
/** A periodic microrelief map authored for metre-scaled planar coordinates. */
function stoneNormalMap(): Promise<Buffer> {
  return normalMap ??= (async () => {
    const size = 512, heights = new Float32Array(size * size), pixels = Buffer.alloc(size * size * 3);
    const lattice = (x: number, y: number, period: number): number => {
      let h = Math.imul((x+period)%period, 374761393) ^ Math.imul((y+period)%period, 668265263) ^ 53819;
      h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295;
    };
    const sample = (u: number, v: number, period: number): number => {
      const x = Math.floor(u), y = Math.floor(v), a = u-x, b = v-y;
      const tx=a*a*(3-2*a), ty=b*b*(3-2*b);
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(lattice(x,y,period), lattice(x+1,y,period),tx),
        THREE.MathUtils.lerp(lattice(x,y+1,period),lattice(x+1,y+1,period),tx),ty);
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let height = 0;
      for (let octave = 0; octave < 6; octave++) {
        const f = 8 * 2 ** octave;
        height += sample(x/size*f, y/size*f, f) / (1.65 ** octave);
      }
      heights[y*size+x] = height;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const h = (dx: number, dy: number) => heights[((y+dy+size)%size)*size+(x+dx+size)%size]!;
      const n = new THREE.Vector3((h(-1,0)-h(1,0))*5, (h(0,-1)-h(0,1))*5, 1).normalize();
      const i = (y*size+x)*3; pixels[i] = Math.round((n.x*.5+.5)*255); pixels[i+1] = Math.round((n.y*.5+.5)*255); pixels[i+2] = Math.round((n.z*.5+.5)*255);
    }
    return sharp(pixels, {raw:{width:size,height:size,channels:3}}).png().toBuffer();
  })();
}

export async function buildGroundOreAsset(assetId: string): Promise<{ glb: Uint8Array; entry: GroundOreEntry }> {
  const rock = makeRock(assetId), surface = geometry(rock), doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(assetId), mesh = doc.createMesh(assetId);
  doc.getRoot().setDefaultScene(scene);
  const normalTexture = doc.createTexture("Original granular fracture normals").setImage(await stoneNormalMap()).setMimeType("image/png");
  const host = doc.createMaterial(HOST_MATERIAL).setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0).setRoughnessFactor(0.92).setNormalScale(0.70).setNormalTexture(normalTexture);
  host.getNormalTextureInfo()!.setTexCoord(1).setWrapS(10497).setWrapT(10497);
  const position = surface.getAttribute("position"), normal = surface.getAttribute("normal"), color = surface.getAttribute("color"), uv = surface.getAttribute("uv"), uv1 = surface.getAttribute("uv1");
  let area = 0, mineralArea = 0;
  for (let index = 0; index < rock.triangles.length; index++) {
    const [a, b, c] = [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(position, index * 3 + corner));
    const triangleArea = b!.sub(a!).cross(c!.sub(a!)).length() * 0.5; area += triangleArea; if (rock.triangles[index]!.mineral) mineralArea += triangleArea;
  }
  for (const mineral of [false, true]) {
    const selection = rock.triangles.flatMap((triangle, index) => (triangle.mineral && !rock.spent) === mineral ? [index] : []);
    if (!selection.length) continue;
    const material = mineral ? host.clone().setBaseColorTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setName(`Corealm exposed ${rock.spec.family} mineral`).setRoughnessFactor(rock.spec.roughness).setMetallicFactor(rock.spec.metalness).setNormalScale(0.28) : host;
    const primitive = doc.createPrimitive().setMaterial(material);
    for (const [semantic, attribute, type] of [["POSITION", position, "VEC3"], ["NORMAL", normal, "VEC3"], ["COLOR_0", color, "VEC3"], ["TEXCOORD_0", uv, "VEC2"], ["TEXCOORD_1", uv1, "VEC2"]] as const) {
      const values = selection.flatMap(index => [0, 1, 2].flatMap(corner => Array.from({ length: attribute.itemSize }, (_, axis) => attribute.array[(index * 3 + corner) * attribute.itemSize + axis]!)));
      primitive.setAttribute(semantic, doc.createAccessor(semantic).setType(type).setArray(new Float32Array(values)).setBuffer(buffer));
    }
    mesh.addPrimitive(primitive);
  }
  const usedTextures = new Set(doc.getRoot().listMaterials().flatMap(material => [material.getBaseColorTexture(), material.getNormalTexture(), material.getMetallicRoughnessTexture(), material.getOcclusionTexture()]));
  for (const texture of doc.getRoot().listTextures()) if (!usedTextures.has(texture)) texture.dispose();
  scene.addChild(doc.createNode(assetId).setMesh(mesh)); await doc.transform(weld()); const glb = await io.writeBinary(doc); surface.dispose();
  const [x, y, z] = rock.spec.size;
  return { glb, entry: { id: assetId, file: `${DIRECTORY}/${assetId}.glb`, pack: PACK.id, category: "rock", is: "ore",
    tags: ["ore", "ground-boulder", "geology", rock.spec.family, rock.spent ? "depleted" : "resource"], bytes: glb.byteLength,
    size: { x, y, z }, base: { x: -x / 2, y: 0, z: -z / 2 }, animations: [], materials: doc.getRoot().listMaterials().map(material => material.getName()),
    sha256: createHash("sha256").update(glb).digest("hex"), triangles: rock.triangles.length, mineralFaces: rock.triangles.filter(triangle => triangle.mineral && !rock.spent).length,
    presentation: { kind: "ground-boulder", front: "+Z", frontZ: z / 2, footprint: rock.footprint.map(point => point.map(value => Number(value.toFixed(6))) as Point),
      mineralAreaRatio: rock.spent ? 0 : Number((mineralArea / area).toFixed(6)), scarAreaRatio: rock.spent ? Number((mineralArea / area).toFixed(6)) : 0 } } };
}

export function groundOreOutputPaths(out = "test-results/ground-ores"): { models: string; catalog: string } {
  const target = path.resolve(ROOT, out);
  const allowed = ["test-results", "art/rebuild/candidates/finish-mining"].some(directory => {
    const relative = path.relative(path.resolve(ROOT, directory), target);
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
  });
  if (!out.trim() || !allowed) throw new Error("Ground ore --out must stay inside test-results or art/rebuild/candidates/finish-mining");
  return { models: path.join(target, DIRECTORY), catalog: path.join(target, "ground-ores.json") };
}

export async function buildGroundOres(options: { out?: string; only?: readonly string[] } = {}): Promise<{ entries: GroundOreEntry[]; paths: ReturnType<typeof groundOreOutputPaths> }> {
  const selected = options.only ?? GROUND_ORE_ASSET_IDS;
  if (!selected.length || new Set(selected).size !== selected.length) throw new Error("Ground ore selection must contain distinct asset IDs");
  for (const id of selected) resolve(id);
  const paths = groundOreOutputPaths(options.out), entries: GroundOreEntry[] = [];
  await mkdir(paths.models, { recursive: true });
  for (const id of selected) { const { glb, entry } = await buildGroundOreAsset(id); await writeFile(path.join(paths.models, `${id}.glb`), glb); entries.push(entry);
    console.log(`${id}: ${entry.triangles} triangles, ${(entry.presentation.mineralAreaRatio * 100).toFixed(2)}% exposed mineral`); }
  await writeFile(paths.catalog, `${JSON.stringify({ pack: PACK, generator: "npx tsx tools/build-ground-ores.ts",
    generatorSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    surface: { color: "Authored vertex colors; mineral colors are independent of the host.", normalScale: 0.70, status: "Candidate; requires lab visual acceptance" },
    coordinates: "Metres, Y-up, centred XZ, minimum Y=0. Ordinary ground boulders with closed soil-contact bases. Preferred work approach +Z. No wall mounting plane.",
    construction: "Six independently fractured, weathered rock masses with family-specific proportions and broad oblique mineral seams. Mineral and depleted stone share the same ground footprint and outer bounds.", assets: entries }, null, 2)}\n`);
  return { entries, paths };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2), options: { out?: string; only?: string[] } = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!, value = args[++index]; if (!value?.trim() || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--out") options.out = value; else if (flag === "--only") options.only = value.split(","); else throw new Error(`Unknown ground ore option: ${flag}`);
  }
  await buildGroundOres(options);
}
