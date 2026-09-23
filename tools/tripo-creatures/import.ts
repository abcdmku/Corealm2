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
import { applyGeometryBasisRotation, repairHumanoidWeights, restoreGeometryBasis, retargetHumanoid } from "./retarget.js";

const REQUIRED = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
interface Spec {
  id: string; name: string; source: string; expectedSourceSha256?: string; sourceImageId: string; modelId: string;
  imageReview: { verdict: "approved"; reviewer: string }; heightMeters: number; yawDegrees: number;
  orientationVerified: boolean; requirePbrMaps: boolean; sourceBaseColorMinimumPx?: 2048 | 8192;
  materialProfile?: "bark-lichen"; clipAliases?: Record<string, string>; retargetHumanoid?: boolean; repairHumanoidWeights?: boolean;
  geometryReference?: string; geometryBasisDegrees?: number;
}
interface HeldCandidate { id: string; status: "held-for-source-provenance-audit"; candidateFile: string; sourceFile: string; candidateSha256: string; sourceSha256: string }
interface Batch { output: string; entries: Spec[]; heldCandidates?: HeldCandidate[] }

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

/** Derive a matte bark/lichen material from the authored color atlas without altering that atlas. */
async function applyBarkLichenMaterial(doc: Document) {
  const materials = doc.getRoot().listMaterials();
  if (materials.length !== 1) throw new Error("Bark-lichen profile expects one authored material atlas");
  const material = materials[0]!, baseTexture = material.getBaseColorTexture(), baseInfo = material.getBaseColorTextureInfo();
  if (!baseTexture?.getImage() || !baseInfo) throw new Error("Bark-lichen profile requires an embedded base-color atlas");
  const sourceColorImage = baseTexture.getImage()!, sourceColorMetadata = await sharp(sourceColorImage).metadata();
  const size = 2048, pixelCount = size * size, pixels = await sharp(sourceColorImage).resize(size, size, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha().toColourspace("srgb").raw().toBuffer();
  const gray = Buffer.alloc(size * size);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const ramp = (value: number, low: number, high: number) => {
    const t = clamp((value - low) / (high - low), 0, 1); return t * t * (3 - 2 * t);
  };
  const srgbToLinear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const linearToSrgb = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
  const color = Buffer.alloc(pixels.length), sourceRgb = [0, 0, 0], runtimeRgb = [0, 0, 0];
  let barkWeight = 0, lichenWeight = 0, foliageWeight = 0;
  for (let i = 0; i < size * size; i++) {
    const r = pixels[i * 3]!, g = pixels[i * 3 + 1]!, b = pixels[i * 3 + 2]!;
    gray[i] = Math.round(.2126 * r + .7152 * g + .0722 * b);

    const sr = r / 255, sg = g / 255, sb = b / 255, maximum = Math.max(sr, sg, sb), minimum = Math.min(sr, sg, sb);
    const chroma = maximum - minimum, delta = chroma, luminance = (.2126 * r + .7152 * g + .0722 * b) / 255;
    let hue = 0;
    if (delta > 0) {
      if (maximum === sr) hue = 60 * (((sg - sb) / delta) % 6);
      else if (maximum === sg) hue = 60 * ((sb - sr) / delta + 2);
      else hue = 60 * ((sr - sg) / delta + 4);
      if (hue < 0) hue += 360;
    }
    const saturation = maximum > 0 ? chroma / maximum : 0;
    const foliage = ramp(hue, 42, 62) * (1 - ramp(hue, 155, 190)) * ramp(saturation, .07, .22) * ramp(luminance, .04, .48);
    const lichen = ramp(luminance, .34, .72) * (1 - ramp(chroma, .09, .27)) * (1 - foliage * .85);
    const bark = clamp(1 - foliage - lichen * .85, 0, 1);
    let graded = [sr, sg, sb].map(srgbToLinear).map(channel => channel * 1.20);
    graded[0] = graded[0]! * (1 + .075 * bark); graded[1] = graded[1]! * (1 + .028 * bark); graded[2] = graded[2]! * (1 - .085 * bark);
    graded[0] = graded[0]! * (1 - .025 * foliage); graded[1] = graded[1]! * (1 + .14 * foliage); graded[2] = graded[2]! * (1 + .015 * foliage);
    graded[0] = graded[0]! * (1 - .10 * lichen) + .43 * .10 * lichen;
    graded[1] = graded[1]! * (1 - .10 * lichen) + .39 * .10 * lichen;
    graded[2] = graded[2]! * (1 - .10 * lichen) + .30 * .10 * lichen;
    for (let channel = 0; channel < 3; channel++) {
      sourceRgb[channel] = sourceRgb[channel]! + [sr, sg, sb][channel]!;
      const encoded = clamp(linearToSrgb(clamp(graded[channel]!, 0, 1)), 0, 1);
      runtimeRgb[channel] = runtimeRgb[channel]! + encoded;
      color[i * 3 + channel] = Math.round(encoded * 255);
    }
    barkWeight += bark; lichenWeight += lichen; foliageWeight += foliage;
  }
  const blur = async (sigma: number) => sharp(gray, { raw: { width: size, height: size, channels: 1 } }).blur(sigma).raw().toBuffer();
  const [fine, broad] = await Promise.all([blur(2.2), blur(9)]);
  const height = new Float32Array(size * size), roughness = Buffer.alloc(size * size * 3);
  let roughnessSum = 0, roughnessMin = Infinity, roughnessMax = -Infinity;
  const reliefStrength = 8, maximumSlope = 1.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, r = pixels[i * 3]! / 255, g = pixels[i * 3 + 1]! / 255, b = pixels[i * 3 + 2]! / 255;
    const luminance = gray[i]! / 255, green = ramp(g - (r + b) * .5, .025, .18);
    const light = Math.max(r, g, b), dark = Math.min(r, g, b), paleLichen = ramp(luminance, .43, .76) * (1 - ramp(light - dark, .12, .32));
    const fineRelief = (gray[i]! - fine[i]!) / 255, broadRelief = (gray[i]! - broad[i]!) / 255;
    height[i] = fineRelief * .74 + broadRelief * .26 + green * .012;
    const grain = clamp(Math.abs(fineRelief) * 7, 0, 1);
    const value = clamp(.90 + green * .055 + paleLichen * .025 + grain * .035, .84, .99);
    const encoded = Math.round(value * 255);
    roughness[i * 3] = 255; roughness[i * 3 + 1] = encoded; roughness[i * 3 + 2] = 0;
    roughnessSum += value; roughnessMin = Math.min(roughnessMin, value); roughnessMax = Math.max(roughnessMax, value);
  }
  const normal = Buffer.alloc(size * size * 3); let slopeSum = 0, slopeMax = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, left = y * size + Math.max(0, x - 1), right = y * size + Math.min(size - 1, x + 1),
      up = Math.max(0, y - 1) * size + x, down = Math.min(size - 1, y + 1) * size + x;
    const dx = (height[right]! - height[left]!) * .5, dy = (height[down]! - height[up]!) * .5;
    let nx = -dx * reliefStrength, ny = -dy * reliefStrength, slope = Math.hypot(nx, ny);
    if (slope > maximumSlope) { nx *= maximumSlope / slope; ny *= maximumSlope / slope; slope = maximumSlope; }
    const inverseLength = 1 / Math.sqrt(1 + slope * slope);
    slopeSum += slope; slopeMax = Math.max(slopeMax, slope);
    normal[i * 3] = Math.round((nx * inverseLength * .5 + .5) * 255);
    normal[i * 3 + 1] = Math.round((ny * inverseLength * .5 + .5) * 255);
    normal[i * 3 + 2] = Math.round((inverseLength * .5 + .5) * 255);
  }
  const normalImage = await sharp(normal, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  const roughnessImage = await sharp(roughness, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  const baseColorImage = await sharp(color, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
  const runtimePixels = await sharp(baseColorImage).removeAlpha().toColourspace("srgb").raw().toBuffer();
  runtimeRgb.fill(0);
  for (let i = 0; i < pixelCount; i++) for (let channel = 0; channel < 3; channel++) runtimeRgb[channel] = runtimeRgb[channel]! + runtimePixels[i * 3 + channel]! / 255;
  baseTexture.setImage(baseColorImage).setMimeType("image/jpeg");
  const normalTexture = doc.createTexture("Bramble layered bark and lichen relief normals").setImage(normalImage).setMimeType("image/png");
  const roughnessTexture = doc.createTexture("Bramble matte bark, moss and lichen roughness").setImage(roughnessImage).setMimeType("image/png");
  material.setMetallicFactor(0).setRoughnessFactor(1).setEmissiveFactor([0, 0, 0]).setNormalScale(.45).setNormalTexture(normalTexture)
    .setMetallicRoughnessTexture(roughnessTexture);
  for (const info of [material.getNormalTextureInfo()!, material.getMetallicRoughnessTextureInfo()!]) {
    info.setTexCoord(baseInfo.getTexCoord()).setWrapS(baseInfo.getWrapS()).setWrapT(baseInfo.getWrapT());
  }
  const mean = (values: number[]) => values.map(value => Number((value / pixelCount).toFixed(4)));
  return { profile: "bark-lichen", baseColorTexture: baseTexture.getName(), sourceBaseColorUnmodified: true,
    sourceBaseColor: { width: sourceColorMetadata.width, height: sourceColorMetadata.height, bytes: sourceColorImage.length, sha256: hash(sourceColorImage) },
    runtimeBaseColor: { width: size, height: size, mimeType: "image/jpeg", bytes: baseColorImage.length, sha256: hash(baseColorImage),
      sourceMeanSrgb: mean(sourceRgb), runtimeMeanSrgb: mean(runtimeRgb) },
    colorGrade: { method: "Per-texel linear-light exposure lift with a warm residual bark grade, selective green foliage lift, and a restrained cream lift on pale lichen; no spatial filtering",
      maskWeights: { bark: Number((barkWeight / pixelCount).toFixed(4)), paleLichen: Number((lichenWeight / pixelCount).toFixed(4)), foliage: Number((foliageWeight / pixelCount).toFixed(4)) } },
    width: size, height: size,
    metallicFactor: 0, roughnessFactor: 1, normalScale: .45, relief: "Tangent-space normals from fine and broad high-pass luminance plus shallow green-moss relief, capped at a 1.2 tangent slope",
    roughness: { channel: "G", range: [Number(roughnessMin.toFixed(4)), Number(roughnessMax.toFixed(4))], mean: Number((roughnessSum / (size * size)).toFixed(4)),
      regions: "matte bark with slightly rougher green moss and pale lichen; local grain variation from the source atlas" },
    metallic: { channel: "B", value: 0 },
    normalMap: { name: normalTexture.getName(), sha256: hash(normalImage), bytes: normalImage.length, meanSlope: Number((slopeSum / (size * size)).toFixed(4)), maxSlope: Number(slopeMax.toFixed(4)) },
    roughnessMap: { name: roughnessTexture.getName(), sha256: hash(roughnessImage), bytes: roughnessImage.length } };
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
    if (spec.sourceBaseColorMinimumPx !== undefined && spec.sourceBaseColorMinimumPx !== 2048 && spec.sourceBaseColorMinimumPx !== 8192) throw new Error("Unsupported source base-color minimum");
    const original = manifest.assets.find((asset: { id: string }) => asset.id === spec.id);
    if (!original) throw new Error(`Root must define asset contract ${spec.id}`);
    const bytes = await readFile(spec.source), sourceHash = hash(bytes);
    if (spec.expectedSourceSha256 && spec.expectedSourceSha256 !== sourceHash) throw new Error(`Changed source ${spec.source}`);
    const sourceFile = `sources/${spec.id}-${sourceHash.slice(0, 12)}.glb`;
    await mkdir(path.join(output, "sources"), { recursive: true });
    await writeFile(path.join(output, sourceFile), bytes);
    const doc = await io.readBinary(bytes), source = await inspect(doc);
    let basisRepair: unknown = null;
    if (spec.geometryReference && spec.geometryBasisDegrees !== undefined) throw new Error(`Choose one geometry basis repair for ${spec.id}`);
    if (spec.geometryReference) {
      const reference = await readFile(spec.geometryReference);
      basisRepair = { ...restoreGeometryBasis(doc, await io.readBinary(reference)), sourceFile: spec.geometryReference, sourceSha256: hash(reference) };
    }
    if (spec.geometryBasisDegrees !== undefined) basisRepair = applyGeometryBasisRotation(doc, spec.geometryBasisDegrees);
    const materialTreatment = spec.materialProfile === "bark-lichen" ? await applyBarkLichenMaterial(doc) : null;
    const weightRepair = spec.repairHumanoidWeights ? repairHumanoidWeights(doc) : null;
    const working = weightRepair || materialTreatment ? await inspect(doc) : source, reasons = [...working.problems];
    let retarget: unknown = null;
    if (spec.retargetHumanoid && working.skins.length && !working.problems.length) {
      const file = "game/public/assets/models/animation/animation_library_1.glb", motion = await readFile(file);
      retarget = { ...retargetHumanoid(doc, await io.readBinary(motion)), sourceFile: file, sourceSha256: hash(motion) };
    }
    const bind = deformedBounds(doc);
    if (!source.skins.length) reasons.push("Export omitted skeleton");
    if (!spec.orientationVerified) reasons.push("Facing axis unverified");
    const baseColors = new Set(source.materialMaps.map(material => material.baseColor).filter(Boolean));
    const sourceBaseColorMinimumPx = spec.sourceBaseColorMinimumPx ?? 8192;
    if (!baseColors.size || source.textures.some(texture => baseColors.has(texture.name)
      && ((texture.width ?? 0) < sourceBaseColorMinimumPx || (texture.height ?? 0) < sourceBaseColorMinimumPx))) {
      reasons.push(`Missing ${sourceBaseColorMinimumPx / 1024}K source base color`);
    }
    if (spec.requirePbrMaps && working.materialMaps.some(material => !material.normal || !material.metallicRoughness)) reasons.push("Required PBR maps missing");
    for (const clip of doc.getRoot().listAnimations()) if (spec.clipAliases?.[clip.getName()]) clip.setName(spec.clipAliases[clip.getName()]!);
    for (const name of REQUIRED) {
      const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name);
      if (!clip || !clip.listChannels().length || duration(clip) <= 0) reasons.push(`Missing usable ${name} clip`);
    }
    const record = { id: spec.id, name: spec.name, modelId: spec.modelId, sourceImageId: spec.sourceImageId, sourceFile,
      downloadedFilename: path.basename(spec.source), sourceSha256: sourceHash, sourceBytes: bytes.length,
      imageReview: spec.imageReview, sourceBaseColorMinimumPx, source, basisRepair, materialTreatment, weightRepair, retarget, readyForLab: false, reasons, runtime: null as unknown };
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
        sourceProvenance: { generator: "Tripo Studio", modelId: spec.modelId, sourceImageId: spec.sourceImageId, sourceFile, sourceSha256: sourceHash, basisRepair, materialTreatment, weightRepair, retarget },
        metadata: { runtimeTexturePolicy: { maxDimension: 2048, originalsPreserved: true }, materialTreatment, animationAcceptance: "pending-production-lab" },
        acceptance: { exported: true, labAccepted: false, worldIntegrated: false } });
      files[spec.id] = file; record.readyForLab = true; record.runtime = { ...runtime, file, sha256: hash(candidate), bytes: candidate.length, scale };
    }
    imports.push(record);
  }
  const heldCandidates = batch.heldCandidates ?? [];
  for (const held of heldCandidates) {
    if (!/^creature_[a-z0-9_]+$/.test(held.id) || held.status !== "held-for-source-provenance-audit" ||
      !/^[a-f0-9]{64}$/.test(held.candidateSha256) || !/^[a-f0-9]{64}$/.test(held.sourceSha256)) {
      throw new Error(`Invalid held candidate record ${held.id}`);
    }
  }
  const catalog = { assets, files, packs: [{ id: "corealm-tripo-creatures", name: "Tripo generated creature assets", author: "Corealm", source: "https://studio.tripo3d.ai/", license: "LicenseRef-Tripo-Generated" }], imports, heldCandidates, visualAccepted: false, promotable: false };
  await writeFile(path.join(output, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n"); return catalog;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: npx tsx tools/tripo-creatures/import.ts batch.json");
  const batch = JSON.parse((await readFile(process.argv[2], "utf8")).replace(/^\uFEFF/, "")), result = await importCreatures(batch);
  console.log(JSON.stringify({ candidates: Object.keys(result.files), imports: result.imports.length, catalog: path.join(batch.output, "catalog.json") }));
}
