import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/audit-user-rock-golem';
const sourceFile = `${dir}/rock-golem-user-original.glb`;
const candidateFile = `${dir}/quarry-warden-user-rock-golem-candidate.glb`;
const sourceSha256 = '372e1318cb41ba5008699dc8a9b0300fbb62e1a9b20441dd2b36acb68753bc80';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourceFile);
if (sha256(sourceBytes) !== sourceSha256) throw new Error('User-provided source GLB hash changed.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
const mesh = root.listMeshes()[0], primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((n) => n.getMesh() === mesh);
const armature = root.listNodes().find((n) => n.getName() === 'Armature');
const skin = meshNode?.getSkin(), joints = skin?.listJoints() ?? [];
if (!primitive || !meshNode || !armature || joints.length !== 67 || root.listAnimations().length || primitive.getAttribute('POSITION')?.getCount() !== 7424 || primitive.getIndices()?.getCount() / 3 !== 4771) throw new Error('Unexpected user rock golem source geometry or rig.');
const material = primitive.getMaterial();
if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw new Error('Source PBR maps missing.');
const sourceTexture = [];
for (const tex of root.listTextures()) {
  const m = await sharp(tex.getImage()).metadata();
  sourceTexture.push({ name: tex.getName(), width: m.width, height: m.height, bytes: tex.getImage().length, sha256: sha256(tex.getImage()) });
}
const sourcePositions = primitive.getAttribute('POSITION').getArray();
const sourceIndices = primitive.getIndices().getArray();
const sourceNormals = primitive.getAttribute('NORMAL').getArray();
const sourceUvs = primitive.getAttribute('TEXCOORD_0').getArray();
const sourceJointValues = primitive.getAttribute('JOINTS_0').getArray();
const sourceWeights = primitive.getAttribute('WEIGHTS_0').getArray();
const sourceIbms = skin.getInverseBindMatrices().getArray();
// Model-space source is 0.709 m tall. The unchanged definition presentation scale
// is 0.869151959; 4.12 produces an imposing 2.54 m Quarry Warden at game scale.
const nativeScale = 4.12, gameScale = 0.8691519590640763;
armature.setScale([nativeScale, nativeScale, nativeScale]);

const jointByName = new Map(joints.map((j) => [j.getName(), j]));
const base = new Map(joints.map((j) => [j.getName(), { p: [...j.getTranslation()], q: [...j.getRotation()] }]));
const worldQ = new Map(joints.map((j) => {
  const q = new THREE.Quaternion();
  new THREE.Matrix4().fromArray(j.getParentNode()?.getWorldMatrix() ?? new THREE.Matrix4().elements).decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return [j.getName(), q];
}));
const axisQ = (axis, angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), angle);
function posed(name, ...worldDeltas) {
  const parent = worldQ.get(name);
  const delta = new THREE.Quaternion();
  for (const [axis, angle] of worldDeltas) delta.multiply(axisQ(axis, angle));
  const localDelta = parent.clone().invert().multiply(delta).multiply(parent);
  return localDelta.multiply(new THREE.Quaternion(...base.get(name).q)).normalize().toArray();
}
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const buffer = root.listBuffers()[0];
const clips = [];
function clip(name, duration, channels) {
  const animation = doc.createAnimation(name);
  for (const { joint, path = 'rotation', times, values } of channels) {
    const target = jointByName.get(joint);
    if (!target || times.length !== values.length) throw new Error(`Bad channel ${name}/${joint}`);
    const input = doc.createAccessor(`${name}_${joint}_${path}_time`).setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${joint}_${path}_value`).setArray(Float32Array.from(values.flat())).setType(path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${joint}_${path}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${joint}_${path}`).setTargetNode(target).setTargetPath(path).setSampler(sampler));
  }
  clips.push({ name, seconds: duration, channels: channels.length });
}
const track = (joint, times, f) => ({ joint, times, values: times.map(f) });
const translation = (joint, times, f) => ({ joint, path: 'translation', times, values: times.map(f) });
const restHip = base.get('Hips').p;
const hip = (dx = 0, dy = 0, dz = 0) => [restHip[0] + dx, restHip[1] + dy, restHip[2] + dz];
const guard = (joint, x = 0, z = 0) => posed(joint, [Z, (joint.startsWith('Left') ? -1 : 1) * (.78 + z)], [X, x]);
const cycle = (t, offset = 0) => Math.sin((t + offset) * Math.PI * 2);
const idleTimes = [0, .6, 1.2, 1.8, 2.4];
clip('Idle', 2.4, [
  track('Left_Shoulder', idleTimes, (t) => guard('Left_Shoulder', .028 * cycle(t / 2.4))),
  track('Right_Shoulder', idleTimes, (t) => guard('Right_Shoulder', -.028 * cycle(t / 2.4))),
  track('Spine', idleTimes, (t) => posed('Spine', [Z, .018 * cycle(t / 2.4)])),
  track('Head', idleTimes, (t) => posed('Head', [Y, .028 * cycle(t / 2.4)])),
]);
for (const [name, duration, stride, knee, bob] of [['Walk', 1.08, .29, .22, .012], ['Run', .72, .52, .42, .025]]) {
  const times = Array.from({ length: 9 }, (_, i) => duration * i / 8);
  clip(name, duration, [
    translation('Hips', times, (t) => hip(0, bob * (1 - Math.cos(4 * Math.PI * t / duration)) / 2)),
    track('Left_UpperLeg', times, (t) => posed('Left_UpperLeg', [X, stride * cycle(t / duration)])),
    track('Right_UpperLeg', times, (t) => posed('Right_UpperLeg', [X, -stride * cycle(t / duration)])),
    track('Left_LowerLeg', times, (t) => posed('Left_LowerLeg', [X, -knee * Math.max(0, cycle(t / duration))])),
    track('Right_LowerLeg', times, (t) => posed('Right_LowerLeg', [X, -knee * Math.max(0, -cycle(t / duration))])),
    track('Left_Shoulder', times, (t) => guard('Left_Shoulder', -.24 * cycle(t / duration) * stride / .29)),
    track('Right_Shoulder', times, (t) => guard('Right_Shoulder', .24 * cycle(t / duration) * stride / .29)),
    track('Chest', times, (t) => posed('Chest', [Y, .065 * cycle(t / duration)])),
  ]);
}
const attackTimes = [0, .16, .30, .43, .61, .83, 1.02];
clip('Attack', 1.02, [
  translation('Hips', attackTimes, (_, i) => hip(0, [0, -.015, -.028, -.016, -.005, 0, 0][i], [0, -.025, -.03, .065, .025, 0, 0][i])),
  track('Chest', attackTimes, (_, i) => posed('Chest', [X, [0, -.12, -.18, .28, .18, .04, 0][i]], [Y, [0, -.16, -.24, .12, .08, .02, 0][i]])),
  track('Right_Shoulder', attackTimes, (_, i) => guard('Right_Shoulder', [0, .45, .65, -1.04, -.60, -.1, 0][i])),
  track('Right_UpperArm', attackTimes, (_, i) => posed('Right_UpperArm', [X, [0, .18, .35, -.72, -.40, -.06, 0][i]])),
  track('Right_LowerArm', attackTimes, (_, i) => posed('Right_LowerArm', [X, [0, -.22, -.34, -.62, -.40, -.05, 0][i]])),
  track('Left_Shoulder', attackTimes, (_, i) => guard('Left_Shoulder', [0, -.12, -.20, -.24, -.12, 0, 0][i])),
  track('Head', attackTimes, (_, i) => posed('Head', [X, [0, -.05, -.08, .10, .08, 0, 0][i]])),
]);
const hitTimes = [0, .10, .25, .50];
for (const [name, side] of [['Hit', 0], ['HitLeft', -1], ['HitRight', 1]]) clip(name, .50, [
  translation('Hips', hitTimes, (_, i) => hip(side * [0, .018, .008, 0][i], [0, -.016, -.005, 0][i], [0, -.023, -.009, 0][i])),
  track('Chest', hitTimes, (_, i) => posed('Chest', [X, [0, -.20, -.07, 0][i]], [Z, side * [0, .18, .05, 0][i]])),
  track('Head', hitTimes, (_, i) => posed('Head', [X, [0, -.12, -.04, 0][i]], [Z, side * [0, .10, .02, 0][i]])),
  track('Left_Shoulder', hitTimes, (_, i) => guard('Left_Shoulder', [0, -.18, -.07, 0][i])),
  track('Right_Shoulder', hitTimes, (_, i) => guard('Right_Shoulder', [0, -.18, -.07, 0][i])),
]);
const deathTimes = [0, .18, .42, .72, 1.05, 1.50];
clip('Death', 1.50, [
  translation('Hips', deathTimes, (_, i) => hip([0, .005, .012, .018, .025, .025][i], [0, -.015, -.055, -.115, -.18, -.18][i], [0, 0, .015, .03, .05, .05][i])),
  track('Hips', deathTimes, (_, i) => posed('Hips', [X, [0, .08, .38, .95, 1.44, 1.44][i]], [Z, [0, 0, -.04, -.10, -.14, -.14][i]])),
  track('Chest', deathTimes, (_, i) => posed('Chest', [X, [0, .02, .11, .25, .34, .34][i]], [Z, [0, 0, .03, .09, .12, .12][i]])),
  track('Head', deathTimes, (_, i) => posed('Head', [X, [0, 0, .03, .10, .16, .16][i]])),
  track('Left_Shoulder', deathTimes, (_, i) => guard('Left_Shoulder', [0, -.08, -.22, -.48, -.65, -.65][i])),
  track('Right_Shoulder', deathTimes, (_, i) => guard('Right_Shoulder', [0, -.07, -.18, -.32, -.44, -.44][i])),
  track('Left_UpperLeg', deathTimes, (_, i) => posed('Left_UpperLeg', [X, [0, -.02, -.12, -.35, -.62, -.62][i]])),
  track('Right_UpperLeg', deathTimes, (_, i) => posed('Right_UpperLeg', [X, [0, -.02, -.15, -.42, -.68, -.68][i]])),
  track('Left_LowerLeg', deathTimes, (_, i) => posed('Left_LowerLeg', [X, [0, .04, .20, .45, .72, .72][i]])),
  track('Right_LowerLeg', deathTimes, (_, i) => posed('Right_LowerLeg', [X, [0, .04, .20, .48, .75, .75][i]])),
]);

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidateFile, candidateBytes);
const check = (await io.readBinary(candidateBytes)).getRoot();
const p = check.listMeshes()[0].listPrimitives()[0];
for (const [label, before, after] of [
  ['positions', sourcePositions, p.getAttribute('POSITION').getArray()],
  ['indices', sourceIndices, p.getIndices().getArray()],
  ['normals', sourceNormals, p.getAttribute('NORMAL').getArray()],
  ['uvs', sourceUvs, p.getAttribute('TEXCOORD_0').getArray()],
  ['joints', sourceJointValues, p.getAttribute('JOINTS_0').getArray()],
  ['weights', sourceWeights, p.getAttribute('WEIGHTS_0').getArray()],
  ['inverseBinds', sourceIbms, check.listSkins()[0].getInverseBindMatrices().getArray()],
]) {
  if (before.length !== after.length || before.some((x, i) => x !== after[i])) throw new Error(`Source ${label} changed in candidate.`);
}
const outTextures = check.listTextures().map((t) => ({ name: t.getName(), sha256: sha256(t.getImage()) }));
if (outTextures.some((t) => !sourceTexture.some((s) => s.name === t.name && s.sha256 === t.sha256))) throw new Error('Source texture content changed.');
if (check.listAnimations().map((a) => a.getName()).join(',') !== 'Idle,Walk,Run,Attack,Hit,HitLeft,HitRight,Death') throw new Error('Eight clip contract incomplete.');
const report = { sourceFile, sourceSha256, sourceBytes: sourceBytes.length, candidateFile, candidateSha256: sha256(candidateBytes), candidateBytes: candidateBytes.length, geometryPreserved: true, sourceSkinAndWeightsPreserved: true, pbrTexturesPreserved: true, vertices: 7424, triangles: 4771, joints: 67, sourceHeight: .7089843, nativeScale, gameScale, renderedHeight: .7089843 * nativeScale * gameScale, textures: sourceTexture, clips, contactSeconds: .43, contactNormalized: .43 / 1.02, status: 'awaiting-root-lab-review' };
await writeFile(`${dir}/validation.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
