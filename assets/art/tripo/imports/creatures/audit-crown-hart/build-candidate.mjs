import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourceFile = path.join(repo, 'game/public/assets/models/fairy-crown/creature_crown_hart.glb');
const mapFile = path.join(here, 'textures/crown-hart-generated.png');
const outputFile = path.join(here, 'models/creature_crown_hart.glb');
const manifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const sourceAsset = manifest.assets.find(asset => asset.id === 'creature_crown_hart');
const sourcePack = manifest.packs.find(pack => pack.id === sourceAsset?.pack);
if (!sourceAsset || !sourcePack || sourceAsset.file !== 'models/fairy-crown/creature_crown_hart.glb'
  || !sourcePack.license.startsWith('Standard Unity Asset Store EULA')) throw new Error('Crown Hart source/pack identity changed.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourceFile);
if (sourceBytes.length !== sourceAsset.bytes || sha(sourceBytes) !== sourceAsset.sha256) throw new Error('Production Crown Hart SHA/bytes changed.');
const generated = await readFile(mapFile);
const generatedMeta = await sharp(generated).metadata();
if (generatedMeta.width < 1024 || generatedMeta.height < 1024) throw new Error('Image-generated map too small for coat detail.');
const io = new NodeIO();
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const originalMeshes = root.listNodes().filter(node => node.getMesh());
if (originalMeshes.length !== 2 || !originalMeshes.some(node => node.getName() === 'deer_body')
  || !originalMeshes.some(node => node.getName() === 'deer_horns') || root.listSkins().length !== 2) {
  throw new Error('Deer body, antlers or native rigs changed.');
}
const bytesOf = accessor => Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength);
const geometry = Object.fromEntries(originalMeshes.map(node => {
  const primitive = node.getMesh().listPrimitives()[0];
  return [node.getName(), Object.fromEntries(['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0']
    .map(name => [name, sha(bytesOf(primitive.getAttribute(name)))]).concat([['INDICES', sha(bytesOf(primitive.getIndices()))]]))];
}));
const motion = animationFingerprint(root);
const skinFingerprints = root.listSkins().map(skin => ({ joints: skin.listJoints().map(node => node.getName()), inverseBinds: sha(bytesOf(skin.getInverseBindMatrices())) }));
const material = root.listMaterials()[0];
const sourceMap = material?.getBaseColorTexture();
if (!material || !sourceMap || root.listMaterials().length !== 1 || root.listTextures().length !== 1) throw new Error('Crown Hart material changed.');
const sourceMapSha = sha(sourceMap.getImage());
const runtimeMap = await sharp(generated).resize(2048, 2048, { kernel: 'lanczos3' })
  .jpeg({ quality: 93, mozjpeg: true }).toBuffer();
sourceMap.setImage(runtimeMap).setName('crown_hart_regal_woodland_coat_2k.jpg');
material.setName('crown_hart_regal_coat_and_ivory_antlers');
await mkdir(path.dirname(outputFile), { recursive: true });
const outputBytes = await io.writeBinary(doc);
await writeFile(outputFile, outputBytes);
const check = await io.readBinary(outputBytes);
const checkRoot = check.getRoot();
for (const node of checkRoot.listNodes().filter(node => node.getMesh())) {
  const original = geometry[node.getName()];
  if (!original) throw new Error(`Unexpected candidate node ${node.getName()}.`);
  const primitive = node.getMesh().listPrimitives()[0];
  for (const name of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0']) {
    if (sha(bytesOf(primitive.getAttribute(name))) !== original[name]) throw new Error(`${node.getName()} ${name} changed.`);
  }
  if (sha(bytesOf(primitive.getIndices())) !== original.INDICES) throw new Error(`${node.getName()} indices changed.`);
}
if (JSON.stringify(animationFingerprint(checkRoot)) !== JSON.stringify(motion)
  || JSON.stringify(checkRoot.listSkins().map(skin => ({ joints: skin.listJoints().map(node => node.getName()), inverseBinds: sha(bytesOf(skin.getInverseBindMatrices())) }))) !== JSON.stringify(skinFingerprints)) {
  throw new Error('Native deer rig or clips changed.');
}
const candidateSha = sha(outputBytes);
const generatorSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
const pack = { ...sourcePack, id: 'corealm-audit-crown-hart-regal', name: 'Corealm Crown Hart regal coat',
  derivation: 'Crown Hart native deer body, attached antlers and eight clips retained; image-generated layered coat/antler albedo replaces the original low-resolution albedo.',
  generator: 'assets/art/tripo/imports/creatures/audit-crown-hart/build-candidate.mjs', generatorSha256 };
const asset = {
  ...sourceAsset, pack: pack.id, is: 'crown hart',
  tags: [...new Set([...sourceAsset.tags, 'regal-hart', 'layered-woodland-coat', 'image-generated-texture'])],
  candidateFile: 'models/creature_crown_hart.glb', bytes: outputBytes.length, sha256: candidateSha,
  materials: [material.getName()],
  sourceProvenance: { upstreamPack: sourcePack.id, upstreamSource: sourcePack.source, upstreamLicense: sourcePack.license,
    upstreamArchiveSha256: sourcePack.archiveSha256, productionSourceFile: sourceAsset.file, productionSourceSha256: sourceAsset.sha256,
    originalBaseColorSha256: sourceMapSha, generatedMap: 'textures/crown-hart-generated.png', generatedMapSha256: sha(generated),
    runtimeBaseColorSha256: sha(runtimeMap), generator: pack.generator, generatorSha256,
    geometryPreserved: true, originalAntlersPreserved: true, nativeSkinsAndAnimationsPreserved: true },
  metadata: { family: 'crown_hart', height: sourceAsset.size.y, rig: 'original deer body and antler skins',
    texture: 'image-generated layered chestnut/russet fur, cream-gold flecks and ivory wood-grain antlers',
    review: 'pending root lab visual acceptance' },
  acceptance: { exported: true, labAccepted: false, worldIntegrated: false },
};
const catalog = { schema: 'corealm-lab-asset-candidates/1', pack, assets: [asset], files: { creature_crown_hart: asset.candidateFile } };
await writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify(catalog, null, 2)+'\n');
await writeFile(path.join(here, 'promotion-catalog.json'), JSON.stringify({ schema:'corealm-promoted-asset-candidates/1', pack,
  assets:[asset], status:'pending-root-lab-acceptance' }, null, 2)+'\n');
await writeFile(path.join(here, 'catalog.json'), JSON.stringify({ schema:'corealm-crown-hart-polish/1',
  source: { file: sourceAsset.file, sha256: sourceAsset.sha256, bytes: sourceAsset.bytes, pack: sourcePack.id, license: sourcePack.license,
    baseColorSha256: sourceMapSha, bodyVertices:1880, antlerVertices:397, bodyTriangles:3098, antlerTriangles:630 },
  candidate: { file:asset.candidateFile, sha256:candidateSha, bytes:outputBytes.length, material:material.getName(),
    generatedMap:asset.sourceProvenance.generatedMap, generatedMapSha256:sha(generated), runtimeBaseColorSha256:sha(runtimeMap),
    generatorSha256, geometry, skinFingerprints, animationFingerprints:motion },
  held: 'Antler geometry is retained: widening the separate skinned antler mesh risks detaching its bases from the deer skull.',
  status: 'pending-root-lab-visual-and-motion-review' },null,2)+'\n');
console.log(JSON.stringify({candidate:asset.candidateFile,sha256:candidateSha,bytes:outputBytes.length,
  sourceSha256:sourceAsset.sha256,mapSha256:sha(generated),runtimeMapSha256:sha(runtimeMap),clips:motion.map(a=>a.name)},null,2));

function animationFingerprint(root) {
  return root.listAnimations().map(animation => ({ name:animation.getName(), channels:animation.listChannels().map(channel => ({
    node:channel.getTargetNode()?.getName(), path:channel.getTargetPath(), interpolation:channel.getSampler().getInterpolation(),
    time:sha(bytesOf(channel.getSampler().getInput())), values:sha(bytesOf(channel.getSampler().getOutput())) })) }));
}
