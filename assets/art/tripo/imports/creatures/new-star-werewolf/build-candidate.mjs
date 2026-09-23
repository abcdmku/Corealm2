import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const owner = 'assets/art/tripo/imports/creatures/new-star-werewolf';
const sourcePath = 'assets/art/tripo/exports/57fc524c-107c-4711-ad29-7219e29eed9f.glb';
const candidatePath = `${owner}/gloamfang-reaver-native-rig-candidate.glb`;
const expectedSourceSha256 = '02eb10038296893b44e2bb3bc29298adfc9cd7de0f51c8a4d7c05203c31bbe4d';
const projectId = '57fc524c-107c-4711-ad29-7219e29eed9f';
const cardStorageId = '5d71797c-6492-46cb-a8f8-d0d9c62cb9bd';

await mkdir(owner, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceSha256, expectedSourceSha256, 'The starred source export changed.');

const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
const skin = root.listSkins()[0];
assert(scene && mesh && primitive && meshNode && skin, 'Expected one static, skinned Werewolf Warrior GLB.');
assert.equal(root.listMeshes().length, 1, 'Expected one source mesh.');
assert.equal(root.listSkins().length, 1, 'Expected one source skin.');
assert.equal(root.listAnimations().length, 0, 'Expected no source clips.');
assert.equal(skin.listJoints().length, 62, 'Source skeleton changed.');

const sourcePositions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const sourceNormals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const sourceUvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const sourceIndices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
const sourceJoints = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
assert(sourcePositions.length && sourceNormals.length && sourceUvs.length && sourceIndices.length, 'Source mesh is missing geometry data.');
assert(sourceJoints && sourceWeights, 'Expected source skin attributes.');
assert.equal(sourcePositions.length / 3, 8047, 'Source vertex count changed.');
assert.equal(sourceIndices.length / 3, 4760, 'Source triangle count changed.');
assert.equal(sourceUvs.length / 2, sourcePositions.length / 3, 'Expected one source UV per vertex.');

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < sourcePositions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], sourcePositions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], sourcePositions[i + axis]);
}
assert(Math.abs(bounds.min[1]) < 1e-5 && bounds.max[1] > .94, `Unexpected Y-up, grounded source bounds: ${JSON.stringify(bounds)}.`);

const jointNodes = skin.listJoints();
const jointIndex = new Map(jointNodes.map((node, index) => [node.getName(), index]));
const sourceParents = new Map(jointNodes.map(node => [node.getName(), node.getParentNode()?.getName()]));
let rootWeightedVertices = 0;
let oneInfluenceVertices = 0;
for (let vertex = 0; vertex < sourcePositions.length / 3; vertex++) {
  let total = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const weight = sourceWeights[vertex * 4 + slot];
    total += weight;
    if (weight > 1e-6) nonzero++;
    if (sourceJoints[vertex * 4 + slot] === 0 && weight > .999) rootWeightedVertices++;
  }
  assert(Math.abs(total - 1) < 1e-5, `Source skin has invalid weight sum at vertex ${vertex}.`);
  if (nonzero === 1) oneInfluenceVertices++;
}
assert(rootWeightedVertices >= sourcePositions.length / 3 * .99 && oneInfluenceVertices >= sourcePositions.length / 3 * .99,
  'Expected the known unusable Tripo root-pinned skin; stop if the export has changed.');

// Tripo supplied 62 humanoid bone names and hierarchy, but their rest transforms are all at
// the origin and 99.9% of vertices are pinned to Hips. Keep the Unity-friendly hierarchy and
// labels, place the joints to the authored silhouette, then rebuild its bind matrices/weights.
// The mesh, triangles, normals, source UVs and image maps are never retopologized or repainted.
const anchors = new Map();
const set = (name, point) => anchors.set(name, point);
set('Hips', [0, .425, -.005]);
set('Spine', [0, .490, -.005]);
set('Chest', [0, .565, -.002]);
set('UpperChest', [0, .645, 0]);
set('Neck', [0, .735, 0]);
set('Neck_Twist_A', [0, .785, 0]);
set('Head', [0, .846, .005]);
set('Left_Eye', [.027, .878, .095]);
set('Right_Eye', [-.027, .878, .095]);

for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  set(`${prefix}_Shoulder`, [side * .112, .677, 0]);
  set(`${prefix}_UpperArm`, [side * .238, .712, 0]);
  set(`${prefix}_LowerArm`, [side * .371, .744, .002]);
  set(`${prefix}_Hand`, [side * .449, .750, .006]);
  const fingers = [
    ['Thumb', .076], ['Index', .043], ['Middle', .014], ['Ring', -.014], ['Pinky', -.044],
  ];
  for (const [finger, z] of fingers) {
    const hasDistalEnd = finger === 'Thumb' || finger === 'Ring' || (side > 0 && finger === 'Index');
    const chain = finger === 'Thumb'
      ? ['ThumbProximal', 'ThumbIntermediate', 'ThumbDistal', 'ThumbDistalEnd']
      : [`${finger}Proximal`, `${finger}Intermediate`, `${finger}Distal`, ...(hasDistalEnd ? [`${finger}DistalEnd`] : [])];
    const xs = finger === 'Thumb' ? [.438, .447, .455, .461] : [.462, .476, .489, .498];
    chain.forEach((suffix, index) => set(`${prefix}_${suffix}`, [side * xs[index], .750, z * (1 + index * .04)]));
  }
  set(`${prefix}_UpperLeg`, [side * .108, .374, -.004]);
  set(`${prefix}_LowerLeg`, [side * .137, .194, -.002]);
  set(`${prefix}_Foot`, [side * .150, .064, .008]);
  set(`${prefix}_Toes`, [side * .163, .033, .060]);
  set(`${prefix}_ToesEnd`, [side * .174, .028, .115]);
}
assert.equal(anchors.size, jointNodes.length, `Rig anchor map mismatch (${anchors.size}/${jointNodes.length}).`);
for (const node of jointNodes) {
  const target = anchors.get(node.getName());
  const parentName = sourceParents.get(node.getName());
  const parentAnchor = anchors.get(parentName) ?? [0, 0, 0];
  node.setTranslation(target.map((value, axis) => value - parentAnchor[axis]));
  node.setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
}
const armature = meshNode.getParentNode();
assert(armature, 'Expected the source mesh to be parented to its armature.');
assert.deepEqual(armature.getTranslation(), [0, 0, 0], 'Armature transform must remain identity.');
assert.deepEqual(meshNode.getTranslation(), [0, 0, 0], 'Mesh transform must remain identity.');
skin.setSkeleton(jointNodes[jointIndex.get('Hips')]);
const inverseBind = new Float32Array(jointNodes.length * 16);
for (let i = 0; i < jointNodes.length; i++) {
  const [x, y, z] = anchors.get(jointNodes[i].getName());
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
skin.setInverseBindMatrices(doc.createAccessor('Gloamfang_InverseBindMatrices').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(root.listBuffers()[0]));

function sigmoid(value) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))); }
function band(value, low, high, fade = .035) { return sigmoid((value - low) / fade) * sigmoid((high - value) / fade); }
function distanceToSegment(point, start, end) {
  const line = end.map((value, axis) => value - start[axis]);
  const length2 = line.reduce((sum, value) => sum + value * value, 0);
  if (length2 < 1e-10) return Math.hypot(...point.map((value, axis) => value - start[axis]));
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * line[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * line[axis])));
}
function boneInfo(name) {
  const side = name.startsWith('Left_') ? 1 : name.startsWith('Right_') ? -1 : 0;
  if (name === 'Hips') return { group: 'pelvis', sigma: .100 };
  if (['Spine', 'Chest', 'UpperChest'].includes(name)) return { group: 'torso', sigma: .120 };
  if (['Neck', 'Neck_Twist_A'].includes(name)) return { group: 'neck', sigma: .072 };
  if (name === 'Head') return { group: 'head', sigma: .095 };
  if (name.endsWith('_Eye')) return { group: 'eye', sigma: .026 };
  if (name.includes('Shoulder')) return { group: 'arm', side, gateX: .065, sigma: .068 };
  if (name.includes('UpperArm')) return { group: 'arm', side, gateX: .125, sigma: .068 };
  if (name.includes('LowerArm')) return { group: 'arm', side, gateX: .250, sigma: .062 };
  if (name.endsWith('_Hand')) return { group: 'arm', side, gateX: .365, sigma: .052 };
  if (/_(Thumb|Index|Middle|Ring|Pinky)/.test(name)) return { group: 'finger', side, gateX: .410, sigma: .024 };
  if (name.includes('UpperLeg')) return { group: 'leg', side, low: .275, high: .49, sigma: .082 };
  if (name.includes('LowerLeg')) return { group: 'leg', side, low: .11, high: .36, sigma: .068 };
  if (name.endsWith('_Foot')) return { group: 'foot', side, low: 0, high: .15, sigma: .062 };
  if (name.includes('_Toes')) return { group: 'foot', side, low: 0, high: .09, sigma: .047 };
  throw new Error(`No anatomical skin-weight rule for ${name}.`);
}
const jointInfo = jointNodes.map(node => ({ name: node.getName(), parent: sourceParents.get(node.getName()), anchor: anchors.get(node.getName()), ...boneInfo(node.getName()) }));
function regionGate(bone, point) {
  const [x, y, z] = point;
  const center = sigmoid((.205 - Math.abs(x)) / .034);
  if (bone.group === 'pelvis') return band(y, .275, .555, .050) * center;
  if (bone.group === 'torso') {
    const [low, high] = bone.name === 'Spine' ? [.35, .625] : bone.name === 'Chest' ? [.46, .715] : [.565, .79];
    return band(y, low, high, .044) * sigmoid((.255 - Math.abs(x)) / .035);
  }
  if (bone.group === 'neck') return band(y, .685, .855, .035) * sigmoid((.145 - Math.abs(x)) / .028);
  if (bone.group === 'head') return band(y, .785, 1.01, .033) * sigmoid((.145 - Math.abs(x)) / .025);
  if (bone.group === 'eye') return band(y, .845, .925, .016) * Math.exp(-.5 * ((z - .095) / .045) ** 2);
  if (bone.group === 'arm') return band(y, .625, .835, .035) * sigmoid((bone.side * x - bone.gateX) / .035);
  if (bone.group === 'finger') {
    const targetZ = bone.anchor[2];
    return band(y, .675, .825, .025) * sigmoid((bone.side * x - bone.gateX) / .024) * Math.exp(-.5 * ((z - targetZ) / .052) ** 2);
  }
  if (bone.group === 'leg') return band(y, bone.low, bone.high, .045) * sigmoid((bone.side * x - .035) / .035);
  if (bone.group === 'foot') return band(y, bone.low, bone.high, .025) * sigmoid((bone.side * x - .035) / .040);
  return 0;
}
const jointValues = new Uint16Array(sourcePositions.length / 3 * 4);
const weightValues = new Float32Array(sourcePositions.length / 3 * 4);
const jointVertexUse = new Uint32Array(jointNodes.length);
let verticesWithDistributedWeights = 0;
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < sourcePositions.length / 3; vertex++) {
  const point = [sourcePositions[vertex * 3], sourcePositions[vertex * 3 + 1], sourcePositions[vertex * 3 + 2]];
  const scores = [];
  for (let index = 0; index < jointInfo.length; index++) {
    const bone = jointInfo[index];
    const parentAnchor = anchors.get(bone.parent) ?? bone.anchor;
    const distance = distanceToSegment(point, parentAnchor, bone.anchor);
    const score = regionGate(bone, point) * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-14) scores.push({ index, score });
  }
  if (scores.length === 0) {
    // Soft fallback is only for tiny disconnected details outside the body regions.
    let nearest = 0, nearestDistance = Infinity;
    for (let index = 0; index < jointInfo.length; index++) {
      const distance = Math.hypot(...point.map((value, axis) => value - jointInfo[index].anchor[axis]));
      if (distance < nearestDistance) { nearestDistance = distance; nearest = index; }
    }
    scores.push({ index: nearest, score: 1 });
  }
  scores.sort((a, b) => b.score - a.score);
  const chosen = scores.slice(0, 4);
  const total = chosen.reduce((sum, candidate) => sum + candidate.score, 0);
  let assigned = 0, influences = 0;
  for (let slot = 0; slot < 4; slot++) {
    const entry = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : entry.score / total;
    jointValues[vertex * 4 + slot] = entry.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) { influences++; jointVertexUse[entry.index]++; }
  }
  if (influences > 1) verticesWithDistributedWeights++;
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(assigned - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('Gloamfang_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Gloamfang_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
assert(verticesWithDistributedWeights > sourcePositions.length / 3 * .70,
  `Rebuilt weights remain too concentrated: ${verticesWithDistributedWeights}/${sourcePositions.length / 3}.`);

const quat = (axis, angle) => {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  if (axis === 'x') return [s, 0, 0, c];
  if (axis === 'y') return [0, s, 0, c];
  return [0, 0, s, c];
};
function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
const normalize = q => { const length = Math.hypot(...q) || 1; return q.map(value => value / length); };
const identity = () => [0, 0, 0, 1];
const baseHips = anchors.get('Hips');
const clipMetrics = [];
const clipTracks = new Map();
function addClip(name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    assert(jointIndex.has(track.node), `${name} targets unknown joint ${track.node}.`);
    assert.equal(track.times.length, track.values.length, `${name}/${track.node} track counts mismatch.`);
    const path = track.path ?? 'rotation';
    const input = doc.createAccessor(`${name}_${track.node}_${path}_time`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
    const output = doc.createAccessor(`${name}_${track.node}_${path}_value`).setArray(Float32Array.from(track.values.flat())).setType(path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${path}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}_${path}`).setTargetNode(jointNodes[jointIndex.get(track.node)]).setTargetPath(path).setSampler(sampler));
  }
  clipTracks.set(name, tracks);
  clipMetrics.push({ name, seconds, channels: tracks.length });
}
function phasedRotations(node, side, axis, base, amount, times, phase = 0) {
  return { node, times, values: times.map(t => quat(axis, base + amount * Math.sin(t * Math.PI * 2 + phase) * side)) };
}

const idleTimes = [0, .6, 1.2, 1.8, 2.4];
const idle = [
  { node: 'Hips', path: 'translation', times: idleTimes, values: idleTimes.map((_, i) => [baseHips[0], baseHips[1] + [0, .006, 0, -.004, 0][i], baseHips[2]]) },
  { node: 'Spine', times: idleTimes, values: [0, 1, 2, 3, 4].map(i => quat('x', [.010, .027, .010, -.006, .010][i])) },
  { node: 'Chest', times: idleTimes, values: [0, 1, 2, 3, 4].map(i => quat('x', [.018, .034, .018, .004, .018][i])) },
  { node: 'Head', times: idleTimes, values: [0, 1, 2, 3, 4].map(i => quat('y', [-.018, .015, .030, -.005, -.018][i])) },
];
for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  idle.push({ node: `${prefix}_Shoulder`, times: idleTimes, values: idleTimes.map((_, i) => quat('z', -side * [.52, .50, .52, .54, .52][i])) });
  idle.push({ node: `${prefix}_UpperArm`, times: idleTimes, values: idleTimes.map((_, i) => quat('z', -side * [.08, .06, .08, .10, .08][i])) });
  idle.push({ node: `${prefix}_LowerArm`, times: idleTimes, values: idleTimes.map((_, i) => quat('z', -side * [.18, .22, .18, .14, .18][i])) });
  idle.push({ node: `${prefix}_UpperLeg`, times: idleTimes, values: idleTimes.map((_, i) => quat('x', [.018, .030, .018, .012, .018][i])) });
}
addClip('Idle', 2.4, idle);

const walkTimes = [0, .25, .5, .75, 1];
const walk = [
  { node: 'Hips', path: 'translation', times: walkTimes, values: [[baseHips[0], baseHips[1], baseHips[2]], [baseHips[0], baseHips[1] + .018, baseHips[2]], [baseHips[0], baseHips[1], baseHips[2]], [baseHips[0], baseHips[1] + .018, baseHips[2]], [baseHips[0], baseHips[1], baseHips[2]]] },
  { node: 'Spine', times: walkTimes, values: walkTimes.map(t => quat('x', .055 + .022 * Math.sin(t * Math.PI * 2))) },
  { node: 'Chest', times: walkTimes, values: walkTimes.map(t => quat('x', .030 + .015 * Math.sin(t * Math.PI * 2))) },
];
for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  const phase = side > 0 ? 0 : Math.PI;
  walk.push({ node: `${prefix}_UpperLeg`, times: walkTimes, values: walkTimes.map(t => quat('x', .38 * Math.sin(t * Math.PI * 2 + phase))) });
  walk.push({ node: `${prefix}_LowerLeg`, times: walkTimes, values: walkTimes.map(t => quat('x', -.30 * Math.max(0, Math.sin(t * Math.PI * 2 + phase)))) });
  walk.push({ node: `${prefix}_Shoulder`, times: walkTimes, values: walkTimes.map(t => multiply(quat('z', -side * .50), quat('y', side * .16 * Math.sin(t * Math.PI * 2 + phase + Math.PI)))) });
  walk.push({ node: `${prefix}_LowerArm`, times: walkTimes, values: walkTimes.map(t => quat('z', -side * (.18 + .10 * Math.max(0, Math.sin(t * Math.PI * 2 + phase))))) });
}
addClip('Walk', 1, walk);

const runTimes = [0, .17, .34, .51, .68];
const run = [
  { node: 'Hips', path: 'translation', times: runTimes, values: [[baseHips[0], baseHips[1], baseHips[2]], [baseHips[0], baseHips[1] + .034, baseHips[2]], [baseHips[0], baseHips[1] - .004, baseHips[2]], [baseHips[0], baseHips[1] + .034, baseHips[2]], [baseHips[0], baseHips[1], baseHips[2]]] },
  { node: 'Spine', times: runTimes, values: runTimes.map(t => quat('x', .17 + .040 * Math.sin(t / .68 * Math.PI * 2))) },
  { node: 'Chest', times: runTimes, values: runTimes.map(t => quat('x', .12 + .032 * Math.sin(t / .68 * Math.PI * 2))) },
  { node: 'Head', times: runTimes, values: runTimes.map(t => quat('x', -.06 + .02 * Math.sin(t / .68 * Math.PI * 2))) },
];
for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  const phase = side > 0 ? 0 : Math.PI;
  run.push({ node: `${prefix}_UpperLeg`, times: runTimes, values: runTimes.map(t => quat('x', .66 * Math.sin(t / .68 * Math.PI * 2 + phase))) });
  run.push({ node: `${prefix}_LowerLeg`, times: runTimes, values: runTimes.map(t => quat('x', -.64 * Math.max(0, Math.sin(t / .68 * Math.PI * 2 + phase)))) });
  run.push({ node: `${prefix}_Shoulder`, times: runTimes, values: runTimes.map(t => multiply(quat('z', -side * .45), quat('y', side * .39 * Math.sin(t / .68 * Math.PI * 2 + phase + Math.PI)))) });
  run.push({ node: `${prefix}_LowerArm`, times: runTimes, values: runTimes.map(t => quat('z', -side * (.24 + .18 * Math.max(0, Math.sin(t / .68 * Math.PI * 2 + phase))))) });
}
addClip('Run', .68, run);

const attackTimes = [0, .16, .34, .50, .68, .86];
const attack = [
  { node: 'Hips', path: 'translation', times: attackTimes, values: [[...baseHips], [baseHips[0], baseHips[1], baseHips[2] - .025], [baseHips[0], baseHips[1] - .018, baseHips[2] + .018], [baseHips[0], baseHips[1] - .008, baseHips[2] + .012], [...baseHips], [...baseHips]] },
  { node: 'Hips', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('y', [0, -.16, .25, .16, -.04, 0][i])) },
  { node: 'Spine', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [.05, .10, .24, .12, .035, .05][i])) },
  { node: 'Chest', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('y', [0, -.16, .24, .12, -.02, 0][i])) },
  { node: 'Head', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, -.06, .20, .10, -.01, 0][i])) },
  { node: 'Right_Shoulder', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => multiply(quat('z', [.52, .24, .34, .46, .54, .52][i]), quat('y', [0, -.36, .92, .48, .02, 0][i]))) },
  { node: 'Right_LowerArm', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('z', [.18, .06, -.44, -.20, .12, .18][i])) },
  { node: 'Right_Hand', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, -.12, .24, .11, 0, 0][i])) },
  { node: 'Left_Shoulder', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => multiply(quat('z', [-.52, -.62, -.44, -.48, -.54, -.52][i]), quat('y', [0, .10, -.14, -.08, 0, 0][i]))) },
  { node: 'Left_LowerArm', times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('z', [-.18, -.16, -.12, -.10, -.18, -.18][i])) },
];
for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  attack.push({ node: `${prefix}_UpperLeg`, times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, -.10 * side, .18 * side, .06 * side, 0, 0][i])) });
  attack.push({ node: `${prefix}_LowerLeg`, times: attackTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, .04, -.12, -.06, 0, 0][i])) });
}
addClip('Attack', .86, attack);

const hitTimes = [0, .07, .18, .31, .48];
const hit = [
  { node: 'Hips', path: 'translation', times: hitTimes, values: [[...baseHips], [baseHips[0], baseHips[1] - .010, baseHips[2] - .035], [baseHips[0], baseHips[1], baseHips[2] - .018], [...baseHips], [...baseHips]] },
  { node: 'Spine', times: hitTimes, values: [0, 1, 2, 3, 4].map(i => quat('x', [0, -.20, .09, .035, 0][i])) },
  { node: 'Chest', times: hitTimes, values: [0, 1, 2, 3, 4].map(i => quat('z', [0, .18, -.08, -.025, 0][i])) },
  { node: 'Head', times: hitTimes, values: [0, 1, 2, 3, 4].map(i => quat('x', [0, -.24, .08, .025, 0][i])) },
];
for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  hit.push({ node: `${prefix}_Shoulder`, times: hitTimes, values: [0, 1, 2, 3, 4].map(i => quat('z', -side * [.52, .25, .40, .49, .52][i])) });
  hit.push({ node: `${prefix}_LowerArm`, times: hitTimes, values: [0, 1, 2, 3, 4].map(i => quat('z', -side * [.18, .34, .12, .16, .18][i])) });
}
addClip('Hit', .48, hit);

const deathTimes = [0, .22, .52, .92, 1.30, 1.62];
const death = [
  { node: 'Hips', path: 'translation', times: deathTimes, values: [[...baseHips], [baseHips[0], baseHips[1] - .012, baseHips[2] - .015], [baseHips[0], baseHips[1] - .036, baseHips[2] + .005], [baseHips[0], baseHips[1] - .055, baseHips[2] + .018], [baseHips[0], baseHips[1] - .058, baseHips[2] + .020], [baseHips[0], baseHips[1] - .058, baseHips[2] + .020]] },
  { node: 'Hips', times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('z', [0, -.05, -.16, -.23, -.24, -.24][i])) },
  { node: 'Spine', times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [.01, .10, .26, .37, .39, .39][i])) },
  { node: 'Chest', times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [.02, .16, .35, .46, .48, .48][i])) },
  { node: 'UpperChest', times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, .08, .18, .24, .25, .25][i])) },
  { node: 'Head', times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, .04, .18, .32, .34, .34][i])) },
];
for (const side of [-1, 1]) {
  const prefix = side > 0 ? 'Left' : 'Right';
  death.push({ node: `${prefix}_UpperLeg`, times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, -.12, -.30, -.42, -.43, -.43][i])) });
  death.push({ node: `${prefix}_LowerLeg`, times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('x', [0, -.10, -.52, -.78, -.80, -.80][i])) });
  death.push({ node: `${prefix}_Shoulder`, times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('z', -side * [.52, .38, .18, .05, .04, .04][i])) });
  death.push({ node: `${prefix}_LowerArm`, times: deathTimes, values: [0, 1, 2, 3, 4, 5].map(i => quat('z', -side * [.18, .28, .44, .50, .50, .50][i])) });
}
addClip('Death', 1.62, death);
assert.deepEqual(clipMetrics.map(clip => clip.name), ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']);

// Source maps are retained as-authored and only downsampled if the actual export exceeds 2K.
// Use channel-aware kernels so packed MR and tangent-space normals keep their data semantics.
const material = root.listMaterials()[0];
const baseColor = material?.getBaseColorTexture();
const packedMr = material?.getMetallicRoughnessTexture();
const normalMap = material?.getNormalTexture();
assert(material && baseColor && packedMr && normalMap, 'Source must carry authored base-color, MR, and normal PBR maps.');
const sourceTextureMetrics = [], runtimeTextureMetrics = [];
for (const texture of root.listTextures()) {
  const sourceImage = texture.getImage();
  const metadata = await sharp(sourceImage).metadata();
  const role = texture === baseColor ? 'base color' : texture === packedMr ? 'packed metallic-roughness' : texture === normalMap ? 'normal' : 'other';
  sourceTextureMetrics.push({ name: texture.getName(), role, width: metadata.width, height: metadata.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(sourceImage).digest('hex') });
  if (Math.max(metadata.width ?? 0, metadata.height ?? 0) > 2048) {
    let encoded;
    if (texture === baseColor) encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
    else if (texture === packedMr) encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 9 }).toBuffer();
    else if (texture === normalMap) {
      const raw = await sharp(sourceImage).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).removeAlpha().raw().toBuffer();
      for (let i = 0; i < raw.length; i += 3) {
        let nx = raw[i] / 127.5 - 1, ny = raw[i + 1] / 127.5 - 1, nz = raw[i + 2] / 127.5 - 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length; ny /= length; nz /= length;
        raw[i] = Math.round((nx + 1) * 127.5); raw[i + 1] = Math.round((ny + 1) * 127.5); raw[i + 2] = Math.round((nz + 1) * 127.5);
      }
      encoded = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
      texture.setMimeType('image/jpeg');
    } else encoded = await sharp(sourceImage).resize(2048, 2048, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
    texture.setImage(encoded);
  }
  const runtimeImage = texture.getImage();
  const runtimeMeta = await sharp(runtimeImage).metadata();
  assert(Math.max(runtimeMeta.width ?? 0, runtimeMeta.height ?? 0) <= 2048, `${texture.getName()} is over the 2K runtime limit.`);
  runtimeTextureMetrics.push({ name: texture.getName(), role, width: runtimeMeta.width, height: runtimeMeta.height, mime: texture.getMimeType(), bytes: runtimeImage.length, sha256: createHash('sha256').update(runtimeImage).digest('hex') });
}
const pbrSample = await sharp(packedMr.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const roughnessRange = [Infinity, -Infinity], metallicRange = [Infinity, -Infinity];
for (let i = 0; i < pbrSample.length; i += 3) {
  roughnessRange[0] = Math.min(roughnessRange[0], pbrSample[i + 1] / 255);
  roughnessRange[1] = Math.max(roughnessRange[1], pbrSample[i + 1] / 255);
  metallicRange[0] = Math.min(metallicRange[0], pbrSample[i + 2] / 255);
  metallicRange[1] = Math.max(metallicRange[1], pbrSample[i + 2] / 255);
}
assert(roughnessRange[1] - roughnessRange[0] > .05, `Source roughness map is flat: ${roughnessRange}.`);
assert(metallicRange[1] - metallicRange[0] > .05, `Source metallic map is flat: ${metallicRange}.`);

// Sample linear-blend skinning at clip keys, with parent transforms and inverse binds. The
// checks verify that motion actually deforms the mesh while the rest pose stays grounded.
function rotateVector(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
function sampleTrack(track, time) {
  if (time <= track.times[0]) return track.values[0];
  if (time >= track.times.at(-1)) return track.values.at(-1);
  let right = 1;
  while (track.times[right] < time) right++;
  const left = right - 1;
  const t = (time - track.times[left]) / (track.times[right] - track.times[left]);
  if ((track.path ?? 'rotation') === 'translation') return track.values[left].map((value, axis) => value + (track.values[right][axis] - value) * t);
  let a = track.values[left], b = track.values[right];
  let dot = a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  if (dot < 0) { b = b.map(value => -value); dot = -dot; }
  if (dot > .9995) return normalize(a.map((value, axis) => value + (b[axis] - value) * t));
  const theta = Math.acos(Math.max(-1, Math.min(1, dot))), sine = Math.sin(theta);
  return normalize(a.map((value, axis) => (Math.sin((1 - t) * theta) * value + Math.sin(t * theta) * b[axis]) / sine));
}
function evaluateSkinning(tracks, time) {
  const byJoint = new Map(tracks.map(track => [`${track.node}:${track.path ?? 'rotation'}`, track]));
  const global = new Map();
  function transform(name) {
    if (global.has(name)) return global.get(name);
    const node = jointNodes[jointIndex.get(name)];
    const parentName = sourceParents.get(name);
    const localTranslationTrack = byJoint.get(`${name}:translation`);
    const localRotationTrack = byJoint.get(`${name}:rotation`);
    const localTranslation = localTranslationTrack ? sampleTrack(localTranslationTrack, time) : node.getTranslation();
    const localRotation = localRotationTrack ? sampleTrack(localRotationTrack, time) : identity();
    let result;
    if (jointIndex.has(parentName)) {
      const parent = transform(parentName);
      const offset = rotateVector(parent.rotation, localTranslation);
      result = { position: parent.position.map((value, axis) => value + offset[axis]), rotation: normalize(multiply(parent.rotation, localRotation)) };
    } else result = { position: localTranslation, rotation: localRotation };
    global.set(name, result);
    return result;
  }
  const transforms = jointNodes.map(node => transform(node.getName()));
  const deformedBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let sumSquaredDisplacement = 0, maximumDisplacement = 0;
  for (let vertex = 0; vertex < sourcePositions.length / 3; vertex++) {
    const source = [sourcePositions[vertex * 3], sourcePositions[vertex * 3 + 1], sourcePositions[vertex * 3 + 2]];
    const result = [0, 0, 0];
    for (let slot = 0; slot < 4; slot++) {
      const weight = weightValues[vertex * 4 + slot];
      if (weight <= 0) continue;
      const boneIndex = jointValues[vertex * 4 + slot];
      const bone = jointInfo[boneIndex];
      const transform = transforms[boneIndex];
      const relative = source.map((value, axis) => value - bone.anchor[axis]);
      const rotated = rotateVector(transform.rotation, relative);
      for (let axis = 0; axis < 3; axis++) result[axis] += (transform.position[axis] + rotated[axis]) * weight;
    }
    const displacement = Math.hypot(...result.map((value, axis) => value - source[axis]));
    sumSquaredDisplacement += displacement * displacement;
    maximumDisplacement = Math.max(maximumDisplacement, displacement);
    for (let axis = 0; axis < 3; axis++) {
      deformedBounds.min[axis] = Math.min(deformedBounds.min[axis], result[axis]);
      deformedBounds.max[axis] = Math.max(deformedBounds.max[axis], result[axis]);
    }
  }
  return { bounds: deformedBounds, maximumDisplacement, rmsDisplacement: Math.sqrt(sumSquaredDisplacement / (sourcePositions.length / 3)) };
}
const rest = evaluateSkinning([], 0);
assert(rest.maximumDisplacement < 1e-5, `Bind pose changes the source mesh by ${rest.maximumDisplacement}.`);
assert(Math.abs(rest.bounds.min[1]) < 1e-5, `Bind pose no longer touches the ground: ${rest.bounds.min[1]}.`);
const sampledMotion = [];
for (const clip of clipMetrics) {
  const tracks = clipTracks.get(clip.name);
  const mid = evaluateSkinning(tracks, clip.seconds * .5);
  const finish = evaluateSkinning(tracks, clip.seconds);
  assert(mid.maximumDisplacement > .015, `${clip.name} does not visibly deform the mesh.`);
  const floorAllowance = clip.name === 'Death' ? -.22 : -.12;
  assert(mid.bounds.min[1] > floorAllowance, `${clip.name} sinks too far below the floor at mid-clip (${mid.bounds.min[1]}).`);
  assert(finish.bounds.min[1] > floorAllowance, `${clip.name} sinks too far below the floor at its final frame (${finish.bounds.min[1]}).`);
  sampledMotion.push({ name: clip.name, midpoint: mid, final: finish });
}

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath, outputBytes);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
const checkRoot = (await io.readBinary(outputBytes)).getRoot();
const checkMesh = checkRoot.listMeshes()[0];
const checkPrimitive = checkMesh?.listPrimitives()[0];
const checkSkin = checkRoot.listSkins()[0];
assert(checkPrimitive && checkSkin, 'Candidate export lost its mesh or skin.');
assert.equal(checkRoot.listAnimations().length, 6, 'Candidate must contain six animation clips.');
assert.equal(checkSkin.listJoints().length, 62, 'Candidate must preserve the 62-joint Unity Generic hierarchy.');
const maxArrayDelta = (a, b) => {
  assert.equal(a.length, b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
};
const positionDelta = maxArrayDelta(checkPrimitive.getAttribute('POSITION').getArray(), sourcePositions);
const normalDelta = maxArrayDelta(checkPrimitive.getAttribute('NORMAL').getArray(), sourceNormals);
const uvDelta = maxArrayDelta(checkPrimitive.getAttribute('TEXCOORD_0').getArray(), sourceUvs);
const candidateIndices = checkPrimitive.getIndices().getArray();
let indexMismatches = 0;
for (let i = 0; i < sourceIndices.length; i++) if (candidateIndices[i] !== sourceIndices[i]) indexMismatches++;
assert.equal(positionDelta, 0, 'Source vertex positions changed.');
assert.equal(normalDelta, 0, 'Source normals changed.');
assert.equal(uvDelta, 0, 'Source UVs changed.');
assert.equal(indexMismatches, 0, 'Source topology changed.');
let readbackDistributed = 0, readbackWeightError = 0;
const checkJoints = checkPrimitive.getAttribute('JOINTS_0').getArray();
const checkWeights = checkPrimitive.getAttribute('WEIGHTS_0').getArray();
for (let vertex = 0; vertex < sourcePositions.length / 3; vertex++) {
  let sum = 0, influences = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = checkJoints[vertex * 4 + slot], weight = checkWeights[vertex * 4 + slot];
    assert(Number.isInteger(joint) && joint >= 0 && joint < checkSkin.listJoints().length, `Invalid joint at ${vertex}.`);
    assert(Number.isFinite(weight) && weight >= 0, `Invalid weight at ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) influences++;
  }
  readbackWeightError = Math.max(readbackWeightError, Math.abs(sum - 1));
  if (influences > 1) readbackDistributed++;
}
assert(readbackWeightError < 1e-5, `Weight normalization error ${readbackWeightError}.`);
assert(readbackDistributed > sourcePositions.length / 3 * .70, 'Candidate weights did not survive serialization.');
for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
  assert(checkSkin.listJoints().includes(channel.getTargetNode()), `${animation.getName()} targets a non-joint node.`);
}

const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_gloamfang_reaver',
  displayName: 'Gloamfang Reaver',
  suggestedPlacement: 'Wilderness, T50+; mid-sized humanoid hunter with stronger threat identity than starter fauna.',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    starredModelId: projectId,
    starredCardId: cardStorageId,
    starredDisplayName: 'werewolf character 3d model',
    generator: 'Tripo starred GLB export; source texture sizes and map roles inspected from the file.',
    geometry: { vertices: sourcePositions.length / 3, triangles: sourceIndices.length / 3, bounds, positionsPreserved: true, indicesPreserved: true, normalsPreserved: true, uvsPreserved: true, retopology: false },
    designReview: 'Image and placement review pending root normal-camera lab review.',
    textures: sourceTextureMetrics,
    sourceSkin: { jointCount: 62, namesAndHierarchyPreserved: true, rootWeightedVertices, oneInfluenceVertices, diagnosis: 'All joint nodes had identity rest transforms; 8,037 of 8,047 vertices were pinned to Hips and every vertex had only one influence. Bone transforms, inverse binds and spatial weights were rebuilt.' },
    sourceAnimations: [],
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/creature/creature_gloamfang_reaver.glb',
    geometry: { vertices: sourcePositions.length / 3, triangles: sourceIndices.length / 3, positionsPreserved: true, indicesPreserved: true, normalsPreserved: true, uvsPreserved: true },
    rig: { type: '62-joint glTF humanoid hierarchy retained for Unity Generic import; bone transforms and bind poses repaired', joints: jointInfo.map((bone, index) => ({ name: bone.name, parent: bone.parent, position: bone.anchor, usedVertices: jointVertexUse[index] })), influencesPerVertex: 4, verticesWithDistributedWeights, maximumWeightSumError, method: 'Model-specific four-weight spatial skin using anatomical gates and bone-segment distance fields; no retopology and no root-only fallback.' },
    textures: runtimeTextureMetrics,
    packedRoughnessRange: roughnessRange,
    packedMetallicRange: metallicRange,
    animations: clipMetrics,
    sampledMotion,
  },
  acceptance: { assetAudit: true, sourceDesignAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${owner}/catalog.json`, `${JSON.stringify(candidate, null, 2)}\n`);

const labAsset = {
  id: candidate.id,
  file: 'models/creature/creature_gloamfang_reaver.glb',
  pack: 'corealm-starred-creatures',
  category: 'character',
  is: candidate.displayName,
  tags: ['creature', 'humanoid', 'lycanthrope', 'wilderness', 'T50+', 'starred', 'tripo', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: sourceIndices.length / 3,
  animations: clipMetrics.map(clip => clip.name),
  materials: root.listMaterials().map(entry => entry.getName()),
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    sourceModelId: projectId,
    sourceCardId: cardStorageId,
    sourceFile: sourcePath,
    sourceSha256,
    candidateFile: candidatePath,
    candidateSha256,
    rigMethod: 'Retained 62-joint source names/hierarchy, rebuilt humanoid rest transforms, bind poses and four-weight anatomical deformation; preserved source geometry and authored 2K PBR maps.',
    textures: runtimeTextureMetrics,
    candidateStatus: 'awaiting-root-lab-review',
  },
  acceptance: { assetAudit: true, sourceDesignAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(`${owner}/lab-catalog.json`, `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [candidate.id]: 'gloamfang-reaver-native-rig-candidate.glb' } }, null, 2)}\n`);

await writeFile(`${owner}/README.md`, `# Gloamfang Reaver candidate\n\nThis is an isolated candidate derived from the starred Tripo Werewolf Warrior model. It is suggested for Wilderness T50+ placement because its silhouette is a humanoid hunter. Root image review, normal-camera lab presentation, and placement remain pending.\n\nRun \`node assets/art/tripo/imports/creatures/new-star-werewolf/build-candidate.mjs\` from the repository root to verify the source SHA-256 and reproduce the rigged GLB, catalogs, texture metrics, and sampled deformation checks.\n\nThe source export's 62-joint names and parent hierarchy are retained. Tripo left all joints at identity transforms; 8,037 of 8,047 vertices were pinned to Hips and every vertex had only one influence. This builder reconstructs rest anchors, inverse binds and spatial skin weights while leaving positions, indices, normals and UVs byte-for-byte numerically unchanged. It retains the authored base-color, packed metallic-roughness and normal maps at 2K runtime resolution.\n\nThe candidate has Idle, Walk, Run, Attack, Hit and Death clips. Builder checks cover normalized distributed weights, geometry/UV preservation, 2K PBR roles, non-zero sampled motion, bind-pose grounding, and floor penetration at motion samples. Animation quality and final material response still need root review in the persistent normal-camera feature lab.\n`);

console.log(JSON.stringify({ sourceSha256, sourceBytes: sourceBytes.length, candidatePath, candidateBytes: outputBytes.length, candidateSha256, vertices: sourcePositions.length / 3, triangles: sourceIndices.length / 3, joints: jointNodes.length, rootWeightedVertices, oneInfluenceVertices, verticesWithDistributedWeights, clips: clipMetrics.map(clip => clip.name), textures: runtimeTextureMetrics, sampledMotion }, null, 2));
