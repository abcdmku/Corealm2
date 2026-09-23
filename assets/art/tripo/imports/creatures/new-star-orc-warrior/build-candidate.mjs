import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { Matrix4, Quaternion, Vector3 } from 'three';

const baseDir = 'assets/art/tripo/imports/creatures/new-star-orc-warrior';
const sourcePath = 'assets/art/tripo/exports/45852960-86da-44f7-9030-9b3fe2a1512e.glb';
const candidatePath = `${baseDir}/orc-warrior-rigged-candidate.glb`;
const expectedSourceHash = '4455c0ecff6f8aab48403103b33f284c450cf5d63c8413dd909524f5dc795e6d';
const cardStorageUuid = 'aef7ab50-0aad-4de6-8f33-6e1a4ec8d407';
const starredModelUuid = '45852960-86da-44f7-9030-9b3fe2a1512e';
const instanceScale = 1.7;
await mkdir(baseDir, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceHash !== expectedSourceHash) throw new Error(`Source hash mismatch: ${sourceHash}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const skin = root.listSkins()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const armature = root.listNodes().find((node) => node.getName() === 'Armature');
if (!scene || !skin || !mesh || !primitive || !meshNode || !armature) throw new Error('Source Orc P1 GLB is missing its scene, mesh, armature, or native skin.');
if (root.listAnimations().length !== 0) throw new Error('Expected the starred source to have no animation clips.');
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (positions.length / 3 !== 7103 || indices.length / 3 !== 4672 || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
  throw new Error(`Unexpected source topology: ${positions.length / 3} vertices, ${indices.length / 3} triangles, ${uvs.length / 2} UVs.`);
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let vertex = 0; vertex < positions.length / 3; vertex++) for (let axis = 0; axis < 3; axis++) {
  const value = positions[vertex * 3 + axis];
  bounds.min[axis] = Math.min(bounds.min[axis], value);
  bounds.max[axis] = Math.max(bounds.max[axis], value);
}

// Tripo kept the inverse bind matrices but exported every joint node at identity,
// with virtually every vertex assigned to Hips. Recover its bind skeleton from the
// inverse matrices first; this retains the source bind pose and original topology.
const sourceInverseBinds = Float32Array.from(skin.getInverseBindMatrices()?.getArray() ?? []);
const sourceJoints = skin.listJoints();
if (sourceJoints.length !== 60 || sourceInverseBinds.length !== sourceJoints.length * 16) throw new Error(`Unexpected source skeleton: ${sourceJoints.length} joints.`);
const sourceJointIndex = new Map(sourceJoints.map((joint, index) => [joint, index]));
const jointWorlds = sourceJoints.map((_, index) => new Matrix4().fromArray(sourceInverseBinds.slice(index * 16, index * 16 + 16)).invert());
const jointRest = sourceJoints.map((joint, index) => {
  const parentIndex = sourceJointIndex.get(joint.getParentNode());
  const parentWorld = parentIndex === undefined ? new Matrix4() : jointWorlds[parentIndex];
  const local = parentWorld.clone().invert().multiply(jointWorlds[index]);
  const translation = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  local.decompose(translation, rotation, scale);
  const entry = { node: joint, sourceName: joint.getName(), index, parentIndex, local, translation, rotation, scale, world: jointWorlds[index] };
  joint.setTranslation(translation.toArray()).setRotation(rotation.toArray()).setScale(scale.toArray());
  return entry;
});
const bySourceName = new Map(jointRest.map((entry) => [entry.sourceName, entry]));
const humanoidNames = new Map([
  ['Hips','mixamorigHips'], ['Spine','mixamorigSpine'], ['Chest','mixamorigSpine1'], ['UpperChest','mixamorigSpine2'],
  ['Neck','mixamorigNeck'], ['Head','mixamorigHead'],
  ['Left_Shoulder','mixamorigLeftShoulder'], ['Left_UpperArm','mixamorigLeftArm'], ['Left_LowerArm','mixamorigLeftForeArm'], ['Left_Hand','mixamorigLeftHand'],
  ['Right_Shoulder','mixamorigRightShoulder'], ['Right_UpperArm','mixamorigRightArm'], ['Right_LowerArm','mixamorigRightForeArm'], ['Right_Hand','mixamorigRightHand'],
  ['Left_UpperLeg','mixamorigLeftUpLeg'], ['Left_LowerLeg','mixamorigLeftLeg'], ['Left_Foot','mixamorigLeftFoot'], ['Left_Toes','mixamorigLeftToeBase'],
  ['Right_UpperLeg','mixamorigRightUpLeg'], ['Right_LowerLeg','mixamorigRightLeg'], ['Right_Foot','mixamorigRightFoot'], ['Right_Toes','mixamorigRightToeBase'],
]);
for (const [sourceName, humanoidName] of humanoidNames) {
  const entry = bySourceName.get(sourceName);
  if (!entry) throw new Error(`Source skeleton lacks ${sourceName}.`);
  entry.node.setName(humanoidName);
}
for (const [sourcePrefix, humanoidPrefix] of [['Left','mixamorigLeft'], ['Right','mixamorigRight']]) {
  const digits = ['Thumb','Index','Middle','Ring','Pinky'];
  for (const [digitIndex, digit] of digits.entries()) {
    for (const [jointIndex, jointName] of ['Proximal','Intermediate','Distal','DistalEnd'].entries()) {
      const entry = bySourceName.get(`${sourcePrefix}_${digit}${jointName}`);
      if (entry) entry.node.setName(`${humanoidPrefix}Hand${digit}${jointIndex + 1}`);
    }
  }
}
const jointByName = new Map(jointRest.map((entry) => [entry.node.getName(), entry]));
mesh.setName('RedmarchOrcWarriorMesh');
meshNode.setName('RedmarchOrcWarriorSkin');
skin.setName('RedmarchOrcWarrior_UnityHumanoid');

const boneSpec = [
  ['mixamorigHips','root',0.105],
  ['mixamorigSpine','torso',0.120], ['mixamorigSpine1','torso',0.135], ['mixamorigSpine2','torso',0.125], ['mixamorigNeck','neck',0.085], ['mixamorigHead','head',0.105],
  ['mixamorigLeftShoulder','leftArm',0.075], ['mixamorigLeftArm','leftArm',0.085], ['mixamorigLeftForeArm','leftArm',0.075], ['mixamorigLeftHand','leftArm',0.070],
  ['mixamorigRightShoulder','rightArm',0.075], ['mixamorigRightArm','rightArm',0.085], ['mixamorigRightForeArm','rightArm',0.075], ['mixamorigRightHand','rightArm',0.070],
  ['mixamorigLeftUpLeg','leftLeg',0.105], ['mixamorigLeftLeg','leftLeg',0.095], ['mixamorigLeftFoot','leftLeg',0.075], ['mixamorigLeftToeBase','leftLeg',0.065],
  ['mixamorigRightUpLeg','rightLeg',0.105], ['mixamorigRightLeg','rightLeg',0.095], ['mixamorigRightFoot','rightLeg',0.075], ['mixamorigRightToeBase','rightLeg',0.065],
].map(([name, group, sigma]) => ({ ...jointByName.get(name), name, group, sigma: Number(sigma), side: name.includes('Left') ? -1 : name.includes('Right') ? 1 : 0 }));
const byIndex = new Map(boneSpec.map((bone) => [bone.index, bone]));
const sourceJointsAttribute = primitive.getAttribute('JOINTS_0');
const sourceWeightsAttribute = primitive.getAttribute('WEIGHTS_0');
if (!sourceJointsAttribute || !sourceWeightsAttribute) throw new Error('Source mesh lacks skinning attributes.');
const oldJoints = sourceJointsAttribute.getArray();
const oldWeights = sourceWeightsAttribute.getArray();
let rootDominantVertices = 0;
for (let vertex = 0; vertex < oldJoints.length / 4; vertex++) {
  let maxWeight = -1, maxJoint = -1;
  for (let slot = 0; slot < 4; slot++) {
    const offset = vertex * 4 + slot;
    if (oldWeights[offset] > maxWeight) { maxWeight = oldWeights[offset]; maxJoint = oldJoints[offset]; }
  }
  if (maxJoint === 0) rootDominantVertices++;
}
const segmentDistance = (point, start, end) => {
  const vector = end.map((value, axis) => value - start[axis]);
  const lengthSquared = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / lengthSquared));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + t * vector[axis])));
};
const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const joints = new Uint16Array(positions.length / 3 * 4);
const weights = new Float32Array(positions.length / 3 * 4);
const perJoint = new Uint32Array(sourceJoints.length);
let maxWeightSumError = 0, verticesWithDistributedWeights = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const scores = [];
  for (const bone of boneSpec) {
    let gate = 1;
    if (bone.group === 'head') gate = point[1] >= 0.74 ? 1 : 0.008;
    if (bone.group === 'neck') gate = point[1] > 0.68 && point[1] < 0.86 ? 1 : 0.10;
    if (bone.group === 'leftArm' || bone.group === 'rightArm') {
      const lateral = bone.side * point[2];
      gate = point[1] > 0.54 && point[1] < 0.94 ? 1 : 0.008;
      gate *= 0.025 + 0.975 * sigmoid((lateral - 0.025) / 0.040);
    }
    if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
      const lateral = bone.side * point[2];
      gate = point[1] < 0.63 ? 1 : 0.008;
      gate *= 0.025 + 0.975 * sigmoid((lateral - 0.018) / 0.038);
    }
    const parentPoint = bone.parentIndex === undefined ? bone.translation.toArray() : new Vector3().setFromMatrixPosition(jointWorlds[bone.parentIndex]).toArray();
    const endPoint = new Vector3().setFromMatrixPosition(bone.world).toArray();
    const distance = segmentDistance(point, parentPoint, endPoint);
    const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
    if (score > 1e-12) scores.push({ joint: bone.index, score });
  }
  scores.sort((a, b) => b.score - a.score);
  let chosen = scores.slice(0, 4);
  if (!chosen.length || chosen[0].score < 1e-30) chosen = [{ joint: jointByName.get('mixamorigSpine').index, score: 1 }];
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  if (chosen.length > 1 && chosen[1].score / total > 0.015) verticesWithDistributedWeights++;
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const item = chosen[slot] ?? chosen[0];
    const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : item.score / total;
    joints[vertex * 4 + slot] = item.joint;
    weights[vertex * 4 + slot] = weight;
    assigned += weight;
    if (weight > 1e-5) perJoint[item.joint]++;
  }
  const sum = weights[vertex * 4] + weights[vertex * 4 + 1] + weights[vertex * 4 + 2] + weights[vertex * 4 + 3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
}
if (verticesWithDistributedWeights < positions.length / 3 * 0.30) throw new Error(`Too few vertices have useful skin blends: ${verticesWithDistributedWeights}.`);
primitive.setAttribute('JOINTS_0', doc.createAccessor('RedmarchOrcWarrior_Joints').setArray(joints).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('RedmarchOrcWarrior_Weights').setArray(weights).setType(Accessor.Type.VEC4).setBuffer(root.listBuffers()[0]));

// An ancestor scale places this normalized Tripo humanoid in the 1.56 m medium
// creature range while leaving the image-generated source mesh and UVs intact.
armature.setScale([instanceScale, instanceScale, instanceScale]);

const axisWorld = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const poseRotation = (name, deltas = []) => {
  const entry = jointByName.get(name);
  let delta = new Quaternion();
  const parentWorld = entry.parentIndex === undefined ? new Matrix4() : jointWorlds[entry.parentIndex];
  const parentPosition = new Vector3(), parentRotation = new Quaternion(), parentScale = new Vector3();
  parentWorld.decompose(parentPosition, parentRotation, parentScale);
  for (const { axis, amount } of deltas) {
    const axisInParent = axisWorld[axis].clone().applyQuaternion(parentRotation.clone().invert()).normalize();
    delta.premultiply(new Quaternion().setFromAxisAngle(axisInParent, amount));
  }
  return delta.multiply(entry.rotation).normalize().toArray();
};
const baseTranslation = (name) => jointByName.get(name).translation.toArray();
const shiftedTranslation = (name, delta) => baseTranslation(name).map((value, axis) => value + delta[axis]);
const tracks = [];
function addClip(name, seconds, clipTracks) {
  const animation = doc.createAnimation(name);
  for (const track of clipTracks) {
    const input = doc.createAccessor(`${name}_${track.node}_${track.path}_times`).setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(root.listBuffers()[0]);
    const outputType = track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4;
    const output = doc.createAccessor(`${name}_${track.node}_${track.path}_values`).setArray(Float32Array.from(track.values.flat())).setType(outputType).setBuffer(root.listBuffers()[0]);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${track.path}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler);
    animation.addChannel(doc.createAnimationChannel(`${name}_${track.node}_${track.path}`).setTargetNode(jointByName.get(track.node).node).setTargetPath(track.path).setSampler(sampler));
  }
  tracks.push({ name, seconds, channels: clipTracks.length });
}
const cycleTimes = [0, 0.25, 0.5, 0.75, 1];
const timed = (times, path, node, values) => ({ node, path, times, values });
const rotation = (node, times, poses) => timed(times, 'rotation', node, poses);
const translation = (node, times, poses) => timed(times, 'translation', node, poses);
const left = (name, axis, amount, others = []) => poseRotation(name, [{ axis, amount }, ...others]);
const right = (name, axis, amount, others = []) => poseRotation(name, [{ axis, amount }, ...others]);

// Starting arm rotations are explicitly lowered from the source's T-pose-like bind.
addClip('Idle', 2.4, [
  rotation('mixamorigLeftArm', [0, 0.8, 1.6, 2.4], [0.52,0.55,0.52,0.52].map((angle) => left('mixamorigLeftArm','x',-angle))),
  rotation('mixamorigRightArm', [0, 0.8, 1.6, 2.4], [0.52,0.55,0.52,0.52].map((angle) => right('mixamorigRightArm','x',angle))),
  rotation('mixamorigLeftForeArm', [0,0.8,1.6,2.4], [0.06,0.08,0.06,0.06].map((angle) => left('mixamorigLeftForeArm','x',angle))),
  rotation('mixamorigRightForeArm', [0,0.8,1.6,2.4], [0.06,0.08,0.06,0.06].map((angle) => right('mixamorigRightForeArm','x',-angle))),
  rotation('mixamorigSpine1', [0,0.8,1.6,2.4], [0,-0.018,0.012,0].map((angle) => poseRotation('mixamorigSpine1',[{axis:'x',amount:angle}]))),
  rotation('mixamorigHead', [0,0.8,1.6,2.4], [0,0.012,-0.015,0].map((angle) => poseRotation('mixamorigHead',[{axis:'y',amount:angle}]))),
]);
const gait = (run) => {
  const period = run ? 0.68 : 1.02;
  const times = cycleTimes.map((phase) => phase * period);
  const amplitude = run ? 0.60 : 0.36;
  const knee = run ? 0.52 : 0.24;
  const bob = run ? 0.032 : 0.018;
  const sinus = (phase, offset = 0) => Math.sin((phase + offset) * Math.PI * 2);
  const angles = (phase, offset, multiplier = 1) => cycleTimes.map((t) => sinus(t, offset) * multiplier);
  const knees = (phase, offset) => cycleTimes.map((t) => Math.max(0, sinus(t, offset)) * phase);
  const baseLeft = cycleTimes.map((t) => left('mixamorigLeftArm','x',-0.50,[{axis:'y',amount:sinus(t,0.5)*(run?0.24:0.15)}]));
  const baseRight = cycleTimes.map((t) => right('mixamorigRightArm','x',0.50,[{axis:'y',amount:sinus(t,0)*(run?0.24:0.15)}]));
  const hipPositions = cycleTimes.map((t) => shiftedTranslation('mixamorigHips',[run?sinus(t,0)*0.018:0,bob*Math.sin(t*Math.PI*2)**2,0]));
  const clip = [
    translation('mixamorigHips', times, hipPositions),
    rotation('mixamorigLeftUpLeg', times, angles(amplitude,0).map((angle) => left('mixamorigLeftUpLeg','z',angle))),
    rotation('mixamorigRightUpLeg', times, angles(amplitude,0.5).map((angle) => right('mixamorigRightUpLeg','z',angle))),
    rotation('mixamorigLeftLeg', times, knees(knee,0).map((angle) => left('mixamorigLeftLeg','z',angle))),
    rotation('mixamorigRightLeg', times, knees(knee,0.5).map((angle) => right('mixamorigRightLeg','z',angle))),
    rotation('mixamorigLeftArm', times, baseLeft),
    rotation('mixamorigRightArm', times, baseRight),
    rotation('mixamorigSpine1', times, cycleTimes.map((t) => poseRotation('mixamorigSpine1',[{axis:'z',amount:run?-0.08:-0.035},{axis:'x',amount:sinus(t,0)*(run?0.06:0.035)}]))),
  ];
  return { period, clip };
};
for (const kind of ['Walk','Run']) {
  const { period, clip } = gait(kind === 'Run');
  addClip(kind, period, clip);
}
addClip('Attack', 0.9, [
  translation('mixamorigHips',[0,0.18,0.48,0.70,0.90],[[0,0,0],[0,0,0],[0.10,-0.018,0],[0.045,0,0],[0,0,0]] .map((delta) => shiftedTranslation('mixamorigHips',delta))),
  rotation('mixamorigSpine1',[0,0.18,0.48,0.70,0.90],[0,-0.20,0.32,0.18,0].map((angle)=>poseRotation('mixamorigSpine1',[{axis:'y',amount:angle}]))),
  rotation('mixamorigRightArm',[0,0.18,0.48,0.70,0.90],[0.50,0.50,0.50,0.50,0.50].map((down,index)=>poseRotation('mixamorigRightArm',[{axis:'x',amount:down},{axis:'y',amount:[0,-0.30,-1.05,-0.38,0][index]}]))),
  rotation('mixamorigRightForeArm',[0,0.18,0.48,0.70,0.90],[0,0.18,0.70,0.30,0].map((amount)=>right('mixamorigRightForeArm','x',-amount))),
  rotation('mixamorigLeftArm',[0,0.18,0.48,0.70,0.90],[0.50,0.50,0.50,0.50,0.50].map((down,index)=>poseRotation('mixamorigLeftArm',[{axis:'x',amount:-down},{axis:'y',amount:[0,0.12,0.24,0.10,0][index]}]))),
]);
addClip('Hit',0.46,[
  translation('mixamorigHips',[0,0.08,0.20,0.46],[[0,0,0],[-0.035,-0.008,0],[-0.018,0,0],[0,0,0]].map((delta)=>shiftedTranslation('mixamorigHips',delta))),
  rotation('mixamorigSpine1',[0,0.08,0.20,0.46],[0,0.24,-0.07,0].map((angle)=>poseRotation('mixamorigSpine1',[{axis:'z',amount:angle}]))),
  rotation('mixamorigSpine2',[0,0.08,0.20,0.46],[0,-0.12,0.035,0].map((angle)=>poseRotation('mixamorigSpine2',[{axis:'x',amount:angle}]))),
  rotation('mixamorigHead',[0,0.08,0.20,0.46],[0,-0.14,0.04,0].map((angle)=>poseRotation('mixamorigHead',[{axis:'z',amount:angle}]))),
  rotation('mixamorigRightArm',[0,0.08,0.20,0.46],[0.50,0.74,0.46,0.50].map((angle)=>right('mixamorigRightArm','x',angle))),
]);
addClip('Death',1.4,[
  translation('mixamorigHips',[0,0.2,0.62,1.0,1.4],[[0,0,0],[0,-0.04,0],[0,-0.19,0],[0,-0.23,0],[0,-0.23,0]].map((delta)=>shiftedTranslation('mixamorigHips',delta))),
  rotation('mixamorigHips',[0,0.2,0.62,1.0,1.4],[0,0.10,0.74,1.12,1.12].map((angle)=>poseRotation('mixamorigHips',[{axis:'z',amount:angle}]))),
  rotation('mixamorigSpine1',[0,0.2,0.62,1.0,1.4],[0,0.10,0.18,0.20,0.20].map((angle)=>poseRotation('mixamorigSpine1',[{axis:'x',amount:angle}]))),
  rotation('mixamorigHead',[0,0.2,0.62,1.0,1.4],[0,0.10,0.20,0.24,0.24].map((angle)=>poseRotation('mixamorigHead',[{axis:'z',amount:angle}]))),
  rotation('mixamorigLeftArm',[0,0.2,0.62,1.0,1.4],[0.5,0.72,0.85,0.85,0.85].map((angle)=>left('mixamorigLeftArm','x',-angle))),
  rotation('mixamorigRightArm',[0,0.2,0.62,1.0,1.4],[0.5,0.72,0.85,0.85,0.85].map((angle)=>right('mixamorigRightArm','x',angle))),
  rotation('mixamorigLeftUpLeg',[0,0.2,0.62,1.0,1.4],[0,-0.06,-0.22,-0.24,-0.24].map((angle)=>left('mixamorigLeftUpLeg','z',angle))),
  rotation('mixamorigRightUpLeg',[0,0.2,0.62,1.0,1.4],[0,0.06,0.22,0.24,0.24].map((angle)=>right('mixamorigRightUpLeg','z',angle))),
]);

const material = root.listMaterials()[0];
const baseColorTexture = material?.getBaseColorTexture();
const metallicRoughnessTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!material || !baseColorTexture || !metallicRoughnessTexture || !normalTexture) throw new Error('Source Orc is missing one of its base-color, packed PBR, or normal maps.');
const sourceTextures = [], runtimeTextures = [];
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  const meta = await sharp(bytes).metadata();
  sourceTextures.push({ name: texture.getName(), width: meta.width, height: meta.height, mime: texture.getMimeType(), sha256: createHash('sha256').update(bytes).digest('hex') });
  if (meta.width > 2048 || meta.height > 2048) {
    const dataTexture = texture === metallicRoughnessTexture || texture === normalTexture;
    texture.setImage(await sharp(bytes).resize(2048, 2048, { fit:'inside', withoutEnlargement:true, kernel:dataTexture?'linear':'lanczos3' })
      .toFormat(meta.format === 'jpeg' ? 'jpeg' : 'png', meta.format === 'jpeg' ? { quality:93, chromaSubsampling:'4:4:4' } : {}).toBuffer());
  }
  const resized = await sharp(texture.getImage()).metadata();
  if (resized.width > 2048 || resized.height > 2048) throw new Error(`Runtime source map exceeds 2K: ${texture.getName()}`);
  runtimeTextures.push({ name:texture.getName(), width:resized.width, height:resized.height, mime:texture.getMimeType(), bytes:texture.getImage().length });
}
const pbrImage = await sharp(metallicRoughnessTexture.getImage()).removeAlpha().resize(128,128).raw().toBuffer();
const pbrRange = { roughness:[Infinity,-Infinity], metallic:[Infinity,-Infinity] };
for (let i = 0; i < pbrImage.length; i += 3) {
  const roughness = pbrImage[i + 1] / 255, metallic = pbrImage[i + 2] / 255;
  pbrRange.roughness[0] = Math.min(pbrRange.roughness[0],roughness); pbrRange.roughness[1] = Math.max(pbrRange.roughness[1],roughness);
  pbrRange.metallic[0] = Math.min(pbrRange.metallic[0],metallic); pbrRange.metallic[1] = Math.max(pbrRange.metallic[1],metallic);
}
if (pbrRange.roughness[1] - pbrRange.roughness[0] < 0.05 || pbrRange.metallic[1] - pbrRange.metallic[0] < 0.03) throw new Error(`Source packed PBR map lacks useful material variation: ${JSON.stringify(pbrRange)}.`);

const outputBytes = await io.writeBinary(doc);
await writeFile(candidatePath,outputBytes);
const candidateHash = createHash('sha256').update(outputBytes).digest('hex');
const check = await io.readBinary(outputBytes);
const checkRoot = check.getRoot(), checkSkin = checkRoot.listSkins()[0];
const checkMesh = checkRoot.listMeshes()[0], checkPrimitive = checkMesh.listPrimitives()[0];
const outputPositions = checkPrimitive.getAttribute('POSITION')?.getArray();
const outputNormals = checkPrimitive.getAttribute('NORMAL')?.getArray();
const outputUvs = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray();
const outputIndices = checkPrimitive.getIndices()?.getArray();
const outputJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
const outputWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
if (!outputPositions || !outputNormals || !outputUvs || !outputIndices || !outputJoints || !outputWeights || !checkSkin) throw new Error('Output candidate is missing render, UV, or skin data.');
for (let i = 0; i < positions.length; i++) if (outputPositions[i] !== positions[i] || outputNormals[i] !== normals[i]) throw new Error(`Position or normal changed at scalar ${i}.`);
for (let i = 0; i < uvs.length; i++) if (outputUvs[i] !== uvs[i]) throw new Error(`Source UV changed at scalar ${i}.`);
for (let i = 0; i < indices.length; i++) if (outputIndices[i] !== indices[i]) throw new Error(`Source triangle order changed at index ${i}.`);
let outputWeightError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = outputJoints[vertex * 4 + slot], weight = outputWeights[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid skin influence at vertex ${vertex}.`);
    sum += weight;
  }
  outputWeightError = Math.max(outputWeightError,Math.abs(sum - 1));
}
if (outputWeightError > 1e-5) throw new Error(`Skin weights fail normalization by ${outputWeightError}.`);
const nodeWorldMatrix = (node) => {
  const chain = [];
  for (let current = node; current; current = current.getParentNode()) chain.unshift(current);
  const result = new Matrix4();
  for (const current of chain) {
    const position = new Vector3(...current.getTranslation());
    const rotation = new Quaternion(...current.getRotation());
    const scale = new Vector3(...current.getScale());
    result.multiply(new Matrix4().compose(position,rotation,scale));
  }
  return result;
};
const outputMeshNode = checkRoot.listNodes().find((node) => node.getMesh() === checkMesh);
if (!outputMeshNode) throw new Error('Output skinned mesh node is missing.');
const inverseOutputMeshWorld = nodeWorldMatrix(outputMeshNode).invert();
const outputInverseBinds = checkSkin.getInverseBindMatrices()?.getArray();
if (!outputInverseBinds) throw new Error('Output skeleton lacks inverse bind matrices.');
let maximumBindError = 0;
for (let jointIndex = 0; jointIndex < checkSkin.listJoints().length; jointIndex++) {
  const bindError = inverseOutputMeshWorld.clone()
    .multiply(nodeWorldMatrix(checkSkin.listJoints()[jointIndex]))
    .multiply(new Matrix4().fromArray(outputInverseBinds.slice(jointIndex * 16,jointIndex * 16 + 16)));
  for (let i = 0; i < 16; i++) maximumBindError = Math.max(maximumBindError,Math.abs(bindError.elements[i] - new Matrix4().elements[i]));
}
if (maximumBindError > 2e-5) throw new Error(`Recovered bind pose does not match source inverse binds: ${maximumBindError}.`);
const clipNames = checkRoot.listAnimations().map((animation) => animation.getName());
const requiredClips = ['Idle','Walk','Run','Attack','Hit','Death'];
if (requiredClips.some((name) => !clipNames.includes(name))) throw new Error(`Output missing one of the required animation clips: ${clipNames}.`);
for (const animation of checkRoot.listAnimations()) {
  if (!animation.listChannels().length) throw new Error(`Empty clip: ${animation.getName()}.`);
  for (const channel of animation.listChannels()) {
    const path = channel.getTargetPath();
    const values = channel.getSampler().getOutput().getArray();
    const components = path === 'translation' ? 3 : 4;
    if (!values || values.length < components * 2 || values.length % components !== 0 || values.some((value) => !Number.isFinite(value))) throw new Error(`Animation ${animation.getName()} has a degenerate channel.`);
  }
}

const makeBounds = (scale) => ({ min: bounds.min.map((value)=>value*scale), max:bounds.max.map((value)=>value*scale) });
const scaledBounds = makeBounds(instanceScale);
const assetId = 'creature_redmarch_orc_warrior';
const candidate = {
  schema:'corealm-creature-native-rig-candidate/1', id:assetId, displayName:'Redmarch Orc Warrior', status:'awaiting-root-lab-review', accepted:false,
  source:{ file:sourcePath, sha256:sourceHash, bytes:sourceBytes.length, starredModelId:starredModelUuid, starredCardId:cardStorageUuid,
    starredDisplayName:'orc warrior 3d model', format:'Tripo P1 GLB, 2K texture export', geometry:{vertices:positions.length/3,triangles:indices.length/3,bounds,positionsPreserved:true,normalsPreserved:true,indicesPreserved:true,uvsPreserved:true,retopology:false},
    sourceSkin:{joints:sourceJoints.length,clips:0,repair:'Recovered joint local transforms from retained inverse-bind matrices. Source nodes were identity and 7101/7103 vertices were root-dominant; anatomy-aware 4-weight map rebuilt for the existing 60-joint Unity Humanoid skeleton.'}, textures:sourceTextures },
  candidate:{ file:candidatePath,sha256:candidateHash,bytes:outputBytes.length,productionTarget:`game/public/assets/models/creature/${assetId}.glb`,
    geometry:{vertices:positions.length/3,triangles:indices.length/3,bounds:scaledBounds,sourceBounds:bounds,instanceScale,positionsPreserved:true,indicesPreserved:true,uvsPreserved:true},
    rig:{type:'Recovered Tripo skeleton with Mixamo-named Unity Humanoid body joints',joints:sourceJoints.length,influencesPerVertex:4,verticesWithDistributedWeights,sourceRootDominantVertices:rootDominantVertices,maximumWeightSumError:outputWeightError,maximumBindPoseMatrixError:maximumBindError,method:'Inverse-bind reconstruction restores the source joint transforms; source skin attributes repaired with four-weight anatomical distance fields fitted to source skeleton landmarks.'},
    textures:runtimeTextures,pbrRange,metallicFactor:material.getMetallicFactor(),roughnessFactor:material.getRoughnessFactor(),pbr:'Retains the starred model base-color, metallic-roughness, and normal maps; maps are capped at 2K runtime resolution. No recolor applied.',animations:tracks,
  },
  placementSuggestion:{tier:'T10-T20',region:'temperate marchland or settled wilderness edge',reason:'Medium humanoid orc warrior silhouette. Validate relative size, aggression, and materials in the normal-camera feature lab before placement.'},
  acceptance:{sourceDesignAudit:false,geometry:true,rig:false,animation:false,textures:false,labAccepted:false,worldIntegrated:false},
};
await writeFile(`${baseDir}/catalog.json`,JSON.stringify(candidate,null,2)+'\n');
const labAsset = {
  id:assetId,file:`models/creature/${assetId}.glb`,pack:'corealm-new-starred-creatures',category:'character',is:'Redmarch Orc Warrior',
  tags:['creature','orc','warrior','T10-T20','temperate','starred','tripo','candidate'],bytes:outputBytes.length,sha256:candidateHash,
  size:{x:(scaledBounds.max[0]-scaledBounds.min[0]),y:(scaledBounds.max[1]-scaledBounds.min[1]),z:(scaledBounds.max[2]-scaledBounds.min[2])},
  base:{x:scaledBounds.min[0],y:scaledBounds.min[1],z:scaledBounds.min[2]},bounds:scaledBounds,groundY:scaledBounds.min[1],triangles:indices.length/3,
  animations:tracks.map((clip)=>clip.name),materials:root.listMaterials().map((entry)=>entry.getName()),
  sourceProvenance:{author:'Starred Tripo P1 source, inverse-bind skeleton recovery and model-specific skin repair',sourceModelId:starredModelUuid,sourceCardId:cardStorageUuid,sourceFile:sourcePath,sourceSha256:sourceHash,candidateFile:candidatePath,candidateSha256:candidateHash,rigMethod:'Source inverse-bind matrices recovered the 60 joint bind transforms; Mixamo names added to Humanoid body joints; original source vertices, triangles and UVs kept; anatomically gated 4-weight map repaired.',textures:runtimeTextures,candidateStatus:'awaiting-root-lab-review'},
  acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false},
};
await writeFile(`${baseDir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',files:{[assetId]:candidatePath.split('/').at(-1)},assets:[labAsset]},null,2)+'\n');
console.log(JSON.stringify({candidatePath,candidateHash,bytes:outputBytes.length,vertices:positions.length/3,triangles:indices.length/3,sourceRootDominantVertices:rootDominantVertices,verticesWithDistributedWeights,skinJoints:sourceJoints.length,maxWeightSumError:outputWeightError,maximumBindPoseMatrixError:maximumBindError,instanceScale,pbrRange,textures:runtimeTextures,clips:tracks},null,2));
