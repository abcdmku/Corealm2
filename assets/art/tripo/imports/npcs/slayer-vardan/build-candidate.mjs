import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/a72c6527-f8b4-4bbf-aa6d-c4f5aa2c0801.glb');
const candidatePath = path.join(here, 'master-vardan-p1-humanoid-candidate.glb');
const expectedSourceSha256 = '6206ba042f935f64e62ca152162170bdf30ab44b92b2dc64d566fb2cc4b8537b';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(here, { recursive: true });

const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== expectedSourceSha256) throw new Error(`Vardan source hash mismatch: ${sourceSha256}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const sourceSkin = root.listSkins()[0];
if (!scene || !primitive || !meshNode || !sourceSkin || root.listAnimations().length) {
  throw new Error('Expected the starred P1 humanoid GLB with one skinned mesh and no animation clips.');
}

const positionAccessor = primitive.getAttribute('POSITION');
const uvAccessor = primitive.getAttribute('TEXCOORD_0');
const normalAccessor = primitive.getAttribute('NORMAL');
const indexAccessor = primitive.getIndices();
if (!positionAccessor || !uvAccessor || !normalAccessor || !indexAccessor) throw new Error('Vardan source is missing position, normal, UV, or index data.');
const positions = Float32Array.from(positionAccessor.getArray());
const normals = Float32Array.from(normalAccessor.getArray());
const uvs = Float32Array.from(uvAccessor.getArray());
const indices = Uint32Array.from(indexAccessor.getArray());
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (vertexCount !== 7610 || triangleCount !== 4828) throw new Error(`Source geometry changed: ${vertexCount} vertices / ${triangleCount} triangles.`);

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const sourceMaterials = root.listMaterials();
const material = sourceMaterials[0];
const baseColorTexture = material?.getBaseColorTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!baseColorTexture || !metallicRoughnessTexture || !normalTexture) throw new Error('Expected embedded base-color, packed PBR, and normal maps.');

const sourceTextures = [];
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== 2048 || metadata.height !== 2048) throw new Error(`Expected 2K source maps, got ${metadata.width}x${metadata.height} for ${texture.getName()}.`);
  sourceTextures.push({
    name: texture.getName(), mime: texture.getMimeType(), width: metadata.width, height: metadata.height,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
const packedBytes = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128, 128).raw().toBuffer();
const packedChannelRanges = [0, 1, 2].map((channel) => {
  const values = [];
  for (let i = channel; i < packedBytes.length; i += 3) values.push(packedBytes[i]);
  values.sort((a, b) => a - b);
  return { channel: ['occlusion', 'roughness', 'metallic'][channel], p10: values[Math.floor(values.length * .1)], p50: values[Math.floor(values.length * .5)], p90: values[Math.floor(values.length * .9)] };
});

// The exported skin has no usable spatial bind: every vertex is assigned 100% to Hips.
const sourceJoints = sourceSkin.listJoints();
const sourceJointNames = new Map(sourceJoints.map((node) => [node.getName(), node]));
const sourceInverseBind = sourceSkin.getInverseBindMatrices()?.getArray();
if (!sourceInverseBind || sourceInverseBind.length !== sourceJoints.length * 16) throw new Error('Vardan source has no complete inverse-bind matrix array.');
const sourceRest = new Map();
for (let i = 0; i < sourceJoints.length; i++) {
  const inverse = new THREE.Matrix4().fromArray(sourceInverseBind.slice(i * 16, i * 16 + 16));
  if (!inverse.elements.every(Number.isFinite) || Math.abs(inverse.determinant()) < 1e-8) throw new Error(`Invalid source inverse bind for ${sourceJoints[i].getName()}.`);
  const position = new THREE.Vector3().setFromMatrixPosition(inverse.invert());
  sourceRest.set(sourceJoints[i].getName(), position.toArray());
}
const hipsSource = sourceRest.get('Hips');
if (!hipsSource) throw new Error('Expected Hips in the starred humanoid skeleton.');
const sourceJoints0 = primitive.getAttribute('JOINTS_0')?.getArray();
const sourceWeights0 = primitive.getAttribute('WEIGHTS_0')?.getArray();
if (!sourceJoints0 || !sourceWeights0 || sourceJoints0.length !== vertexCount * 4 || sourceWeights0.length !== vertexCount * 4) {
  throw new Error('Expected four source skin slots per vertex.');
}
const originalWeightSummary = { uniqueJointIndices: new Set(), minimumNonzeroWeight: Infinity, maxWeightSumError: 0 };
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const i = vertex * 4 + slot, weight = sourceWeights0[i];
    if (weight > 1e-7) originalWeightSummary.uniqueJointIndices.add(sourceJoints0[i]);
    if (weight > 0) originalWeightSummary.minimumNonzeroWeight = Math.min(originalWeightSummary.minimumNonzeroWeight, weight);
    sum += weight;
  }
  originalWeightSummary.maxWeightSumError = Math.max(originalWeightSummary.maxWeightSumError, Math.abs(sum - 1));
}
originalWeightSummary.uniqueJointIndices = [...originalWeightSummary.uniqueJointIndices];
if (originalWeightSummary.uniqueJointIndices.length !== 1 || originalWeightSummary.uniqueJointIndices[0] !== 0) {
  throw new Error(`Expected the known Hips-only exported weighting defect; got ${originalWeightSummary.uniqueJointIndices}.`);
}

// The model's torso is offset from the exported humanoid rest skeleton and its lateral axis
// differs by 90 degrees. This maps the source's humanoid proportions into the unchanged mesh
// space: old lateral Z becomes mesh X, and old body-center X becomes mesh depth Z.
function sourceJointInMeshSpace(name) {
  const point = sourceRest.get(name);
  if (!point) throw new Error(`Missing source bind joint ${name}.`);
  return [point[2] - hipsSource[2], point[1], point[0] - hipsSource[0] + 0.25];
}

const boneSpecs = [
  ['mixamorigHips', null, 'Hips', 'torso', .105],
  ['mixamorigSpine', 'mixamorigHips', 'Spine', 'torso', .105],
  ['mixamorigSpine1', 'mixamorigSpine', 'Chest', 'torso', .100],
  ['mixamorigSpine2', 'mixamorigSpine1', 'UpperChest', 'torso', .095],
  ['mixamorigNeck', 'mixamorigSpine2', 'Neck', 'torso', .080],
  ['mixamorigHead', 'mixamorigNeck', 'Head', 'head', .100],
  ['mixamorigLeftShoulder', 'mixamorigSpine2', 'Left_Shoulder', 'leftArm', .072, -1],
  ['mixamorigLeftArm', 'mixamorigLeftShoulder', 'Left_UpperArm', 'leftArm', .085, -1],
  ['mixamorigLeftForeArm', 'mixamorigLeftArm', 'Left_LowerArm', 'leftArm', .082, -1],
  ['mixamorigLeftHand', 'mixamorigLeftForeArm', 'Left_Hand', 'leftArm', .105, -1],
  ['mixamorigRightShoulder', 'mixamorigSpine2', 'Right_Shoulder', 'rightArm', .072, 1],
  ['mixamorigRightArm', 'mixamorigRightShoulder', 'Right_UpperArm', 'rightArm', .085, 1],
  ['mixamorigRightForeArm', 'mixamorigRightArm', 'Right_LowerArm', 'rightArm', .082, 1],
  ['mixamorigRightHand', 'mixamorigRightForeArm', 'Right_Hand', 'rightArm', .105, 1],
  ['mixamorigLeftUpLeg', 'mixamorigHips', 'Left_UpperLeg', 'leftLeg', .082, -1],
  ['mixamorigLeftLeg', 'mixamorigLeftUpLeg', 'Left_LowerLeg', 'leftLeg', .082, -1],
  ['mixamorigLeftFoot', 'mixamorigLeftLeg', 'Left_Foot', 'leftLeg', .070, -1],
  ['mixamorigLeftToeBase', 'mixamorigLeftFoot', 'Left_Toes', 'leftLeg', .070, -1],
  ['mixamorigRightUpLeg', 'mixamorigHips', 'Right_UpperLeg', 'rightLeg', .082, 1],
  ['mixamorigRightLeg', 'mixamorigRightUpLeg', 'Right_LowerLeg', 'rightLeg', .082, 1],
  ['mixamorigRightFoot', 'mixamorigRightLeg', 'Right_Foot', 'rightLeg', .070, 1],
  ['mixamorigRightToeBase', 'mixamorigRightFoot', 'Right_Toes', 'rightLeg', .070, 1],
  ['VardanTailBase', 'mixamorigHips', null, 'tail', .105],
  ['VardanTailMid', 'VardanTailBase', null, 'tail', .105],
  ['VardanTailEnd', 'VardanTailMid', null, 'tail', .085],
  ['VardanTailTip', 'VardanTailEnd', null, 'tail', .065],
];
const bones = boneSpecs.map(([name, parent, sourceName, group, sigma, side]) => ({
  name, parent, sourceName, group, sigma, side,
  p: sourceName ? sourceJointInMeshSpace(sourceName) : null,
}));
const customTail = new Map([
  ['VardanTailBase', [0, .515, .105]],
  ['VardanTailMid', [0, .445, -.095]],
  ['VardanTailEnd', [0, .325, -.305]],
  ['VardanTailTip', [0, .235, -.435]],
]);
for (const bone of bones) if (!bone.p) bone.p = customTail.get(bone.name);
const boneByName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
for (const bone of bones) {
  const parent = bone.parent ? boneByName.get(bone.parent) : null;
  if (bone.parent && !parent) throw new Error(`Bone parent missing: ${bone.name} -> ${bone.parent}`);
  bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : [...bone.p];
}

const oldNodes = root.listNodes().filter((node) => node !== meshNode);
const meshParent = meshNode.getParentNode();
if (!meshParent) throw new Error('Source mesh node has no parent.');
meshParent.removeChild(meshNode);
meshNode.setSkin(null);
for (const skin of [...root.listSkins()]) skin.dispose();
for (const node of oldNodes.reverse()) {
  node.getParentNode()?.removeChild(node);
  node.dispose();
}

const rigContainer = doc.createNode('MasterVardan_NativeRig').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
scene.addChild(rigContainer);
rigContainer.addChild(meshNode.setName('MasterVardanMesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]));
const jointNodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  jointNodes.set(bone.name, node);
  (bone.parent ? jointNodes.get(bone.parent) : rigContainer).addChild(node);
}
const skin = doc.createSkin('MasterVardan_HumanoidWithTail').setSkeleton(jointNodes.get('mixamorigHips'));
for (const bone of bones) skin.addJoint(jointNodes.get(bone.name));
const inverseBinds = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('MasterVardan_InverseBindMatrices').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

function distanceToSegment(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const length2 = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
}
const smoothGate = (edge, softness = .05) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, edge / softness))));
function regionGate(bone, point) {
  const [x, y, z] = point;
  if (bone.group === 'head') return smoothGate(y - .745, .06) * smoothGate(.19 - Math.abs(x), .045);
  if (bone.group === 'leftArm' || bone.group === 'rightArm') {
    const vertical = smoothGate(y - .49, .06) * smoothGate(.94 - y, .07);
    const side = smoothGate((bone.side ?? 1) * x - .015, .042);
    const depth = smoothGate(.16 - Math.abs(z - .245), .12);
    return vertical * side * depth;
  }
  if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
    const vertical = smoothGate(.63 - y, .05);
    const side = smoothGate((bone.side ?? 1) * x - .008, .04);
    const forwardBack = smoothGate(.28 - Math.abs(z - .255), .12);
    return vertical * side * forwardBack;
  }
  if (bone.group === 'tail') {
    return smoothGate(.18 - z, .055) * smoothGate(.69 - y, .06) * smoothGate(.19 - Math.abs(x), .045);
  }
  return 1;
}

const joints = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const influenceVertices = new Uint32Array(bones.length);
let distributedVertices = 0, tailVertices = 0, tailWeightSum = 0, maximumWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const candidates = [];
  for (const bone of bones) {
    const gate = regionGate(bone, point);
    if (gate < 1e-6) continue;
    const parent = bone.parent ? boneByName.get(bone.parent) : null;
    const start = parent?.p ?? bone.p;
    const distance = distanceToSegment(point, start, bone.p);
    const score = gate * Math.exp(-.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) candidates.push({ index: boneByName.get(bone.name).index, group: bone.group, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  if (!chosen.length) throw new Error(`No anatomical weights assigned at vertex ${vertex}.`);
  const total = chosen.reduce((sum, value) => sum + value.score, 0);
  let assigned = 0, nonzero = 0, tailTotal = 0;
  for (let slot = 0; slot < 4; slot++) {
    const value = chosen[slot];
    const weight = !value ? 0 : slot === chosen.length - 1 ? 1 - assigned : value.score / total;
    joints[vertex * 4 + slot] = value?.index ?? chosen[0].index;
    weights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-6) {
      nonzero++;
      influenceVertices[value.index]++;
      if (value.group === 'tail') tailTotal += weight;
    }
  }
  if (nonzero > 1) distributedVertices++;
  if (tailTotal > .12) tailVertices++;
  tailWeightSum += tailTotal;
  const sum = weights[vertex * 4] + weights[vertex * 4 + 1] + weights[vertex * 4 + 2] + weights[vertex * 4 + 3];
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
}
if (distributedVertices < vertexCount * .90) throw new Error(`Skin weighting is still too concentrated: only ${distributedVertices}/${vertexCount} vertices use multiple joints.`);
if (tailVertices < 300) throw new Error(`Tail region has too little coverage: ${tailVertices} vertices receive tail weights.`);
primitive.setAttribute('JOINTS_0', doc.createAccessor('MasterVardan_Joints0').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('MasterVardan_Weights0').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('JOINTS_1', null);
primitive.setAttribute('WEIGHTS_1', null);

const eulerQuaternion = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).toArray();
function poseAt(name, t, duration) {
  const phase = 2 * Math.PI * t / duration;
  const r = new Map(), tr = new Map();
  const rotate = (bone, x = 0, y = 0, z = 0) => r.set(bone, [x, y, z]);
  const translate = (bone, x = 0, y = 0, z = 0) => tr.set(bone, [x, y, z]);
  if (name === 'Idle') {
    rotate('mixamorigSpine1', .014 * Math.sin(phase), 0, .006 * Math.sin(phase + .3));
    rotate('mixamorigSpine2', .020 * Math.sin(phase), .006 * Math.sin(phase), 0);
    rotate('mixamorigHead', .012 * Math.sin(phase + .3), .030 * Math.sin(phase), 0);
    rotate('VardanTailBase', 0, .026 * Math.sin(phase), .012 * Math.sin(phase));
    rotate('VardanTailMid', 0, .040 * Math.sin(phase + .3), 0);
    rotate('VardanTailEnd', 0, .045 * Math.sin(phase + .55), 0);
  } else if (name === 'Walk' || name === 'Run') {
    const fast = name === 'Run', swing = fast ? .66 : .39, knee = fast ? .55 : .29, armSwing = fast ? .42 : .23;
    translate('mixamorigHips', 0, (fast ? .014 : .008) * (1 - Math.cos(phase * 2)), 0);
    rotate('mixamorigSpine1', .018 * Math.sin(phase * 2), 0, .012 * Math.sin(phase));
    rotate('mixamorigSpine2', .015 * Math.sin(phase * 2), 0, .010 * Math.sin(phase));
    rotate('VardanTailBase', 0, .07 * Math.sin(phase + Math.PI), 0);
    rotate('VardanTailMid', 0, .11 * Math.sin(phase + Math.PI / 2), 0);
    rotate('VardanTailEnd', 0, .14 * Math.sin(phase + Math.PI / 3), 0);
    for (const [side, offset] of [['Left', 0], ['Right', Math.PI]]) {
      const foot = phase + offset;
      rotate(`mixamorig${side}UpLeg`, swing * Math.sin(foot), 0, 0);
      rotate(`mixamorig${side}Leg`, -knee * Math.max(0, Math.sin(foot)), 0, 0);
      rotate(`mixamorig${side}Foot`, -swing * Math.sin(foot) + knee * Math.max(0, Math.sin(foot)), 0, 0);
      rotate(`mixamorig${side}Arm`, -armSwing * Math.sin(foot), 0, 0);
      rotate(`mixamorig${side}ForeArm`, .08 * Math.max(0, Math.sin(foot)), 0, 0);
    }
  } else if (name === 'Attack') {
    const wind = Math.max(0, Math.sin(Math.PI * Math.min(1, t / duration)));
    rotate('mixamorigHips', 0, .10 * wind, 0);
    rotate('mixamorigSpine1', .10 * wind, .10 * wind, -.05 * wind);
    rotate('mixamorigSpine2', .08 * wind, .16 * wind, 0);
    rotate('mixamorigRightArm', .05 * wind, -.78 * wind, -.17 * wind);
    rotate('mixamorigRightForeArm', .22 * wind, -.44 * wind, .03 * wind);
    rotate('mixamorigLeftArm', 0, .20 * wind, .12 * wind);
    rotate('mixamorigLeftForeArm', -.14 * wind, 0, 0);
    rotate('VardanTailBase', 0, -.13 * wind, 0);
  } else if (name === 'Interact') {
    const reach = Math.sin(Math.PI * Math.min(1, t / duration));
    rotate('mixamorigSpine2', .025 * reach, 0, -.018 * reach);
    rotate('mixamorigNeck', .055 * reach, 0, 0);
    rotate('mixamorigHead', .045 * reach, .02 * reach, 0);
    rotate('mixamorigRightArm', 0, -.92 * reach, -.10 * reach);
    rotate('mixamorigRightForeArm', .10 * reach, -.34 * reach, -.08 * reach);
    rotate('mixamorigRightHand', .06 * reach, 0, .04 * reach);
    rotate('VardanTailBase', 0, .04 * reach, 0);
  } else if (name === 'Hit') {
    const recoil = Math.max(0, Math.sin(Math.PI * Math.min(1, t / duration)));
    translate('mixamorigHips', 0, -.012 * recoil, -.045 * recoil);
    rotate('mixamorigSpine1', -.16 * recoil, 0, .07 * recoil);
    rotate('mixamorigSpine2', -.10 * recoil, 0, .04 * recoil);
    rotate('mixamorigHead', -.10 * recoil, .03 * recoil, 0);
    rotate('mixamorigLeftArm', .08 * recoil, 0, .16 * recoil);
    rotate('mixamorigRightArm', -.10 * recoil, 0, -.14 * recoil);
    rotate('VardanTailMid', 0, -.18 * recoil, 0);
  } else if (name === 'Death') {
    const fall = Math.max(0, Math.min(1, (t / duration - .06) / .55));
    const ease = fall * fall * (3 - 2 * fall);
    translate('mixamorigHips', 0, -.34 * ease, 0);
    rotate('mixamorigHips', 1.12 * ease, 0, .06 * ease);
    rotate('mixamorigSpine1', .14 * ease, 0, .08 * ease);
    rotate('mixamorigSpine2', .10 * ease, 0, .05 * ease);
    rotate('mixamorigHead', -.16 * ease, 0, 0);
    rotate('mixamorigLeftArm', .18 * ease, 0, -.58 * ease);
    rotate('mixamorigRightArm', .16 * ease, 0, .58 * ease);
    rotate('mixamorigLeftUpLeg', -.28 * ease, 0, 0);
    rotate('mixamorigRightUpLeg', -.19 * ease, 0, 0);
    rotate('mixamorigLeftLeg', .30 * ease, 0, 0);
    rotate('mixamorigRightLeg', .22 * ease, 0, 0);
    rotate('VardanTailBase', .08 * ease, .18 * ease, 0);
    rotate('VardanTailMid', .12 * ease, .12 * ease, 0);
  }
  return { r, tr };
}

const clips = [
  { name: 'Idle', seconds: 2.8, samples: 29, loop: true },
  { name: 'Walk', seconds: 1.12, samples: 29, loop: true },
  { name: 'Run', seconds: .74, samples: 29, loop: true },
  { name: 'Attack', seconds: .92, samples: 29, loop: false },
  { name: 'Hit', seconds: .46, samples: 19, loop: false },
  { name: 'Death', seconds: 1.45, samples: 29, loop: false },
  { name: 'Interact', seconds: 1.6, samples: 33, loop: false },
];
for (const clip of clips) {
  const animation = doc.createAnimation(clip.name);
  const times = Array.from({ length: clip.samples }, (_, i) => clip.seconds * i / (clip.samples - 1));
  const encodedTimes = Float32Array.from(times);
  const poses = times.map((t) => poseAt(clip.name, t, clip.seconds));
  const affected = new Set(poses.flatMap((pose) => [...pose.r.keys(), ...pose.tr.keys()]));
  for (const boneName of affected) {
    const node = jointNodes.get(boneName);
    if (!node) throw new Error(`Animation ${clip.name} targets an unknown node: ${boneName}`);
    if (poses.some((pose) => pose.r.has(boneName))) {
      const values = Float32Array.from(poses.flatMap((pose) => eulerQuaternion(...(pose.r.get(boneName) ?? [0, 0, 0]))));
      const input = doc.createAccessor(`${clip.name}_${boneName}_time`).setArray(encodedTimes).setType(Accessor.Type.SCALAR).setBuffer(buffer);
      const output = doc.createAccessor(`${clip.name}_${boneName}_rotation`).setArray(values).setType(Accessor.Type.VEC4).setBuffer(buffer);
      const sampler = doc.createAnimationSampler(`${clip.name}_${boneName}_rotation_sampler`).setInput(input).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${boneName}_rotation`).setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
    }
    if (poses.some((pose) => pose.tr.has(boneName))) {
      const base = bones.find((bone) => bone.name === boneName).local;
      const values = Float32Array.from(poses.flatMap((pose) => base.map((value, axis) => value + (pose.tr.get(boneName)?.[axis] ?? 0))));
      const input = doc.createAccessor(`${clip.name}_${boneName}_position_time`).setArray(encodedTimes).setType(Accessor.Type.SCALAR).setBuffer(buffer);
      const output = doc.createAccessor(`${clip.name}_${boneName}_translation`).setArray(values).setType(Accessor.Type.VEC3).setBuffer(buffer);
      const sampler = doc.createAnimationSampler(`${clip.name}_${boneName}_translation_sampler`).setInput(input).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${boneName}_translation`).setTargetNode(node).setTargetPath('translation').setSampler(sampler));
    }
  }
}

const outputBytes = await io.writeBinary(doc);
const candidateSha256 = createHash('sha256').update(outputBytes).digest('hex');
await writeFile(candidatePath, outputBytes);
const checkedRoot = (await io.readBinary(outputBytes)).getRoot();
const checkedMesh = checkedRoot.listMeshes()[0];
const checkedPrimitive = checkedMesh?.listPrimitives()[0];
const checkedPosition = checkedPrimitive?.getAttribute('POSITION')?.getArray();
const checkedNormal = checkedPrimitive?.getAttribute('NORMAL')?.getArray();
const checkedUv = checkedPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
const checkedIndices = checkedPrimitive?.getIndices()?.getArray();
const checkedJoints = checkedPrimitive?.getAttribute('JOINTS_0')?.getArray();
const checkedWeights = checkedPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
const checkedSkin = checkedRoot.listSkins()[0];
if (!checkedPosition || !checkedNormal || !checkedUv || !checkedIndices || !checkedJoints || !checkedWeights || !checkedSkin) throw new Error('Candidate output is missing mesh or skin attributes.');
const maxDelta = (a, b) => { if (a.length !== b.length) return Infinity; let maximum = 0; for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i])); return maximum; };
const positionDelta = maxDelta(positions, checkedPosition), normalDelta = maxDelta(normals, checkedNormal), uvDelta = maxDelta(uvs, checkedUv);
let indexMismatches = 0, checkedDistributedVertices = 0, checkedWeightSumError = 0;
for (let i = 0; i < indices.length; i++) if (checkedIndices[i] !== indices[i]) indexMismatches++;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, nonzero = 0;
  for (let slot = 0; slot < 4; slot++) {
    const index = checkedJoints[vertex * 4 + slot], weight = checkedWeights[vertex * 4 + slot];
    if (!Number.isInteger(index) || index < 0 || index >= checkedSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid normalized skin data at vertex ${vertex}.`);
    sum += weight;
    if (weight > 1e-6) nonzero++;
  }
  checkedWeightSumError = Math.max(checkedWeightSumError, Math.abs(sum - 1));
  if (nonzero > 1) checkedDistributedVertices++;
}
if (positionDelta !== 0 || normalDelta !== 0 || uvDelta !== 0 || indexMismatches !== 0) throw new Error(`Source geometry/UV preservation failed: position ${positionDelta}, normal ${normalDelta}, UV ${uvDelta}, indices ${indexMismatches}.`);
if (checkedDistributedVertices < vertexCount * .90 || checkedWeightSumError > 1e-5) throw new Error('Serialized skin weights failed the distribution or normalization check.');
const outputTextures = checkedRoot.listTextures();
const outputTextureMetrics = [];
for (const texture of outputTextures) {
  const metadata = await sharp(texture.getImage()).metadata();
  const source = sourceTextures.find((entry) => entry.name === texture.getName());
  const sha256 = createHash('sha256').update(texture.getImage()).digest('hex');
  if (!source || source.sha256 !== sha256 || metadata.width !== 2048 || metadata.height !== 2048) throw new Error(`Texture changed during rig repair: ${texture.getName()}.`);
  outputTextureMetrics.push({ name: texture.getName(), role: source.name.includes('basecolor') ? 'base color' : source.name.includes('_rm') ? 'packed metallic-roughness' : 'normal', width: metadata.width, height: metadata.height, mime: texture.getMimeType(), bytes: texture.getImage().length, sha256 });
}
const animationNames = checkedRoot.listAnimations().map((entry) => entry.getName());
if (animationNames.join('|') !== clips.map((clip) => clip.name).join('|')) throw new Error(`Animation clips missing or out of order: ${animationNames}.`);
for (const animation of checkedRoot.listAnimations()) for (const channel of animation.listChannels()) {
  if (!checkedSkin.listJoints().includes(channel.getTargetNode())) throw new Error(`Animation ${animation.getName()} targets a node outside the humanoid skin.`);
}

const candidate = {
  schema: 'corealm-npc-native-rig-candidate/1',
  id: 'npc_slayer_vardan',
  displayName: 'Master Vardan',
  status: 'awaiting-root-production-lab-review',
  accepted: false,
  source: {
    file: path.relative(repo, sourcePath).replaceAll('\\', '/'),
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    tripoProjectId: '2c8e36d7-cece-4197-9ac8-2598b1c0ebc1',
    starredCardId: 'a72c6527-f8b4-4bbf-aa6d-c4f5aa2c0801',
    prompt: 'dragon humanoid character in armor with blue scales and red cloth',
    generator: 'Tripo P1.0',
    textureResolution: '2K',
    skeletonExported: true,
    geometry: { vertices: vertexCount, triangles: triangleCount, bounds, positionsPreserved: positionDelta === 0, normalsPreserved: normalDelta === 0, uvPreserved: uvDelta === 0, indicesPreserved: indexMismatches === 0, retopology: false },
    sourceRig: { jointCount: sourceJoints.length, animations: 0, weightProblem: 'All 7,610 vertices were assigned only to Hips at weight 1.0; the exported skeleton had no usable deformation weights.' },
    sourceTextures,
    packedPbrChannels: packedChannelRanges,
  },
  candidate: {
    file: path.basename(candidatePath),
    sha256: candidateSha256,
    bytes: outputBytes.length,
    productionTarget: 'game/public/assets/models/npc/npc_slayer_vardan.glb',
    geometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: true, normalsPreserved: true, uvPreserved: true, indicesPreserved: true },
    rig: {
      mapping: 'Mixamo-named Unity Humanoid-compatible skeleton, with a four-joint articulated tail.',
      joints: bones.map(({ name, parent, p }) => ({ name, parent, restPosition: p.map((value) => +value.toFixed(6)) })),
      weightMethod: 'four normalized influences from model-space anatomical segment fields; humanoid bind joints mapped from the exported rest pose into the mesh basis; tail has separate base, mid, end, and tip influences.',
      distributedVertices: checkedDistributedVertices,
      tailInfluencedVertices: tailVertices,
      meanTailWeight: tailWeightSum / vertexCount,
      maximumWeightSumError: checkedWeightSumError,
      jointInfluenceVertexCounts: bones.map(({ name }, index) => ({ name, vertices: influenceVertices[index] })),
    },
    textures: outputTextureMetrics,
    animations: clips,
  },
  acceptance: { starredSource: true, sourceDesignReview: 'Starred card; image-derived map is detailed blue scale, dark armor, red cloth, and silver accents; no creature redesign was applied.', geometry: true, rig: false, motion: false, pbr: false, productionLab: false, worldIntegrated: false },
};
await writeFile(path.join(here, 'catalog.json'), JSON.stringify(candidate, null, 2) + '\n');

const labAsset = {
  id: 'npc_slayer_vardan',
  file: 'models/npc/npc_slayer_vardan.glb',
  pack: 'corealm-starred-npcs',
  category: 'character',
  is: 'Master Vardan starred Tripo P1 humanoid rig candidate',
  tags: ['npc', 'slayer-master', 'humanoid', 'reptilian', 'wilderness', 'karrowmoor', 'tripo-p1', 'candidate'],
  bytes: outputBytes.length,
  sha256: candidateSha256,
  size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
  base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
  bounds,
  groundY: bounds.min[1],
  triangles: triangleCount,
  animations: clips.map((clip) => clip.name),
  materials: root.listMaterials().map((entry) => entry.getName()),
  sourceProvenance: {
    generator: 'Tripo P1.0',
    sourceProjectId: '2c8e36d7-cece-4197-9ac8-2598b1c0ebc1',
    starredCardId: 'a72c6527-f8b4-4bbf-aa6d-c4f5aa2c0801',
    prompt: 'dragon humanoid character in armor with blue scales and red cloth',
    sourceFile: path.relative(repo, sourcePath).replaceAll('\\', '/'),
    sourceSha256,
    candidateFile: path.relative(repo, candidatePath).replaceAll('\\', '/'),
    candidateSha256,
    textures: outputTextureMetrics,
    rigRepair: 'Source weights collapsed every vertex to Hips; repaired to a Mixamo-named humanoid skin with articulated tail. Source mesh, UVs, and image-derived 2K PBR maps are unchanged.',
    candidateStatus: 'awaiting-root-production-lab-review',
  },
  acceptance: { starredSource: true, geometryPreserved: true, rigAccepted: false, motionAccepted: false, pbrAccepted: false, labAccepted: false, worldIntegrated: false },
};
await writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: [labAsset] }, null, 2) + '\n');

console.log(JSON.stringify({ candidatePath: path.relative(repo, candidatePath).replaceAll('\\', '/'), candidateSha256, bytes: outputBytes.length, vertexCount, triangleCount, joints: bones.length, clips: clips.map(({ name, seconds }) => ({ name, seconds })), sourceWeightIndices: originalWeightSummary.uniqueJointIndices, distributedVertices: checkedDistributedVertices, tailInfluencedVertices: tailVertices, meanTailWeight: +(tailWeightSum / vertexCount).toFixed(4), maximumWeightSumError: checkedWeightSumError, textureMaps: outputTextureMetrics.map(({ role, width, height, bytes }) => ({ role, width, height, bytes })), geometryPreserved: { positionDelta, normalDelta, uvDelta, indexMismatches } }, null, 2));
