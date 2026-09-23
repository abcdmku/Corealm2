import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/audit-petalguards';
const sourcePath = 'assets/art/tripo/imports/creatures/audit-fae-insects/orchid-reaper-candidate.glb';
const sourceSha256 = '668b4e2918c9318ee1b7891102a2764eb1c5974b8cd2f0c9a08ce8a4e41ed7e3';
const variants = [
  { id: 'fairy_garden_petalguard_faeholme', name: 'Moonstone Petalguard', region: 'faeholme', level: 60,
    actorScale: 1.1148188375099055, meshScale: .70, atlas: 'moonstone-petalguard-basecolor.png' },
  { id: 'fairy_garden_petalguard_gloamgarden', name: 'Silverleaf Petalguard', region: 'gloamgarden', level: 30,
    actorScale: 1.1810205326218628, meshScale: .45, atlas: 'silverleaf-petalguard-basecolor.png' },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const generatorSha256 = hash(await readFile(import.meta.filename));
const bytes = await readFile(sourcePath);
assert.equal(hash(bytes), sourceSha256, 'Repaired Orchid source changed.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(here, { recursive: true });

function retimeDeath(doc) {
  const death = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death');
  assert(death, 'Missing repaired Orchid Death clip.');
  const oldAnchors = [0, .22, .52, .90, 1.25, 1.55];
  const newAnchors = [0, .12, .35, .56, .70, .74];
  const remap = time => {
    if (time <= 0) return 0;
    for (let index = 0; index < oldAnchors.length - 1; index++) {
      if (time <= oldAnchors[index + 1] + 1e-5) {
        const fraction = (time - oldAnchors[index]) / (oldAnchors[index + 1] - oldAnchors[index]);
        return newAnchors[index] + (newAnchors[index + 1] - newAnchors[index]) * fraction;
      }
    }
    return newAnchors.at(-1);
  };
  for (const channel of death.listChannels()) {
    const sampler = channel.getSampler();
    assert.equal(sampler.getInterpolation(), 'LINEAR', 'Unexpected Death interpolation.');
    const input = sampler.getInput();
    const output = sampler.getOutput();
    const originalTimes = input.getArray();
    const originalValues = output.getArray();
    const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
    assert.equal(originalValues.length, originalTimes.length * width);
    const mapped = Array.from(originalTimes, remap);
    for (let index = 1; index < mapped.length; index++) assert(mapped[index] > mapped[index - 1], 'Death retime lost monotonic keys.');
    mapped.push(1.55);
    const last = Array.from(originalValues.slice(originalValues.length - width));
    input.setArray(Float32Array.from(mapped));
    output.setArray(Float32Array.from([...originalValues, ...last]));
  }
}

const records = [];
const assets = [];
const files = {};
for (const variant of variants) {
  const atlasPath = `${here}/textures/${variant.atlas}`;
  const atlas = await readFile(atlasPath);
  const atlasMeta = await sharp(atlas).metadata();
  assert.equal(atlasMeta.width, 2048);
  assert.equal(atlasMeta.height, 2048);
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  assert.deepEqual(root.listAnimations().map(clip => clip.getName()), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const arrays = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].map(name => [name, primitive.getAttribute(name)?.getArray()]));
  const indices = primitive.getIndices()?.getArray();
  assert(Object.values(arrays).every(Boolean) && indices, 'Repaired Orchid geometry/skin incomplete.');
  const material = root.listMaterials()[0];
  const base = material?.getBaseColorTexture();
  const normal = material?.getNormalTexture();
  const orm = material?.getMetallicRoughnessTexture();
  assert(base && normal && orm, 'Repaired Orchid PBR maps incomplete.');
  const normalSha = hash(normal.getImage()), ormSha = hash(orm.getImage());
  base.setImage(atlas).setMimeType('image/png').setName(`${variant.id}_imagegen_basecolor_2k`);
  const container = root.listNodes().find(node => node.getName() === 'OrchidReaperPresentation');
  assert(container, 'Missing Orchid presentation transform.');
  const originalScale = container.getScale()[0];
  assert(Math.abs(originalScale - 2.4011727338660536) < 1e-5);
  container.setScale([originalScale * variant.meshScale, originalScale * variant.meshScale, originalScale * variant.meshScale]);
  retimeDeath(doc);
  const file = `${variant.id}.glb`;
  const output = await io.writeBinary(doc);
  const check = (await io.readBinary(output)).getRoot();
  const checkPrimitive = check.listMeshes()[0].listPrimitives()[0];
  for (const [name, before] of Object.entries(arrays)) {
    const after = checkPrimitive.getAttribute(name)?.getArray();
    assert(after && after.length === before.length, `${name} changed length.`);
    for (let index = 0; index < before.length; index++) assert.equal(after[index], before[index], `${name} changed at ${index}.`);
  }
  const indexAfter = checkPrimitive.getIndices()?.getArray();
  assert(indexAfter && indexAfter.length === indices.length);
  for (let index = 0; index < indices.length; index++) assert.equal(indexAfter[index], indices[index]);
  assert.equal(check.listSkins()[0].listJoints().length, 29);
  assert.equal(hash(check.listMaterials()[0].getNormalTexture().getImage()), normalSha);
  assert.equal(hash(check.listMaterials()[0].getMetallicRoughnessTexture().getImage()), ormSha);
  assert.deepEqual(check.listAnimations().map(clip => clip.getName()), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);
  await writeFile(`${here}/${file}`, output);
  const factor = variant.meshScale;
  const size = { x: 1.6730827593881146 * factor, y: 2.4 * factor, z: .7820225651800087 * factor };
  const bounds = { min: [-size.x / 2, 0, -size.z / 2], max: [size.x / 2, size.y, size.z / 2] };
  const record = { ...variant, file, bytes: output.length, sha256: hash(output), atlasPath, atlasSha256: hash(atlas),
    normalSha256: normalSha, ormSha256: ormSha, size, bounds, expectedDrawnHeight: Number((size.y * variant.actorScale).toFixed(3)) };
  records.push(record);
  files[variant.id] = file;
  assets.push({
    id: variant.id, file: `models/fairy-garden/${file}`, candidateFile: file, pack: 'corealm-audit-petalguards',
    category: 'character', is: variant.name, tags: ['creature', 'fairy', 'botanical', 'orchid', 'petalguard', 'candidate'],
    bytes: record.bytes, sha256: record.sha256, size, base: { x: bounds.min[0], y: 0, z: bounds.min[2] }, bounds,
    groundY: 0, triangles: 5868, vertices: 3666, animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
    materials: [material.getName()], walkClipSeconds: 1, runClipSeconds: .72, attackSeconds: .90, contactNormalized: .5,
    impliedWalkMps: null, impliedRunMps: null, measuredGait: null, locomotionPolicy: null,
    sourceProvenance: { sourceFile: sourcePath, sourceSha256, originalTripoModelId: '4c599d13-d2e0-4099-93f0-79bf17056049',
      atlasFile: atlasPath, atlasSha256: record.atlasSha256, originalNormalAndOrmRetained: true,
      rigMethod: 'Repaired 29-joint Orchid generic rig, unchanged mesh/skin, all Death channels retimed to complete collapse by 0.74s.' },
    metadata: { family: 'garden_petalguard', region: variant.region, level: variant.level,
      anatomy: 'Nonhuman orchid-mantis with shield-like calyx forearm and hooked thorn blade.',
      desiredInGameHeightMeters: record.expectedDrawnHeight, locomotion: 'biped; speed uncalibrated',
      deathPose: 'prone collapse complete by 0.74s; CPU floor clearance verified in staged GLB' },
    acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  });
}
assert.notEqual(records[0].atlasSha256, records[1].atlasSha256, 'Petalguard atlases must differ.');
const pack = { id: 'corealm-audit-petalguards', name: 'Corealm Orchid Petalguards', author: 'Corealm', source: `${here}/build-candidate.mjs`, generatorSha256, license: 'LicenseRef-Corealm-Original' };
const catalog = { schema: 'corealm-petalguard-candidates/1', accepted: false, status: 'awaiting-root-lab-review', source: { file: sourcePath, sha256: sourceSha256 },
  targets: records, acceptance: { geometryPreserved: true, originalPbrPreserved: true, cpuMotionValidated: false, texturesReviewedInLab: false, labAccepted: false, worldIntegrated: false } };
const lab = { schema: 'corealm-lab-asset-candidates/1', pack, assets, files };
const promotion = { schema: 'corealm-creature-promotion/1', pack, assets, sourceRoot: here, destinationRoot: 'game/public/assets', apply: false,
  prerequisite: 'Root lab browser state and screenshot review of both textures, shield/blade silhouette and Death collapse.' };
await Promise.all([
  writeFile(`${here}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n'),
  writeFile(`${here}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n'),
  writeFile(`${here}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n'),
]);
console.log(JSON.stringify(records.map(({ id, sha256, expectedDrawnHeight }) => ({ id, sha256, expectedDrawnHeight })), null, 2));
