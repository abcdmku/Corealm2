/** Stage fairy-foliage aliases by changing GLB material names only. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, any>;
type AssetEntry = JsonRecord & { id: string; file: string; pack: string; materials: string[] };
type PackEntry = JsonRecord & { id: string; name: string; source: string; license: string };

interface Variant {
  id: string;
  sourceId: string;
  fairy: "gloam" | "fae";
  rename?: Readonly<Record<string, string>>;
}

interface ParsedGlb {
  json: JsonRecord;
  binaryChunks: Buffer;
  binaryPayload: Buffer;
}

const variants: readonly Variant[] = [
  { id: "corealm_willow_gloam_1", sourceId: "corealm_willow_1", fairy: "gloam" },
  { id: "corealm_willow_gloam_2", sourceId: "corealm_willow_2", fairy: "gloam" },
  { id: "corealm_yew_fae_1", sourceId: "corealm_yew_1", fairy: "fae" },
  { id: "corealm_yew_fae_2", sourceId: "corealm_yew_2", fairy: "fae" },
  {
    id: "corealm_fern_gloam_1",
    sourceId: "corealm_fern_1",
    fairy: "gloam",
    rename: { Stem_Corealm: "Bark_Corealm@fairy:gloam" },
  },
  { id: "corealm_shrub_fae_1", sourceId: "corealm_shrub_1", fairy: "fae" },
  {
    id: "mushroom_gloam",
    sourceId: "mushroom_common",
    fairy: "gloam",
    rename: { Mushrooms: "Leaves_Fairy_mushroom@fairy:gloam" },
  },
  {
    id: "mushroom_fae",
    sourceId: "mushroom_bracket",
    fairy: "fae",
    rename: { Mushrooms: "Leaves_Fairy_mushroom@fairy:fae" },
  },
] as const;

const repoRoot = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(repoRoot, "game/public/assets/manifest.json");
const outputRoot = path.join(repoRoot, "test-results/fairy-foliage");
const modelRoot = path.join(outputRoot, "models/fairy-foliage");
const digest = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

function parseGlb(source: Buffer, label: string): ParsedGlb {
  if (source.length < 28 || source.toString("ascii", 0, 4) !== "glTF"
    || source.readUInt32LE(4) !== 2 || source.readUInt32LE(8) !== source.length
    || source.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error(`${label}: expected a JSON-first GLB 2 file`);
  }
  const jsonLength = source.readUInt32LE(12);
  const nextChunk = 20 + jsonLength;
  if (nextChunk + 8 > source.length || source.readUInt32LE(nextChunk + 4) !== 0x004e4942) {
    throw new Error(`${label}: expected an embedded BIN chunk`);
  }
  const binaryLength = source.readUInt32LE(nextChunk);
  if (nextChunk + 8 + binaryLength !== source.length) {
    throw new Error(`${label}: expected exactly one complete BIN chunk`);
  }
  return {
    json: JSON.parse(source.subarray(20, nextChunk).toString("utf8")),
    binaryChunks: source.subarray(nextChunk),
    binaryPayload: source.subarray(nextChunk + 8),
  };
}

function writeGlb(json: JsonRecord, binaryChunks: Buffer): Buffer {
  const jsonText = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(Math.ceil(jsonText.length / 4) * 4, 0x20);
  jsonText.copy(paddedJson);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + paddedJson.length + binaryChunks.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, paddedJson, binaryChunks]);
}

function geometryMetadata(json: JsonRecord): JsonRecord {
  return {
    scene: json.scene,
    scenes: json.scenes,
    nodes: json.nodes,
    meshes: (json.meshes ?? []).map((mesh: JsonRecord) => ({
      name: mesh.name,
      weights: mesh.weights,
      primitives: (mesh.primitives ?? []).map((primitive: JsonRecord) => ({
        attributes: primitive.attributes,
        indices: primitive.indices,
        material: primitive.material,
        mode: primitive.mode,
        targets: primitive.targets,
        extensions: primitive.extensions,
      })),
    })),
    accessors: json.accessors,
    bufferViews: json.bufferViews,
    buffers: json.buffers,
    skins: json.skins,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { assets: AssetEntry[]; packs: PackEntry[] };
const assetsById = new Map(manifest.assets.map(asset => [asset.id, asset]));
const packsById = new Map(manifest.packs.map(pack => [pack.id, pack]));
const packIds = new Map<string, string>();
const packs: JsonRecord[] = [];

for (const variant of variants) {
  const sourceAsset = assetsById.get(variant.sourceId);
  if (!sourceAsset) throw new Error(`${variant.id}: source asset ${variant.sourceId} is absent from the manifest`);
  if (packIds.has(sourceAsset.pack)) continue;
  const sourcePack = packsById.get(sourceAsset.pack);
  if (!sourcePack) throw new Error(`${variant.id}: source pack ${sourceAsset.pack} is absent from the manifest`);
  const id = `${sourcePack.id}-fairy-foliage`;
  packIds.set(sourcePack.id, id);
  packs.push({
    ...clone(sourcePack),
    id,
    name: `${sourcePack.name} fairy-foliage derivatives`,
    derivedFrom: {
      packId: sourcePack.id,
      source: sourcePack.source,
      license: sourcePack.license,
    },
  });
}

await mkdir(modelRoot, { recursive: true });
const assets: JsonRecord[] = [];
const files: Record<string, string> = {};
const verification: JsonRecord[] = [];

for (const variant of variants) {
  const sourceAsset = assetsById.get(variant.sourceId)!;
  const sourceFile = path.join(repoRoot, "game/public/assets", sourceAsset.file);
  const sourceBytes = await readFile(sourceFile);
  const source = parseGlb(sourceBytes, variant.sourceId);
  const json = clone(source.json);
  const sourceGeometry = geometryMetadata(source.json);
  const sourceGeometryText = JSON.stringify(sourceGeometry);
  const sourceMaterials = (source.json.materials ?? []) as JsonRecord[];
  const materials = (json.materials ?? []) as JsonRecord[];
  if (!materials.length) throw new Error(`${variant.id}: source has no materials`);

  materials.forEach((material, index) => {
    const name = material.name;
    if (typeof name !== "string" || !name.length) throw new Error(`${variant.id}: material ${index} has no name`);
    material.name = variant.rename?.[name] ?? `${name}@fairy:${variant.fairy}`;
  });
  for (const expected of Object.keys(variant.rename ?? {})) {
    if (!sourceMaterials.some(material => material.name === expected)) {
      throw new Error(`${variant.id}: source material ${expected} was not found`);
    }
  }

  const outputBytes = writeGlb(json, source.binaryChunks);
  const output = parseGlb(outputBytes, variant.id);
  const outputGeometryText = JSON.stringify(geometryMetadata(output.json));
  const sourceBinSha256 = digest(source.binaryPayload);
  const outputBinSha256 = digest(output.binaryPayload);
  const sourceGeometrySha256 = digest(sourceGeometryText);
  const outputGeometrySha256 = digest(outputGeometryText);
  if (sourceBinSha256 !== outputBinSha256) throw new Error(`${variant.id}: BIN chunk changed`);
  if (sourceGeometryText !== outputGeometryText) throw new Error(`${variant.id}: geometry metadata changed`);
  const materialNames = ((output.json.materials ?? []) as JsonRecord[]).map(material => material.name as string);
  const file = `models/fairy-foliage/${variant.id}.glb`;
  const candidatePath = path.join(modelRoot, `${variant.id}.glb`);
  await writeFile(candidatePath, outputBytes);
  files[variant.id] = file;
  assets.push({
    ...clone(sourceAsset),
    id: variant.id,
    file,
    pack: packIds.get(sourceAsset.pack),
    tags: [...new Set([...(sourceAsset.tags ?? []), "fairy", variant.fairy, "derived"])],
    bytes: outputBytes.length,
    sha256: digest(outputBytes),
    materials: materialNames,
    provenance: {
      derivedFromAsset: sourceAsset.id,
      sourceFile: sourceAsset.file,
      sourceBinarySha256: digest(sourceBytes),
      sourceBinChunkSha256: sourceBinSha256,
      sourceGeometrySha256,
      transform: "GLB JSON material-name aliases only; BIN chunk and geometry metadata unchanged",
    },
  });
  verification.push({
    id: variant.id,
    sourceId: variant.sourceId,
    sourceBinarySha256: digest(sourceBytes),
    outputBinarySha256: digest(outputBytes),
    sourceBinChunkSha256: sourceBinSha256,
    outputBinChunkSha256: outputBinSha256,
    sourceGeometrySha256,
    outputGeometrySha256,
    binChunkEqual: sourceBinSha256 === outputBinSha256,
    geometryMetadataEqual: sourceGeometryText === outputGeometryText,
    materials: materialNames,
  });
}

const catalog = {
  generator: {
    command: "npx tsx tools/fairy-foliage/build.ts",
    deterministic: true,
    generatorSha256: digest(await readFile(import.meta.filename)),
    transform: "Material-name aliases in the GLB JSON chunk",
  },
  packs,
  files,
  assets,
};
await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(path.join(outputRoot, "verification.json"), `${JSON.stringify({ passed: true, assets: verification }, null, 2)}\n`);
console.log(JSON.stringify({
  catalog: "test-results/fairy-foliage/catalog.json",
  assets: assets.length,
  packs: packs.length,
  binChunksPreserved: verification.filter(row => row.binChunkEqual).length,
  geometryMetadataPreserved: verification.filter(row => row.geometryMetadataEqual).length,
}, null, 2));
