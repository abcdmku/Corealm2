import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceManifestBytes = await readFile(path.join(here, 'source-manifest.json'));
const manifest = JSON.parse(sourceManifestBytes.toString());
const sourceManifestSha256 = sha(sourceManifestBytes);
const bytesOf = accessor => Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength);
const ids = ['animal_chicken', 'animal_rat', 'animal_viper', 'creature_red_worm'];
const finishes = {
  animal_chicken: { material: 'hen_layered_cream_plumage', finish: 'image-generated layered cream feathers, buff tips and intact red comb', contact: .43, seconds: .7 },
  animal_rat: { material: 'grainback_walnut_and_wheat_coat', finish: 'image-generated walnut fur with tawny dorsal grain and detailed face', contact: .43, seconds: .58 },
  animal_viper: { material: 'grassscale_olive_diamond_scales', finish: 'image-generated olive scales and ochre-edged dorsal diamonds', contact: .525, seconds: 1.666667 },
  creature_red_worm: { material: 'red_worm_moist_ringed_cuticle', finish: 'image-generated maroon and rust annuli, pores and moist cuticle', contact: .5, seconds: 1 },
};
const generator = 'assets/art/tripo/imports/creatures/audit-polish-small_wildlife/build-candidates.mjs';
const generatorSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
const packs = [];
const assets = [];
const promotion = [];
for (const id of ids) {
  const source = manifest.assets.find(asset => asset.id === id);
  const upstream = manifest.packs.find(pack => pack.id === source?.pack);
  if (!source || !upstream || !upstream.license.startsWith('Standard Unity Asset Store EULA')) throw new Error(`${id}: upstream changed`);
  const pinnedSourceFile = `sources/${id}.glb`;
  const sourceFile = path.join(here, pinnedSourceFile);
  const original = await readFile(sourceFile);
  if (original.length !== source.bytes || sha(original) !== source.sha256.toLowerCase()) throw new Error(`${id}: source changed`);
  const mapFile = path.join(here, 'textures', `${id}-generated.png`);
  const generated = await readFile(mapFile);
  const mapMeta = await sharp(generated).metadata();
  if (mapMeta.width < 1024 || mapMeta.height < 1024) throw new Error(`${id}: generated map too small`);
  const io = new NodeIO();
  const doc = await io.readBinary(original);
  const root = doc.getRoot();
  if (root.listSkins().length !== 1 || root.listAnimations().length !== source.animations.length || root.listMaterials().length !== 1) throw new Error(`${id}: rig or material changed`);
  const material = root.listMaterials()[0];
  const texture = material.getBaseColorTexture();
  if (!texture) throw new Error(`${id}: no source atlas`);
  const mesh = root.listNodes().find(node => node.getMesh());
  if (!mesh || root.listNodes().filter(node => node.getMesh()).length !== 1) throw new Error(`${id}: source mesh changed`);
  const primitive = mesh.getMesh().listPrimitives()[0];
  const geometry = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].map(key => [key, sha(bytesOf(primitive.getAttribute(key)))]));
  geometry.INDICES = primitive.getIndices() ? sha(bytesOf(primitive.getIndices())) : null;
  const animations = root.listAnimations().map(animation => ({ name: animation.getName(), channels: animation.listChannels().map(channel => ({
    node: channel.getTargetNode()?.getName(), path: channel.getTargetPath(), input: sha(bytesOf(channel.getSampler().getInput())), output: sha(bytesOf(channel.getSampler().getOutput()))
  })) }));
  const skin = root.listSkins()[0];
  const joints = skin.listJoints().map(joint => joint.getName());
  const inverseBinds = sha(bytesOf(skin.getInverseBindMatrices()));
  const sourceMapSha256 = sha(texture.getImage());
  // The image tool makes a registered UV edit. Resolution is normalized here; topology, UVs and clips stay source-identical.
  const runtimeMap = await sharp(generated).resize(2048, 2048, { kernel: 'lanczos3' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  texture.setImage(runtimeMap).setMimeType('image/jpeg').setName(`${id}_generated_albedo_2k`);
  material.setName(finishes[id].material);
  if (id === 'creature_red_worm') material.setBaseColorFactor([.9, .72, .68, 1]);
  const output = await io.writeBinary(doc);
  const candidateFile = `models/${id}.glb`;
  await mkdir(path.join(here, 'models'), { recursive: true });
  await writeFile(path.join(here, candidateFile), output);
  const check = (await io.readBinary(output)).getRoot();
  const p = check.listNodes().find(node => node.getMesh())?.getMesh()?.listPrimitives()[0];
  if (!p || Object.entries(geometry).some(([key, value]) => {
    const accessor = key === 'INDICES' ? p.getIndices() : p.getAttribute(key);
    return accessor ? sha(bytesOf(accessor)) !== value : value !== null;
  })) throw new Error(`${id}: geometry changed`);
  const checkedAnimations = check.listAnimations().map(animation => ({ name: animation.getName(), channels: animation.listChannels().map(channel => ({
    node: channel.getTargetNode()?.getName(), path: channel.getTargetPath(), input: sha(bytesOf(channel.getSampler().getInput())), output: sha(bytesOf(channel.getSampler().getOutput()))
  })) }));
  if (JSON.stringify(checkedAnimations) !== JSON.stringify(animations) || JSON.stringify(check.listSkins()[0].listJoints().map(joint => joint.getName())) !== JSON.stringify(joints)
    || sha(bytesOf(check.listSkins()[0].getInverseBindMatrices())) !== inverseBinds) throw new Error(`${id}: rig or clips changed`);
  const pack = { ...upstream, id: `corealm-audit-polish-${id.replaceAll('_', '-')}`, name: `${upstream.name} — ${id} image-generated finish`,
    derivation: `${finishes[id].finish}; original native topology, UVs, skeleton, weights and clips preserved.`, generator, generatorSha256 };
  packs.push(pack);
  const asset = { ...source, pack: pack.id, candidateFile, bytes: output.length, sha256: sha(output), materials: [material.getName()],
    attackSeconds: finishes[id].seconds, contactNormalized: finishes[id].contact,
    tags: [...new Set([...source.tags, 'image-generated-texture'])],
    sourceProvenance: { upstreamPack: upstream.id, upstreamSource: upstream.source, upstreamLicense: upstream.license,
      upstreamArchiveSha256: upstream.archiveSha256, productionSourceFile: source.file, pinnedSourceFile,
      sourceManifestFile: 'source-manifest.json', sourceManifestSha256,
      productionSourceSha256: source.sha256,
      originalBaseColorSha256: sourceMapSha256, generatedMap: `textures/${id}-generated.png`, generatedMapSha256: sha(generated),
      runtimeBaseColorSha256: sha(runtimeMap), generator, generatorSha256,
      geometryPreserved: true, nativeSkinAndAnimationsPreserved: true },
    metadata: { finish: finishes[id].finish, review: 'pending root lab visual and motion acceptance' },
    acceptance: { exported: true, labAccepted: false, worldIntegrated: false } };
  assets.push(asset);
  promotion.push({ id, candidateFile, bytes: output.length, sha256: sha(output), sourceSha256: source.sha256,
    pinnedSourceFile, sourceManifestFile: 'source-manifest.json', sourceManifestSha256,
    bounds: { size: source.size, base: source.base }, material: material.getName(), animations: source.animations,
    attackSeconds: finishes[id].seconds, contactNormalized: finishes[id].contact, generatorSha256,
    labAccepted: false, worldIntegrated: false });
  console.log(`${id}: ${output.length} bytes ${sha(output)}; ${material.getName()}`);
}
const catalog = { schema: 'corealm-lab-asset-candidates/1', packs, assets, files: Object.fromEntries(assets.map(asset => [asset.id, asset.candidateFile])) };
await writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(path.join(here, 'promotion.json'), JSON.stringify({ schema: 'corealm-audit-polish-promotion/1', status: 'pending-root-lab-acceptance', generator, generatorSha256, assets: promotion }, null, 2) + '\n');
