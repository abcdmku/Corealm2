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
      modifications: `Existing repaired source skin and eight clips retained; body geometry and UVs preserved; unique image-generated 2K layered color map replaces original color, source normal and roughness maps retained; uniform body scale ${spec.scale}; ${spec.silverthorn ? 'Silverthorn Death hip track authored as a side fall with source bent-limb tracks; ' : ''}Death reaches final pose by 0.65 seconds and holds to 1.5 seconds.` },
    metadata: { family: spec.silverthorn?'silverthorn_harrow':'boss_rootheart', height: bounds.max[1]-bounds.min[1],
      rig: `repaired Tripo humanoid ${skin.listJoints().length}-joint source skeleton`, texture: 'distinct image-generated layered bark with retained PBR maps',
      anatomyReview: spec.silverthorn?'original carved face, bud and branch silhouette with silver bark; pending root lab acceptance':'knot face and stout root limbs; young level-23 form, pending root lab acceptance' },
    acceptance: { exported: true, labAccepted: false, worldIntegrated: false },
  };
  assets.push(asset); files[spec.id] = asset.candidateFile;
  records.push({ id: spec.id, source: spec.source, sourceSha256: sourceSha, candidate: asset.candidateFile, candidateSha256: candidateSha,
    generatedMap: spec.map, generatedMapSha256: sha(generated), sourceGeometry: geometry,
    death: { finalPoseBySeconds: .65, finalHoldUntilSeconds: 1.5 }, addedGeometryTriangles: 0,
    status: 'pending-root-feature-lab-review' });
}
const pack = { id:'corealm-tripo-audit-rootwood-family', name:'Corealm Rootwood family candidates', author:'Corealm',
  source:'assets/art/tripo/imports/creatures/audit-rootwood-family/build-candidates.mjs', license:'LicenseRef-Corealm-Original', generatorSha256 };
await writeFile(path.join(here,'lab-catalog.json'), JSON.stringify({ schema:'corealm-lab-asset-candidates/1',pack,assets,files },null,2)+'\n');
await writeFile(path.join(here,'promotion-catalog.json'), JSON.stringify({ schema:'corealm-promoted-asset-candidates/1',
  generatorSha256, pack, assets, status:'pending-root-lab-acceptance' },null,2)+'\n');
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
  const hipChannels = death.listChannels().filter(channel => channel.getTargetNode().getName() === 'mixamorig:Hips');
  if (hipChannels.length !== 2) throw new Error('Silverthorn Death has an unfamiliar hip track.');
  for (const channel of hipChannels) {
    const sampler = channel.getSampler();
    const times = sampler.getInput().getArray();
    const source = sampler.getOutput().getArray();
    const components = channel.getTargetPath() === 'rotation' ? 4 : 3;
    const values = new Float32Array(source.length);
    if (channel.getTargetPath() === 'rotation') {
      const upright = new Quaternion().fromArray(source, 0);
      const sideways = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -1.55)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.2))
        .multiply(upright).normalize();
      for (let i = 0; i < times.length; i++) {
        const t = Math.min(1, times[i] / .65);
        const eased = t * t * (3 - 2 * t);
        upright.clone().slerp(sideways, eased).toArray(values, i * components);
      }
    } else if (channel.getTargetPath() === 'translation') {
      const upright = source.slice(0, 3);
      const fallen = [-.25, .09, -.15];
      for (let i = 0; i < times.length; i++) {
        const t = Math.min(1, times[i] / .65);
        const eased = t * t * (3 - 2 * t);
        for (let c = 0; c < components; c++) values[i * components + c] = upright[c] * (1 - eased) + fallen[c] * eased;
      }
    } else throw new Error('Silverthorn Death hip channel has an unfamiliar target.');
    values.set(values.slice(-2 * components, -components), values.length - components);
    sampler.getOutput().setArray(values);
  }
  const groundChannel = death.listChannels().find(channel => channel.getTargetNode().getName() === 'corealm_motion_ground' && channel.getTargetPath() === 'translation');
  if (!groundChannel) throw new Error('Silverthorn Death has no grounding track.');
  const groundSampler = groundChannel.getSampler();
  const groundTimes = groundSampler.getInput().getArray();
  const groundValues = new Float32Array(groundSampler.getOutput().getArray());
  for (let i = 0; i < groundTimes.length; i++) {
    const t = Math.min(1, groundTimes[i] / .65);
    groundValues[i * 3 + 1] += .094 * t * t * (3 - 2 * t);
  }
  groundValues.set(groundValues.slice(-6, -3), groundValues.length - 3);
  groundSampler.getOutput().setArray(groundValues);
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
