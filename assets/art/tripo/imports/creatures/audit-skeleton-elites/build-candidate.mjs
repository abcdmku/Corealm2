import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/audit-skeleton-elites';
const sourceRoot = 'game/public/assets/models/creature';
const pack = {
  id: 'corealm-rpg-dungeon-skeletons-demo', name: 'Corealm RPG derivatives — Dungeon Skeletons Demo',
  author: 'Polygon Blacksmith',
  source: 'https://assetstore.unity.com/packages/3d/characters/creatures/dungeon-skeletons-demo-71087',
  license: 'Standard Unity Asset Store EULA; additional components retain their per-asset source licenses; Corealm additions project-owned',
  archiveSha256: '9e9e40c66eda22d756dd256bf670fcf5edc28bf0b4bba5026daa204791fdf23c',
  assetStoreId: '71087', sourceArchive: 'Dungeon Skeletons Demo.unitypackage',
  upstreamPackId: 'dungeon-skeletons-demo',
  derivation: 'Licensed source mesh, rig and animation retained; distinct Corealm image-generated albedo atlases and modest elite presentation scale.',
};
const sources = [
  { kind: 'archer', id: 'creature_skeleton_archer_elite', name: 'Veteran Skeleton Archer', sourceSha256: 'aadfc7aa677557a9a6f50076b2ef8b19cd99dcf7ad4682c8b65d2b2f33c94ba0',
    scale: 1.08, nativeSize: [0.8372029468515483, 1.6491435861654662, 0.8129906793584354], nativeBase: [-0.45772806064275917, 0.0032741110492161326, -0.387269709140566] },
  { kind: 'mage', id: 'creature_skeleton_mage_elite', name: 'Veteran Skeleton Mage', sourceSha256: '81e99af3566e3f57e9ccc1d876d59e222835c73d7f64c753b9eff0bd450bf4ec',
    scale: 1.06, nativeSize: [0.8587404611245357, 1.944003111105155, 0.8129906793584354], nativeBase: [-0.46579720188976476, 0.0032741110492161326, -0.387269709140566] },
  { kind: 'soldier', id: 'creature_skeleton_soldier_elite', name: 'Veteran Skeleton Soldier', sourceSha256: 'b2eea4126ec0042d046960724cb03e631ddc1738c73ab0434a3b69c1f58b0710',
    scale: 1.12, nativeSize: [1.2294581210833742, 1.5959422176642555, 0.8351349091732603], nativeBase: [-0.872976577198899, 0.0032741110492161326, -0.387269709140566] },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const generatorSha256 = hash(await readFile(import.meta.filename));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(here, { recursive: true });
const records = [], assets = [], files = {};
const expectedClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];

for (const entry of sources) {
  const sourcePath = `${sourceRoot}/creature_skeleton_${entry.kind}.glb`;
  const source = await readFile(sourcePath);
  assert.equal(hash(source), entry.sourceSha256, `${entry.kind} starter source changed; reevaluate tier split.`);
  const bonePath = `${here}/textures/${entry.kind}-bone.png`;
  const equipmentPath = `${here}/textures/${entry.kind}-equipment.png`;
  const [boneImage, equipmentImage] = await Promise.all([readFile(bonePath), readFile(equipmentPath)]);
  for (const [label, image] of [['bone', boneImage], ['equipment', equipmentImage]]) {
    const meta = await sharp(image).metadata();
    assert.equal(meta.width, 2048, `${entry.kind} ${label} atlas must be 2K.`);
    assert.equal(meta.height, 2048, `${entry.kind} ${label} atlas must be 2K.`);
  }
  const doc = await io.readBinary(source);
  const root = doc.getRoot();
  assert.deepEqual(root.listAnimations().map(clip => clip.getName()), expectedClips);
  assert.equal(root.listSkins()[0].listJoints().length, 24);
  const materials = root.listMaterials();
  const boneTexture = materials.find(material => material.getName().endsWith('_DS_Skeleton_standard'))?.getBaseColorTexture();
  const equipmentTexture = materials.find(material => material.getName().endsWith('_DS_equipment_standard'))?.getBaseColorTexture();
  assert(boneTexture && equipmentTexture, `${entry.kind} UV materials missing.`);
  const originalBoneSha256 = hash(boneTexture.getImage());
  const originalEquipmentSha256 = hash(equipmentTexture.getImage());
  const geometryBefore = root.listMeshes().map(mesh => mesh.listPrimitives().map(primitive => ({
    position: primitive.getAttribute('POSITION')?.getArray(), normal: primitive.getAttribute('NORMAL')?.getArray(),
    uv: primitive.getAttribute('TEXCOORD_0')?.getArray(), joints: primitive.getAttribute('JOINTS_0')?.getArray(),
    weights: primitive.getAttribute('WEIGHTS_0')?.getArray(), indices: primitive.getIndices()?.getArray(),
  })));
  boneTexture.setImage(boneImage).setMimeType('image/png').setName(`${entry.id}_imagegen_bone_2k`);
  equipmentTexture.setImage(equipmentImage).setMimeType('image/png').setName(`${entry.id}_imagegen_equipment_2k`);
  const sceneRoot = root.listScenes()[0].listChildren()[0];
  assert(sceneRoot?.getName() === `skeleton_${entry.kind}` && sceneRoot.getScale().every(value => value === 1));
  sceneRoot.setScale([entry.scale, entry.scale, entry.scale]);
  const output = await io.writeBinary(doc);
  const check = (await io.readBinary(output)).getRoot();
  assert.deepEqual(check.listAnimations().map(clip => clip.getName()), expectedClips);
  assert.equal(check.listSkins()[0].listJoints().length, 24);
  assert.equal(check.listMeshes().length, geometryBefore.length);
  const compare = (name, before, after) => {
    assert.equal(Boolean(after), Boolean(before), `${entry.kind} ${name} presence changed.`);
    if (!before) return;
    assert.equal(after.length, before.length, `${entry.kind} ${name} length changed.`);
    for (let index = 0; index < before.length; index++) assert.equal(after[index], before[index], `${entry.kind} ${name} changed at ${index}.`);
  };
  for (let meshIndex = 0; meshIndex < geometryBefore.length; meshIndex++) {
    const primitives = check.listMeshes()[meshIndex].listPrimitives();
    assert.equal(primitives.length, geometryBefore[meshIndex].length);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
      const before = geometryBefore[meshIndex][primitiveIndex], after = primitives[primitiveIndex];
      for (const [name, key] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv'], ['JOINTS_0', 'joints'], ['WEIGHTS_0', 'weights']])
        compare(name, before[key], after.getAttribute(name)?.getArray());
      compare('indices', before.indices, after.getIndices()?.getArray());
    }
  }
  const outputMaterials = check.listMaterials();
  const checkBone = outputMaterials.find(material => material.getName().endsWith('_DS_Skeleton_standard'))?.getBaseColorTexture();
  const checkEquipment = outputMaterials.find(material => material.getName().endsWith('_DS_equipment_standard'))?.getBaseColorTexture();
  assert.equal(hash(checkBone.getImage()), hash(boneImage));
  assert.equal(hash(checkEquipment.getImage()), hash(equipmentImage));
  const file = `${entry.id}.glb`;
  await writeFile(`${here}/${file}`, output);
  const size = { x: entry.nativeSize[0] * entry.scale, y: entry.nativeSize[1] * entry.scale, z: entry.nativeSize[2] * entry.scale };
  const base = { x: entry.nativeBase[0] * entry.scale, y: entry.nativeBase[1] * entry.scale, z: entry.nativeBase[2] * entry.scale };
  const record = { id: entry.id, name: entry.name, kind: entry.kind, sourcePath, sourceSha256: entry.sourceSha256,
    file, bytes: output.length, sha256: hash(output), eliteScale: entry.scale, size, base,
    maps: { bone: { file: bonePath, sha256: hash(boneImage), originalSha256: originalBoneSha256 },
      equipment: { file: equipmentPath, sha256: hash(equipmentImage), originalSha256: originalEquipmentSha256 } } };
  records.push(record);
  files[entry.id] = file;
  assets.push({
    id: entry.id, file: `models/creature/${file}`, candidateFile: file, pack: pack.id, category: 'character',
    is: entry.name, tags: ['creature', 'skeleton', 'undead', 'elite', 'imagegen-texture', entry.kind],
    bytes: record.bytes, sha256: record.sha256, size, base, groundY: base.y,
    triangles: root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((part, primitive) => part + (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3, 0), 0),
    animations: expectedClips, materials: outputMaterials.map(material => material.getName()),
    sourceProvenance: { publisher: 'Polygon Blacksmith', package: 'Dungeon Skeletons Demo.unitypackage',
      archiveSha256: pack.archiveSha256, license: pack.license, sourceAssetId: `creature_skeleton_${entry.kind}`,
      sourceFile: sourcePath, sourceSha256: entry.sourceSha256, candidateFile: `${here}/${file}`, candidateSha256: record.sha256,
      modification: 'Corealm built-in imagegen edited two UV albedo atlases; source geometry, skeleton, skin, props and eight animation clips retained. Presentation scaled for elite tier.',
      imagegenMaps: record.maps, generator: `${here}/build-candidate.mjs`, generatorSha256 },
    metadata: { family: `skeleton_${entry.kind}`, tier: 'elite', scaleFactor: entry.scale,
      artDirection: 'Veteran crypt undead with restrained weathered gear, layered bone wear and fine material detail.',
      silhouetteLimit: 'The licensed source gear geometry is unchanged; lab must decide whether the upgraded textures read as high-tier at normal camera distance.' },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
  });
}
assert.equal(new Set(records.flatMap(record => [record.maps.bone.sha256, record.maps.equipment.sha256])).size, 6, 'All elite maps must be distinct.');
const catalog = { schema: 'corealm-skeleton-elite-candidates/1', accepted: false, status: 'awaiting-root-lab-review',
  sourcePack: pack.id, targets: records, starterAssetsPreserved: true,
  tierSelectors: {
    archer: ['skeleton_archer_t50', 'skeleton_archer_t70', 'black_keep_gate_archers'],
    mage: ['skeleton_mage_t50', 'skeleton_mage_t70', 'black_keep_north_graves'],
    soldier: ['skeleton_soldier_t50', 'skeleton_soldier_t70', 'wilderness_broken_watch', 'black_keep_gate_guard',
      'wilderness_bone_patrol', 'broken_watch_tower_haunt', 'dead_smithy_haunt', 'outer_watch_haunt', 'eastern_cloister_haunt'],
  },
  acceptance: { sourceMotionRetained: true, geometryRetained: true, imagegenAtlases: true, cpuMotionValidated: false, labAccepted: false, integrated: false } };
const lab = { schema: 'corealm-lab-asset-candidates/1', pack, assets, files };
const promotion = { schema: 'corealm-creature-promotion/1', pack, assets, sourceRoot: here, destinationRoot: 'game/public/assets', apply: false,
  prerequisite: 'Root lab screenshot review must show elite visual distinction at normal gameplay distance; source gear geometry remains unchanged.' };
await Promise.all([
  writeFile(`${here}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n'),
  writeFile(`${here}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n'),
  writeFile(`${here}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n'),
]);
console.log(JSON.stringify(records.map(({ id, sha256, size }) => ({ id, sha256, size })), null, 2));
