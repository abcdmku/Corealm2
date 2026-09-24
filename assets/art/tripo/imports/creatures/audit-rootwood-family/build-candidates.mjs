import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const generatorSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
const only = process.argv.includes('--silverthorn-only');
const previousLab = only ? JSON.parse(await readFile(path.join(here, 'lab-catalog.json'), 'utf8')) : null;
const previousRecords = only ? JSON.parse(await readFile(path.join(here, 'catalog.json'), 'utf8')) : null;
const previousPromotion = only ? JSON.parse(await readFile(path.join(here, 'promotion-catalog.json'), 'utf8')) : null;
const specs = [
  {
    id: 'creature_boss_rootheart', label: 'Young Rootheart',
    source: 'assets/art/tripo/imports/creatures/bramble-tiller-t10/models/creature_briar_harrow.glb',
    map: 'textures/rootheart-generated.png', scale: 0.85, silverthorn: false,
    destination: 'models/creature/creature_boss_rootheart.glb',
    sourceModelId: '0900292c-ef73-40f9-864d-1f289df395f5',
  },
  {
    id: 'creature_silverthorn_harrow', label: 'Silverthorn Harrow',
    source: 'assets/art/tripo/imports/creatures/starred-grove-guardian/models/creature_starroot_guardian.glb',
    map: 'textures/silverthorn-generated.png', scale: 0.95, silverthorn: true,
    destination: 'models/fairy-crown/creature_silverthorn_harrow.glb',
    sourceModelId: '4580db8d-f714-4acf-be53-33a2543e7090',
  },
];
const assets = [], files = {}, records = [];
await mkdir(path.join(here, 'models'), { recursive: true });
for (const spec of specs) {
  if (only && !spec.silverthorn) {
    const asset = previousLab.assets.find(asset => asset.id === spec.id);
    const record = previousRecords.records.find(record => record.id === spec.id);
    if (!asset || !record) throw new Error('Missing preserved Rootheart catalog entry.');
    const bytes = await readFile(path.join(here, asset.candidateFile));
    if (sha(bytes) !== asset.sha256) throw new Error('Rootheart candidate differs from its catalog hash.');
    assets.push(asset); files[spec.id] = asset.candidateFile; records.push(record);
    continue;
  }
  const sourceFile = path.resolve(repo, spec.source);
  const sourceBytes = await readFile(sourceFile);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const skin = root.listSkins()[0];
  const meshNode = root.listNodes().find(node => node.getMesh() && node.getSkin() === skin);
  const primitive = meshNode?.getMesh()?.listPrimitives()[0];
  const material = primitive?.getMaterial();
  if (!scene || !skin || !meshNode || !primitive || !material || root.listSkins().length !== 1) throw new Error(`${spec.id}: expected the repaired single-skin source.`);
  const positions = primitive.getAttribute('POSITION');
  const normals = primitive.getAttribute('NORMAL');
  const uvs = primitive.getAttribute('TEXCOORD_0');
  const indices = primitive.getIndices();
  if (!positions || !normals || !uvs || !indices) throw new Error(`${spec.id}: incomplete source mesh.`);
  const accessorHash = accessor => sha(Buffer.from(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength));
  const geometry = { positions: accessorHash(positions), normals: accessorHash(normals), uvs: accessorHash(uvs), indices: accessorHash(indices) };
  const parent = scene.listChildren()[0];
  if (!parent || parent.getScale().some(value => value <= 0)) throw new Error(`${spec.id}: unfamiliar source scene scale.`);
  parent.setScale(parent.getScale().map(value => value * spec.scale));
  const generated = await readFile(path.join(here, spec.map));
  const sourceBase = material.getBaseColorTexture();
  const normalMap = material.getNormalTexture();
  const roughnessMap = material.getMetallicRoughnessTexture();
  if (!sourceBase || !normalMap || !roughnessMap) throw new Error(`${spec.id}: source layered PBR maps missing.`);
  const originalBaseSha = sha(sourceBase.getImage());
  const originalNormalSha = sha(normalMap.getImage());
  const originalRoughnessSha = sha(roughnessMap.getImage());
  const editedBase = await sharp(generated).resize(2048, 2048, { kernel: 'lanczos3' }).jpeg({ quality: 93, mozjpeg: true }).toBuffer();
  sourceBase.setImage(editedBase).setName(`${spec.id}_imagegen_basecolor_2k.jpg`);
  material.setName(`${spec.id}_layered_wood`);
  fixDeath(doc);
  if (spec.silverthorn) sideFallDeath(doc);
  const output = path.join(here, 'models', `${spec.id}.glb`);
  const candidateBytes = await io.writeBinary(doc);
  await writeFile(output, candidateBytes);
  const verify = await io.readBinary(candidateBytes);
  const check = verify.getRoot().listNodes().find(node => node.getSkin())?.getMesh()?.listPrimitives()[0];
  if (!check || accessorHash(check.getAttribute('POSITION')) !== geometry.positions || accessorHash(check.getAttribute('NORMAL')) !== geometry.normals || accessorHash(check.getAttribute('TEXCOORD_0')) !== geometry.uvs || accessorHash(check.getIndices()) !== geometry.indices) throw new Error(`${spec.id}: source body geometry/UV changed.`);
  const clips = verify.getRoot().listAnimations().map(animation => animation.getName());
  if (JSON.stringify(clips) !== JSON.stringify(['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'])) throw new Error(`${spec.id}: core clip set changed.`);
  const death = verify.getRoot().listAnimations().find(a => a.getName() === 'Death');
  if (Math.abs(Math.max(...death.listSamplers().flatMap(s => [...s.getInput().getArray()])) - 1.5) > 1e-5) throw new Error(`${spec.id}: Death does not hold through 1.5 seconds.`);
  for (const sampler of death.listSamplers()) {
    const times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
    const components = values.length / times.length;
    if (times[times.length - 2] > .65001 || times[times.length - 1] !== 1.5
      || values.slice(-components).some((value, index) => value !== values[values.length - 2 * components + index])) {
      throw new Error(`${spec.id}: Death final pose was not reached by .65 and held unchanged to 1.5.`);
    }
  }
  const checkMaterial = check.getMaterial();
  if (sha(checkMaterial.getNormalTexture()?.getImage() ?? Buffer.alloc(0)) !== originalNormalSha
    || sha(checkMaterial.getMetallicRoughnessTexture()?.getImage() ?? Buffer.alloc(0)) !== originalRoughnessSha) {
    throw new Error(`${spec.id}: source normal or roughness maps changed.`);
  }
  const bounds = measure(verify.getRoot());
  const candidateSha = sha(candidateBytes);
  const sourceSha = sha(sourceBytes);
  const asset = {
    id: spec.id, file: spec.destination, candidateFile: `models/${spec.id}.glb`, pack: 'corealm-tripo-audit-rootwood-family',
    ...(spec.silverthorn ? { impliedWalkMps: null, impliedRunMps: null, measuredGait: null, locomotionPolicy: null } : {}),
    category: 'character', is: spec.label, tags: ['creature','rootwood','tripo','candidate',spec.silverthorn?'silverthorn':'rootheart'],
    bytes: candidateBytes.length, sha256: candidateSha,
    size: { x: bounds.max[0]-bounds.min[0], y: bounds.max[1]-bounds.min[1], z: bounds.max[2]-bounds.min[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, groundY: 0,
    triangles: indices.getCount()/3, animations: clips,
    materials: verify.getRoot().listMaterials().map(m => m.getName()),
    walkClipSeconds: 1.3333333730697632, runClipSeconds: 0.9333333373069763, attackSeconds: 0.8666666746139526, contactNormalized: 0.5,
    sourceProvenance: { generator: 'Tripo Studio', sourceModelId: spec.sourceModelId, sourceFile: spec.source,
      sourceSha256: sourceSha, sourceBaseColorSha256: originalBaseSha,
      sourceNormalSha256: originalNormalSha, sourceMetallicRoughnessSha256: originalRoughnessSha,
      imagegenMap: spec.map, imagegenMapSha256: sha(generated), sourceGeometrySha256: geometry,
      modifications: `Existing repaired source skin and eight clips retained; body geometry and UVs preserved; unique image-generated 2K layered color map replaces original color, source normal and roughness maps retained; uniform body scale ${spec.scale}; ${spec.silverthorn ? 'Silverthorn Death blends to a relaxed rest-based skeleton with parallel legs, lowered arms and a grounded whole-body side roll without scaling; ' : ''}Death reaches final pose by 0.65 seconds and holds to 1.5 seconds.` },
    metadata: { family: spec.silverthorn?'silverthorn_harrow':'boss_rootheart', height: bounds.max[1]-bounds.min[1],
      rig: `repaired Tripo humanoid ${skin.listJoints().length}-joint source skeleton`, texture: 'distinct image-generated layered bark with retained PBR maps',
      anatomyReview: spec.silverthorn?'original carved face, bud and branch silhouette with silver bark; pending root lab acceptance':'knot face and stout root limbs; young level-23 form, pending root lab acceptance' },
    acceptance: { exported: true, labAccepted: false, worldIntegrated: false },
  };
  assets.push(asset); files[spec.id] = asset.candidateFile;
  records.push({ id: spec.id, source: spec.source, sourceSha256: sourceSha, candidate: asset.candidateFile, candidateSha256: candidateSha,
    generatedMap: spec.map, generatedMapSha256: sha(generated), sourceGeometry: geometry,
    ...(spec.silverthorn ? { impliedWalkMps: null, impliedRunMps: null, measuredGait: null, locomotionPolicy: null } : {}),
    death: { finalPoseBySeconds: .65, finalHoldUntilSeconds: 1.5 }, addedGeometryTriangles: 0,
    status: 'pending-root-feature-lab-review' });
}
const pack = { id:'corealm-tripo-audit-rootwood-family', name:'Corealm Rootwood family candidates', author:'Corealm',
  source:'assets/art/tripo/imports/creatures/audit-rootwood-family/build-candidates.mjs', license:'LicenseRef-Corealm-Original', generatorSha256 };
await writeFile(path.join(here,'lab-catalog.json'), JSON.stringify({ schema:'corealm-lab-asset-candidates/1',pack,assets,files },null,2)+'\n');
const promotionAssets = only ? assets.map(asset => asset.id === 'creature_boss_rootheart'
  ? previousPromotion.assets.find(previous => previous.id === asset.id) : asset) : assets;
await writeFile(path.join(here,'promotion-catalog.json'), JSON.stringify({ schema:'corealm-promoted-asset-candidates/1',
  generatorSha256, pack, assets:promotionAssets, status:'pending-root-lab-acceptance' },null,2)+'\n');
await writeFile(path.join(here,'catalog.json'), JSON.stringify({ schema:'corealm-rootwood-family-candidates/1',pack,records,
  held:[{ id:'creature_hollow_bough',reason:'No source has an actual hollow standing trunk, branch arms and root legs.' },
    { id:'creature_bloomheart_matriarch',reason:'Available sources lack a mature carved face and flowering crown; the Starroot bud silhouette reads juvenile.' }] },null,2)+'\n');
console.log(JSON.stringify(records.map(r=>({id:r.id,sha:r.candidateSha256,source:r.source,addedGeometryTriangles:r.addedGeometryTriangles})),null,2));

function fixDeath(doc) {
  const death = doc.getRoot().listAnimations().find(animation => animation.getName() === 'Death');
  if (!death) throw new Error('Source has no Death clip.');
  const samplers = death.listSamplers();
  const end = Math.max(...samplers.map(s => Math.max(...s.getInput().getArray())));
  if (end < 1.5) throw new Error('Unexpected short source Death clip.');
  for (const sampler of samplers) {
    const input = sampler.getInput(), output = sampler.getOutput();
    const oldTimes = input.getArray(), oldValues = output.getArray();
    const components = oldValues.length / oldTimes.length;
    if (![3,4].includes(components)) throw new Error('Unexpected Death animation sampler shape.');
    const newTimes = new Float32Array(oldTimes.length + 1);
    for (let i = 0; i < oldTimes.length; i++) newTimes[i] = Math.min(0.65, oldTimes[i] / end * 0.65);
    newTimes[oldTimes.length] = 1.5;
    const newValues = new Float32Array(oldValues.length + components);
    newValues.set(oldValues);
    newValues.set(oldValues.slice(-components), oldValues.length);
    input.setArray(newTimes);
    output.setArray(newValues);
  }
}

function sideFallDeath(doc) {
  const death = doc.getRoot().listAnimations().find(animation => animation.getName() === 'Death');
  const ground = doc.getRoot().listNodes().find(node => node.getName() === 'corealm_motion_ground');
  const groundChannel = death.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation');
  if (!groundChannel) throw new Error('Silverthorn Death has no grounding track.');
  const groundSampler = groundChannel.getSampler();
  const groundTimes = groundSampler.getInput().getArray();
  const rotations = new Float32Array(groundTimes.length * 4);
  const upright = new Quaternion();
  const sideways = new Quaternion().setFromAxisAngle(new Vector3(1, 0, .08).normalize(), 1.55);
  for (let i = 0; i < groundTimes.length; i++) {
    const t = Math.min(1, groundTimes[i] / .65);
    upright.clone().slerp(sideways, t * t * (3 - 2 * t)).toArray(rotations, i * 4);
  }
  rotations.set(rotations.slice(-8, -4), rotations.length - 4);
  const rotationSampler = doc.createAnimationSampler().setInput(groundSampler.getInput())
    .setOutput(doc.createAccessor().setType('VEC4').setArray(rotations)).setInterpolation('LINEAR');
  death.addSampler(rotationSampler).addChannel(doc.createAnimationChannel().setTargetNode(ground)
    .setTargetPath('rotation').setSampler(rotationSampler));
  // Blend from the initial Death pose to a relaxed rest-derived skeleton.
  // Source Death includes large hip/spine twists, so do not stack rotations on it.
  for (const channel of death.listChannels()) {
    const node = channel.getTargetNode(), targetPath = channel.getTargetPath();
    if (node === ground) continue;
    const sampler = channel.getSampler(), times = sampler.getInput().getArray();
    const source = sampler.getOutput().getArray();
    const components = targetPath === 'rotation' ? 4 : 3;
    const values = new Float32Array(source.length);
    let target = targetPath === 'rotation' ? node.getRotation() : node.getTranslation();
    if (targetPath === 'rotation' && /:(Left|Right)Arm$/.test(node.getName())) {
      const parentRotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(
        new Matrix4().fromArray(node.getParentNode().getWorldMatrix())));
      const originalWorld = parentRotation.clone().multiply(new Quaternion().fromArray(node.getRotation()));
      const down = new Vector3(node.getName().includes('Left') ? .13 : -.13, -1, .12).normalize();
      const aim = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0).applyQuaternion(originalWorld), down);
      target = parentRotation.invert().multiply(aim.multiply(originalWorld)).toArray();
    }
    if (targetPath === 'rotation' && /:(Left|Right)(Leg|ForeArm)$/.test(node.getName())) {
      const bend = /ForeArm/.test(node.getName()) ? .20 : .14;
      target = new Quaternion().fromArray(target).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0), bend)).toArray();
    }
    for (let i = 0; i < times.length; i++) {
      const t = Math.min(1, times[i] / .65), weight = t * t * (3 - 2 * t);
      if (targetPath === 'rotation') new Quaternion().fromArray(source).slerp(new Quaternion().fromArray(target), weight).toArray(values, i * 4);
      else for (let axis = 0; axis < 3; axis++) values[i * 3 + axis] = source[axis] + (target[axis] - source[axis]) * weight;
    }
    values.set(values.slice(-2 * components, -components), values.length - components);
    sampler.getOutput().setArray(values);
  }
  // The lowest skinned vertex changes during the fall. Bake contact through the
  // entire motion instead of interpolating a single final-pose lift.
  const sourceGroundValues = groundSampler.getOutput().getArray();
  const contactTimes = new Float32Array([...new Set([
    ...Array.from({ length: 157 }, (_, i) => Math.fround(i / 240)),
    ...death.listSamplers().flatMap(sampler => [...sampler.getInput().getArray()]),
  ])].sort((a, b) => a - b));
  const groundValues = new Float32Array(contactTimes.length * 3);
  const groundParent = ground.getParentNode();
  const parentMatrix = new Matrix4().fromArray(groundParent.getWorldMatrix());
  const worldLift = new Vector3(0, 1, 0).transformDirection(parentMatrix.clone().invert());
  if (Math.abs(worldLift.y - 1) > 1e-6) throw new Error('Silverthorn ground parent must preserve vertical axis.');
  const verticalScale = new Vector3().setFromMatrixScale(parentMatrix).y;
  for (let i = 0; i < contactTimes.length - 1; i++) {
    const time = contactTimes[i];
    let index = 0;
    while (index < groundTimes.length - 2 && groundTimes[index + 1] < time) index++;
    const next = index + 1;
    const fraction = Math.max(0, Math.min(1, (time - groundTimes[index]) / (groundTimes[next] - groundTimes[index])));
    for (let axis = 0; axis < 3; axis++) groundValues[i * 3 + axis] = sourceGroundValues[index * 3 + axis]
      + (sourceGroundValues[next * 3 + axis] - sourceGroundValues[index * 3 + axis]) * fraction;
    groundValues[i * 3 + 1] -= posedBounds(doc, time).min[1] / verticalScale;
  }
  groundValues.set(groundValues.slice(-6, -3), groundValues.length - 3);
  groundSampler.setInput(doc.createAccessor().setType('SCALAR').setArray(contactTimes));
  groundSampler.getOutput().setArray(groundValues);
  let lowestContact = Infinity, highestContact = -Infinity;
  for (let i = 0; i <= 624; i++) {
    const contact = posedBounds(doc, i / 960).min[1];
    lowestContact = Math.min(lowestContact, contact);
    highestContact = Math.max(highestContact, contact);
  }
  console.log('Silverthorn full-fall contact range', JSON.stringify({ lowestContact, highestContact, samples: 625 }));
  if (lowestContact < -.002 || highestContact > .005) throw new Error('Silverthorn fall loses ground contact between baked keys.');
  const final = posedBounds(doc, .65);
  const held = posedBounds(doc, 1.5);
  const brief = bounds => ({ min: bounds.min, max: bounds.max,
    head: bounds.landmarks['mixamorig:Head'], hips: bounds.landmarks['mixamorig:Hips'],
    leftFoot: bounds.landmarks['mixamorig:LeftFoot'], rightFoot: bounds.landmarks['mixamorig:RightFoot'],
    low:bounds.low, high:bounds.high });
  console.log('Silverthorn posed corpse bounds', JSON.stringify({ at03: brief(posedBounds(doc, .3)),
    at065: brief(final), at092: brief(posedBounds(doc, .92)), at15: brief(held) }));
  if (Math.abs(final.min[1]) > .01 || final.max[1] - final.min[1] > 1.1
    || Math.abs(held.max[1] - final.max[1]) > .001) throw new Error('Silverthorn corpse is not grounded and held low.');
}

function posedBounds(doc, time) {
  const root = doc.getRoot();
  const death = root.listAnimations().find(animation => animation.getName() === 'Death');
  const overrides = new Map();
  for (const channel of death.listChannels()) {
    const sampler = channel.getSampler(), times = sampler.getInput().getArray();
    let index = 0;
    while (index < times.length - 2 && times[index + 1] < time) index++;
    const next = Math.min(index + 1, times.length - 1);
    const fraction = times[next] === times[index] ? 0 : Math.max(0, Math.min(1, (time - times[index]) / (times[next] - times[index])));
    const output = sampler.getOutput(), a = output.getElement(index, []), b = output.getElement(next, []);
    const value = channel.getTargetPath() === 'rotation'
      ? new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b), fraction).toArray()
      : a.map((v, i) => v + (b[i] - v) * fraction);
    const values = overrides.get(channel.getTargetNode()) ?? {};
    values[channel.getTargetPath()] = value;
    overrides.set(channel.getTargetNode(), values);
  }
  const worlds = new Map();
  const world = node => {
    if (worlds.has(node)) return worlds.get(node);
    const value = overrides.get(node) ?? {};
    const local = new Matrix4().compose(new Vector3().fromArray(value.translation ?? node.getTranslation()),
      new Quaternion().fromArray(value.rotation ?? node.getRotation()), new Vector3().fromArray(value.scale ?? node.getScale()));
    const parent = node.getParentNode();
    const result = parent ? world(parent).clone().multiply(local) : local;
    worlds.set(node, result);
    return result;
  };
  const meshNode = root.listNodes().find(node => node.getSkin());
  const skin = meshNode.getSkin(), meshWorld = world(meshNode), meshInverse = meshWorld.clone().invert();
  const ibm = skin.getInverseBindMatrices();
  const joints = skin.listJoints().map((joint, index) => meshInverse.clone().multiply(world(joint))
    .multiply(new Matrix4().fromArray(ibm.getElement(index, []))));
  const bounds = new Box3();
  let low = { y: Infinity }, high = { y: -Infinity };
  for (const primitive of meshNode.getMesh().listPrimitives()) {
    const position = primitive.getAttribute('POSITION'), jointIds = primitive.getAttribute('JOINTS_0'),
      weights = primitive.getAttribute('WEIGHTS_0');
    for (let i = 0; i < position.getCount(); i++) {
      const point = new Vector3().fromArray(position.getElement(i, []));
      const ids = jointIds.getElement(i, []), ws = weights.getElement(i, []);
      const posed = new Vector3();
      for (let j = 0; j < 4; j++) if (ws[j]) posed.addScaledVector(point.clone().applyMatrix4(joints[ids[j]]), ws[j]);
      posed.applyMatrix4(meshWorld);
      if (posed.y < low.y) low = { y: posed.y, joint: skin.listJoints()[ids[ws.indexOf(Math.max(...ws))]]?.getName() };
      if (posed.y > high.y) high = { y: posed.y, joint: skin.listJoints()[ids[ws.indexOf(Math.max(...ws))]]?.getName() };
      bounds.expandByPoint(posed);
    }
  }
  const landmarks = {};
  for (const node of root.listNodes()) if (/Hips|Head$|LeftFoot$|RightFoot$|LeftHand$|RightHand$|Spine2$/.test(node.getName())) {
    landmarks[node.getName()] = new Vector3().setFromMatrixPosition(world(node)).toArray();
  }
  return { min: bounds.min.toArray(), max: bounds.max.toArray(), landmarks, low, high };
}

function measure(root) {
  const box = new Box3();
  for (const node of root.listNodes().filter(node => node.getMesh())) {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of node.getMesh().listPrimitives()) {
      const accessor = primitive.getAttribute('POSITION');
      for (let i=0;i<accessor.getCount();i++) box.expandByPoint(new Vector3().fromArray(accessor.getElement(i,[])).applyMatrix4(matrix));
    }
  }
  return { min:box.min.toArray(), max:box.max.toArray() };
}
