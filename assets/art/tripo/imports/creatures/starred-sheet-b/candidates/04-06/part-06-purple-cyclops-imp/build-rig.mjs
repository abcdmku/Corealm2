import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { retargetHumanoid } from '../../../../../../../../../tools/tripo-creatures/retarget.ts';
import { deformedBounds } from '../../../../../../../../../tools/creature-motion/validate-deformation.ts';

const folder = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(folder, '../../../../../../../../../');
const id = path.basename(folder);
const sourcePath = path.resolve(folder, '../../../base/part-06.glb');
const outputPath = path.join(folder, 'rigged-candidate.glb');
const reportPath = path.join(folder, 'candidate-manifest.json');
const motionPath = path.join(repo, 'game/public/assets/models/animation/animation_library_1.glb');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const hashArray = value => sha256(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
const sourceBytes = await readFile(sourcePath);
const sourceHash = sha256(sourceBytes);
if (sourceHash !== '4082af82cdeee756d3835b6d9c31f69e06f010f618cba468fc92c3652bdf1756') throw new Error('Source hash differs from extraction-ledger.json');
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
const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
const geometryHashes = { positions: hashArray(positions), normals: hashArray(normals), tangents: tangents ? hashArray(tangents) : null, uvs: hashArray(uvs), triangleIndices: hashArray(indices) };

// Preserve the extracted vertex frame. A wrapper recenters and normalizes the presentation
// while a shared armature holds the unchanged mesh-local vertex coordinates.
const sourceOffset = { translation: meshNode.getTranslation(), rotation: meshNode.getRotation(), scale: meshNode.getScale() };
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const presentation = doc.createNode(`${id}_Presentation`).setTranslation(sourceOffset.translation).setRotation(sourceOffset.rotation).setScale(sourceOffset.scale);
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

const motionBytes = await readFile(motionPath);
const motionHash = sha256(motionBytes);
const retarget = retargetHumanoid(doc, await io.readBinary(motionBytes));
for (const animation of [...root.listAnimations()]) if (!['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].includes(animation.getName())) animation.dispose();
retarget.clips = retarget.clips.filter(clip => ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].includes(clip.name));
if (root.listAnimations().map(animation => animation.getName()).join(',') !== 'Idle,Walk,Run,Attack,Hit,Death') {
  throw new Error(`Unexpected clip list: ${root.listAnimations().map(animation => animation.getName()).join(',')}`);
}
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
const clips = checkRoot.listAnimations().map(animation => ({
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
  asset: 'part-06-purple-cyclops-imp', status: 'provisional-held-for-root-review', source: { file: '../../../base/part-06.glb', sha256: sourceHash, bytes: sourceBytes.length, meshNodeTranslation: sourceOffset },
  mesh: { vertices: positions.length / 3, triangles: indices.length / 3, sourceGeometryHashes: geometryHashes, candidateGeometryHashes: checkGeometry, exactMatch: true },
  normalization: { sourceBounds: bounds, sourceHeight: extent[1], movedMeshTransformToPresentationRoot: sourceOffset, addedScale: false, outputHeight: extent[1] },
  rig: { method: '24-bone Mixamo-compatible humanoid chain; four Gaussian capsule influences per vertex with lateral limb and face zones', joints: bones.map(bone => bone.name), maxWeightSumError, minWeightSum: Math.min(...weightTotals), maxWeightSum: Math.max(...weightTotals), bindBounds },
  motions: { library: path.relative(repo, motionPath).replaceAll(path.sep, '/'), sha256: motionHash, retarget, clips, durations },
  maps: { count: mapEvidence.length, maxDimension: 2048, maps: mapEvidence },
  candidate: { file: path.basename(outputPath), bytes: outputBytes.length, sha256: sha256(outputBytes) },
  acceptance: { rigAccepted: false, motionAccepted: false, labAccepted: false, productionReady: false },
  verification: { geometryExact: true, weightSumsValid: true, sixClips: clips.map(clip => clip.name).join(',') === 'Idle,Walk,Run,Attack,Hit,Death', mapLimitValid: mapEvidence.every(map => Math.max(...map.runtimeDimensions) <= 2048), sourceMapBytesPreserved: mapEvidence.every(map => map.inputSha256 === map.runtimeSha256) },
  designDisposition: 'provisional-held-for-root-review',
  reviewNote: 'The source sheet uses chibi proportions against the serious RPG brief. Rigging and motion are candidates only; root visual, lab, and production review remain pending.'
};
await writeFile(reportPath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({ candidate: outputPath, report: reportPath, vertices: provenance.mesh.vertices, triangles: provenance.mesh.triangles, clips: durations, sha256: provenance.candidate.sha256 }, null, 2));






