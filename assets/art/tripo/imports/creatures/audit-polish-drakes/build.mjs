import { NodeIO } from '@gltf-transform/core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = 'assets/art/tripo/imports/creatures/audit-polish-drakes';
const models = `${root}/models`;
const textures = `${root}/textures`;
const io = new NodeIO();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('${root}/source-manifest.json', 'utf8'));
const builderSha256 = hash(await readFile(`${root}/build.mjs`));
await mkdir(models, { recursive: true });

const plans = [
  { id: 'creature_basalt_drake', sourceId: 'creature_basalt_drake' },
  { id: 'creature_furnace_grazer', sourceId: 'creature_furnace_grazer' },
  { id: 'creature_basalt_maw_high_tier', sourceId: 'creature_furnace_grazer' },
];
const catalog = { schema: 'corealm-lab-asset-candidates/1', pack: { id: 'corealm-audit-polish-drakes', name: 'Corealm drake audit polish', author: 'Corealm', source: `${root}/build.mjs`, license: 'Dungeon Mason Dragon the Soul Eater and Dragon Boar, Standard Unity Asset Store EULA', generatorSha256: builderSha256 }, assets: [] };
const promotion = { schema: 'corealm-creature-polish-promotion/1', pack: catalog.pack.id, builderSha256, status: 'awaiting-root-lab-review', accepted: false, assets: [] };

for (const { id, sourceId } of plans) {
  const source = manifest.assets.find(asset => asset.id === sourceId);
  if (!source) throw Error(`Missing production source ${id}`);
  const sourceFile = `${root}/sources/${sourceId}.glb`;
  const sourceBytes = await readFile(sourceFile);
  if (hash(sourceBytes) !== source.sha256) throw Error(`Manifest hash mismatch for ${id}`);
  const doc = await io.read(sourceFile);
  const material = doc.getRoot().listMaterials()[0];
  const originalAlbedo = material.getBaseColorTexture();
  if (!originalAlbedo || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw Error(`Incomplete source PBR for ${id}`);

  const generatedMapFile = `${textures}/${id}-imagegen.png`;
  const generatedBytes = await readFile(generatedMapFile);
  const albedoBytes = await sharp(generatedBytes).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer();
  const albedoFile = `${textures}/${id}-albedo.png`;
  await writeFile(albedoFile, albedoBytes);
  originalAlbedo.setImage(albedoBytes).setMimeType('image/png').setName(`${id}_layered_imagegen_albedo`);
  material.setName(id === 'creature_basalt_drake' ? 'armored_dragon_layered_basalt_plates' : id === 'creature_furnace_grazer' ? 'furnace_grazer_heated_basalt_plates' : 'high_tier_basalt_maw_black_plates_and_hot_jaw');

  let emissiveFile = null;
  let emissiveSha256 = null;
  if (id !== 'creature_basalt_drake') {
    // Isolate the ember pixels already painted into the generated atlas. This
    // preserves the exact UV layout while giving the furnace cracks light.
    const { data, info } = await sharp(albedoBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const emission = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 3) {
      const red = data[i], green = data[i + 1], blue = data[i + 2];
      const heat = Math.max(0, Math.min(1, (red - Math.max(green * 1.25, blue * 1.6) - 23) / 115));
      const hot = heat * Math.max(0, Math.min(1, (red - 78) / 125));
      emission[i] = Math.round(red * hot);
      emission[i + 1] = Math.round(green * hot);
      emission[i + 2] = Math.round(blue * hot);
    }
    const emissiveBytes = await sharp(emission, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
    emissiveFile = `${textures}/${id}-emission.png`;
    await writeFile(emissiveFile, emissiveBytes);
    emissiveSha256 = hash(emissiveBytes);
    const tex = doc.createTexture(`${id}_imagegen_ember_cracks`).setImage(emissiveBytes).setMimeType('image/png');
    material.setEmissiveTexture(tex).setEmissiveFactor(id === 'creature_furnace_grazer' ? [0.8, 0.38, 0.13] : [1, 0.48, 0.16]);
  }

  const output = `${models}/${id}.glb`;
  await io.write(output, doc);
  const outputBytes = await readFile(output);
  const record = {
    id, candidateFile: output, sha256: hash(outputBytes), bytes: outputBytes.length,
    bounds: source.bounds ?? { min: [source.base.x, source.base.y, source.base.z], max: [source.base.x + source.size.x, source.base.y + source.size.y, source.base.z + source.size.z] },
    size: source.size, materials: [material.getName()], animations: doc.getRoot().listAnimations().map(a => a.getName()),
    attack: { seconds: source.attackSeconds, contactNormalized: source.contactNormalized },
    sourceProvenance: {
      sourceAssetId: sourceId, productionFile: `game/public/assets/${source.file}`, pinnedSourceFile: sourceFile, productionSha256: source.sha256,
      upstreamAuthor: source.sourceProvenance.author, upstreamPack: source.sourceProvenance.pack,
      upstreamSource: source.sourceProvenance.source, upstreamLicense: source.sourceProvenance.license,
      generatedMap: generatedMapFile, generatedMapSha256: hash(generatedBytes),
      runtimeMap: albedoFile, runtimeMapSha256: hash(albedoBytes),
      emissionMap: emissiveFile, emissionMapSha256: emissiveSha256, builder: `${root}/build.mjs`, builderSha256,
      change: id === 'creature_basalt_drake' ? 'Image-generated UV-aligned basalt plate albedo. Original geometry, rig, clips, normal map and ORM retained.' : id === 'creature_furnace_grazer' ? 'Image-generated UV-aligned heated plate albedo and derived crack emission. Original geometry, rig, clips, normal map and ORM retained.' : 'Candidate-only level 88-89 Basalt Maw presentation from the current grazer rig, with darker image-generated plates, hot jaw and crack emission. Preserve creature_basalt_maw for its pending new source.',
    },
    acceptance: { exported: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
  if (id === 'creature_basalt_maw_high_tier') record.contentRecommendation = {
    creatureDefinitionIds: ['wilderness_east_basalt_prowl', 'far_cinder_smithy_sentries', 'wilderness_basalt_maw_hollow'],
    assetId: id, presentationScale: 1.05, activity: 'prowl',
    note: 'Use only for the three level 88-89 Basalt Maw presets currently mapped to creature_furnace_grazer. Keep creature_basalt_maw and its level 90 use pending a new source. The grazer rig silhouette remains a limitation.',
  };
  promotion.assets.push(record);
  catalog.assets.push({ ...source, id, file: `models/creature/${id}.glb`, pack: catalog.pack.id,
    is: id === 'creature_basalt_maw_high_tier' ? 'A high-tier basalt predator with black armor plates and a white-hot mouth.' : source.is,
    bytes: record.bytes, sha256: record.sha256,
    metadata: id === 'creature_basalt_maw_high_tier' ? { ...source.metadata, id: 'basalt_maw_high_tier', candidateOnly: true, sourceAssetId: sourceId } : source.metadata,
    materials: record.materials, sourceProvenance: record.sourceProvenance, candidateFile: `models/${id}.glb`,
    contentRecommendation: record.contentRecommendation, acceptance: record.acceptance });
  console.log(JSON.stringify({ id, file: output, sha256: record.sha256, bytes: record.bytes }));
}

await writeFile(`${root}/lab-catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(`${root}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n');
