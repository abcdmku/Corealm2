import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { deformedBounds } from '../../../../../../../../../tools/creature-motion/validate-deformation.ts';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

const folder = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(folder, '../../../../../../../../../');
const id = path.basename(folder);
const sourcePath = path.resolve(folder, '../../../base/part-05.glb');
const outputPath = path.join(folder, 'rigged-candidate.glb');
const reportPath = path.join(folder, 'candidate-manifest.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const hashArray = value => sha256(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
const sourceBytes = await readFile(sourcePath);
const sourceHash = sha256(sourceBytes);
if (sourceHash !== 'b0002e37976dee1aa0b98414fff1d58d86dfc3eab38358457831787c4d1ae049') throw new Error('Source hash differs from extraction-ledger.json');
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find(node => node.getMesh() === mesh);
if (!scene || !primitive || !meshNode || root.listMeshes().length !== 1 || root.listSkins().length || root.listAnimations().length) {
  throw new Error('Expected one unskinned, unanimated extracted imp mesh.');
}
const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
const tangents = primitive.getAttribute('TANGENT')?.getArray() ? Float32Array.from(primitive.getAttribute('TANGENT').getArray()) : null;
const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
if (!positions.length || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3 || !indices.length || indices.length % 3) {
  throw new Error('Source geometry is missing aligned positions, normals, UVs, or triangles.');
}
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}
const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
if (!(extent[1] > 0.15 && extent[1] < 0.8)) throw new Error(`Unexpected extracted imp height ${extent[1]}.`);
const targetHeight = { 'part-04-magma-imp': 1.45, 'part-05-ivory-bone-imp': 1.55, 'part-06-purple-cyclops-imp': 1.35 }[id];
if (!targetHeight) throw new Error(`No target height configured for ${id}`);
const uniformScale = targetHeight / extent[1];
const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
const geometryHashes = { positions: hashArray(positions), normals: hashArray(normals), tangents: tangents ? hashArray(tangents) : null, uvs: hashArray(uvs), triangleIndices: hashArray(indices) };

// Preserve the extracted vertex frame. A wrapper recenters and normalizes the presentation
// while a shared armature holds the unchanged mesh-local vertex coordinates.
const sourceOffset = { translation: meshNode.getTranslation(), rotation: meshNode.getRotation(), scale: meshNode.getScale() };
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const presentation = doc.createNode(`${id}_Presentation`).setTranslation(sourceOffset.translation.map(value => value * uniformScale)).setRotation(sourceOffset.rotation).setScale([uniformScale, uniformScale, uniformScale]);
const rig = doc.createNode('Armature');
for (const child of [...scene.listChildren()]) scene.removeChild(child);
scene.addChild(presentation);
presentation.addChild(meshNode);
presentation.addChild(rig);

const cx = center[0], cz = center[2], y = f => bounds.min[1] + extent[1] * f, x = (side, f) => cx + side * extent[0] * f;
const bones = [
  ['Hips', null, [cx, y(.42), cz]], ['Spine', 'Hips', [cx, y(.51), cz]],
  ['Spine1', 'Spine', [cx, y(.61), cz]], ['Spine2', 'Spine1', [cx, y(.71), cz]],
  ['Neck', 'Spine2', [cx, y(.79), cz]], ['Head', 'Neck', [cx, y(.89), cz]],
  ['LeftShoulder', 'Spine2', [x(-1, .18), y(.70), cz]], ['LeftArm', 'LeftShoulder', [x(-1, .33), y(.64), cz]],
  ['LeftForeArm', 'LeftArm', [x(-1, .47), y(.52), cz]], ['LeftHand', 'LeftForeArm', [x(-1, .48), y(.40), cz]],
  ['RightShoulder', 'Spine2', [x(1, .18), y(.70), cz]], ['RightArm', 'RightShoulder', [x(1, .33), y(.64), cz]],
  ['RightForeArm', 'RightArm', [x(1, .47), y(.52), cz]], ['RightHand', 'RightForeArm', [x(1, .48), y(.40), cz]],
  ['LeftUpLeg', 'Hips', [x(-1, .12), y(.36), cz]], ['LeftLeg', 'LeftUpLeg', [x(-1, .14), y(.21), cz]],
  ['LeftFoot', 'LeftLeg', [x(-1, .14), y(.08), cz]], ['LeftToeBase', 'LeftFoot', [x(-1, .14), y(.04), bounds.max[2]]],
  ['RightUpLeg', 'Hips', [x(1, .12), y(.36), cz]], ['RightLeg', 'RightUpLeg', [x(1, .14), y(.21), cz]],
  ['RightFoot', 'RightLeg', [x(1, .14), y(.08), cz]], ['RightToeBase', 'RightFoot', [x(1, .14), y(.04), bounds.max[2]]],
  ['LeftHandMiddle1', 'LeftHand', [x(-1, .51), y(.39), cz]],
  ['RightHandMiddle1', 'RightHand', [x(1, .51), y(.39), cz]],
].map(([name, parent, p], index) => ({ name: `mixamorig:${name}`, semantic: name, parent, p, index }));
const byName = new Map(bones.map(bone => [bone.semantic, bone]));
const joints = new Map();
for (const bone of bones) {
  const parent = bone.parent ? joints.get(bone.parent) : rig;
  const parentPosition = bone.parent ? byName.get(bone.parent).p : [0, 0, 0];
  const node = doc.createNode(bone.name).setTranslation(bone.p.map((value, axis) => value - parentPosition[axis]));
  parent.addChild(node);
  joints.set(bone.semantic, node);
}
const skin = doc.createSkin(`${id}_Humanoid`).setSkeleton(joints.get('Hips'));
for (const bone of bones) skin.addJoint(joints.get(bone.semantic));
const inverseBind = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [bx, by, bz] = bones[i].p;
  inverseBind.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -bx,-by,-bz,1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor(`${id}_InverseBind`).setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const segmentDistance = (p, a, b) => {
  const v = b.map((value, i) => value - a[i]);
  const vv = v.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, p.reduce((sum, value, i) => sum + (value - a[i]) * v[i], 0) / vv));
  return Math.hypot(...p.map((value, i) => value - (a[i] + t * v[i])));
};
const child = new Map([['Spine','Spine1'],['Spine1','Spine2'],['Spine2','Neck'],['Neck','Head'],
  ['LeftShoulder','LeftArm'],['LeftArm','LeftForeArm'],['LeftForeArm','LeftHand'],['RightShoulder','RightArm'],['RightArm','RightForeArm'],['RightForeArm','RightHand'],
  ['LeftUpLeg','LeftLeg'],['LeftLeg','LeftFoot'],['LeftFoot','LeftToeBase'],['RightUpLeg','RightLeg'],['RightLeg','RightFoot'],['RightFoot','RightToeBase']]);
const joints0 = new Uint16Array(positions.length / 3 * 4), weights0 = new Float32Array(joints0.length);
let maxWeightSumError = 0;
for (let vertex = 0; vertex < positions.length / 3; vertex++) {
  const p = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const py = (p[1] - bounds.min[1]) / extent[1], px = p[0] - cx;
  const candidates = bones.map(bone => {
    const end = byName.get(child.get(bone.semantic))?.p ?? bone.p;
    let gate = 1;
    if (bone.semantic === 'Head' || bone.semantic === 'Neck') gate = py > .69 ? (bone.semantic === 'Head' ? 7 : .65) : .01;
    if (/Shoulder|Arm|Hand/.test(bone.semantic)) {
      const side = bone.semantic.startsWith('Left') ? -1 : 1;
      gate = py > .28 && py < .89 ? .02 + .98 / (1 + Math.exp(-((side * px / extent[0]) - .16) * 22)) : .006;
    }
    if (/UpLeg|Leg|Foot|ToeBase/.test(bone.semantic)) gate = py < .48 ? 1 : .006;
    const sigma = extent[1] * (/Head/.test(bone.semantic) ? .105 : /Arm|Hand/.test(bone.semantic) ? .09 : /Leg|Foot|Toe/.test(bone.semantic) ? .085 : .105);
    const d = segmentDistance(p, bone.parent ? byName.get(bone.parent).p : bone.p, end);
    return { index: bone.index, score: gate * Math.exp(-.5 * (d / sigma) ** 2) };
  }).sort((a, b) => b.score - a.score).slice(0, 4);
  const total = candidates.reduce((sum, item) => sum + item.score, 0) || 1;
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    joints0[vertex * 4 + slot] = candidates[slot]?.index ?? candidates[0].index;
    const value = slot < candidates.length - 1 ? candidates[slot].score / total : slot === candidates.length - 1 ? 1 - assigned : 0;
    weights0[vertex * 4 + slot] = value;
    assigned += value;
  }
  const sum = weights0[vertex*4] + weights0[vertex*4+1] + weights0[vertex*4+2] + weights0[vertex*4+3];
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
}
primitive.setAttribute('JOINTS_0', doc.createAccessor(`${id}_Joints0`).setArray(joints0).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor(`${id}_Weights0`).setArray(weights0).setType(Accessor.Type.VEC4).setBuffer(buffer));

const ground = doc.createNode('corealm_motion_ground');
for (const child of [...scene.listChildren()]) { scene.removeChild(child); ground.addChild(child); }
scene.addChild(ground);
const boneNodes = new Map(bones.map(bone => [bone.semantic, joints.get(bone.semantic)]));
const identityPose = () => { for (const node of boneNodes.values()) node.setRotation([0, 0, 0, 1]); };
const f = (time, pose = {}) => ({ time, pose });
const attackPose = id === 'part-04-magma-imp'
  ? { RightArm: [-.28, 0, -.04], RightForeArm: [-.62, 0, 0], Spine2: [.06, 0, 0] }
  : id === 'part-05-ivory-bone-imp'
    ? { LeftArm: [-.25, 0, .05], LeftForeArm: [-.5, 0, 0], RightArm: [-.25, 0, -.05], RightForeArm: [-.5, 0, 0], Spine2: [.07, 0, 0] }
    : { RightArm: [-.48, 0, 0], RightForeArm: [-.55, 0, 0], Spine2: [.1, 0, 0], Head: [-.06, 0, 0] };
const motionDefinitions = [
  { name: 'Idle', duration: 3.0, loop: true, frames: [
    f(0), f(.75, { Spine1: [.012, 0, 0], Head: [0, .025, 0], LeftArm: [0, 0, -.02] }),
    f(1.5), f(2.25, { Spine1: [-.012, 0, 0], Head: [0, -.025, 0], RightArm: [0, 0, .02] }), f(3.0),
  ] },
  { name: 'Walk', duration: 1.0, loop: true, frames: [
    f(0, { LeftUpLeg: [.10, 0, 0], RightUpLeg: [-.10, 0, 0], LeftArm: [-.08, 0, 0], RightArm: [.08, 0, 0] }),
    f(.25), f(.5, { LeftUpLeg: [-.10, 0, 0], RightUpLeg: [.10, 0, 0], LeftArm: [.08, 0, 0], RightArm: [-.08, 0, 0] }),
    f(.75), f(1.0, { LeftUpLeg: [.10, 0, 0], RightUpLeg: [-.10, 0, 0], LeftArm: [-.08, 0, 0], RightArm: [.08, 0, 0] }),
  ] },
  { name: 'Run', duration: .72, loop: true, frames: [
    f(0, { LeftUpLeg: [.18, 0, 0], RightUpLeg: [-.18, 0, 0], LeftLeg: [-.10, 0, 0], RightLeg: [.10, 0, 0], LeftArm: [-.14, 0, 0], RightArm: [.14, 0, 0] }),
    f(.18), f(.36, { LeftUpLeg: [-.18, 0, 0], RightUpLeg: [.18, 0, 0], LeftLeg: [.10, 0, 0], RightLeg: [-.10, 0, 0], LeftArm: [.14, 0, 0], RightArm: [-.14, 0, 0] }),
    f(.54), f(.72, { LeftUpLeg: [.18, 0, 0], RightUpLeg: [-.18, 0, 0], LeftLeg: [-.10, 0, 0], RightLeg: [.10, 0, 0], LeftArm: [-.14, 0, 0], RightArm: [.14, 0, 0] }),
  ] },
  { name: 'Attack', duration: .9, frames: [
    f(0), f(.18, { RightArm: [.14, 0, -.05], RightForeArm: [.2, 0, 0], ...(id === 'part-05-ivory-bone-imp' ? { LeftArm: [.14, 0, .05], LeftForeArm: [.2, 0, 0] } : {}) }),
    f(.38, attackPose), f(.58, attackPose), f(.9),
  ] },
  { name: 'Hit', duration: .48, frames: [
    f(0), f(.08, { Spine1: [-.10, 0, 0], Spine2: [-.12, 0, 0], Head: [.08, 0, 0], LeftArm: [.04, 0, -.04], RightArm: [.04, 0, .04] }),
    f(.24, { Spine1: [-.07, 0, 0], Spine2: [-.08, 0, 0], Head: [.05, 0, 0] }), f(.48),
  ] },
  { name: 'Death', duration: 1.8, frames: [
    f(0), f(.4, { Hips: [0, 0, .06], Spine1: [.04, 0, 0], LeftLeg: [.08, 0, 0], RightLeg: [.08, 0, 0] }),
    f(1.15, { Hips: [0, 0, .14], Spine1: [.06, 0, 0], Spine2: [.04, 0, 0], LeftLeg: [.16, 0, 0], RightLeg: [.16, 0, 0], LeftArm: [.08, 0, -.06], RightArm: [.08, 0, .06] }),
    f(1.8, { Hips: [0, 0, .14], Spine1: [.06, 0, 0], Spine2: [.04, 0, 0], LeftLeg: [.16, 0, 0], RightLeg: [.16, 0, 0], LeftArm: [.08, 0, -.06], RightArm: [.08, 0, .06] }),
  ] },
];
const quatFor = values => new Quaternion().setFromEuler(new Euler(values[0], values[1], values[2], 'XYZ')).normalize().toArray();
const poseAt = (frames, time, semantic) => {
  let right = frames.findIndex(frame => frame.time >= time);
  if (right < 0) right = frames.length - 1;
  if (right === 0 || frames[right].time === time) return frames[right].pose[semantic] ?? [0, 0, 0];
  const left = frames[right - 1], a = left.pose[semantic] ?? [0, 0, 0], b = frames[right].pose[semantic] ?? [0, 0, 0];
  const mix = (time - left.time) / (frames[right].time - left.time);
  return a.map((value, axis) => value + (b[axis] - value) * mix);
};
const deformedVertices = (document = doc) => {
  const sampledRoot = document.getRoot();
  const result = [], positionValues = [], jointIds = [], influenceWeights = [], inverseBindValues = [];
  const v = new Vector3(), transformed = new Vector3(), blend = new Vector3();
  for (const node of sampledRoot.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const skin = node.getSkin(), world = new Matrix4().fromArray(node.getWorldMatrix());
    const jointMatrices = skin?.listJoints().map((joint, index) => {
      skin.getInverseBindMatrices().getElement(index, inverseBindValues);
      return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverseBindValues));
    });
    for (const item of mesh.listPrimitives()) {
      const positionsAccessor = item.getAttribute('POSITION'), jointsAccessor = item.getAttribute('JOINTS_0'), weightsAccessor = item.getAttribute('WEIGHTS_0');
      for (let index = 0; index < positionsAccessor.getCount(); index++) {
        positionsAccessor.getElement(index, positionValues); v.fromArray(positionValues);
        if (jointMatrices && jointsAccessor && weightsAccessor) {
          jointsAccessor.getElement(index, jointIds); weightsAccessor.getElement(index, influenceWeights); blend.set(0, 0, 0);
          for (let slot = 0; slot < influenceWeights.length; slot++) if (influenceWeights[slot]) {
            const matrix = jointMatrices[jointIds[slot]];
            if (!matrix) throw new Error(`Invalid joint ${jointIds[slot]} during deformation sample.`);
            transformed.copy(v).applyMatrix4(matrix).multiplyScalar(influenceWeights[slot]); blend.add(transformed);
          }
          result.push(blend.x, blend.y, blend.z);
        } else { v.applyMatrix4(world); result.push(v.x, v.y, v.z); }
      }
    }
  }
  return result;
};
identityPose(); ground.setTranslation([0, 0, 0]);
const bindVertices = deformedVertices();
const bindPoseBounds = deformedBounds(doc);
if (Math.abs(bindPoseBounds.min[1]) > .003 || Math.abs((bindPoseBounds.max[1] - bindPoseBounds.min[1]) - targetHeight) > .003) throw new Error(`Scaled bind bounds miss target height/floor: ${JSON.stringify(bindPoseBounds)}`);
const motionReports = [];
for (const definition of motionDefinitions) {
  const active = [...new Set(definition.frames.flatMap(frame => Object.keys(frame.pose)))];
  const count = Math.ceil(definition.duration * 30), times = [], groundValues = [], rotations = new Map(active.map(name => [name, []]));
  let maximumGroundCorrection = 0, minimumRawGround = Infinity, minimumFinalGround = Infinity, maximumFinalGroundGap = 0, maximumVertexTravel = 0;
  for (let frame = 0; frame <= count; frame++) {
    const time = definition.duration * frame / count;
    identityPose();
    for (const semantic of active) boneNodes.get(semantic).setRotation(quatFor(poseAt(definition.frames, time, semantic)));
    ground.setTranslation([0, 0, 0]);
    const rawBounds = deformedBounds(doc), correction = Math.max(0, -rawBounds.min[1] + .001);
    minimumRawGround = Math.min(minimumRawGround, rawBounds.min[1]);
    maximumGroundCorrection = Math.max(maximumGroundCorrection, correction);
    if (correction > .05) throw new Error(`${definition.name} needs ${correction.toFixed(4)} m ground correction at ${time.toFixed(3)} s.`);
    ground.setTranslation([0, correction, 0]);
    const finalBounds = deformedBounds(doc); minimumFinalGround = Math.min(minimumFinalGround, finalBounds.min[1]); maximumFinalGroundGap = Math.max(maximumFinalGroundGap, finalBounds.min[1]);
    if (finalBounds.min[1] < -.003 || finalBounds.min[1] > .053) throw new Error(`${definition.name} exceeds 0.05 m final floor gap: ${finalBounds.min[1]}`);
    const current = deformedVertices();
    for (let i = 0; i < current.length; i += 3) maximumVertexTravel = Math.max(maximumVertexTravel, Math.hypot(current[i] - bindVertices[i], current[i + 1] - bindVertices[i + 1], current[i + 2] - bindVertices[i + 2]));
    times.push(time); groundValues.push(0, correction, 0);
    for (const semantic of active) rotations.get(semantic).push(...boneNodes.get(semantic).getRotation());
  }
  const minimumTravel = definition.name === 'Idle' ? .002 : .012;
  if (maximumVertexTravel < minimumTravel) throw new Error(`${definition.name} moves the weighted mesh only ${maximumVertexTravel.toFixed(4)} m.`);
  identityPose(); ground.setTranslation([0, 0, 0]);
  const clip = doc.createAnimation(definition.name);
  const input = doc.createAccessor(`${id}_${definition.name}_Time`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer);
  for (const semantic of active) {
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor(`${id}_${definition.name}_${semantic}_Rotation`).setType(Accessor.Type.VEC4).setArray(Float32Array.from(rotations.get(semantic))).setBuffer(buffer)).setInterpolation('LINEAR');
    clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(boneNodes.get(semantic)).setTargetPath('rotation').setSampler(sampler));
  }
  const groundSampler = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor(`${id}_${definition.name}_Ground`).setType(Accessor.Type.VEC3).setArray(Float32Array.from(groundValues)).setBuffer(buffer)).setInterpolation('LINEAR');
  clip.addSampler(groundSampler).addChannel(doc.createAnimationChannel().setTargetNode(ground).setTargetPath('translation').setSampler(groundSampler));
  motionReports.push({ name: definition.name, durationSeconds: definition.duration, samplesAt30Hz: count + 1, maximumGroundCorrection, minimumRawGround, minimumFinalGround, maximumFinalGroundGap, maximumVertexTravelMeters: maximumVertexTravel, animatedBones: active });
}
identityPose(); ground.setTranslation([0, 0, 0]);
if (root.listAnimations().map(animation => animation.getName()).join(',') !== 'Idle,Walk,Run,Attack,Hit,Death') throw new Error('Candidate must have exactly six ordered gameplay clips.');
const mapEvidence = [];
for (const texture of root.listTextures()) {
  const bytes = texture.getImage();
  if (!bytes) throw new Error(`Texture ${texture.getName()} has no image.`);
  const before = await sharp(bytes).metadata();
  const inputHash = sha256(bytes);
  if (Math.max(before.width ?? 0, before.height ?? 0) > 2048) {
    const format = before.format === 'jpeg' ? 'jpeg' : 'png';
    const resized = await sharp(bytes).resize(2048, 2048, { fit: 'fill', kernel: texture.getName().toLowerCase().includes('normal') ? 'linear' : 'lanczos3' })
      .toFormat(format, format === 'jpeg' ? { quality: 92, chromaSubsampling: '4:4:4' } : {}).toBuffer();
    texture.setImage(resized);
  }
  const result = await sharp(texture.getImage()).metadata();
  if ((result.width ?? 0) > 2048 || (result.height ?? 0) > 2048) throw new Error(`Texture exceeds 2K: ${texture.getName()}`);
  mapEvidence.push({ name: texture.getName(), inputSha256: inputHash, sourceDimensions: [before.width, before.height], runtimeDimensions: [result.width, result.height], runtimeSha256: sha256(texture.getImage()) });
}
if (!mapEvidence.every(map => map.inputSha256 === map.runtimeSha256)) throw new Error('An embedded source PBR map changed during rigging.');
const outputBytes = await io.writeBinary(doc);
await writeFile(outputPath, outputBytes);
const check = await io.readBinary(outputBytes);
const checkRoot = check.getRoot(), checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
const checkGeometry = {
  positions: hashArray(checkPrimitive.getAttribute('POSITION').getArray()),
  normals: hashArray(checkPrimitive.getAttribute('NORMAL').getArray()),
  tangents: checkPrimitive.getAttribute('TANGENT') ? hashArray(checkPrimitive.getAttribute('TANGENT').getArray()) : null,
  uvs: hashArray(checkPrimitive.getAttribute('TEXCOORD_0').getArray()),
  triangleIndices: hashArray(Uint32Array.from(checkPrimitive.getIndices().getArray())),
};
if (JSON.stringify(checkGeometry) !== JSON.stringify(geometryHashes)) throw new Error('Serialized candidate altered positions, normals, UVs, or triangle corner order.');
if (checkRoot.listAnimations().length !== 6 || checkRoot.listSkins().length !== 1) throw new Error('Serialized candidate lost animations or humanoid skin.');
const exportedBindVertices = deformedVertices(check);
const checkBindPose = new Map(checkRoot.listNodes().map(node => [node, { rotation: node.getRotation(), translation: node.getTranslation() }]));
const serializedMotionProof = [];
const resetExportedPose = () => { for (const [node, pose] of checkBindPose) node.setRotation(pose.rotation).setTranslation(pose.translation); };
const evaluateChannel = (channel, time) => {
  const sampler = channel.getSampler(), input = sampler.getInput().getArray(), output = sampler.getOutput().getArray(), size = sampler.getOutput().getType() === Accessor.Type.VEC4 ? 4 : 3;
  let right = 0; while (right < input.length - 1 && input[right] < time) right++;
  const left = Math.max(0, right - 1), span = input[right] - input[left], amount = span > 0 ? Math.max(0, Math.min(1, (time - input[left]) / span)) : 0;
  const a = Array.from(output.slice(left * size, (left + 1) * size)), b = Array.from(output.slice(right * size, (right + 1) * size));
  if (channel.getTargetPath() === 'rotation') return new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b), amount).toArray();
  return a.map((value, index) => value + (b[index] - value) * amount);
};
for (const animation of checkRoot.listAnimations()) {
  const channels = animation.listChannels(), duration = Math.max(...animation.listSamplers().flatMap(sampler => Array.from(sampler.getInput().getArray()))), count = Math.ceil(duration * 30);
  let maximumCorrection = 0, minimumFloor = Infinity, maximumFloorGap = 0, maximumTravel = 0;
  const groundChannel = channels.find(channel => channel.getTargetNode()?.getName() === 'corealm_motion_ground' && channel.getTargetPath() === 'translation');
  if (!groundChannel) throw new Error(`${animation.getName()} lost its sampled ground channel.`);
  for (let frame = 0; frame <= count; frame++) {
    const time = duration * frame / count;
    resetExportedPose();
    for (const channel of channels) {
      const value = evaluateChannel(channel, time), target = channel.getTargetNode();
      if (channel.getTargetPath() === 'rotation') target.setRotation(value);
      else if (channel.getTargetPath() === 'translation') target.setTranslation(value);
    }
    const boundsAtFrame = deformedBounds(check), correction = evaluateChannel(groundChannel, time)[1];
    minimumFloor = Math.min(minimumFloor, boundsAtFrame.min[1]); maximumFloorGap = Math.max(maximumFloorGap, boundsAtFrame.min[1]);
    maximumCorrection = Math.max(maximumCorrection, correction);
    if (boundsAtFrame.min[1] < -.003 || boundsAtFrame.min[1] > .053 || correction > .05) throw new Error(`${animation.getName()} exported frame violates floor/correction bounds at ${time.toFixed(3)} s.`);
    const current = deformedVertices(check);
    for (let i = 0; i < current.length; i += 3) maximumTravel = Math.max(maximumTravel, Math.hypot(current[i] - exportedBindVertices[i], current[i + 1] - exportedBindVertices[i + 1], current[i + 2] - exportedBindVertices[i + 2]));
  }
  const threshold = animation.getName() === 'Idle' ? .002 : .012;
  if (maximumTravel < threshold) throw new Error(`${animation.getName()} serialized deformation is only ${maximumTravel.toFixed(4)} m.`);
  serializedMotionProof.push({ name: animation.getName(), durationSeconds: duration, samplesAt30Hz: count + 1, maximumGroundCorrectionMeters: maximumCorrection, minimumFloorY: minimumFloor, maximumFloorGapMeters: maximumFloorGap, maximumWeightedVertexTravelMeters: maximumTravel, channels: channels.length });
}
resetExportedPose();const clips = checkRoot.listAnimations().map(animation => ({
  name: animation.getName(), channels: animation.listChannels().length,
  targets: animation.listChannels().map(channel => ({ bone: channel.getTargetNode()?.getName(), path: channel.getTargetPath(), keys: channel.getSampler()?.getInput()?.getCount() })),
}));
const durations = clips.map(clip => {
  const times = checkRoot.listAnimations().find(animation => animation.getName() === clip.name).listSamplers()
    .flatMap(sampler => Array.from(sampler.getInput()?.getArray() ?? []));
  return { name: clip.name, seconds: Math.max(...times) };
});
const geometryCheck = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkWeights = geometryCheck.getAttribute('WEIGHTS_0').getArray();
const checkJoints = geometryCheck.getAttribute('JOINTS_0').getArray();
const weightTotals = [];
for (let i = 0; i < checkWeights.length; i += 4) weightTotals.push(checkWeights[i] + checkWeights[i+1] + checkWeights[i+2] + checkWeights[i+3]);
if (weightTotals.some(value => Math.abs(value - 1) > 1e-5) || [...checkJoints].some(value => value >= checkRoot.listSkins()[0].listJoints().length)) throw new Error('Serialized skin weights or joint indices are invalid.');
const bindBounds = deformedBounds(check);
const provenance = {
  asset: 'part-05-ivory-bone-imp', status: 'provisional-held-for-root-review', source: { file: '../../../base/part-05.glb', sha256: sourceHash, bytes: sourceBytes.length, meshNodeTranslation: sourceOffset },
  mesh: { vertices: positions.length / 3, triangles: indices.length / 3, sourceGeometryHashes: geometryHashes, candidateGeometryHashes: checkGeometry, exactMatch: true },
  normalization: { sourceBounds: bounds, sourceHeight: extent[1], targetHeight, uniformScale, sourcePresentationTranslation: sourceOffset.translation, finalPresentationTranslation: sourceOffset.translation.map(value => value * uniformScale), movedMeshTransformToPresentationRoot: sourceOffset, addedScale: true, outputHeight: targetHeight, bindBounds },
  rig: { method: '24-bone Mixamo-compatible humanoid chain; four Gaussian capsule influences per vertex with lateral limb and face zones', joints: bones.map(bone => bone.name), maxWeightSumError, minWeightSum: Math.min(...weightTotals), maxWeightSum: Math.max(...weightTotals), bindBounds },
  motions: { method: 'Model-specific compact humanoid clips; weighted-mesh sampled every frame at 30 Hz with animated ground correction', clips, durations, grounding: serializedMotionProof, preExportSampling: motionReports, maximumGroundCorrectionMeters: Math.max(...serializedMotionProof.map(report => report.maximumGroundCorrectionMeters)) },
  maps: { count: mapEvidence.length, maxDimension: 2048, maps: mapEvidence },
  candidate: { file: path.basename(outputPath), bytes: outputBytes.length, sha256: sha256(outputBytes) },
  acceptance: { rigAccepted: false, motionAccepted: false, labAccepted: false, productionReady: false },
  verification: { geometryExact: true, weightSumsValid: true, sixClips: clips.map(clip => clip.name).join(',') === 'Idle,Walk,Run,Attack,Hit,Death', mapLimitValid: mapEvidence.every(map => Math.max(...map.runtimeDimensions) <= 2048), sourceMapBytesPreserved: mapEvidence.every(map => map.inputSha256 === map.runtimeSha256) },
  designDisposition: 'provisional-held-for-root-review',
  reviewNote: 'The source sheet uses chibi proportions against the serious RPG brief. Rigging and motion are candidates only; root visual, lab, and production review remain pending.'
};
await writeFile(reportPath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({ candidate: outputPath, report: reportPath, vertices: provenance.mesh.vertices, triangles: provenance.mesh.triangles, clips: durations, sha256: provenance.candidate.sha256 }, null, 2));













