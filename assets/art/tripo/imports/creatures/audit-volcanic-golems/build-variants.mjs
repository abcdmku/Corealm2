import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';

const directory = 'assets/art/tripo/imports/creatures/audit-volcanic-golems';
const sourceDirectory = 'assets/art/tripo/imports/creatures/starred-volcanic-duo';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const variants = [
  {
    id: 'creature_voidstone_colossus', name: 'Voidstone Colossus', source: 'volcanic-titan-native-rig-candidate.glb',
    sourceSha256: 'bb1ed4a448d1e30257e43e3ba2e640712a7cc8d9f99b23827f77f6d576b8dfa5',
    atlas: 'textures/voidstone-basecolor.png', output: 'voidstone-colossus-candidate.glb', targetHeight: 2.8,
    tags: ['creature', 'colossus', 'black-crystal', 'void', 'starred', 'skinned', 'image-generated-texture'],
    emissiveColor: [45, 22, 100], sourceModelId: '31b1d1f3-ebd9-4c67-b3f8-846da3211c81',
    sourceCardId: 'a02869b7-f9ba-456a-80b0-1d9b6d6770f1',
    identity: 'Angular black-crystal void titan with a readable face and sparse violet starlight fractures.',
    scope: 'Also used by the Hollow Star 233 boss group; that encounter retains its own content identity.',
  },
  {
    id: 'creature_ashseal_warden', name: 'Ashseal Warden', source: 'cooling-crust-golem-native-rig-candidate.glb',
    sourceSha256: '6f7c57b19a7cedaf5b4c17a02a6211a3215a8c034a967468dfd6813f3d29f067',
    atlas: 'textures/ashseal-basecolor.png', output: 'ashseal-warden-candidate.glb', targetHeight: 1.9,
    tags: ['creature', 'golem', 'ashseal', 'charred-stone', 'cooling-crust', 'starred', 'skinned', 'image-generated-texture'],
    emissiveColor: [70, 24, 8], sourceModelId: 'dd3fdc88-4fd6-49ff-955f-ed85c4085d41',
    sourceCardId: '7bc8f67b-072b-48d0-b11b-05325bf66bc2',
    identity: 'Broad cooling-crust stone golem with a readable face, layered char and subtle sealing marks.',
    scope: 'One ordinary Ashseal Warden identity.',
  },
];

function inspectSkin(root) {
  const meshNode = root.listNodes().find(node => node.getSkin());
  const skin = meshNode?.getSkin();
  const primitive = meshNode?.getMesh()?.listPrimitives()[0];
  if (!skin || !primitive || skin.listJoints().length !== 22) throw new Error('Expected repaired 22-joint humanoid source skin.');
  const joints = primitive.getAttribute('JOINTS_0')?.getArray();
  const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
  const vertices = primitive.getAttribute('POSITION')?.getCount();
  if (!joints || !weights || !vertices) throw new Error('Missing skin attributes.');
  let distributed = 0, maxWeightError = 0;
  for (let i = 0; i < vertices; i++) {
    let sum = 0, active = 0;
    for (let k = 0; k < 4; k++) {
      const weight = weights[i * 4 + k];
      if (weight > 1e-4) active++;
      if (joints[i * 4 + k] >= 22 || !Number.isFinite(weight)) throw new Error('Invalid source joint weight.');
      sum += weight;
    }
    if (active > 1) distributed++;
    maxWeightError = Math.max(maxWeightError, Math.abs(1 - sum));
  }
  if (distributed < vertices * .75 || maxWeightError > 1e-5) throw new Error('Source is not anatomically weighted.');
  return { meshNode, skin, primitive, vertices, joints: 22, distributedVertices: distributed, maximumWeightSumError: maxWeightError };
}

function sampleChannel(channel, time) {
  const sampler = channel.getSampler();
  const times = sampler.getInput().getArray();
  const values = sampler.getOutput().getArray();
  const stride = values.length / times.length;
  let index = 0;
  while (index < times.length - 2 && times[index + 1] < time) index++;
  const alpha = Math.max(0, Math.min(1, (time - times[index]) / (times[index + 1] - times[index] || 1)));
  if (channel.getTargetPath() === 'rotation') {
    return new Quaternion().fromArray(values, index * stride)
      .slerp(new Quaternion().fromArray(values, (index + 1) * stride), alpha).toArray();
  }
  return Array.from({ length: stride }, (_, component) =>
    values[index * stride + component] * (1 - alpha) + values[(index + 1) * stride + component] * alpha);
}

function applyAnimation(animation, time) {
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const value = sampleChannel(channel, time);
    switch (channel.getTargetPath()) {
      case 'translation': node.setTranslation(value); break;
      case 'rotation': node.setRotation(value); break;
      case 'scale': node.setScale(value); break;
    }
  }
}

function weightedBounds(rig) {
  const { skin, primitive } = rig;
  const inverseBind = skin.getInverseBindMatrices();
  const matrixArray = new Array(16);
  const matrices = skin.listJoints().map((joint, index) => {
    inverseBind.getElement(index, matrixArray);
    return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(matrixArray));
  });
  const positions = primitive.getAttribute('POSITION').getArray();
  const jointIndices = primitive.getAttribute('JOINTS_0').getArray();
  const weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const source = new Vector3(), transformed = new Vector3(), result = new Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    source.fromArray(positions, vertex * 3);
    result.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const weight = weights[vertex * 4 + slot];
      if (weight) result.add(transformed.copy(source).applyMatrix4(matrices[jointIndices[vertex * 4 + slot]]).multiplyScalar(weight));
    }
    minY = Math.min(minY, result.y);
    maxY = Math.max(maxY, result.y);
  }
  return { minY, maxY };
}

function settleDeath(doc, rig, presentationScale) {
  const root = doc.getRoot();
  // CPU sampling mutates glTF node TRS; restore the bind pose before serialization.
  const bindPose = root.listNodes().map(node => ({
    node, translation: node.getTranslation(), rotation: node.getRotation(), scale: node.getScale(),
  }));
  const death = root.listAnimations().find(clip => clip.getName() === 'Death');
  const hips = root.listNodes().find(node => node.getName() === 'mixamorigHips');
  const rotation = death.listChannels().find(channel => channel.getTargetNode() === hips && channel.getTargetPath() === 'rotation');
  const translation = death.listChannels().find(channel => channel.getTargetNode() === hips && channel.getTargetPath() === 'translation');
  if (!rotation || !translation) throw new Error('Missing Death hip channels.');
  const collapseTimes = [0, .12, .32, .69, 1.82];
  for (const channel of death.listChannels()) {
    const sampler = channel.getSampler();
    if (sampler.getInput().getCount() !== collapseTimes.length) throw new Error('Unexpected Death key count.');
    sampler.getInput().setArray(Float32Array.from(collapseTimes));
  }
  const angles = [0, -8, -35, -90, -90];
  rotation.getSampler().getOutput().setArray(Float32Array.from(angles.flatMap(degrees => {
    const radians = degrees * Math.PI / 180;
    return [Math.sin(radians / 2), 0, 0, Math.cos(radians / 2)];
  })));
  const duration = Math.max(...death.listSamplers().map(sampler => sampler.getInput().getArray().at(-1)));
  const count = Math.ceil(duration * 60) + 1;
  const times = new Float32Array(count), corrected = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const time = duration * index / (count - 1);
    times[index] = time;
    applyAnimation(death, time);
    const baseline = hips.getTranslation();
    const floor = weightedBounds(rig).minY;
    corrected.set([baseline[0], baseline[1] + (0.003 - floor) / presentationScale, baseline[2]], index * 3);
  }
  const buffer = root.listBuffers()[0];
  translation.getSampler()
    .setInput(doc.createAccessor('Death ground sample times').setType(Accessor.Type.SCALAR).setArray(times).setBuffer(buffer))
    .setOutput(doc.createAccessor('Death grounded hips').setType(Accessor.Type.VEC3).setArray(corrected).setBuffer(buffer));
  const samples = [];
  for (let index = 0; index < count; index++) {
    applyAnimation(death, times[index]);
    const bounds = weightedBounds(rig);
    samples.push(bounds);
  }
  const final = samples.at(-1), initial = samples[0];
  const ratio = (final.maxY - final.minY) / (initial.maxY - initial.minY);
  const floorRange = [Math.min(...samples.map(sample => sample.minY)), Math.max(...samples.map(sample => sample.minY))];
  const oneSecond = samples[Math.round((count - 1) / duration)];
  if (ratio > .6 || Math.abs(final.minY) > .015 || floorRange[0] < -.02) {
    throw new Error(`Death is not grounded collapse: ratio ${ratio.toFixed(3)}, floor ${floorRange}`);
  }
  if (Math.abs(oneSecond.maxY - final.maxY) > .01) throw new Error('Death is not settled before the corpse fade.');
  for (const { node, translation, rotation, scale } of bindPose) {
    node.setTranslation(translation).setRotation(rotation).setScale(scale);
  }
  return { seconds: duration, settleAtSeconds: collapseTimes[3], holdSeconds: duration - collapseTimes[3],
    samples: count, initial, final, heightAtOneSecond: oneSecond.maxY - oneSecond.minY,
    finalHeightRatio: ratio, floorRange };
}

async function emissiveFromSource(sourceTexture, color) {
  const { data, info } = await sharp(sourceTexture.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 3);
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const offset = pixel * 3;
    const bright = Math.max(data[offset], data[offset + 1], data[offset + 2]) / 255;
    const strength = Math.pow(Math.max(0, (bright - .28) / .72), 2) * .65;
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round(color[channel] * strength);
  }
  return sharp(output, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

const catalog = { schema: 'corealm-creature-family-candidates/1', variants: [] };
const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [], files: {} };
for (const variant of variants) {
  const sourceFile = `${sourceDirectory}/${variant.source}`;
  const sourceBytes = await readFile(sourceFile);
  if (hash(sourceBytes) !== variant.sourceSha256) throw new Error(`${variant.source} changed.`);
  const atlasFile = `${directory}/${variant.atlas}`;
  const atlasSource = await readFile(atlasFile);
  const atlasBytes = await sharp(atlasSource).resize(2048, 2048).png().toBuffer();
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const rig = inspectSkin(root);
  const sourcePositions = rig.primitive.getAttribute('POSITION').getArray();
  const sourceHeight = Math.max(...sourcePositions.filter((_, index) => index % 3 === 1));
  const presentation = root.listNodes().find(node => node.getName().endsWith('_Presentation'));
  if (!presentation || sourceHeight <= 0) throw new Error('Missing source presentation node or bounds.');
  const presentationScale = variant.targetHeight / sourceHeight;
  presentation.setScale([presentationScale, presentationScale, presentationScale]);
  const material = root.listMaterials()[0];
  const baseColor = material.getBaseColorTexture(), sourceEmissive = material.getEmissiveTexture();
  if (!baseColor || !material.getNormalTexture() || !material.getMetallicRoughnessTexture() || !sourceEmissive) throw new Error('Source PBR incomplete.');
  baseColor.setImage(atlasBytes).setMimeType('image/png').setName(`${variant.name} layered image-generated atlas`);
  sourceEmissive.setImage(await emissiveFromSource(sourceEmissive, variant.emissiveColor)).setMimeType('image/png')
    .setName(`${variant.name} restrained source-aligned emission`);
  material.setName(`${variant.name} layered PBR`).setEmissiveFactor([1, 1, 1]);
  const death = settleDeath(doc, rig, presentationScale);
  const bytes = await io.writeBinary(doc);
  const candidateFile = `${directory}/${variant.output}`;
  await writeFile(candidateFile, bytes);
  const verified = (await io.readBinary(bytes)).getRoot();
  const verifiedRig = inspectSkin(verified);
  const exportedPositions = verifiedRig.primitive.getAttribute('POSITION').getArray();
  if (sourcePositions.length !== exportedPositions.length || sourcePositions.some((value, index) => value !== exportedPositions[index])) {
    throw new Error('Source geometry changed.');
  }
  const sourceMinX = Math.min(...sourcePositions.filter((_, index) => index % 3 === 0));
  const sourceMaxX = Math.max(...sourcePositions.filter((_, index) => index % 3 === 0));
  const sourceMinZ = Math.min(...sourcePositions.filter((_, index) => index % 3 === 2));
  const sourceMaxZ = Math.max(...sourcePositions.filter((_, index) => index % 3 === 2));
  const bounds = { min: [sourceMinX * presentationScale, 0, sourceMinZ * presentationScale],
    max: [sourceMaxX * presentationScale, variant.targetHeight, sourceMaxZ * presentationScale] };
  const size = { x: bounds.max[0] - bounds.min[0], y: variant.targetHeight, z: bounds.max[2] - bounds.min[2] };
  const clips = verified.listAnimations().map(animation => ({
    name: animation.getName(), seconds: Math.max(...animation.listSamplers().map(sampler => sampler.getInput().getArray().at(-1))),
    channels: animation.listChannels().length,
  }));
  if (clips.length !== 6 || ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].some(name => !clips.some(clip => clip.name === name))) {
    throw new Error('Required source clips changed.');
  }
  const textures = verified.listTextures().map(texture => ({ name: texture.getName(), mimeType: texture.getMimeType(),
    bytes: texture.getImage().length, sha256: hash(texture.getImage()) }));
  const acceptance = { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false,
    texturesAccepted: false, labAccepted: false, worldIntegrated: false };
  const entry = { id: variant.id, name: variant.name, status: 'awaiting-root-lab-review', sourceFile,
    sourceSha256: variant.sourceSha256, sourceModelId: variant.sourceModelId, sourceCardId: variant.sourceCardId,
    candidateFile, sha256: hash(bytes), bytes: bytes.length, atlas: { file: atlasFile, sha256: hash(atlasSource),
      runtimeSha256: hash(atlasBytes), dimensions: [2048, 2048], method: 'imagegen edit of source UV atlas' },
    geometry: { vertices: rig.vertices, triangles: variant.id === 'creature_voidstone_colossus' ? 8502 : 8467,
      originalPositionsPreserved: true, addedGeometry: false },
    rig: { joints: rig.joints, distributedVertices: rig.distributedVertices, maximumWeightSumError: rig.maximumWeightSumError },
    size, bounds, death, clips, textures, identity: variant.identity, scope: variant.scope, acceptance };
  catalog.variants.push(entry);
  lab.assets.push({ id: variant.id, file: `models/creature/${variant.id}.glb`, pack: 'corealm-tripo-audit-volcanic-golems',
    category: 'character', is: variant.name, tags: variant.tags, bytes: entry.bytes, sha256: entry.sha256,
    size, base: { x: bounds.min[0], y: 0, z: bounds.min[2] }, bounds, groundY: 0,
    triangles: entry.geometry.triangles, animations: clips.map(clip => clip.name), materials: verified.listMaterials().map(item => item.getName()),
    walkClipSeconds: clips.find(clip => clip.name === 'Walk').seconds,
    runClipSeconds: clips.find(clip => clip.name === 'Run').seconds,
    gaitCalibration: { status: 'uncalibrated', impliedWalkMps: null, impliedRunMps: null },
    sourceProvenance: { sourceFile, sourceSha256: variant.sourceSha256, sourceModelId: variant.sourceModelId,
      atlasFile, atlasSha256: entry.atlas.sha256, candidateFile, candidateSha256: entry.sha256 }, acceptance });
  lab.files[variant.id] = variant.output;
}
await writeFile(`${directory}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(`${directory}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
console.log(JSON.stringify(catalog.variants.map(({ id, sha256, size, death }) => ({ id, sha256, size, death })), null, 2));
