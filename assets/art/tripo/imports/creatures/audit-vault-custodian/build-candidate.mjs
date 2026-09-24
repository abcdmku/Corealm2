import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';

const directory = 'assets/art/tripo/imports/creatures/audit-vault-custodian';
const sourceFile = 'assets/art/tripo/imports/creatures/vault-custodian/models/creature_vault_custodian.glb';
const originalSourceFile = 'assets/art/tripo/exports/corealm_vault_custodian_55366bfe_8k_rigged.glb';
const candidateFile = `${directory}/vault-custodian-candidate.glb`;
const builderFile = `${directory}/build-candidate.mjs`;
const id = 'creature_vault_custodian';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const originalBytes = await readFile(originalSourceFile);
const originalSourceSha256 = hash(originalBytes);
const sourceSha256 = hash(sourceBytes);
const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
const meshNode = root.listNodes().find(node => node.getSkin());
const skin = meshNode?.getSkin(), primitive = meshNode?.getMesh()?.listPrimitives()[0];
const ground = root.listNodes().find(node => node.getName() === 'corealm_motion_ground');
const scaleNode = root.listNodes().find(node => node.getName() === 'corealm_creature_vault_custodian');
if (!skin || !primitive || !ground || !scaleNode || skin.listJoints().length !== 54 ||
    primitive.getAttribute('POSITION')?.getCount() !== 3290) throw new Error('Unexpected source anatomy.');
const sourceGeometry = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0'].map(name =>
  [name, hash(Buffer.from(primitive.getAttribute(name).getArray().buffer,
    primitive.getAttribute(name).getArray().byteOffset, primitive.getAttribute(name).getArray().byteLength))]));
const sourceIndices = hash(Buffer.from(primitive.getIndices().getArray().buffer,
  primitive.getIndices().getArray().byteOffset, primitive.getIndices().getArray().byteLength));
const sourceTextures = root.listTextures().map(texture => ({ name: texture.getName(), mimeType: texture.getMimeType(),
  bytes: texture.getImage().length, sha256: hash(texture.getImage()) }));
let multiInfluenceVertices = 0, maxWeightSumError = 0;
const joints = primitive.getAttribute('JOINTS_0').getArray(), weights = primitive.getAttribute('WEIGHTS_0').getArray();
for (let vertex = 0; vertex < 3290; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const index = vertex * 4 + slot, weight = weights[index];
    if (joints[index] >= 54 || !Number.isFinite(weight)) throw new Error('Invalid skin weight.');
    sum += weight; if (weight > .0001) active++;
  }
  if (active > 1) multiInfluenceVertices++;
  maxWeightSumError = Math.max(maxWeightSumError, Math.abs(1 - sum));
}
if (multiInfluenceVertices < 2000 || maxWeightSumError > 1e-5) throw new Error('Poor anatomical skin.');

function sampleChannel(channel, time) {
  const sampler = channel.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
  const stride = values.length / times.length;
  let key = 0;
  while (key < times.length - 2 && times[key + 1] < time) key++;
  const fraction = Math.max(0, Math.min(1, (time - times[key]) / (times[key + 1] - times[key] || 1)));
  if (channel.getTargetPath() === 'rotation') return new Quaternion().fromArray(values, key * stride)
    .slerp(new Quaternion().fromArray(values, (key + 1) * stride), fraction).toArray();
  return Array.from({ length: stride }, (_, component) => values[key * stride + component] * (1 - fraction) +
    values[(key + 1) * stride + component] * fraction);
}
function applyAnimation(animation, time) {
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode(), value = sampleChannel(channel, time);
    if (channel.getTargetPath() === 'translation') node.setTranslation(value);
    else if (channel.getTargetPath() === 'rotation') node.setRotation(value);
    else if (channel.getTargetPath() === 'scale') node.setScale(value);
  }
}
function weightedBounds() {
  const inverse = skin.getInverseBindMatrices(), element = new Array(16);
  const matrices = skin.listJoints().map((joint, index) => {
    inverse.getElement(index, element);
    return new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(element));
  });
  const positions = primitive.getAttribute('POSITION').getArray();
  const source = new Vector3(), transformed = new Vector3(), result = new Vector3();
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let vertex = 0; vertex < 3290; vertex++) {
    source.fromArray(positions, vertex * 3); result.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const weight = weights[vertex * 4 + slot];
      if (weight) result.add(transformed.copy(source).applyMatrix4(matrices[joints[vertex * 4 + slot]]).multiplyScalar(weight));
    }
    minY = Math.min(minY, result.y); maxY = Math.max(maxY, result.y);
    minX = Math.min(minX, result.x); maxX = Math.max(maxX, result.x);
    minZ = Math.min(minZ, result.z); maxZ = Math.max(maxZ, result.z);
  }
  return { minY, maxY, minX, maxX, minZ, maxZ, height: maxY - minY };
}
const bindPose = root.listNodes().map(node => ({ node, translation: node.getTranslation(),
  rotation: node.getRotation(), scale: node.getScale() }));
const death = root.listAnimations().find(animation => animation.getName() === 'Death');
const sourceDuration = Math.max(...death.listSamplers().map(sampler => sampler.getInput().getArray().at(-1)));
applyAnimation(death, 0); const sourceInitial = weightedBounds();
applyAnimation(death, sourceDuration); const sourceFinal = weightedBounds();
const settleSeconds = .68, duration = 2.2;
for (const channel of death.listChannels()) {
  const sampler = channel.getSampler(), input = sampler.getInput(), output = sampler.getOutput();
  if (sampler.getInterpolation() !== 'LINEAR') throw new Error('Expected linear original Death channel.');
  const sourceTimes = input.getArray(), sourceValues = output.getArray(), stride = sourceValues.length / sourceTimes.length;
  const times = new Float32Array(sourceTimes.length + 1), values = new Float32Array(sourceValues.length + stride);
  for (let index = 0; index < sourceTimes.length; index++) times[index] = sourceTimes[index] * settleSeconds / sourceDuration;
  times[times.length - 1] = duration;
  values.set(sourceValues); values.set(sourceValues.slice(-stride), sourceValues.length);
  input.setArray(times); output.setArray(values);
}
const groundChannel = death.listChannels().find(channel => channel.getTargetNode() === ground && channel.getTargetPath() === 'translation');
if (!groundChannel) throw new Error('Missing ground-motion channel.');
const samples = Math.ceil(duration * 60) + 1, times = new Float32Array(samples), groundValues = new Float32Array(samples * 3);
const presentationScale = scaleNode.getScale()[1];
for (let index = 0; index < samples; index++) {
  const time = duration * index / (samples - 1);
  times[index] = time;
  applyAnimation(death, time);
  const base = ground.getTranslation(), floor = weightedBounds().minY;
  groundValues.set([base[0], base[1] + (.003 - floor) / presentationScale, base[2]], index * 3);
}
const buffer = root.listBuffers()[0];
groundChannel.getSampler()
  .setInput(doc.createAccessor('Custodian Death grounded times').setType(Accessor.Type.SCALAR).setArray(times).setBuffer(buffer))
  .setOutput(doc.createAccessor('Custodian Death grounded motion').setType(Accessor.Type.VEC3).setArray(groundValues).setBuffer(buffer));
let minimumFloor = Infinity, maximumFloor = -Infinity, final, atOneSecond, atSettle;
for (let index = 0; index < samples; index++) {
  applyAnimation(death, times[index]);
  const bounds = weightedBounds();
  minimumFloor = Math.min(minimumFloor, bounds.minY); maximumFloor = Math.max(maximumFloor, bounds.minY);
  if (Math.abs(times[index] - 1) < duration / (samples - 1) / 2) atOneSecond = bounds;
  if (Math.abs(times[index] - settleSeconds) < duration / (samples - 1) / 2) atSettle = bounds;
  if (index === samples - 1) final = bounds;
}
const finalHeightRatio = final.height / sourceInitial.height;
if (minimumFloor < -.02 || maximumFloor > .025 || finalHeightRatio > .6 ||
    Math.abs(atOneSecond.height - final.height) > .01) {
  throw new Error(`Death failed corpse acceptance: ${JSON.stringify({ minimumFloor, maximumFloor, finalHeightRatio, atOneSecond, final })}`);
}
const motion = {};
for (const animation of root.listAnimations()) {
  if (!['Idle', 'Walk', 'Run', 'Attack'].includes(animation.getName())) continue;
  const seconds = Math.max(...animation.listSamplers().map(sampler => sampler.getInput().getArray().at(-1)));
  const count = Math.ceil(seconds * 30) + 1;
  const feet = ['mixamorig:LeftFoot', 'mixamorig:RightFoot'].map(name => root.listNodes().find(node => node.getName() === name));
  const footRanges = feet.map(() => ({ minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }));
  let minFloor = Infinity, maxFloor = -Infinity;
  for (let index = 0; index < count; index++) {
    applyAnimation(animation, seconds * index / (count - 1));
    const bounds = weightedBounds();
    minFloor = Math.min(minFloor, bounds.minY); maxFloor = Math.max(maxFloor, bounds.minY);
    feet.forEach((foot, footIndex) => {
      const position = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(foot.getWorldMatrix()));
      const range = footRanges[footIndex];
      range.minY = Math.min(range.minY, position.y); range.maxY = Math.max(range.maxY, position.y);
      range.minZ = Math.min(range.minZ, position.z); range.maxZ = Math.max(range.maxZ, position.z);
    });
  }
  motion[animation.getName()] = { seconds, samples: count, floorRange: [minFloor, maxFloor], footRanges };
}
for (const { node, translation, rotation, scale } of bindPose) node.setTranslation(translation).setRotation(rotation).setScale(scale);
const bytes = await io.writeBinary(doc);
await writeFile(candidateFile, bytes);
const verified = (await io.readBinary(bytes)).getRoot();
const verifiedPrimitive = verified.listNodes().find(node => node.getSkin()).getMesh().listPrimitives()[0];
for (const [name, digest] of Object.entries(sourceGeometry)) {
  const array = verifiedPrimitive.getAttribute(name).getArray();
  if (hash(Buffer.from(array.buffer, array.byteOffset, array.byteLength)) !== digest) throw new Error(`${name} geometry changed.`);
}
const indexArray = verifiedPrimitive.getIndices().getArray();
if (hash(Buffer.from(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength)) !== sourceIndices) throw new Error('Topology changed.');
if (JSON.stringify(verified.listTextures().map(texture => hash(texture.getImage()))) !==
    JSON.stringify(sourceTextures.map(texture => texture.sha256))) throw new Error('Preferred source art changed.');
const oldCatalog = JSON.parse(await readFile('assets/art/tripo/imports/creatures/vault-custodian/lab-catalog.json'));
const oldEntry = oldCatalog.assets[0];
const clips = verified.listAnimations().map(animation => ({ name: animation.getName(),
  seconds: Math.max(...animation.listSamplers().map(sampler => sampler.getInput().getArray().at(-1))),
  channels: animation.listChannels().length }));
const entry = { ...oldEntry, is: 'Vault Custodian', pack: 'corealm-tripo-audit-vault-custodian',
  tags: ['creature', 'karrowmoor', 't10', 'vault-custodian', 'limestone', 'skinned', 'articulated', 'tripo'],
  bytes: bytes.length, sha256: hash(bytes), candidateFile,
  file: 'models/creature/creature_vault_custodian.glb',
  animations: clips.map(clip => clip.name),
  walkClipSeconds: clips.find(clip => clip.name === 'Walk').seconds,
  runClipSeconds: clips.find(clip => clip.name === 'Run').seconds,
  attackSeconds: clips.find(clip => clip.name === 'Attack').seconds,
  contactNormalized: 0.48, impliedWalkMps: null, impliedRunMps: null,
  locomotionPolicy: null, measuredGait: null,
  metadata: { ...oldEntry.metadata, role: { region: 'karrowmoor', tier: 10, levels: [12, 13], currentForm: 'Vault Custodian' },
    visualAndMotionAcceptance: 'pending-root-feature-lab-review' },
  sourceProvenance: { ...oldEntry.sourceProvenance, originalSourceFile, originalSourceSha256,
    riggedSourceFile: sourceFile, riggedSourceSha256: sourceSha256,
    candidateFile, candidateSha256: hash(bytes), materialGenerator: builderFile,
    materialGeneratorSha256: hash(await readFile(builderFile)), runtimeTextures: sourceTextures,
    rig: { joints: 54, multiInfluenceVertices, maxWeightSumError },
    death: { sourceDuration, seconds: duration, settleAtSeconds: settleSeconds,
      holdSeconds: duration - settleSeconds, sourceInitial, sourceFinal, final, atOneSecond, atSettle,
      finalHeightRatio, floorRange: [minimumFloor, maximumFloor] },
    clipSeconds: Object.fromEntries(clips.map(clip => [clip.name, clip.seconds])),
    attackContact: { normalized: 0.48, method: 'Right hand reaches its forward-most point during Punch_Jab around 0.45-0.50 normalized time' },
    sourceGeometryPreserved: true },
  acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false,
    texturesAccepted: false, labAccepted: false, worldIntegrated: false } };
const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [entry], files: { [id]: 'vault-custodian-candidate.glb' } };
const catalog = { schema: 'corealm-creature-family-candidates/1', source: {
  file: originalSourceFile, sha256: originalSourceSha256, modelId: '55366bfe-686e-48e8-94d1-2d19e1664bcb',
  repairedFile: sourceFile, repairedSha256: sourceSha256 }, variants: [{ id, name: 'Vault Custodian',
  candidateFile, sha256: hash(bytes), bytes: bytes.length, geometry: { vertices: 3290, triangles: 5476,
    sourceGeometryAndUvsPreserved: true }, rig: entry.sourceProvenance.rig, clips,
  textures: sourceTextures, motion, death: entry.sourceProvenance.death, acceptance: entry.acceptance }] };
const promotion = { schema: 'corealm-creature-promotion/1', sourceRoot: '.', destinationRoot: 'game/public/assets',
  assets: [entry], pack: { id: entry.pack, name: 'Corealm Tripo audited Vault Custodian', author: 'Corealm',
    source: builderFile, generatorSha256: entry.sourceProvenance.materialGeneratorSha256,
    license: 'LicenseRef-Corealm-Original' } };
await writeFile(`${directory}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
await writeFile(`${directory}/catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(`${directory}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n');
console.log(JSON.stringify({ sourceSha256, candidateSha256: hash(bytes), rig: entry.sourceProvenance.rig,
  sourceInitial, sourceFinal, death: entry.sourceProvenance.death, clips }, null, 2));
