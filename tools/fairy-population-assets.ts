/** Stage provenance-checked current fairy variants for devdocs without rebuilding retired bodies. */
import './lib/repoContent.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { FAIRY_GARDEN_VARIANTS } from '../game/src/content/fairyGardenCreatures.js';
import { FAIRY_MINIBOSS_FORMS } from '../game/src/content/fairyMinibossForms.js';

const forms = [...FAIRY_GARDEN_VARIANTS, ...FAIRY_MINIBOSS_FORMS];
const artworkRoot = 'art/fairy-population/textures/generated';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type ArtworkBinding = {
  sourceTextureIndex: number;
  atlasColumn: number;
  atlasRow: number;
  embeddedTextureSha256: string;
};
type Artwork = {
  file: string;
  sha256: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  bindings: ArtworkBinding[];
};
type FairyAsset = {
  id: string;
  file: string;
  bytes: number;
  sha256: string;
  sourceProvenance?: { generatedTexture?: Artwork; [key: string]: unknown };
  [key: string]: unknown;
};

/** Historical form.source values do not authorize painting a replacement body's different UVs. */
export function fairyArtwork(entry: FairyAsset): Artwork {
  const artwork = entry.sourceProvenance?.generatedTexture;
  const expected = `${artworkRoot}/${entry.id}.png`;
  if (!artwork || artwork.file !== expected || !/^[a-f0-9]{64}$/.test(artwork.sha256)
    || !Number.isInteger(artwork.columns) || artwork.columns < 1
    || !Number.isInteger(artwork.rows) || artwork.rows < 1
    || !Array.isArray(artwork.bindings) || !artwork.bindings.length) {
    throw new Error(`${entry.id}: the current body does not own ${expected}. Use its current sourceProvenance and family repair profile; the historical form source and atlas are retired for this body.`);
  }
  return artwork;
}

export function verifyFairyArtworkBindings(entry: FairyAsset, doc: Document): void {
  const artwork = fairyArtwork(entry);
  const baseColors = new Set(doc.getRoot().listMaterials().flatMap(material => {
    const bytes = material.getBaseColorTexture()?.getImage();
    return bytes ? [hash(bytes)] : [];
  }));
  for (const binding of artwork.bindings) {
    if (!Number.isInteger(binding.atlasColumn) || binding.atlasColumn < 0 || binding.atlasColumn >= artwork.columns
      || !Number.isInteger(binding.atlasRow) || binding.atlasRow < 0 || binding.atlasRow >= artwork.rows
      || !baseColors.has(binding.embeddedTextureSha256)) {
      throw new Error(`${entry.id}: generated artwork binding no longer matches the current material. Review the current UVs and update its artwork provenance before staging.`);
    }
  }
}

export async function stageFairyPopulationAssets(options: {
  only?: readonly string[];
  available?: boolean;
  output?: string;
} = {}) {
  const out = options.output ?? 'test-results/fairy-population/assets';
  const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')) as { assets: FairyAsset[]; packs: unknown[] };
  const ids = new Set(forms.map(form => form.assetId));
  for (const id of options.only ?? []) if (!ids.has(id)) throw new Error(`Unknown fairy variant ${id}`);
  const selected = options.only ? new Set(options.only) : ids;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const assets: FairyAsset[] = [], files: Record<string, string> = {}, skipped: { id: string; reason: string }[] = [];
  // Complete preflight before writing. A bad selection cannot leave a partially replaced catalog.
  const verified: { entry: FairyAsset; bytes: Buffer }[] = [];
  for (const id of selected) {
    const entry = manifest.assets.find(asset => asset.id === id);
    if (!entry) throw new Error(`Missing current published fairy variant ${id}`);
    let artwork: Artwork;
    try { artwork = fairyArtwork(entry); }
    catch (error) {
      if (options.only) throw error;
      skipped.push({ id, reason: (error as Error).message });
      continue;
    }
    const image = await readFile(artwork.file).catch((error: NodeJS.ErrnoException) => {
      if (options.available && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!image) { skipped.push({ id, reason: `Missing tracked artwork ${artwork.file}` }); continue; }
    if (hash(image) !== artwork.sha256) throw new Error(`${id}: artwork changed since the current body's UV review. Update its source and texture provenance together before staging; restoring an older motion source must not discard a new skin.`);
    const metadata = await sharp(image).metadata();
    if (metadata.width !== artwork.width || metadata.height !== artwork.height) throw new Error(`${id}: artwork dimensions do not match the recorded atlas`);
    const sourcePath = path.resolve('game/public/assets', entry.file);
    const assetRoot = path.resolve('game/public/assets') + path.sep;
    if (!sourcePath.startsWith(assetRoot)) throw new Error(`${id}: source escapes public assets`);
    const bytes = await readFile(sourcePath);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`${id}: current published GLB does not match its manifest`);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    if ([...(json.images ?? []), ...(json.buffers ?? [])].some((resource: { uri?: string }) => resource.uri && !resource.uri.startsWith('data:'))) {
      throw new Error(`${id}: current GLB uses external resources. Stage it with the family pipeline so those resources retain their verified paths.`);
    }
    verifyFairyArtworkBindings(entry, await io.readBinary(bytes));
    verified.push({ entry, bytes });
  }
  if (!verified.length) throw new Error('No current fairy variants with matching artwork provenance are available for this selection');
  await mkdir(path.join(out, 'models'), { recursive: true });
  for (const { entry, bytes } of verified) {
    const file = `models/${entry.id}-${entry.sha256.slice(0, 16)}.glb`;
    await writeFile(path.join(out, file), bytes);
    // Copy the published bytes exactly. Re-encoding the old PNG would degrade its current
    // alpha and could replace later polish. Geometry, rig, UVs, PBR and clips stay intact.
    assets.push({ ...entry, file, compactFile: undefined });
    files[entry.id] = file;
  }
  const catalog = { assets, files, packs: manifest.packs, visualAccepted: false, promotable: false, skipped };
  const catalogFile = path.join(out, 'candidates.json');
  await writeFile(`${catalogFile}.tmp`, JSON.stringify(catalog, null, 2) + '\n');
  await rename(`${catalogFile}.tmp`, catalogFile);
  return { staged: assets.map(entry => entry.id), skipped, catalogFile };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const only = process.argv.find(argument => argument.startsWith('--only='))?.slice(7).split(',');
  const result = await stageFairyPopulationAssets({ only, available: process.argv.includes('--available') });
  for (const entry of result.skipped) console.log(`Skipped ${entry.id}: ${entry.reason}`);
  console.log(`Staged ${result.staged.length} current variants for devdocs: ${result.catalogFile}`);
}
