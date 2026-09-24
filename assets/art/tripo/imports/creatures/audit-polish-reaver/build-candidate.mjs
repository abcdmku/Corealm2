import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const dir = 'assets/art/tripo/imports/creatures/audit-polish-reaver';
const source = 'assets/art/tripo/imports/creatures/audit-polish-reaver/sources/creature_gloamfang_reaver.glb';
const original = 'assets/art/tripo/imports/creatures/audit-polish-reaver/sources/original-reaver.glb';
const output = `${dir}/gloamfang-reaver-prowl-candidate.glb`;
const sourceSha256 = 'c285c181feab5ffade88c5d1f68c3459e83221b6909c0f97c925ce34ae1bd9c7';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(dir, { recursive: true });
const sourceBytes = await readFile(source);
assert.equal(hash(sourceBytes), sourceSha256, 'Production Gloamfang source changed');
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const mesh = root.listMeshes()[0];
assert.equal(skin.listJoints().length, 62);
assert.equal(root.listAnimations().length, 6);
const primitive = mesh.listPrimitives()[0];
const positionAccessor = primitive.getAttribute('POSITION');
const normalAccessor = primitive.getAttribute('NORMAL');
const sourcePositions = Float32Array.from(positionAccessor.getArray());
const sourceNormals = Float32Array.from(normalAccessor.getArray());
const smooth = (edge0, edge1, v) => {
  const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const bell = (v, center, radius) => Math.exp(-.5 * ((v - center) / radius) ** 2);
function sculpt([x, y, z]) {
  const core = 1 - smooth(.15, .245, Math.abs(x));
  const upper = bell(y, .655, .125) * core;
  const back = 1 - smooth(-.015, .055, z);
  const front = smooth(-.04, .045, z);
  const ridge = bell(x, 0, .11);
  const waist = bell(y, .46, .09) * core;
  const shoulder = bell(y, .695, .105) * smooth(.075, .15, Math.abs(x)) * (1 - smooth(.20, .32, Math.abs(x)));
  const hand = smooth(.425, .495, Math.abs(x)) * (1 - smooth(.795, .85, y)) * smooth(.67, .73, y);
  const toes = (1 - smooth(.055, .12, y)) * smooth(.025, .105, z);
  return [
    x * (1 - .115 * waist) + Math.sign(x) * (.021 * shoulder + .029 * hand),
    y + .017 * upper * back * ridge,
    z - .063 * upper * back * (.70 + .30 * ridge) + .031 * upper * front
      - .027 * waist * front + .018 * hand + .041 * toes,
  ];
}
const positions = new Float32Array(sourcePositions.length);
const normals = new Float32Array(sourceNormals.length);
const deriv = .0001;
let maxSculptM = 0;
for (let i = 0; i < positions.length; i += 3) {
  const p = [sourcePositions[i], sourcePositions[i + 1], sourcePositions[i + 2]];
  const changed = sculpt(p);
  positions.set(changed, i);
  maxSculptM = Math.max(maxSculptM, Math.hypot(changed[0] - p[0], changed[1] - p[1], changed[2] - p[2]));
  const derivatives = [0, 1, 2].map(axis => {
    const plus = [...p], minus = [...p];
    plus[axis] += deriv; minus[axis] -= deriv;
    const a = sculpt(plus), b = sculpt(minus);
    return a.map((value, component) => (value - b[component]) / (2 * deriv));
  });
  const jacobian = new THREE.Matrix3().set(
    derivatives[0][0], derivatives[1][0], derivatives[2][0],
    derivatives[0][1], derivatives[1][1], derivatives[2][1],
    derivatives[0][2], derivatives[1][2], derivatives[2][2],
  );
  const n = new THREE.Vector3(sourceNormals[i], sourceNormals[i + 1], sourceNormals[i + 2]);
  n.applyMatrix3(jacobian.invert().transpose()).normalize();
  normals.set(n.toArray(), i);
}
assert(maxSculptM > .025 && maxSculptM < .1, `Unexpected sculpt magnitude ${maxSculptM}`);
positionAccessor.setArray(positions);
normalAccessor.setArray(normals);
const jointByName = new Map(skin.listJoints().map(node => [node.getName(), node]));
const originalJointTranslations = new Map(skin.listJoints().map(node => [node.getName(), node.getTranslation()]));
const qx = angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
const offsets = new Map([
  ['Spine', .29], ['Chest', .20], ['UpperChest', .07], ['Head', -.12],
  ['Left_UpperLeg', -.27], ['Right_UpperLeg', -.27],
  ['Left_LowerLeg', .46], ['Right_LowerLeg', .46],
]);
const altered = [];
for (const animation of root.listAnimations()) {
  if (animation.getName() === 'Death') continue;
  const duration = Math.max(...animation.listSamplers().map(s => Math.max(...s.getInput().getArray())));
  const rotationChannels = new Map(animation.listChannels().filter(c => c.getTargetPath() === 'rotation')
    .map(c => [c.getTargetNode().getName(), c]));
  for (const [name, angle] of offsets) {
    let channel = rotationChannels.get(name);
    if (channel) {
      const sampler = channel.getSampler();
      const sourceValues = sampler.getOutput().getArray();
      const values = new Float32Array(sourceValues.length);
      for (let i = 0; i < sourceValues.length; i += 4) {
        const originalRotation = new THREE.Quaternion(...sourceValues.slice(i, i + 4));
        const next = originalRotation.multiply(qx(angle)).normalize();
        values.set(next.toArray(), i);
      }
      sampler.getOutput().setArray(values);
    } else {
      const input = doc.createAccessor(`${animation.getName()}_${name}_prowl_time`).setArray(new Float32Array([0, duration]))
        .setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
      const rotation = qx(angle).toArray();
      const outputValues = doc.createAccessor(`${animation.getName()}_${name}_prowl_rotation`)
        .setArray(new Float32Array([...rotation, ...rotation])).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]);
      const sampler = doc.createAnimationSampler(`${animation.getName()}_${name}_prowl`)
        .setInput(input).setOutput(outputValues).setInterpolation('LINEAR');
      channel = doc.createAnimationChannel(`${animation.getName()}_${name}_prowl`)
        .setTargetNode(jointByName.get(name)).setTargetPath('rotation').setSampler(sampler);
      animation.addSampler(sampler).addChannel(channel);
    }
  }
  // The knee bend brings the paws beneath the chest. Keep the root low without changing
  // limb lengths or moving the clavicles; exact mesh contact is rebaked below.
  const hips = animation.listChannels().find(c => c.getTargetNode()?.getName() === 'Hips' && c.getTargetPath() === 'translation');
  assert(hips, `${animation.getName()} has no root translation`);
  const values = Float32Array.from(hips.getSampler().getOutput().getArray());
  for (let i = 1; i < values.length; i += 3) values[i] -= .055;
  hips.getSampler().getOutput().setArray(values);
  const floor = animation.listChannels().find(c => c.getTargetNode()?.getName() === 'Gloamfang_TerrainContact' && c.getTargetPath() === 'translation');
  assert(floor, `${animation.getName()} has no terrain correction`);
  const old = floor.getSampler().getOutput().getArray();
  floor.getSampler().getOutput().setArray(new Float32Array(old.length));
  altered.push(animation.getName());
}

async function measurementBytes(bytes) {
  const measurement = await io.readBinary(bytes);
  for (const material of measurement.getRoot().listMaterials()) material.setBaseColorTexture(null)
    .setEmissiveTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);
  await measurement.transform(prune());
  return io.writeBinary(measurement);
}
async function loaded(bytes) {
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().parseAsync(array, '');
}
function box(scene) { scene.updateMatrixWorld(true); return new THREE.Box3().setFromObject(scene, true); }
const preContact = await measurementBytes(await io.writeBinary(doc));
const contact = [];
const sampleRate = 240;
for (const animation of root.listAnimations()) {
  if (!altered.includes(animation.getName())) continue;
  const live = await loaded(preContact);
  const clip = live.animations.find(c => c.name === animation.getName());
  assert(clip);
  const mixer = new THREE.AnimationMixer(live.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const frames = Math.ceil(clip.duration * sampleRate);
  const times = new Float32Array(frames + 1);
  const values = new Float32Array((frames + 1) * 3);
  let minUncorrected = Infinity, maxUncorrected = -Infinity;
  for (let frame = 0; frame <= frames; frame++) {
    const t = clip.duration * frame / frames;
    mixer.setTime(t);
    const ground = box(live.scene).min.y;
    times[frame] = t;
    values[frame * 3 + 1] = .002 - ground;
    minUncorrected = Math.min(minUncorrected, ground);
    maxUncorrected = Math.max(maxUncorrected, ground);
  }
  const floor = animation.listChannels().find(c => c.getTargetNode()?.getName() === 'Gloamfang_TerrainContact' && c.getTargetPath() === 'translation');
  floor.getSampler().getInput().setArray(times);
  floor.getSampler().getOutput().setArray(values);
  contact.push({ name: animation.getName(), duration: clip.duration, frames: frames + 1, minUncorrected, maxUncorrected });
}
const bytes = await io.writeBinary(doc);
const sha256 = hash(bytes);
const finalCpu = await measurementBytes(bytes);
const motion = [];
const union = new THREE.Box3();
for (const animation of root.listAnimations()) {
  const live = await loaded(finalCpu);
  const clip = live.animations.find(c => c.name === animation.getName());
  const mixer = new THREE.AnimationMixer(live.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const frames = Math.ceil(clip.duration * sampleRate * 2);
  let minY = Infinity, maxY = -Infinity, worstTime = 0;
  const clipBounds = new THREE.Box3();
  const samples = [];
  for (let frame = 0; frame <= frames; frame++) {
    const t = clip.duration * frame / frames;
    mixer.setTime(t);
    const bounds = box(live.scene);
    union.union(bounds);
    clipBounds.union(bounds);
    if (bounds.min.y < minY) { minY = bounds.min.y; worstTime = t; }
    maxY = Math.max(maxY, bounds.min.y);
    if (frame % Math.max(1, Math.floor(frames / 4)) === 0 || frame === frames) samples.push({ t, minY: bounds.min.y, maxY: bounds.max.y });
  }
  assert(minY >= -.002, `${clip.name} penetrates terrain ${minY} at ${worstTime}`);
  assert(maxY <= .015, `${clip.name} hovers ${maxY}`);
  motion.push({ name: clip.name, seconds: clip.duration,
    bounds: { min: clipBounds.min.toArray(), max: clipBounds.max.toArray() },
    minClearanceM: minY, maxClearanceM: maxY, samples });
}
assert.equal(mesh.listPrimitives()[0].getIndices().getCount() / 3, 4760);
for (const [name, translation] of originalJointTranslations) assert.deepEqual(jointByName.get(name).getTranslation(), translation);
const sourceDoc = await io.readBinary(sourceBytes);
const sourcePrim = sourceDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const candidatePrim = mesh.listPrimitives()[0];
for (const semantic of ['TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
  assert.deepEqual(Array.from(candidatePrim.getAttribute(semantic).getArray()), Array.from(sourcePrim.getAttribute(semantic).getArray()), `${semantic} changed`);
}
assert.equal(candidatePrim.getAttribute('POSITION').getCount(), sourcePrim.getAttribute('POSITION').getCount());
assert.equal(candidatePrim.getAttribute('NORMAL').getCount(), sourcePrim.getAttribute('NORMAL').getCount());
for (const [a, b] of [[candidatePrim.getIndices(), sourcePrim.getIndices()]]) assert.deepEqual(Array.from(a.getArray()), Array.from(b.getArray()));
for (let i = 0; i < root.listTextures().length; i++) assert.equal(hash(root.listTextures()[i].getImage()), hash(sourceDoc.getRoot().listTextures()[i].getImage()));
await writeFile(output, bytes);
const sourceManifest = JSON.parse(await readFile(`${dir}/source-manifest.json`, 'utf8'));
const sourceAsset = sourceManifest.assets.find(a => a.id === 'creature_gloamfang_reaver');
assert(sourceAsset);
const bounds = { min: union.min.toArray(), max: union.max.toArray() };
const measuredSize = union.getSize(new THREE.Vector3());
const size = { x: measuredSize.x, y: measuredSize.y, z: measuredSize.z };
const builderSha256 = hash(await readFile(new URL(import.meta.url)));
const provenance = { originalFile: original, originalSha256: hash(await readFile(original)),
  productionFile: 'game/public/assets/models/creature/creature_gloamfang_reaver.glb', pinnedSourceFile: source, productionSha256: sourceSha256,
  originalProjectId: '57fc524c-107c-4711-ad29-7219e29eed9f', originalCardId: '5d71797c-6492-46cb-a8f8-d0d9c62cb9bd',
  license: 'License not recorded in the source ledger; user-owned Tripo export', builder: `${dir}/build-candidate.mjs`, builderSha256,
  change: `Local ${maxSculptM.toFixed(4)} m maximum source-space sculpt shapes a raised back ridge, fuller forward chest, tapered waist, longer hand claws and deeper toe claws; original topology, UVs, skin weights and 2K PBR maps retained. Prowling biped pose pitches spine and chest, counter-rotates head, flexes knees and lowers hips in Idle, Walk, Run, Attack and Hit. Shoulder and clavicle transforms, bind matrices and limb lengths unchanged. Death retained.` };
const asset = { ...sourceAsset, pack: 'corealm-audit-polish-reaver', bytes: bytes.length, sha256,
  size, base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: 0,
  animations: motion.map(m => m.name), materials: root.listMaterials().map(m => m.getName()),
  attackSeconds: motion.find(m => m.name === 'Attack').seconds, contactNormalized: .34 / .86,
  sourceProvenance: provenance, acceptance: { assetAudit: false, sourceDesignAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false } };
asset.metadata = { family: sourceAsset.metadata.family, heightM: motion.find(m => m.name === 'Idle').bounds.max[1],
  dimensionsM: size, bounds, rig: sourceAsset.metadata.rig, sourceSkinned: true, boneCount: 62,
  sourceVertices: 8047, triangles: 4760, source: sourceAsset.metadata.source,
  candidate: { file: output, sha256, bytes: bytes.length, geometry: { vertices: 8047, triangles: 4760,
    animatedBoundsMeters: bounds, positionsPreserved: false, normalsPreserved: false, uvsPreserved: true, indicesPreserved: true },
    rig: sourceAsset.metadata.candidate.rig, animations: motion.map(m => ({ name: m.name, seconds: m.seconds })),
    productionTarget: source },
  pbr: sourceAsset.metadata.pbr, runtimeTexturePolicy: sourceAsset.metadata.runtimeTexturePolicy,
  animationAcceptance: 'Pending root lab review of changed posture and motion' };
delete asset.strideCalibration;
await writeFile(`${dir}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [asset], files: { creature_gloamfang_reaver: 'gloamfang-reaver-prowl-candidate.glb' } }, null, 2)}\n`);
await writeFile(`${dir}/promotion.json`, `${JSON.stringify({ schema: 'corealm-creature-polish-promotion/1', status: 'awaiting-root-lab-review', accepted: false, pack: asset.pack, builderSha256,
  assets: [{ id: asset.id, candidateFile: output, sha256, bytes: bytes.length, bounds, size, triangles: 4760,
    joints: 62, maxSourceSculptMeters: maxSculptM, materials: asset.materials, animations: asset.animations,
    attack: { seconds: asset.attackSeconds, contactSeconds: .34, contactNormalized: asset.contactNormalized },
    sourceProvenance: provenance, contact, motion,
    sourceGap: 'The owned source has humanoid limb topology and no quadrupedal shoulder or hip structure. This localized sculpt and prowl must be reviewed at the normal gameplay camera to decide whether it clears the animal-headed-human concern; a true four-limbed gait would require a new anatomical source.' }],
  acceptance: { cpuValidated: true, labAccepted: false, visualAccepted: false, worldIntegrated: false } }, null, 2)}\n`);
console.log(JSON.stringify({ output, sha256, bytes: bytes.length, bounds, size, motion: motion.map(m => ({ name: m.name, seconds: m.seconds, min: m.minClearanceM, max: m.maxClearanceM })) }, null, 2));
