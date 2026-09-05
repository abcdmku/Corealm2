/** Ordinary mineral-bearing boulders. Stage only: npx tsx tools/build-ground-ores.ts */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO, type Material } from "@gltf-transform/core";
import { copyToDocument, weld } from "@gltf-transform/functions";
import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { AssetEntry } from "../game/src/render/assets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = "models/corealm/geology";
const REFERENCE_FILE = "game/public/assets/models/magic/rocks_free_essence_node.glb";
const MUTED_ALBEDO = "tools/data/ground-ore-muted-albedo.png";
const HOST_MATERIAL = "Corealm ground host stone";
const PACK = { id: "corealm-original-ground-ores", name: "Corealm mineral-bearing ground boulders", author: "Corealm; rock foundation by DEXSOFT",
  source: "tools/build-ground-ores.ts", license: "Derivative geometry and material maps from the project's DEXSOFT Rocks FREE pack asset, under its existing Standard Unity Asset Store EULA. Corealm mineral coloring and presentation are project-authored." };
type Point = [number, number, number];
type Spec = { family: string; seed: number; size: Point; host: number; ore: number; pale: number; metalness: number; roughness: number };
export const GROUND_ORE_SPECS: readonly Spec[] = [
  { family: "grithe", seed: 8219, size: [2.6, 1.80, 1.85], host: 0xe9e7e0, ore: 0xa38466, pale: 0xb6a184, metalness: 0.16, roughness: 0.72 },
  { family: "corven", seed: 8938, size: [2.6, 1.85, 1.95], host: 0xbabcb2, ore: 0x8e8372, pale: 0xb1ab9a, metalness: 0.13, roughness: 0.77 },
  { family: "kaldite", seed: 9657, size: [2.6, 1.95, 1.75], host: 0xbac0b8, ore: 0x7a8f9b, pale: 0xa0aeb1, metalness: 0.14, roughness: 0.75 },
  { family: "emberite", seed: 10376, size: [2.6, 1.75, 2.05], host: 0xbdbbb1, ore: 0x8a8b94, pale: 0xada8b0, metalness: 0.18, roughness: 0.70 },
  { family: "stone", seed: 11095, size: [2.6, 1.70, 2.20], host: 0xc4c2b6, ore: 0xaaa995, pale: 0xc0bba6, metalness: 0.02, roughness: 0.85 },
  { family: "kilnstone", seed: 11814, size: [2.6, 1.80, 1.90], host: 0xb9b8ab, ore: 0xa4977f, pale: 0xb8ad97, metalness: 0.02, roughness: 0.84 },
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
const reference = await io.read(path.join(ROOT, REFERENCE_FILE));
const referenceMaterial = reference.getRoot().listMaterials()[0]!;
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

/** Start from the referenced rock, soften small lobes, and fill its deepest clefts. */
function referenceBody(spec: Spec): { triangles: Array<[Corner, Corner, Corner]>; footprint: Point[] } {
  const positions: THREE.Vector3[] = [], vertices = new Map<string, number>(), faces: Array<{ ids: [number, number, number]; uvs: THREE.Vector2[] }> = [];
  for (const node of reference.getRoot().listNodes()) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const source = primitive.getAttribute("POSITION")!, uv = primitive.getAttribute("TEXCOORD_0")!, indices = primitive.getIndices();
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (let offset = 0; offset < (indices?.getCount() ?? source.getCount()); offset += 3) {
      const ids: number[] = [], uvs: THREE.Vector2[] = [];
      for (let corner = 0; corner < 3; corner++) {
        const index = indices?.getScalar(offset + corner) ?? offset + corner;
        const point = new THREE.Vector3().fromArray(source.getElement(index, [])).applyMatrix4(matrix), idKey = key(point);
        let id = vertices.get(idKey); if (id === undefined) { id = positions.length; positions.push(point); vertices.set(idKey, id); }
        ids.push(id); uvs.push(new THREE.Vector2().fromArray(uv.getElement(index, [])));
      }
      faces.push({ ids: ids as [number, number, number], uvs });
    }
  }
  const neighbours = positions.map(() => new Set<number>());
  for (const { ids } of faces) for (let edge = 0; edge < 3; edge++) {
    const a = ids[edge]!, b = ids[(edge + 1) % 3]!; neighbours[a]!.add(b); neighbours[b]!.add(a);
  }
  let softened = positions.map(point => point.clone());
  for (let pass = 0; pass < 8; pass++) softened = softened.map((point, index) => {
    const average = new THREE.Vector3(); for (const neighbour of neighbours[index]!) average.add(softened[neighbour]!);
    return point.clone().lerp(average.multiplyScalar(1 / neighbours[index]!.size), 0.28);
  });
  const bounds = new THREE.Box3().setFromPoints(softened), centre = bounds.getCenter(new THREE.Vector3());
  const hull = new ConvexGeometry(softened), hullPoints = hull.getAttribute("position"), planes: THREE.Plane[] = [];
  for (let offset = 0; offset < hullPoints.count; offset += 3) planes.push(new THREE.Plane().setFromCoplanarPoints(
    new THREE.Vector3().fromBufferAttribute(hullPoints, offset), new THREE.Vector3().fromBufferAttribute(hullPoints, offset + 1), new THREE.Vector3().fromBufferAttribute(hullPoints, offset + 2)));
  const variant = GROUND_ORE_SPECS.indexOf(spec), rotation = new THREE.Matrix4().makeRotationY(0.46 + variant * 0.63)
    .multiply(new THREE.Matrix4().makeRotationX(0.09 + Math.sin(variant * 1.9) * 0.11));
  const body = softened.map(point => {
    const direction = point.clone().sub(centre).normalize();
    let limit = Infinity;
    for (const plane of planes) { const denominator = plane.normal.dot(direction); if (denominator > 1e-8) limit = Math.min(limit, -plane.distanceToPoint(centre) / denominator); }
    const convex = centre.clone().addScaledVector(direction, limit);
    return point.clone().lerp(convex, 0.76).sub(centre).applyMatrix4(rotation);
  });
  hull.dispose();
  const bodyBounds = new THREE.Box3().setFromPoints(body), cutY = bodyBounds.min.y + bodyBounds.getSize(new THREE.Vector3()).y * 0.17;
  const triangles: Array<[Corner, Corner, Corner]> = [], cutSegments: Array<[THREE.Vector3, THREE.Vector3]> = [];
  for (const face of faces) {
    const source = face.ids.map((id, index) => ({ point: body[id]!, uv: face.uvs[index]! })), polygon: Corner[] = [], cut: THREE.Vector3[] = [];
    for (let edge = 0; edge < 3; edge++) {
      const a = source[edge]!, b = source[(edge + 1) % 3]!, da = a.point.y - cutY, db = b.point.y - cutY;
      if (da >= 0) polygon.push(a);
      if ((da >= 0) !== (db >= 0)) { const crossing = interpolate(a, b, da / (da - db)); crossing.point.y = cutY; polygon.push(crossing); cut.push(crossing.point); }
    }
    for (let edge = 1; edge < polygon.length - 1; edge++) triangles.push([polygon[0]!, polygon[edge]!, polygon[edge + 1]!]);
    if (cut.length === 2) cutSegments.push(cut as [THREE.Vector3, THREE.Vector3]);
  }
  const links = new Map<string, string[]>(), cutPoints = new Map<string, THREE.Vector3>();
  for (const segment of cutSegments) {
    const [a, b] = segment.map(key) as [string, string];
    cutPoints.set(a, segment[0]); cutPoints.set(b, segment[1]);
    for (const [start, end] of [[a, b], [b, a]]) { const next = links.get(start!) ?? []; if (!next.includes(end!)) next.push(end!); links.set(start!, next); }
  }
  const remaining = new Set(links.keys()), foot: THREE.Vector3[] = [];
  while (remaining.size) {
    const start = remaining.values().next().value!, outline: THREE.Vector3[] = [];
    let current = start, previous = "";
    do {
      outline.push(cutPoints.get(current)!); remaining.delete(current);
      const next = links.get(current)?.find(candidate => candidate !== previous);
      if (!next) throw new Error("Reference rock ground cut is not a closed contour");
      previous = current; current = next;
    } while (current !== start && outline.length <= links.size);
    const contour = outline.map(point => new THREE.Vector2(point.x, point.z));
    const caps = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const indices of caps) {
      const points = indices.map(index => outline[index]!.clone()) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      if (points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).y > 0) [points[1], points[2]] = [points[2], points[1]];
      triangles.push(points.map(point => ({ point, uv: new THREE.Vector2(0.13 + point.x * 0.03, 0.24 + point.z * 0.03) })) as [Corner, Corner, Corner]);
    }
    foot.push(...outline);
  }
  const fitBounds = new THREE.Box3().setFromPoints(triangles.flatMap(triangle => triangle.map(corner => corner.point))), size = fitBounds.getSize(new THREE.Vector3());
  const offset = new THREE.Vector3((fitBounds.min.x + fitBounds.max.x) * 0.5, cutY, (fitBounds.min.z + fitBounds.max.z) * 0.5);
  const scale = new THREE.Vector3(...spec.size).divide(size);
  const fit = (point: THREE.Vector3): THREE.Vector3 => point.clone().sub(offset).multiply(scale);
  return { triangles: triangles.map(triangle => triangle.map(corner => ({ point: fit(corner.point), uv: corner.uv.clone() })) as [Corner, Corner, Corner]),
    footprint: foot.map(point => fit(point).toArray() as Point) };
}

/** An isotropic field forms small, scattered flecks, with no seam or band direction. */
function exposure(point: THREE.Vector3, spec: Spec): number {
  if (point.y < 0.10) return -1;
  return noise(point, 8.4, spec.seed + 419) * 0.72 + noise(point, 17.6, spec.seed + 463) * 0.28 - 0.43;
}

function makeRock(assetId: string): BuiltRock {
  const { spec, spent } = resolve(assetId), body = referenceBody(spec), triangles: Triangle[] = [];
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
  for (const [a, b, c] of body.triangles) {
    const ab = interpolate(a, b, 0.5), bc = interpolate(b, c, 0.5), ca = interpolate(c, a, 0.5);
    for (const triangle of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as Array<[Corner, Corner, Corner]>) add(triangle);
  }
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
    if (rock.spent) point.addScaledVector(original.clone().sub(new THREE.Vector3(0, rock.spec.size[1] * 0.43, 0)).normalize(),
      -smooth(0, 0.19, exposure(original, rock.spec)) * edge * 0.026);
    const color = new THREE.Color(triangle.mineral && !rock.spent ? rock.spec.ore : rock.spec.host);
    if (triangle.mineral && !rock.spent) color.lerp(new THREE.Color(rock.spec.pale), 0.25 + noise(original, 16, rock.spec.seed + 541) * 0.20);
    color.multiplyScalar(0.97 + noise(original, 2.9, rock.spec.seed + 77) * 0.035);
    if (rock.spent && triangle.mineral) color.multiplyScalar(0.91);
    positions.push(...point.toArray()); colors.push(color.r, color.g, color.b); uvs.push(triangleUvs[cornerIndex]!.x, triangleUvs[cornerIndex]!.y);
    }
  }
  const albedoUvs = uvs.map((value, index) => (index % 2 === 0 ? 0.34 : 0.32) + value * 0.10);
  const raw = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    .setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)).setAttribute("uv", new THREE.Float32BufferAttribute(albedoUvs, 2))
    .setAttribute("uv1", new THREE.Float32BufferAttribute(uvs, 2));
  const smoothed = toCreasedNormals(raw, THREE.MathUtils.degToRad(68));
  if (raw !== smoothed) raw.dispose();
  return smoothed;
}

export function buildGroundOreGeometry(assetId: string): THREE.Group {
  const rock = makeRock(assetId), root = new THREE.Group(), mesh = new THREE.Mesh(geometry(rock), new THREE.MeshStandardMaterial({ vertexColors: true }));
  root.name = assetId; mesh.name = "continuous-grounded-host"; mesh.userData.mineralFaces = rock.triangles.map(triangle => triangle.mineral);
  root.add(mesh); return root;
}

export async function buildGroundOreAsset(assetId: string): Promise<{ glb: Uint8Array; entry: GroundOreEntry }> {
  const rock = makeRock(assetId), surface = geometry(rock), doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(assetId), mesh = doc.createMesh(assetId);
  doc.getRoot().setDefaultScene(scene);
  const host = (copyToDocument(doc, reference, [referenceMaterial]).get(referenceMaterial) as Material)
    .setName(HOST_MATERIAL).setMetallicFactor(0).setRoughnessFactor(0.92).setNormalScale(0.16).setEmissiveFactor([0, 0, 0]);
  host.setBaseColorTexture(doc.createTexture("Corealm muted stone albedo").setImage(await readFile(path.join(ROOT, MUTED_ALBEDO))).setMimeType("image/png"));
  host.getNormalTextureInfo()?.setTexCoord(1); host.getMetallicRoughnessTextureInfo()?.setTexCoord(1); host.getOcclusionTextureInfo()?.setTexCoord(1);
  const position = surface.getAttribute("position"), normal = surface.getAttribute("normal"), color = surface.getAttribute("color"), uv = surface.getAttribute("uv"), uv1 = surface.getAttribute("uv1");
  let area = 0, mineralArea = 0;
  for (let index = 0; index < rock.triangles.length; index++) {
    const [a, b, c] = [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(position, index * 3 + corner));
    const triangleArea = b!.sub(a!).cross(c!.sub(a!)).length() * 0.5; area += triangleArea; if (rock.triangles[index]!.mineral) mineralArea += triangleArea;
  }
  for (const mineral of [false, true]) {
    const selection = rock.triangles.flatMap((triangle, index) => (triangle.mineral && !rock.spent) === mineral ? [index] : []);
    if (!selection.length) continue;
    const material = mineral ? host.clone().setName(`Corealm exposed ${rock.spec.family} mineral`).setRoughnessFactor(rock.spec.roughness).setMetallicFactor(rock.spec.metalness) : host;
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
  const staging = path.resolve(ROOT, "test-results"), target = path.resolve(ROOT, out), relative = path.relative(staging, target);
  if (!out.trim() || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Ground ore --out must stay inside test-results");
  return { models: path.join(target, DIRECTORY), catalog: path.join(target, "ground-ores.json") };
}

export async function buildGroundOres(options: { out?: string; only?: readonly string[] } = {}): Promise<{ entries: GroundOreEntry[]; paths: ReturnType<typeof groundOreOutputPaths> }> {
  const selected = options.only ?? GROUND_ORE_ASSET_IDS;
  if (!selected.length || new Set(selected).size !== selected.length) throw new Error("Ground ore selection must contain distinct asset IDs");
  for (const id of selected) resolve(id);
  const paths = groundOreOutputPaths(options.out), entries: GroundOreEntry[] = [];
  await mkdir(paths.models, { recursive: true });
  for (const id of selected) { const { glb, entry } = await buildGroundOreAsset(id); await writeFile(path.join(paths.models, `${id}.glb`), glb); entries.push(entry);
    console.log(`${id}: ${entry.triangles} triangles, ${(entry.presentation.mineralAreaRatio * 100).toFixed(2)}% mineral flecks`); }
  await writeFile(paths.catalog, `${JSON.stringify({ pack: PACK, generator: "npx tsx tools/build-ground-ores.ts",
    generatorSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    reference: { assetId: "rocks_free_essence_node", file: REFERENCE_FILE, pack: "dexsoft-rocks-free", author: "DEXSOFT",
      sha256: createHash("sha256").update(await readFile(path.join(ROOT, REFERENCE_FILE))).digest("hex"),
      license: "Standard Unity Asset Store EULA; existing project asset license retained", changes: "Native rock geometry softened and its deepest clefts partially filled, cut to a broad soil contact, fitted to ore dimensions. Original UVs retained for reduced-strength normal and roughness maps; quieter generated albedo uses a safe interior patch. No runtime essence shader, crystals or emission." },
    albedo: { file: MUTED_ALBEDO, provenance: "tools/data/ground-ore-muted-albedo.json", sha256: createHash("sha256").update(await readFile(path.join(ROOT, MUTED_ALBEDO))).digest("hex"), normalScale: 0.16, status: "copper candidate pending visual acceptance" },
    coordinates: "Metres, Y-up, centred XZ, minimum Y=0. Ordinary ground boulders with closed soil-contact bases. Preferred work approach +Z. No wall mounting plane.",
    construction: "Ordinary asymmetric full rocks derived from the local essence-rock reference with less surface activity. Restrained isotropic mineral flecks replace horizontal bands and sculpted shelves. Mineral and depleted stone share the same ground footprint and outer bounds.", assets: entries }, null, 2)}\n`);
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
