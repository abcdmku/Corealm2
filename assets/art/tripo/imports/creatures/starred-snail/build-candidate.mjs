import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Accessor } from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourcePath = path.join(repo, 'assets/art/tripo/exports/c06d6fe7-0b0a-43f4-9715-ea859450dc4f.glb');
const candidatePath = path.join(here, 'mooncap-snail-native-rig-candidate.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const sourceBytes = await readFile(sourcePath);
const sourceSha = createHash('sha256').update(sourceBytes).digest('hex');
if (sourceSha !== '33c42451d79217f32e37ce9b47fe9b8adfee54d42a2c3f88ee08b3bf4a135d06') throw new Error(`Starred source SHA changed: ${sourceSha}`);

const io = new NodeIO();
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
if (!scene) throw new Error('Starred snail source has no scene');
if (root.listAnimations().length !== 0) throw new Error('Starred snail unexpectedly has clips; refusing to overwrite');
const sourceArmature = scene.listChildren().find((node) => node.getName() === 'Armature');
const meshNode = sourceArmature?.listChildren().find((node) => node.getMesh());
const mesh = meshNode?.getMesh();
const primitive = mesh?.listPrimitives()[0];
if (!sourceArmature || !meshNode || !mesh || !primitive) throw new Error('Starred snail mesh hierarchy was not found');

const positions = Float32Array.from(primitive.getAttribute('POSITION').getArray());
const normals = Float32Array.from(primitive.getAttribute('NORMAL').getArray());
const uv = Float32Array.from(primitive.getAttribute('TEXCOORD_0').getArray());
const indices = Uint32Array.from(primitive.getIndices().getArray());
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (vertexCount !== 2491 || triangleCount !== 4154) throw new Error(`Unexpected starred geometry: ${vertexCount} vertices, ${triangleCount} triangles`);
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
  bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
}

// The exported 16-joint tree is identity-rest with unusable inverse binds and almost
// all vertices assigned to bone_0. Rebuild just the rig and leave the approved mesh intact.
// This image's snail faces +Z: coiled shell to the rear, traveling foot below, and two
// long eyestalks above the head. The shell is a separately weighted rigid group.
const rig = [
  ['MooncapRoot', null, [0, 0, 0]],
  ['FootRear', 'MooncapRoot', [0, .035, -.37]],
  ['FootMiddle', 'FootRear', [0, .035, -.035]],
  ['FootFront', 'FootMiddle', [0, .035, .33]],
  ['Neck', 'FootFront', [0, .20, .32]],
  ['Head', 'Neck', [0, .39, .39]],
  ['EyeStalk_L', 'Head', [-.065, .56, .425]],
  ['Eye_L', 'EyeStalk_L', [-.092, .79, .425]],
  ['EyeStalk_R', 'Head', [.105, .55, .425]],
  ['Eye_R', 'EyeStalk_R', [.16, .79, .425]],
  ['Feelers_L', 'Head', [-.075, .49, .47]],
  ['Feelers_R', 'Head', [.08, .49, .47]],
  ['Mantle', 'MooncapRoot', [0, .22, -.12]],
  ['Shell', 'Mantle', [0, .43, -.12]],
];
const ordered = rig.map(([name]) => name);
const jointIndex = new Map(ordered.map((name, index) => [name, index]));
const byName = new Map(rig.map(([name, parent, global]) => [name, { name, parent, global }]));
const children = new Map(rig.map(([name]) => [name, []]));
for (const [name, parent] of rig) if (parent) children.get(parent).push(name);
const nodeByName = new Map();
const orderedNames = [];
const localByName = new Map();
const worldByName = new Map();
function visit(name) {
  const def = byName.get(name), parent = def.parent ? byName.get(def.parent) : null;
  const local = parent ? def.global.map((value, axis) => value - parent.global[axis]) : [...def.global];
  localByName.set(name, local);
  const node = doc.createNode(name).setTranslation(local).setRotation([0, 0, 0, 1]);
  nodeByName.set(name, node); orderedNames.push(name);
  const localMatrix = new THREE.Matrix4().makeTranslation(...local);
  worldByName.set(name, parent ? worldByName.get(parent.name).clone().multiply(localMatrix) : localMatrix);
  for (const child of children.get(name)) visit(child);
}
visit('MooncapRoot');

// Extract connected geometric islands to preserve the shell, foot and paired stalks
// as distinct anatomical regions while weighting their existing vertices.
const parent = Uint32Array.from({ length: vertexCount }, (_, index) => index);
const find = (value) => { let at = value; while (parent[at] !== at) { parent[at] = parent[parent[at]]; at = parent[at]; } return at; };
const union = (a, b) => { const aa = find(a), bb = find(b); if (aa !== bb) parent[bb] = aa; };
for (let i = 0; i < indices.length; i += 3) { union(indices[i], indices[i + 1]); union(indices[i], indices[i + 2]); }
const components = new Map();
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const id = find(vertex);
  if (!components.has(id)) components.set(id, { id, vertices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const component = components.get(id); component.vertices.push(vertex);
  for (let axis = 0; axis < 3; axis++) {
    const value = positions[vertex * 3 + axis];
    component.min[axis] = Math.min(component.min[axis], value);
    component.max[axis] = Math.max(component.max[axis], value);
  }
}
const islandList = [...components.values()].sort((a, b) => b.vertices.length - a.vertices.length);
const shellIsland = islandList[0];
const footIsland = islandList.find((island) => island.max[1] < .06 && island.max[2] - island.min[2] > .75);
const tallEyeIslands = islandList.filter((island) => island.min[1] > .54 && island.max[1] - island.min[1] > .20 && island.min[2] > .35).sort((a, b) => a.min[0] - b.min[0]);
const shortFeelerIslands = islandList.filter((island) => island.min[1] > .43 && island.max[1] < .57 && island.min[2] > .40).sort((a, b) => a.min[0] - b.min[0]);
if (!footIsland || tallEyeIslands.length !== 2 || shortFeelerIslands.length !== 2) throw new Error(`Could not identify snail parts: foot=${Boolean(footIsland)}, eye stalks=${tallEyeIslands.length}, feelers=${shortFeelerIslands.length}`);
const componentRole = new Map();
componentRole.set(shellIsland.id, 'shell');
componentRole.set(footIsland.id, 'foot');
for (const island of tallEyeIslands) componentRole.set(island.id, island.min[0] < 0 ? 'eyeL' : 'eyeR');
for (const island of shortFeelerIslands) componentRole.set(island.id, island.min[0] < 0 ? 'feelerL' : 'feelerR');

// Weight each vertex against only the bones for its anatomical region. Shell whorls
// stay rigid; the foot uses a gentle front-to-rear traveling wave; neck and stalks bend.
const segment = new Map();
for (const [name, boneParent] of rig) {
  const end = byName.get(name).global;
  const start = boneParent ? byName.get(boneParent).global : end;
  segment.set(name, [start, end]);
}
function distSegment(point, [a, b]) {
  const ab = b.map((value, axis) => value - a[axis]), ap = point.map((value, axis) => value - a[axis]);
  const den = ab.reduce((sum, value) => sum + value * value, 0);
  const t = den > 1e-10 ? Math.max(0, Math.min(1, ab.reduce((sum, value, axis) => sum + value * ap[axis], 0) / den)) : 0;
  return Math.hypot(...point.map((value, axis) => value - (a[axis] + ab[axis] * t)));
}
function regionFor(point, role) {
  const [x, y, z] = point;
  if (role === 'shell') return ['Shell'];
  if (role === 'eyeL') return y > .72 ? ['EyeStalk_L', 'Eye_L', 'Head'] : ['Head', 'EyeStalk_L', 'Eye_L'];
  if (role === 'eyeR') return y > .72 ? ['EyeStalk_R', 'Eye_R', 'Head'] : ['Head', 'EyeStalk_R', 'Eye_R'];
  if (role === 'feelerL') return ['Head', 'Feelers_L', 'Neck'];
  if (role === 'feelerR') return ['Head', 'Feelers_R', 'Neck'];
  if (role === 'foot' || y < .085) return ['FootRear', 'FootMiddle', 'FootFront', 'MooncapRoot'];
  if (z > .25) return y > .34 ? ['Head', 'Neck', x < 0 ? 'EyeStalk_L' : 'EyeStalk_R'] : ['Neck', 'Head', 'FootFront'];
  if (z < .03 && y > .13) return ['Shell', 'Mantle'];
  if (y > .28 && z > .12) return ['Neck', 'Head', 'FootFront', 'Mantle'];
  return ['Mantle', 'FootMiddle', 'Shell'];
}
const joints = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const jointCoverage = new Uint32Array(ordered.length);
const influenceCounts = [0, 0, 0, 0, 0];
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const role = componentRole.get(find(vertex));
  const names = regionFor(point, role);
  const sigma = role === 'shell' ? .075 : role === 'foot' ? .12 : role?.startsWith('eye') ? .085 : .10;
  const ranked = names.map((name) => ({ name, distance: distSegment(point, segment.get(name)) }))
    .sort((a, b) => a.distance - b.distance);
  const candidates = ranked.map(({ name, distance }) => ({ name, score: Math.exp(-.5 * (distance / sigma) ** 2) }))
    .filter((candidate) => candidate.score > 1e-8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  if (!candidates.length) candidates.push({ name: ranked[0].name, score: 1 });
  if (!candidates.length) throw new Error(`No anatomical weight candidates for vertex ${vertex}`);
  if (role === 'shell') candidates.splice(1);
  const total = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
  influenceCounts[candidates.length]++;
  let assigned = 0;
  for (let slot = 0; slot < candidates.length; slot++) {
    const candidate = candidates[slot], at = vertex * 4 + slot;
    const value = slot === candidates.length - 1 ? 1 - assigned : candidate.score / total;
    joints[at] = jointIndex.get(candidate.name); weights[at] = value; assigned += value;
    if (value > 1e-5) jointCoverage[jointIndex.get(candidate.name)]++;
  }
}

// Replace the unusable Tripo hierarchy and skin; source mesh, UVs and vertex order stay intact.
scene.removeChild(sourceArmature);
sourceArmature.removeChild(meshNode);
const oldSkins = [...root.listSkins()];
meshNode.setSkin(null);
for (const oldSkin of oldSkins) oldSkin.dispose();
const rigContainer = doc.createNode('Mooncap_Snail_Rig');
scene.addChild(rigContainer); rigContainer.addChild(meshNode);
for (const name of orderedNames) {
  const node = nodeByName.get(name), boneParent = byName.get(name).parent;
  (boneParent ? nodeByName.get(boneParent) : rigContainer).addChild(node);
}
const skin = doc.createSkin('Mooncap snail articulated skin').setSkeleton(nodeByName.get('MooncapRoot'));
for (const name of orderedNames) skin.addJoint(nodeByName.get(name));
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setSkin(skin);
const inverseBind = new Float32Array(orderedNames.length * 16);
for (let i = 0; i < orderedNames.length; i++) worldByName.get(orderedNames[i]).clone().invert().toArray(inverseBind, i * 16);
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Mooncap snail native rig and clips');
skin.setInverseBindMatrices(doc.createAccessor('Mooncap_snail_inverse_bind').setType(Accessor.Type.MAT4).setArray(inverseBind).setBuffer(buffer));
primitive.setAttribute('JOINTS_0', doc.createAccessor('Mooncap_snail_joints').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('Mooncap_snail_weights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));

const axisQuat = (axis, angle) => {
  const half = angle / 2, s = Math.sin(half), c = Math.cos(half);
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c];
};
const clips = [];
function addChannel(animation, node, targetPath, times, values, type) {
  const input = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer);
  const output = doc.createAccessor().setType(type).setArray(new Float32Array(values.flat())).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel().setTargetNode(nodeByName.get(node)).setTargetPath(targetPath).setSampler(sampler);
  animation.addSampler(sampler).addChannel(channel);
}
function addClip(name, duration, times, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) addChannel(animation, track.node, track.path ?? 'rotation', times.map((time) => time * duration), track.values, track.type ?? Accessor.Type.VEC4);
  clips.push({ name, duration, animation, tracks });
}
const cycle = [0, .25, .5, .75, 1];
const loop = (axis, amplitude, phase = 0) => cycle.map((time) => axisQuat(axis, amplitude * Math.sin(2 * Math.PI * time + phase)));
addClip('Idle', 3.2, cycle, [
  { node: 'Head', values: loop('x', .018) },
  { node: 'EyeStalk_L', values: loop('z', .035) }, { node: 'EyeStalk_R', values: loop('z', -.035, .45) },
  { node: 'Eye_L', values: loop('x', .025, .6) }, { node: 'Eye_R', values: loop('x', -.02, 1.0) },
  { node: 'Feelers_L', values: loop('z', .045) }, { node: 'Feelers_R', values: loop('z', -.04, .7) },
  { node: 'FootMiddle', values: loop('x', .009) },
]);
for (const [name, duration, swing] of [['Walk', 1.45, .025], ['Run', .92, .04]]) {
  const amp = swing;
  const gait = cycle.map((time) => Math.sin(2 * Math.PI * time));
  addClip(name, duration, cycle, [
    { node: 'FootRear', values: gait.map((value) => axisQuat('x', value * amp * .38)) },
    { node: 'FootMiddle', values: gait.map((value) => axisQuat('x', value * amp * .66)) },
    { node: 'FootFront', values: gait.map((value) => axisQuat('x', value * amp)) },
    { node: 'Neck', values: gait.map((value) => axisQuat('x', -value * amp * .42)) },
    { node: 'Head', values: gait.map((value) => axisQuat('x', value * amp * .55)) },
    { node: 'EyeStalk_L', values: gait.map((value) => axisQuat('z', value * .10)) },
    { node: 'EyeStalk_R', values: gait.map((value) => axisQuat('z', -value * .10)) },
    { node: 'Feelers_L', values: gait.map((value) => axisQuat('z', value * .11)) },
    { node: 'Feelers_R', values: gait.map((value) => axisQuat('z', -value * .11)) },
    { node: 'Mantle', values: gait.map((value) => axisQuat('x', value * amp * .18)) },
  ]);
}
addClip('Attack', .78, [0, .25, .52, 1], [
  { node: 'Neck', values: [0, .06, .11, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'Head', values: [0, .08, .16, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'Feelers_L', values: [0, .04, .09, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'Feelers_R', values: [0, .04, .09, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'EyeStalk_L', values: [0, -.02, .03, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'EyeStalk_R', values: [0, -.02, .03, 0].map((angle) => axisQuat('x', angle)) },
]);
addClip('Hit', .46, [0, .18, .42, 1], [
  { node: 'Neck', values: [0, -.16, .08, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'Head', path: 'translation', type: Accessor.Type.VEC3, values: [[0, .19, .07], [0, .185, .018], [0, .19, .058], [0, .19, .07]] },
  { node: 'EyeStalk_L', values: [0, .18, .10, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'EyeStalk_R', values: [0, .18, .10, 0].map((angle) => axisQuat('x', angle)) },
  { node: 'Mantle', values: [0, .08, -.035, 0].map((angle) => axisQuat('z', angle)) },
  { node: 'Feelers_L', values: [0, .16, .06, 0].map((angle) => axisQuat('z', angle)) },
  { node: 'Feelers_R', values: [0, -.16, -.06, 0].map((angle) => axisQuat('z', angle)) },
]);
addClip('Death', 1.65, [0, .18, .48, .78, 1], [
  { node: 'Head', path: 'translation', type: Accessor.Type.VEC3, values: [[0, .19, .07], [0, .19, .052], [0, .19, .002], [0, .19, -.003], [0, .19, -.003]] },
  { node: 'Neck', values: [0, -.08, -.18, -.2, -.2].map((angle) => axisQuat('x', angle)) },
  { node: 'EyeStalk_L', values: [0, .08, .35, .42, .42].map((angle) => axisQuat('x', angle)) },
  { node: 'EyeStalk_R', values: [0, .08, .35, .42, .42].map((angle) => axisQuat('x', angle)) },
  { node: 'Eye_L', values: [0, .03, -.10, -.12, -.12].map((angle) => axisQuat('x', angle)) },
  { node: 'Eye_R', values: [0, .03, -.10, -.12, -.12].map((angle) => axisQuat('x', angle)) },
  { node: 'FootMiddle', path: 'translation', type: Accessor.Type.VEC3, values: [[0, 0, .335], [0, -.012, .335], [0, -.03, .323], [0, -.035, .317], [0, -.035, .317]] },
  { node: 'FootFront', values: [0, -.06, -.16, -.18, -.18].map((angle) => axisQuat('x', angle)) },
  { node: 'Shell', values: [0, .03, .10, .12, .12].map((angle) => axisQuat('z', angle)) },
  { node: 'Feelers_L', values: [0, .06, .28, .32, .32].map((angle) => axisQuat('z', angle)) },
  { node: 'Feelers_R', values: [0, -.06, -.28, -.32, -.32].map((angle) => axisQuat('z', angle)) },
]);

// Retain image-generated albedo/PBR detail at a 2K runtime size. Albedo is filtered with
// Lanczos; linear packed material data is area averaged; tangent-space normals are
// averaged in vector space and renormalized.
const material = root.listMaterials()[0];
if (!material?.getBaseColorTexture() || !material.getMetallicRoughnessTexture() || !material.getNormalTexture()) throw new Error('Starred snail is missing its base-color or PBR texture map');
const mapRoles = new Map([
  [material.getBaseColorTexture(), 'base-color'],
  [material.getMetallicRoughnessTexture(), 'metallic-roughness'],
  [material.getNormalTexture(), 'normal'],
]);
const textureReport = [];
async function reducePbrMap(encoded, renormalize) {
  const { data, info } = await sharp(encoded).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 4096 || info.height !== 4096 || info.channels !== 3) throw new Error(`Expected a 4096x4096 RGB PBR map, got ${info.width}x${info.height}x${info.channels}`);
  const output = Buffer.alloc(2048 * 2048 * 3);
  for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) {
    const out = (y * 2048 + x) * 3, a = ((y * 2) * 4096 + x * 2) * 3, b = a + 3, c = a + 4096 * 3, d = c + 3;
    let red = (data[a] + data[b] + data[c] + data[d]) / 4;
    let green = (data[a + 1] + data[b + 1] + data[c + 1] + data[d + 1]) / 4;
    let blue = (data[a + 2] + data[b + 2] + data[c + 2] + data[d + 2]) / 4;
    if (renormalize) {
      let nx = red / 127.5 - 1, ny = green / 127.5 - 1, nz = blue / 127.5 - 1;
      const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
      red = (nx + 1) * 127.5; green = (ny + 1) * 127.5; blue = (nz + 1) * 127.5;
    }
    output[out] = Math.round(red); output[out + 1] = Math.round(green); output[out + 2] = Math.round(blue);
  }
  return output;
}
for (const texture of root.listTextures()) {
  const encoded = texture.getImage();
  if (!encoded) continue;
  const original = await sharp(encoded).metadata();
  const role = mapRoles.get(texture);
  if (!role) throw new Error(`Unexpected unclassified source texture ${texture.getName()}`);
  let output, mime;
  if (role === 'base-color') {
    output = await sharp(encoded).resize({ width: 2048, height: 2048, kernel: 'lanczos3' }).jpeg({ quality: 93, mozjpeg: true }).toBuffer();
    mime = 'image/jpeg';
  } else {
    const data = await reducePbrMap(encoded, role === 'normal');
    if (role === 'normal') { output = await sharp(data, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer(); mime = 'image/jpeg'; }
    else { output = await sharp(data, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer(); mime = 'image/png'; }
  }
  texture.setMimeType(mime).setImage(output);
  const after = await sharp(output).metadata();
  textureReport.push({ name: texture.getName(), role, source: `${original.width}x${original.height}`, runtime: `${after.width}x${after.height}`, bytes: output.length, mimeType: mime, sha256: createHash('sha256').update(output).digest('hex') });
}

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidatePath, candidateBytes);
const candidateSha = createHash('sha256').update(candidateBytes).digest('hex');
const check = await io.read(candidatePath), checkRoot = check.getRoot(), checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkPos = checkPrimitive.getAttribute('POSITION')?.getArray(), checkNormal = checkPrimitive.getAttribute('NORMAL')?.getArray();
const checkUv = checkPrimitive.getAttribute('TEXCOORD_0')?.getArray(), checkIndex = checkPrimitive.getIndices()?.getArray();
const checkJoints = checkPrimitive.getAttribute('JOINTS_0')?.getArray(), checkWeights = checkPrimitive.getAttribute('WEIGHTS_0')?.getArray();
const checkSkin = checkRoot.listSkins()[0];
if (checkRoot.listSkins().length !== 1 || !checkPos || !checkNormal || !checkUv || !checkIndex || !checkJoints || !checkWeights || !checkSkin) throw new Error('Candidate is missing geometry, maps, or a skinned rig');
const maximumDelta = (a, b) => { if (a.length !== b.length) return Infinity; let error = 0; for (let i = 0; i < a.length; i++) error = Math.max(error, Math.abs(a[i] - b[i])); return error; };
const positionDelta = maximumDelta(checkPos, positions), normalDelta = maximumDelta(checkNormal, normals), uvDelta = maximumDelta(checkUv, uv);
let indexMismatches = 0, maxWeightError = 0, multiWeightVertices = 0, minNonzeroWeight = 1;
for (let i = 0; i < indices.length; i++) if (checkIndex[i] !== indices[i]) indexMismatches++;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let k = 0; k < 4; k++) {
    const at = vertex * 4 + k, joint = checkJoints[at], weight = checkWeights[at];
    if (!Number.isInteger(joint) || joint < 0 || joint >= orderedNames.length || !Number.isFinite(weight) || weight < 0 || weight > 1.00001) throw new Error(`Invalid skin influence at vertex ${vertex}`);
    if (weight > 1e-6) { sum += weight; active++; minNonzeroWeight = Math.min(minNonzeroWeight, weight); }
  }
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`Weights at vertex ${vertex} sum to ${sum}`);
  maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
  if (active > 1) multiWeightVertices++;
}
if (positionDelta > 1e-7 || normalDelta > 1e-7 || uvDelta > 1e-7 || indexMismatches) throw new Error(`The approved geometry or UVs changed (${positionDelta}, ${normalDelta}, ${uvDelta}, ${indexMismatches})`);
const ibm = checkSkin.getInverseBindMatrices()?.getArray();
if (!ibm || ibm.length !== orderedNames.length * 16 || [...ibm].some((value) => !Number.isFinite(value))) throw new Error('Candidate inverse bind matrices are missing or non-finite');
let bindMaxDelta = 0;
for (let i = 0; i < orderedNames.length; i++) {
  const expected = worldByName.get(orderedNames[i]).clone().invert().toArray([]);
  for (let j = 0; j < 16; j++) bindMaxDelta = Math.max(bindMaxDelta, Math.abs(ibm[i * 16 + j] - expected[j]));
}
if (bindMaxDelta > 1e-6) throw new Error(`Inverse binds do not match the authored rest hierarchy: ${bindMaxDelta}`);
if (checkRoot.listAnimations().map((animation) => animation.getName()).join(',') !== 'Idle,Walk,Run,Attack,Hit,Death') throw new Error('The candidate does not include the six required creature clips');
const nodeByNameCheck = new Map(checkRoot.listNodes().map((node) => [node.getName(), node]));
const jointNodesCheck = checkSkin.listJoints();
const inverseMatrices = jointNodesCheck.map((_, index) => new THREE.Matrix4().fromArray(Array.from(ibm.slice(index * 16, index * 16 + 16))));
const candidateMeshNode = checkRoot.listNodes().find((node) => node.getMesh() === checkRoot.listMeshes()[0]);
if (!candidateMeshNode) throw new Error('Candidate has no mesh node');
const vertexPoints = Array.from({ length: vertexCount }, (_, vertex) => new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]));
function clipPoseAt(animation, time) {
  const pose = new Map();
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler(), times = Array.from(sampler.getInput().getArray()), values = Array.from(sampler.getOutput().getArray());
    const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
    let upper = times.findIndex((key) => key >= time); if (upper < 0) upper = times.length - 1;
    const lower = Math.max(0, upper - (times[upper] === time ? 0 : 1));
    const alpha = upper === lower ? 0 : (time - times[lower]) / (times[upper] - times[lower]);
    const a = values.slice(lower * width, (lower + 1) * width), b = values.slice(upper * width, (upper + 1) * width);
    let value;
    if (channel.getTargetPath() === 'rotation') {
      const qa = new THREE.Quaternion(...a), qb = new THREE.Quaternion(...b).normalize(); qa.slerp(qb, alpha).normalize(); value = [qa.x, qa.y, qa.z, qa.w];
    } else value = a.map((component, index) => component + (b[index] - component) * alpha);
    const targetPose = pose.get(channel.getTargetNode()) ?? {};
    targetPose[channel.getTargetPath()] = value; pose.set(channel.getTargetNode(), targetPose);
  }
  return pose;
}
function sampleSkin(animation, time) {
  const pose = animation ? clipPoseAt(animation, time) : new Map(), world = new Map();
  for (const name of orderedNames) {
    const node = nodeByNameCheck.get(name), edit = pose.get(node) ?? {};
    const translation = new THREE.Vector3(...(edit.translation ?? localByName.get(name)));
    const rotation = new THREE.Quaternion(...(edit.rotation ?? [0, 0, 0, 1]));
    const scale = new THREE.Vector3(...(edit.scale ?? [1, 1, 1]));
    const local = new THREE.Matrix4().compose(translation, rotation, scale), boneParent = byName.get(name).parent;
    world.set(name, boneParent ? world.get(boneParent).clone().multiply(local) : local);
  }
  const meshWorld = new THREE.Matrix4().compose(new THREE.Vector3(...candidateMeshNode.getTranslation()), new THREE.Quaternion(...candidateMeshNode.getRotation()), new THREE.Vector3(...candidateMeshNode.getScale())).invert();
  const skinMatrices = orderedNames.map((name, index) => meshWorld.clone().multiply(world.get(name)).multiply(inverseMatrices[index]));
  let maximumDisplacement = 0, movedVertices = 0, worstVertex = -1;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const sourcePoint = vertexPoints[vertex], point = new THREE.Vector3();
    for (let slot = 0; slot < 4; slot++) {
      const at = vertex * 4 + slot, weight = checkWeights[at];
      if (weight > 0) point.add(sourcePoint.clone().applyMatrix4(skinMatrices[checkJoints[at]]).multiplyScalar(weight));
    }
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`${animation.getName()} produced nonfinite deformation at vertex ${vertex}`);
    const displacement = point.distanceTo(sourcePoint);
    if (displacement > maximumDisplacement) { maximumDisplacement = displacement; worstVertex = vertex; }
    if (displacement > 1e-4) movedVertices++;
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point.getComponent(axis)); max[axis] = Math.max(max[axis], point.getComponent(axis)); }
  }
  return { maximumDisplacement, movedVertices, min, max, worstVertex };
}
const restPose = sampleSkin(null, 0);
if (restPose.maximumDisplacement > 1e-5) throw new Error(`Candidate skin does not preserve the source rest geometry (${restPose.maximumDisplacement})`);
const clipValidation = checkRoot.listAnimations().map((animation) => {
  const duration = Math.max(...animation.listChannels().map((channel) => channel.getSampler().getInput().getArray().at(-1)));
  const samples = [0, .25, .5, .75, 1].map((phase) => ({ phase, ...sampleSkin(animation, duration * phase) }));
  const maximumDisplacement = Math.max(...samples.map((sample) => sample.maximumDisplacement));
  const movedVertices = Math.max(...samples.map((sample) => sample.movedVertices));
  if (!(maximumDisplacement > (animation.getName() === 'Idle' ? .001 : .004)) || movedVertices < 8) throw new Error(`${animation.getName()} does not deform enough geometry (${maximumDisplacement}, ${movedVertices} vertices)`);
  const swept = { min: [0, 1, 2].map((axis) => Math.min(...samples.map((sample) => sample.min[axis]))), max: [0, 1, 2].map((axis) => Math.max(...samples.map((sample) => sample.max[axis]))) };
  if (swept.min[1] < -.08 || swept.max[1] > .98 || Math.abs(swept.min[0]) > .43 || Math.abs(swept.max[0]) > .43 || Math.abs(swept.min[2]) > .72 || Math.abs(swept.max[2]) > .72) throw new Error(`${animation.getName()} has implausible snail bounds: ${JSON.stringify(swept)}`);
  return { name: animation.getName(), duration, channels: animation.listChannels().length, maximumDisplacement, maximumMovedVertices: movedVertices, sweptBounds: swept };
});

const textureReportOnWrite = checkRoot.listTextures().map(async (texture) => {
  const info = await sharp(texture.getImage()).metadata();
  return { name: texture.getName(), dimensions: [info.width, info.height], mime: texture.getMimeType() };
});
const textureDimensions = await Promise.all(textureReportOnWrite);
if (textureDimensions.some((texture) => texture.dimensions[0] !== 2048 || texture.dimensions[1] !== 2048)) throw new Error(`Non-2K runtime map: ${JSON.stringify(textureDimensions)}`);

const boundsSize = bounds.max.map((value, axis) => value - bounds.min[axis]);
const catalog = {
  schema: 'corealm-creature-candidate/1', id: 'creature_mooncap_snail', displayName: 'Mooncap Snail', status: 'awaiting-root-lab-review',
  acceptance: { imageApproved: true, geometryApproved: true, rigAccepted: false, motionAccepted: false, textureAccepted: false, promotable: false, labAccepted: false, worldIntegrated: false },
  source: { file: 'assets/art/tripo/exports/c06d6fe7-0b0a-43f4-9715-ea859450dc4f.glb', sha256: sourceSha, bytes: sourceBytes.length, modelId: 'c06d6fe7-0b0a-43f4-9715-ea859450dc4f', publicProjectId: '69abe6f5-af9d-4617-857d-d2ba60375f54', imageReference: 'assets/art/tripo/refs/fairy-mooncap-snail.png', generator: 'Tripo; model-version metadata is not embedded in the GLB', sourceBaseColor: '8192x8192', sourcePbr: ['4096x4096 packed metallic-roughness', '4096x4096 tangent-space normal'], baseGeometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: true, normalsPreserved: true, indicesPreserved: true, uv: 'TEXCOORD_0 retained without unwrap or retopology' }, originalSkin: '16 Tripo joints discarded: identity-rest bone tree, unusable inverse-bind matrices, and 99.8% of vertices assigned to bone_0.' },
  candidate: { file: path.basename(candidatePath), sha256: candidateSha, bytes: candidateBytes.length, vertices: vertexCount, triangles: triangleCount, bounds, rig: { type: 'authored non-humanoid snail rig', profile: 'Unity Generic-ready glTF skeleton; importer review required', jointNames: orderedNames, jointsCount: orderedNames.length, weighting: 'Island-aware snail anatomy; rigid spiral shell, multi-bone traveling foot, flexible neck, paired stalks and paired lower feelers. Normalized spatially gated weights with no bone_0 fallback.' }, textures: textureReport, clips: clips.map((clip) => ({ name: clip.name, seconds: clip.duration, channels: clip.tracks.length })),
    labTargetAssetId: 'fairy_garden_snail_gloamgarden', notes: ['Starred image and P1 model were approved for the T30 Gloamgarden fairy snail; the model is a grounded, PG-13 fantasy snail with an intact face and a layered blue-lilac, rose and pale-gold shell.', 'The approved source mesh topology, positions, normals, indices and UV atlas remain unchanged. Only the failed Tripo skin and oversized embedded maps were replaced.', 'Runtime base color and PBR maps are 2K. The image-generated shell albedo retains its layered color, gloss and surface detail.', 'Six custom clips animate slow foot-wave locomotion, a quicker scurry, radula strike, recoil and shell-forward retraction.'],
  },
  validation: { positionsMaxDelta: positionDelta, normalsMaxDelta: normalDelta, uvsMaxDelta: uvDelta, indexMismatches, weightMaxSumError: maxWeightError, minimumNonzeroWeight: minNonzeroWeight, verticesWithMultipleInfluences: multiWeightVertices, jointsWithWeights: Array.from(jointCoverage, (value, index) => ({ name: orderedNames[index], vertices: value })), inverseBindMaxDelta: bindMaxDelta, textureDimensions, clips: clipValidation },
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

const productionManifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const current = productionManifest.assets.find((asset) => asset.id === 'fairy_garden_snail_gloamgarden');
if (!current || current.file !== 'models/fairy-garden/fairy_garden_snail_gloamgarden.glb') throw new Error('Expected T30 Gloamgarden snail asset was not found');
const labAsset = {
  id: current.id, file: current.file, pack: current.pack, category: current.category, is: 'Mooncap Snail', tags: ['creature', 'fairy', 'snail', 'gloamgarden', 't30', 'starred', 'skinned', 'articulated'],
  bytes: candidateBytes.length, sha256: candidateSha,
  size: { x: boundsSize[0], y: boundsSize[1], z: boundsSize[2] }, base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: bounds.min[1], triangles: triangleCount,
  animations: clips.map((clip) => clip.name), materials: [material.getName()], walkClipSeconds: 1.45, runClipSeconds: .92, attackSeconds: .78, contactNormalized: .52,
  sourceProvenance: { author: 'Corealm creature rig reconstruction', source: 'Astra-low approved Tripo-starred Fairy Mooncap Snail; original mesh, atlas and layered PBR sources preserved.', modelId: 'c06d6fe7-0b0a-43f4-9715-ea859450dc4f', publicProjectId: '69abe6f5-af9d-4617-857d-d2ba60375f54', sourceSha256: sourceSha, rigMethod: '14-joint articulated snail rig with component-aware shell, foot, neck and eyestalk weights; six custom clips.', candidateFile: path.basename(candidatePath), candidateSha256: candidateSha },
  metadata: { is: 'Mooncap Snail', tags: ['creature', 'fairy', 'snail', 'gloamgarden', 't30', 'starred', 'skinned', 'articulated'], walkClipSeconds: 1.45, runClipSeconds: .92, attackSeconds: .78, contactNormalized: .52, notes: 'T30 Gloamgarden snail with a rigid layered whorl shell, traveling foot, paired eye stalks and preserved 2K image-generated PBR maps.', boneNames: orderedNames },
  acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
};
const labCatalog = { schema: 'corealm-lab-asset-candidates/1', assets: [labAsset], files: { [current.id]: path.basename(candidatePath) } };
const mappedCandidate = path.resolve(here, labCatalog.files[current.id]);
if (path.relative(here, mappedCandidate).startsWith('..') || path.resolve(candidatePath).toLowerCase() !== mappedCandidate.toLowerCase()) throw new Error('Candidate file mapping escapes or disagrees with the selected asset override');
if (labAsset.bytes !== candidateBytes.length || labAsset.sha256 !== createHash('sha256').update(await readFile(mappedCandidate)).digest('hex')) throw new Error('Lab override bytes or digest do not match the candidate GLB');
await writeFile(labCatalogPath, `${JSON.stringify(labCatalog, null, 2)}\n`);
console.log(JSON.stringify({ candidate: path.relative(repo, candidatePath), bytes: candidateBytes.length, sha256: candidateSha, triangles: triangleCount, vertices: vertexCount, joints: orderedNames.length, islands: islandList.map(({ vertices: islandVertices, min, max }) => ({ vertices: islandVertices.length, min, max })), geometry: { positionDelta, normalDelta, uvDelta, indexMismatches }, weightStats: { maxWeightError, minNonzeroWeight, multiWeightVertices, jointsWithWeights: Array.from(jointCoverage, (value, index) => [orderedNames[index], value]) }, textures: textureReport, clips: clipValidation.map(({ name, channels, maximumDisplacement, maximumMovedVertices, sweptBounds }) => ({ name, channels, maximumDisplacement, maximumMovedVertices, sweptBounds })) }, null, 2));
