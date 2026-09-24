import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const sourceRel = 'assets/art/tripo/imports/creatures/nine-pack-two/flint-mandible/flint-mandible-native-rig-candidate.glb';
const originalRel = 'assets/art/tripo/exports/corealm_flint_mandible_28d04ec6_8k_rigged.glb';
const referenceRel = 'assets/art/tripo/references/stone-flint-mandible.png';
const atlasRel = 'assets/art/tripo/imports/creatures/audit-fen-crawler/fen-crawler-generated-atlas.png';
const outputRel = 'assets/art/tripo/imports/creatures/audit-fen-crawler/fen-crawler-sixleg-candidate.glb';
const sourcePath = path.join(repo, sourceRel);
const outputPath = path.join(repo, outputRel);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourcePath);
if (hash(sourceBytes) !== '3a799e93caf821e1bead35515e1816d77d738573a3befc0626cbf4e39ff7ac05') throw new Error('Pinned six-leg source changed');
const atlasBytes = await readFile(path.join(repo, atlasRel));
if (hash(atlasBytes) !== '7c2d5471221de3b533bb53d60df070ad07236ca168f2c52215911c3eb8e4d21e') throw new Error('Pinned generated swamp atlas changed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(sourcePath);
const root = doc.getRoot();
const primitive = root.listMeshes()[0].listPrimitives()[0];
const original = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0'].map(name => [name, primitive.getAttribute(name).getArray().slice()]));
const material = primitive.getMaterial();
const container = root.listNodes().find(node => node.getName() === 'FlintMandibleNativeRig');
const rigRoot = root.listNodes().find(node => node.getName() === 'FlintRoot');
if (!container || !rigRoot || root.listSkins()[0]?.listJoints().length !== 30) throw new Error('Expected audited six-leg rig');
const sceneScale = .71;
container.setScale([sceneScale, sceneScale, sceneScale]);

const albedo = await sharp(atlasBytes).resize(2048, 2048, { kernel: 'lanczos3' })
  .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
const { data: rgb, info } = await sharp(albedo).raw().toBuffer({ resolveWithObject: true });
const lum = new Float32Array(info.width * info.height);
for (let p = 0; p < lum.length; p++) {
  const i = p * 3;
  lum[p] = (rgb[i] * .2126 + rgb[i + 1] * .7152 + rgb[i + 2] * .0722) / 255;
}
const normalRgb = Buffer.alloc(lum.length * 3);
const ormRgb = Buffer.alloc(lum.length * 3);
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  const p = y * info.width + x;
  const left = lum[y * info.width + Math.max(0, x - 1)];
  const right = lum[y * info.width + Math.min(info.width - 1, x + 1)];
  const above = lum[Math.max(0, y - 1) * info.width + x];
  const below = lum[Math.min(info.height - 1, y + 1) * info.width + x];
  const gx = (right - left) * 2.0, gy = (below - above) * 2.0;
  const length = Math.hypot(gx, gy, 1);
  normalRgb[p * 3] = Math.round(127.5 * (1 - gx / length));
  normalRgb[p * 3 + 1] = Math.round(127.5 * (1 + gy / length));
  normalRgb[p * 3 + 2] = Math.round(127.5 * (1 + 1 / length));
  const green = rgb[p * 3 + 1] / 255;
  const rough = Math.max(.39, Math.min(.78, .59 + (green - lum[p]) * .19 + Math.hypot(gx, gy) * .06));
  ormRgb[p * 3] = Math.round(Math.max(.76, Math.min(1, .92 - Math.hypot(gx, gy) * .09)) * 255);
  ormRgb[p * 3 + 1] = Math.round(rough * 255);
  ormRgb[p * 3 + 2] = 0;
}
const normal = await sharp(normalRgb, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const orm = await sharp(ormRgb, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const texturesDir = path.join(here, 'textures');
await mkdir(texturesDir, { recursive: true });
await Promise.all([
  writeFile(path.join(texturesDir, 'fen-crawler-basecolor-2k.jpg'), albedo),
  writeFile(path.join(texturesDir, 'fen-crawler-normal-2k.png'), normal),
  writeFile(path.join(texturesDir, 'fen-crawler-orm-2k.png'), orm),
]);
material.getBaseColorTexture().setName('FenCrawler layered swamp chitin').setImage(new Uint8Array(albedo)).setMimeType('image/jpeg');
material.getNormalTexture().setName('FenCrawler detailed chitin normal').setImage(new Uint8Array(normal)).setMimeType('image/png');
material.getMetallicRoughnessTexture().setName('FenCrawler wet chitin ORM').setImage(new Uint8Array(orm)).setMimeType('image/png');
material.setName('animal_fen_crawler_layered_chitin').setMetallicFactor(0).setRoughnessFactor(1).setNormalScale(.78);

// Source reaches its held pose only at 1.215 s. Bring the existing final pose
// forward to .65 s and hold through the 1 s Death slot.
const death = root.listAnimations().find(clip => clip.getName() === 'Death');
if (!death) throw new Error('Missing Death');
for (const sampler of death.listSamplers()) {
  const output = sampler.getOutput().getArray();
  const stride = output.length / sampler.getInput().getCount();
  if (stride !== 3 && stride !== 4) throw new Error('Unexpected Death channel shape');
  sampler.getInput().setArray(new Float32Array([0, .17, .36, .65, 1]));
}
for (const channel of death.listChannels()) {
  if (channel.getTargetNode()?.getName() !== 'BodyCore') continue;
  const output = channel.getSampler().getOutput().getArray().slice();
  if (channel.getTargetPath() === 'translation') {
    for (const key of [3, 4]) output[key * 3 + 1] = .085;
  } else if (channel.getTargetPath() === 'rotation') {
    const folded = new THREE.Quaternion().setFromEuler(new THREE.Euler(.55, 0, .2, 'XYZ')).toArray();
    for (const key of [3, 4]) output.set(folded, key * 4);
  }
  channel.getSampler().getOutput().setArray(output);
}

function sample(channel, seconds) {
  const times = channel.getSampler().getInput().getArray();
  const values = channel.getSampler().getOutput().getArray();
  const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
  let a = 0;
  while (a < times.length - 2 && times[a + 1] < seconds) a++;
  const b = Math.min(a + 1, times.length - 1);
  const fraction = times[b] > times[a] ? Math.max(0, Math.min(1, (seconds - times[a]) / (times[b] - times[a]))) : 0;
  const va = Array.from(values.slice(a * width, a * width + width));
  const vb = Array.from(values.slice(b * width, b * width + width));
  return width === 4 ? new THREE.Quaternion(...va).slerp(new THREE.Quaternion(...vb), fraction).toArray()
    : va.map((value, index) => value * (1 - fraction) + vb[index] * fraction);
}

function skinnedFrame(document, clip, seconds) {
  const rt = document.getRoot();
  const node = rt.listNodes().find(item => item.getMesh() && item.getSkin());
  const prim = node.getMesh().listPrimitives()[0];
  const positions = prim.getAttribute('POSITION').getArray();
  const joints = prim.getAttribute('JOINTS_0').getArray();
  const weights = prim.getAttribute('WEIGHTS_0').getArray();
  const skin = node.getSkin();
  const bones = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const overrides = new Map();
  for (const channel of clip.listChannels()) {
    const target = channel.getTargetNode();
    const value = overrides.get(target) ?? {};
    value[channel.getTargetPath()] = sample(channel, seconds);
    overrides.set(target, value);
  }
  const worlds = new Map();
  const worldOf = item => {
    if (worlds.has(item)) return worlds.get(item);
    const value = overrides.get(item);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(value?.translation ?? item.getTranslation()),
      new THREE.Quaternion().fromArray(value?.rotation ?? item.getRotation()),
      new THREE.Vector3().fromArray(value?.scale ?? item.getScale()));
    const parent = item.getParentNode();
    const world = parent ? worldOf(parent).clone().multiply(local) : local;
    worlds.set(item, world);
    return world;
  };
  const meshWorld = worldOf(node);
  const inverseMesh = meshWorld.clone().invert();
  const matrices = bones.map((bone, i) => inverseMesh.clone().multiply(worldOf(bone))
    .multiply(new THREE.Matrix4().fromArray(Array.from(ibm.slice(i * 16, i * 16 + 16)))));
  const bounds = new THREE.Box3();
  const points = new Float32Array(positions.length);
  const point = new THREE.Vector3(), moved = new THREE.Vector3(), weighted = new THREE.Vector3();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    point.fromArray(positions, vertex * 3); weighted.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const offset = vertex * 4 + slot;
      if (!weights[offset]) continue;
      moved.copy(point).applyMatrix4(matrices[joints[offset]]);
      weighted.addScaledVector(moved, weights[offset]);
    }
    weighted.applyMatrix4(meshWorld);
    points.set(weighted.toArray(), vertex * 3);
    bounds.expandByPoint(weighted);
  }
  return { bounds, points };
}

// Correct the full weighted surface, rather than only the bone pivots.
const buffer = root.listBuffers()[0];
const deathTurnTimes = [0, .17, .36, .65, 1];
const deathTurns = [0, .04, .19, .4, .4].flatMap(angle =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray());
const deathTurnSampler = doc.createAnimationSampler('Death forward roll sampler')
  .setInput(doc.createAccessor('Death forward roll times').setType(Accessor.Type.SCALAR).setArray(new Float32Array(deathTurnTimes)).setBuffer(buffer))
  .setOutput(doc.createAccessor('Death forward roll rotations').setType(Accessor.Type.VEC4).setArray(new Float32Array(deathTurns)).setBuffer(buffer));
death.addSampler(deathTurnSampler).addChannel(doc.createAnimationChannel('Death forward roll root')
  .setTargetNode(rigRoot).setTargetPath('rotation').setSampler(deathTurnSampler));
const deathScales = [1, .98, .74, .4, .4].flatMap(value => [value, value, value]);
const deathScaleSampler = doc.createAnimationSampler('Death curled body sampler')
  .setInput(doc.createAccessor('Death curled body times').setType(Accessor.Type.SCALAR).setArray(new Float32Array(deathTurnTimes)).setBuffer(buffer))
  .setOutput(doc.createAccessor('Death curled body scales').setType(Accessor.Type.VEC3).setArray(new Float32Array(deathScales)).setBuffer(buffer));
death.addSampler(deathScaleSampler).addChannel(doc.createAnimationChannel('Death curled body root')
  .setTargetNode(rigRoot).setTargetPath('scale').setSampler(deathScaleSampler));
for (const clip of root.listAnimations()) {
  const duration = clip.getName() === 'Death' ? 1 : Math.max(...clip.listChannels().flatMap(channel => Array.from(channel.getSampler().getInput().getArray())));
  const times = Array.from({ length: 65 }, (_, index) => duration * index / 64);
  const values = [];
  for (const time of times) {
    const floor = skinnedFrame(doc, clip, time).bounds.min.y;
    values.push(0, Math.max(0, .004 - floor) / sceneScale, 0);
  }
  // Death has a constant final source pose from .65 to 1.0; keep its floor
  // correction constant too, so the corpse cannot rise late in the clip.
  const sampler = doc.createAnimationSampler(`${clip.getName()} grounded root sampler`)
    .setInput(doc.createAccessor(`${clip.getName()} grounded times`).setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer))
    .setOutput(doc.createAccessor(`${clip.getName()} grounded translation`).setType(Accessor.Type.VEC3).setArray(new Float32Array(values)).setBuffer(buffer));
  clip.addSampler(sampler).addChannel(doc.createAnimationChannel(`${clip.getName()} grounded root`)
    .setTargetNode(rigRoot).setTargetPath('translation').setSampler(sampler));
}
await io.write(outputPath, doc);
const finalBytes = await readFile(outputPath);
const written = await io.read(outputPath);
const finalPrimitive = written.getRoot().listMeshes()[0].listPrimitives()[0];
for (const [name, array] of Object.entries(original)) {
  const actual = finalPrimitive.getAttribute(name).getArray();
  if (array.length !== actual.length || array.some((value, index) => value !== actual[index])) throw new Error(`${name} changed`);
}
const clips = written.getRoot().listAnimations();
const motion = [];
for (const clip of clips) {
  const duration = clip.getName() === 'Death' ? 1 : Math.max(...clip.listChannels().flatMap(channel => Array.from(channel.getSampler().getInput().getArray())));
  const frames = Array.from({ length: 65 }, (_, index) => skinnedFrame(written, clip, duration * index / 64));
  const minY = Math.min(...frames.map(frame => frame.bounds.min.y));
  if (minY < -.001) throw new Error(`${clip.getName()} penetrates floor: ${minY}`);
  const first = frames[0].points, middle = frames[32].points;
  let maxVertexDelta = 0;
  for (let i = 0; i < first.length; i++) maxVertexDelta = Math.max(maxVertexDelta, Math.abs(first[i] - middle[i]));
  motion.push({ clip: clip.getName(), duration, minY, maxVertexDelta,
    finalHeight: frames.at(-1).bounds.max.y - frames.at(-1).bounds.min.y });
}
const deathClip = clips.find(clip => clip.getName() === 'Death');
const deathAt65 = skinnedFrame(written, deathClip, .65);
const deathAtEnd = skinnedFrame(written, deathClip, 1);
let holdDelta = 0;
for (let i = 0; i < deathAt65.points.length; i++) holdDelta = Math.max(holdDelta, Math.abs(deathAt65.points[i] - deathAtEnd.points[i]));
if (holdDelta > .002) throw new Error(`Death final pose does not hold: ${holdDelta}`);
const idleHeight = motion.find(item => item.clip === 'Idle').finalHeight;
const deadHeight = motion.find(item => item.clip === 'Death').finalHeight;
if (deadHeight > idleHeight * .6) throw new Error(`Death remains upright: ${deadHeight}/${idleHeight}`);
const skin = written.getRoot().listSkins()[0];
const names = skin.listJoints().map(node => node.getName());
const jointArray = finalPrimitive.getAttribute('JOINTS_0').getArray();
const weightArray = finalPrimitive.getAttribute('WEIGHTS_0').getArray();
const legNames = ['FrontLeft', 'FrontRight', 'MiddleLeft', 'MiddleRight', 'RearLeft', 'RearRight'];
const legMotion = {};
for (const clipName of ['Walk', 'Run']) {
  const clip = clips.find(item => item.getName() === clipName);
  const duration = motion.find(item => item.clip === clipName).duration;
  const frames = [0, .25, .5, .75].map(part => skinnedFrame(written, clip, part * duration).points);
  legMotion[clipName] = {};
  for (const leg of legNames) {
    const vertices = [];
    for (let vertex = 0; vertex < jointArray.length / 4; vertex++) {
      let mass = 0;
      for (let slot = 0; slot < 4; slot++) {
        const index = vertex * 4 + slot;
        if (names[jointArray[index]].startsWith(leg + '_')) mass += weightArray[index];
      }
      if (mass > .5) vertices.push(vertex);
    }
    if (vertices.length < 20) throw new Error(`${leg}: too few weighted vertices`);
    let sum = 0;
    for (const vertex of vertices) {
      let max = 0;
      for (const frame of frames.slice(1)) {
        const offset = vertex * 3;
        max = Math.max(max, Math.hypot(frame[offset] - frames[0][offset],
          frame[offset + 1] - frames[0][offset + 1], frame[offset + 2] - frames[0][offset + 2]));
      }
      sum += max;
    }
    const meanExcursion = sum / vertices.length;
    if (meanExcursion < .015) throw new Error(`${clipName}/${leg} barely moves: ${meanExcursion}`);
    legMotion[clipName][leg] = { vertices: vertices.length, meanExcursionMeters: meanExcursion };
  }
}
const sourceCatalog = JSON.parse(await readFile(path.join(repo, 'assets/art/tripo/imports/creatures/nine-pack-two/flint-mandible/catalog.json')));
const existingManifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json')));
const existing = existingManifest.assets.find(asset => asset.id === 'creature_fen_crawler');
if (!existing) throw new Error('Missing Fen Crawler production ID');
const raw = sourceCatalog.candidate.size;
const size = { x: raw.x * sceneScale, y: raw.y * sceneScale, z: raw.z * sceneScale };
const base = { x: sourceCatalog.candidate.bounds.min[0] * sceneScale, y: 0, z: sourceCatalog.candidate.bounds.min[2] * sceneScale };
const bounds = { min: [base.x, 0, base.z], max: [base.x + size.x, size.y, base.z + size.z] };
const provenance = {
  tool: 'Tripo Studio', modelId: sourceCatalog.source.modelId,
  sourceFile: originalRel, sourceSha256: sourceCatalog.source.sha256,
  sourceImage: referenceRel, sourceImageSha256: sourceCatalog.source.sourceImageSha256,
  correctedSourceFile: sourceRel, correctedSourceSha256: hash(sourceBytes),
  generatedAtlas: atlasRel, generatedAtlasSha256: hash(atlasBytes), generatedAtlasDimensions: '1254x1254',
  candidateFile: outputRel, candidateSha256: hash(finalBytes),
  textureMethod: 'Built-in imagegen edit of the exact Tripo UV atlas; layered moss, peat, bronze and mud detail; derived 2K normal and wet chitin ORM.',
};
const pack = { id: 'corealm-tripo-audit-fen-crawler', name: 'Corealm Tripo Fen Crawler candidate', author: 'Corealm / Tripo Studio',
  source: 'assets/art/tripo/imports/creatures/audit-fen-crawler/build-candidate.mjs', license: 'LicenseRef-Corealm-Original' };
pack.generatorSha256 = hash(await readFile(path.join(repo, pack.source)));
const entry = {
  id: 'creature_fen_crawler', file: existing.file, candidateFile: outputRel, pack: pack.id, category: 'character',
  is: 'Fen Crawler six-leg swamp beetle', tags: ['creature', 'fen-crawler', 'swamp', 'arthropod', 'six-legged'],
  bytes: finalBytes.length, sha256: hash(finalBytes), size, base, bounds, groundY: 0, triangles: 4178,
  animations: clips.map(clip => clip.getName()), materials: [finalPrimitive.getMaterial().getName()],
  impliedWalkMps: null, impliedRunMps: null, measuredGait: null, locomotionPolicy: null,
  walkClipSeconds: motion.find(item => item.clip === 'Walk').duration,
  runClipSeconds: motion.find(item => item.clip === 'Run').duration,
  attackSeconds: motion.find(item => item.clip === 'Attack').duration,
  contactNormalized: .5,
  sourceProvenance: provenance,
  metadata: { family: 'fen_crawler', rig: 'custom 30-joint six-leg arthropod', height: size.y,
    presentation: { sceneScale, rawAssetHeightMeters: raw.y, desiredInGameHeightMeters: size.y, levelRange: '5–12' },
    attackContact: { seconds: motion.find(item => item.clip === 'Attack').duration * .5, normalized: .5 },
    gaitMeasurement: { status: 'uncalibrated', impliedWalkMps: null, impliedRunMps: null },
    deathPose: { groundedBySeconds: .65, heldUntilSeconds: 1, maximumHoldVertexDeltaMeters: holdDelta,
      finalHeightMeters: deadHeight, idleHeightMeters: idleHeight },
    source: 'Detailed image-generated layered swamp atlas on Tripo Flint Mandible geometry; Corealm six-leg rig and clips' },
  acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
};
const lab = { schema: 'corealm-lab-asset-candidates/1', pack, assets: [entry], files: { creature_fen_crawler: outputPath } };
const promotion = { schema: 'corealm-creature-promotion/1', pack, assets: [entry] };
await Promise.all([
  writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify(lab, null, 2) + '\n'),
  writeFile(path.join(here, 'promotion.json'), JSON.stringify(promotion, null, 2) + '\n'),
  writeFile(path.join(here, 'validation.json'), JSON.stringify({ motion, legMotion, deathHoldDelta: holdDelta,
    textures: { generatedAtlas: hash(atlasBytes), baseColor: hash(albedo), normal: hash(normal), orm: hash(orm) },
    sourceRigJoints: 30, sceneScale, size, candidateSha256: hash(finalBytes) }, null, 2) + '\n'),
]);
console.log(JSON.stringify({ candidate: outputRel, sha256: hash(finalBytes), bytes: finalBytes.length, size, motion, legMotion, deathHoldDelta: holdDelta }, null, 2));
