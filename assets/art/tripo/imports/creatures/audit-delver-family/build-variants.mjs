import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const directory = 'assets/art/tripo/imports/creatures/audit-delver-family';
const sourceFile = 'assets/art/tripo/imports/creatures/nine-pack-two/strata-delver/strata-delver-native-rig-candidate.glb';
const sourceSha256 = 'b27a5ac2272d822a9d6457399238f9b9a1eba5b131c089a97a493cad9c25de16';
const sourceBytes = await readFile(sourceFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(sourceBytes) !== sourceSha256) throw new Error('Strata Delver source changed.');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const variants = [
  {
    id: 'creature_slag_crawler', name: 'Slag Crawler', atlas: 'textures/slag-basecolor.png',
    output: 'slag-crawler-candidate.glb', bodyHeight: .72, tier: 'roughly level 20-28',
    tags: ['creature', 'mineral', 'crawler', 'six-legged', 'slag', 'cooling-crust', 'image-generated-texture'],
    notes: 'Young compact mineral crawler with cooling slag crust, soot and fine molten seams.',
    timeScale: 1, roughness: .86,
  },
  {
    id: 'creature_cinderback_crag', name: 'Cinderback Crag', atlas: 'textures/crag-basecolor.png',
    output: 'cinderback-crag-candidate.glb', bodyHeight: 1.70, tier: 'roughly level 70-90',
    tags: ['creature', 'mineral', 'crawler', 'six-legged', 'basalt', 'ember-fissures', 'image-generated-texture'],
    notes: 'Mature heavy mineral crawler with naturally layered basalt ridges and deep ember fissures.',
    timeScale: 1.25, roughness: .91,
  },
];

function inspectWeights(primitive, jointCount) {
  const joints = primitive.getAttribute('JOINTS_0')?.getArray();
  const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
  const count = primitive.getAttribute('POSITION')?.getCount();
  if (!joints || !weights || count !== 3238 || jointCount !== 10) throw new Error('Missing validated 10-joint source skin.');
  let distributed = 0, rootDominated = 0, maxError = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    let sum = 0, active = 0, best = 0, bestWeight = -1;
    for (let slot = 0; slot < 4; slot++) {
      const index = vertex * 4 + slot, weight = weights[index], joint = joints[index];
      if (joint >= jointCount || weight < 0 || !Number.isFinite(weight)) throw new Error('Invalid skin influence.');
      sum += weight; if (weight > 1e-4) active++;
      if (weight > bestWeight) { bestWeight = weight; best = joint; }
    }
    if (active > 1) distributed++;
    if (best === 0) rootDominated++;
    maxError = Math.max(maxError, Math.abs(sum - 1));
  }
  if (distributed < count * .7 || rootDominated > 10 || maxError > 1e-5) {
    throw new Error('Staged source skin is not an anatomical repair.');
  }
  return { vertices: count, joints: jointCount, distributedVertices: distributed, rootDominatedVertices: rootDominated, maximumWeightSumError: maxError };
}

function repairDeath(doc) {
  const animation = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death');
  const channels = animation.listChannels();
  const radians = degrees => degrees * Math.PI / 180;
  const zQuaternion = degrees => [0, 0, Math.sin(radians(degrees) / 2), Math.cos(radians(degrees) / 2)];
  const outputs = new Map([
    ['Body:rotation', [0, 5, 11, 15, 15].flatMap(zQuaternion)],
    ['Body:translation', [.28, .31, .22, .13, .13].flatMap(y => [0, y, 0])],
  ]);
  for (const part of ['FrontLeg', 'MiddleLeg', 'RearLeg']) for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    outputs.set(`${part}_${side}:rotation`, [0, 22, 60, 90, 90].flatMap(degrees => zQuaternion(sign * degrees)));
  }
  for (const channel of channels) {
    const key = `${channel.getTargetNode().getName()}:${channel.getTargetPath()}`;
    if (outputs.has(key)) channel.getSampler().getOutput().setArray(Float32Array.from(outputs.get(key)));
  }
  const body = doc.getRoot().listNodes().find(node => node.getName() === 'Body');
  const times = channels.find(channel => channel.getTargetNode() === body).getSampler().getInput();
  animation.addSampler(doc.createAnimationSampler('Death body settle scale')
    .setInput(times)
    .setOutput(doc.createAccessor('Death body settle scale').setType(Accessor.Type.VEC3)
      .setArray(Float32Array.from([1,.94,.8,.66,.65].flatMap(y => [1,y,1])))
      .setBuffer(doc.getRoot().listBuffers()[0]))
    .setInterpolation('LINEAR'));
  animation.addChannel(doc.createAnimationChannel('Death body settle')
    .setTargetNode(body).setTargetPath('scale').setSampler(animation.listSamplers().at(-1)));
}

const catalog = {
  schema: 'corealm-creature-family-candidates/1',
  source: {
    file: sourceFile, sha256: sourceSha256, bytes: sourceBytes.length,
    tripoModelId: '707c39cd-4a8e-40c4-8ecf-ca03814e8a06',
    rawExport: 'assets/art/tripo/exports/corealm_strata_delver_707c39cd_8k_rigged.glb',
    rawExportSha256: '881924b696f4ecf293da332b8d5e2e50052f4ceaa3fbc06383422c14a990abaf',
    originalBaseColor: 'assets/art/tripo/imports/creatures/nine-pack-two/strata-delver/strata-delver-basecolor-2k.jpg',
    originalNormal: 'assets/art/tripo/imports/creatures/nine-pack-two/strata-delver/strata-delver-normal-2k.png',
    originalOrm: 'assets/art/tripo/imports/creatures/nine-pack-two/strata-delver/strata-delver-orm-2k.png',
  },
  variants: [],
};
const labAssets = [], files = {};
for (const variant of variants) {
  const atlasPath = directory + '/' + variant.atlas;
  const atlasInput = await readFile(atlasPath);
  const atlasMeta = await sharp(atlasInput).metadata();
  if (atlasMeta.width < 1024 || atlasMeta.height < 1024) throw new Error(variant.name + ' atlas is too small.');
  const atlasBytes = await sharp(atlasInput).resize(2048, 2048).png().toBuffer();
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const skin = root.listSkins()[0];
  const rigAudit = inspectWeights(primitive, skin.listJoints().length);
  const clipNames = root.listAnimations().map(animation => animation.getName());
  if (['Idle','Walk','Run','Attack','Hit','Death'].some(name => !clipNames.includes(name))) throw new Error('Missing source motion clip.');
  const material = root.listMaterials()[0];
  if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) throw new Error('Source PBR maps missing.');
  material.getBaseColorTexture().setImage(atlasBytes).setMimeType('image/png').setName(variant.name + ' layered image-generated atlas');
  material.setName(variant.name + ' layered mineral PBR').setMetallicFactor(.03).setRoughnessFactor(variant.roughness);
  const rig = root.listNodes().find(node => node.getName() === 'Strata_Delver_Rig');
  if (!rig) throw new Error('Missing validated rig node.');
  const sourceHeight = .5473633408546448;
  const uniformScale = variant.bodyHeight / sourceHeight;
  rig.setScale([uniformScale, uniformScale, uniformScale]);
  repairDeath(doc);
  if (variant.timeScale !== 1) for (const animation of root.listAnimations()) {
    const seen = new Set();
    for (const sampler of animation.listSamplers()) {
      const input = sampler.getInput();
      if (seen.has(input)) continue;
      seen.add(input);
      input.setArray(Float32Array.from(input.getArray(), value => value * variant.timeScale));
    }
  }
  const bytes = await io.writeBinary(doc);
  const outputPath = directory + '/' + variant.output;
  await writeFile(outputPath, bytes);
  const verified = await io.readBinary(bytes);
  const verifiedRoot = verified.getRoot();
  const verifiedPrimitive = verifiedRoot.listMeshes()[0].listPrimitives()[0];
  inspectWeights(verifiedPrimitive, verifiedRoot.listSkins()[0].listJoints().length);
  const verifiedClips = verifiedRoot.listAnimations().map(animation => ({
    name: animation.getName(),
    seconds: Math.max(...animation.listSamplers().map(sampler => sampler.getInput().getArray().at(-1))),
  }));
  if (verifiedClips.length !== 6) throw new Error('Exported clip count changed.');
  const sourcePositions = primitive.getAttribute('POSITION').getArray();
  const outputPositions = verifiedPrimitive.getAttribute('POSITION').getArray();
  if (sourcePositions.length !== outputPositions.length || sourcePositions.some((value, index) => value !== outputPositions[index])) {
    throw new Error('Source body geometry changed.');
  }
  const sourceBounds = { min: [-.303955078125, 0, -.499755859375], max: [.303955078125, .5473633408546448, .499755859375] };
  const maxY = sourceBounds.max[1];
  const bounds = {
    min: [sourceBounds.min[0] * uniformScale, 0, sourceBounds.min[2] * uniformScale],
    max: [sourceBounds.max[0] * uniformScale, maxY * uniformScale, sourceBounds.max[2] * uniformScale],
  };
  const size = { x: bounds.max[0] - bounds.min[0], y: bounds.max[1], z: bounds.max[2] - bounds.min[2] };
  const sha256 = hash(bytes);
  const textureMetadata = root.listTextures().map(texture => ({
    name: texture.getName(), mimeType: texture.getMimeType(),
    bytes: texture.getImage().length, sha256: hash(texture.getImage()),
  }));
  const entry = {
    id: variant.id, name: variant.name, status: 'awaiting-root-lab-review',
    sourceFile, candidateFile: outputPath, sha256, bytes: bytes.length,
    atlas: { file: atlasPath, sourceSha256: hash(atlasInput), runtimeSha256: hash(atlasBytes), dimensions: [2048, 2048], method: 'imagegen edit of source UV atlas' },
    geometry: { sourceVertices: rigAudit.vertices, sourceTriangles: 5310, addedPlateTriangles: 0, uvLayoutPreserved: true },
    rig: rigAudit, uniformScale, bodyHeight: variant.bodyHeight, bounds, size,
    textures: textureMetadata, clips: verifiedClips,
    identity: variant.notes, intendedTier: variant.tier,
    acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
  catalog.variants.push(entry);
  const current = verifiedRoot.listMaterials().map(item => item.getName());
  labAssets.push({
    id: variant.id, file: 'models/creature/' + variant.id + '.glb', pack: 'corealm-tripo-mineral-crawlers',
    category: 'character', is: variant.name, tags: variant.tags, bytes: bytes.length, sha256,
    size, base: { x: bounds.min[0], y: 0, z: bounds.min[2] }, bounds, groundY: 0,
    triangles: 5310, animations: verifiedClips.map(clip => clip.name), materials: current,
    walkClipSeconds: verifiedClips.find(clip => clip.name === 'Walk').seconds,
    runClipSeconds: verifiedClips.find(clip => clip.name === 'Run').seconds,
    gaitCalibration: { status: 'uncalibrated', impliedWalkMps: null, impliedRunMps: null },
    sourceProvenance: { sourceFile, sourceSha256, atlasFile: atlasPath, atlasSha256: hash(atlasInput), candidateFile: outputPath, candidateSha256: sha256 },
    acceptance: entry.acceptance,
  });
  files[variant.id] = variant.output;
}
await writeFile(directory + '/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
await writeFile(directory + '/lab-catalog.json', JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: labAssets, files }, null, 2) + '\n');
console.log(JSON.stringify({ variants: catalog.variants.map(({ id, sha256, bytes, size, geometry, clips }) => ({ id, sha256, bytes, size, geometry, clips })) }, null, 2));
