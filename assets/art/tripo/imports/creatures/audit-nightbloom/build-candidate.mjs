import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const dir = 'assets/art/tripo/imports/creatures/audit-nightbloom';
const source = 'assets/art/tripo/imports/creatures/audit-owned-plant-downloads/pinkbud-plant-7508cd34-a17e-4945-8c38-e6ae4542f4b2.glb';
const output = `${dir}/nightbloom-guardian-candidate.glb`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(source);
if (sha(sourceBytes) !== '2249b8a7f602c279315664a53885872b7b461f8fc5cfd4bc42d3ec8f3f59ef92') throw new Error('Owned source hash changed.');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot(), scene = root.listScenes()[0], mesh = root.listMeshes()[0], original = mesh.listPrimitives()[0];
const armature = root.listNodes().find(n => n.getName() === 'Armature');
const skin = root.listSkins()[0], joints = skin.listJoints();
const bone = new Map(joints.map((node, i) => [node.getName().replace('mixamorig:', ''), { node, index: i, rest: new Quaternion(...node.getRotation()) }]));
if (!armature || joints.length !== 65 || root.listAnimations().length || !original.getAttribute('JOINTS_0') || !original.getAttribute('WEIGHTS_0')) throw new Error('Unexpected pinkbud source rig.');

const originalTexture = original.getMaterial().getBaseColorTexture();
const imagegenOriginal = await readFile(`${dir}/nightbloom-imagegen-atlas.png`);
const nightAtlas = await sharp(imagegenOriginal).resize(2048, 2048, { kernel: 'lanczos3' }).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toBuffer();
await writeFile(`${dir}/nightbloom-2k-basecolor.jpg`, nightAtlas);
originalTexture.setImage(nightAtlas).setMimeType('image/jpeg').setName('Nightbloom image-generated nocturnal bark and flower atlas');
for (const texture of root.listTextures()) {
  if (texture === originalTexture) continue;
  const image = texture.getImage();
  const data = await sharp(image).resize(2048, 2048, { kernel: 'lanczos3' }).toBuffer();
  texture.setImage(data);
}
const material = original.getMaterial();
material.setName('Nightbloom velvet petal, moss and blue-black bark').setRoughnessFactor(0.91).setMetallicFactor(0);

// Restrained flowering antlers are weighted wholly to the source head joint.
// Their two materials sample the bark and petal islands of the same generated atlas.
const headIndex = bone.get('Head').index;
const buffer = root.listBuffers()[0];
function builder(name) {
  const positions = [], normals = [], uvs = [], jointIds = [], weights = [], indices = [];
  function vertex(p, n, uv) {
    positions.push(...p); normals.push(...n); uvs.push(...uv);
    jointIds.push(headIndex, 0, 0, 0); weights.push(1, 0, 0, 0);
    return positions.length / 3 - 1;
  }
  function tri(a, b, c) { indices.push(a, b, c); }
  function primitive(material) {
    const meshPrimitive = doc.createPrimitive().setMaterial(material).setMode(4);
    const attr = (label, array, type) => doc.createAccessor(`${name}_${label}`).setArray(array).setType(type).setBuffer(buffer);
    meshPrimitive.setAttribute('POSITION', attr('Position', new Float32Array(positions), Accessor.Type.VEC3));
    meshPrimitive.setAttribute('NORMAL', attr('Normal', new Float32Array(normals), Accessor.Type.VEC3));
    meshPrimitive.setAttribute('TEXCOORD_0', attr('UV', new Float32Array(uvs), Accessor.Type.VEC2));
    meshPrimitive.setAttribute('JOINTS_0', attr('Joints', new Uint16Array(jointIds), Accessor.Type.VEC4));
    meshPrimitive.setAttribute('WEIGHTS_0', attr('Weights', new Float32Array(weights), Accessor.Type.VEC4));
    meshPrimitive.setIndices(attr('Indices', new Uint16Array(indices), Accessor.Type.SCALAR));
    mesh.addPrimitive(meshPrimitive);
  }
  return { vertex, tri, primitive, get vertexCount() { return positions.length / 3; }, get triangleCount() { return indices.length / 3; } };
}
const branch = builder('NightbloomBranchCrown');
function stem(from, to, radius) {
  const axis = new Vector3(...to).sub(new Vector3(...from)).normalize();
  const helper = Math.abs(axis.y) < .8 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(axis, helper).normalize();
  const v = new Vector3().crossVectors(axis, u).normalize();
  const ring = [[], []];
  for (let end = 0; end < 2; end++) for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    const radial = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
    const p = new Vector3(...(end ? to : from)).addScaledVector(radial, radius * (end ? .67 : 1));
    ring[end].push(branch.vertex(p.toArray(), radial.toArray(), [.28 + .12 * i / 7, .37 + .12 * end]));
  }
  for (let i = 0; i < 7; i++) { const j = (i + 1) % 7; branch.tri(ring[0][i], ring[0][j], ring[1][j]); branch.tri(ring[0][i], ring[1][j], ring[1][i]); }
}
for (const sign of [-1, 1]) {
  const z = sign * .075;
  stem([0, .865, z], [-.025, 1.005, sign * .13], .018);
  stem([-.025, 1.005, sign * .13], [-.018, 1.14, sign * .245], .013);
  stem([-.018, 1.14, sign * .245], [-.01, 1.205, sign * .31], .008);
  stem([-.018, 1.14, sign * .245], [.035, 1.185, sign * .19], .006);
  stem([-.025, 1.005, sign * .13], [.045, 1.105, sign * .245], .009);
}
branch.primitive(material);
const petals = builder('NightbloomFlowers');
const blossomCenters = [[-.02, 1.16, -.25], [.045, 1.115, -.24], [-.02, 1.16, .25], [.035, 1.18, .19]];
for (const center of blossomCenters) {
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2;
    const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const tangent = new Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const c = new Vector3(...center);
    const start = c.clone().addScaledVector(dir, .008);
    const sideA = c.clone().addScaledVector(dir, .04).addScaledVector(tangent, .025).add(new Vector3(0, .015, 0));
    const tip = c.clone().addScaledVector(dir, .075).add(new Vector3(0, .014, 0));
    const sideB = c.clone().addScaledVector(dir, .04).addScaledVector(tangent, -.025).add(new Vector3(0, .015, 0));
    const normal = new Vector3(.45, .8, .2).normalize().toArray();
    const ids = [start, sideA, tip, sideB].map((p, j) => petals.vertex(p.toArray(), normal, [[.28, .66], [.29, .67], [.32, .68], [.29, .65]][j]));
    petals.tri(ids[0], ids[1], ids[2]); petals.tri(ids[0], ids[2], ids[3]);
  }
}
const flowerMaterial = doc.createMaterial('Nightbloom bioluminescent flowers').setBaseColorTexture(originalTexture).setRoughnessFactor(.78).setMetallicFactor(0).setDoubleSided(true).setEmissiveFactor([.22, .3, .55]).setEmissiveTexture(originalTexture);
petals.primitive(flowerMaterial);

// A scaled parent keeps source bind poses and all authored clip values in source units.
const presentation = doc.createNode('Nightbloom 2.45 m presentation').setScale([2.45, 2.45, 2.45]);
scene.removeChild(armature); scene.addChild(presentation); presentation.addChild(armature);
const q = (axis, angle) => new Quaternion().setFromAxisAngle(new Vector3(...axis), angle);
const relative = (name, axis, angle) => bone.get(name).rest.clone().multiply(q(axis, angle)).normalize().toArray();
function animate(name, seconds, tracks) {
  const a = doc.createAnimation(name);
  for (const track of tracks) {
    const node = track.node === 'Armature' ? armature : bone.get(track.node)?.node;
    if (!node) throw new Error(`Unknown animation bone: ${track.node}`);
    const input = doc.createAccessor(`${name}_${track.node}_${track.path}_time`).setArray(new Float32Array(track.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(`${name}_${track.node}_${track.path}_value`).setArray(new Float32Array(track.values.flat())).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(`${name}_${track.node}_${track.path}_sampler`).setInput(input).setOutput(output).setInterpolation('LINEAR');
    a.addSampler(sampler).addChannel(doc.createAnimationChannel(`${name}_${track.node}_${track.path}_channel`).setTargetNode(node).setTargetPath(track.path).setSampler(sampler));
  }
  return { name, seconds, channels: tracks.length };
}
const t = (node, times, angles, axis = [1, 0, 0]) => ({ node, path: 'rotation', times, values: angles.map(a => relative(node, axis, a)) });
const clips = [];
clips.push(animate('Idle', 2.4, [
  t('Spine2', [0,.6,1.2,1.8,2.4], [0,.035,0,-.035,0], [0,0,1]),
  t('Head', [0,.6,1.2,1.8,2.4], [0,-.05,0,.04,0], [0,1,0]),
  t('LeftArm', [0,.6,1.2,1.8,2.4], [0,.05,0,-.04,0]),
  t('RightArm', [0,.6,1.2,1.8,2.4], [0,-.04,0,.05,0]),
]));
for (const [name, seconds, swing] of [['Walk', 1.2, .37], ['Run', .76, .62]]) {
  const times = [0,.25,.5,.75,1].map(v => v * seconds);
  clips.push(animate(name, seconds, [
    { node: 'Armature', path: 'translation', times, values: (name === 'Walk' ? [.13,.065,.085,.075,.13] : [.105,.065,.03,.075,.105]).map(y => [0,y,0]) },
    t('LeftUpLeg', times, [swing,0,-swing,0,swing], [0,0,1]),
    t('RightUpLeg', times, [-swing,0,swing,0,-swing], [0,0,1]),
    t('LeftLeg', times, [-.16,-.28,-.12,-.06,-.16], [0,0,1]),
    t('RightLeg', times, [-.12,-.06,-.16,-.28,-.12], [0,0,1]),
    t('LeftArm', times, [-swing*.65,0,swing*.65,0,-swing*.65], [0,0,1]),
    t('RightArm', times, [swing*.65,0,-swing*.65,0,swing*.65], [0,0,1]),
    t('Spine1', times, [0,.04,0,-.04,0], [1,0,0]),
  ]));
}
clips.push(animate('Attack', .85, [
  t('Spine2', [0,.22,.48,.85], [0,-.19,.22,0], [0,0,1]),
  t('LeftArm', [0,.22,.48,.85], [0,-.35,.85,0], [0,0,1]),
  t('RightArm', [0,.22,.48,.85], [0,-.35,.85,0], [0,0,1]),
  t('LeftForeArm', [0,.22,.48,.85], [0,.14,-.24,0], [0,0,1]),
  t('RightForeArm', [0,.22,.48,.85], [0,.14,-.24,0], [0,0,1]),
  t('Head', [0,.22,.48,.85], [0,-.09,.16,0], [0,0,1]),
]));
for (const [name, sign] of [['Hit', 1], ['HitLeft', -1], ['HitRight', 1]]) clips.push(animate(name, .48, [
  t('Spine2', [0,.12,.28,.48], [0,sign*.2,-sign*.06,0], [1,0,0]),
  t('Head', [0,.12,.28,.48], [0,sign*.15,-sign*.04,0], [1,0,0]),
  t('LeftArm', [0,.12,.28,.48], [0,-.15,.08,0], [0,0,1]),
  t('RightArm', [0,.12,.28,.48], [0,-.15,.08,0], [0,0,1]),
]));
clips.push(animate('Death', 1.5, [
  { node: 'Armature', path: 'rotation', times: [0,.17,.4,.65,1.5], values: [0,-.18,-.9,-Math.PI/2,-Math.PI/2].map(v => q([0,0,1],v).toArray()) },
  { node: 'Armature', path: 'translation', times: [0,.17,.4,.65,1.5], values: [[0,0,0],[0,.025,0],[0,.105,0],[0,.175,0],[0,.175,0]] },
  t('LeftArm', [0,.17,.4,.65,1.5], [0,.2,.48,.55,.55], [1,0,0]),
  t('RightArm', [0,.17,.4,.65,1.5], [0,-.2,-.48,-.55,-.55], [1,0,0]),
  t('Head', [0,.17,.4,.65,1.5], [0,-.08,-.19,-.23,-.23], [1,0,0]),
]));
const binary = await io.writeBinary(doc);
await writeFile(output, binary);
const bodyPos = original.getAttribute('POSITION').getArray();
const model = { source, sourceSha256: sha(sourceBytes), sourceBytes: sourceBytes.length, imagegenPrompt: 'Precise UV atlas edit: preserve islands and carved face; blue-black bark, layered indigo and moss, dark velvet leaves, luminous blue-white nightflower buds, silver-blue sap threads.', imagegenFile: `${dir}/nightbloom-imagegen-atlas.png`, imagegenSha256: sha(imagegenOriginal), candidate: output, candidateSha256: sha(binary), bytes: binary.length, sourceVertices: bodyPos.length / 3, sourceTriangles: original.getIndices().getCount() / 3, addedVertices: branch.vertexCount + petals.vertexCount, addedTriangles: branch.triangleCount + petals.triangleCount, joints: joints.length, sourceWeights: 'preserved normalized Uint8 4-influence skin', clips, status: 'awaiting-root-lab-review', accepted: false };
await writeFile(`${dir}/catalog.json`, `${JSON.stringify(model, null, 2)}\n`);
const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [{ id: 'fairy_guardian_06_faeholme', file: 'models/fairy-garden/fairy_guardian_06_faeholme.glb', pack: 'corealm-owned-tripo-nightbloom', category: 'character', is: 'Nightbloom guardian', tags: ['creature','fairy','guardian','nightbloom','tripo','candidate'], bytes: binary.length, sha256: sha(binary), size: { x: 1.0, y: 2.95, z: 1.85 }, base: { x: -.5, y: 0, z: -.925 }, bounds: { min: [-.5,0,-.925], max: [.5,2.95,.925] }, groundY: 0, triangles: model.sourceTriangles + model.addedTriangles, vertices: model.sourceVertices + model.addedVertices, animations: clips.map(c => c.name), materials: root.listMaterials().map(m => m.getName()), sourceProvenance: model, acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false } }], files: { fairy_guardian_06_faeholme: 'nightbloom-guardian-candidate.glb' } };
await writeFile(`${dir}/lab-catalog.json`, `${JSON.stringify(lab, null, 2)}\n`);
console.log(JSON.stringify(model, null, 2));
