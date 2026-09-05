/**
 * Validates the six GLBs written by import-unity-magic-assets.ps1 and merges
 * their measured metadata into game/public/assets/manifest.json.
 *
 * Usage:
 *   npx tsx tools/import-unity-magic-assets.ts
 *   npx tsx tools/import-unity-magic-assets.ts --write-manifest
 *   npx tsx tools/import-unity-magic-assets.ts --output <directory>
 */
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getBounds, Logger, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

interface CatalogEntry {
  id: string;
  pack: string;
  category: "weapon" | "rock" | "building";
  is: string;
  tags: string[];
  expectedLongestAxis: [number, number];
  expectedSha256?: string;
}

interface ManifestPack {
  id: string;
  name: string;
  author: string;
  source: string;
  license: string;
}

interface ManifestAsset {
  id: string;
  file: string;
  pack: string;
  category: string;
  is: string;
  tags: string[];
  bytes: number;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  animations: string[];
  materials: string[];
  sha256: string;
}

interface ManifestArtifact {
  id: string;
  file: string;
  pack: string;
  kind: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  dimensions?: { width: number; height: number };
}

interface Manifest {
  generatedAt: string;
  packs: ManifestPack[];
  assets: ManifestAsset[];
  artifacts?: ManifestArtifact[];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const defaultOutput = path.join(repoRoot, "game", "public", "assets", "models", "magic");
const manifestPath = path.join(repoRoot, "game", "public", "assets", "manifest.json");

const catalog: CatalogEntry[] = [
  {
    id: "rpg_weapon_staff",
    pack: "blink-free-rpg-weapons",
    category: "weapon",
    is: "staff",
    tags: ["staff", "magic", "two-handed", "equip", "wood-variant", "orb-socket", "non-emissive"],
    expectedLongestAxis: [2.0, 2.4],
    expectedSha256: "989156E7BC8A8269E0848C40A15AD7C4D92A4E53370C2A831BF49099EB4ED31A",
  },
  {
    id: "rpg_weapon_wand",
    pack: "blink-free-rpg-weapons",
    category: "weapon",
    is: "wand",
    tags: ["wand", "magic", "one-handed", "equip", "wood-variant", "orb-socket", "non-emissive"],
    expectedLongestAxis: [0.85, 1.1],
    expectedSha256: "BBC7BC761773E658C4A0C8CCF30F175ADE391A11A87D85CC8E4866056328B929",
  },
  {
    id: "rocks_free_essence_cache",
    pack: "dexsoft-rocks-free",
    category: "rock",
    is: "essence-cache",
    tags: ["rock", "essence", "cache", "minable", "large", "lod0", "emissive-overlay-target"],
    expectedLongestAxis: [28, 33],
    expectedSha256: "AC63B7F26CD8E7A489223275193409507521DCF27234CC74A225766ECD4EEEC9",
  },
  {
    id: "rocks_free_essence_node",
    pack: "dexsoft-rocks-free",
    category: "rock",
    is: "essence-node",
    tags: ["rock", "essence", "node", "minable", "satellite", "lod0", "emissive-overlay-target"],
    expectedLongestAxis: [4.7, 5.8],
    expectedSha256: "C1C3C2AF9EAED4027D80C84ED64422C9FB261EABC8BC275334A6A834FB541A1D",
  },
  {
    id: "altar_ruins_altar",
    pack: "underhill-altar-ruins-free",
    category: "building",
    is: "essence-altar",
    tags: ["altar", "ruin", "station", "essence", "awakening", "emissive-overlay-target", "non-emissive-source"],
    expectedLongestAxis: [1, 12],
    expectedSha256: "2A9817274193D386343A00ED408B164A325A766C88F59EBA4E1C2D7F8BB9DED1",
  },
  {
    id: "altar_ruins_site",
    pack: "underhill-altar-ruins-free",
    category: "building",
    is: "essence-altar-ruins",
    tags: ["altar", "ruin", "landmark", "essence", "stone", "non-emissive"],
    expectedLongestAxis: [10, 120],
    expectedSha256: "39732BAA18D038E84D91EE655FE7CC2AE4704488657550FC8D9C40F21330517A",
  },
];

const packs: ManifestPack[] = [
  {
    id: "blink-free-rpg-weapons",
    name: "FREE - RPG Weapons",
    author: "Blink",
    source: "https://assetstore.unity.com/packages/3d/props/weapons/free-rpg-weapons-199738",
    license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
  },
  {
    id: "dexsoft-rocks-free",
    name: "Rocks FREE pack",
    author: "DEXSOFT",
    source: "https://assetstore.unity.com/packages/3d/props/exterior/rocks-free-pack-98219",
    license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
  },
  {
    id: "underhill-altar-ruins-free",
    name: "Altar Ruins Free",
    author: "Underhill Labz",
    source: "https://marketplace.unity.com/packages/3d/environments/fantasy/altar-ruins-free-109065",
    license: "Standard Unity Asset Store EULA; project owner must confirm entitlement",
  },
];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateHeader(bytes: Uint8Array, id: string): void {
  assert(bytes.byteLength >= 20, `${id}: GLB is too short`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67, `${id}: missing glTF binary magic`);
  assert(view.getUint32(4, true) === 2, `${id}: expected glTF 2.0`);
  assert(view.getUint32(8, true) === bytes.byteLength, `${id}: GLB header length does not match file length`);
  assert(view.getUint32(16, true) === 0x4e4f534a, `${id}: first GLB chunk is not JSON`);
}

async function inspect(entry: CatalogEntry, output: string, io: NodeIO): Promise<ManifestAsset> {
  const absoluteFile = path.join(output, `${entry.id}.glb`);
  const bytes = new Uint8Array(await readFile(absoluteFile));
  validateHeader(bytes, entry.id);
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (entry.expectedSha256) {
    assert(digest === entry.expectedSha256, `${entry.id}: SHA-256 ${digest}; expected ${entry.expectedSha256}`);
  }

  const document = await io.readBinary(bytes);
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  assert(scene, `${entry.id}: no glTF scene`);
  assert(root.listMeshes().length > 0, `${entry.id}: no meshes`);
  assert(root.listMaterials().length > 0, `${entry.id}: no materials`);
  assert(root.listTextures().length > 0, `${entry.id}: source texture was not embedded`);

  for (const material of root.listMaterials()) {
    const emission = material.getEmissiveFactor();
    assert(
      !material.getEmissiveTexture() && emission.every((channel) => Math.abs(channel) < 0.000001),
      `${entry.id}: material ${material.getName()} is emissive`,
    );
  }

  const bounds = getBounds(scene);
  assert([...bounds.min, ...bounds.max].every(Number.isFinite), `${entry.id}: bounds contain non-finite values`);
  const dimensions: [number, number, number] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  const longest = Math.max(...dimensions);
  assert(
    longest >= entry.expectedLongestAxis[0] && longest <= entry.expectedLongestAxis[1],
    `${entry.id}: longest axis ${longest.toFixed(6)}m is outside ${entry.expectedLongestAxis.join("..")}m`,
  );

  let vertices = 0;
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (position) vertices += position.getCount();
      const indices = primitive.getIndices();
      triangles += Math.floor((indices?.getCount() ?? position?.getCount() ?? 0) / 3);
    }
  }
  assert(vertices > 100, `${entry.id}: suspicious vertex count ${vertices}`);
  assert(triangles > 100, `${entry.id}: suspicious triangle count ${triangles}`);

  const fileStats = await stat(absoluteFile);
  const asset: ManifestAsset = {
    id: entry.id,
    file: `models/magic/${entry.id}.glb`,
    pack: entry.pack,
    category: entry.category,
    is: entry.is,
    tags: entry.tags,
    bytes: fileStats.size,
    size: { x: rounded(dimensions[0]), y: rounded(dimensions[1]), z: rounded(dimensions[2]) },
    base: { x: rounded(bounds.min[0]), y: rounded(bounds.min[1]), z: rounded(bounds.min[2]) },
    animations: root.listAnimations().map((animation) => animation.getName()),
    materials: root.listMaterials().map((material) => material.getName()),
    sha256: digest,
  };

  console.log(
    `${entry.id}: ${fileStats.size} bytes, ` +
      `${asset.size.x} x ${asset.size.y} x ${asset.size.z} m, ` +
      `${vertices} vertices, ${triangles} triangles, materials=${asset.materials.join(",")}`,
  );
  return asset;
}

async function normalizeAltarTextures(entry: CatalogEntry, output: string, io: NodeIO): Promise<void> {
  if (entry.pack !== "underhill-altar-ruins-free") return;
  const absoluteFile = path.join(output, `${entry.id}.glb`);
  const document = await io.read(absoluteFile);
  const requiresResize = document.getRoot().listTextures().some((texture) => {
    const size = texture.getSize();
    if (!size) return false;
    const [width, height] = size;
    return width > 2048 || height > 2048;
  });
  if (!requiresResize) return;
  await document.transform(textureCompress({ encoder: sharp, resize: [2048, 2048] }));
  await io.write(absoluteFile, document);
  console.log(`${entry.id}: normalized authored textures to a 2048 px maximum`);
}

async function writeTextAtomically(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, contents, "utf8");
  try {
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeManifest(assets: ManifestAsset[], input: string, output: string): Promise<void> {
  const manifest = JSON.parse(await readFile(input, "utf8")) as Manifest;
  assert(Array.isArray(manifest.packs) && Array.isArray(manifest.assets), `${input}: invalid asset manifest`);
  assert(manifest.artifacts === undefined || Array.isArray(manifest.artifacts), `${input}: invalid artifacts list`);
  const packIds = new Set(packs.map((pack) => pack.id));
  const assetIds = new Set(assets.map((asset) => asset.id));
  manifest.packs = [...manifest.packs.filter((pack) => !packIds.has(pack.id)), ...packs];
  manifest.assets = [...manifest.assets.filter((asset) => !assetIds.has(asset.id)), ...assets];
  manifest.generatedAt = new Date().toISOString();
  await writeTextAtomically(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: staged ${assets.length} Unity asset rows at ${output}`);
}

async function verifyManifestRows(assets: ManifestAsset[]): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  for (const measured of assets) {
    const recorded = manifest.assets.find((asset) => asset.id === measured.id);
    assert(recorded, `${measured.id}: missing from ${manifestPath}`);
    for (const field of ["file", "pack", "bytes", "sha256"] as const) {
      assert(recorded[field] === measured[field], `${measured.id}: manifest ${field} does not match audited output`);
    }
    assert(
      JSON.stringify(recorded.size) === JSON.stringify(measured.size) &&
        JSON.stringify(recorded.base) === JSON.stringify(measured.base),
      `${measured.id}: manifest bounds do not match audited output`,
    );
  }
}

async function main(): Promise<void> {
  const output = path.resolve(option("--output") ?? defaultOutput);
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
  const assets: ManifestAsset[] = [];
  for (const entry of catalog) {
    await normalizeAltarTextures(entry, output, io);
    assets.push(await inspect(entry, output, io));
  }

  if (process.argv.includes("--write-manifest")) {
    const inputManifest = path.resolve(option("--manifest-input") ?? manifestPath);
    const outputManifest = path.resolve(option("--manifest-output") ?? manifestPath);
    if (output !== path.resolve(defaultOutput)) {
      assert(
        process.argv.includes("--manifest-output"),
        "staged GLBs require an explicit --manifest-output so validation cannot mutate the live manifest",
      );
      assert(outputManifest !== path.resolve(manifestPath), "staged GLBs cannot write the live manifest");
    }
    await writeManifest(assets, inputManifest, outputManifest);
  } else {
    if (output === path.resolve(defaultOutput)) await verifyManifestRows(assets);
    console.log("validation: all six GLBs match recorded hashes, structure, bounds, textures, and zero emission");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
