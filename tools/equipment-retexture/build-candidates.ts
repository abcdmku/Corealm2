/** Retexture the existing manifest-selected geometry, without publishing it.
 * Run with --inventory-only first, then --config art/equipment-retexture/texture-map.json.
 * Config: {schemaVersion:1,replacements:[{assetId?,material?,sourceTexture?,png,baseColorFactor?}]}.
 * Selectors are exact, combined with AND; PNG paths are relative to the config file.
 * Omit assetId to share one Knight atlas. Multiple matches are an error.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO, type Document, type JSONDocument } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import { GEAR_APPEARANCE_IDS, gearAppearanceParts } from "../../game/src/render/equipmentVisuals.js";

interface Replacement { assetId?: string; material?: string; sourceTexture?: string; png: string; baseColorFactor?: [number, number, number, number] }
interface Config { schemaVersion: 1; replacements: Replacement[] }
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
/** Keep every non-JSON chunk byte-for-byte, including the complete original BIN. */
function parseGLB(bytes: Buffer) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("Expected a valid GLB 2 JSON chunk");
  const end = 20 + bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, end).toString("utf8")), tail: bytes.subarray(end) };
}
function amendGLB(json: any, tail: Buffer) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(jsonBytes);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBytes.length + tail.length, 8);
  header.writeUInt32LE(jsonBytes.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, jsonBytes, tail]);
}
function unchangedJSON(json: any, original: any) {
  const copy = structuredClone(json);
  // Only appended image/texture entries and material base colors may differ.
  for (const key of ["images", "textures"]) {
    if (original[key]) copy[key] = (copy[key] ?? []).slice(0, original[key].length);
    else delete copy[key];
  }
  for (let i = 0; i < (copy.materials ?? []).length; i++) {
    const pbr = copy.materials[i].pbrMetallicRoughness;
    const prior = original.materials[i].pbrMetallicRoughness;
    if (pbr) {
      for (const key of ["baseColorTexture", "baseColorFactor"]) {
        if (prior && key in prior) pbr[key] = prior[key]; else delete pbr[key];
      }
      if (!prior && Object.keys(pbr).length === 0) delete copy.materials[i].pbrMetallicRoughness;
    }
  }
  return hash(JSON.stringify(copy));
}
const root = path.resolve("art/equipment-retexture");
const output = path.join(root, "candidates");
const verifyOnly = process.argv.includes("--verify-only");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifestBytes = await readFile("game/public/assets/manifest.json");
const manifest = JSON.parse(manifestBytes.toString());
const wanted = new Set<string>();
for (const body of ["male", "female"] as const) for (const id of GEAR_APPEARANCE_IDS) {
  for (const part of gearAppearanceParts(id, body)) {
    if (part.slot === "mainHand" || part.slot === "offHand" || /^outfit_(male|female)_knight_/.test(part.assetId)) wanted.add(part.assetId);
  }
}

/** All accessor bytes cover positions, UVs, weights, bind matrices and animation keys.
 * Structural JSON covers hierarchy, transforms, primitive connectivity and animation targets.
 */
async function protectedState(doc: Document) {
  const { json } = await io.writeJSON(doc);
  const structure = JSON.parse(JSON.stringify(json));
  delete structure.materials; delete structure.textures; delete structure.images;
  delete structure.samplers;
  delete structure.buffers; delete structure.bufferViews;
  for (const accessor of structure.accessors ?? []) { delete accessor.bufferView; delete accessor.byteOffset; }
  return {
    structure: hash(JSON.stringify(structure)),
    accessors: doc.getRoot().listAccessors().map(a => {
      const array = a.getArray();
      return { name: a.getName(), type: a.getType(), normalized: a.getNormalized(), count: a.getCount(), sha256: array ? hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) : null };
    }),
    materials: (json.materials ?? []).map(m => {
      const copy = JSON.parse(JSON.stringify(m));
      if (copy.pbrMetallicRoughness) { delete copy.pbrMetallicRoughness.baseColorTexture; delete copy.pbrMetallicRoughness.baseColorFactor; }
      return copy;
    }),
    originalTextures: doc.getRoot().listTextures().map(t => ({ name: t.getName(), mimeType: t.getMimeType(), sha256: t.getImage() ? hash(t.getImage()!) : null })),
  };
}

await mkdir(output, { recursive: true });
const inventory: any[] = [];
const missingAssets: string[] = [];
const runtimeMaterialsHandled: string[] = [];
const inputs: { entry: any; doc: Document; bytes: Buffer; sha256: string; original: string }[] = [];
for (const id of [...wanted].sort()) {
  const entry = manifest.assets.find((a: any) => a.id === id);
  if (!entry) {
    if (/^corealm_dagger_[1-4]$/.test(id)) runtimeMaterialsHandled.push(id);
    else missingAssets.push(id);
    continue;
  }
  const source = path.resolve("game/public/assets", entry.file);
  const bytes = await readFile(source);
  const sha256 = hash(bytes);
  const original = `originals/${id}.glb`;
  const originalPath = path.join(output, original);
  await mkdir(path.dirname(originalPath), { recursive: true });
  try {
    const prior = await readFile(originalPath);
    if (hash(prior) !== sha256) throw new Error(`Original changed for ${id}; retain snapshot and explicitly review provenance before a new run`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(originalPath, bytes);
  }
  // Read from its production path so external original PBR images resolve correctly.
  const doc = await io.read(source);
  const originalTextures = [];
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const textureHash = hash(image);
    const file = `originals/textures/${textureHash}.${texture.getMimeType() === "image/png" ? "png" : texture.getMimeType() === "image/jpeg" ? "jpg" : "bin"}`;
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), image);
    originalTextures.push({ name: texture.getName(), uri: texture.getURI(), mimeType: texture.getMimeType(), sha256: textureHash, bytes: image.length, file });
  }
  const materials = doc.getRoot().listMaterials().map(material => {
    const texture = material.getBaseColorTexture();
    const primitives = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives().filter(p => p.getMaterial() === material));
    return { material: material.getName(), extras: material.getExtras(), sourceTexture: texture?.getName() ?? null,
      sourceTextureURI: texture?.getURI() ?? null, sourceTextureSha256: texture?.getImage() ? hash(texture.getImage()!) : null,
      baseColorFactor: material.getBaseColorFactor(), primitives: primitives.length,
      uvSets: primitives.map(p => p.listSemantics().filter(s => s.startsWith("TEXCOORD_"))),
      missingUV: primitives.some(p => !p.getAttribute(`TEXCOORD_${material.getBaseColorTextureInfo()?.getTexCoord() ?? 0}`)),
    };
  });
  inventory.push({ id, file: entry.file, pack: entry.pack, sha256, original, originalTextures, materials });
  inputs.push({ entry, doc, bytes, sha256, original });
}
await writeFile(path.join(root, "source-material-inventory.json"), JSON.stringify({ manifestSha256: hash(manifestBytes), missingAssets, runtimeMaterialsHandled, assets: inventory }, null, 2) + "\n");
console.log(`Inventoried ${inputs.length} existing assets at ${path.join(root, "source-material-inventory.json")}`);
if (process.argv.includes("--inventory-only")) process.exit(0);
if (missingAssets.length) throw new Error(`Missing manifest assets: ${missingAssets.join(", ")}`);
const configIndex = process.argv.indexOf("--config");
const configPath = path.resolve(configIndex >= 0 ? process.argv[configIndex + 1]! : path.join(root, "texture-map.json"));
const configBytes = await readFile(configPath);
const config = JSON.parse(configBytes.toString()) as Config;
if (config.schemaVersion !== 1 || !Array.isArray(config.replacements)) throw new Error("Expected texture-map schemaVersion 1 and replacements array");
const matchedRules = new Set<number>();
const assets: any[] = [], evidence: any[] = [];
const files: Record<string, string> = {};
const shared = new Map<string, { file: string; bytes: number; sha256: string; mimeType: string; data: Buffer }>();
for (const { entry, doc, bytes, sha256, original } of inputs) {
  const before = await protectedState(doc);
  const parsed = parseGLB(bytes);
  const originalJSON = structuredClone(parsed.json);
  const amended = parsed.json;
  const applied: any[] = [];
  const textures = new Map<string, number>();
  for (const [materialIndex, material] of doc.getRoot().listMaterials().entries()) {
    const sourceTexture = material.getBaseColorTexture()?.getName();
    const matches = config.replacements.map((rule, index) => ({ rule, index })).filter(({ rule }) =>
      (rule.assetId === undefined || rule.assetId === entry.id) && (rule.material === undefined || rule.material === material.getName()) &&
      (rule.sourceTexture === undefined || rule.sourceTexture === sourceTexture));
    if (matches.length > 1) throw new Error(`Ambiguous replacements for ${entry.id}/${material.getName()}`);
    if (!matches.length) continue;
    const { rule, index } = matches[0]!;
    const texCoord = material.getBaseColorTextureInfo()?.getTexCoord() ?? 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMaterial() === material && !primitive.getAttribute(`TEXCOORD_${texCoord}`)) throw new Error(`STOP: ${entry.id}/${material.getName()} has no TEXCOORD_${texCoord}; UV generation is forbidden`);
    }
    const pngPath = path.resolve(path.dirname(configPath), rule.png);
    const png = await readFile(pngPath);
    const metadata = await sharp(png).metadata();
    if (metadata.format !== "png") throw new Error(`Expected PNG: ${pngPath}`);
    const pngHash = hash(png);
    const textureFile = `textures/imported/${pngHash}.png`;
    shared.set(textureFile, { file: textureFile, bytes: png.length, sha256: pngHash, mimeType: "image/png", data: png });
    const jsonMaterial = amended.materials[materialIndex];
    if (jsonMaterial.name !== material.getName() && !(jsonMaterial.name === undefined && material.getName() === "")) throw new Error(`Material order mismatch for ${entry.id}`);
    const pbr = jsonMaterial.pbrMetallicRoughness ??= {};
    const oldTexture = amended.textures?.[pbr.baseColorTexture?.index];
    const sampler = oldTexture?.sampler;
    const textureKey = `${pngHash}:${sampler ?? "default"}`;
    let texture = textures.get(textureKey);
    if (texture === undefined) {
      amended.images ??= []; amended.textures ??= [];
      const image = amended.images.length;
      amended.images.push({ name: `equipment-retexture-${pngHash}`, mimeType: "image/png", uri: path.posix.relative(path.posix.dirname(entry.file), textureFile) });
      texture = Number(amended.textures.length);
      amended.textures.push({ source: image, ...(sampler === undefined ? {} : { sampler }) });
      textures.set(textureKey, texture);
    }
    pbr.baseColorTexture = { ...(pbr.baseColorTexture ?? {}), index: texture };
    if (rule.baseColorFactor) {
      if (rule.baseColorFactor.length !== 4 || rule.baseColorFactor.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error(`Invalid baseColorFactor for ${entry.id}`);
      pbr.baseColorFactor = rule.baseColorFactor;
    }
    matchedRules.add(index);
    applied.push({ material: material.getName(), sourceTexture, png: rule.png, file: textureFile, sha256: pngHash, dimensions: [metadata.width, metadata.height], baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1] });
  }
  const glb = amendGLB(amended, parsed.tail);
  const reparsed = parseGLB(glb);
  const rawProof = { beforeJSON: hash(JSON.stringify(originalJSON)), afterProtectedJSON: unchangedJSON(reparsed.json, originalJSON), beforeBIN: hash(parsed.tail), afterBIN: hash(reparsed.tail) };
  if (rawProof.beforeJSON !== rawProof.afterProtectedJSON || rawProof.beforeBIN !== rawProof.afterBIN) throw new Error(`Original GLB content changed beyond material albedo in ${entry.id}`);
  const jsonDocument: JSONDocument = { json: reparsed.json, resources: {} };
  if (reparsed.tail.length) {
    if (reparsed.tail.readUInt32LE(4) !== 0x004e4942) throw new Error(`Expected original BIN chunk for ${entry.id}`);
    jsonDocument.resources["@glb.bin"] = new Uint8Array(reparsed.tail.subarray(8, 8 + reparsed.tail.readUInt32LE(0)));
  }
  for (const image of jsonDocument.json.images ?? []) {
    if (!image.uri || image.uri.startsWith("data:")) continue;
    const assetPath = path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), image.uri));
    jsonDocument.resources[image.uri] = new Uint8Array(shared.get(assetPath)?.data ?? await readFile(path.resolve("game/public/assets", assetPath)));
  }
  const reread = await io.readJSON(jsonDocument);
  const after = await protectedState(reread);
  // New albedo textures append to the original textures; their content is recorded separately.
  after.originalTextures = after.originalTextures.slice(0, before.originalTextures.length);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Protected geometry, rig, animation, PBR or scene state changed for ${entry.id}`);
  const file = `models/${entry.id}.glb`;
  if (!verifyOnly) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), glb);
  }
  files[entry.id] = file;
  assets.push({ ...entry, bytes: glb.length, sha256: hash(glb) });
  evidence.push({ id: entry.id, original, originalFile: entry.file, originalSha256: sha256, originalTextures: inventory.find(a => a.id === entry.id).originalTextures, applied, rawProof, before, after, protectedStateMatches: true });
}
for (let index = 0; index < config.replacements.length; index++) if (!matchedRules.has(index)) throw new Error(`Replacement ${index} matched no material`);
if (!verifyOnly) {
  for (const texture of shared.values()) {
    await mkdir(path.dirname(path.join(output, texture.file)), { recursive: true });
    await writeFile(path.join(output, texture.file), texture.data);
  }
  await writeFile(path.join(output, "catalog.json"), JSON.stringify({ assets, files, sharedTextures: [...shared.values()].map(({ data: _data, ...texture }) => texture), runtimeMaterialsHandled, provenance: { manifestSha256: hash(manifestBytes), configSha256: hash(configBytes), method: "Original GLB BIN and all existing JSON fields retained; only material base colors and appended external albedo images/textures change", evidence }, visualAccepted: false, browserReviewed: false }, null, 2) + "\n");
}
console.log(verifyOnly ? `Verified ${assets.length} candidate roundtrips without writing candidates` : `Staged ${assets.length} candidates at ${path.join(output, "catalog.json")}`);
