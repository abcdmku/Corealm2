import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/audit-leafwing-variants';
const sourcePath = 'assets/art/tripo/imports/creatures/starred-leafwing/ambervein-leafwing-native-rig.glb';
const sourceSha256Expected = '8abc77857fd8583025e09eba672ca8223100e8e9e8374b3f687cbe5336fd1ec6';
const variants = [
  { id: 'fairy_garden_imp_faeholme', name: 'Twilight Imp', level: 60, region: 'faeholme', actorScale: .6317306745889465, atlas: 'fairy_garden_imp_faeholme-basecolor.png' },
  { id: 'fairy_garden_imp_gloamgarden', name: 'Lantern Imp', level: 30, region: 'gloamgarden', actorScale: .6692449684857222, atlas: 'fairy_garden_imp_gloamgarden-basecolor.png' },
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const generatorSha256 = sha256(await readFile(import.meta.filename));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
assert.equal(sha256(sourceBytes), sourceSha256Expected, 'Leafwing rig source changed.');
await mkdir(here, { recursive: true });

function finishDeathOnGround(doc) {
  const root = doc.getRoot();
  const death = root.listAnimations().find(clip => clip.getName() === 'Death');
  const rootNode = root.listNodes().find(node => node.getName() === 'LeafwingRoot');
  assert(death && rootNode, 'Missing Death clip or root joint.');
  const translation = death.listChannels().find(channel => channel.getTargetNode() === rootNode && channel.getTargetPath() === 'translation');
  assert(translation, 'Death clip does not animate root translation.');
  const times = Float32Array.from(translation.getSampler().getInput().getArray());
  assert.equal(times.length, 6);
  const translations = [
    [0, 0, 0], [0, .02, 0], [0, .12, 0], [0, .30, 0], [0, .36, 0], [0, .36, 0],
  ];
  translation.getSampler().getOutput().setArray(Float32Array.from(translations.flat()));
  const angles = [0, .10, .66, 1.30, 1.57, 1.57];
  const rotations = angles.flatMap(angle => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]);
  const buffer = root.listBuffers()[0];
  const input = doc.createAccessor('Death_LeafwingRoot_rotation_time').setArray(times).setType(Accessor.Type.SCALAR).setBuffer(buffer);
  const output = doc.createAccessor('Death_LeafwingRoot_rotation_value').setArray(Float32Array.from(rotations)).setType(Accessor.Type.VEC4).setBuffer(buffer);
  const sampler = doc.createAnimationSampler('Death_LeafwingRoot_rotation').setInput(input).setOutput(output).setInterpolation('LINEAR');
  death.addSampler(sampler).addChannel(doc.createAnimationChannel('Death_LeafwingRoot_rotation').setTargetNode(rootNode).setTargetPath('rotation').setSampler(sampler));
}

const records = [];
const labAssets = [];
const files = {};
for (const variant of variants) {
  const atlasPath = `${here}/textures/${variant.atlas}`;
  const atlas = await readFile(atlasPath);
  const imageMeta = await sharp(atlas).metadata();
  assert.equal(imageMeta.width, 2048, `${variant.id} atlas must be 2K.`);
  assert.equal(imageMeta.height, 2048, `${variant.id} atlas must be 2K.`);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  assert.deepEqual(root.listAnimations().map(clip => clip.getName()), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);
  const mesh = root.listMeshes()[0];
  const primitive = mesh.listPrimitives()[0];
  const position = primitive.getAttribute('POSITION')?.getArray();
  const normalArray = primitive.getAttribute('NORMAL')?.getArray();
  const uvArray = primitive.getAttribute('TEXCOORD_0')?.getArray();
  const indexArray = primitive.getIndices()?.getArray();
  const joints = primitive.getAttribute('JOINTS_0')?.getArray();
  const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
  assert(position?.length === 2682 * 3 && normalArray && uvArray && indexArray && joints && weights, 'Source geometry or skin changed.');
  const material = root.listMaterials()[0];
  const baseColor = material?.getBaseColorTexture();
  const normal = material?.getNormalTexture();
  const roughness = material?.getMetallicRoughnessTexture();
  assert(baseColor && normal && roughness, 'Source PBR maps missing.');
  const originalNormalSha256 = sha256(normal.getImage());
  const originalRoughnessSha256 = sha256(roughness.getImage());
  baseColor.setImage(atlas).setMimeType('image/png').setName(`${variant.id}_imagegen_basecolor_2k`);
  finishDeathOnGround(doc);
  assert.equal(sha256(normal.getImage()), originalNormalSha256);
  assert.equal(sha256(roughness.getImage()), originalRoughnessSha256);
  const file = `${variant.id}.glb`;
  const bytes = await io.writeBinary(doc);
  const readback = await io.readBinary(bytes);
  const checkRoot = readback.getRoot();
  const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
  const sameArray = (label, before, after) => {
    assert.equal(after?.length, before.length, `${variant.id} ${label} length changed.`);
    for (let index = 0; index < before.length; index++) assert.equal(after[index], before[index], `${variant.id} ${label} changed at ${index}.`);
  };
  sameArray('positions', position, checkPrimitive.getAttribute('POSITION')?.getArray());
  sameArray('normals', normalArray, checkPrimitive.getAttribute('NORMAL')?.getArray());
  sameArray('UVs', uvArray, checkPrimitive.getAttribute('TEXCOORD_0')?.getArray());
  sameArray('indices', indexArray, checkPrimitive.getIndices()?.getArray());
  sameArray('joints', joints, checkPrimitive.getAttribute('JOINTS_0')?.getArray());
  sameArray('weights', weights, checkPrimitive.getAttribute('WEIGHTS_0')?.getArray());
  assert.equal(checkRoot.listSkins()[0].listJoints().length, 33, 'Export lost a rig joint.');
  assert.equal(checkRoot.listAnimations().length, 6, 'Export lost gameplay clips.');
  assert.equal(sha256(checkRoot.listMaterials()[0].getNormalTexture().getImage()), originalNormalSha256);
  assert.equal(sha256(checkRoot.listMaterials()[0].getMetallicRoughnessTexture().getImage()), originalRoughnessSha256);
  await writeFile(`${here}/${file}`, bytes);
  const dimensions = { x: .98779296875, y: .9604492783546448, z: .70751953125 };
  const bounds = { min: [-.493896484375, 0, -.353759765625], max: [.493896484375, .9604492783546448, .353759765625] };
  const record = {
    ...variant, file, bytes: bytes.length, sha256: sha256(bytes), atlasPath,
    atlasSha256: sha256(atlas), normalSha256: originalNormalSha256, roughnessSha256: originalRoughnessSha256,
    dimensions, bounds, expectedDrawnHeight: Number((dimensions.y * variant.actorScale).toFixed(3)),
  };
  records.push(record);
  files[variant.id] = file;
  labAssets.push({
    id: variant.id, file: `models/fairy-garden/${file}`, candidateFile: file, pack: 'corealm-leafwing-imp-candidates', category: 'character',
    is: variant.name, tags: ['creature', 'fairy', 'flying', 'insect', 'imagegen-variant', 'candidate'],
    bytes: record.bytes, sha256: record.sha256, size: dimensions, base: { x: bounds.min[0], y: 0, z: bounds.min[2] }, bounds,
    groundY: 0, triangles: 3754, vertices: 2682, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
    materials: [material.getName()], walkClipSeconds: 1, runClipSeconds: .72, attackSeconds: .9, contactNormalized: .5,
    sourceProvenance: { sourceFile: sourcePath, sourceSha256: sourceSha256Expected, atlasFile: atlasPath,
      atlasSha256: record.atlasSha256, originalNormalAndOrmRetained: true,
      rigMethod: 'Existing 33-joint leafwing skeleton and full skin weights; staged Death end pose lays body and wings against ground.' },
    acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  });
}
assert.notEqual(records[0].atlasSha256, records[1].atlasSha256, 'Variant textures must be distinct.');
const catalog = { schema: 'corealm-leafwing-variant-candidates/1', accepted: false, status: 'awaiting-root-lab-review', source: { file: sourcePath, sha256: sourceSha256Expected },
  targets: records, exclusions: ['creature_lantern_sprite', 'creature_orchid_reaper', 'fairy_guardian_08_faeholme', 'fantasy_monster_08'],
  acceptance: { geometryPreserved: true, rigValidated: false, animationValidated: false, texturesReviewed: false, labAccepted: false, worldIntegrated: false } };
const pack = { id: 'corealm-leafwing-imp-candidates', name: 'Leafwing imp candidates', author: 'Corealm', source: `${here}/build-candidate.mjs`, generatorSha256, license: 'LicenseRef-Corealm-Original' };
const lab = { schema: 'corealm-lab-asset-candidates/1', pack, assets: labAssets, files };
const promotion = { schema: 'corealm-creature-promotion/1', sourceRoot: here, destinationRoot: 'game/public/assets', pack, assets: labAssets,
  apply: false, prerequisite: 'Root lab browser state and screenshot acceptance for both variants and Death end poses.' };
await Promise.all([
  writeFile(`${here}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n'),
  writeFile(`${here}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n'),
  writeFile(`${here}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n'),
]);
console.log(JSON.stringify(records.map(({ id, sha256, expectedDrawnHeight }) => ({ id, sha256, expectedDrawnHeight })), null, 2));
