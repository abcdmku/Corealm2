import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/d20f1d55-1dce-46f6-b4e4-375769915b1f.glb');
const sourceImagePath = path.join(repo, 'assets/art/tripo/refs/crown-wild-red-dragon.png');
const candidatePath = path.join(here, 'starred-red-dragon_candidate.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const expectedSourceSha256 = 'a4e053f8f0df3aef8c1503fcbcb47988f656d3b009cdfe8c382b703db7b96ef0';
const sourceImageSha256 = '7938d512e86acba10ed37cfe8767193ad8a066e0b71891ca0f5e4a664b550d99';
const modelId = 'd20f1d55-1dce-46f6-b4e4-375769915b1f';
const sourceImageId = '7be6e74e-3c63-4e8a-919f-cc6f415822d4';
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha256 !== expectedSourceSha256) throw new Error(`Source GLB hash mismatch: ${sourceSha256}`);
const sourceImageBytes = await readFile(sourceImagePath);
const actualSourceImageSha256 = createHash('sha256').update(sourceImageBytes).digest('hex');
if (actualSourceImageSha256 !== sourceImageSha256) throw new Error(`Source image hash mismatch: ${actualSourceImageSha256}`);

const io = new NodeIO();
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const sourceSkin = root.listSkins()[0];
const sourceJoints = sourceSkin?.listJoints() ?? [];
const scene = root.listScenes()[0];
if (!scene || !sourceSkin || root.listSkins().length !== 1) throw new Error('Expected one scene and one source skin');
if (sourceJoints.length !== 49) throw new Error(`Unexpected source skin joint count ${sourceJoints.length}`);
if (root.listAnimations().length !== 0) throw new Error('Source unexpectedly contains animations; refusing to overwrite');
const oldArmature = scene.listChildren().find((node) => node.getName() === 'Armature');
const meshNode = root.listNodes().find((node) => node.getMesh());
const sourceMesh = meshNode?.getMesh();
const primitive = sourceMesh?.listPrimitives()[0];
if (!oldArmature || !meshNode || !sourceMesh || !primitive) throw new Error('Source Armature mesh hierarchy was not found');
const positionAccessor = primitive.getAttribute('POSITION');
const normalAccessor = primitive.getAttribute('NORMAL');
const uvAccessor = primitive.getAttribute('TEXCOORD_0');
const indexAccessor = primitive.getIndices();
if (!positionAccessor || !normalAccessor || !uvAccessor || !indexAccessor) throw new Error('Source geometry is missing required PBR mesh attributes');
const positions = Float32Array.from(positionAccessor.getArray());
const normals = Float32Array.from(normalAccessor.getArray());
const uvs = Float32Array.from(uvAccessor.getArray());
const indices = Uint32Array.from(indexAccessor.getArray());
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (vertexCount !== 6649 || triangleCount !== 9327) throw new Error(`Unexpected source geometry ${vertexCount} vertices / ${triangleCount} triangles`);
const originalAttributes = new Map([
  ['POSITION', positions],
  ['NORMAL', normals],
  ['TEXCOORD_0', uvs],
  ['indices', indices],
]);

// Rest joint coordinates follow the export's grounded Y-up, +Z-forward body axis.
// The 41-joint rig uses a continuous axial chain, four planted legs, and mirrored
// multi-ray wings so movement stays attached to the supplied dragon silhouette.
const rig = [
  { name: 'DragonRoot', parent: null, global: [0, 0, 0], kind: 'root' },
  { name: 'Pelvis', parent: 'DragonRoot', global: [0, .232, .035], kind: 'body' },
  { name: 'SpineRear', parent: 'Pelvis', global: [0, .258, .112], kind: 'body' },
  { name: 'SpineMid', parent: 'SpineRear', global: [0, .282, .185], kind: 'body' },
  { name: 'Chest', parent: 'SpineMid', global: [0, .303, .246], kind: 'body' },
  { name: 'NeckBase', parent: 'Chest', global: [0, .365, .315], kind: 'body' },
  { name: 'NeckMid', parent: 'NeckBase', global: [0, .438, .359], kind: 'body' },
  { name: 'Head', parent: 'NeckMid', global: [0, .510, .394], kind: 'body' },
  { name: 'Jaw', parent: 'Head', global: [0, .475, .445], kind: 'jaw' },
  { name: 'TailBase', parent: 'Pelvis', global: [0, .212, -.080], kind: 'tail' },
  { name: 'TailMid', parent: 'TailBase', global: [0, .158, -.225], kind: 'tail' },
  { name: 'TailEnd', parent: 'TailMid', global: [0, .112, -.366], kind: 'tail' },
  { name: 'TailTip', parent: 'TailEnd', global: [0, .124, -.468], kind: 'tail' },
];
for (const side of ['L', 'R']) {
  const sign = side === 'L' ? -1 : 1;
  rig.push(
    { name: `ForeHip_${side}`, parent: 'Chest', global: [sign * .052, .302, .305], kind: 'leg' },
    { name: `ForeUpper_${side}`, parent: `ForeHip_${side}`, global: [sign * .093, .238, .291], kind: 'leg' },
    { name: `ForeLower_${side}`, parent: `ForeUpper_${side}`, global: [sign * .104, .130, .302], kind: 'leg' },
    { name: `ForePaw_${side}`, parent: `ForeLower_${side}`, global: [sign * .122, .025, .357], kind: 'leg' },
    { name: `HindHip_${side}`, parent: 'Pelvis', global: [sign * .038, .226, .037], kind: 'leg' },
    { name: `HindUpper_${side}`, parent: `HindHip_${side}`, global: [sign * .086, .178, .096], kind: 'leg' },
    { name: `HindLower_${side}`, parent: `HindUpper_${side}`, global: [sign * .094, .096, .019], kind: 'leg' },
    { name: `HindPaw_${side}`, parent: `HindLower_${side}`, global: [sign * .120, .025, .050], kind: 'leg' },
  );
  rig.push(
    { name: `WingShoulder_${side}`, parent: 'Chest', global: [sign * .066, .323, .208], kind: 'wing' },
    { name: `WingArm_${side}`, parent: `WingShoulder_${side}`, global: [sign * .184, .430, .184], kind: 'wing' },
    { name: `WingElbow_${side}`, parent: `WingArm_${side}`, global: [sign * .326, .538, .103], kind: 'wing' },
    { name: `WingTip_${side}`, parent: `WingElbow_${side}`, global: [sign * .476, .580, -.006], kind: 'wing' },
    { name: `WingFingerA_${side}`, parent: `WingElbow_${side}`, global: [sign * .438, .479, .227], kind: 'wing' },
    { name: `WingFingerB_${side}`, parent: `WingArm_${side}`, global: [sign * .328, .366, .327], kind: 'wing' },
  );
}
const rigByName = new Map(rig.map((joint) => [joint.name, joint]));
if (rig.length !== 41) throw new Error(`Unexpected custom joint count ${rig.length}`);
const ordered = [];
const nodeByName = new Map();
const localByName = new Map();
const globalByName = new Map();
const children = new Map(rig.map((joint) => [joint.name, []]));
for (const joint of rig) if (joint.parent) children.get(joint.parent).push(joint.name);
function visit(name) {
  const joint = rigByName.get(name);
  const parent = joint.parent ? rigByName.get(joint.parent) : null;
  const local = parent ? joint.global.map((value, axis) => value - parent.global[axis]) : [...joint.global];
  localByName.set(name, local);
  globalByName.set(name, [...joint.global]);
  const node = doc.createNode(name).setTranslation(local).setRotation([0, 0, 0, 1]);
  nodeByName.set(name, node);
  ordered.push(name);
  for (const child of children.get(name)) visit(child);
}
visit('DragonRoot');
if (ordered.length !== rig.length) throw new Error('Custom rig is disconnected or contains a cycle');

// Remove the damaged anonymous armature. Geometry and mesh-node transform remain at rest.
meshNode.setSkin(null);
sourceSkin.dispose();
oldArmature.removeChild(meshNode);
for (const joint of sourceJoints) {
  const parent = joint.getParentNode();
  if (parent) parent.removeChild(joint);
}
for (const node of [meshNode, ...sourceJoints]) {
  if (node.getParentNode()) node.getParentNode().removeChild(node);
}
for (const joint of sourceJoints) joint.dispose();
scene.removeChild(oldArmature);
oldArmature.dispose();
const rigContainer = doc.createNode('RedDragon_native_rig');
scene.addChild(rigContainer);
const rootNode = nodeByName.get('DragonRoot');
rigContainer.addChild(rootNode);
rigContainer.addChild(meshNode);
for (const name of ordered) {
  const joint = rigByName.get(name);
  const node = nodeByName.get(name);
  if (joint.parent) nodeByName.get(joint.parent).addChild(node);
  if (!joint.parent && node !== rootNode) throw new Error(`Unexpected second rig root ${name}`);
}
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const skin = doc.createSkin('Red Dragon six-limb quadruped skin');
skin.setSkeleton(rootNode);
for (const name of ordered) skin.addJoint(nodeByName.get(name));
meshNode.setSkin(skin);

const worldMatrices = new Map();
for (const name of ordered) {
  const local = new THREE.Matrix4().makeTranslation(...localByName.get(name));
  const parent = rigByName.get(name).parent;
  worldMatrices.set(name, parent ? worldMatrices.get(parent).clone().multiply(local) : local);
}
const inverseBind = new Float32Array(16 * ordered.length);
for (let index = 0; index < ordered.length; index++) worldMatrices.get(ordered[index]).clone().invert().toArray(inverseBind, index * 16);
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Red Dragon repaired rig, weights and animations');
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(inverseBind).setBuffer(buffer));

function distanceToSegment(point, a, b) {
  const ab = b.map((value, axis) => value - a[axis]);
  const ap = point.map((value, axis) => value - a[axis]);
  const den = ab.reduce((sum, value) => sum + value * value, 0);
  const t = den > 1e-10 ? Math.max(0, Math.min(1, ab.reduce((sum, value, axis) => sum + value * ap[axis], 0) / den)) : 0;
  return Math.hypot(...point.map((value, axis) => value - (a[axis] + ab[axis] * t)));
}
const deformSegments = rig.filter((joint) => joint.parent).map((joint) => {
  const sigma = joint.kind === 'body' ? .086 : joint.kind === 'tail' ? .072 : joint.kind === 'wing' ? .065 : joint.kind === 'jaw' ? .042 : .052;
  return {
    name: joint.name,
    index: ordered.indexOf(joint.name),
    a: globalByName.get(joint.parent),
    b: joint.global,
    sigma,
  };
});
const jointIndices = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const weightedVertexCounts = Array(ordered.length).fill(0);
const weightMass = Array(ordered.length).fill(0);
let maximumWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const scored = deformSegments.map((segment) => {
    const distance = distanceToSegment(point, segment.a, segment.b);
    return { index: segment.index, score: Math.exp(-(distance * distance) / (2 * segment.sigma * segment.sigma)) };
  }).sort((a, b) => b.score - a.score).slice(0, 4);
  const sum = scored.reduce((value, influence) => value + influence.score, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw new Error(`No valid bind weights at vertex ${vertex}`);
  let normalizedSum = 0;
  for (let influence = 0; influence < 4; influence++) {
    const item = scored[influence];
    const weight = item.score / sum;
    jointIndices[vertex * 4 + influence] = item.index;
    weights[vertex * 4 + influence] = weight;
    normalizedSum += weight;
    weightMass[item.index] += weight;
    if (weight > 1e-5) weightedVertexCounts[item.index]++;
  }
  maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(normalizedSum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jointIndices).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));

function smooth(a, b, t) {
  const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}
function pulse(t, a, b, c, d) { return smooth(a, b, t) * (1 - smooth(c, d, t)); }
function poseFor(clip, t) {
  const p = new Map(), r = new Map();
  const trans = (name, x = 0, y = 0, z = 0) => p.set(name, [x, y, z]);
  const rot = (name, x = 0, y = 0, z = 0) => r.set(name, [x, y, z]);
  const s = Math.max(0, Math.min(1, t / clip.seconds));
  const phase = 2 * Math.PI * s;
  const wingLift = (side, amount) => {
    const sign = side === 'L' ? -1 : 1;
    rot(`WingShoulder_${side}`, 0, 0, sign * amount);
    rot(`WingArm_${side}`, 0, 0, sign * amount * .74);
    rot(`WingElbow_${side}`, 0, 0, sign * amount * .42);
    rot(`WingFingerA_${side}`, 0, 0, sign * amount * .24);
    rot(`WingFingerB_${side}`, 0, 0, sign * amount * .2);
  };
  const tail = (sway, pitch = 0) => {
    rot('TailBase', pitch * .25, sway * .35, 0);
    rot('TailMid', pitch * .35, sway * .65, 0);
    rot('TailEnd', pitch * .24, sway, 0);
    rot('TailTip', pitch * .12, sway * 1.2, 0);
  };
  const gait = (speed, flex, lift, bodyBounce) => {
    const offsets = { ForeHip_L: 0, HindHip_R: 0, ForeHip_R: Math.PI, HindHip_L: Math.PI };
    for (const [hip, offset] of Object.entries(offsets)) {
      const isFore = hip.startsWith('Fore');
      const side = hip.endsWith('_L') ? 'L' : 'R';
      const foreOrHind = isFore ? 'Fore' : 'Hind';
      const legPhase = phase + offset;
      const stride = Math.sin(legPhase);
      const swing = Math.max(0, Math.sin(legPhase));
      rot(`${foreOrHind}Upper_${side}`, speed * stride, 0, 0);
      rot(`${foreOrHind}Lower_${side}`, -flex * swing, 0, 0);
      rot(`${foreOrHind}Paw_${side}`, -speed * stride + flex * swing * .55, 0, 0);
      rot(hip, speed * stride * .24, 0, 0);
    }
    trans('Pelvis', 0, bodyBounce * (1 - Math.cos(phase * 2)) * .5, 0);
    rot('SpineMid', .018 * Math.sin(phase * 2), 0, .012 * Math.sin(phase));
    rot('Chest', .014 * Math.sin(phase * 2), 0, -.012 * Math.sin(phase));
    rot('NeckBase', -.018 * Math.sin(phase), 0, 0);
    rot('Head', .015 * Math.sin(phase), .025 * Math.sin(phase), 0);
    tail(.045 * Math.sin(phase), -.015 * Math.sin(phase));
    for (const side of ['L', 'R']) wingLift(side, lift * Math.sin(phase + (side === 'L' ? 0 : Math.PI)));
  };

  if (clip.name === 'Idle') {
    trans('Pelvis', 0, .0045 * Math.sin(phase), 0);
    rot('SpineMid', .012 * Math.sin(phase), 0, .006 * Math.sin(phase + .3));
    rot('Chest', .018 * Math.sin(phase), 0, 0);
    rot('NeckBase', -.022 * Math.sin(phase), .018 * Math.sin(phase), 0);
    rot('NeckMid', .02 * Math.sin(phase + .5), 0, 0);
    rot('Head', .025 * Math.sin(phase + .5), -.045 * Math.sin(phase), 0);
    rot('Jaw', .015 + .018 * (1 + Math.sin(phase)) * .5, 0, 0);
    tail(.055 * Math.sin(phase), .015 * Math.sin(phase + .4));
    for (const side of ['L', 'R']) wingLift(side, .035 * Math.sin(phase));
  } else if (clip.name === 'Walk') {
    gait(.34, .34, .045, .008);
  } else if (clip.name === 'Run') {
    gait(.56, .63, .09, .015);
    rot('SpineRear', -.025 * Math.sin(phase * 2), 0, 0);
  } else if (clip.name === 'Attack') {
    const brace = pulse(s, .04, .15, .28, .40);
    const lunge = pulse(s, .26, .38, .52, .64);
    const recover = smooth(.55, .94, s);
    trans('Pelvis', 0, -.004 * brace * (1 - lunge), .018 * lunge * (1 - recover));
    rot('SpineRear', -.025 * brace + .025 * lunge, 0, 0);
    rot('SpineMid', -.035 * brace + .04 * lunge, 0, 0);
    rot('Chest', -.04 * brace + .06 * lunge, 0, 0);
    rot('NeckBase', .12 * brace + .28 * lunge, 0, 0);
    rot('NeckMid', .09 * brace + .35 * lunge, 0, 0);
    rot('Head', .04 * brace + .41 * lunge, 0, 0);
    trans('Head', 0, 0, .036 * lunge * (1 - recover));
    rot('Jaw', .05 + .43 * lunge, 0, 0);
    tail(-.10 * brace + .045 * lunge, -.06 * lunge);
    for (const side of ['L', 'R']) wingLift(side, .24 * brace + .17 * lunge);
    rot('ForeUpper_R', -.28 * lunge, 0, 0);
    rot('ForeLower_R', -.22 * lunge, 0, 0);
  } else if (clip.name === 'Hit') {
    const recoil = pulse(s, 0, .08, .22, .48);
    trans('Pelvis', 0, .014 * recoil, -.028 * recoil);
    rot('SpineMid', -.11 * recoil, 0, .045 * recoil);
    rot('Chest', -.13 * recoil, 0, .055 * recoil);
    rot('NeckBase', -.18 * recoil, 0, 0);
    rot('NeckMid', -.20 * recoil, 0, 0);
    rot('Head', -.24 * recoil, 0, 0);
    rot('Jaw', .16 * recoil, 0, 0);
    tail(.12 * recoil, .04 * recoil);
    for (const side of ['L', 'R']) wingLift(side, -.20 * recoil);
    rot('ForeUpper_L', -.20 * recoil, 0, 0);
    rot('ForeLower_L', -.10 * recoil, 0, 0);
  } else if (clip.name === 'Death') {
    const stagger = pulse(s, .0, .07, .19, .35);
    const collapse = smooth(.18, .78, s);
    const settle = smooth(.68, 1, s);
    trans('Pelvis', 0, -.005 * collapse + .009 * stagger, -.012 * collapse);
    rot('Pelvis', 0, 0, .08 * collapse);
    rot('SpineRear', .06 * collapse, .02 * collapse, .05 * collapse);
    rot('SpineMid', .045 * collapse, 0, .055 * collapse);
    rot('Chest', .06 * collapse, 0, .045 * collapse);
    rot('NeckBase', .10 * stagger + .13 * collapse, .04 * collapse, 0);
    rot('NeckMid', .14 * stagger + .16 * collapse, 0, 0);
    rot('Head', .10 * stagger + .14 * collapse, -.08 * collapse, 0);
    rot('Jaw', .28 * collapse, 0, 0);
    tail(.16 * collapse, .16 * collapse);
    for (const side of ['L', 'R']) wingLift(side, -.18 * collapse);
    for (const side of ['L', 'R']) {
      rot(`ForeUpper_${side}`, -.14 * collapse, 0, 0);
      rot(`ForeLower_${side}`, -.34 * collapse, 0, 0);
      trans(`ForePaw_${side}`, 0, .026 * collapse, 0);
      rot(`ForePaw_${side}`, .18 * settle, 0, 0);
      rot(`HindUpper_${side}`, -.18 * collapse, 0, 0);
      rot(`HindLower_${side}`, -.40 * collapse, 0, 0);
      trans(`HindPaw_${side}`, 0, .014 * collapse, 0);
      rot(`HindPaw_${side}`, .20 * settle, 0, 0);
    }
  }
  return { p, r };
}
const clips = [
  { name: 'Idle', seconds: 2.4, samples: 57, loop: true },
  { name: 'Walk', seconds: 1.18, samples: 36, loop: true },
  { name: 'Run', seconds: .74, samples: 36, loop: true },
  { name: 'Attack', seconds: .90, samples: 43, loop: false },
  { name: 'Hit', seconds: .54, samples: 27, loop: false },
  { name: 'Death', seconds: 1.68, samples: 51, loop: false },
];
const clipBuildReport = [];
for (const clip of clips) {
  const animation = doc.createAnimation(clip.name);
  const times = Float32Array.from({ length: clip.samples }, (_, index) => clip.seconds * index / (clip.samples - 1));
  let channels = 0;
  for (const name of ordered) {
    const rotationValues = new Float32Array(clip.samples * 4);
    const translationValues = new Float32Array(clip.samples * 3);
    let hasRotation = false, hasTranslation = false;
    const baseTranslation = localByName.get(name);
    for (let frame = 0; frame < clip.samples; frame++) {
      const pose = poseFor(clip, times[frame]);
      const rotation = pose.r.get(name) ?? [0, 0, 0];
      const offset = pose.p.get(name) ?? [0, 0, 0];
      if (rotation.some((value) => Math.abs(value) > 1e-7)) hasRotation = true;
      if (offset.some((value) => Math.abs(value) > 1e-7)) hasTranslation = true;
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ')).toArray(rotationValues, frame * 4);
      for (let axis = 0; axis < 3; axis++) translationValues[frame * 3 + axis] = baseTranslation[axis] + offset[axis];
    }
    const addChannel = (pathName, type, values) => {
      const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
      const output = doc.createAccessor().setType(type).setArray(values).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${pathName}`)
        .setTargetNode(nodeByName.get(name)).setTargetPath(pathName).setSampler(sampler));
      channels++;
    };
    if (hasRotation) addChannel('rotation', 'VEC4', rotationValues);
    if (hasTranslation) addChannel('translation', 'VEC3', translationValues);
  }
  if (channels < 6) throw new Error(`${clip.name} has too few animated channels (${channels})`);
  clipBuildReport.push({ name: clip.name, seconds: clip.seconds, samples: clip.samples, loop: clip.loop, channels });
}

const inverseBindMatrices = ordered.map((_, index) => new THREE.Matrix4().fromArray(inverseBind, index * 16));
const motionBounds = [];
for (const clip of clips) {
  const clipBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], maxVertexDisplacement: 0, lowestPoint: null };
  for (let frame = 0; frame < clip.samples; frame++) {
    const time = clip.seconds * frame / (clip.samples - 1);
    const pose = poseFor(clip, time);
    const poseMatrices = new Map();
    for (const name of ordered) {
      const baseTranslation = localByName.get(name);
      const offset = pose.p.get(name) ?? [0, 0, 0];
      const euler = pose.r.get(name) ?? [0, 0, 0];
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(baseTranslation[0] + offset[0], baseTranslation[1] + offset[1], baseTranslation[2] + offset[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], 'XYZ')),
        new THREE.Vector3(1, 1, 1),
      );
      const parent = rigByName.get(name).parent;
      poseMatrices.set(name, parent ? poseMatrices.get(parent).clone().multiply(local) : local);
    }
    const skinMatrices = ordered.map((name, index) => poseMatrices.get(name).clone().multiply(inverseBindMatrices[index]));
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const sourcePoint = new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
      const result = [0, 0, 0];
      for (let influence = 0; influence < 4; influence++) {
        const offset = vertex * 4 + influence;
        const matrix = skinMatrices[jointIndices[offset]];
        const transformed = sourcePoint.clone().applyMatrix4(matrix);
        const weight = weights[offset];
        result[0] += transformed.x * weight;
        result[1] += transformed.y * weight;
        result[2] += transformed.z * weight;
      }
      for (let axis = 0; axis < 3; axis++) {
        clipBounds.min[axis] = Math.min(clipBounds.min[axis], result[axis]);
        clipBounds.max[axis] = Math.max(clipBounds.max[axis], result[axis]);
      }
      if (result[1] === clipBounds.min[1]) clipBounds.lowestPoint = {
        frame,
        vertex,
        source: sourcePoint.toArray(),
        deformed: result,
        influences: Array.from({ length: 4 }, (_, influence) => {
          const offset = vertex * 4 + influence;
          return { joint: ordered[jointIndices[offset]], weight: weights[offset] };
        }),
      };
      clipBounds.maxVertexDisplacement = Math.max(clipBounds.maxVertexDisplacement,
        Math.hypot(result[0] - sourcePoint.x, result[1] - sourcePoint.y, result[2] - sourcePoint.z));
    }
  }
  if (clipBounds.maxVertexDisplacement > .8) throw new Error(`${clip.name} deforms the source mesh too far (${clipBounds.maxVertexDisplacement.toFixed(3)} m)`);
  if (clipBounds.min[1] < -.03) throw new Error(`${clip.name} pushes the grounded mesh too far below the source floor (${clipBounds.min[1].toFixed(3)} m)`);
  motionBounds.push({ name: clip.name, min: clipBounds.min, max: clipBounds.max, maxVertexDisplacement: clipBounds.maxVertexDisplacement, lowestPoint: clipBounds.lowestPoint });
}

const roleByTexture = new Map();
for (const material of root.listMaterials()) {
  for (const [role, texture] of [
    ['baseColor', material.getBaseColorTexture()],
    ['metallicRoughness', material.getMetallicRoughnessTexture()],
    ['normal', material.getNormalTexture()],
    ['occlusion', material.getOcclusionTexture()],
    ['emissive', material.getEmissiveTexture()],
  ]) if (texture) roleByTexture.set(texture, role);
}
const textureReport = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  if (!image?.byteLength) continue;
  const originalMeta = await sharp(image).metadata();
  const originalSha256 = createHash('sha256').update(image).digest('hex');
  const role = roleByTexture.get(texture);
  if (!role) throw new Error(`Source texture ${texture.getName()} has no material role`);
  let output;
  let mimeType;
  if (role === 'baseColor') {
    output = await sharp(image).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
      .jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    mimeType = 'image/jpeg';
  } else if (role === 'metallicRoughness' || role === 'occlusion') {
    output = await sharp(image).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true, kernel: 'linear' })
      .png({ compressionLevel: 9 }).toBuffer();
    mimeType = 'image/png';
  } else if (role === 'normal') {
    const resized = await sharp(image).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true, kernel: 'linear' })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = resized.data;
    if (resized.info.channels < 3) throw new Error('Normal map has fewer than three channels');
    for (let i = 0; i < pixels.length; i += resized.info.channels) {
      let nx = pixels[i] / 127.5 - 1;
      let ny = pixels[i + 1] / 127.5 - 1;
      let nz = pixels[i + 2] / 127.5 - 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      pixels[i] = Math.round((nx + 1) * 127.5);
      pixels[i + 1] = Math.round((ny + 1) * 127.5);
      pixels[i + 2] = Math.round((nz + 1) * 127.5);
    }
    output = await sharp(pixels, { raw: resized.info }).png({ compressionLevel: 9 }).toBuffer();
    mimeType = 'image/png';
  } else {
    throw new Error(`Unsupported source PBR role ${role}`);
  }
  const outputMeta = await sharp(output).metadata();
  if (outputMeta.width !== 2048 || outputMeta.height !== 2048) throw new Error(`${role} texture was not reduced to 2K`);
  texture.setImage(new Uint8Array(output)).setMimeType(mimeType).setName(`red_dragon_${role}_2k`);
  textureReport.push({
    role,
    source: { width: originalMeta.width, height: originalMeta.height, sha256: originalSha256 },
    runtime: { width: outputMeta.width, height: outputMeta.height, mimeType, bytes: output.length, sha256: createHash('sha256').update(output).digest('hex') },
    reduction: role === 'baseColor' ? 'Lanczos resample of source color map' : role === 'normal' ? 'linear resample then tangent-vector renormalization' : 'linear resample of source linear PBR channels',
  });
}
if (textureReport.length !== 3 || !['baseColor', 'metallicRoughness', 'normal'].every((role) => textureReport.some((item) => item.role === role))) {
  throw new Error('Expected linked source base color, metallic-roughness and normal maps');
}

const geometryDelta = { position: 0, normal: 0, uv: 0, indexMismatches: 0 };
for (const [name, expected] of originalAttributes) {
  const actual = name === 'indices' ? primitive.getIndices().getArray() : primitive.getAttribute(name).getArray();
  if (actual.length !== expected.length) throw new Error(`${name} element count changed`);
  if (name === 'indices') {
    for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) geometryDelta.indexMismatches++;
  } else {
    let maximum = 0;
    for (let i = 0; i < actual.length; i++) maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
    geometryDelta[name === 'POSITION' ? 'position' : name === 'NORMAL' ? 'normal' : 'uv'] = maximum;
  }
}
if (geometryDelta.position || geometryDelta.normal || geometryDelta.uv || geometryDelta.indexMismatches) throw new Error(`Source geometry changed: ${JSON.stringify(geometryDelta)}`);
if (maximumWeightSumError > 2e-6) throw new Error(`Skin weights are not normalized (${maximumWeightSumError})`);
if ([...weights].some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Skin weights contain invalid values');
if (weightedVertexCounts[0] !== 0 || weightedVertexCounts.slice(1).some((count) => count === 0)) {
  throw new Error(`Rig contains a non-root bone without vertex influence: ${JSON.stringify(weightedVertexCounts)}`);
}

await mkdir(here, { recursive: true });
await io.write(candidatePath, doc);
const candidateBytes = await readFile(candidatePath);
const candidateSha256 = createHash('sha256').update(candidateBytes).digest('hex');
const checkDoc = await io.read(candidatePath);
const checkRoot = checkDoc.getRoot();
const checkSkin = checkRoot.listSkins()[0];
const checkJoints = checkSkin?.listJoints() ?? [];
const checkAnimations = checkRoot.listAnimations();
const checkMeshNode = checkRoot.listNodes().find((node) => node.getMesh());
const checkPrimitive = checkMeshNode?.getMesh()?.listPrimitives()[0];
if (!checkPrimitive) throw new Error('Written candidate has no mesh primitive');
for (const [name, expected] of originalAttributes) {
  const actual = name === 'indices' ? checkPrimitive.getIndices()?.getArray() : checkPrimitive.getAttribute(name)?.getArray();
  if (!actual || actual.length !== expected.length) throw new Error(`Written candidate ${name} data has the wrong length`);
  for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) throw new Error(`Written candidate changed ${name} at element ${i}`);
}
const checkSkinWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkJointIndices = checkPrimitive.getAttribute('JOINTS_0')?.getArray();
if (!checkSkinWeights || !checkJointIndices) throw new Error('Written candidate skin attributes are missing');
let checkWeightSumError = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0;
  for (let influence = 0; influence < 4; influence++) {
    const offset = vertex * 4 + influence;
    if (checkJointIndices[offset] >= rig.length || !Number.isFinite(checkSkinWeights[offset]) || checkSkinWeights[offset] < 0) {
      throw new Error(`Written candidate has an invalid influence at vertex ${vertex}`);
    }
    sum += checkSkinWeights[offset];
  }
  checkWeightSumError = Math.max(checkWeightSumError, Math.abs(sum - 1));
}
if (checkWeightSumError > 1e-5) throw new Error(`Written candidate skin weights are not normalized (${checkWeightSumError})`);
const checkTextureSizes = [];
const checkRoleByTexture = new Map();
for (const material of checkRoot.listMaterials()) {
  for (const [role, texture] of [
    ['baseColor', material.getBaseColorTexture()],
    ['metallicRoughness', material.getMetallicRoughnessTexture()],
    ['normal', material.getNormalTexture()],
  ]) if (texture) checkRoleByTexture.set(texture, role);
}
for (const texture of checkRoot.listTextures()) {
  const metadata = await sharp(texture.getImage()).metadata();
  const role = checkRoleByTexture.get(texture);
  if (!role || metadata.width !== 2048 || metadata.height !== 2048) throw new Error(`Written candidate texture ${texture.getName()} is not a linked 2K PBR map`);
  checkTextureSizes.push({ role, width: metadata.width, height: metadata.height });
}
if (checkTextureSizes.length !== textureReport.length) throw new Error('Written candidate texture count changed');
const requiredClips = clips.map((clip) => clip.name);
const actualClips = checkAnimations.map((animation) => animation.getName());
if (checkRoot.listSkins().length !== 1 || checkJoints.length !== rig.length) throw new Error('Written candidate rig does not match intended joint count');
if (requiredClips.some((name) => !actualClips.includes(name))) throw new Error(`Written candidate is missing clips: ${requiredClips.filter((name) => !actualClips.includes(name))}`);
const clipValidation = [];
for (const animation of checkAnimations) {
  const definition = clips.find((clip) => clip.name === animation.getName());
  let endTime = 0;
  for (const channel of animation.listChannels()) {
    const target = channel.getTargetNode();
    const sampler = channel.getSampler();
    const input = sampler?.getInput()?.getArray();
    const output = sampler?.getOutput()?.getArray();
    const pathName = channel.getTargetPath();
    if (!target || !checkJoints.includes(target) || !['rotation', 'translation'].includes(pathName)) throw new Error(`${animation.getName()} has an invalid target`);
    if (!input?.length || !output?.length || [...input, ...output].some((value) => !Number.isFinite(value))) throw new Error(`${animation.getName()} has a missing or non-finite sampler`);
    for (let i = 1; i < input.length; i++) if (input[i] <= input[i - 1]) throw new Error(`${animation.getName()} sampler times are not strictly increasing`);
    const expectedWidth = pathName === 'rotation' ? 4 : 3;
    if (output.length !== input.length * expectedWidth) throw new Error(`${animation.getName()} sampler output width is invalid`);
    if (input[0] !== 0 || Math.abs(input[input.length - 1] - definition.seconds) > 1e-4) throw new Error(`${animation.getName()} sampler does not span its clip`);
    if (definition.loop) {
      const width = expectedWidth;
      const first = output.slice(0, width), last = output.slice(output.length - width);
      for (let i = 0; i < width; i++) if (Math.abs(first[i] - last[i]) > 2e-5) throw new Error(`${animation.getName()} loop is not sealed at ${target.getName()}.${pathName}`);
    }
    endTime = Math.max(endTime, input[input.length - 1]);
  }
  if (!animation.listChannels().length) throw new Error(`${animation.getName()} has no channels`);
  clipValidation.push({ name: animation.getName(), channels: animation.listChannels().length, seconds: endTime, loop: definition.loop });
}

const bounds = [0, 1, 2].map((axis) => {
  let min = Infinity, max = -Infinity;
  for (let i = axis; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]);
    max = Math.max(max, positions[i]);
  }
  return [min, max];
});
const catalog = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'creature_starred_red_dragon',
  displayName: 'Red Dragon of Crownward',
  status: 'awaiting-root-image-and-lab-review',
  accepted: false,
  worldIntegrated: false,
  source: {
    file: '../../../exports/d20f1d55-1dce-46f6-b4e4-375769915b1f.glb',
    projectId: modelId,
    modelId,
    sourceImageId,
    sourceImageSha256,
    sourceBatch: 'assets/art/tripo/batches/creatures-crown-wild.json',
    sourceBatchCreatureId: 'red-dragon',
    sourceContentRole: 'red dragon',
    starred: true,
    sourceImageFile: 'assets/art/tripo/refs/crown-wild-red-dragon.png',
    sha256: sourceSha256,
    bytes: sourceBytes.length,
    vertices: vertexCount,
    triangles: triangleCount,
    sourceSkinJoints: sourceJoints.length,
    sourceAnimationCount: 0,
    sourceImageReview: {
      imageReview: 'approved',
      facialReview: 'approved',
      reviewer: 'wild_audit / face_audit_crown',
      sourceImageId,
      note: 'The exact source image is approved in the Tripo batch ledger; candidate rest geometry and animation remain pending root visual and lab review.',
    },
    sourceMaps: textureReport.map((item) => ({ role: item.role, width: item.source.width, height: item.source.height, sha256: item.source.sha256 })),
  },
  candidate: {
    file: path.basename(candidatePath),
    sha256: candidateSha256,
    bytes: candidateBytes.length,
    vertices: vertexCount,
    triangles: triangleCount,
    joints: rig.map((joint, index) => ({ name: joint.name, index, parent: joint.parent, restPosition: joint.global, kind: joint.kind })),
    maps: textureReport.map((item) => ({ role: item.role, dimensions: [item.runtime.width, item.runtime.height], mime: item.runtime.mimeType, sha256: item.runtime.sha256, reduction: item.reduction })),
    clips: clipValidation.map((clip) => ({ ...clip, source: 'Corealm grounded quadruped and articulated dragon action authoring' })),
  },
  rig: {
    preset: 'custom grounded six-limb draconic quadruped',
    basis: 'Y-up, +Z-forward, X lateral; source body axis and foot-ground bounds preserved',
    jointCount: rig.length,
    weightMethod: 'Four normalized Gaussian influences to nearest anatomical bone segments; central spine/tail/head surfaces map onto a continuous axial chain; mirrored forelegs, hindlegs and wing rays use separate chains.',
    weightedVertices: weightedVertexCounts,
    jointWeightMass: weightMass.map((value) => Number(value.toFixed(3))),
    geometryPreserved: true,
    uvPreserved: true,
    topologyChanged: false,
    sourceWeightsReplaced: true,
    restBounds: bounds,
    validation: {
      positionMaxDelta: geometryDelta.position,
      normalMaxDelta: geometryDelta.normal,
      uvMaxDelta: geometryDelta.uv,
      indexMismatches: geometryDelta.indexMismatches,
      maxWeightSumError: maximumWeightSumError,
      writtenMaxWeightSumError: checkWeightSumError,
      writtenSkinJoints: checkJoints.length,
      writtenTextureSizes: checkTextureSizes,
      writtenAnimations: clipValidation,
      sampledDeformationBounds: motionBounds,
      geometryMapContentOrigin: 'Exact linked Tripo export maps; only resolution and vector-safe resampling changed for runtime.',
    },
  },
  review: {
    candidateImageReview: 'pending-root-review',
    candidateRigReview: 'pending-root-lab-review',
    productionPromotionAllowed: false,
    worldIntegrationAllowed: false,
  },
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
const labCatalog = {
  schema: 'corealm-creature-lab-candidate/1',
  status: 'awaiting-root-image-and-lab-review',
  entries: [{
    id: catalog.id,
    modelFile: path.basename(candidatePath),
    sourceModelId: modelId,
    sourceSha256,
    candidateSha256,
    triangles: triangleCount,
    vertices: vertexCount,
    joints: rig.length,
    animations: clipValidation.map((clip) => clip.name),
    textureRoles: textureReport.map((item) => item.role),
    textureResolution: 2048,
    imageReview: 'source-approved; candidate visual acceptance pending root review',
    rigReview: 'pending-root-lab-review',
    accepted: false,
  }],
};
await writeFile(labCatalogPath, `${JSON.stringify(labCatalog, null, 2)}\n`);

console.log(JSON.stringify({
  candidatePath,
  candidateSha256,
  sourceSha256,
  sourceImageId,
  sourceImageSha256,
  vertices: vertexCount,
  triangles: triangleCount,
  joints: rig.length,
  weightedVertices: weightedVertexCounts,
  maxWeightSumError: maximumWeightSumError,
  maps: textureReport.map((item) => ({ role: item.role, dimensions: [item.runtime.width, item.runtime.height], bytes: item.runtime.bytes })),
  clips: clipValidation,
  geometryUnchanged: geometryDelta,
  rootImageAndLabAcceptancePending: true,
}, null, 2));
