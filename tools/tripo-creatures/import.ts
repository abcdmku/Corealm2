import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { Quaternion, Vector3 } from "three";
import { deformedBounds } from "../creature-motion/validate-deformation.js";
import { duration } from "../creature-motion/pose.js";
import { repairHumanoidWeights, restoreGeometryBasis, retargetHumanoid } from "./retarget.js";

const REQUIRED = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
interface Spec {
  id: string; name: string; source: string; expectedSourceSha256?: string; sourceImageId: string; modelId: string;
  imageReview: { verdict: "approved"; reviewer: string }; heightMeters: number; yawDegrees: number;
  orientationVerified: boolean; requirePbrMaps: boolean; clipAliases?: Record<string, string>; retargetHumanoid?: boolean; repairHumanoidWeights?: boolean;
  geometryReference?: string;
}
interface Batch { output: string; entries: Spec[] }

async function inspect(doc: Document) {
  const root = doc.getRoot(), problems: string[] = [];
  const triangles = root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((count, primitive) => {
    if (primitive.getMode() !== 4) throw new Error("Expected triangle topology");
    return count + (primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")!.getCount()) / 3;
  }, 0), 0);
  const textures = await Promise.all(root.listTextures().map(async texture => {
    const image = texture.getImage(); if (!image) throw new Error("Missing embedded texture");
    const metadata = await sharp(image).metadata();
    return { name: texture.getName(), mimeType: texture.getMimeType(), width: metadata.width, height: metadata.height, bytes: image.length, sha256: hash(image) };
  }));
  const skins = root.listSkins().map(skin => ({ name: skin.getName(), joints: skin.listJoints().map(joint => joint.getName()) }));
  const materialMaps = root.listMaterials().map(material => ({ name: material.getName(),
    baseColor: material.getBaseColorTexture()?.getName() ?? null, normal: material.getNormalTexture()?.getName() ?? null,
    metallicRoughness: material.getMetallicRoughnessTexture()?.getName() ?? null, emissive: material.getEmissiveTexture()?.getName() ?? null }));
  const clips = root.listAnimations().map(clip => ({ name: clip.getName(), seconds: duration(clip), channels: clip.listChannels().length }));
  const weightCoverage = [];
  for (const node of root.listNodes().filter(node => node.getMesh())) {
    const skin = node.getSkin(); if (!skin) { problems.push(`${node.getName()}: no skin`); continue; }
    const joints = skin.listJoints(), inverse = skin.getInverseBindMatrices();
    if (!inverse || inverse.getCount() !== joints.length) problems.push("Inverse-bind count mismatch");
    const coverage = new Map<number, number>(); let count = 0;
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const indices = primitive.getAttribute("JOINTS_0"), weights = primitive.getAttribute("WEIGHTS_0"), positions = primitive.getAttribute("POSITION")!;
      if (!indices || !weights) { problems.push("Missing JOINTS_0/WEIGHTS_0"); continue; }
      count += positions.getCount();
      if (indices.getCount() !== positions.getCount() || weights.getCount() !== positions.getCount()) { problems.push("Skin attribute count mismatch"); continue; }
      for (let vertex = 0; vertex < positions.getCount(); vertex++) {
        const js = indices.getElement(vertex, []), ws = weights.getElement(vertex, []);
        js.forEach((joint, i) => { if (ws[i]! > .05) coverage.set(joint, (coverage.get(joint) ?? 0) + 1); });
        if (js.some(j => !Number.isInteger(j) || j < 0 || j >= joints.length) || ws.some(w => !Number.isFinite(w) || w < 0) ||
          Math.abs(ws.reduce((sum, w) => sum + w, 0) - 1) > .002) { problems.push(`Invalid skin vertex ${vertex}`); break; }
      }
    }
    const dominant = Math.max(0, ...coverage.values()) / Math.max(1, count);
    weightCoverage.push({ mesh: node.getName(), vertices: count, joints: [...coverage].map(([joint, vertices]) => ({ name: joints[joint]!.getName(), vertices })) });
    if (joints.length > 1 && dominant > .98) problems.push(`${Math.round(dominant * 1000) / 10}% of vertices use one joint; exported limb weights are unusable`);
  }
  return { triangles, textures, skins, materialMaps, clips, weightCoverage, bounds: deformedBounds(doc), problems };
}

export async function importCreatures(batch: Batch) {
  const output = path.resolve(batch.output), allowed = path.resolve("assets/art/tripo/imports/creatures");
  if (output !== allowed && !output.startsWith(allowed + path.sep)) throw new Error("Output outside creature import directory");
  if (new Set(batch.entries.map(entry => entry.id)).size !== batch.entries.length) throw new Error("Duplicate creature ID");
  const manifest = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8"));
  const assets: unknown[] = [], files: Record<string, string> = {}, imports: unknown[] = [];
  for (const spec of batch.entries) {
    if (!/^creature_[a-z0-9_]+$/.test(spec.id) || spec.imageReview.verdict !== "approved") throw new Error("Unapproved creature");
    if (!(spec.heightMeters > 0 && Number.isFinite(spec.yawDegrees))) throw new Error("Invalid transform");
    const original = manifest.assets.find((asset: { id: string }) => asset.id === spec.id);
    if (!original) throw new Error(`Root must define asset contract ${spec.id}`);
    const bytes = await readFile(spec.source), sourceHash = hash(bytes);
    if (spec.expectedSourceSha256 && spec.expectedSourceSha256 !== sourceHash) throw new Error(`Changed source ${spec.source}`);
    const sourceFile = `sources/${spec.id}-${sourceHash.slice(0, 12)}.glb`;
    await mkdir(path.join(output, "sources"), { recursive: true });
    await writeFile(path.join(output, sourceFile), bytes);
    const doc = await io.readBinary(bytes), source = await inspect(doc);
    let basisRepair: unknown = null;
    if (spec.geometryReference) {
      const reference = await readFile(spec.geometryReference);
      basisRepair = { ...restoreGeometryBasis(doc, await io.readBinary(reference)), sourceFile: spec.geometryReference, sourceSha256: hash(reference) };
    }
    const weightRepair = spec.repairHumanoidWeights ? repairHumanoidWeights(doc) : null;
    const working = weightRepair ? await inspect(doc) : source, reasons = [...working.problems];
    let retarget: unknown = null;
    if (spec.retargetHumanoid && working.skins.length && !working.problems.length) {
      const file = "game/public/assets/models/animation/animation_library_1.glb", motion = await readFile(file);
      retarget = { ...retargetHumanoid(doc, await io.readBinary(motion)), sourceFile: file, sourceSha256: hash(motion) };
    }
    const bind = deformedBounds(doc);
    if (!source.skins.length) reasons.push("Export omitted skeleton");
    if (!spec.orientationVerified) reasons.push("Facing axis unverified");
    const baseColors = new Set(source.materialMaps.map(material => material.baseColor).filter(Boolean));
    if (!baseColors.size || source.textures.some(texture => baseColors.has(texture.name) && Math.max(texture.width ?? 0, texture.height ?? 0) < 8192)) reasons.push("Missing 8K source base color");
    if (spec.requirePbrMaps && source.materialMaps.some(material => !material.normal || !material.metallicRoughness)) reasons.push("Required PBR maps missing");
    for (const clip of doc.getRoot().listAnimations()) if (spec.clipAliases?.[clip.getName()]) clip.setName(spec.clipAliases[clip.getName()]!);
    for (const name of REQUIRED) {
      const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name);
      if (!clip || !clip.listChannels().length || duration(clip) <= 0) reasons.push(`Missing usable ${name} clip`);
    }
    const record = { id: spec.id, name: spec.name, modelId: spec.modelId, sourceImageId: spec.sourceImageId, sourceFile,
      downloadedFilename: path.basename(spec.source), sourceSha256: sourceHash, sourceBytes: bytes.length,
      imageReview: spec.imageReview, source, basisRepair, weightRepair, retarget, readyForLab: false, reasons, runtime: null as unknown };
    if (!reasons.length) {
      const root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
      if (!scene || root.listScenes().length !== 1) throw new Error("Expected one scene");
      const wrapper = doc.createNode(`corealm_${spec.id}`), scale = spec.heightMeters / (bind.max[1]! - bind.min[1]!);
      for (const child of [...scene.listChildren()]) { scene.removeChild(child); wrapper.addChild(child); } scene.addChild(wrapper);
      wrapper.setScale([scale, scale, scale]).setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.yawDegrees * Math.PI / 180).toArray());
      const bounds = deformedBounds(doc);
      wrapper.setTranslation([-(bounds.min[0]! + bounds.max[0]!) / 2, -bounds.min[1]!, -(bounds.min[2]! + bounds.max[2]!) / 2]);
      for (const texture of root.listTextures()) {
        const image = texture.getImage()!, metadata = await sharp(image).metadata();
        if (Math.max(metadata.width ?? 0, metadata.height ?? 0) <= 2048) continue;
        const resized = sharp(image).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }), jpeg = texture.getMimeType() === "image/jpeg";
        texture.setImage(await (jpeg ? resized.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }) : resized.png()).toBuffer()).setMimeType(jpeg ? "image/jpeg" : "image/png");
      }
      const runtime = await inspect(doc), candidate = await io.writeBinary(doc), file = `models/${spec.id}.glb`;
      await mkdir(path.join(output, "models"), { recursive: true }); await writeFile(path.join(output, file), candidate);
      const vec = (v: number[]) => ({ x: v[0], y: v[1], z: v[2] });
      assets.push({ id: spec.id, file: original.file, pack: "corealm-tripo-creatures", category: "character", is: spec.name,
        tags: ["creature", "tripo"], bytes: candidate.length, sha256: hash(candidate), triangles: runtime.triangles,
        size: vec(runtime.bounds.max.map((v, i) => v - runtime.bounds.min[i]!)), base: vec(runtime.bounds.min), groundY: 0,
        animations: runtime.clips.map(clip => clip.name), materials: runtime.materialMaps.map(material => material.name),
        sourceProvenance: { generator: "Tripo Studio", modelId: spec.modelId, sourceImageId: spec.sourceImageId, sourceFile, sourceSha256: sourceHash, basisRepair, weightRepair, retarget },
        metadata: { runtimeTexturePolicy: { maxDimension: 2048, originalsPreserved: true }, animationAcceptance: "pending-production-lab" },
        acceptance: { exported: true, labAccepted: false, worldIntegrated: false } });
      files[spec.id] = file; record.readyForLab = true; record.runtime = { ...runtime, file, sha256: hash(candidate), bytes: candidate.length, scale };
    }
    imports.push(record);
  }
  const catalog = { assets, files, packs: [{ id: "corealm-tripo-creatures", name: "Tripo generated creature assets", author: "Corealm", source: "https://studio.tripo3d.ai/", license: "LicenseRef-Tripo-Generated" }], imports, visualAccepted: false, promotable: false };
  await writeFile(path.join(output, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n"); return catalog;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: npx tsx tools/tripo-creatures/import.ts batch.json");
  const batch = JSON.parse((await readFile(process.argv[2], "utf8")).replace(/^\uFEFF/, "")), result = await importCreatures(batch);
  console.log(JSON.stringify({ candidates: Object.keys(result.files), imports: result.imports.length, catalog: path.join(batch.output, "catalog.json") }));
}
