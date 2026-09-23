import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/starred-leafwing';
const sourcePath = 'assets/art/tripo/exports/0a131c51-bd21-487b-8973-5ac00f8521bc.glb';
const candidatePath = `${here}/ambervein-leafwing-native-rig.glb`;
const sourceSha256Expected = '6309d5df42b63f7d13f2863d42b943200059fb8cb2197a8cc5a6135de755f2a8';
await mkdir(here, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceSha256, sourceSha256Expected, 'The user-starred source export changed.');
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
assert.equal(root.listAnimations().length, 0, 'Expected the starred source to have no animation clips.');

const sourcePositions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const sourceNormals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const sourceUvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const sourceIndices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
assert.equal(sourcePositions.length / 3, 2682, 'Source vertex count changed.');
assert.equal(sourceIndices.length / 3, 3754, 'Source triangle count changed.');
assert.equal(sourceUvs.length / 2, sourcePositions.length / 3, 'Expected one retained UV per source vertex.');
const sourceJointArray = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeightArray = primitive.getAttribute('WEIGHTS_0')?.getArray();
assert(sourceJointArray && sourceWeightArray, 'Expected source skin attributes.');
assert(sourceWeightArray.every((weight, index) => index % 4 !== 0 || Math.abs(weight - 1) < 1e-5), 'Source is not the pinned root-only Tripo skin.');
assert(sourceWeightArray.every((weight, index) => index % 4 === 0 || Math.abs(weight) < 1e-5), 'Source has non-root weights.');
const sourceJointCount = sourceSkin.listJoints().length;

const positions = sourcePositions;
const vertexCount = positions.length / 3;
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
assert(Math.abs(bounds.min[1]) < 1e-6 && bounds.max[1] > .9, `Unexpected Y-up source bounds: ${JSON.stringify(bounds)}`);

// Rest positions follow the Tripo preview: head and antennae above a narrow thorax, two
// paired leaf wings on the thorax, a tapered abdomen, and three bilateral leg pairs.
// This named Generic rig is suitable for Unity's Generic import path; no humanoid mapping,
// mesh edits, UV changes or retopology are introduced.
const bones = [];
function addBone(name, parent, p, group, options = {}) {
  const bone = { name, parent, p, group, sigma: options.sigma ?? .105, ...options };
  bones.push(bone);
  return bone;
}
addBone('LeafwingRoot', null, [0, 0, 0], 'root', { sigma: .7 });
addBone('Thorax', 'LeafwingRoot', [0, .555, 0], 'thorax', { sigma: .135 });
addBone('Neck', 'Thorax', [0, .675, .020], 'thorax', { sigma: .095 });
addBone('Head', 'Neck', [0, .758, .042], 'head', { sigma: .095 });
addBone('AbdomenBase', 'LeafwingRoot', [0, .425, -.020], 'abdomen', { sigma: .115 });
addBone('AbdomenMid', 'AbdomenBase', [0, .285, -.055], 'abdomen', { sigma: .095 });
addBone('AbdomenTip', 'AbdomenMid', [0, .155, -.092], 'abdomen', { sigma: .085 });
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  addBone(`Antenna_${suffix}`, 'Head', [side * .043, .888, .050], 'antenna', { sigma: .060, side });
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
    [side * .098, .628, -.006], [side * .286, .790, -.004], [side * .482, .923, .002],
  ]);
  addWing('lower', side, [
    [side * .096, .510, -.006], [side * .306, .424, .006], [side * .486, .328, .021],
  ]);
}

function addLeg(kind, side, points, parent) {
  const suffix = side < 0 ? 'L' : 'R';
  const names = [`Leg${kind}Coxa_${suffix}`, `Leg${kind}Distal_${suffix}`];
  for (let index = 0; index < points.length; index++) {
    const parentName = index ? names[index - 1] : parent;
    addBone(names[index], parentName, points[index], 'leg', {
      sigma: index ? .085 : .095, side, leg: kind,
      depthCenter: kind === 'Front' ? .135 : kind === 'Mid' ? -.005 : -.115,
    });
  }
}
for (const side of [-1, 1]) {
  addLeg('Front', side, [[side * .104, .495, .075], [side * .252, .356, .205]], 'Thorax');
  addLeg('Mid', side, [[side * .098, .408, -.004], [side * .284, .294, -.028]], 'Thorax');
  addLeg('Hind', side, [[side * .082, .315, -.035], [side * .318, .061, -.187]], 'AbdomenBase');
}
assert.equal(bones.length, 33, 'Unexpected Leafwing rig size.');
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  assert(!bone.parent || parent, `Missing parent bone ${bone.parent}.`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

// Replace the all-root source skin with spatially gated four-influence weights. Wing weights
// prefer the near-planar leaf surfaces; leg weights prefer the insect's six separated limbs.
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
  const scores = [];
  for (const bone of bones) {
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    let gate = 1;
    if (bone.group === 'root') gate = .012;
    if (bone.group === 'thorax') gate = (.06 + .94 * sigmoid((y - .32) / .075)) * (.08 + .92 * sigmoid((.28 - Math.abs(x)) / .045));
    if (bone.group === 'head') gate = (.025 + .975 * sigmoid((y - .665) / .055)) * (.04 + .96 * sigmoid((.17 - Math.abs(x)) / .035));
    if (bone.group === 'antenna') {
      gate = (.015 + .985 * sigmoid((y - .785) / .040));
      gate *= .02 + .98 * sigmoid((bone.side * x + .018) / .028);
    }
    if (bone.group === 'abdomen') gate = (.025 + .975 * sigmoid((.52 - y) / .060)) * (.05 + .95 * sigmoid((.24 - Math.abs(x)) / .035));
    if (bone.group === 'wing') {
      const side = .02 + .98 * sigmoid((bone.side * x + .018) / .035);
      const outsideBody = .025 + .975 * sigmoid((Math.abs(x) - .070) / .035);
      const inLeafPlane = .03 + .97 * Math.exp(-.5 * (z / .165) ** 2);
      const band = bone.wing === 'upper'
        ? .025 + .975 * sigmoid((y - .445) / .070)
        : .025 + .975 * sigmoid((.675 - y) / .070);
      gate = side * outsideBody * inLeafPlane * band;
    }
    if (bone.group === 'leg') {
      const side = .02 + .98 * sigmoid((bone.side * x + .014) / .032);
      const lowerBody = .025 + .975 * sigmoid((.665 - y) / .055);
      const limbDepth = .22 + .78 * Math.exp(-.5 * ((z - bone.depthCenter) / .19) ** 2);
      const outsideBody = .025 + .975 * sigmoid((Math.abs(x) - .055) / .035);
      gate = side * lowerBody * limbDepth * outsideBody;
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
meshNode.setName('AmberveinLeafwingMesh').setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', doc.createAccessor('Leafwing_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Leafwing_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
const oldInverseBind = sourceSkin.getInverseBindMatrices();
sourceSkin.dispose();
oldInverseBind?.dispose();
for (const node of [...root.listNodes()].reverse()) if (node !== meshNode) node.dispose();

const rigContainer = doc.createNode('AmberveinLeafwingRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
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
const skin = doc.createSkin('AmberveinLeafwing_Skin').setSkeleton(jointNodes.get('LeafwingRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
skin.setInverseBindMatrices(doc.createAccessor('Leafwing_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));
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
        quat('z', idleAngles(bone.side, localSegment, bone.wing, time, period, amplitude, phaseScale) * multipliers(time) + biasAt(bone, time)),
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
  { node: 'LeafwingRoot', path: 'translation', times: [0, .24, .48, .72, .96], values: [[0, 0, 0], [0, .012, 0], [0, 0, 0], [0, -.006, 0], [0, 0, 0]] },
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
glideTracks.push({ node: 'LeafwingRoot', path: 'translation', times: [0, .25, .5, .75, 1], values: [[0, 0, 0], [0, .010, .012], [0, 0, .018], [0, -.006, .008], [0, 0, 0]] });
for (const side of [-1, 1]) for (const kind of ['Front', 'Mid', 'Hind']) {
  const suffix = side < 0 ? 'L' : 'R';
  glideTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: [0, .25, .5, .75, 1], values: [quat('x', .09), quat('x', .14), quat('x', .10), quat('x', .06), quat('x', .09)] });
}
addClip('Walk', 1, glideTracks);

const dashTimes = sampledTimes(.72, .06);
const dashTracks = wingTracks({ duration: .72, period: .18, amplitude: .57, phaseScale: .72, times: dashTimes, multipliers: () => 1 });
dashTracks.push({ node: 'LeafwingRoot', path: 'translation', times: [0, .18, .36, .54, .72], values: [[0, 0, 0], [0, .016, .018], [0, 0, .028], [0, -.008, .012], [0, 0, 0]] });
dashTracks.push({ node: 'Thorax', times: [0, .18, .36, .54, .72], values: [quat('x', .02), quat('x', .085), quat('x', .06), quat('x', .025), quat('x', .02)] });
for (const side of [-1, 1]) for (const kind of ['Front', 'Mid', 'Hind']) {
  const suffix = side < 0 ? 'L' : 'R';
  dashTracks.push({ node: `Leg${kind}Distal_${suffix}`, times: [0, .18, .36, .54, .72], values: [quat('x', -.13), quat('x', -.20), quat('x', -.16), quat('x', -.10), quat('x', -.13)] });
}
addClip('Run', .72, dashTracks);

const actionTimes = [0, .18, .36, .52, .72, .90];
const attackTracks = wingTracks({ duration: .90, period: .22, amplitude: .39, phaseScale: 1, times: actionTimes, multipliers: time => time >= .18 && time <= .52 ? 1.24 : .8 });
attackTracks.push(
  { node: 'Neck', times: actionTimes, values: [quat('x', 0), quat('x', -.03), quat('x', .43), quat('x', .20), quat('x', -.05), quat('x', 0)] },
  { node: 'Head', times: actionTimes, values: [quat('x', 0), quat('x', .02), quat('x', .28), quat('x', .11), quat('x', -.02), quat('x', 0)] },
  { node: 'AbdomenMid', times: actionTimes, values: [quat('x', 0), quat('x', -.04), quat('x', -.18), quat('x', -.09), quat('x', .02), quat('x', 0)] },
  { node: 'AbdomenTip', times: actionTimes, values: [quat('x', 0), quat('x', -.05), quat('x', -.24), quat('x', -.12), quat('x', .03), quat('x', 0)] },
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
  { node: 'LeafwingRoot', path: 'translation', times: deathTimes, values: [[0, 0, 0], [0, .015, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] },
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

const assetId = 'creature_ambervein_leafwing';
const productionTarget = 'game/public/assets/models/fairy-crown/creature_ambervein_leafwing.glb';
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: assetId,
  displayName: 'Ambervein Leafwing',
  tier: 'T30 fairy ecology; optional T60 dusk-glade variant after world review',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    modelId: '0a131c51-bd21-487b-8973-5ac00f8521bc',
    publicProjectId: '98776da4-a10d-4974-910d-adba0888e99b',
    starredCard: true,
    prompt: 'Winged fantasy creature with leaf-like translucent wings, teal and gold body, highly detailed skin and joints.',
    generator: 'Tripo P2.0, 8K PBR export',
    visualReview: 'Astra-low accepted the amber/teal flying leafwing for the Fairy region. Public Tripo preview confirmed four leaf wings, six legs, upright Y-up orientation, head/antennae above thorax, tapered abdomen, and wingsheet plane aligned to X/Y.',
    geometry: { vertices: vertexCount, triangles: sourceIndices.length / 3, bounds, positionsPreserved: true, normalsPreserved: true, uvPreserved: true, indicesPreserved: true, retopology: false },
    sourceRig: { joints: sourceJointCount, sourceWeights: 'Every source vertex was fully weighted to joint 0; no usable articulation or animation clips.' },
    textures: sourceTextureMetrics,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget,
    geometry: { vertices: vertexCount, triangles: sourceIndices.length / 3, positionDelta, normalDelta, uvDelta, indexMismatches, retopology: false },
    rig: {
      profile: 'Y-up non-humanoid glTF Generic insect rig; inspect Generic import path in Unity',
      jointCount: bones.length,
      boneNames: checkJointNames,
      parentHierarchy: Object.fromEntries(bones.map(bone => [bone.name, bone.parent])),
      restPositions: Object.fromEntries(bones.map(bone => [bone.name, bone.p])),
      weighting: 'Four-influence normalized skin using distance to model-specific thorax, antenna, tapered abdomen, bilateral upper/lower leaf-wing and six-leg segment chains. Wing sheet gate is based on the inspected source view; original source root-only skin discarded.',
      weightedVerticesByJoint: Object.fromEntries(bones.map((bone, index) => [bone.name, jointInfluenceCounts[index]])),
      multiWeightedVertexRatio: multiWeightedRatio,
      maximumWeightSumError: readbackMaxWeightError,
    },
    textures: runtimeTextureMetrics,
    pbrChannels: { roughnessRange, metallicRange, materialFactors: { roughness: checkMaterials[0]?.getRoughnessFactor(), metalness: checkMaterials[0]?.getMetallicFactor() } },
    animationSlots: [
      { ...clipMetrics[0], intent: 'hovering idle with continuous asymmetric upper/lower leaf-wing beats, antennae and small body drift' },
      { ...clipMetrics[1], intent: 'Walk slot is an airborne glide with steady paired wing beats and tucked legs; no footfall cycle' },
      { ...clipMetrics[2], intent: 'Run slot is a fast aerial dart with higher-frequency wing beats and tucked legs; no ground gait' },
      { ...clipMetrics[3], intent: 'front-leg jab with neck/head lunge, abdomen countercurl and wing flare' },
      { ...clipMetrics[4], intent: 'brief asymmetrical body recoil and wing stutter' },
      { ...clipMetrics[5], intent: 'wing fold, antenna/leg curl and controlled body drop' },
    ],
  },
  acceptance: { sourceDesignAudit: true, geometryPreserved: true, runtimeTextures2K: true, rig: false, animation: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${here}/catalog.json`, `${JSON.stringify(catalog, null, 2)}\n`);

const labAsset = {
  id: 'creature_lantern_sprite',
  file: 'models/fairy-crown/creature_lantern_sprite.glb',
  pack: 'corealm-starred-fairy-candidates',
  category: 'character',
  is: 'Ambervein Leafwing (starred rig candidate)',
  tags: ['creature', 'fairy', 'flying', 'insect', 'leaf-wing', 'T30', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: sourceIndices.length / 3,
  animations: clipMetrics.map(clip => clip.name),
  materials: checkMaterials.map(entry => entry.getName()),
  sourceProvenance: {
    generator: 'Tripo Smart Mesh P2.0',
    prompt: 'Winged fantasy creature with leaf-like translucent wings, teal and gold body, highly detailed skin and joints.',
    sourceModelId: '0a131c51-bd21-487b-8973-5ac00f8521bc',
    publicProjectId: '98776da4-a10d-4974-910d-adba0888e99b',
    sourceFile: sourcePath,
    sourceSha256,
    candidateFile: candidatePath,
    candidateSha256,
    rigMethod: '33-joint insect-specific wing/body/antenna/six-leg Y-up skeleton with normalized four-influence weights; original mesh positions, normals, UVs and image-generated base/PBR textures retained.',
    textures: runtimeTextureMetrics,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${here}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { creature_lantern_sprite: path.basename(candidatePath) } }, null, 2)}\n`);
console.log(JSON.stringify({ candidatePath, candidateSha256, sourceSha256, bytes: outputBytes.length, vertices: vertexCount, triangles: sourceIndices.length / 3, joints: bones.length, animations: clipMetrics, sourceTextureMetrics, runtimeTextureMetrics, pbrChannels: { roughnessRange, metallicRange }, multiWeightedVertexRatio: multiWeightedRatio, maximumWeightSumError: readbackMaxWeightError, geometryDelta: { positionDelta, normalDelta, uvDelta, indexMismatches } }, null, 2));
