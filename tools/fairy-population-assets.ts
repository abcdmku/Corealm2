/** Stage generated UV artwork through production GLB materials; promotion follows lab proof. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { NodeIO, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { FAIRY_GARDEN_VARIANTS } from '../game/src/content/fairyGardenCreatures.js';
import { FAIRY_MINIBOSS_FORMS } from '../game/src/content/fairyMinibossForms.js';

const out = 'test-results/fairy-population/assets';
const sourceRoot = 'test-results/fairy-terraces-assets/monsters';
const artworkRoot = 'art/fairy-population/textures/generated';
const forms = [...FAIRY_GARDEN_VARIANTS, ...FAIRY_MINIBOSS_FORMS];
const selected = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',');
const available = process.argv.includes('--available');
await mkdir(`${out}/models`, { recursive: true });
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const readOptional = async (file: string, fallback: any) => readFile(file, 'utf8').then(JSON.parse)
  .catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return fallback; });
const staged = await readOptional(`${sourceRoot}/candidates.json`, { assets: [], files: {}, packs: [] });
const previous = await readOptional(`${out}/candidates.json`, { assets: [], files: {} });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const currentIds = new Set(forms.map(f => f.assetId));
const packs = new Map([...manifest.packs, ...staged.packs].map((p: any) => [p.id, p]));
const catalog: any = { assets: (selected || available) ? previous.assets.filter((a: any) => currentIds.has(a.id)) : [],
  files: (selected || available) ? Object.fromEntries(Object.entries(previous.files).filter(([id]) => currentIds.has(id))) : {}, packs: [...packs.values()] };
const built: string[] = [];
for (const form of forms) {
  if (selected && !selected.includes(form.assetId)) continue;
  const artworkFile = `${artworkRoot}/${form.assetId}.png`;
  const artwork = await readFile(artworkFile).catch((error: NodeJS.ErrnoException) => {
    if (available && error.code === 'ENOENT') return null;
    throw new Error(`Missing generated UV artwork ${artworkFile}: ${error.message}`);
  });
  if (!artwork) continue;
  const source = manifest.assets.find((a: any) => a.id === form.source) ?? staged.assets.find((a: any) => a.id === form.source);
  if (!source) throw Error(`Missing source ${form.source}`);
  const sourcePath = manifest.assets.includes(source) ? `game/public/assets/${source.file}` : `${sourceRoot}/${staged.files[source.id]}`;
  const sourceBytes = await readFile(sourcePath);
  if (hash(sourceBytes) !== source.sha256) throw Error(`Changed source ${source.id}`);
  const doc = await io.read(sourcePath), materials = doc.getRoot().listMaterials();
  const textures = [...new Set(materials.map(m => m.getBaseColorTexture()).filter((t): t is Texture => t !== null))];
  const shamanAtlas = form.source === 'creature_goblin_shaman';
  if (textures.length !== (shamanAtlas ? 6 : 1)) throw Error(`${source.id}: unexpected base-color atlas count ${textures.length}`);
  const meta = await sharp(artwork).metadata();
  const columns = shamanAtlas ? 3 : 1, rows = shamanAtlas ? 2 : 1;
  if (!meta.width || !meta.height || meta.width % columns || meta.height % rows) throw Error(`${artworkFile}: incomplete atlas cells`);
  const cellWidth = meta.width / columns, cellHeight = meta.height / rows;
  if (cellWidth !== cellHeight || cellWidth < 512) throw Error(`${artworkFile}: expected square cells of at least 512px`);
  const painted = new Map<Texture, Texture>();
  const bindings: any[] = [];
  for (const material of materials) {
    // Standalone eye materials retain their authored iris and pupil; atlas eyes are painted in place.
    if (/eye|teeth|mouth/i.test(material.getName())) continue;
    const original = material.getBaseColorTexture();
    if (!original) continue;
    let texture = painted.get(original);
    if (!texture) {
      const index = textures.indexOf(original), size = Math.min(2048, cellWidth);
      const rgb = await sharp(artwork).extract({ left: index % columns * cellWidth, top: Math.floor(index / columns) * cellHeight,
        width: cellWidth, height: cellHeight }).resize(size, size).removeAlpha().raw().toBuffer();
      const alpha = await sharp(original.getImage()!).ensureAlpha().extractChannel(3).resize(size, size).raw().toBuffer();
      const bytes = await sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
        .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } }).webp({ quality: 96, alphaQuality: 100 }).toBuffer();
      texture = doc.createTexture(`${form.assetId}_generated_${index}`).setImage(bytes).setMimeType('image/webp');
      painted.set(original, texture);
      bindings.push({ sourceTextureIndex: index, atlasColumn: index % columns, atlasRow: Math.floor(index / columns),
        sourceTextureSha256: hash(original.getImage()!), embeddedTextureSha256: hash(bytes), width: size, height: size });
    }
    material.setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, material.getBaseColorFactor()[3]]);
    // Preserve source normal/roughness/metalness maps and authored PBR response.
    material.setName(`${material.getName()}_${form.assetId}`);
  }
  // A vertex tint would multiply the multicolour artwork. Current selected sources have none.
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    if (primitive.getMaterial() && !/eye|teeth|mouth/i.test(primitive.getMaterial()!.getName())) primitive.setAttribute('COLOR_0', null);
  }
  for (const original of painted.keys()) if (original.listParents().length === 1) original.dispose();
  for (const texture of doc.getRoot().listTextures()) texture.setURI('');
  const bytes = await io.writeBinary(doc), file = `models/fairy-garden/${form.assetId}.glb`;
  await writeFile(`${out}/models/${form.assetId}.glb`, bytes);
  const entry = { ...source, id: form.assetId, file, bytes: bytes.length, sha256: hash(bytes),
    tags: [...source.tags, 'fairy-garden', 'image-generated-texture', form.regionId],
    materials: doc.getRoot().listMaterials().map(m => m.getName()),
    sourceProvenance: { ...source.sourceProvenance, sourceAssetId: source.id, sourceSha256: source.sha256,
      generator: 'tools/fairy-population-assets.ts',
      modifications: 'Image-generated UV albedo artwork assigned directly with source alpha and standalone eyes preserved. Neutral base-color factors and no vertex-color tint. Source position/normal/UV geometry, skeleton, skin weights, animation and native PBR response retained.',
      generatedTexture: { file: artworkFile, sha256: hash(artwork), width: meta.width, height: meta.height, columns, rows, bindings },
    }, acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
  };
  const index = catalog.assets.findIndex((a: any) => a.id === entry.id);
  if (index < 0) catalog.assets.push(entry); else catalog.assets[index] = entry;
  catalog.files[entry.id] = `models/${entry.id}.glb`;
  built.push(entry.id);
  console.log(`${entry.id}: ${Math.round(bytes.length / 1024)} KiB, ${bindings.length} generated material maps`);
}
if (!built.length) throw Error('No generated UV artwork available for the selected variants');
await writeFile(`${out}/candidates.json`, JSON.stringify(catalog, null, 2) + '\n');
for (const region of ['gloamgarden', 'faeholme']) {
  const bosses = FAIRY_MINIBOSS_FORMS.filter(f => f.regionId === region);
  const lab = { ...catalog, assets: catalog.assets.map((a: any) => {
    const boss = bosses.find(f => f.assetId === a.id); return boss ? { ...a, id: boss.source } : a;
  }), files: { ...catalog.files } };
  for (const boss of bosses) if (catalog.files[boss.assetId]) lab.files[boss.source] = catalog.files[boss.assetId];
  await writeFile(path.join(out, `lab-${region}.json`), JSON.stringify(lab, null, 2) + '\n');
}
