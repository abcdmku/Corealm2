/** Stages shrine optimizations without touching production assets or the manifest.
 * Run: npx tsx tools/optimize-model-library.ts
 * Root must inspect staged assets in the production lab before promotion.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, Logger, NodeIO, type Primitive } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, join, prune } from "@gltf-transform/functions";
import sharp from "sharp";
import * as THREE from "three";
import type { AssetManifest } from "../game/src/render/assets.js";
import { assetRoot, inspectModel, sha256 } from "./audit-model-library.js";
import { repoRoot } from "./lib/paths.js";

const OUTPUT = path.join(repoRoot, "runs/local-model-rebuild");
const IDS = ["altar_ruins_site", "altar_ruins_altar"];
// This exact name contract is enforced by the production navigation builder. Do not merge these
// nodes: Recast and camera collision use their individual, named structural meshes.
const STRUCTURAL = /^(?:Arch_|Broken_column|Gate|Platform_circle|Stone_post|Stone_slab|Stone_structure|Wall_)/;
const NORMAL_QUALITY = 98;
const MAX_NORMAL_P95_DEGREES = 3;

type Vertex = { p: number[]; uv: number[]; n: number[] };
type Triangle = [Vertex, Vertex, Vertex];

function worldTriangles(document: Document): Triangle[] {
  const triangles: Triangle[] = [];
  for (const scene of document.getRoot().listScenes()) scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (const primitive of mesh.listPrimitives()) {
      assert.equal(primitive.getMode(), 4, "Only triangle meshes are supported by this optimizer.");
      const positions = primitive.getAttribute("POSITION")!;
      const normals = primitive.getAttribute("NORMAL");
      const uv = primitive.getAttribute("TEXCOORD_0");
      const indices = primitive.getIndices();
      const vertex = (index: number): Vertex => {
        const p = new THREE.Vector3().fromArray(positions.getElement(index, [0, 0, 0])).applyMatrix4(matrix);
        const n = normals ? new THREE.Vector3().fromArray(normals.getElement(index, [0, 0, 0])).applyMatrix3(normalMatrix).normalize() : new THREE.Vector3();
        return { p: p.toArray(), n: n.toArray(), uv: uv?.getElement(index, [0, 0]) ?? [] };
      };
      const count = indices?.getCount() ?? positions.getCount();
      for (let index = 0; index < count; index += 3) triangles.push([
        vertex(indices?.getScalar(index) ?? index), vertex(indices?.getScalar(index + 1) ?? index + 1),
        vertex(indices?.getScalar(index + 2) ?? index + 2),
      ]);
    }
  });
  return triangles;
}

function primitiveRecord(primitive: Primitive): unknown {
  return { mode: primitive.getMode(), indices: Array.from(primitive.getIndices()?.getArray() ?? []),
    attributes: primitive.listSemantics().sort().map((semantic) => {
      const attribute = primitive.getAttribute(semantic)!;
      return { semantic, type: attribute.getType(), normalized: attribute.getNormalized(), values: Array.from(attribute.getArray()!) };
    }) };
}

function collisionRecord(document: Document): string {
  return JSON.stringify(document.getRoot().listNodes().filter((node) => STRUCTURAL.test(node.getName()) && node.getMesh())
    .map((node) => ({ name: node.getName(), matrix: node.getWorldMatrix(), primitives: node.getMesh()!.listPrimitives().map(primitiveRecord) }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

/** Match full triangles, including winding, transformed normals and UVs, after joining dressing.
 * Spatial buckets avoid quadratic comparison and neighboring buckets avoid rounding-boundary errors.
 */
function compareTriangles(before: Triangle[], after: Triangle[]): { triangles: number; maxPositionError: number; maxUvError: number; maxNormalError: number } {
  assert.equal(after.length, before.length, "World-space triangle count changed.");
  const cell = 0.01;
  const centre = (triangle: Triangle): number[] => [0, 1, 2].map((axis) => Math.floor((triangle[0].p[axis]! + triangle[1].p[axis]! + triangle[2].p[axis]!) / 3 / cell));
  const buckets = new Map<string, Triangle[]>();
  for (const triangle of after) {
    const key = centre(triangle).join(",");
    const bucket = buckets.get(key) ?? []; bucket.push(triangle); buckets.set(key, bucket);
  }
  let maxPositionError = 0, maxUvError = 0, maxNormalError = 0;
  for (const triangle of before) {
    const xyz = centre(triangle);
    let matched = false;
    search: for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const bucket = buckets.get(`${xyz[0]! + x},${xyz[1]! + y},${xyz[2]! + z}`);
      if (!bucket) continue;
      for (let index = 0; index < bucket.length; index++) {
        const candidate = bucket[index]!;
        for (let rotation = 0; rotation < 3; rotation++) {
          let positionError = 0, uvError = 0, normalError = 0;
          for (let vertex = 0; vertex < 3; vertex++) {
            const a = triangle[vertex]!, b = candidate[(vertex + rotation) % 3]!;
            positionError = Math.max(positionError, ...a.p.map((value, axis) => Math.abs(value - b.p[axis]!)));
            uvError = Math.max(uvError, ...a.uv.map((value, axis) => Math.abs(value - b.uv[axis]!)));
            normalError = Math.max(normalError, ...a.n.map((value, axis) => Math.abs(value - b.n[axis]!)));
          }
          if (positionError > 0.0001 || uvError > 0.000001 || normalError > 0.00001) continue;
          maxPositionError = Math.max(maxPositionError, positionError); maxUvError = Math.max(maxUvError, uvError);
          maxNormalError = Math.max(maxNormalError, normalError); bucket.splice(index, 1); matched = true;
          break search;
        }
      }
    }
    assert(matched, "Optimized geometry changed a triangle, winding, UV or transformed normal.");
  }
  return { triangles: before.length, maxPositionError, maxUvError, maxNormalError };
}

async function normalError(original: Uint8Array, compressed: Uint8Array): Promise<{ samples: number; p95Degrees: number; maxDegrees: number }> {
  const a = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(compressed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(a.info.width, b.info.width); assert.equal(a.info.height, b.info.height);
  const angles: number[] = [];
  // A fixed spatial sample across the whole texture makes the report reproducible and fast.
  for (let pixel = 0; pixel < a.info.width * a.info.height; pixel += 37) {
    const av = new THREE.Vector3().fromArray([0, 1, 2].map((channel) => a.data[pixel * a.info.channels + channel]! / 127.5 - 1)).normalize();
    const bv = new THREE.Vector3().fromArray([0, 1, 2].map((channel) => b.data[pixel * b.info.channels + channel]! / 127.5 - 1)).normalize();
    angles.push(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(av.dot(bv), -1, 1))));
  }
  angles.sort((a, b) => a - b);
  return { samples: angles.length, p95Degrees: angles[Math.floor(angles.length * 0.95)]!, maxDegrees: angles.at(-1)! };
}

async function main(): Promise<void> {
  assert.equal(process.argv.length, 2, "This bounded optimizer has no production-output or arbitrary-ID flags.");
  const manifest = JSON.parse(await readFile(path.join(assetRoot, "manifest.json"), "utf8")) as AssetManifest;
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  await mkdir(OUTPUT, { recursive: true });
  const results = [];
  for (const id of IDS) {
    const entry = manifest.assets.find((asset) => asset.id === id);
    assert(entry, `Missing ${id}`);
    const source = path.join(assetRoot, entry.file);
    const destination = path.join(OUTPUT, `${id}.glb`);
    const document = await io.read(source);
    document.setLogger(new Logger(Logger.Verbosity.WARN));
    assert.equal(document.getRoot().listAnimations().length, 0, "Animated assets are outside this optimizer's scope.");
    assert.equal(document.getRoot().listSkins().length, 0, "Skinned assets are outside this optimizer's scope.");
    const before = await inspectModel(source);
    const triangles = worldTriangles(document);
    const collision = collisionRecord(document);
    const unchangedTextureHashes = new Set(document.getRoot().listMaterials().flatMap((material) => [material.getBaseColorTexture(), material.getOcclusionTexture()])
      .filter((texture) => texture !== null).map((texture) => sha256(texture.getImage()!)));
    const compressedNormals = [];
    const normalTextures = new Set(document.getRoot().listMaterials().map((material) => material.getNormalTexture()).filter((texture) => texture !== null));
    for (const texture of normalTextures) {
      const original = texture.getImage()!;
      const compressed = await sharp(original).removeAlpha().jpeg({ quality: NORMAL_QUALITY, chromaSubsampling: "4:4:4" }).toBuffer();
      const error = await normalError(original, compressed);
      assert(error.p95Degrees <= MAX_NORMAL_P95_DEGREES, `Normal compression exceeded angular-error budget: ${error.p95Degrees}`);
      if (compressed.length < original.length) { texture.setImage(compressed).setMimeType("image/jpeg"); }
      compressedNormals.push({ sourceBytes: original.length, outputBytes: Math.min(original.length, compressed.length),
        quality: NORMAL_QUALITY, resize: false, chromaSubsampling: "4:4:4", ...error });
    }
    await document.transform(dedup({ keepUniqueNames: false }), join({ filter: (node) => !STRUCTURAL.test(node.getName()), cleanup: false }),
      prune({ keepAttributes: true, keepIndices: true, keepLeaves: true }));
    assert.equal(collisionRecord(document), collision, "Named collision geometry or transforms changed.");
    const geometry = compareTriangles(triangles, worldTriangles(document));
    await io.write(destination, document);
    const readback = await io.read(destination);
    assert.equal(collisionRecord(readback), collision, "GLB serialization changed collision geometry.");
    compareTriangles(triangles, worldTriangles(readback));
    const after = await inspectModel(destination);
    for (const hash of unchangedTextureHashes) assert(after.images.some((image) => image.sha256 === hash), "Base color or AO image changed.");
    assert.equal((await inspectModel(source)).sha256, before.sha256, "Production source was changed.");
    results.push({ id, source: path.relative(repoRoot, source).replaceAll("\\", "/"), stagedFile: path.relative(repoRoot, destination).replaceAll("\\", "/"),
      before, after, bytesSaved: before.bytes - after.bytes, compressedNormals, geometry,
      collision: { unchanged: true, namedStructuralMeshes: document.getRoot().listNodes().filter((node) => STRUCTURAL.test(node.getName()) && node.getMesh()).length,
        fingerprint: sha256(Buffer.from(collision)) },
      promotion: { ...entry, bytes: after.bytes, sha256: after.sha256, materials: readback.getRoot().listMaterials().map((material) => material.getName()) } });
  }
  const report = { schemaVersion: 1, command: "npx tsx tools/optimize-model-library.ts", status: "staged-awaiting-lab-acceptance",
    constraints: ["Production models and manifest unchanged.", "No vertex simplification, UV changes, texture resizing or base-color/AO recompression.",
      "Structural child names, transforms, indices and attributes retained exactly for navigation/collision.",
      "Decorative triangle geometry checked in world space including winding, UVs and transformed normals.",
      "2K normal map JPEG uses 4:4:4 sampling; measured p95 angular error must remain below 3 degrees.",
      "Embedded image duplication across the pair remains. Removing it requires a shared-resource runtime contract and is not hidden by this report."],
    results };
  await writeFile(path.join(OUTPUT, "optimization-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, results: results.map(({ id, before, after, bytesSaved, geometry, collision, compressedNormals }) => ({
    id, beforeBytes: before.bytes, afterBytes: after.bytes, beforePrimitives: before.primitives, afterPrimitives: after.primitives,
    beforeRenderPrimitives: before.renderPrimitives, afterRenderPrimitives: after.renderPrimitives,
    beforeMaterials: before.materials, afterMaterials: after.materials, bytesSaved, geometry, collision, compressedNormals,
  })) }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
