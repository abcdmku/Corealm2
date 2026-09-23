import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const here = 'assets/art/tripo/imports/creatures/new-star-winged-demon';
const sourcePath = 'assets/art/tripo/exports/c6dd592c-41cc-469a-b889-a3b8182909d4.glb';
const candidatePath = `${here}/vesperwing-ravager-native-rig-candidate.glb`;
const sourceSha256Expected = '0ba042d2ef67f6acb03ca58158c5b306debce1dcfff6539ce948b35d3f9cc871';
const expectedVertexCount = 6990;
const expectedTriangleCount = 4818;
const uniformScale = 2.2;

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
assert(scene && primitive && meshNode && sourceSkin, 'Expected one skinned source creature.');
assert.equal(root.listMeshes().length, 1, 'Expected one source mesh.');
assert.equal(mesh.listPrimitives().length, 1, 'Expected one source mesh primitive.');

const sourcePositions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const sourceNormals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const sourceUvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const sourceIndices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const vertexCount = sourcePositions.length / 3;
assert.equal(vertexCount, expectedVertexCount, 'Source vertex count changed.');
assert.equal(sourceIndices.length / 3, expectedTriangleCount, 'Source triangle count changed.');
assert.equal(sourceNormals.length, sourcePositions.length, 'Expected one source normal per vertex.');
assert.equal(sourceUvs.length / 2, vertexCount, 'Expected one source UV per vertex.');

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < sourcePositions.length; i += 3) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], sourcePositions[i + axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], sourcePositions[i + axis]);
  }
}
assert(Math.abs(bounds.min[1]) < 1e-6 && bounds.max[1] > .95, `Expected a grounded Y-up source mesh: ${JSON.stringify(bounds)}`);

const sourceJointCount = sourceSkin.listJoints().length;
const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
const sourceJoints = primitive.getAttribute('JOINTS_0')?.getArray();
assert(sourceWeights && sourceJoints, 'Expected source skin attributes.');
const sourceDominantWeightCounts = new Map();
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let dominantSlot = 0;
  for (let slot = 1; slot < 4; slot++) {
    if (sourceWeights[vertex * 4 + slot] > sourceWeights[vertex * 4 + dominantSlot]) dominantSlot = slot;
  }
  const jointIndex = sourceJoints[vertex * 4 + dominantSlot];
  sourceDominantWeightCounts.set(jointIndex, (sourceDominantWeightCounts.get(jointIndex) ?? 0) + 1);
}
const sourceDominantJointHistogram = Object.fromEntries([...sourceDominantWeightCounts.entries()].map(([index, count]) => [sourceSkin.listJoints()[index]?.getName() ?? String(index), count]));
const sourceRootWeightFailure = sourceDominantWeightCounts.get(0) ?? 0;

// This Y-up rig follows the visible one-metre upright humanoid with laterally spread bat wings.
// The bad Tripo Hips-only weights and malformed inverse-bind data are replaced; mesh attributes
// remain unchanged. Bone positions were fitted to the inspected silhouette and the GLB Generic
// hierarchy can be imported directly in Unity without Humanoid remapping.
const bones = [];
function addBone(name, parent, position, group, options = {}) {
  bones.push({ name, parent, p: position, group, sigma: .085, ...options });
}
addBone('VesperRoot', null, [0, 0, 0], 'root', { sigma: .72 });
addBone('Hips', 'VesperRoot', [0, .455, .205], 'pelvis', { sigma: .125 });
addBone('Spine', 'Hips', [0, .535, .205], 'torso', { sigma: .12 });
addBone('Chest', 'Spine', [0, .665, .190], 'torso', { sigma: .115 });
addBone('Neck', 'Chest', [0, .790, .205], 'neck', { sigma: .075 });
addBone('Head', 'Neck', [0, .880, .215], 'head', { sigma: .105 });
addBone('Jaw', 'Head', [0, .837, .270], 'jaw', { sigma: .070 });

for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  addBone(`Shoulder_${suffix}`, 'Chest', [side * .115, .712, .174], 'arm', { side, armPart: 0, sigma: .082 });
  addBone(`UpperArm_${suffix}`, `Shoulder_${suffix}`, [side * .215, .620, .200], 'arm', { side, armPart: 1, sigma: .085 });
  addBone(`Forearm_${suffix}`, `UpperArm_${suffix}`, [side * .315, .535, .235], 'arm', { side, armPart: 2, sigma: .077 });
  addBone(`Hand_${suffix}`, `Forearm_${suffix}`, [side * .354, .482, .255], 'hand', { side, sigma: .070 });

  addBone(`UpperLeg_${suffix}`, 'Hips', [side * .078, .285, .215], 'leg', { side, legPart: 0, sigma: .100 });
  addBone(`LowerLeg_${suffix}`, `UpperLeg_${suffix}`, [side * .075, .103, .220], 'leg', { side, legPart: 1, sigma: .085 });
  addBone(`Foot_${suffix}`, `LowerLeg_${suffix}`, [side * .075, .045, .285], 'foot', { side, sigma: .080 });

  addBone(`WingRoot_${suffix}`, 'Chest', [side * .105, .720, -.085], 'wing', { side, wingSegment: 0, sigma: .105 });
  addBone(`WingInner_${suffix}`, `WingRoot_${suffix}`, [side * .235, .835, -.145], 'wing', { side, wingSegment: 1, sigma: .110 });
  addBone(`WingOuter_${suffix}`, `WingInner_${suffix}`, [side * .365, .875, -.175], 'wing', { side, wingSegment: 2, sigma: .100 });
  addBone(`WingTip_${suffix}`, `WingOuter_${suffix}`, [side * .448, .720, -.125], 'wing', { side, wingSegment: 3, sigma: .090 });
}

assert.equal(bones.length, 29, 'Unexpected rig size.');
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  assert(!bone.parent || parent, `Missing parent joint ${bone.parent}.`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + vector[axis] * t)));
}
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const jointValues = new Uint16Array(vertexCount * 4);
const weightValues = new Float32Array(vertexCount * 4);
const jointInfluenceCounts = new Uint32Array(bones.length);
const multiWeightedVertices = new Set();
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [sourcePositions[vertex * 3], sourcePositions[vertex * 3 + 1], sourcePositions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const scores = [];
  for (const bone of bones) {
    const entry = boneByName.get(bone.name);
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
    let gate = 1;
    if (bone.group === 'root') gate = .008;
    if (bone.group === 'pelvis') gate = (.06 + .94 * sigmoid((.56 - y) / .06)) * (.12 + .88 * sigmoid((.20 - Math.abs(x)) / .055));
    if (bone.group === 'torso') gate = (.06 + .94 * sigmoid((y - .40) / .05)) * (.06 + .94 * sigmoid((.78 - y) / .06)) * (.08 + .92 * sigmoid((.22 - Math.abs(x)) / .06));
    if (bone.group === 'neck') gate = (.04 + .96 * sigmoid((y - .70) / .035)) * (.08 + .92 * sigmoid((.15 - Math.abs(x)) / .035));
    if (bone.group === 'head') gate = (.025 + .975 * sigmoid((y - .79) / .032)) * (.08 + .92 * sigmoid((.17 - Math.abs(x)) / .045));
    if (bone.group === 'jaw') gate = (.04 + .96 * sigmoid((.875 - y) / .025)) * (.10 + .90 * sigmoid((.13 - Math.abs(x)) / .035)) * (.15 + .85 * sigmoid((z - .235) / .035));
    if (bone.group === 'arm') {
      const side = .025 + .975 * sigmoid((bone.side * x - .075) / .035);
      const upperBand = .06 + .94 * sigmoid((y - .43) / .05);
      const lowerBand = .06 + .94 * sigmoid((.79 - y) / .05);
      const outerArm = .18 + .82 * sigmoid((Math.abs(x) - .09) / .045);
      gate = side * upperBand * lowerBand * outerArm;
    }
    if (bone.group === 'hand') {
      const side = .025 + .975 * sigmoid((bone.side * x - .24) / .04);
      gate = side * (.025 + .975 * sigmoid((.565 - y) / .035)) * (.04 + .96 * sigmoid((y - .37) / .05));
    }
    if (bone.group === 'leg') {
      const side = .03 + .97 * sigmoid((bone.side * x + .005) / .035);
      gate = side * (.035 + .965 * sigmoid((.53 - y) / .05)) * (.10 + .90 * sigmoid((y - .015) / .035));
    }
    if (bone.group === 'foot') {
      const side = .035 + .965 * sigmoid((bone.side * x + .005) / .035);
      gate = side * (.02 + .98 * sigmoid((.16 - y) / .028)) * (.12 + .88 * sigmoid((z - .20) / .05));
    }
    if (bone.group === 'wing') {
      const side = .02 + .98 * sigmoid((bone.side * x + .018) / .033);
      const awayFromTorso = .025 + .975 * sigmoid((Math.abs(x) - .072) / .040);
      const elevated = .035 + .965 * sigmoid((y - .57) / .045);
      const rearBiased = .30 + .70 * sigmoid((.205 - z) / .07);
      gate = side * awayFromTorso * elevated * rearBiased;
    }
    const score = gate * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) scores.push({ index: entry.index, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const chosen = scores.slice(0, 4);
  assert(chosen.length > 0, `Vertex ${vertex} has no anatomical weight candidate.`);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  let count = 0;
  for (let slot = 0; slot < 4; slot++) {
    const candidate = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : candidate.score / total;
    jointValues[vertex * 4 + slot] = candidate.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) {
      jointInfluenceCounts[candidate.index]++;
      count++;
    }
  }
  if (count > 1) multiWeightedVertices.add(vertex);
  const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
const multiWeightedRatio = multiWeightedVertices.size / vertexCount;
assert(multiWeightedRatio > .72, `Too many rigidly weighted vertices: ${(multiWeightedRatio * 100).toFixed(1)}%.`);
for (const group of ['torso', 'arm', 'leg', 'wing']) {
  const weighted = bones.some((bone, index) => bone.group === group && jointInfluenceCounts[index] > 0);
  assert(weighted, `The ${group} joints have no mesh influence.`);
}
const emptyAppendageJoints = bones.filter((bone, index) => ['arm', 'hand', 'leg', 'foot', 'wing'].includes(bone.group) && jointInfluenceCounts[index] === 0).map(bone => bone.name);
assert.deepEqual(emptyAppendageJoints, [], `Appendage joints received no skin weights: ${emptyAppendageJoints.join(', ')}`);

const originalArmature = meshNode.getParentNode();
assert(originalArmature, 'Expected the original mesh under its source armature.');
originalArmature.removeChild(meshNode);
if (scene.listChildren().includes(originalArmature)) scene.removeChild(originalArmature);
meshNode.setName('VesperwingRavagerMesh').setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
primitive.setAttribute('JOINTS_0', doc.createAccessor('Vesperwing_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Vesperwing_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
const oldInverseBind = sourceSkin.getInverseBindMatrices();
sourceSkin.dispose();
oldInverseBind?.dispose();
for (const node of [...root.listNodes()].reverse()) if (node !== meshNode) node.dispose();

const rigContainer = doc.createNode('VesperwingRavagerRig').setScale([uniformScale, uniformScale, uniformScale]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  const parentNode = bone.parent ? jointNodes.get(bone.parent) : rigContainer;
  assert(parentNode, `Joint parent was not built for ${bone.name}.`);
  parentNode.addChild(node);
}
const skin = doc.createSkin('VesperwingRavager_Skin').setSkeleton(jointNodes.get('VesperRoot'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
skin.setInverseBindMatrices(doc.createAccessor('Vesperwing_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));
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
function sampledTimes(duration, step) {
  const times = [];
  for (let t = 0; t < duration - 1e-6; t += step) times.push(Number(t.toFixed(6)));
  times.push(duration);
  return times;
}
const clipMetrics = [];
const clipTrackSets = new Map();
function addClip(name, duration, tracks) {
  // The source mesh is authored in a spread-arm pose. Apply one guard pose in each gameplay
  // clip's baseline, then layer the action's own rotations on top of that same folded stance.
  const guardAngles = { Shoulder: .64, UpperArm: .10, Forearm: .40, Hand: .05 };
  for (const suffix of ['L', 'R']) {
    const side = suffix === 'L' ? -1 : 1;
    for (const [part, angle] of Object.entries(guardAngles)) {
      const node = `${part}_${suffix}`;
      const baseline = part === 'Forearm'
        ? multiplyQuaternions(quat('z', -side * angle), quat('y', -side * .36))
        : quat('z', -side * angle);
      const existing = tracks.find(track => track.node === node && (track.path ?? 'rotation') === 'rotation');
      if (existing) {
        existing.values = existing.values.map(value => multiplyQuaternions(baseline, value));
      } else {
        tracks.push({ node, times: [0, duration], values: [baseline, baseline] });
      }
    }
  }
  clipTrackSets.set(name, tracks);
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    assert(jointNodes.has(track.node), `Clip ${name} targets absent joint ${track.node}.`);
    assert.equal(track.times.length, track.values.length, `Clip ${name}/${track.node} has unequal sample counts.`);
    const pathName = track.path ?? 'rotation';
    const input = doc.createAccessor(`${name}_${track.node}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
    const output = doc.createAccessor(`${name}_${track.node}_${pathName}_value`).setArray(Float32Array.from(track.values.flat())).setType(pathName === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${pathName}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}`).setTargetNode(jointNodes.get(track.node)).setTargetPath(pathName).setSampler(sampler));
  }
  clipMetrics.push({ name, seconds: duration, channels: tracks.length, paths: [...new Set(tracks.map(track => track.path ?? 'rotation'))] });
}
function wingTracks(times, { period, amplitude, multipliers = () => 1, spread = () => 0, sweep = () => 0 }) {
  return bones.filter(bone => bone.group === 'wing').map(bone => {
    const taper = [1, .72, .50, .34][bone.wingSegment];
    const phase = bone.wingSegment * .11 + (bone.side < 0 ? 0 : period * .13);
    return {
      node: bone.name,
      times,
      values: times.map(time => {
        const wave = Math.sin((time / period - phase / period) * Math.PI * 2);
        const beat = bone.side * amplitude * taper * wave * multipliers(time);
        return multiplyQuaternions(quat('z', beat + bone.side * spread(time) * taper), quat('x', sweep(time) * taper));
      }),
    };
  });
}
const suffixes = ['L', 'R'];
const idleTimes = sampledTimes(1.20, .10);
const idleTracks = wingTracks(idleTimes, { period: .96, amplitude: .19, spread: () => -.06, sweep: () => .02 });
idleTracks.push(
  { node: 'VesperRoot', path: 'translation', times: [0, .30, .60, .90, 1.20], values: [[0, .070, 0], [0, .082, 0], [0, .070, 0], [0, .058, 0], [0, .070, 0]] },
  { node: 'Spine', times: [0, .30, .60, .90, 1.20], values: [quat('x', -.012), quat('x', .015), quat('x', -.01), quat('x', .013), quat('x', -.012)] },
  { node: 'Head', times: [0, .30, .60, .90, 1.20], values: [quat('y', -.012), quat('y', .018), quat('y', .025), quat('y', -.015), quat('y', -.012)] },
);
for (const side of suffixes) {
  const sign = side === 'L' ? -1 : 1;
  const bodyWave = idleTimes.map(time => Math.sin(time / 1.20 * Math.PI * 2));
  idleTracks.push({ node: `Shoulder_${side}`, times: idleTimes, values: bodyWave.map(value => multiplyQuaternions(quat('z', -sign * .075 * value), quat('x', .025 * value))) });
  idleTracks.push({ node: `UpperArm_${side}`, times: idleTimes, values: bodyWave.map(value => quat('z', -sign * .045 * value)) });
  idleTracks.push({ node: `Forearm_${side}`, times: idleTimes, values: bodyWave.map(value => multiplyQuaternions(quat('z', -sign * .09 * value), quat('y', -sign * .07 * value))) });
  idleTracks.push({ node: `Hand_${side}`, times: idleTimes, values: bodyWave.map(value => quat('z', sign * .035 * value)) });
  const legWave = idleTimes.map(time => Math.sin(time / 1.20 * Math.PI * 2 + (sign < 0 ? 0 : Math.PI)));
  idleTracks.push({ node: `UpperLeg_${side}`, times: idleTimes, values: legWave.map(value => quat('x', -.07 + value * .07)) });
  idleTracks.push({ node: `LowerLeg_${side}`, times: idleTimes, values: legWave.map(value => quat('x', .10 + Math.max(0, -value) * .10)) });
  idleTracks.push({ node: `Foot_${side}`, times: idleTimes, values: legWave.map(value => quat('x', .02 - value * .045)) });
}
addClip('Idle', 1.20, idleTracks);

// Slow airy approach: legs tuck into the wing stroke while the guard stays folded in front.
const walkTimes = sampledTimes(1.0, .125);
const walkTracks = wingTracks(walkTimes, { period: .84, amplitude: .30, spread: () => -.20, sweep: () => -.04 });
walkTracks.push({ node: 'VesperRoot', path: 'translation', times: [0, .25, .5, .75, 1], values: [[0, .060, 0], [0, .070, .012], [0, .060, 0], [0, .050, -.012], [0, .060, 0]] });
walkTracks.push({ node: 'Chest', times: [0, .25, .5, .75, 1], values: [quat('y', -.025), quat('y', .020), quat('y', .025), quat('y', -.02), quat('y', -.025)] });
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  const phase = side < 0 ? 0 : Math.PI;
  const cycle = walkTimes.map(time => Math.sin((time + (phase / (Math.PI * 2))) * Math.PI * 2));
  walkTracks.push({ node: `UpperLeg_${suffix}`, times: walkTimes, values: cycle.map(value => quat('x', -.28 + value * .20)) });
  walkTracks.push({ node: `LowerLeg_${suffix}`, times: walkTimes, values: cycle.map(value => quat('x', .42 + Math.max(0, -value) * .28)) });
  walkTracks.push({ node: `Foot_${suffix}`, times: walkTimes, values: cycle.map(value => quat('x', .10 - value * .08)) });
  walkTracks.push({ node: `Shoulder_${suffix}`, times: walkTimes, values: cycle.map(value => multiplyQuaternions(quat('z', -side * value * .14), quat('x', -value * .08))) });
  walkTracks.push({ node: `UpperArm_${suffix}`, times: walkTimes, values: cycle.map(value => multiplyQuaternions(quat('z', -side * value * .14), quat('x', -value * .11))) });
  walkTracks.push({ node: `Forearm_${suffix}`, times: walkTimes, values: cycle.map(value => multiplyQuaternions(quat('z', side * Math.max(0, value) * .15), quat('x', .045 + Math.max(0, value) * .08))) });
}
addClip('Walk', 1, walkTracks);

// Run transitions toward flight: legs tuck on the recovery beat, wings beat faster and the torso leans forward.
const runTimes = sampledTimes(.78, .065);
const runKeyTimes = [0, .195, .39, .585, .78];
const runTracks = wingTracks(runTimes, { period: .78, amplitude: .46, spread: () => -.10, sweep: () => -.12 });
runTracks.push({ node: 'VesperRoot', path: 'translation', times: runKeyTimes, values: [[0, .050, 0], [0, .080, .012], [0, .095, .028], [0, .080, .014], [0, .050, 0]] });
runTracks.push({ node: 'Chest', times: runKeyTimes, values: [quat('x', .025), quat('x', -.16), quat('x', -.19), quat('x', -.11), quat('x', .025)] });
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  const phase = side < 0 ? 0 : Math.PI;
  const cycle = runTimes.map(time => Math.sin((time / .39) * Math.PI * 2 + phase));
  runTracks.push({ node: `UpperLeg_${suffix}`, times: runTimes, values: cycle.map(value => quat('x', -.36 + value * .55)) });
  runTracks.push({ node: `LowerLeg_${suffix}`, times: runTimes, values: cycle.map(value => quat('x', .45 + Math.max(0, -value) * .48)) });
  runTracks.push({ node: `Foot_${suffix}`, times: runTimes, values: cycle.map(value => quat('x', .14 - value * .20)) });
  runTracks.push({ node: `Shoulder_${suffix}`, times: runTimes, values: cycle.map(value => multiplyQuaternions(quat('z', -side * value * .18), quat('x', -.16 + value * .08))) });
  runTracks.push({ node: `UpperArm_${suffix}`, times: runTimes, values: cycle.map(value => quat('z', -side * value * .15)) });
  runTracks.push({ node: `Forearm_${suffix}`, times: runTimes, values: cycle.map(value => multiplyQuaternions(quat('z', side * Math.max(0, value) * .18), quat('x', .08 + Math.max(0, value) * .12))) });
}
addClip('Run', .78, runTracks);

const attackTimes = [0, .16, .34, .52, .72, .92];
const attackTracks = wingTracks(attackTimes, { period: .72, amplitude: .24, multipliers: time => time >= .16 && time <= .52 ? 1.15 : .65, spread: time => time >= .16 && time <= .52 ? -.48 : -.10, sweep: time => time >= .16 && time <= .52 ? .10 : -.04 });
attackTracks.push(
  { node: 'Chest', times: attackTimes, values: [quat('x', 0), quat('y', -.12), quat('x', -.20), quat('x', .25), quat('x', .08), quat('x', 0)] },
  { node: 'Neck', times: attackTimes, values: [quat('x', 0), quat('x', -.10), quat('x', -.30), quat('x', .14), quat('x', .05), quat('x', 0)] },
  { node: 'Head', times: attackTimes, values: [quat('x', 0), quat('x', .04), quat('x', .22), quat('x', -.08), quat('x', -.03), quat('x', 0)] },
  { node: 'Hips', times: attackTimes, values: [quat('y', 0), quat('y', .06), quat('y', .13), quat('y', -.10), quat('y', -.035), quat('y', 0)] },
);
attackTracks.push({ node: 'Shoulder_R', times: attackTimes, values: [quat('x', 0), quat('x', -.20), quat('x', -.68), quat('x', -.34), quat('x', -.12), quat('x', 0)] });
attackTracks.push({ node: 'UpperArm_R', times: attackTimes, values: [quat('x', 0), quat('x', -.26), quat('x', -.84), quat('x', -.48), quat('x', -.10), quat('x', 0)] });
attackTracks.push({ node: 'Forearm_R', times: attackTimes, values: [quat('x', 0), quat('x', -.10), quat('x', -.74), quat('x', -.28), quat('x', -.06), quat('x', 0)] });
attackTracks.push({ node: 'Hand_R', times: attackTimes, values: [quat('x', 0), quat('x', -.12), quat('x', -.38), quat('x', -.10), quat('x', -.04), quat('x', 0)] });
attackTracks.push({ node: 'Shoulder_L', times: attackTimes, values: [quat('x', 0), quat('x', .08), quat('x', .19), quat('x', .05), quat('x', 0), quat('x', 0)] });
attackTracks.push({ node: 'UpperArm_L', times: attackTimes, values: [quat('x', 0), quat('x', .10), quat('x', .24), quat('x', .05), quat('x', 0), quat('x', 0)] });
for (const node of ['Shoulder_R', 'UpperArm_R', 'Forearm_R', 'Hand_R']) {
  const scale = node === 'Shoulder_R' ? 1 : node === 'UpperArm_R' ? .78 : node === 'Forearm_R' ? .62 : .28;
  const action = [0, -.18, -.88, -.56, -.18, 0].map(value => quat('y', value * scale));
  const track = attackTracks.find(entry => entry.node === node);
  if (track) track.values = track.values.map((value, index) => multiplyQuaternions(action[index], value));
  else attackTracks.push({ node, times: attackTimes, values: action });
}
attackTracks.push({ node: 'VesperRoot', path: 'translation', times: attackTimes, values: [[0, .070, 0], [0, .082, .04], [0, .088, .18], [0, .065, .12], [0, .060, .04], [0, .070, 0]] });
addClip('Attack', .92, attackTracks);

const hitTimes = [0, .07, .17, .30, .46];
const hitTracks = wingTracks(hitTimes, { period: .30, amplitude: .12, multipliers: time => time >= .07 && time <= .17 ? .24 : .70, spread: time => time < .17 ? -.06 : -.20, sweep: time => time < .17 ? .12 : 0 });
hitTracks.push(
  { node: 'Chest', times: hitTimes, values: [quat('x', 0), quat('x', .26), quat('x', -.09), quat('x', -.035), quat('x', 0)] },
  { node: 'Head', times: hitTimes, values: [quat('z', 0), quat('z', .20), quat('z', -.06), quat('z', 0), quat('z', 0)] },
  { node: 'Hips', times: hitTimes, values: [quat('y', 0), quat('y', -.16), quat('y', .07), quat('y', .025), quat('y', 0)] },
  { node: 'UpperArm_L', times: hitTimes, values: [quat('x', 0), quat('x', .18), quat('x', -.07), quat('x', 0), quat('x', 0)] },
  { node: 'UpperArm_R', times: hitTimes, values: [quat('x', 0), quat('x', -.10), quat('x', .05), quat('x', 0), quat('x', 0)] },
);
addClip('Hit', .46, hitTracks);

const deathTimes = [0, .20, .48, .84, 1.16, 1.48];
const deathTracks = wingTracks(deathTimes, {
  period: .52,
  amplitude: .10,
  multipliers: time => time < .20 ? 1 : time < .48 ? .25 : 0,
  spread: time => -.04 - .56 * Math.max(0, Math.min(1, (time - .16) / .60)),
  sweep: time => .02 + .30 * Math.max(0, Math.min(1, (time - .16) / .60)),
});
deathTracks.push(
  { node: 'VesperRoot', path: 'translation', times: deathTimes, values: [[0, .070, 0], [0, .080, 0], [0, .040, 0], [0, .010, 0], [0, 0, 0], [0, 0, 0]] },
  { node: 'Hips', times: deathTimes, values: [quat('x', 0), quat('x', .05), quat('x', .20), quat('x', .38), quat('x', .42), quat('x', .42)] },
  { node: 'Spine', times: deathTimes, values: [quat('x', 0), quat('x', -.06), quat('x', -.18), quat('x', -.33), quat('x', -.36), quat('x', -.36)] },
  { node: 'Neck', times: deathTimes, values: [quat('z', 0), quat('z', .06), quat('z', -.12), quat('z', -.26), quat('z', -.29), quat('z', -.29)] },
  { node: 'Head', times: deathTimes, values: [quat('x', 0), quat('x', .06), quat('x', .12), quat('x', .25), quat('x', .27), quat('x', .27)] },
);
for (const side of [-1, 1]) {
  const suffix = side < 0 ? 'L' : 'R';
  deathTracks.push({ node: `UpperLeg_${suffix}`, times: deathTimes, values: [quat('x', 0), quat('x', side * .05), quat('x', -.20), quat('x', -.38), quat('x', -.42), quat('x', -.42)] });
  deathTracks.push({ node: `LowerLeg_${suffix}`, times: deathTimes, values: [quat('x', 0), quat('x', .04), quat('x', -.18), quat('x', -.39), quat('x', -.42), quat('x', -.42)] });
  deathTracks.push({ node: `Shoulder_${suffix}`, times: deathTimes, values: [quat('x', 0), quat('x', side * .05), quat('x', side * .18), quat('x', side * .28), quat('x', side * .30), quat('x', side * .30)] });
  deathTracks.push({ node: `UpperArm_${suffix}`, times: deathTimes, values: [quat('z', 0), quat('z', side * .05), quat('z', side * .17), quat('z', side * .28), quat('z', side * .30), quat('z', side * .30)] });
}
addClip('Death', 1.48, deathTracks);
assert.deepEqual(clipMetrics.map(clip => clip.name), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);

const normalizeQuaternion = q => {
  const length = Math.hypot(...q) || 1;
  return q.map(value => value / length);
};
function slerpQuaternion(a, b, t) {
  let right = b;
  let dot = a.reduce((sum, value, index) => sum + value * right[index], 0);
  if (dot < 0) { right = right.map(value => -value); dot = -dot; }
  if (dot > .9995) return normalizeQuaternion(a.map((value, index) => value + (right[index] - value) * t));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sine = Math.sin(theta);
  const leftWeight = Math.sin((1 - t) * theta) / sine;
  const rightWeight = Math.sin(t * theta) / sine;
  return a.map((value, index) => value * leftWeight + right[index] * rightWeight);
}
function rotateVector(q, value) {
  const u = q.slice(0, 3), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const uv = cross(u, value), uuv = cross(u, uv);
  return value.map((entry, axis) => entry + 2 * (q[3] * uv[axis] + uuv[axis]));
}
function sampleTrack(track, time) {
  if (!track) return undefined;
  if (time <= track.times[0]) return track.values[0];
  if (time >= track.times.at(-1)) return track.values.at(-1);
  let next = 1;
  while (track.times[next] < time) next++;
  const previous = next - 1;
  const fraction = (time - track.times[previous]) / (track.times[next] - track.times[previous]);
  return (track.path ?? 'rotation') === 'translation'
    ? track.values[previous].map((value, axis) => value + (track.values[next][axis] - value) * fraction)
    : slerpQuaternion(track.values[previous], track.values[next], fraction);
}
function evaluatePose(clipName, time) {
  const tracks = clipTrackSets.get(clipName);
  const byTargetPath = new Map(tracks.map(track => [`${track.node}:${track.path ?? 'rotation'}`, track]));
  const transforms = new Map();
  for (const bone of bones) {
    const parent = bone.parent ? transforms.get(bone.parent) : null;
    const localRotation = sampleTrack(byTargetPath.get(`${bone.name}:rotation`), time) ?? [0, 0, 0, 1];
    const localTranslation = sampleTrack(byTargetPath.get(`${bone.name}:translation`), time) ?? bone.local;
    transforms.set(bone.name, parent
      ? { rotation: normalizeQuaternion(multiplyQuaternions(parent.rotation, localRotation)), position: parent.position.map((value, axis) => value + rotateVector(parent.rotation, localTranslation)[axis]) }
      : { rotation: localRotation, position: localTranslation });
  }
  return transforms;
}
function skinPosition(vertex, transforms) {
  const sourcePoint = [sourcePositions[vertex * 3], sourcePositions[vertex * 3 + 1], sourcePositions[vertex * 3 + 2]];
  const result = [0, 0, 0];
  for (let slot = 0; slot < 4; slot++) {
    const jointIndex = jointValues[vertex * 4 + slot], weight = weightValues[vertex * 4 + slot];
    if (weight <= 0) continue;
    const bone = bones[jointIndex], transform = transforms.get(bone.name);
    const relative = sourcePoint.map((value, axis) => value - bone.p[axis]);
    const rotated = rotateVector(transform.rotation, relative);
    for (let axis = 0; axis < 3; axis++) result[axis] += (transform.position[axis] + rotated[axis]) * weight;
  }
  const rootOffset = transforms.get('VesperRoot').position;
  return result.map((value, axis) => (value - rootOffset[axis]) * uniformScale);
}
const weightedVertexGroups = { wing: [], arm: [], leg: [] };
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const totals = { wing: 0, arm: 0, leg: 0 };
  for (let slot = 0; slot < 4; slot++) {
    const bone = bones[jointValues[vertex * 4 + slot]], weight = weightValues[vertex * 4 + slot];
    if (bone.group === 'wing') totals.wing += weight;
    if (['arm', 'hand'].includes(bone.group)) totals.arm += weight;
    if (['leg', 'foot'].includes(bone.group)) totals.leg += weight;
  }
  const x = sourcePositions[vertex * 3], y = sourcePositions[vertex * 3 + 1];
  if (totals.wing > .48 && Math.abs(x) > .08 && y > .58) weightedVertexGroups.wing.push(vertex);
  if (totals.arm > .45 && Math.abs(x) > .10 && y > .36 && y < .90) weightedVertexGroups.arm.push(vertex);
  if (totals.leg > .45 && y < .57) weightedVertexGroups.leg.push(vertex);
}
for (const [group, vertices] of Object.entries(weightedVertexGroups)) assert(vertices.length >= 12, `Insufficient ${group} vertices for deformation verification.`);
function motionDelta(clipName, start, end, vertices) {
  const from = evaluatePose(clipName, start), to = evaluatePose(clipName, end);
  const distances = vertices.map(vertex => {
    const a = skinPosition(vertex, from), b = skinPosition(vertex, to);
    return Math.hypot(...a.map((value, axis) => value - b[axis]));
  }).sort((a, b) => a - b);
  return { vertices: vertices.length, meanMeters: distances.reduce((sum, value) => sum + value, 0) / distances.length, p95Meters: distances[Math.floor((distances.length - 1) * .95)], maxMeters: distances.at(-1) };
}
function verticalBounds(clipName) {
  const duration = clipMetrics.find(clip => clip.name === clipName).seconds;
  const minimum = { value: Infinity, time: 0 }, maximum = { value: -Infinity, time: 0 };
  const samples = 41;
  for (let sample = 0; sample < samples; sample++) {
    const time = duration * sample / (samples - 1), pose = evaluatePose(clipName, time);
    const rootY = pose.get('VesperRoot').position[1] * uniformScale;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const y = skinPosition(vertex, pose)[1] + rootY;
      if (y < minimum.value) Object.assign(minimum, { value: y, time });
      if (y > maximum.value) Object.assign(maximum, { value: y, time });
    }
  }
  return { sampleCount: samples, minWorldY: minimum.value, minAtSeconds: minimum.time, maxWorldY: maximum.value, maxAtSeconds: maximum.time };
}
const deformationMetrics = {
  Idle: { wing: motionDelta('Idle', .02, .26, weightedVertexGroups.wing), arm: motionDelta('Idle', .02, .26, weightedVertexGroups.arm), leg: motionDelta('Idle', .02, .26, weightedVertexGroups.leg) },
  Walk: { wing: motionDelta('Walk', .02, .23, weightedVertexGroups.wing), arm: motionDelta('Walk', .02, .23, weightedVertexGroups.arm), leg: motionDelta('Walk', .02, .23, weightedVertexGroups.leg) },
  Run: { wing: motionDelta('Run', .02, .41, weightedVertexGroups.wing), arm: motionDelta('Run', .02, .20, weightedVertexGroups.arm), leg: motionDelta('Run', .10, .295, weightedVertexGroups.leg) },
  Attack: { arm: motionDelta('Attack', .16, .48, weightedVertexGroups.arm), wing: motionDelta('Attack', .16, .48, weightedVertexGroups.wing) },
};
const verticalEnvelopes = Object.fromEntries(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(name => [name, verticalBounds(name)]));
console.log(JSON.stringify({ deformationMetrics, weightedVertexCounts: Object.fromEntries(Object.entries(weightedVertexGroups).map(([group, vertices]) => [group, vertices.length])) }, null, 2));
assert(deformationMetrics.Idle.wing.p95Meters > .045, `Idle wings barely deform: ${deformationMetrics.Idle.wing.p95Meters}m.`);
assert(deformationMetrics.Idle.arm.p95Meters > .04, `Idle guard arms barely move: ${deformationMetrics.Idle.arm.p95Meters}m.`);
assert(deformationMetrics.Idle.leg.p95Meters > .015, `Idle legs barely flex: ${deformationMetrics.Idle.leg.p95Meters}m.`);
assert(deformationMetrics.Walk.wing.p95Meters > .08, `Walk wings barely deform: ${deformationMetrics.Walk.wing.p95Meters}m.`);
assert(deformationMetrics.Walk.arm.p95Meters > .06, `Walk guard arms barely move: ${deformationMetrics.Walk.arm.p95Meters}m.`);
assert(deformationMetrics.Walk.leg.p95Meters > .04, `Walk legs barely deform: ${deformationMetrics.Walk.leg.p95Meters}m.`);
assert(deformationMetrics.Run.wing.p95Meters > .12, `Run wings barely deform: ${deformationMetrics.Run.wing.p95Meters}m.`);
assert(deformationMetrics.Run.arm.p95Meters > .08, `Run guard arms barely move: ${deformationMetrics.Run.arm.p95Meters}m.`);
assert(deformationMetrics.Run.leg.p95Meters > .08, `Run legs barely deform: ${deformationMetrics.Run.leg.p95Meters}m.`);
assert(deformationMetrics.Attack.arm.p95Meters > .14, `Attack arm barely moves: ${deformationMetrics.Attack.arm.p95Meters}m.`);
for (const [clip, envelope] of Object.entries(verticalEnvelopes)) {
  assert(envelope.minWorldY >= -.025, `${clip} sinks below the ground plane: y=${envelope.minWorldY}m at ${envelope.minAtSeconds}s.`);
  assert(envelope.maxWorldY <= 2.65, `${clip} exceeds the intended hover envelope: y=${envelope.maxWorldY}m.`);
}

// Preserve image-authored maps and channel meaning. Only reduce runtime dimensions to 2K.
const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
assert(material && baseColorTexture && metallicRoughnessTexture && normalTexture, 'Expected base color, packed metal-roughness and normal maps.');
const sourceTextureMetrics = [];
const runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const sourceImage = texture.getImage();
  const metadata = await sharp(sourceImage).metadata();
  const role = texture === baseColorTexture ? 'base color (sRGB)' : texture === metallicRoughnessTexture ? 'packed metallic-roughness (linear; G=roughness, B=metalness)' : texture === normalTexture ? 'tangent-space normal (linear)' : 'other';
  sourceTextureMetrics.push({ name: texture.getName(), role, width: metadata.width, height: metadata.height, mime: texture.getMimeType(), bytes: sourceImage.length, sha256: createHash('sha256').update(sourceImage).digest('hex') });
  if (Math.max(metadata.width ?? 0, metadata.height ?? 0) > 2048) {
    let encoded;
    if (texture === baseColorTexture) {
      encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
      texture.setMimeType('image/jpeg');
    } else if (texture === metallicRoughnessTexture) {
      encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 9 }).toBuffer();
      texture.setMimeType('image/png');
    } else if (texture === normalTexture) {
      const raw = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).removeAlpha().raw().toBuffer();
      for (let i = 0; i < raw.length; i += 3) {
        let nx = raw[i] / 127.5 - 1, ny = raw[i + 1] / 127.5 - 1, nz = raw[i + 2] / 127.5 - 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length; ny /= length; nz /= length;
        raw[i] = Math.round((nx + 1) * 127.5);
        raw[i + 1] = Math.round((ny + 1) * 127.5);
        raw[i + 2] = Math.round((nz + 1) * 127.5);
      }
      encoded = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
      texture.setMimeType('image/png');
    } else {
      encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'inside', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
      texture.setMimeType('image/png');
    }
    texture.setImage(encoded);
  }
  const runtimeImage = texture.getImage();
  const runtimeMetadata = await sharp(runtimeImage).metadata();
  assert(Math.max(runtimeMetadata.width ?? 0, runtimeMetadata.height ?? 0) <= 2048, `Runtime map ${texture.getName()} exceeds 2K.`);
  runtimeTextureMetrics.push({ name: texture.getName(), role, width: runtimeMetadata.width, height: runtimeMetadata.height, mime: texture.getMimeType(), bytes: runtimeImage.length, sha256: createHash('sha256').update(runtimeImage).digest('hex') });
}
const pbrSamples = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const roughnessRange = [Infinity, -Infinity], metallicRange = [Infinity, -Infinity];
for (let i = 0; i < pbrSamples.length; i += 3) {
  roughnessRange[0] = Math.min(roughnessRange[0], pbrSamples[i + 1] / 255);
  roughnessRange[1] = Math.max(roughnessRange[1], pbrSamples[i + 1] / 255);
  metallicRange[0] = Math.min(metallicRange[0], pbrSamples[i + 2] / 255);
  metallicRange[1] = Math.max(metallicRange[1], pbrSamples[i + 2] / 255);
}
assert(roughnessRange[1] - roughnessRange[0] > .08, `Packed roughness channel is flat: ${roughnessRange}.`);

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
const checkJointArray = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
const checkWeightArray = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
assert(checkPositionArray && checkNormalArray && checkUvArray && checkIndexArray && checkJointArray && checkWeightArray && checkSkin, 'Candidate lacks geometry, UVs, skin or indices.');
assert.equal(checkRoot.listSkins().length, 1, 'Candidate must have exactly one skin.');
assert.equal(checkRoot.listNodes().length, bones.length + 2, 'Candidate contains source skeleton nodes.');
assert.equal(checkRoot.listAnimations().length, 6, 'Candidate must contain all six gameplay clips.');
for (const animation of checkRoot.listAnimations()) {
  const animatedArmJoints = new Set(animation.listChannels().map(channel => channel.getTargetNode().getName()));
  for (const suffix of ['L', 'R']) for (const part of ['Shoulder', 'UpperArm', 'Forearm', 'Hand']) {
    assert(animatedArmJoints.has(`${part}_${suffix}`), `${animation.getName()} is missing the lowered guard baseline on ${part}_${suffix}.`);
  }
}
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
    const joint = checkJointArray[vertex * 4 + slot], weight = checkWeightArray[vertex * 4 + slot];
    assert(Number.isInteger(joint) && joint >= 0 && joint < checkSkin.listJoints().length, `Invalid joint index at vertex ${vertex}.`);
    assert(Number.isFinite(weight) && weight >= 0, `Invalid joint weight at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  readbackMaxWeightError = Math.max(readbackMaxWeightError, Math.abs(sum - 1));
  if (nonzero > 1) readbackMultiWeighted++;
}
assert(readbackMaxWeightError < 1e-5, `Skin weights are not normalized: ${readbackMaxWeightError}.`);
assert(readbackMultiWeighted / vertexCount > .72, 'Export lost distributed skin weights.');
for (const animation of checkRoot.listAnimations()) {
  for (const channel of animation.listChannels()) assert(checkSkin.listJoints().includes(channel.getTargetNode()), `${animation.getName()} targets a node outside the skin.`);
}

const riggingVerification = {
  sourceRig: { joints: sourceJointCount, dominantJointHistogram: sourceDominantJointHistogram, rootDominantVertices: sourceRootWeightFailure, note: 'Tripo output is unusable as exported: virtually every vertex is weighted to Hips, with malformed inverse-bind values. Reconstructed a Y-up Generic winged-humanoid skeleton and distributed weights over existing vertices.' },
  candidateRig: { profile: 'Unity-compatible glTF Generic Y-up skeleton; no Humanoid avatar retargeting required', joints: bones.length, hierarchy: Object.fromEntries(bones.map(bone => [bone.name, bone.parent])), restPositions: Object.fromEntries(bones.map(bone => [bone.name, bone.p])), weightedVerticesByJoint: Object.fromEntries(bones.map((bone, index) => [bone.name, jointInfluenceCounts[index]])), multiWeightedVertexRatio: multiWeightedRatio, maxWeightSumError: readbackMaxWeightError, bodyGroupsWithWeights: ['torso', 'arm', 'leg', 'wing'], guardPose: { sideMirroredShoulderDownDegrees: 36.7, sideMirroredUpperArmDownDegrees: 5.7, sideMirroredForearmDownDegrees: 22.9, forearmForwardYawDegrees: 20.6, combinedSideProfileDegrees: 65.3, appliedInEveryClip: true }, topologyChanged: false, positionsChanged: false, normalsChanged: false, uvChanged: false, indicesChanged: false },
  animationCheck: clipMetrics.map(clip => ({ ...clip, targetsOnlySkinJoints: true, guardArmJointsPresent: true, intent: ({ Idle: 'Low hover with a relaxed guard, slow wingbeat, subtle arm flex and leg drift.', Walk: 'Airborne approach with measured wingbeats, a moving guard, tucked knees and ankle motion.', Run: 'Closed .78-second aerial wing stroke, bent-leg tuck/recovery, guard counter-sway and small lift.', Attack: 'Forward lunge with a right-claw sweep, chest follow-through and left-wing brace.', Hit: 'Brief torso recoil from the lowered guard, head snap and uneven wing stutter.', Death: 'Knees buckle, torso slumps and wings fold while the base descends to the ground plane.' })[clip.name] })),
  animationDeformation: deformationMetrics,
  groundAndHover: { bindPoseGroundY: bounds.min[1], idleRootOffsetY: [.058, .082], walkRootOffsetY: [.050, .070], runRootOffsetY: [.050, .095], deathRootOffsetY: [0, .080], verticalEnvelopes, flightStyle: 'hovering alert Idle and airborne Walk/Run; Death settles to ground' },
};
await writeFile(`${here}/rigging-verification.json`, JSON.stringify(riggingVerification, null, 2));

const assetId = 'creature_vesperwing_ravager';
const productionTarget = 'game/public/assets/models/fairy-crown/creature_vesperwing_ravager.glb';
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: assetId,
  displayName: 'Vesperwing Ravager',
  tier: 'T60 Faeholme aerial predator; reserve for the high-tier fairy wilds',
  region: 'Faeholme',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    cardStorageId: '8aa88436-4da9-47ad-9d6c-be5789a33ce5',
    projectId: 'c6dd592c-41cc-469a-b889-a3b8182909d4',
    starredCard: true,
    generator: 'Tripo P1 Smart Mesh, exported from starred source with 8K base color and 4K PBR maps',
    geometry: { vertices: vertexCount, triangles: sourceIndices.length / 3, bounds, positionsPreserved: true, normalsPreserved: true, uvPreserved: true, indicesPreserved: true, retopology: false },
    sourceRig: riggingVerification.sourceRig,
    textures: sourceTextureMetrics,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget,
    geometry: { vertices: vertexCount, triangles: sourceIndices.length / 3, positionDelta, normalDelta, uvDelta, indexMismatches, scale: uniformScale, retopology: false },
    rig: riggingVerification.candidateRig,
    textures: runtimeTextureMetrics,
    pbrChannels: { roughnessRange, metallicRange, materialFactors: { roughness: material.getRoughnessFactor(), metalness: material.getMetallicFactor() } },
    animationSlots: riggingVerification.animationCheck,
    animationDeformation: riggingVerification.animationDeformation,
    groundAndHover: riggingVerification.groundAndHover,
  },
  acceptance: { sourceDesignReview: false, rig: true, animation: true, pbr: true, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${here}/catalog.json`, JSON.stringify(catalog, null, 2));

const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  assets: [{
    id: assetId,
    file: 'models/fairy-crown/creature_vesperwing_ravager.glb',
    pack: 'corealm-starred-faeholme-candidates',
    category: 'character',
    is: 'Vesperwing Ravager (starred P1 rig candidate)',
    tags: ['creature', 'Faeholme', 'fairy', 'winged', 'aerial', 'T60', 'starred', 'tripo', 'candidate'],
    bytes: outputBytes.length,
    sha256: candidateSha256,
    size: { x: (bounds.max[0] - bounds.min[0]) * uniformScale, y: (bounds.max[1] - bounds.min[1]) * uniformScale, z: (bounds.max[2] - bounds.min[2]) * uniformScale },
    base: { x: bounds.min[0] * uniformScale, y: bounds.min[1] * uniformScale, z: bounds.min[2] * uniformScale },
    bounds: { min: bounds.min.map(value => value * uniformScale), max: bounds.max.map(value => value * uniformScale) },
    groundY: bounds.min[1] * uniformScale,
    triangles: sourceIndices.length / 3,
    animations: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
    materials: root.listMaterials().map(entry => entry.getName()),
    sourceProvenance: {
      generator: 'Tripo P1 Smart Mesh',
      cardStorageId: '8aa88436-4da9-47ad-9d6c-be5789a33ce5',
      sourceModelId: 'c6dd592c-41cc-469a-b889-a3b8182909d4',
      sourceFile: sourcePath,
      sourceSha256,
      candidateFile: candidatePath,
      candidateSha256,
      rigMethod: 'Replaced root-only skin with 29-joint Unity Generic winged-humanoid rig and anatomically gated four-influence weights. Mesh positions, normals, UVs, indices and authored texture imagery preserved; runtime PBR maps downsampled to 2K.',
      sourceRigFailure: 'virtually all vertices used Hips with malformed inverse binds',
      textures: runtimeTextureMetrics,
      candidateStatus: 'awaiting-root-lab-review',
    },
    acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  }],
  files: { [assetId]: 'vesperwing-ravager-native-rig-candidate.glb' },
};
await writeFile(`${here}/lab-catalog.json`, JSON.stringify(labCatalog, null, 2));
console.log(JSON.stringify({ candidatePath, candidateBytes: outputBytes.length, candidateSha256, triangles: expectedTriangleCount, vertices: vertexCount, sourceRig: riggingVerification.sourceRig, candidateRig: { joints: bones.length, multiWeightedRatio, maxWeightSumError: readbackMaxWeightError }, clips: clipMetrics, textures: runtimeTextureMetrics.map(({ name, role, width, height, bytes }) => ({ name, role, width, height, bytes })), pbrChannels: { roughnessRange, metallicRange }, scale: uniformScale }, null, 2));
