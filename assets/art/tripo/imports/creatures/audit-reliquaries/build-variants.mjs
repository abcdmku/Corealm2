import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Vector3, Quaternion, Euler } from 'three';
import sharp from 'sharp';

const directory = 'assets/art/tripo/imports/creatures/audit-reliquaries';
const sourceFile = 'assets/art/tripo/imports/creatures/dewglass-reliquary/dewglass-reliquary-native-rig-candidate.glb';
const sourceSha256 = 'f25287df6b753170f56027f77e28d34a86f523687029b5ba13e39734c2d21b8f';
const sourceBytes = await readFile(sourceFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(sourceBytes) !== sourceSha256) throw new Error('Dewglass Reliquary source changed.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const variants = [
  { id: 'fairy_garden_reliquary_gloamgarden', name: 'Dewglass Reliquary', targetHeight: 1.05,
    atlas: 'textures/dewglass-basecolor.png', output: 'dewglass-reliquary-candidate.glb',
    tags: ['fairy', 'fantastical', 'reliquary', 'dewglass', 'vessel', 'four-legged', 'image-generated-texture'],
    glow: [25, 68, 75], identity: 'Small living dewglass vessel on carved root supports, with layered nacre and a translucent aqua reservoir.' },
  { id: 'fairy_garden_reliquary_faeholme', name: 'Starporcelain Reliquary', targetHeight: 1.7,
    atlas: 'textures/starporcelain-basecolor.png', output: 'starporcelain-reliquary-candidate.glb',
    tags: ['fairy', 'fantastical', 'reliquary', 'starporcelain', 'vessel', 'four-legged', 'image-generated-texture'],
    glow: [49, 39, 105], identity: 'Elite living starporcelain shrine-vessel with carved ceramic relief, mineral inlay and starlight cracks.' },
];
const q = (x = 0, y = 0, z = 0) => new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')).toArray();

function inspectSkin(root) {
  const meshNode = root.listNodes().find(node => node.getSkin());
  const skin = meshNode?.getSkin(), primitive = meshNode?.getMesh()?.listPrimitives()[0];
  if (!skin || !primitive || skin.listJoints().length !== 14 || primitive.getAttribute('POSITION').getCount() !== 3173) {
    throw new Error('Expected repaired 14-joint source skin.');
  }
  const joints = primitive.getAttribute('JOINTS_0').getArray(), weights = primitive.getAttribute('WEIGHTS_0').getArray();
  let multiInfluence = 0, maxError = 0;
  for (let i = 0; i < 3173; i++) {
    let sum = 0, active = 0;
    for (let k = 0; k < 4; k++) {
      const index = i * 4 + k, weight = weights[index];
      if (joints[index] >= 14 || !Number.isFinite(weight)) throw new Error('Invalid source weight.');
      sum += weight; if (weight > 1e-4) active++;
    }
    if (active > 1) multiInfluence++;
    maxError = Math.max(maxError, Math.abs(1 - sum));
  }
  if (multiInfluence < 3000 || maxError > 1e-5) throw new Error('Source skin is effectively rigid.');
  return { meshNode, skin, primitive, joints: 14, vertices: 3173, multiInfluence, maxWeightSumError: maxError };
}

function animationChannel(animation, boneName, path = 'rotation') {
  return animation.listChannels().find(channel => channel.getTargetNode()?.getName() === boneName && channel.getTargetPath() === path);
}
function setRotation(animation, boneName, eulers) {
  const channel = animationChannel(animation, boneName);
  if (!channel || channel.getSampler().getInput().getCount() !== eulers.length) throw new Error(`Missing ${animation.getName()} ${boneName} rotation.`);
  channel.getSampler().getOutput().setArray(Float32Array.from(eulers.flatMap(angles => q(...angles))));
}

function repairGait(animation, run) {
  const amplitude = run ? .58 : .38;
  const knee = run ? .48 : .34;
  for (const part of ['Fore', 'Hind']) for (const side of ['Near', 'Far']) {
    const phaseOffset = (part === 'Hind' ? Math.PI : 0) + (side === 'Far' ? Math.PI : 0);
    const phases = [0, 1, 2, 3, 4].map(index => index * Math.PI / 2 + phaseOffset);
    setRotation(animation, `${part}${side}Upper`, phases.map(phase =>
      [amplitude * Math.sin(phase), 0, .07 * Math.cos(phase)]));
    setRotation(animation, `${part}${side}Lower`, phases.map(phase =>
      [-.10 - knee * Math.max(0, Math.sin(phase)), 0, 0]));
  }
  setRotation(animation, 'ReservoirBody', [[0, 0, .012], [0, 0, -.025], [0, 0, .012], [0, 0, -.025], [0, 0, .012]]);
  setRotation(animation, 'Neck', [[0, 0, 0], [.035, 0, -.012], [0, 0, 0], [-.035, 0, .012], [0, 0, 0]]);
}

function repairAttack(animation) {
  setRotation(animation, 'ReservoirBody', [[0, 0, 0], [0, 0, -.09], [0, 0, .23], [0, 0, .04], [0, 0, 0]]);
  setRotation(animation, 'Neck', [[0, 0, 0], [.11, 0, -.09], [.28, 0, .22], [.05, 0, .04], [0, 0, 0]]);
  setRotation(animation, 'Head', [[0, 0, 0], [.18, 0, -.05], [.43, 0, .17], [.08, 0, .03], [0, 0, 0]]);
}

function repairDeath(doc, root, uniformScale) {
  const death = root.listAnimations().find(animation => animation.getName() === 'Death');
  const times = [0, .11, .3, .62, 1.62];
  for (const channel of death.listChannels()) {
    const sampler = channel.getSampler();
    if (sampler.getInput().getCount() !== 5) throw new Error('Unexpected Death key count.');
    sampler.getInput().setArray(Float32Array.from(times));
  }
  setRotation(death, 'ReliquaryRoot', [[0, 0, 0], [0, 0, -.20], [0, 0, -.78], [0, 0, -Math.PI * 95 / 180], [0, 0, -Math.PI * 95 / 180]]);
  const rig = root.listNodes().find(node => node.getName() === 'DewglassReliquaryRig');
  const buffer = root.listBuffers()[0];
  const sampler = doc.createAnimationSampler('Death shell settle').setInput(doc.createAccessor('Death shell settle times')
    .setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer))
    .setOutput(doc.createAccessor('Death shell settle scale').setType(Accessor.Type.VEC3)
      .setArray(Float32Array.from([1, .98, .9, .8, .8].flatMap(fraction => [uniformScale, uniformScale * fraction, uniformScale])))
      .setBuffer(buffer)).setInterpolation('LINEAR');
  death.addSampler(sampler).addChannel(doc.createAnimationChannel('Death shell settle')
    .setTargetNode(rig).setTargetPath('scale').setSampler(sampler));
  return times[3];
}

function sampleChannel(channel, time) {
  const sampler = channel.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
  const stride = values.length / times.length;
  let key = 0;
  while (key < times.length - 2 && times[key + 1] < time) key++;
  const amount = Math.max(0, Math.min(1, (time - times[key]) / (times[key + 1] - times[key] || 1)));
  if (channel.getTargetPath() === 'rotation') return new Quaternion().fromArray(values, key * stride)
    .slerp(new Quaternion().fromArray(values, (key + 1) * stride), amount).toArray();
  return Array.from({ length: stride }, (_, component) =>
    values[key * stride + component] * (1 - amount) + values[(key + 1) * stride + component] * amount);
}
function applyAnimation(animation, time) {
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode(), value = sampleChannel(channel, time);
    switch (channel.getTargetPath()) {
      case 'rotation': node.setRotation(value); break;
      case 'translation': node.setTranslation(value); break;
      case 'scale': node.setScale(value); break;
    }
  }
}

function weightedPositions(rig) {
  const inverse = rig.skin.getInverseBindMatrices(), element = new Array(16);
  const matrices = rig.skin.listJoints().map((joint, index) => {
    inverse.getElement(index, element);
    return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(element));
  });
  const positions = rig.primitive.getAttribute('POSITION').getArray();
  const joints = rig.primitive.getAttribute('JOINTS_0').getArray(), weights = rig.primitive.getAttribute('WEIGHTS_0').getArray();
  const output = new Float32Array(positions.length), source = new Vector3(), transformed = new Vector3(), result = new Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let vertex = 0; vertex < rig.vertices; vertex++) {
    source.fromArray(positions, vertex * 3); result.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const weight = weights[vertex * 4 + slot];
      if (weight) result.add(transformed.copy(source).applyMatrix4(matrices[joints[vertex * 4 + slot]]).multiplyScalar(weight));
    }
    result.toArray(output, vertex * 3);
    minY = Math.min(minY, result.y); maxY = Math.max(maxY, result.y);
  }
  return { minY, maxY, positions: output };
}

function groundClip(doc, animation, rig, uniformScale) {
  const root = doc.getRoot(), rigNode = root.listNodes().find(node => node.getName() === 'DewglassReliquaryRig');
  const actorRoot = root.listNodes().find(node => node.getName() === 'ReliquaryRoot');
  const bindPose = root.listNodes().map(node => ({ node, translation: node.getTranslation(),
    rotation: node.getRotation(), scale: node.getScale() }));
  const actorBindTranslation = actorRoot.getTranslation();
  const seconds = Math.max(...animation.listSamplers().map(sampler => sampler.getInput().getArray().at(-1)));
  const count = Math.ceil(seconds * 60) + 1;
  const times = new Float32Array(count), output = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const time = seconds * index / (count - 1);
    times[index] = time;
    actorRoot.setTranslation(actorBindTranslation);
    applyAnimation(animation, time);
    const floor = weightedPositions(rig).minY;
    const scaleY = rigNode.getScale()[1];
    output.set([actorBindTranslation[0], actorBindTranslation[1] + (.003 - floor) / scaleY, actorBindTranslation[2]], index * 3);
  }
  const buffer = root.listBuffers()[0];
  const sampler = doc.createAnimationSampler(`${animation.getName()} grounded root`)
    .setInput(doc.createAccessor(`${animation.getName()} grounded times`).setType(Accessor.Type.SCALAR).setArray(times).setBuffer(buffer))
    .setOutput(doc.createAccessor(`${animation.getName()} grounded root`).setType(Accessor.Type.VEC3).setArray(output).setBuffer(buffer))
    .setInterpolation('LINEAR');
  animation.addSampler(sampler).addChannel(doc.createAnimationChannel(`${animation.getName()} grounded root`)
    .setTargetNode(actorRoot).setTargetPath('translation').setSampler(sampler));
  let minFloor = Infinity, maxFloor = -Infinity, maxY = -Infinity, final = null, atOneSecond = null;
  let firstPositions = null, maxVertexDisplacement = 0;
  for (let index = 0; index < count; index++) {
    applyAnimation(animation, times[index]);
    const sampled = weightedPositions(rig);
    minFloor = Math.min(minFloor, sampled.minY); maxFloor = Math.max(maxFloor, sampled.minY);
    maxY = Math.max(maxY, sampled.maxY);
    if (!firstPositions) firstPositions = sampled.positions;
    for (let component = 0; component < sampled.positions.length; component += 3) {
      const distance = Math.hypot(sampled.positions[component] - firstPositions[component],
        sampled.positions[component + 1] - firstPositions[component + 1],
        sampled.positions[component + 2] - firstPositions[component + 2]);
      maxVertexDisplacement = Math.max(maxVertexDisplacement, distance);
    }
    if (Math.abs(times[index] - 1) < seconds / (count - 1) / 2) atOneSecond = sampled;
    if (index === count - 1) final = sampled;
  }
  if (minFloor < -.02 || maxFloor > .025) throw new Error(`${animation.getName()} floor not grounded: ${minFloor}, ${maxFloor}`);
  const metrics = { seconds, samples: count, floorRange: [minFloor, maxFloor], maxVertexDisplacement,
    maxHeight: maxY, finalHeight: final.maxY - final.minY };
  if (animation.getName() === 'Death') {
    const sample = atOneSecond ?? final;
    metrics.heightAtOneSecond = sample.maxY - sample.minY;
    metrics.finalHeightRatio = metrics.finalHeight / uniformScale;
    if (metrics.finalHeightRatio > .61 || Math.abs(metrics.heightAtOneSecond - metrics.finalHeight) > .02) {
      throw new Error(`Death did not collapse by 1s: ${JSON.stringify(metrics)}`);
    }
  }
  for (const { node, translation, rotation, scale } of bindPose) node.setTranslation(translation).setRotation(rotation).setScale(scale);
  return metrics;
}

async function makeEmission(sourceBaseColor, color) {
  const { data, info } = await sharp(sourceBaseColor).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 3);
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const offset = pixel * 3, red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    const water = Math.max(0, Math.min(1, ((green + blue) / 2 - red - 12) / 95));
    const strength = Math.pow(water, 1.6) * .7;
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round(color[channel] * strength);
  }
  return sharp(output, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

const catalog = { schema: 'corealm-creature-family-candidates/1', source: { file: sourceFile, sha256: sourceSha256,
  originalTripoSource: 'assets/art/tripo/exports/corealm_dewglass_reliquary_d95af2cf_8k_rigged.glb',
  originalTripoSha256: '93cf506871643de157ede59b35972fbf61befd0be0934fe6df1b14963b0eed35',
  modelId: 'd95af2cf-3b9a-498d-9403-7a55fd873a73' }, variants: [] };
const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [], files: {} };
for (const variant of variants) {
  const atlasFile = `${directory}/${variant.atlas}`, atlasSource = await readFile(atlasFile);
  const atlasBytes = await sharp(atlasSource).resize(2048, 2048).png().toBuffer();
  const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
  const rig = inspectSkin(root), primitive = rig.primitive;
  const originalPositions = primitive.getAttribute('POSITION').getArray();
  const originalIndex = primitive.getIndices().getArray();
  const originalUV = primitive.getAttribute('TEXCOORD_0').getArray();
  const originalBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: -Infinity };
  for (let index = 0; index < originalPositions.length; index += 3) {
    originalBounds.minX = Math.min(originalBounds.minX, originalPositions[index]);
    originalBounds.maxX = Math.max(originalBounds.maxX, originalPositions[index]);
    originalBounds.maxY = Math.max(originalBounds.maxY, originalPositions[index + 1]);
    originalBounds.minZ = Math.min(originalBounds.minZ, originalPositions[index + 2]);
    originalBounds.maxZ = Math.max(originalBounds.maxZ, originalPositions[index + 2]);
  }
  const uniformScale = variant.targetHeight / originalBounds.maxY;
  const rigNode = root.listNodes().find(node => node.getName() === 'DewglassReliquaryRig');
  rigNode.setScale([uniformScale, uniformScale, uniformScale]);
  const material = root.listMaterials()[0];
  const baseColor = material.getBaseColorTexture(), originalBaseColor = baseColor.getImage();
  if (!baseColor || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw new Error('Source PBR maps incomplete.');
  baseColor.setImage(atlasBytes).setMimeType('image/png').setName(`${variant.name} intricate image-generated atlas`);
  material.setName(`${variant.name} layered ceramic PBR`);
  const emission = doc.createTexture(`${variant.name} subtle reservoir emission`)
    .setImage(await makeEmission(originalBaseColor, variant.glow)).setMimeType('image/png');
  material.setEmissiveTexture(emission).setEmissiveFactor([1, 1, 1]);
  repairGait(root.listAnimations().find(animation => animation.getName() === 'Walk'), false);
  repairGait(root.listAnimations().find(animation => animation.getName() === 'Run'), true);
  repairAttack(root.listAnimations().find(animation => animation.getName() === 'Attack'));
  const settleAtSeconds = repairDeath(doc, root, uniformScale);
  const motion = {};
  for (const name of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) {
    motion[name] = groundClip(doc, root.listAnimations().find(animation => animation.getName() === name), rig, uniformScale);
  }
  if (motion.Walk.maxVertexDisplacement < .1 * uniformScale || motion.Run.maxVertexDisplacement < .18 * uniformScale) {
    throw new Error('Locomotion remains nearly static.');
  }
  const bytes = await io.writeBinary(doc), candidateFile = `${directory}/${variant.output}`;
  await writeFile(candidateFile, bytes);
  const verified = (await io.readBinary(bytes)).getRoot(), verifiedRig = inspectSkin(verified);
  const positions = verifiedRig.primitive.getAttribute('POSITION').getArray();
  const indices = verifiedRig.primitive.getIndices().getArray(), uvs = verifiedRig.primitive.getAttribute('TEXCOORD_0').getArray();
  if (originalPositions.some((value, index) => value !== positions[index]) ||
    originalIndex.some((value, index) => value !== indices[index]) ||
    originalUV.some((value, index) => value !== uvs[index])) throw new Error('Source geometry or UV layout changed.');
  const bounds = { min: [originalBounds.minX * uniformScale, 0, originalBounds.minZ * uniformScale],
    max: [originalBounds.maxX * uniformScale, variant.targetHeight, originalBounds.maxZ * uniformScale] };
  const size = { x: bounds.max[0] - bounds.min[0], y: variant.targetHeight, z: bounds.max[2] - bounds.min[2] };
  const clips = verified.listAnimations().map(animation => ({ name: animation.getName(),
    seconds: Math.max(...animation.listSamplers().map(sampler => sampler.getInput().getArray().at(-1))),
    channels: animation.listChannels().length }));
  const textures = verified.listTextures().map(texture => ({ name: texture.getName(), mimeType: texture.getMimeType(),
    bytes: texture.getImage().length, sha256: hash(texture.getImage()) }));
  const acceptance = { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false,
    labAccepted: false, worldIntegrated: false };
  const entry = { id: variant.id, name: variant.name, status: 'awaiting-root-lab-review', sourceFile,
    sourceSha256, candidateFile, sha256: hash(bytes), bytes: bytes.length,
    atlas: { file: atlasFile, sha256: hash(atlasSource), runtimeSha256: hash(atlasBytes), dimensions: [2048, 2048],
      method: 'imagegen edit preserving source UV atlas' },
    geometry: { vertices: 3173, triangles: 5242, sourceGeometryAndUvsPreserved: true },
    rig: { joints: 14, multiInfluenceVertices: rig.multiInfluence, maximumWeightSumError: rig.maxWeightSumError },
    size, bounds, motion, death: { ...motion.Death, settleAtSeconds, holdSeconds: motion.Death.seconds - settleAtSeconds },
    clips, textures, identity: variant.identity, acceptance };
  catalog.variants.push(entry);
  lab.assets.push({ id: variant.id, file: `models/fairy-garden/${variant.id}.glb`,
    pack: 'corealm-tripo-fairy-reliquaries', category: 'character', is: variant.name,
    tags: variant.tags, bytes: bytes.length, sha256: entry.sha256, size,
    base: { x: bounds.min[0], y: 0, z: bounds.min[2] }, bounds, groundY: 0, triangles: 5242,
    animations: clips.map(clip => clip.name), materials: verified.listMaterials().map(item => item.getName()),
    walkClipSeconds: clips.find(clip => clip.name === 'Walk').seconds,
    runClipSeconds: clips.find(clip => clip.name === 'Run').seconds,
    gaitCalibration: { status: 'uncalibrated', impliedWalkMps: null, impliedRunMps: null },
    sourceProvenance: { sourceFile, sourceSha256, atlasFile, atlasSha256: entry.atlas.sha256,
      candidateFile, candidateSha256: entry.sha256 }, acceptance });
  lab.files[variant.id] = variant.output;
}
await writeFile(`${directory}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(`${directory}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
const builderFile = `${directory}/build-variants.mjs`;
const builderSha256 = hash(await readFile(builderFile));
const promotion = {
  schema: 'corealm-creature-promotion/1', sourceRoot: '.', destinationRoot: 'game/public/assets',
  assets: catalog.variants.map((entry, index) => {
    const labEntry = lab.assets[index];
    const clipSeconds = Object.fromEntries(entry.clips.map(clip => [clip.name, clip.seconds]));
    return {
      id: entry.id, candidateFile: entry.candidateFile, file: labEntry.file, pack: labEntry.pack,
      category: labEntry.category, is: entry.name, tags: labEntry.tags,
      bytes: entry.bytes, sha256: entry.sha256, triangles: entry.geometry.triangles,
      size: entry.size, base: labEntry.base, bounds: entry.bounds, groundY: 0,
      animations: labEntry.animations, materials: labEntry.materials,
      walkClipSeconds: clipSeconds.Walk, runClipSeconds: clipSeconds.Run,
      attackSeconds: clipSeconds.Attack, contactNormalized: 0.5,
      impliedWalkMps: null, impliedRunMps: null, locomotionPolicy: null, measuredGait: null,
      metadata: {
        id: entry.id, species: entry.name,
        rig: 'Corealm repaired 14-joint four-legged skin with distributed weights',
        sourceGeometry: 'Original Tripo 3173 vertices and 5242 triangles preserved',
        textureMaps: entry.textures.map(texture => texture.name),
        motion: 'Six clips; grounded four-leg gait; forward shell collapse by 0.62 seconds; speeds uncalibrated',
        attackContact: 0.5, presentationHeightMeters: entry.size.y,
        identity: entry.identity,
      },
      sourceProvenance: {
        generator: 'Tripo Studio and Corealm image-generated atlas adaptation',
        modelId: catalog.source.modelId,
        originalSourceFile: catalog.source.originalTripoSource,
        originalSourceSha256: catalog.source.originalTripoSha256,
        riggedSourceFile: sourceFile, riggedSourceSha256: sourceSha256,
        candidateFile: entry.candidateFile, candidateSha256: entry.sha256,
        materialGenerator: builderFile, materialGeneratorSha256: builderSha256,
        generatedBaseColorFile: entry.atlas.file, generatedBaseColorSha256: entry.atlas.sha256,
        runtimeTextures: entry.textures, rig: entry.rig, death: entry.death,
        clipSeconds, sourceGeometryPreserved: true,
      },
      acceptance: entry.acceptance,
    };
  }),
  pack: {
    id: 'corealm-tripo-fairy-reliquaries', name: 'Corealm Tripo audited fairy reliquaries',
    author: 'Corealm', source: builderFile, generatorSha256: builderSha256,
    license: 'LicenseRef-Corealm-Original',
  },
};
await writeFile(`${directory}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n');
console.log(JSON.stringify(catalog.variants.map(({ id, sha256, size, motion, death }) =>
  ({ id, sha256, size, gait: { Walk: motion.Walk.maxVertexDisplacement, Run: motion.Run.maxVertexDisplacement }, death })), null, 2));
