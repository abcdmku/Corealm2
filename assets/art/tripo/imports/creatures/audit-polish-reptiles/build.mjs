import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';

const root = path.resolve('assets/art/tripo/imports/creatures/audit-polish-reptiles');
const manifest = JSON.parse(await readFile(path.join(root, 'source-manifest.json'), 'utf8'));
const io = new NodeIO();
const ids = ['creature_reedjaw_crocodile', 'creature_ashscale_monitor', 'creature_slateback_tortoise', 'creature_kiln_salamander'];
await mkdir(root, { recursive: true });
const assets = [];
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

async function blendAtlas(texture, generatedPath, contribution) {
  const source = await sharp(texture.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = source.info;
  const generated = await sharp(generatedPath).resize(width, height).ensureAlpha().raw().toBuffer();
  const blended = Buffer.from(source.data);
  for (let i = 0; i < blended.length; i += channels) {
    const amount = blended[i + 3] > 0 ? contribution : 0;
    for (let channel = 0; channel < 3; channel++) blended[i + channel] = Math.round(blended[i + channel] * (1 - amount) + generated[i + channel] * amount);
  }
  const png = await sharp(blended, { raw: { width, height, channels } }).png().toBuffer();
  texture.setImage(png);
  return png;
}

for (const id of ids) {
  const source = manifest.assets.find(asset => asset.id === id);
  const document = await io.read(path.join(root, 'sources', `${id}.glb`));
  const materials = document.getRoot().listMaterials();
  const textureInputs = [];
  if (id === 'creature_reedjaw_crocodile') {
    const generatedPath = path.join(root, 'reedjaw-crocodile-imagegen.png');
    const texture = materials.find(material => material.getName() === 'animal_reedjaw_crocodile_mat').getBaseColorTexture();
    const png = await blendAtlas(texture, generatedPath, 0.3);
    await writeFile(path.join(root, 'reedjaw-crocodile-atlas.png'), png);
    textureInputs.push({ file: path.basename(generatedPath), sha256: sha(await readFile(generatedPath)), finalSha256: sha(png) });
  } else if (id === 'creature_ashscale_monitor') {
    const generatedPath = path.join(root, 'ashscale-monitor-imagegen.png');
    const texture = materials.find(material => material.getName() === 'Ashscale pebbled skin and ventral scales').getBaseColorTexture();
    const png = await blendAtlas(texture, generatedPath, 0.72);
    await writeFile(path.join(root, 'ashscale-monitor-atlas.png'), png);
    textureInputs.push({ file: path.basename(generatedPath), sha256: sha(await readFile(generatedPath)), finalSha256: sha(png) });
    // A shorter vertical envelope answers the audit's dinosaur-like stance
    // while preserving the existing four-limb rig, poses and long tail.
    document.getRoot().listScenes()[0].listChildren()[0].setScale([1, 0.84, 1]);
  } else if (id === 'creature_kiln_salamander') {
    const generatedPath = path.join(root, 'kiln-salamander-imagegen.png');
    const texture = materials.find(material => material.getName() === 'animal_kiln_salamander_mat').getBaseColorTexture();
    const png = await blendAtlas(texture, generatedPath, 0.42);
    await writeFile(path.join(root, 'kiln-salamander-atlas.png'), png);
    textureInputs.push({ file: path.basename(generatedPath), sha256: sha(await readFile(generatedPath)), finalSha256: sha(png) });
  } else {
    for (const [materialName, generatedName, finalName, contribution] of [
      ['slateback_scutes_0', 'slateback-shell-imagegen.png', 'slateback-shell-atlas.png', 0.72],
      ['slateback_skin', 'slateback-skin-imagegen.png', 'slateback-skin-atlas.png', 0.68],
    ]) {
      const generatedPath = path.join(root, generatedName);
      const texture = materials.find(material => material.getName() === materialName).getBaseColorTexture();
      const png = await blendAtlas(texture, generatedPath, contribution);
      await writeFile(path.join(root, finalName), png);
      textureInputs.push({ file: generatedName, sha256: sha(await readFile(generatedPath)), finalSha256: sha(png) });
    }
  }
  const output = path.join(root, `${id}.glb`);
  await io.write(output, document);
  const bytes = await readFile(output);
  const min = [...source.bounds.min], max = [...source.bounds.max];
  if (id === 'creature_ashscale_monitor') { min[1] *= 0.84; max[1] *= 0.84; }
  assets.push({
    ...source,
    pack: 'corealm-reptile-polish',
    bytes: bytes.length,
    sha256: sha(bytes),
    size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    base: { x: min[0], y: min[1], z: min[2] },
    bounds: { min, max },
    groundY: min[1],
    sourceProvenance: { original: source.sourceProvenance, originalPack: manifest.packs.find(pack => pack.id === source.pack), sourceGlbSha256: source.sha256, textureInputs },
    metadata: { ...source.metadata, sourceGlbSha256: source.sha256, sourceBuilderSha256: sha(await readFile(source.metadata.authoringModule)), polishBuilderSha256: sha(await readFile(import.meta.filename)), textureInputs, notes: `${Array.isArray(source.metadata.notes) ? source.metadata.notes.join(' ') : source.metadata.notes} Image-generated layered material detail blended with existing diffuse maps; native UVs, topology, rig and clips retained.` },
    acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
    candidateFile: path.relative(process.cwd(), output).replaceAll('\\', '/'),
  });
  console.log(JSON.stringify({ id, file: output, bytes: bytes.length, sha256: sha(bytes) }));
}

const pack = { id: 'corealm-reptile-polish', name: 'Corealm reptile asset polish', author: 'Corealm', source: 'assets/art/tripo/imports/creatures/audit-polish-reptiles/build.mjs', license: 'Mixed: original Corealm assets and Animal pack deluxe under Standard Unity Asset Store EULA; see each asset sourceProvenance', generatorSha256: sha(await readFile(import.meta.filename)) };
const catalog = { schema: 'corealm-lab-asset-candidates/1', pack, assets };
for (const name of ['lab-catalog.json', 'promotion.json']) await writeFile(path.join(root, name), `${JSON.stringify(catalog, null, 2)}\n`);
