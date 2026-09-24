import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const sourcePath = path.join(here, 'sources/prehistoric-bird-user-original.glb');
const candidatePath = path.join(here, 'creature_scree_bustard.glb');
const catalogPath = path.join(here, 'catalog.json');
const labCatalogPath = path.join(here, 'lab-catalog.json');
const sourceBytes = await readFile(sourcePath);
const sourceSha = createHash('sha256').update(sourceBytes).digest('hex');
const io = new NodeIO();
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
if (!scene) throw new Error('Scree Bustard source has no scene');
const meshNode = scene.listChildren().find((n) => n.getMesh());
const mesh = meshNode?.getMesh();
const primitive = mesh?.listPrimitives()[0];
if (!meshNode || !mesh || !primitive) throw new Error('Delivered bustard mesh was not found');
if (root.listAnimations().length !== 0) throw new Error('Source unexpectedly includes clips; refusing to overwrite');

const positions = Float32Array.from(primitive.getAttribute('POSITION').getArray());
const normals = Float32Array.from(primitive.getAttribute('NORMAL').getArray());
const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0').getArray());
const indices = Uint32Array.from(primitive.getIndices().getArray());
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (triangleCount !== 4970 || vertexCount !== 7513) throw new Error(`Unexpected approved geometry ${vertexCount} vertices / ${triangleCount} triangles`);
const geometryBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
  geometryBounds.min[k] = Math.min(geometryBounds.min[k], positions[i + k]);
  geometryBounds.max[k] = Math.max(geometryBounds.max[k], positions[i + k]);
}
const geometrySize = geometryBounds.max.map((v, i) => v - geometryBounds.min[i]);

const rig = [
  ['BustardRoot', null, [0, 0, 0]],
  ['Pelvis', 'BustardRoot', [0, .43, 0]],
  ['Spine', 'Pelvis', [0, .50, .01]],
  ['Chest', 'Spine', [0, .57, .05]],
  ['Neck', 'Chest', [0, .69, .22]],
  ['Head', 'Neck', [0, .81, .34]],
  ['Beak', 'Head', [0, .825, .435]],
  ['Tail', 'Pelvis', [0, .49, -.30]],
  ['Wing_L', 'Chest', [-.12, .54, -.06]],
  ['WingTip_L', 'Wing_L', [-.235, .50, -.20]],
  ['Wing_R', 'Chest', [.12, .54, -.06]],
  ['WingTip_R', 'Wing_R', [.235, .50, -.20]],
  ['Thigh_L', 'Pelvis', [-.105, .28, .02]],
  ['Hock_L', 'Thigh_L', [-.108, .11, .055]],
  ['Foot_L', 'Hock_L', [-.11, .045, .12]],
  ['Toe_L', 'Foot_L', [-.11, .03, .22]],
  ['RearToe_L', 'Foot_L', [-.11, .02, .04]],
  ['Thigh_R', 'Pelvis', [.105, .28, .02]],
  ['Hock_R', 'Thigh_R', [.108, .11, .055]],
  ['Foot_R', 'Hock_R', [.11, .045, .12]],
  ['Toe_R', 'Foot_R', [.11, .03, .22]],
  ['RearToe_R', 'Foot_R', [.11, .02, .04]],
];
const jointNames = rig.map(([name]) => name);
const jointIndex = new Map(jointNames.map((name, i) => [name, i]));
const byName = new Map(rig.map(([name, parent, global]) => [name, { name, parent, global }]));
const children = new Map(rig.map(([name]) => [name, []]));
for (const [name, parent] of rig) if (parent) children.get(parent).push(name);
const nodeByName = new Map();
const globalByName = new Map();
const localByName = new Map();
const ordered = [];
function visit(name) {
  const def = byName.get(name), parent = def.parent ? byName.get(def.parent) : null;
  const local = parent ? def.global.map((v, i) => v - parent.global[i]) : [...def.global];
  localByName.set(name, local);
  const node = doc.createNode(name).setTranslation(local).setRotation([0, 0, 0, 1]);
  nodeByName.set(name, node);
  ordered.push(name);
  for (const child of children.get(name)) visit(child);
}
visit('BustardRoot');

// Rebuild only the corrupt rig. The approved static geometry and UVs stay byte-for-byte equivalent.
scene.removeChild(meshNode);
const oldSkins = [...root.listSkins()];
meshNode.setSkin(null);
for (const skin of oldSkins) skin.dispose();
const rigContainer = doc.createNode('Bustard_native_rig');
scene.addChild(rigContainer);
rigContainer.addChild(meshNode);
const newSkin = doc.createSkin('Scree bustard groundbird skin');
const jointNodes = ordered.map((name) => nodeByName.get(name));
for (const name of ordered) {
  const node = nodeByName.get(name), parent = byName.get(name).parent;
  (parent ? nodeByName.get(parent) : rigContainer).addChild(node);
}
newSkin.setSkeleton(nodeByName.get('BustardRoot'));
for (const node of jointNodes) newSkin.addJoint(node);
meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setSkin(newSkin);

// The source joints were all identity, so there is no recoverable rest pose to reuse.
// This model-specific joint layout follows the approved bird's long +Z axis, high head,
// swept-back tail, lateral folded wings, and low bilateral runner legs.
const worldMatrices = new Map();
for (const name of ordered) {
  const local = new THREE.Matrix4().makeTranslation(...localByName.get(name));
  const parent = byName.get(name).parent;
  worldMatrices.set(name, parent ? worldMatrices.get(parent).clone().multiply(local) : local);
  globalByName.set(name, new THREE.Vector3(...byName.get(name).global));
}
const inverseBind = new Float32Array(16 * ordered.length);
for (let i = 0; i < ordered.length; i++) {
  const matrix = worldMatrices.get(ordered[i]).clone().invert();
  matrix.toArray(inverseBind, 16 * i);
}
const buffer = root.listBuffers()[0] ?? doc.createBuffer('Scree Bustard native rig and clips');
newSkin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(inverseBind).setBuffer(buffer));

const boneSegment = new Map();
for (const [name, parent] of rig) {
  boneSegment.set(name, parent ? [byName.get(parent).global, byName.get(name).global] : [byName.get(name).global, byName.get(name).global]);
}
function distanceToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const den = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = den > 1e-10 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / den)) : 0;
  return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t));
}
function chooseRegion(p) {
  const [x, y, z] = p, side = x < 0 ? 'L' : 'R';
  if (y < .205 || (y < .29 && Math.abs(x) > .065 && z > -.015)) {
    return { bones: ['Pelvis', `Thigh_${side}`, `Hock_${side}`, `Foot_${side}`, `Toe_${side}`, `RearToe_${side}`], sigma: .055 };
  }
  if (y > .73 && z > .20) return { bones: ['Chest', 'Neck', 'Head', 'Beak'], sigma: .075 };
  if (y > .60 && z > .14) return { bones: ['Chest', 'Neck', 'Head'], sigma: .095 };
  if (z < -.31 && y > .27) return { bones: ['Pelvis', 'Spine', 'Tail'], sigma: .11 };
  if (Math.abs(x) > .115 && y > .34 && y < .79 && z > -.34 && z < .27) {
    return { bones: ['Spine', 'Chest', `Wing_${side}`, `WingTip_${side}`], sigma: .075 };
  }
  return { bones: ['Pelvis', 'Spine', 'Chest'], sigma: .12 };
}
const joints = new Uint16Array(vertexCount * 4);
const weights = new Float32Array(vertexCount * 4);
const jointCoverage = new Array(ordered.length).fill(0);
const influenceCount = [0, 0, 0, 0, 0];
for (let v = 0; v < vertexCount; v++) {
  const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], region = chooseRegion(p), sigma2 = 2 * region.sigma ** 2;
  const raw = region.bones.map((name) => {
    const d = distanceToSegment(p, ...boneSegment.get(name));
    return { name, value: Math.exp(-(d * d) / sigma2) };
  }).sort((a, b) => b.value - a.value).slice(0, 4);
  let sum = raw.reduce((a, b) => a + b.value, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw new Error(`No valid weights at vertex ${v}`);
  for (let k = 0; k < raw.length; k++) {
    const idx = jointIndex.get(raw[k].name), weight = raw[k].value / sum;
    joints[v * 4 + k] = idx;
    weights[v * 4 + k] = weight;
    if (weight > 1e-5) jointCoverage[idx]++;
  }
  influenceCount[raw.length]++;
}
primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
const motionReport = [];

function smooth(a, b, t) { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); }
function pulse(t, a, b, c, d) { return smooth(a, b, t) * (1 - smooth(c, d, t)); }
function poseFor(clip, t) {
  const p = new Map(), r = new Map();
  const trans = (name, x = 0, y = 0, z = 0) => p.set(name, [x, y, z]);
  const rot = (name, x = 0, y = 0, z = 0) => r.set(name, [x, y, z]);
  const s = Math.max(0, Math.min(1, t / clip.duration));
  if (clip.name === 'Idle') {
    const phase = 2 * Math.PI * s;
    trans('Pelvis', 0, .005 * Math.sin(phase), 0);
    rot('Chest', .012 * Math.sin(phase), 0, .006 * Math.sin(phase + .3));
    rot('Neck', -.018 * Math.sin(phase), .035 * Math.sin(phase), 0);
    rot('Head', .025 * Math.sin(phase + .5), -.055 * Math.sin(phase), 0);
    rot('Tail', .018 * Math.sin(phase), .045 * Math.sin(phase), 0);
    rot('Wing_L', 0, 0, -.012 * Math.sin(phase));
    rot('Wing_R', 0, 0, .012 * Math.sin(phase));
  } else if (clip.name === 'Walk' || clip.name === 'Run') {
    const fast = clip.name === 'Run', phase = 2 * Math.PI * s, stride = fast ? .57 : .39, flex = fast ? .72 : .48;
    trans('Pelvis', 0, (fast ? .018 : .009) * (1 - Math.cos(phase * 2)), 0);
    rot('Chest', .018 * Math.sin(phase * 2), 0, .015 * Math.sin(phase));
    rot('Neck', -.04 * Math.sin(phase), 0, 0);
    rot('Head', .03 * Math.sin(phase), .025 * Math.sin(phase), 0);
    rot('Tail', -.035 * Math.sin(phase), .08 * Math.sin(phase), 0);
    for (const [side, offset] of [['L', 0], ['R', Math.PI]]) {
      const leg = phase + offset, swing = Math.max(0, Math.sin(leg));
      rot(`Thigh_${side}`, stride * Math.sin(leg), 0, 0);
      rot(`Hock_${side}`, flex * swing, 0, 0);
      rot(`Foot_${side}`, -stride * Math.sin(leg) - flex * swing, 0, 0);
      rot(`Toe_${side}`, .035 * swing, 0, 0);
      rot(`RearToe_${side}`, .02 * swing, 0, 0);
      rot(`Wing_${side}`, 0, 0, (side === 'L' ? -1 : 1) * (fast ? .095 : .045) * Math.sin(phase + offset));
      rot(`WingTip_${side}`, 0, 0, (side === 'L' ? 1 : -1) * (fast ? .06 : .03) * Math.sin(phase + offset));
    }
  } else if (clip.name === 'Attack') {
    const crouch = pulse(s, .04, .18, .42, .62), jab = pulse(s, .25, .37, .46, .57), recover = smooth(.47, .90, s);
    trans('Pelvis', 0, -.008 * crouch, 0);
    rot('Chest', .14 * crouch + .18 * jab, 0, 0);
    rot('Neck', .16 * crouch + .65 * jab, 0, 0);
    rot('Head', .22 * crouch + .72 * jab, 0, 0);
    rot('Beak', .11 * jab, 0, 0);
    rot('Tail', -.08 * crouch, 0, 0);
    for (const side of ['L', 'R']) {
      rot(`Wing_${side}`, .02 * jab, 0, (side === 'L' ? -1 : 1) * (.10 * crouch + .31 * jab));
      rot(`WingTip_${side}`, 0, 0, (side === 'L' ? 1 : -1) * .12 * jab);
    }
    // Both feet stay planted while the long neck drives the peck.
  } else if (clip.name === 'Hit') {
    const recoil = pulse(s, .0, .09, .22, .52);
    trans('Pelvis', 0, .018 * recoil, -.045 * recoil);
    rot('Chest', -.10 * recoil, 0, .04 * recoil);
    rot('Neck', -.20 * recoil, 0, 0); rot('Head', -.12 * recoil, 0, 0);
    rot('Tail', .08 * recoil, 0, -.10 * recoil);
    rot('Wing_L', 0, 0, -.22 * recoil); rot('Wing_R', 0, 0, .22 * recoil);
    rot('WingTip_L', 0, 0, .12 * recoil); rot('WingTip_R', 0, 0, -.12 * recoil);
    rot('Thigh_L', .10 * recoil, 0, 0); rot('Thigh_R', .10 * recoil, 0, 0);
  } else if (clip.name === 'Death') {
    const flinch = pulse(s, 0, .08, .20, .34), collapse = smooth(.18, .72, s), settle = smooth(.72, 1, s);
    trans('Pelvis', 0, -.085 * collapse + .08 * pulse(s, .35, .48, .55, .70), -.025 * collapse);
    rot('Pelvis', 0, 0, 1.43 * collapse);
    rot('Spine', .06 * collapse, 0, .10 * collapse);
    rot('Chest', .08 * collapse, 0, .06 * collapse);
    rot('Neck', -.22 * flinch + .32 * collapse, .08 * collapse, .24 * collapse);
    rot('Head', -.20 * flinch + .44 * collapse, -.12 * collapse, .18 * collapse);
    rot('Tail', .22 * collapse, -.10 * collapse, .10 * collapse);
    rot('Wing_L', 0, 0, -.45 * collapse); rot('Wing_R', 0, 0, .45 * collapse);
    rot('WingTip_L', 0, 0, .22 * collapse); rot('WingTip_R', 0, 0, -.22 * collapse);
    rot('Thigh_L', -.24 * collapse, 0, -.20 * collapse); rot('Thigh_R', -.18 * collapse, 0, .20 * collapse);
    rot('Hock_L', .55 * collapse, 0, 0); rot('Hock_R', .44 * collapse, 0, 0);
    rot('Foot_L', -.20 * collapse, 0, 0); rot('Foot_R', -.18 * collapse, 0, 0);
    rot('Toe_L', .05 * settle, 0, 0); rot('Toe_R', .04 * settle, 0, 0);
  }
  return { p, r };
}
const clips = [
  { name: 'Idle', duration: 2.0, samples: 49, loop: true },
  { name: 'Walk', duration: 1.1, samples: 34, loop: true },
  { name: 'Run', duration: .72, samples: 34, loop: true },
  { name: 'Attack', duration: .82, samples: 37, loop: false },
  { name: 'Hit', duration: .52, samples: 25, loop: false },
  { name: 'Death', duration: 1.55, samples: 48, loop: false },
];
for (const clip of clips) {
  const animation = doc.createAnimation(clip.name), times = Float32Array.from({ length: clip.samples }, (_, i) => clip.duration * i / (clip.samples - 1));
  for (const [name] of rig) {
    const rotations = new Float32Array(clip.samples * 4), translations = new Float32Array(clip.samples * 3);
    let hasR = false, hasT = false;
    const baseT = localByName.get(name);
    for (let i = 0; i < clip.samples; i++) {
      const frame = poseFor(clip, times[i]);
      const r = frame.r.get(name) ?? [0, 0, 0], d = frame.p.get(name) ?? [0, 0, 0];
      if (r.some((v) => Math.abs(v) > 1e-7)) hasR = true;
      if (d.some((v) => Math.abs(v) > 1e-7)) hasT = true;
      new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ')).toArray(rotations, i * 4);
      for (let k = 0; k < 3; k++) translations[i * 3 + k] = baseT[k] + d[k];
    }
    const makeChannel = (pathName, type, values) => {
      const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
      const output = doc.createAccessor().setType(type).setArray(values).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodeByName.get(name)).setTargetPath(pathName).setSampler(sampler));
    };
    if (hasR) makeChannel('rotation', 'VEC4', rotations);
    if (hasT) makeChannel('translation', 'VEC3', translations);
  }
  motionReport.push({ name: clip.name, seconds: clip.duration, samples: clip.samples, loop: clip.loop });
}

// Keep the approved source maps while reducing the runtime candidate to the project's 2K creature texture target.
const textureReport = [];
const textureRoles = new Map();
for (const material of root.listMaterials()) {
  for (const [role, texture] of [
    ['base-color', material.getBaseColorTexture()],
    ['metallic-roughness', material.getMetallicRoughnessTexture()],
    ['normal', material.getNormalTexture()],
    ['occlusion', material.getOcclusionTexture()],
    ['emissive', material.getEmissiveTexture()],
  ]) if (texture) textureRoles.set(texture, role);
}
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  if (!image?.byteLength) continue;
  const originalInfo = await sharp(image).metadata();
  const role = textureRoles.get(texture) ?? 'base-color';
  if (originalInfo.width !== 2048 || originalInfo.height !== 2048) throw new Error(`Expected native 2K map: ${texture.getName()}`);
  const output = image;
  const mimeType = texture.getMimeType();
  const after = await sharp(output).metadata();
  textureReport.push({ name: texture.getName(), role, from: `${originalInfo.width}x${originalInfo.height}`, runtime: `${after.width}x${after.height}`, bytes: output.length, mimeType });
}

await io.write(candidatePath, doc);
const candidateBytes = await readFile(candidatePath);
const outDoc = await io.read(candidatePath), outRoot = outDoc.getRoot();
const outMeshNode = outRoot.listNodes().find((n) => n.getMesh());
const outPrimitive = outMeshNode?.getMesh()?.listPrimitives()[0];
if (!outPrimitive) throw new Error('Candidate has no mesh primitive');
const outPosition = outPrimitive.getAttribute('POSITION').getArray();
const outNormal = outPrimitive.getAttribute('NORMAL').getArray();
const outUV = outPrimitive.getAttribute('TEXCOORD_0').getArray();
const outIndex = outPrimitive.getIndices().getArray();
function sameArray(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
if (!sameArray(positions, outPosition) || !sameArray(normals, outNormal) || !sameArray(uvs, outUV) || !sameArray(indices, outIndex)) throw new Error('Candidate changed approved source geometry, normals, UVs, or index order');
const outSkin = outMeshNode.getSkin();
if (outRoot.listSkins().length !== 1) throw new Error(`Candidate has ${outRoot.listSkins().length} skins; expected the rebuilt native skin only`);
if (!outSkin || outSkin.listJoints().length !== ordered.length) throw new Error('Candidate skin joint list is incomplete');
const outIBM = outSkin.getInverseBindMatrices()?.getArray();
if (!outIBM || outIBM.length !== 16 * ordered.length || [...outIBM].some((x) => !Number.isFinite(x))) throw new Error('Invalid candidate inverse-bind matrices');
for (let i = 0; i < ordered.length; i++) {
  const determinant = new THREE.Matrix4().fromArray(outIBM, 16 * i).determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < .5 || Math.abs(determinant) > 2) throw new Error(`Non-invertible inverse bind for ${ordered[i]}: det=${determinant}`);
}
const bindDeterminants = Array.from({ length: outIBM.length / 16 }, (_, i) => new THREE.Matrix4().fromArray(outIBM, 16 * i).determinant());
const bindDeterminantRange = [Math.min(...bindDeterminants), Math.max(...bindDeterminants)];
const outJoints = outPrimitive.getAttribute('JOINTS_0').getArray(), outWeights = outPrimitive.getAttribute('WEIGHTS_0').getArray();
if (outJoints.length !== vertexCount * 4 || outWeights.length !== vertexCount * 4) throw new Error('Candidate weights/accessors have wrong vertex count');
let maxWeightError = 0, distributedVertices = 0;
for (let v = 0; v < vertexCount; v++) {
  let sum = 0, used = 0;
  for (let k = 0; k < 4; k++) {
    const at = v * 4 + k, w = outWeights[at], j = outJoints[at];
    if (!Number.isFinite(w) || w < -1e-7 || j >= ordered.length) throw new Error(`Invalid influence at vertex ${v}`);
    if (w > 1e-5) { sum += w; used++; }
  }
  maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
  if (used > 1) distributedVertices++;
  if (Math.abs(sum - 1) > 2e-5) throw new Error(`Weights at vertex ${v} sum to ${sum}`);
}
if (distributedVertices < vertexCount * .35) throw new Error(`Too few vertices have distributed weights: ${distributedVertices}/${vertexCount}`);
if (jointCoverage.some((n, i) => ordered[i] !== 'BustardRoot' && n < 4)) throw new Error(`Unused/underused joint influences ${jointCoverage.map((n,i)=>ordered[i] !== 'BustardRoot' && n<4?`${ordered[i]}:${n}`:null).filter(Boolean).join(', ')}`);

const clipNames = outRoot.listAnimations().map((a) => a.getName()).sort();
if (JSON.stringify(clipNames) !== JSON.stringify(['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk'])) throw new Error(`Unexpected clips: ${clipNames.join(', ')}`);
const material = outPrimitive.getMaterial();
const materialMapCheck = {
  baseColor: Boolean(material?.getBaseColorTexture()),
  metallicRoughness: Boolean(material?.getMetallicRoughnessTexture()),
  normal: Boolean(material?.getNormalTexture()),
};
if (Object.values(materialMapCheck).some((v) => !v)) throw new Error(`Candidate lost a source PBR map: ${JSON.stringify(materialMapCheck)}`);
const sourceTextureHashes = new Map((await io.read(sourcePath)).getRoot().listTextures().map(t => [t.getName(), createHash('sha256').update(t.getImage()).digest('hex')]));
for (const texture of outRoot.listTextures()) {
  const original = sourceTextureHashes.get(texture.getName());
  const actual = createHash('sha256').update(texture.getImage()).digest('hex');
  if (!original || original !== actual) throw new Error(`Native PBR texture bytes changed: ${texture.getName()}`);
}
const animatedBoneNames = new Set();
const clipChannelValidation = [];
for (const animation of outRoot.listAnimations()) {
  let channelCount = 0, endTime = 0;
  for (const channel of animation.listChannels()) {
    channelCount++;
    const target = channel.getTargetNode(), pathName = channel.getTargetPath(), sampler = channel.getSampler();
    if (!target || !jointNames.includes(target.getName()) || !['rotation', 'translation'].includes(pathName)) throw new Error(`${animation.getName()} has invalid target ${target?.getName()} / ${pathName}`);
    animatedBoneNames.add(target.getName());
    const input = sampler.getInput()?.getArray(), output = sampler.getOutput()?.getArray();
    if (!input?.length || !output?.length || [...input, ...output].some((x) => !Number.isFinite(x))) throw new Error(`${animation.getName()} has a missing or non-finite sampler`);
    const expectedDuration = clips.find((c) => c.name === animation.getName()).duration;
    if (input[0] !== 0 || Math.abs(input[input.length - 1] - expectedDuration) > 1e-4) throw new Error(`${animation.getName()} sampler times do not span the clip`);
    for (let i = 1; i < input.length; i++) if (input[i] <= input[i - 1]) throw new Error(`${animation.getName()} sampler time is not strictly increasing`);
    const expectedWidth = pathName === 'rotation' ? 4 : 3;
    if (output.length !== input.length * expectedWidth) throw new Error(`${animation.getName()} ${pathName} output width does not match its key count`);
    if (['Idle', 'Walk', 'Run'].includes(animation.getName())) {
      const first = output.slice(0, expectedWidth), last = output.slice(output.length - expectedWidth);
      if (Math.max(...Array.from(first, (v, i) => Math.abs(v - last[i]))) > 2e-5) throw new Error(`${animation.getName()} loop is not sealed at ${target.getName()}.${pathName}`);
    }
    endTime = Math.max(endTime, input[input.length - 1]);
  }
  if (channelCount < 3) throw new Error(`${animation.getName()} contains too few animated channels`);
  clipChannelValidation.push({ name: animation.getName(), channels: channelCount, duration: endTime, targetBones: [...new Set(animation.listChannels().map((c) => c.getTargetNode().getName()))] });
}
if (jointNames.filter((name) => name !== 'BustardRoot' && !animatedBoneNames.has(name)).length) throw new Error(`Unanimated joints: ${jointNames.filter((name) => name !== 'BustardRoot' && !animatedBoneNames.has(name)).join(', ')}`);
const childrenByNode = new Map();
for (const [name, parent] of rig) if (parent) childrenByNode.set(name, parent);
function buildPoseObjects() {
  const obj = new Map();
  for (const name of ordered) {
    const o = new THREE.Object3D(); o.name = name; o.position.fromArray(localByName.get(name));
    const parent = byName.get(name).parent;
    if (parent) obj.get(parent).add(o);
    else obj.set(name, o);
    obj.set(name, o);
  }
  const sceneRoot = obj.get('BustardRoot'); sceneRoot.updateMatrixWorld(true);
  return obj;
}
const poseObjects = buildPoseObjects();
const invMatrices = ordered.map((name) => worldMatrices.get(name).clone().invert());
function skinAt(clip, time) {
  const frame = poseFor(clip, time);
  for (const name of ordered) {
    const o = poseObjects.get(name); o.position.fromArray(localByName.get(name));
    const d = frame.p.get(name); if (d) o.position.add(new THREE.Vector3(...d));
    const e = frame.r.get(name); o.quaternion.setFromEuler(new THREE.Euler(...(e ?? [0, 0, 0]), 'XYZ'));
  }
  poseObjects.get('BustardRoot').updateMatrixWorld(true);
  const skinMatrices = ordered.map((name, i) => poseObjects.get(name).matrixWorld.clone().multiply(invMatrices[i]));
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], sumSquared = 0;
  for (let v = 0; v < vertexCount; v++) {
    const src = new THREE.Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const p = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      const at = v * 4 + k, w = outWeights[at]; if (w <= 0) continue;
      p.add(src.clone().applyMatrix4(skinMatrices[outJoints[at]]).multiplyScalar(w));
    }
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error(`${clip.name} produced non-finite point at ${v}, t=${time}`);
    const q = [p.x, p.y, p.z];
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
    sumSquared += (p.x - src.x) ** 2 + (p.y - src.y) ** 2 + (p.z - src.z) ** 2;
  }
  return { min, max, rmsDisplacement: Math.sqrt(sumSquared / vertexCount) };
}
const sampledClipReport = [];
for (const clip of clips) {
  const samples = [];
  for (const at of [0, .25, .5, .75, 1]) samples.push({ at, ...skinAt(clip, clip.duration * at) });
  const worstLow = Math.min(...samples.map((s) => s.min[1])), worstHigh = Math.max(...samples.map((s) => s.max[1]));
  const worstSpan = Math.max(...samples.map((s) => Math.max(...s.max.map((v, i) => v - s.min[i]))));
  if (worstLow < -.04 || worstHigh > 1.3 || worstSpan > 1.4) throw new Error(`${clip.name} escaped plausible bird bounds: y ${worstLow}..${worstHigh}; max span ${worstSpan}`);
  if (clip.name !== 'Idle' && Math.max(...samples.map((s) => s.rmsDisplacement)) < .006) throw new Error(`${clip.name} does not visibly deform the mesh`);
  sampledClipReport.push({ name: clip.name, worstBounds: { minY: worstLow, maxY: worstHigh, maxAxisSpan: worstSpan }, maximumRmsDisplacement: Math.max(...samples.map((s) => s.rmsDisplacement)), samples });
}

function jointAt(clip, fraction, name) {
  skinAt(clip, clip.duration * fraction);
  return poseObjects.get(name).getWorldPosition(new THREE.Vector3()).toArray();
}
const walk = clips.find(c => c.name === 'Walk');
const run = clips.find(c => c.name === 'Run');
const attack = clips.find(c => c.name === 'Attack');
const death = clips.find(c => c.name === 'Death');
const stride = (clip) => ({
  leftAtQuarter: jointAt(clip, .25, 'Foot_L'), rightAtQuarter: jointAt(clip, .25, 'Foot_R'),
  leftAtThreeQuarter: jointAt(clip, .75, 'Foot_L'), rightAtThreeQuarter: jointAt(clip, .75, 'Foot_R'),
});
const attackRest = { head: jointAt(attack, 0, 'Head'), feet: [jointAt(attack, 0, 'Foot_L'), jointAt(attack, 0, 'Foot_R')] };
const attackPeak = { head: jointAt(attack, .41, 'Head'), feet: [jointAt(attack, .41, 'Foot_L'), jointAt(attack, .41, 'Foot_R')] };
const footTravel = Math.max(...attackRest.feet.map((p, i) => Math.hypot(...p.map((v, axis) => v - attackPeak.feet[i][axis]))));
if (footTravel > .025) throw new Error(`Attack feet unplanted: ${footTravel}`);
const cpuProof = {
  sourceSha256: sourceSha,
  candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
  walk: stride(walk), run: stride(run),
  attack: { duration: attack.duration, contactNormalized: .46, contactSeconds: attack.duration * .46, rest: attackRest, peak: attackPeak, maximumFootTravel: footTravel, headTravel: Math.hypot(...attackRest.head.map((v, axis) => v - attackPeak.head[axis])) },
  death: { finalBounds: sampledClipReport.find(r => r.name === 'Death').samples.at(-1), fullSizeScaleChannels: false },
};
if (cpuProof.attack.headTravel < .05) throw new Error('Peck has insufficient head travel');
await mkdir(path.join(repo, 'test-results/creature-audit/user-bustard'), { recursive: true });
await writeFile(path.join(repo, 'test-results/creature-audit/user-bustard/cpu-proof.json'), `${JSON.stringify(cpuProof, null, 2)}\n`);

const catalog = {
  schema: 'corealm-creature-candidate/1',
  id: 'creature_scree_bustard',
  displayName: 'Scree Bustard',
  status: 'awaiting-root-visual-and-lab-review',
  acceptance: { imageApproved: false, geometryApproved: false, rigAccepted: false, motionAccepted: false, textureAccepted: false, promotable: false, labAccepted: false, worldIntegrated: false },
  source: {
    file: 'assets/art/tripo/imports/creatures/audit-user-bustard/sources/prehistoric-bird-user-original.glb',
    sha256: sourceSha,
    bytes: sourceBytes.length,
    suppliedBy: 'user',
    baseGeometry: { vertices: vertexCount, triangles: triangleCount, positionsPreserved: true, normalsPreserved: true, uv: 'TEXCOORD_0 retained without unwrap or retopology', indicesPreserved: true },
    sourceTextures: { baseColor: '2048x2048 JPEG', metallicRoughness: '2048x2048 PNG', normal: '2048x2048 JPEG', preservedWithoutReencoding: true },
  },
  candidate: {
    file: path.basename(candidatePath),
    sha256: createHash('sha256').update(candidateBytes).digest('hex'),
    bytes: candidateBytes.length,
    triangles: triangleCount,
    vertices: vertexCount,
    rig: { profile: 'Unity Generic-ready named non-humanoid glTF groundbird skin; importer review required', type: 'authored model-specific skeleton', joints: ordered, jointsCount: ordered.length, parentHierarchy: Object.fromEntries(rig.map(([n, p]) => [n, p])), weighting: 'Four-nearest anatomical segment weighting, regional masks for head/beak, wings, tail, and bilateral leg/foot/toe chains; normalized per vertex.' },
    rigValidation: { inverseBindCount: outIBM.length / 16, inverseBindDeterminantRange: bindDeterminantRange, maximumWeightSumError: maxWeightError, distributedVertices, vertices: vertexCount, activeJointVertexCounts: Object.fromEntries(ordered.map((n, i) => [n, jointCoverage[i]])), influenceCountByNonzeroWeights: influenceCount.slice(1), materialMapCheck },
    textures: textureReport,
    clips: motionReport.map((clip) => ({ ...clip, channelValidation: clipChannelValidation.find((v) => v.name === clip.name) })),
    sampledDeformation: sampledClipReport,
    cpuProof,
    notes: [
      'User-supplied static source geometry, topology, UV atlas and native 2K plumage/PBR map bytes are preserved. A new bird-specific skin and clips were authored because the source has no rig or animations.',
      'Scree Bustard is a stocky Scree groundbird. Its rig uses a neck/head/beak chain, tail, bilateral folded wings, thighs, hocks, feet, front toes and rear toes.',
      'Unity Humanoid is not suitable for this nonhumanoid creature; the candidate uses a named generic skinned rig suitable for a Unity Generic Animator after importer review.',
      'Root must inspect normal-camera Idle, Walk, Run, Attack, Hit and Death before any promotion. No production binding was changed by this candidate task.',
    ],
  },
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

// Existing-ID override catalog for the persistent production-backed lab.
const productionManifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const currentBird = productionManifest.assets.find((entry) => entry.id === 'creature_scree_bustard');
if (!currentBird || currentBird.file !== 'models/creature/creature_scree_bustard.glb') throw new Error('Expected Scree Bustard lab override target/path was not found');
const {
  measuredGait: _retiredGait,
  impliedWalkMps: _retiredWalkSpeed,
  impliedRunMps: _retiredRunSpeed,
  ...entryWithoutStaleGait
} = currentBird;
const labEntry = {
  ...entryWithoutStaleGait,
  id: 'creature_scree_bustard',
  file: currentBird.file,
  is: 'Scree Bustard',
  tags: ['creature', 'ground', 'bird', 'field', 'scree-bustard', 'skinned', 'articulated', 'plumage'],
  bytes: candidateBytes.length,
  sha256: createHash('sha256').update(candidateBytes).digest('hex'),
  size: { x: geometrySize[0], y: geometrySize[1], z: geometrySize[2] },
  base: { x: geometryBounds.min[0], y: geometryBounds.min[1], z: geometryBounds.min[2] },
  bounds: geometryBounds,
  groundY: geometryBounds.min[1],
  triangles: triangleCount,
  animations: clips.map((clip) => clip.name),
  materials: [material.getName()],
  walkClipSeconds: clips.find((clip) => clip.name === 'Walk').duration,
  runClipSeconds: clips.find((clip) => clip.name === 'Run').duration,
  attackSeconds: clips.find((clip) => clip.name === 'Attack').duration,
  contactNormalized: .46,
  sourceProvenance: {
    author: 'Corealm candidate rig reconstruction',
    source: 'User-supplied Tripo static groundbird; original geometry, UVs and native 2K PBR map bytes preserved.',
    sourceFile: 'assets/art/tripo/imports/creatures/audit-user-bustard/sources/prehistoric-bird-user-original.glb',
    sourceSha256: sourceSha,
    rigMethod: '22-joint authored non-humanoid groundbird skeleton with model-specific normalized weights and six authored clips.',
    candidateFile: path.basename(candidatePath),
    candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
  },
  metadata: {
    is: 'Scree Bustard',
    tags: ['creature', 'ground', 'bird', 'field', 'scree-bustard', 'skinned', 'articulated', 'plumage'],
    provenance: {
      sourceSha256: sourceSha,
      candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
    },
    walkClipSeconds: clips.find((clip) => clip.name === 'Walk').duration,
    runClipSeconds: clips.find((clip) => clip.name === 'Run').duration,
    attackSeconds: clips.find((clip) => clip.name === 'Attack').duration,
    contactNormalized: .46,
    notes: 'Stocky Scree groundbird. Uses a named 22-joint non-humanoid rig, layered 2K base color and PBR maps, and six authored clips. Candidate visuals and gameplay remain unaccepted.',
    boneNames: ordered,
  },
  acceptance: { assetAudit: false, labAccepted: false, worldIntegrated: false },
};
const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  assets: [labEntry],
  files: { [labEntry.id]: path.basename(candidatePath) },
};
const mappedCandidate = path.resolve(here, labCatalog.files[labEntry.id]);
if (path.relative(here, mappedCandidate).startsWith('..') || !sameFile(candidatePath, mappedCandidate)) throw new Error('Lab catalog candidate file mapping escapes or disagrees with candidate');
if (labCatalog.assets.length !== 1 || labEntry.id !== 'creature_scree_bustard' || labEntry.file !== currentBird.file) throw new Error('Lab catalog does not replace only the expected existing bird asset/path');
if (labEntry.bytes !== candidateBytes.length || labEntry.sha256 !== createHash('sha256').update(await readFile(mappedCandidate)).digest('hex')) throw new Error('Lab catalog candidate bytes/SHA do not match its staged GLB');
if (labEntry.triangles !== triangleCount || labEntry.animations.join(',') !== clips.map((clip) => clip.name).join(',')) throw new Error('Lab catalog geometry or animation metadata does not match candidate');
if (geometryBounds.min.some((v, i) => !Number.isFinite(v) || Math.abs(labEntry.base[['x','y','z'][i]] - v) > 1e-8) || geometrySize.some((v, i) => Math.abs(labEntry.size[['x','y','z'][i]] - v) > 1e-8)) throw new Error('Lab catalog bounds/size are inconsistent with candidate source geometry');
await writeFile(labCatalogPath, `${JSON.stringify(labCatalog, null, 2)}\n`);
const promotion = {
  schema: 'corealm-creature-promotion/1',
  sourceRoot: '.',
  destinationRoot: 'game/public/assets',
  pack: {
    id: 'corealm-user-scree-bustard', name: 'Corealm User Scree Bustard',
    author: 'User / Corealm',
    source: 'assets/art/tripo/imports/creatures/audit-user-bustard/build-candidate.mjs',
    license: 'LicenseRef-Corealm-Original',
    generatorSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  },
  assets: [{
    ...labEntry,
    candidateFile: 'assets/art/tripo/imports/creatures/audit-user-bustard/creature_scree_bustard.glb',
    pack: 'corealm-user-scree-bustard',
    vertices: vertexCount,
    sourceProvenance: { ...labEntry.sourceProvenance, sourceBytes: sourceBytes.length, sourceTextureSha256: Object.fromEntries(sourceTextureHashes) },
    acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
    measuredGait: null,
  }],
};
await writeFile(path.join(here, 'promotion.json'), `${JSON.stringify(promotion, null, 2)}\n`);
console.log(JSON.stringify({ candidate: path.relative(repo, candidatePath), bytes: candidateBytes.length, triangles: triangleCount, vertices: vertexCount, joints: ordered.length, activeJoints: jointCoverage.filter(Boolean).length, distributedVertices, maxWeightError, textures: textureReport, sampledClipReport }, null, 2));

function sameFile(a, b) { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(); }
