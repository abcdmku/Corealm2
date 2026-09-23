import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/audit-fantasy-wasp';
const sourcePath = 'assets/art/tripo/imports/creatures/audit-fantasy-wasp/corealm_fantasy_briar_wasp_p1_2k_pbr_rigged.glb';
const candidatePath = `${here}/briar-wasp-native-rig.glb`;
const sourceSha256Expected = '3dd649afd566f094d69d8d11e8a9b6c5145c9466b0789c0d1a5e6ec8b478979c';
await mkdir(here, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceSha256, sourceSha256Expected, 'The selected Tripo wasp export changed.');
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
assert(scene && primitive && meshNode && sourceSkin, 'Expected the approved skinned source GLB.');
assert.equal(root.listMeshes().length, 1, 'Expected one source mesh.');
assert.equal(root.listSkins().length, 1, 'Expected one source skin.');
assert.equal(root.listAnimations().length, 0, 'Expected the selected source to have no animation clips.');

const sourcePositions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const sourceNormals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const sourceUvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const sourceIndices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
assert.equal(sourcePositions.length / 3, 7850, 'Source vertex count changed.');
assert.equal(sourceIndices.length / 3, 5116, 'Source triangle count changed.');
assert.equal(sourceUvs.length / 2, sourcePositions.length / 3, 'Expected one retained UV per source vertex.');
const sourceJointArray = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeightArray = primitive.getAttribute('WEIGHTS_0')?.getArray();
assert(sourceJointArray && sourceWeightArray, 'Expected source skin attributes.');
assert.equal(sourceSkin.listJoints().length, 37, 'Source rig changed.');
const sourceJointCount = sourceSkin.listJoints().length;

const positions = sourcePositions;
const vertexCount = positions.length / 3;
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
assert(Math.abs(bounds.min[1]) < 1e-6 && bounds.max[1] > .9, `Unexpected Y-up source bounds: ${JSON.stringify(bounds)}`);

// The Tripo source has a horizontal body along X, two wing membranes extending across
// positive/negative Z, and three bilateral leg pairs beneath the thorax.
// This named Generic rig is suitable for Unity's Generic import path; no humanoid mapping,
// mesh edits, UV changes or retopology are introduced.
const bones = [];
function addBone(name, parent, p, group, options = {}) {
  const bone = { name, parent, p, group, sigma: options.sigma ?? .105, ...options };
  bones.push(bone);
  return bone;
}
addBone('WaspRoot', null, [0, 0, 0], 'root', { sigma: .7 });
addBone('Thorax', 'WaspRoot', [-.08, .54, 0], 'thorax', { sigma: .13 });
addBone('Neck', 'Thorax', [-.24, .52, 0], 'thorax', { sigma: .095 });
addBone('Head', 'Neck', [-.32, .52, 0], 'head', { sigma: .10 });
addBone('AbdomenBase', 'Thorax', [.07, .40, 0], 'abdomen', { sigma: .13 });
addBone('AbdomenMid', 'AbdomenBase', [.17, .25, 0], 'abdomen', { sigma: .11 });
addBone('AbdomenTip', 'AbdomenMid', [.26, .09, 0], 'abdomen', { sigma: .095 });
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  addBone(`Antenna_${suffix}`, 'Head', [-.36, .78, side * .045], 'antenna', { sigma: .060, side });
}

function addWing(kind, side, points) {
  const suffix = side < 0 ? 'L' : 'R';
  const names = kind === 'upper'
    ? [`WingUpperRoot_${suffix}`, `WingUpperMid_${suffix}`, `WingUpperTip_${suffix}`]
    : [`WingLowerRoot_${suffix}`, `WingLowerMid_${suffix}`, `WingLowerTip_${suffix}`];
  const parent = 'Thorax';
  for (let index = 0; index < points.length; index++) {
    const [name, p] = [names[index], points[index]];
    addBone(name, index ? names[index - 1] : parent, p, 'wing', {
      sigma: index === 1 ? .115 : .090, side, wing: kind, wingSegment: index,
    });
  }
}
for (const side of [-1, 1]) {
  addWing('upper', side, [
    [-.04, .62, side * .07], [.02, .78, side * .27], [.10, .93, side * .47],
  ]);
  addWing('lower', side, [
    [-.04, .57, side * .07], [.04, .62, side * .29], [.15, .65, side * .47],
  ]);
}

function addLeg(kind, side, points, parent) {
  const suffix = side < 0 ? 'L' : 'R';
  const names = [`Leg${kind}Coxa_${suffix}`, `Leg${kind}Distal_${suffix}`];
  for (let index = 0; index < points.length; index++) {
    const parentName = index ? names[index - 1] : parent;
    addBone(names[index], parentName, points[index], 'leg', {
      sigma: index ? .085 : .095, side, leg: kind,
      depthCenter: kind === 'Front' ? -.22 : kind === 'Mid' ? -.10 : .035,
    });
  }
}
for (const side of [-1, 1]) {
  addLeg('Front', side, [[-.23, .36, side * .075], [-.29, .04, side * .13]], 'Thorax');
  addLeg('Mid', side, [[-.10, .35, side * .09], [-.13, .025, side * .16]], 'Thorax');
  addLeg('Hind', side, [[.025, .34, side * .10], [.015, .02, side * .17]], 'AbdomenBase');
}
assert.equal(bones.length, 33, 'Unexpected Wasp rig size.');
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  assert(!bone.parent || parent, `Missing parent bone ${bone.parent}.`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

// Replace the source skin, which leaves many leg joints unweighted, with spatially gated
// four-influence weights. Wing weights follow the membranes; leg weights follow six limbs.
function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1,
    point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const jointValues = new Uint16Array(vertexCount * 4);
const weightValues = new Float32Array(vertexCount * 4);
const jointInfluenceCounts = new Uint32Array(bones.length);
const nonRootWeightVertices = new Set();
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  let nativeWingConfidence = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = sourceJointArray[vertex * 4 + slot];
    if (joint >= 14 && joint <= 22) nativeWingConfidence += sourceWeightArray[vertex * 4 + slot];
  }
  const scores = [];
  for (const bone of bones) {
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    let gate = 1;
    if (bone.group === 'root') gate = .012;
    if (bone.group === 'thorax') gate = (.05 + .95 * sigmoid((y - .30) / .065)) * (.08 + .92 * sigmoid((.18 - Math.abs(x + .08)) / .05)) * (.08 + .92 * sigmoid((.20 - Math.abs(z)) / .05));
    if (bone.group === 'head') gate = (.02 + .98 * sigmoid((-x - .20) / .05)) * (.05 + .95 * sigmoid((y - .35) / .05));
    if (bone.group === 'antenna') {
      gate = (.01 + .99 * sigmoid((y - .68) / .045)) * (.02 + .98 * sigmoid((-x - .29) / .05));
      gate *= .02 + .98 * sigmoid((bone.side * z + .015) / .03);
    }
    if (bone.group === 'abdomen') gate = (.025 + .975 * sigmoid((x + .01) / .05)) * (.05 + .95 * sigmoid((.57 - y) / .065)) * (.08 + .92 * sigmoid((.18 - Math.abs(z)) / .05));
    if (bone.group === 'wing') {
      const side = .015 + .985 * sigmoid((bone.side * z + .02) / .035);
      const outsideBody = .02 + .98 * sigmoid((Math.abs(z) - .075) / .04);
      const nativeMembrane = .08 + .92 * nativeWingConfidence;
      const band = bone.wing === 'upper'
        ? .06 + .94 * sigmoid((y - .67) / .06)
        : .06 + .94 * sigmoid((.80 - y) / .06);
      gate = side * outsideBody * nativeMembrane * band;
    }
    if (bone.group === 'leg') {
      const side = .02 + .98 * sigmoid((bone.side * z + .012) / .032);
      const lowerBody = .025 + .975 * sigmoid((.48 - y) / .055);
      const segment = .15 + .85 * Math.exp(-.5 * ((x - bone.depthCenter) / .10) ** 2);
      const outsideBody = .035 + .965 * sigmoid((Math.abs(z) - .045) / .035);
      gate = side * lowerBody * segment * outsideBody * (1 - .9 * nativeWingConfidence);
    }
    const score = gate * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) scores.push({ index: boneByName.get(bone.name).index, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const chosen = scores.slice(0, 4);
  assert(chosen.length, `Vertex ${vertex} has no anatomical weight candidate.`);
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0;
  let nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) {
      jointInfluenceCounts[candidate.index]++;
      nonzero++;
    }
  }
  if (nonzero > 1) nonRootWeightVertices.add(vertex);
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
const multiWeightedRatio = nonRootWeightVertices.size / vertexCount;
assert(multiWeightedRatio > .70, `Too many vertices are rigidly weighted (${(multiWeightedRatio * 100).toFixed(1)}%).`);
assert(bones.some((bone, index) => bone.group === 'wing' && jointInfluenceCounts[index] > 0), 'Wing bones received no skin weights.');
assert(bones.some((bone, index) => bone.group === 'leg' && jointInfluenceCounts[index] > 0), 'Leg bones received no skin weights.');
const appendageBonesWithoutWeights = bones.filter((bone, index) => ['wing', 'leg'].includes(bone.group) && jointInfluenceCounts[index] === 0).map(bone => bone.name);
assert.deepEqual(appendageBonesWithoutWeights, [], `Articulated appendage joints received no skin weights: ${appendageBonesWithoutWeights.join(', ')}`);

const originalArmature = meshNode.getParentNode();
assert(originalArmature, 'Expected source mesh under its Tripo Armature node.');
originalArmature.removeChild(meshNode);
if (scene.listChildren().includes(originalArmature)) scene.removeChild(originalArmature);
meshNode.setName('BriarWaspMesh').setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', doc.createAccessor('Wasp_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Wasp_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
const oldInverseBind = sourceSkin.getInverseBindMatrices();
sourceSkin.dispose();
oldInverseBind?.dispose();
for (const node of [...root.listNodes()].reverse()) if (node !== meshNode) node.dispose();

// The source faces -X. Rotate the whole skeleton and mesh together toward game +Z.
const rigContainer = doc.createNode('BriarWaspRig').setTranslation([0, 0, 0]).setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([1, 1, 1]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parentNode = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  assert(parentNode, `Joint parent was not created for ${bone.name}.`);
  parentNode.addChild(node);
}
const skin = doc.createSkin('BriarWasp_Skin').setSkeleton(jointNodes.get('WaspRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
skin.setInverseBindMatrices(doc.createAccessor('Wasp_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));
meshNode.setSkin(skin);

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2), cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};
const multiplyQuaternions = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const idleAngles = (side, segment, kind, t, period, amplitude, phaseScale = 1) => {
  const lag = segment * .10 + (kind === 'lower' ? period * .40 * phaseScale : 0);
  const phase = (t / period - lag / period) * Math.PI * 2;
  const harmonic = Math.sin(phase) + .16 * Math.sin(phase * 2 + .2);
  const taper = segment === 0 ? 1 : segment === 1 ? .55 : -.18;
  return side * amplitude * taper * harmonic;
};
const clipMetrics = [];
function addClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    assert(jointNodes.has(track.node), `Clip ${name} targets absent joint ${track.node}.`);
    assert(track.times.length === track.values.length, `Clip ${name}/${track.node} has mismatched input/output counts.`);
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path ?? 'rotation'}_value`).setArray(Float32Array.from(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${track.path ?? 'rotation'}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
  }
  clipMetrics.push({ name, seconds: duration, channels: tracks.length, paths: [...new Set(tracks.map(track => track.path ?? 'rotation'))] });
}
function wingTracks({ period, amplitude, phaseScale = 1, times, multipliers, biasAt = () => 0, twistAt = () => 0 }) {
  const tracks = [];
  for (const bone of bones.filter(entry => entry.group === 'wing')) {
    const localSegment = bone.wingSegment;
    tracks.push({
      node: bone.name,
      times,
      values: times.map(time => multiplyQuaternions(
        quat('x', idleAngles(bone.side, localSegment, bone.wing, time, period, amplitude, phaseScale) * multipliers(time) + biasAt(bone, time)),
        quat('y', twistAt(bone, time)),
      )),
    });
  }
  return tracks;
}
function sampledTimes(duration, step) {
  const times = [];
  for (let t = 0; t < duration - 1e-6; t += step) times.push(Number(t.toFixed(6)));
  times.push(duration);
  return times;
}
const hoverTimes = sampledTimes(.96, .08);
const hoverTracks = wingTracks({ duration: .96, period: .32, amplitude: .31, times: hoverTimes, multipliers: () => 1 });
hoverTracks.push(
  { node: 'WaspRoot', path: 'translation', times: [0, .24, .48, .72, .96], values: [[0, 0, 0], [0, .012, 0], [0, 0, 0], [0, -.006, 0], [0, 0, 0]] },
  { node: 'Neck', times: [0, .24, .48, .72, .96], values: [quat('x', -.015), quat('x', .018), quat('x', -.01), quat('x', .014), quat('x', -.015)] },
  { node: 'AbdomenTip', times: [0, .24, .48, .72, .96], values: [quat('z', -.01), quat('z', .035), quat('z', .01), quat('z', -.025), quat('z', -.01)] },
);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  hoverTracks.push({ node: `Antenna_${suffix}`, times: [0, .24, .48, .72, .96], values: [quat('z', 0), quat('z', side * .035), quat('z', 0), quat('z', -side * .025), quat('z', 0)] });
  for (const kind of ['Front', 'Mid', 'Hind']) {
    hoverTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: [0, .24, .48, .72, .96], values: [quat('x', .03), quat('x', .065), quat('x', .03), quat('x', -.01), quat('x', .03)] });
  }
}
addClip('Idle', .96, hoverTracks);

// The locomotion slots are a gentle flight glide and a faster aerial dart. This insect has no
// invented footfall cycle; body/wing motion remains compatible with the game's standard slots.
const glideTimes = sampledTimes(1.0, .1);
const glideTracks = wingTracks({ duration: 1, period: .26, amplitude: .43, phaseScale: .85, times: glideTimes, multipliers: () => 1 });
glideTracks.push({ node: 'WaspRoot', path: 'translation', times: [0, .25, .5, .75, 1], values: [[0, 0, 0], [-.012, .010, 0], [-.018, 0, 0], [-.008, -.006, 0], [0, 0, 0]] });
for (const side of [-1, 1]) for (const kind of ['Front', 'Mid', 'Hind']) {
  const suffix = side < 0 ? 'L' : 'R';
  glideTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: [0, .25, .5, .75, 1], values: [quat('x', .09), quat('x', .14), quat('x', .10), quat('x', .06), quat('x', .09)] });
}
addClip('Walk', 1, glideTracks);

const dashTimes = sampledTimes(.72, .06);
const dashTracks = wingTracks({ duration: .72, period: .18, amplitude: .57, phaseScale: .72, times: dashTimes, multipliers: () => 1 });
dashTracks.push({ node: 'WaspRoot', path: 'translation', times: [0, .18, .36, .54, .72], values: [[0, 0, 0], [-.018, .016, 0], [-.028, 0, 0], [-.012, -.008, 0], [0, 0, 0]] });
dashTracks.push({ node: 'Thorax', times: [0, .18, .36, .54, .72], values: [quat('x', .02), quat('x', .085), quat('x', .06), quat('x', .025), quat('x', .02)] });
for (const side of [-1, 1]) for (const kind of ['Front', 'Mid', 'Hind']) {
  const suffix = side < 0 ? 'L' : 'R';
  dashTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: [0, .18, .36, .54, .72], values: [quat('x', -.13), quat('x', -.20), quat('x', -.16), quat('x', -.10), quat('x', -.13)] });
}
addClip('Run', .72, dashTracks);

const actionTimes = [0, .18, .36, .52, .72, .90];
const attackTracks = wingTracks({ duration: .90, period: .22, amplitude: .39, phaseScale: 1, times: actionTimes, multipliers: time => time >= .18 && time <= .52 ? 1.24 : .8 });
attackTracks.push(
  { node: 'WaspRoot', path: 'translation', times: actionTimes, values: [[0, 0, 0], [.01, .02, 0], [-.10, .045, 0], [-.06, .035, 0], [0, .01, 0], [0, 0, 0]] },
  { node: 'Neck', times: actionTimes, values: [quat('z', 0), quat('z', -.03), quat('z', .22), quat('z', .10), quat('z', -.02), quat('z', 0)] },
  { node: 'Head', times: actionTimes, values: [quat('z', 0), quat('z', .02), quat('z', .16), quat('z', .06), quat('z', -.02), quat('z', 0)] },
  { node: 'AbdomenMid', times: actionTimes, values: [quat('z', 0), quat('z', -.04), quat('z', .55), quat('z', .26), quat('z', .02), quat('z', 0)] },
  { node: 'AbdomenTip', times: actionTimes, values: [quat('z', 0), quat('z', -.05), quat('z', .72), quat('z', .31), quat('z', .03), quat('z', 0)] },
);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  attackTracks.push({ node: `LegFrontCoxa_${suffix}`, times: actionTimes, values: [quat('z', 0), quat('x', .10), quat('x', -.38), quat('x', -.20), quat('x', .06), quat('z', 0)] });
  attackTracks.push({ node: `LegFrontDistal_${suffix}`, times: actionTimes, values: [quat('x', 0), quat('x', .12), quat('x', -.31), quat('x', -.16), quat('x', .05), quat('x', 0)] });
  attackTracks.push({ node: `Antenna_${suffix}`, times: actionTimes, values: [quat('z', 0), quat('z', side * .025), quat('z', -side * .12), quat('z', -side * .07), quat('z', side * .02), quat('z', 0)] });
}
addClip('Attack', .90, attackTracks);

const hitTimes = [0, .07, .16, .28, .46];
const hitTracks = wingTracks({ duration: .46, period: .23, amplitude: .26, phaseScale: 1, times: hitTimes, multipliers: time => time >= .07 && time <= .16 ? .25 : .9 });
hitTracks.push(
  { node: 'Thorax', times: hitTimes, values: [quat('z', 0), quat('z', .25), quat('z', -.095), quat('z', -.03), quat('z', 0)] },
  { node: 'Head', times: hitTimes, values: [quat('x', 0), quat('x', -.20), quat('x', .07), quat('x', .015), quat('x', 0)] },
  { node: 'AbdomenTip', times: hitTimes, values: [quat('z', 0), quat('z', -.14), quat('z', .05), quat('z', .01), quat('z', 0)] },
);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  hitTracks.push({ node: `Antenna_${suffix}`, times: hitTimes, values: [quat('z', 0), quat('z', side * .19), quat('z', -side * .06), quat('z', 0), quat('z', 0)] });
  for (const kind of ['Front', 'Mid', 'Hind']) hitTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: hitTimes, values: [quat('x', 0), quat('x', -.18), quat('x', .05), quat('x', .01), quat('x', 0)] });
}
addClip('Hit', .46, hitTracks);

const deathTimes = [0, .22, .52, .90, 1.25, 1.55];
const deathTracks = wingTracks({
  period: .30, amplitude: .20, times: deathTimes,
  multipliers: time => time < .22 ? 1 : time < .52 ? .25 : 0,
  biasAt: (bone, time) => {
    const fold = Math.max(0, Math.min(1, (time - .18) / .62));
    const segmentTaper = [1, .70, .42][bone.wingSegment];
    return -bone.side * (bone.wing === 'upper' ? .55 : .46) * segmentTaper * fold;
  },
  twistAt: (bone, time) => {
    const segmentTaper = [1, .70, .42][bone.wingSegment];
    return bone.side * .66 * segmentTaper * Math.max(0, Math.min(1, (time - .18) / .62));
  },
});
deathTracks.push(
  { node: 'WaspRoot', path: 'translation', times: deathTimes, values: [[0, 0, 0], [0, .015, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] },
  { node: 'Thorax', times: deathTimes, values: [quat('z', 0), quat('z', .08), quat('z', -.17), quat('z', -.34), quat('z', -.36), quat('z', -.36)] },
  { node: 'Head', times: deathTimes, values: [quat('x', 0), quat('x', -.04), quat('x', -.12), quat('x', -.25), quat('x', -.26), quat('x', -.26)] },
  { node: 'AbdomenMid', times: deathTimes, values: [quat('x', 0), quat('x', -.04), quat('x', -.18), quat('x', -.30), quat('x', -.31), quat('x', -.31)] },
  { node: 'AbdomenTip', times: deathTimes, values: [quat('x', 0), quat('x', -.06), quat('x', -.22), quat('x', -.36), quat('x', -.38), quat('x', -.38)] },
);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  deathTracks.push({ node: `Antenna_${suffix}`, times: deathTimes, values: [quat('z', 0), quat('z', side * .04), quat('z', -side * .10), quat('z', -side * .17), quat('z', -side * .18), quat('z', -side * .18)] });
  for (const kind of ['Front', 'Mid', 'Hind']) {
    deathTracks.push({ node: `Leg${kind}Coxa_${suffix}`, times: deathTimes, values: [quat('z', 0), quat('z', side * .04), quat('z', side * .16), quat('z', side * .27), quat('z', side * .28), quat('z', side * .28)] });
    deathTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: deathTimes, values: [quat('x', 0), quat('x', -.06), quat('x', -.20), quat('x', -.35), quat('x', -.36), quat('x', -.36)] });
  }
}
addClip('Death', 1.55, deathTracks);
assert.deepEqual(clipMetrics.map(clip => clip.name), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);

// Retain the source's layered base color, packed metallic/roughness, and normal maps. Only
// resolution changes for runtime; RGB data maps keep their channels and UVs stay untouched.
const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
assert(material && baseColorTexture && metallicRoughnessTexture && normalTexture, 'Expected source base-color and complete PBR maps.');
const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const sourceImage = texture.getImage();
  const metadata = await sharp(sourceImage).metadata();
  const role = texture === baseColorTexture ? 'base color' : texture === metallicRoughnessTexture ? 'packed metallic-roughness' : texture === normalTexture ? 'normal' : 'other';
  const sourceMap = { name: texture.getName(), role, width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(sourceImage).digest('hex') };
  sourceTextureMetrics.push(sourceMap);
  if (Math.max(metadata.width ?? 0, metadata.height ?? 0) > 2048) {
    let encoded;
    if (texture === baseColorTexture) {
      encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
    } else if (texture === metallicRoughnessTexture) {
      encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 9 }).toBuffer();
    } else if (texture === normalTexture) {
      const rawInfo = await sharp(sourceImage).metadata();
      const raw = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).removeAlpha().raw().toBuffer();
      for (let i = 0; i < raw.length; i += 3) {
        let nx = raw[i] / 127.5 - 1, ny = raw[i + 1] / 127.5 - 1, nz = raw[i + 2] / 127.5 - 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length; ny /= length; nz /= length;
        raw[i] = Math.round((nx + 1) * 127.5); raw[i + 1] = Math.round((ny + 1) * 127.5); raw[i + 2] = Math.round((nz + 1) * 127.5);
      }
      encoded = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
    } else {
      encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
    }
    texture.setImage(encoded);
    if (role === 'normal') texture.setMimeType('image/jpeg');
  }
  const runtimeBytes = texture.getImage();
  const runtimeMeta = await sharp(runtimeBytes).metadata();
  assert(Math.max(runtimeMeta.width ?? 0, runtimeMeta.height ?? 0) <= 2048, `Runtime map ${texture.getName()} exceeds 2K.`);
  runtimeTextureMetrics.push({ name: texture.getName(), role, width: runtimeMeta.width, height: runtimeMeta.height, mime: texture.getMimeType(), bytes: runtimeBytes.length, sha256: createHash('sha256').update(runtimeBytes).digest('hex') });
}
const pbrSample = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const roughnessRange = [Infinity, -Infinity], metallicRange = [Infinity, -Infinity];
for (let i = 0; i < pbrSample.length; i += 3) {
  roughnessRange[0] = Math.min(roughnessRange[0], pbrSample[i + 1] / 255);
  roughnessRange[1] = Math.max(roughnessRange[1], pbrSample[i + 1] / 255);
  metallicRange[0] = Math.min(metallicRange[0], pbrSample[i + 2] / 255);
  metallicRange[1] = Math.max(metallicRange[1], pbrSample[i + 2] / 255);
}
assert(roughnessRange[1] - roughnessRange[0] > .05, `Packed roughness channel is flat: ${roughnessRange}.`);
assert(metallicRange[1] - metallicRange[0] > .05, `Packed metallic channel is flat: ${metallicRange}.`);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkRoot = (await io.readBinary(outputBytes)).getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh?.listPrimitives()[0];
const checkPositionArray = checkPrimitive?.getAttribute('POSITION')?.getArray();
const checkNormalArray = checkPrimitive?.getAttribute('NORMAL')?.getArray();
const checkUvArray = checkPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
const checkIndexArray = checkPrimitive?.getIndices()?.getArray();
const checkJoints = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
const checkWeights = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
assert(checkPositionArray && checkNormalArray && checkUvArray && checkIndexArray && checkJoints && checkWeights && checkSkin, 'Candidate export is missing geometry, UV, or skin data.');
assert.equal(checkRoot.listSkins().length, 1, 'Candidate must contain exactly one skin.');
assert.equal(checkRoot.listNodes().length, bones.length + 2, 'Candidate includes stray source skeleton nodes.');
assert.equal(checkRoot.listAnimations().length, 6, 'Candidate must contain six gameplay clips.');
const arrayDelta = (left, right) => {
  assert.equal(left.length, right.length);
  let max = 0;
  for (let i = 0; i < left.length; i++) max = Math.max(max, Math.abs(left[i] - right[i]));
  return max;
};
const positionDelta = arrayDelta(checkPositionArray, sourcePositions);
const normalDelta = arrayDelta(checkNormalArray, sourceNormals);
const uvDelta = arrayDelta(checkUvArray, sourceUvs);
let indexMismatches = 0;
for (let i = 0; i < sourceIndices.length; i++) if (checkIndexArray[i] !== sourceIndices[i]) indexMismatches++;
assert.equal(positionDelta, 0, 'Mesh positions changed.');
assert.equal(normalDelta, 0, 'Mesh normals changed.');
assert.equal(uvDelta, 0, 'Source UV coordinates changed.');
assert.equal(indexMismatches, 0, 'Mesh topology changed.');
let readbackMultiWeighted = 0, readbackMaxWeightError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    assert(Number.isInteger(joint) && joint >= 0 && joint < checkSkin.listJoints().length, `Bad joint index at vertex ${vertex}.`);
    assert(Number.isFinite(weight) && weight >= 0, `Bad joint weight at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  readbackMaxWeightError = Math.max(readbackMaxWeightError, Math.abs(sum - 1));
  if (nonzero > 1) readbackMultiWeighted++;
}
assert(readbackMaxWeightError < 1e-5, `Skin weights are not normalized: ${readbackMaxWeightError}.`);
assert(readbackMultiWeighted / vertexCount > .70, 'Export lost the distributed wing/leg weights.');
const checkJointNames = checkSkin.listJoints().map(joint => joint.getName());
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  assert(checkSkin.listJoints().includes(channel.getTargetNode()), `${animation.getName()} targets a non-joint node.`);
}
const checkMaterials = checkRoot.listMaterials();
const checkTextures = checkRoot.listTextures();

const gameBoundsAtUnitScale = {
  min: [-bounds.max[2], bounds.min[1], -bounds.max[0]],
  max: [-bounds.min[2], bounds.max[1], -bounds.min[0]],
};
const variants = [
  { id: 'creature_field_wasp', displayName: 'Field Wasp', sourceFile: 'field_basecolor_2k.png', heightFactor: 1, presentationScale: .45, level: 1, region: 'fallowmarch' },
  { id: 'creature_heath_wasp', displayName: 'Heath Wasp', sourceFile: 'heath_basecolor_2k.png', heightFactor: 1, presentationScale: .45, level: 1, region: 'fallowmarch' },
  { id: 'creature_reed_wasp', displayName: 'Slatewing Wasp', sourceFile: 'slatewing_basecolor_2k.png', heightFactor: 1, presentationScale: .45, level: 1, region: 'fallowmarch' },
  { id: 'creature_marsh_wasp', displayName: 'Marsh Wasp', sourceFile: 'marsh_basecolor_2k.png', heightFactor: .8, presentationScale: 1, level: 5, region: 'vellenwood' },
];
const variantRecords = [];
const labAssets = [];
const labFiles = {};
const atlasHashes = new Set();
for (const variant of variants) {
  const atlasFile = `${here}/textures/${variant.sourceFile}`;
  const atlas = await readFile(atlasFile);
  const meta = await sharp(atlas).metadata();
  assert.equal(meta.width, 2048, `${variant.id} atlas width must be 2K.`);
  assert.equal(meta.height, 2048, `${variant.id} atlas height must be 2K.`);
  const atlasSha256 = createHash('sha256').update(atlas).digest('hex');
  assert(!atlasHashes.has(atlasSha256), `${variant.id} repeats another variant's texture.`);
  atlasHashes.add(atlasSha256);
  const variantDoc = await io.readBinary(outputBytes);
  const variantRoot = variantDoc.getRoot();
  const variantMaterial = variantRoot.listMaterials()[0];
  const variantBaseColor = variantMaterial.getBaseColorTexture();
  variantBaseColor.setImage(atlas).setMimeType('image/png').setName(`${variant.id}_imagegen_basecolor_2k`);
  const container = variantRoot.listNodes().find(node => node.getName() === 'BriarWaspRig');
  assert(container, 'BriarWaspRig node missing in variant.');
  container.setScale([variant.heightFactor, variant.heightFactor, variant.heightFactor]);
  const file = `${variant.id}.glb`;
  const bytes = await io.writeBinary(variantDoc);
  await writeFile(`${here}/${file}`, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const size = {
    x: (gameBoundsAtUnitScale.max[0] - gameBoundsAtUnitScale.min[0]) * variant.heightFactor,
    y: (gameBoundsAtUnitScale.max[1] - gameBoundsAtUnitScale.min[1]) * variant.heightFactor,
    z: (gameBoundsAtUnitScale.max[2] - gameBoundsAtUnitScale.min[2]) * variant.heightFactor,
  };
  const base = { x: gameBoundsAtUnitScale.min[0] * variant.heightFactor, y: 0, z: gameBoundsAtUnitScale.min[2] * variant.heightFactor };
  const variantBounds = { min: [base.x, 0, base.z], max: [base.x + size.x, size.y, base.z + size.z] };
  const record = { ...variant, file, bytes: bytes.length, sha256, atlasFile, atlasSha256, size, bounds: variantBounds, expectedDrawnHeight: Number((size.y * variant.presentationScale).toFixed(3)) };
  variantRecords.push(record);
  labAssets.push({
    id: variant.id,
    file: `models/creature/${file}`,
    pack: 'corealm-fantasy-briar-wasp-p1',
    category: 'character',
    is: variant.displayName,
    tags: ['creature', 'insect', 'wasp', 'flying', 'tripo-p1', 'candidate', variant.level === 1 ? 't1' : 't5'],
    bytes: bytes.length,
    sha256,
    size, base, bounds: variantBounds,
    groundY: 0,
    triangles: sourceIndices.length / 3,
    vertices: vertexCount,
    animations: clipMetrics.map(clip => clip.name),
    materials: checkMaterials.map(material => material.getName()),
    walkClipSeconds: clipMetrics.find(clip => clip.name === 'Walk').seconds,
    runClipSeconds: clipMetrics.find(clip => clip.name === 'Run').seconds,
    attackSeconds: clipMetrics.find(clip => clip.name === 'Attack').seconds,
    contactNormalized: .5,
    sourceProvenance: { modelId: '78a332eb-c1a4-486b-85e5-27dad940f8f6', sourceFile: sourcePath, sourceSha256, atlasFile, atlasSha256, originalNormalAndOrmRetained: true },
    metadata: { is: variant.displayName, tags: ['wasp', variant.region], contactNormalized: .5 },
    acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  });
  labFiles[variant.id] = file;
}

const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  family: 'fantasy_briar_wasp',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    tripoProjectId: '78a332eb-c1a4-486b-85e5-27dad940f8f6',
    generation: 'Second four-image concept batch, first image; Tripo P1.0 Fast; 2K PBR; Rig Other; GLB with skeleton',
    generationCredits: { concepts: 0, model: 35, texture: 30, pbr: 5, rig: 20, total: 90 },
    geometry: { vertices: vertexCount, triangles: sourceIndices.length / 3, bounds, positionsPreserved: true, normalsPreserved: true, uvPreserved: true, indicesPreserved: true },
    rig: { joints: sourceJointCount, animations: 0, neutralBoneVertices: 2941, finding: 'Native Tripo wing chains are weighted, but most leg chains have zero weighted vertices; rebuilt a full six-leg and paired-wing rig.' },
    textures: sourceTextureMetrics,
  },
  candidate: {
    baseFile: candidatePath,
    baseSha256: candidateSha256,
    vertices: vertexCount,
    triangles: sourceIndices.length / 3,
    geometryDelta: { positionDelta, normalDelta, uvDelta, indexMismatches },
    jointCount: bones.length,
    weightedVerticesByJoint: Object.fromEntries(bones.map((bone, index) => [bone.name, jointInfluenceCounts[index]])),
    multiWeightedVertexRatio: multiWeightedRatio,
    maximumWeightSumError: readbackMaxWeightError,
    sourceForward: '-X',
    gameForward: '+Z',
    clips: clipMetrics,
    pbrChannels: { roughnessRange, metallicRange },
    variants: variantRecords,
  },
  acceptance: { sourceDesignAudit: true, geometryPreserved: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${here}/catalog.json`, `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(`${here}/lab-catalog.json`, `${JSON.stringify({
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-fantasy-briar-wasp-p1', name: 'Fantasy briar wasp P1', author: 'Corealm', source: 'Tripo P1 source and image-generated variant atlases', license: 'LicenseRef-Tripo-Generated' },
  assets: labAssets,
  files: labFiles,
}, null, 2)}\n`);
console.log(JSON.stringify({ sourceSha256, baseSha256: candidateSha256, vertices: vertexCount, triangles: sourceIndices.length / 3, joints: bones.length, clips: clipMetrics.map(clip => clip.name), variants: variantRecords.map(({ id, file, sha256, expectedDrawnHeight }) => ({ id, file, sha256, expectedDrawnHeight })) }, null, 2));

