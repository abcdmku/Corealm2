import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const sourcePath = 'assets/art/tripo/exports/e1b8c030-b812-4b78-b4d7-4216e8a4a603.glb';
const sourceSha256 = '47e61408d8d25a4e7140cdd3ec2c4b61eae18d95ed626b60e4e32f4404d4ec34';
const baseDir = 'assets/art/tripo/imports/creatures/new-star-dark-armored-demon';
const candidateName = 'gloamplate-reaver-native-rig-candidate.glb';
const candidatePath = `${baseDir}/${candidateName}`;
const modelId = 'creature_gloamplate_reaver';
const modelName = 'Gloamplate Reaver';
const scale = 2.85; // 0.842 m Tripo source height becomes 2.40 m; the floor remains at y=0.

await mkdir(baseDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourcePath);
const actualSourceHash = createHash('sha256').update(sourceBytes).digest('hex');
if (actualSourceHash !== sourceSha256) throw new Error(`Starred source hash changed: ${actualSourceHash}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const skin = root.listSkins()[0];
const sourceWalk = root.listAnimations().find((animation) => animation.getName().toLowerCase() === 'walk');
if (!scene || root.listMeshes().length !== 1 || !primitive || !meshNode || root.listSkins().length !== 1 || !skin || !sourceWalk) {
  throw new Error('Expected one static mesh, one existing skin, and a real Tripo Walk animation.');
}
if (root.listAnimations().length !== 1 || skin.listJoints().length !== 67 || sourceWalk.listChannels().length !== 201) {
  throw new Error('Starred source skeleton or clip layout changed; inspect before rebuilding.');
}
const sourceWalkInterpolation = [...new Set(sourceWalk.listSamplers().map((sampler) => sampler.getInterpolation()))];
let repairedStepSamplers = 0;
for (const sampler of sourceWalk.listSamplers()) {
  // Tripo exports the genuinely animated 57-frame gait with STEP curves. Preserve
  // its source key values, but interpolate them so limbs move continuously.
  if (sampler.getInterpolation() === 'STEP') {
    sampler.setInterpolation('LINEAR');
    repairedStepSamplers += 1;
  }
  if (sampler.getInterpolation() !== 'LINEAR') throw new Error(`Unexpected source Walk interpolation: ${sampler.getInterpolation()}.`);
}

const sourceAttributes = {};
for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
  const accessor = primitive.getAttribute(semantic);
  if (!accessor) throw new Error(`Source mesh has no ${semantic}.`);
  sourceAttributes[semantic] = hashArray(accessor.getArray());
}
if (!primitive.getIndices()) throw new Error('Source mesh has no index buffer.');
sourceAttributes.indices = hashArray(primitive.getIndices().getArray());
const vertexCount = primitive.getAttribute('POSITION').getCount();
const triangleCount = primitive.getIndices().getCount() / 3;
if (vertexCount !== 3837 || triangleCount !== 4878) throw new Error(`Source topology changed: ${vertexCount} vertices / ${triangleCount} triangles.`);
const sourceBounds = boundsOf(primitive.getAttribute('POSITION').getArray());

const material = primitive.getMaterial();
const baseTexture = material?.getBaseColorTexture();
const pbrTexture = material?.getMetallicRoughnessTexture();
const normalTexture = material?.getNormalTexture();
if (!material || !baseTexture || !pbrTexture || !normalTexture) throw new Error('Source must have image-generated base-color, metallic-roughness and normal maps.');
const textureAudit = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const metadata = await sharp(image).metadata();
  if (metadata.width !== 2048 || metadata.height !== 2048) throw new Error(`Expected 2K source maps; ${texture.getName()} is ${metadata.width}x${metadata.height}.`);
  textureAudit.push({
    name: texture.getName(),
    width: metadata.width,
    height: metadata.height,
    mimeType: texture.getMimeType(),
    bytes: image.length,
    sha256: createHash('sha256').update(image).digest('hex'),
  });
}
if (root.listTextures().length !== 3) throw new Error(`Expected three original PBR maps; found ${root.listTextures().length}.`);
const mrChannels = await sharp(pbrTexture.getImage()).resize(128, 128).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const channelRange = (channel) => {
  const samples = [];
  for (let i = channel; i < mrChannels.data.length; i += mrChannels.info.channels) samples.push(mrChannels.data[i]);
  return [Math.min(...samples) / 255, Math.max(...samples) / 255];
};
const metallicRange = channelRange(2);
const roughnessRange = channelRange(1);
if (metallicRange[1] - metallicRange[0] < 0.05 || roughnessRange[1] - roughnessRange[0] < 0.05) {
  throw new Error(`PBR source map has no meaningful channel variation: metallic ${metallicRange}, roughness ${roughnessRange}.`);
}

// The exported rig is already skinned and animated. Keep its bind weights, image maps,
// mesh buffers and source Walk clip intact. Rename only bones to Unity/Mixamo conventions.
const humanBoneNames = new Map([
  ['Hips', 'mixamorigHips'], ['Spine', 'mixamorigSpine'], ['Chest', 'mixamorigSpine1'],
  ['UpperChest', 'mixamorigSpine2'], ['Neck', 'mixamorigNeck'], ['Neck_Twist_A', 'mixamorigNeck1'], ['Head', 'mixamorigHead'],
  ['Left_Eye', 'mixamorigLeftEye'], ['Right_Eye', 'mixamorigRightEye'],
  ['Left_Shoulder', 'mixamorigLeftShoulder'], ['Left_UpperArm', 'mixamorigLeftArm'],
  ['Left_LowerArm', 'mixamorigLeftForeArm'], ['Left_Hand', 'mixamorigLeftHand'],
  ['Right_Shoulder', 'mixamorigRightShoulder'], ['Right_UpperArm', 'mixamorigRightArm'],
  ['Right_LowerArm', 'mixamorigRightForeArm'], ['Right_Hand', 'mixamorigRightHand'],
  ['Left_UpperLeg', 'mixamorigLeftUpLeg'], ['Left_LowerLeg', 'mixamorigLeftLeg'],
  ['Left_Foot', 'mixamorigLeftFoot'], ['Left_Toes', 'mixamorigLeftToeBase'], ['Left_ToesEnd', 'mixamorigLeftToe_End'],
  ['Right_UpperLeg', 'mixamorigRightUpLeg'], ['Right_LowerLeg', 'mixamorigRightLeg'],
  ['Right_Foot', 'mixamorigRightFoot'], ['Right_Toes', 'mixamorigRightToeBase'], ['Right_ToesEnd', 'mixamorigRightToe_End'],
]);
for (const side of ['Left', 'Right']) {
  for (const [finger, mixamoFinger] of [['Thumb', 'Thumb'], ['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Pinky', 'Pinky']]) {
    for (const [part, suffix] of [['Proximal', '1'], ['Intermediate', '2'], ['Distal', '3'], ['DistalEnd', '4']]) {
      humanBoneNames.set(`${side}_${finger}${part}`, `mixamorig${side}Hand${mixamoFinger}${suffix}`);
    }
  }
}
const nodesByOriginalName = new Map(root.listNodes().map((node) => [node.getName(), node]));
for (const joint of skin.listJoints()) {
  const name = humanBoneNames.get(joint.getName());
  if (name) joint.setName(name);
  else if (joint.getName().startsWith('Left_') || joint.getName().startsWith('Right_')) {
    joint.setName(`mixamorig${joint.getName().replace('_', '')}`);
  }
}
const hips = nodesByOriginalName.get('Hips');
const spine = nodesByOriginalName.get('Spine');
const chest = nodesByOriginalName.get('Chest');
const upperChest = nodesByOriginalName.get('UpperChest');
const head = nodesByOriginalName.get('Head');
const leftUpperArm = nodesByOriginalName.get('Left_UpperArm');
const rightUpperArm = nodesByOriginalName.get('Right_UpperArm');
const leftLowerArm = nodesByOriginalName.get('Left_LowerArm');
const rightLowerArm = nodesByOriginalName.get('Right_LowerArm');
const leftUpperLeg = nodesByOriginalName.get('Left_UpperLeg');
const rightUpperLeg = nodesByOriginalName.get('Right_UpperLeg');
const leftLowerLeg = nodesByOriginalName.get('Left_LowerLeg');
const rightLowerLeg = nodesByOriginalName.get('Right_LowerLeg');
const rigRoot = meshNode.getParentNode();
if (!hips || !spine || !chest || !upperChest || !head || !rigRoot) throw new Error('Humanoid source joint hierarchy changed.');
rigRoot.setName('GloamplateReaverRoot');
rigRoot.setScale(rigRoot.getScale().map((value) => value * scale));
skin.setName('GloamplateReaver_UnityHumanoid');
skin.setSkeleton(hips);
sourceWalk.setName('Walk');

const buffer = root.listBuffers()[0] ?? doc.createBuffer('Gloamplate Reaver animation data');
const identity = [0, 0, 0, 1];
const normalizeQuat = (q) => {
  const length = Math.hypot(...q) || 1;
  return q.map((value) => value / length);
};
const multiplyQuat = (a, b) => normalizeQuat([
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]);
const inverseQuat = (q) => [-q[0], -q[1], -q[2], q[3]];
const axisQuat = ([x, y, z]) => {
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-9) return identity;
  const factor = Math.sin(angle / 2) / angle;
  return [x * factor, y * factor, z * factor, Math.cos(angle / 2)];
};
const combineEuler = ([x, y, z]) => multiplyQuat(multiplyQuat(axisQuat([x, 0, 0]), axisQuat([0, y, 0])), axisQuat([0, 0, z]));
const quaternionPower = (q, amount) => {
  let normalized = normalizeQuat(q);
  if (normalized[3] < 0) normalized = normalized.map((value) => -value);
  const halfAngle = Math.acos(Math.max(-1, Math.min(1, normalized[3])));
  const sine = Math.sin(halfAngle);
  if (Math.abs(sine) < 1e-7) return identity;
  const axis = normalized.slice(0, 3).map((value) => value / sine);
  const poweredHalfAngle = halfAngle * amount;
  return normalizeQuat([...axis.map((value) => value * Math.sin(poweredHalfAngle)), Math.cos(poweredHalfAngle)]);
};

const clipAudit = [];
clipAudit.push({ name: 'Walk', seconds: 2.3333332538604736, channels: sourceWalk.listChannels().length, retainedSourceKeys: true, interpolationRepair: repairedStepSamplers ? `converted ${repairedStepSamplers} STEP samplers to LINEAR` : 'none' });
function createClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const path = track.path ?? 'rotation';
    const type = path === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3;
    const input = doc.createAccessor(`${name}_${track.node.getName()}_${path}_time`)
      .setArray(Float32Array.from(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node.getName()}_${path}_value`)
      .setArray(Float32Array.from(track.values.flat())).setType(type).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node.getName()}_${path}`)
      .setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node.getName()}_${path}`)
      .setTargetNode(track.node).setTargetPath(path).setSampler(sampler));
  }
  clipAudit.push({ name, seconds: duration, channels: tracks.length });
  return animation;
}
function restTranslation(node) { return [...node.getTranslation()]; }
function restRotation(node) { return normalizeQuat([...node.getRotation()]); }
function addRotationTrack(tracks, node, times, eulerOffsets) {
  const base = restRotation(node);
  tracks.push({ node, times, values: eulerOffsets.map((offset) => multiplyQuat(base, combineEuler(offset))) });
}
function addTranslationTrack(tracks, node, times, offsets) {
  const base = restTranslation(node);
  tracks.push({ node, path: 'translation', times, values: offsets.map((offset) => base.map((value, axis) => value + offset[axis])) });
}

// Reuse the source Walk channels and timing, increase stride modestly and shorten
// the cycle. This retains the Tripo gait's source-driven foot and hand detail.
const run = doc.createAnimation('Run');
const runTimeScale = 0.78;
for (const channel of sourceWalk.listChannels()) {
  const sampler = channel.getSampler();
  if (sampler.getInterpolation() !== 'LINEAR') throw new Error(`Unexpected source Walk interpolation after repair: ${sampler.getInterpolation()}.`);
  const sourceTimes = Array.from(sampler.getInput().getArray());
  const times = sourceTimes.map((time) => time * runTimeScale);
  const values = Array.from(sampler.getOutput().getArray());
  const path = channel.getTargetPath();
  const node = channel.getTargetNode();
  if (path === 'rotation') {
    const base = restRotation(node);
    for (let i = 0; i < values.length; i += 4) {
      const source = normalizeQuat(values.slice(i, i + 4));
      const delta = multiplyQuat(inverseQuat(base), source);
      values.splice(i, 4, ...multiplyQuat(base, quaternionPower(delta, 1.16)));
    }
  } else if (path === 'translation' && node === hips) {
    const base = restTranslation(node);
    for (let i = 0; i < values.length; i += 3) values[i + 1] = base[1] + (values[i + 1] - base[1]) * 1.22;
  }
  const input = doc.createAccessor(`Run_${node.getName()}_${path}_time`)
    .setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
  const output = doc.createAccessor(`Run_${node.getName()}_${path}_value`)
    .setArray(Float32Array.from(values)).setType(path === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3).setBuffer(buffer);
  const runSampler = doc.createAnimationSampler(`Run_${node.getName()}_${path}`)
    .setInput(input).setOutput(output).setInterpolation('LINEAR');
  run.addSampler(runSampler).addChannel(doc.createAnimationChannel(`Run_${node.getName()}_${path}`)
    .setTargetNode(node).setTargetPath(path).setSampler(runSampler));
}
clipAudit.push({ name: 'Run', seconds: Math.max(...sourceWalk.listSamplers().flatMap((sampler) => Array.from(sampler.getInput().getArray()))) * runTimeScale, channels: run.listChannels().length });

createClip('Idle', 3, (() => {
  const times = [0, 0.75, 1.5, 2.25, 3];
  const tracks = [];
  addTranslationTrack(tracks, hips, times, [[0, 0, 0], [0, 0.0022, 0], [0, 0, 0], [0, -0.0022, 0], [0, 0, 0]]);
  addRotationTrack(tracks, spine, times, [[0, 0, 0], [0.005, 0, 0.018], [0.008, 0, 0], [0.005, 0, -0.018], [0, 0, 0]]);
  addRotationTrack(tracks, chest, times, [[0, 0, 0], [0.018, 0, 0], [0.026, 0, 0], [0.018, 0, 0], [0, 0, 0]]);
  addRotationTrack(tracks, upperChest, times, [[0, 0, 0], [0.012, 0, -0.006], [0.018, 0, 0], [0.012, 0, 0.006], [0, 0, 0]]);
  addRotationTrack(tracks, head, times, [[0, 0, -0.012], [0, 0.018, 0], [0, 0, 0.012], [0, -0.018, 0], [0, 0, -0.012]]);
  const neck = nodesByOriginalName.get('Neck');
  if (neck) addRotationTrack(tracks, neck, times, [[0, 0, 0], [0.006, 0, -0.01], [0.008, 0, 0], [0.006, 0, 0.01], [0, 0, 0]]);
  for (const [node, sign] of [[leftUpperArm, -1], [rightUpperArm, 1]]) {
    if (node) addRotationTrack(tracks, node, times, [[0, 0, 0], [0.008, 0, sign * 0.012], [0.012, 0, 0], [0.008, 0, -sign * 0.012], [0, 0, 0]]);
  }
  return tracks;
})());

createClip('Attack', 1.0, (() => {
  const times = [0, 0.16, 0.34, 0.55, 0.78, 1.0];
  const tracks = [];
  addTranslationTrack(tracks, hips, times, [[0, 0, 0], [0, -0.004, 0.008], [0, -0.014, 0.018], [0, -0.018, -0.028], [0, -0.008, -0.01], [0, 0, 0]]);
  addRotationTrack(tracks, hips, times, [[0, 0, 0], [0, -0.08, 0], [0, -0.22, 0], [0, 0.16, 0], [0, 0.06, 0], [0, 0, 0]]);
  addRotationTrack(tracks, spine, times, [[0, 0, 0], [0.04, -0.12, 0], [0.08, -0.22, 0], [-0.05, 0.20, 0], [-0.02, 0.06, 0], [0, 0, 0]]);
  addRotationTrack(tracks, chest, times, [[0, 0, 0], [0.02, -0.08, 0], [0.02, -0.14, 0], [-0.05, 0.14, 0], [-0.02, 0.04, 0], [0, 0, 0]]);
  addRotationTrack(tracks, upperChest, times, [[0, 0, 0], [0, -0.06, 0], [0, -0.12, 0], [0, 0.10, 0], [0, 0.04, 0], [0, 0, 0]]);
  if (rightUpperArm) addRotationTrack(tracks, rightUpperArm, times, [[0, 0, 0], [0.12, -0.12, 0.08], [0.24, -0.18, 0.16], [-0.42, 0.18, -0.16], [-0.20, 0.08, -0.06], [0, 0, 0]]);
  if (rightLowerArm) addRotationTrack(tracks, rightLowerArm, times, [[0, 0, 0], [0.10, 0, 0], [0.16, 0, 0], [-0.52, 0, 0], [-0.20, 0, 0], [0, 0, 0]]);
  if (leftUpperArm) addRotationTrack(tracks, leftUpperArm, times, [[0, 0, 0], [-0.04, 0.06, 0.04], [-0.12, 0.10, 0.10], [0.18, -0.08, -0.08], [0.08, -0.04, -0.04], [0, 0, 0]]);
  if (leftLowerArm) addRotationTrack(tracks, leftLowerArm, times, [[0, 0, 0], [-0.04, 0, 0], [-0.10, 0, 0], [0.22, 0, 0], [0.08, 0, 0], [0, 0, 0]]);
  addRotationTrack(tracks, head, times, [[0, 0, 0], [0, -0.06, 0.02], [0, -0.10, 0.03], [0, 0.10, -0.02], [0, 0.04, 0], [0, 0, 0]]);
  return tracks;
})());

createClip('Hit', 0.52, (() => {
  const times = [0, 0.07, 0.22, 0.52];
  const tracks = [];
  addTranslationTrack(tracks, hips, times, [[0, 0, 0], [0, -0.014, -0.018], [0, -0.006, -0.008], [0, 0, 0]]);
  addRotationTrack(tracks, hips, times, [[0, 0, 0], [-0.08, 0, 0.04], [0.03, 0, -0.02], [0, 0, 0]]);
  addRotationTrack(tracks, spine, times, [[0, 0, 0], [-0.14, 0, -0.10], [0.06, 0, 0.04], [0, 0, 0]]);
  addRotationTrack(tracks, chest, times, [[0, 0, 0], [-0.10, 0, -0.08], [0.04, 0, 0.03], [0, 0, 0]]);
  addRotationTrack(tracks, head, times, [[0, 0, 0], [0.12, 0, 0.06], [-0.04, 0, -0.02], [0, 0, 0]]);
  if (leftUpperArm) addRotationTrack(tracks, leftUpperArm, times, [[0, 0, 0], [-0.06, 0, 0.13], [0.03, 0, -0.05], [0, 0, 0]]);
  if (rightUpperArm) addRotationTrack(tracks, rightUpperArm, times, [[0, 0, 0], [-0.05, 0, -0.14], [0.02, 0, 0.05], [0, 0, 0]]);
  if (leftLowerArm) addRotationTrack(tracks, leftLowerArm, times, [[0, 0, 0], [0.10, 0, 0], [0.03, 0, 0], [0, 0, 0]]);
  if (rightLowerArm) addRotationTrack(tracks, rightLowerArm, times, [[0, 0, 0], [0.10, 0, 0], [0.03, 0, 0], [0, 0, 0]]);
  return tracks;
})());

createClip('Death', 1.65, (() => {
  const times = [0, 0.20, 0.58, 1.05, 1.65];
  const tracks = [];
  addTranslationTrack(tracks, hips, times, [[0, 0, 0], [0, -0.018, 0.006], [0, -0.075, -0.018], [0, -0.135, -0.025], [0, -0.15, -0.025]]);
  addRotationTrack(tracks, hips, times, [[0, 0, 0], [-0.08, 0, -0.08], [-0.40, 0, -0.16], [-0.82, 0, -0.24], [-0.88, 0, -0.24]]);
  addRotationTrack(tracks, spine, times, [[0, 0, 0], [-0.04, 0, 0.02], [-0.16, 0, 0.10], [-0.22, 0, 0.18], [-0.22, 0, 0.18]]);
  addRotationTrack(tracks, chest, times, [[0, 0, 0], [-0.02, 0, 0.02], [-0.12, 0, 0.08], [-0.17, 0, 0.14], [-0.17, 0, 0.14]]);
  addRotationTrack(tracks, upperChest, times, [[0, 0, 0], [0, 0, 0.02], [-0.08, 0, 0.06], [-0.12, 0, 0.10], [-0.12, 0, 0.10]]);
  addRotationTrack(tracks, head, times, [[0, 0, 0], [0.05, 0, 0.04], [0.14, 0, 0.10], [0.22, 0, 0.14], [0.22, 0, 0.14]]);
  if (leftUpperArm) addRotationTrack(tracks, leftUpperArm, times, [[0, 0, 0], [-0.06, 0, 0.04], [-0.24, 0, 0.14], [-0.42, 0, 0.22], [-0.42, 0, 0.22]]);
  if (rightUpperArm) addRotationTrack(tracks, rightUpperArm, times, [[0, 0, 0], [-0.06, 0, -0.04], [-0.24, 0, -0.14], [-0.42, 0, -0.22], [-0.42, 0, -0.22]]);
  if (leftLowerArm) addRotationTrack(tracks, leftLowerArm, times, [[0, 0, 0], [0.04, 0, 0], [0.20, 0, 0], [0.34, 0, 0], [0.34, 0, 0]]);
  if (rightLowerArm) addRotationTrack(tracks, rightLowerArm, times, [[0, 0, 0], [0.04, 0, 0], [0.20, 0, 0], [0.34, 0, 0], [0.34, 0, 0]]);
  if (leftUpperLeg) addRotationTrack(tracks, leftUpperLeg, times, [[0, 0, 0], [-0.02, 0, 0.02], [0.10, 0, 0.05], [0.18, 0, 0.07], [0.18, 0, 0.07]]);
  if (rightUpperLeg) addRotationTrack(tracks, rightUpperLeg, times, [[0, 0, 0], [-0.02, 0, -0.02], [0.10, 0, -0.05], [0.18, 0, -0.07], [0.18, 0, -0.07]]);
  if (leftLowerLeg) addRotationTrack(tracks, leftLowerLeg, times, [[0, 0, 0], [0.04, 0, 0], [0.26, 0, 0], [0.44, 0, 0], [0.44, 0, 0]]);
  if (rightLowerLeg) addRotationTrack(tracks, rightLowerLeg, times, [[0, 0, 0], [0.04, 0, 0], [0.26, 0, 0], [0.44, 0, 0], [0.44, 0, 0]]);
  return tracks;
})());

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidatePath, candidateBytes);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const review = await io.readBinary(candidateBytes);
const reviewRoot = review.getRoot();
const reviewPrimitive = reviewRoot.listMeshes()[0]?.listPrimitives()[0];
if (!reviewPrimitive || reviewRoot.listAnimations().length !== 6 || reviewRoot.listSkins()[0]?.listJoints().length !== 67) {
  throw new Error('Round-trip candidate failed the mesh, clip or rig count check.');
}
for (const [semantic, expectedHash] of Object.entries(sourceAttributes)) {
  const accessor = semantic === 'indices' ? reviewPrimitive.getIndices() : reviewPrimitive.getAttribute(semantic);
  if (hashArray(accessor.getArray()) !== expectedHash) throw new Error(`Round-trip changed original ${semantic} data.`);
}
const outputTextureAudit = reviewRoot.listTextures().map((texture) => ({ name: texture.getName(), sha256: createHash('sha256').update(texture.getImage()).digest('hex') }));
if (outputTextureAudit.some((texture) => !textureAudit.some((source) => source.name === texture.name && source.sha256 === texture.sha256))) {
  throw new Error('Round-trip changed an original image map.');
}
for (const animation of reviewRoot.listAnimations()) {
  if (!animation.listChannels().length || animation.listChannels().some((channel) => !channel.getTargetNode())) throw new Error(`Invalid animation: ${animation.getName()}.`);
}
const clipMotion = reviewRoot.listAnimations().map((animation) => {
  const varyingChannels = animation.listChannels().filter((channel) => {
    const values = Array.from(channel.getSampler().getOutput().getArray());
    const stride = channel.getTargetPath() === 'rotation' ? 4 : 3;
    for (let index = stride; index < values.length; index += stride) {
      for (let axis = 0; axis < stride; axis += 1) {
        if (Math.abs(values[index + axis] - values[index - stride + axis]) > 0.0001) return true;
      }
    }
    return false;
  }).length;
  if (!varyingChannels) throw new Error(`${animation.getName()} has no animated channel values.`);
  return { name: animation.getName(), varyingChannels };
});
for (const clip of clipAudit) clip.varyingChannels = clipMotion.find((item) => item.name === clip.name)?.varyingChannels ?? 0;
if ((clipMotion.find((clip) => clip.name === 'Walk')?.varyingChannels ?? 0) < 3) throw new Error('Source Walk does not contain useful moving joints.');
const candidateBounds = sourceBounds.map((pair) => pair.map((value) => value * scale));
const size = candidateBounds.map(([min, max]) => max - min);
const normalizedBounds = [candidateBounds[0], [Math.max(0, candidateBounds[1][0]), candidateBounds[1][1]], candidateBounds[2]];
const runtimeAnimations = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
if (runtimeAnimations.some((name) => !reviewRoot.listAnimations().some((animation) => animation.getName() === name))) {
  throw new Error('Required six creature animation clip names are missing.');
}
const acceptance = {
  sourceDesignAudit: false,
  geometry: true,
  sourceWalkRetained: true,
  rig: false,
  animation: false,
  pbr: false,
  labAccepted: false,
  worldIntegrated: false,
};
const candidate = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: modelId,
  displayName: modelName,
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourcePath,
    sha256: actualSourceHash,
    bytes: sourceBytes.length,
    starredModelId: 'af6d578f-d3c2-4bf0-8178-ac92a20b34d8',
    starredCardId: 'af6d578f-d3c2-4bf0-8178-ac92a20b34d8',
    starredDisplayName: 'dark armored demon 3d model',
    generator: 'Tripo P1.0 PBR',
    exportSettings: 'GLB, 2K source maps, Export Skeleton enabled, Walk animation selected',
    prompt: 'humanoid demon-like armored creature with purple crystalline accents, dark armor, sharp claws',
    sourceSkin: 'Tripo-exported 67-joint humanoid glTF skin with vertex weights and inverse bind matrices',
    sourceAnimations: [{ name: 'walk', channels: 201, seconds: 2.3333332538604736, interpolation: sourceWalkInterpolation, interpolationRepair: repairedStepSamplers ? `converted ${repairedStepSamplers} STEP samplers to LINEAR while preserving source keys` : 'none', verifiedRetainedAs: 'Walk' }],
    geometry: {
      vertices: vertexCount,
      triangles: triangleCount,
      bounds: { min: sourceBounds.map((pair) => pair[0]), max: sourceBounds.map((pair) => pair[1]) },
      positionsPreserved: true,
      indicesPreserved: true,
      normalsPreserved: true,
      uvsPreserved: true,
      skinWeightsPreserved: true,
      retopology: false,
    },
    textures: textureAudit,
  },
  candidate: {
    file: candidatePath,
    sha256: candidateSha256,
    bytes: candidateBytes.length,
    productionTarget: `game/public/assets/models/wilderness/${modelId}.glb`,
    geometry: {
      vertices: vertexCount,
      triangles: triangleCount,
      bounds: { min: normalizedBounds.map((pair) => pair[0]), max: candidateBounds.map((pair) => pair[1]) },
      size,
      nativeScale: scale,
      sourcePositionArraysPreserved: true,
      proportionsPreserved: true,
      indicesPreserved: true,
      uvsPreserved: true,
    },
    rig: {
      type: 'Tripo source skin with Unity/Mixamo Humanoid joint naming',
      joints: 67,
      weightsPerVertex: 4,
      inverseBindMatrices: true,
      skeletonRoot: 'mixamorigHips',
      meshSkinWeightsPreserved: true,
      method: 'Retained source skin, weights and inverse binds; renamed the existing humanoid chain to Unity/Mixamo conventions without changing mesh topology or bind weights.',
    },
    textures: textureAudit,
    metallicRange,
    roughnessRange,
    pbr: 'Original image-generated 2K base-color, metallic-roughness and normal maps are retained byte-for-byte. PBR channel ranges are verified; final material response awaits the root visual lab.',
    animations: clipAudit,
  },
  acceptance,
};
await writeFile(`${baseDir}/catalog.json`, `${JSON.stringify(candidate, null, 2)}\n`);
const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-starred-creatures', name: 'Corealm starred creatures', author: 'Corealm', source: 'Starred Tripo exports with preserved source rig and animations', license: 'LicenseRef-Tripo-Generated' },
  files: { [modelId]: candidateName },
  assets: [{
    id: modelId,
    file: `models/wilderness/${modelId}.glb`,
    pack: 'corealm-starred-creatures',
    category: 'character',
    is: `${modelName} starred T60 Wilderness candidate`,
    tags: ['creature', 'humanoid', 'demon', 'armored', 'purple-crystal', 'wilderness', 't60', 'starred', 'tripo', 'candidate', 'skinned', 'articulated'],
    bytes: candidateBytes.length,
    sha256: candidateSha256,
    vertices: vertexCount,
    triangles: triangleCount,
    size: { x: size[0], y: size[1], z: size[2] },
    base: { x: normalizedBounds[0][0], y: normalizedBounds[1][0], z: normalizedBounds[2][0] },
    bounds: { min: normalizedBounds.map((pair) => pair[0]), max: candidateBounds.map((pair) => pair[1]) },
    groundY: 0,
    animations: runtimeAnimations,
    materials: [material.getName()],
    sourceProvenance: {
      author: 'Starred Tripo source mesh, source rig and Walk keyframes retained; STEP timing repaired and five Corealm clips added',
      sourceModelId: 'e1b8c030-b812-4b78-b4d7-4216e8a4a603',
      sourceCardId: 'af6d578f-d3c2-4bf0-8178-ac92a20b34d8',
      sourceFile: sourcePath,
      sourceSha256: actualSourceHash,
      candidateFile: candidatePath,
      candidateSha256,
      rigMethod: 'Tripo-exported 67-bone humanoid skin and original Walk gait retained; Mixamo/Unity bone naming added; Idle, Run, Attack, Hit and Death authored on the same weighted skeleton.',
      sourcePrompt: 'humanoid demon-like armored creature with purple crystalline accents, dark armor, sharp claws',
      textures: textureAudit,
      pbr: { metallicRange, roughnessRange, baseColor: true, normal: true, metallicRoughness: true },
      candidateStatus: 'awaiting-root-lab-review',
    },
    acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  }],
};
await writeFile(`${baseDir}/lab-catalog.json`, `${JSON.stringify(labCatalog, null, 2)}\n`);
await writeFile(`${baseDir}/verification.json`, `${JSON.stringify({
  source: { bytes: sourceBytes.length, sha256: actualSourceHash, vertices: vertexCount, triangles: triangleCount, attributes: sourceAttributes, textures: textureAudit },
  candidate: { bytes: candidateBytes.length, sha256: candidateSha256, vertices: vertexCount, triangles: triangleCount, attributesPreserved: true, sourceMapsPreservedByteForByte: true, skins: reviewRoot.listSkins().length, joints: reviewRoot.listSkins()[0].listJoints().length, clips: clipAudit, clipMotion, scale, size, metallicRange, roughnessRange },
  acceptance,
}, null, 2)}\n`);
console.log(JSON.stringify({ candidatePath, bytes: candidateBytes.length, sha256: candidateSha256, vertices: vertexCount, triangles: triangleCount, size, skins: reviewRoot.listSkins().length, joints: reviewRoot.listSkins()[0].listJoints().length, textures: textureAudit, metallicRange, roughnessRange, clips: clipAudit, acceptance }, null, 2));

function hashArray(array) {
  return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
}
function boundsOf(array) {
  const bounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
  for (let index = 0; index < array.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds[axis][0] = Math.min(bounds[axis][0], array[index + axis]);
      bounds[axis][1] = Math.max(bounds[axis][1], array[index + axis]);
    }
  }
  return bounds;
}
