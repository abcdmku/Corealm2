import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const rel = p => path.relative(repo, p).replaceAll('\\', '/');
const sha = b => createHash('sha256').update(b).digest('hex');
const sourceRel = 'assets/art/tripo/imports/creatures/nine-pack-two/flint-mandible/flint-mandible-native-rig-candidate.glb';
const originalRel = 'assets/art/tripo/exports/corealm_flint_mandible_28d04ec6_8k_rigged.glb';
const sourceImageRel = 'assets/art/tripo/references/stone-flint-mandible.png';
const sourceBytes = await readFile(path.join(repo, sourceRel));
if (sha(sourceBytes) !== '3a799e93caf821e1bead35515e1816d77d738573a3befc0626cbf4e39ff7ac05') throw new Error('Pinned rig source changed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceCatalog = JSON.parse(await readFile(path.join(repo, 'assets/art/tripo/imports/creatures/nine-pack-two/flint-mandible/catalog.json')));
const manifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json')));
const variants = [
  { id: 'creature_flint_mandible', name: 'Flint Mandible', file: 'flint-mandible-candidate.glb', atlas: 'flint-mandible-atlas.png',
    atlasSha: '6a25f78f7aedc58cea11caa5028cff2319ade64ce59c94a15f5606637dacd215', scale: 1.94, speciesScale: .8,
    material: 'animal_flint_mandible_layered_chitin', habitat: 'Karrowmoor', levelTarget: '13–18', roughness: [.59, .91] },
  { id: 'creature_beetle_golem', name: 'Beetle Golem', file: 'beetle-golem-candidate.glb', atlas: 'beetle-golem-atlas.png',
    atlasSha: 'cc9997e3a46858e744a640237b71aabd2c55df8289b961c67999528bcce1c3dc', scale: 2.20, speciesScale: 1,
    material: 'animal_beetle_golem_layered_stone_chitin', habitat: 'Vellenwood ruin courts', levelTarget: '18–25', roughness: [.66, .93] },
];

function sample(channel, seconds) {
  const times = channel.getSampler().getInput().getArray();
  const values = channel.getSampler().getOutput().getArray();
  const width = channel.getTargetPath() === 'rotation' ? 4 : 3;
  let a = 0;
  while (a < times.length - 2 && times[a + 1] < seconds) a++;
  const b = Math.min(a + 1, times.length - 1);
  const t = times[b] > times[a] ? Math.max(0, Math.min(1, (seconds - times[a]) / (times[b] - times[a]))) : 0;
  const left = Array.from(values.slice(a * width, a * width + width));
  const right = Array.from(values.slice(b * width, b * width + width));
  return width === 4 ? new THREE.Quaternion(...left).slerp(new THREE.Quaternion(...right), t).toArray()
    : left.map((v, i) => v * (1 - t) + right[i] * t);
}

function frame(doc, clip, seconds) {
  const root = doc.getRoot();
  const node = root.listNodes().find(item => item.getMesh() && item.getSkin());
  const primitive = node.getMesh().listPrimitives()[0];
  const position = primitive.getAttribute('POSITION').getArray();
  const joint = primitive.getAttribute('JOINTS_0').getArray();
  const weight = primitive.getAttribute('WEIGHTS_0').getArray();
  const skin = node.getSkin();
  const ibm = skin.getInverseBindMatrices().getArray();
  const overrides = new Map();
  for (const channel of clip.listChannels()) {
    const target = channel.getTargetNode();
    const current = overrides.get(target) ?? {};
    current[channel.getTargetPath()] = sample(channel, seconds);
    overrides.set(target, current);
  }
  const worlds = new Map();
  const world = item => {
    if (worlds.has(item)) return worlds.get(item);
    const value = overrides.get(item);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(value?.translation ?? item.getTranslation()),
      new THREE.Quaternion().fromArray(value?.rotation ?? item.getRotation()),
      new THREE.Vector3().fromArray(value?.scale ?? item.getScale()));
    const parent = item.getParentNode();
    const matrix = parent ? world(parent).clone().multiply(local) : local;
    worlds.set(item, matrix);
    return matrix;
  };
  const meshWorld = world(node);
  const inverseMesh = meshWorld.clone().invert();
  const matrices = skin.listJoints().map((bone, i) => inverseMesh.clone().multiply(world(bone))
    .multiply(new THREE.Matrix4().fromArray(Array.from(ibm.slice(i * 16, i * 16 + 16)))));
  const bounds = new THREE.Box3();
  const points = new Float32Array(position.length);
  const p = new THREE.Vector3(), moved = new THREE.Vector3(), out = new THREE.Vector3();
  for (let vertex = 0; vertex < position.length / 3; vertex++) {
    p.fromArray(position, vertex * 3); out.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const offset = vertex * 4 + slot;
      if (!weight[offset]) continue;
      moved.copy(p).applyMatrix4(matrices[joint[offset]]);
      out.addScaledVector(moved, weight[offset]);
    }
    out.applyMatrix4(meshWorld);
    points.set(out.toArray(), vertex * 3);
    bounds.expandByPoint(out);
  }
  return { bounds, points };
}

async function maps(atlasBytes, variant) {
  const base = await sharp(atlasBytes).resize(2048, 2048, { kernel: 'lanczos3' })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  const { data: rgb, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const luminance = new Float32Array(info.width * info.height);
  for (let p = 0; p < luminance.length; p++) {
    const i = p * 3;
    luminance[p] = (rgb[i] * .2126 + rgb[i + 1] * .7152 + rgb[i + 2] * .0722) / 255;
  }
  const normalRgb = Buffer.alloc(luminance.length * 3);
  const ormRgb = Buffer.alloc(luminance.length * 3);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const p = y * info.width + x;
    const gx = (luminance[y * info.width + Math.min(info.width - 1, x + 1)]
      - luminance[y * info.width + Math.max(0, x - 1)]) * 2.1;
    const gy = (luminance[Math.min(info.height - 1, y + 1) * info.width + x]
      - luminance[Math.max(0, y - 1) * info.width + x]) * 2.1;
    const length = Math.hypot(gx, gy, 1);
    normalRgb[p * 3] = Math.round(127.5 * (1 - gx / length));
    normalRgb[p * 3 + 1] = Math.round(127.5 * (1 + gy / length));
    normalRgb[p * 3 + 2] = Math.round(127.5 * (1 + 1 / length));
    const range = variant.roughness;
    const roughness = Math.max(range[0], Math.min(range[1], (range[0] + range[1]) / 2
      + (1 - luminance[p]) * .08 + Math.hypot(gx, gy) * .05));
    ormRgb[p * 3] = Math.round(Math.max(.76, 1 - Math.hypot(gx, gy) * .1) * 255);
    ormRgb[p * 3 + 1] = Math.round(roughness * 255);
    ormRgb[p * 3 + 2] = 0;
  }
  return { base,
    normal: await sharp(normalRgb, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer(),
    orm: await sharp(ormRgb, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer() };
}

const pack = { id: 'corealm-tripo-audit-mandible-family', name: 'Corealm Tripo mandible beetle family',
  author: 'Corealm / Tripo Studio', source: 'assets/art/tripo/imports/creatures/audit-mandible-family/build-family.mjs',
  license: 'LicenseRef-Corealm-Original' };
const flintOnly = process.argv.includes('--flint-only');
const previousLab = flintOnly ? JSON.parse(await readFile(path.join(here, 'lab-catalog.json'))) : null;
const previousChecks = flintOnly ? JSON.parse(await readFile(path.join(here, 'validation.json'))) : null;
const assets = [], files = {}, checks = [];
for (const variant of variants) {
  if (flintOnly && variant.id !== 'creature_flint_mandible') {
    assets.push(previousLab.assets.find(asset => asset.id === variant.id));
    files[variant.id] = previousLab.files[variant.id];
    checks.push(previousChecks.find(check => check.id === variant.id));
    continue;
  }
  const atlasPath = path.join(here, variant.atlas);
  let atlasBytes;
  try { atlasBytes = await readFile(atlasPath); } catch (error) {
    if (variant.id === 'creature_beetle_golem' && error.code === 'ENOENT') continue;
    throw error;
  }
  if (variant.atlasSha && sha(atlasBytes) !== variant.atlasSha) throw new Error(`${variant.id} generated atlas changed`);
  const doc = await io.read(path.join(repo, sourceRel));
  const root = doc.getRoot();
  const primitive = root.listMeshes()[0].listPrimitives()[0];
  const sourceArrays = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']
    .map(name => [name, primitive.getAttribute(name).getArray().slice()]));
  const container = root.listNodes().find(node => node.getName() === 'FlintMandibleNativeRig');
  const rigRoot = root.listNodes().find(node => node.getName() === 'FlintRoot');
  if (!container || !rigRoot || root.listSkins()[0]?.listJoints().length !== 30) throw new Error('Expected 30-joint beetle rig');
  container.setScale([variant.scale, variant.scale, variant.scale]);
  const material = primitive.getMaterial();
  const texture = await maps(atlasBytes, variant);
  const textureDir = path.join(here, 'textures');
  await mkdir(textureDir, { recursive: true });
  await Promise.all(Object.entries(texture).map(([name, bytes]) => writeFile(path.join(textureDir, `${variant.id}-${name}-2k.${name === 'base' ? 'jpg' : 'png'}`), bytes)));
  material.getBaseColorTexture().setName(`${variant.name} layered base`).setImage(new Uint8Array(texture.base)).setMimeType('image/jpeg');
  material.getNormalTexture().setName(`${variant.name} chitin relief`).setImage(new Uint8Array(texture.normal)).setMimeType('image/png');
  material.getMetallicRoughnessTexture().setName(`${variant.name} stone chitin ORM`).setImage(new Uint8Array(texture.orm)).setMimeType('image/png');
  material.setName(variant.material).setMetallicFactor(0).setRoughnessFactor(1).setNormalScale(.75);

  const death = root.listAnimations().find(clip => clip.getName() === 'Death');
  for (const sampler of death.listSamplers()) sampler.getInput().setArray(new Float32Array([0, .18, .39, .7, 1.5]));
  // Drop the thorax into the legs and tuck the shell forward without scaling the rig.
  for (const channel of death.listChannels()) {
    const nodeName = channel.getTargetNode()?.getName();
    const output = channel.getSampler().getOutput().getArray().slice();
    if (nodeName === 'BodyCore' && channel.getTargetPath() === 'translation') for (const key of [3, 4]) output[key * 3 + 1] = .045;
    if (nodeName === 'BodyCore' && channel.getTargetPath() === 'rotation') {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0, 'XYZ')).toArray();
      for (const key of [3, 4]) output.set(q, key * 4);
    }
    if (nodeName?.endsWith('_Hip') && channel.getTargetPath() === 'rotation') {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.4).toArray();
      for (const key of [3, 4]) output.set(q, key * 4);
    }
    channel.getSampler().getOutput().setArray(output);
  }
  const buffer = root.listBuffers()[0];
  for (const clip of root.listAnimations()) {
    const duration = clip.getName() === 'Death' ? 1.5 : Math.max(...clip.listChannels().flatMap(channel => Array.from(channel.getSampler().getInput().getArray())));
    const times = Array.from({ length: 97 }, (_, i) => duration * i / 96);
    const values = [];
    for (const time of times) values.push(0, Math.max(0, .006 - frame(doc, clip, time).bounds.min.y) / variant.scale, 0);
    const sampler = doc.createAnimationSampler(`${clip.getName()} grounded root`)
      .setInput(doc.createAccessor(`${clip.getName()} grounded times`).setType(Accessor.Type.SCALAR).setArray(new Float32Array(times)).setBuffer(buffer))
      .setOutput(doc.createAccessor(`${clip.getName()} grounded values`).setType(Accessor.Type.VEC3).setArray(new Float32Array(values)).setBuffer(buffer));
    clip.addSampler(sampler).addChannel(doc.createAnimationChannel(`${clip.getName()} grounded root channel`)
      .setTargetNode(rigRoot).setTargetPath('translation').setSampler(sampler));
  }
  const outputPath = path.join(here, variant.file);
  await io.write(outputPath, doc);
  const outputBytes = await readFile(outputPath);
  const written = await io.read(outputPath);
  const actual = written.getRoot().listMeshes()[0].listPrimitives()[0];
  for (const [name, array] of Object.entries(sourceArrays)) {
    const values = actual.getAttribute(name).getArray();
    if (array.length !== values.length || array.some((value, i) => value !== values[i])) throw new Error(`${variant.id}: ${name} changed`);
  }
  const clips = written.getRoot().listAnimations();
  const motion = [];
  for (const clip of clips) {
    const duration = clip.getName() === 'Death' ? 1.5 : Math.max(...clip.listChannels().flatMap(channel => Array.from(channel.getSampler().getInput().getArray())));
    const samples = Array.from({ length: 97 }, (_, i) => frame(written, clip, duration * i / 96));
    const minY = Math.min(...samples.map(item => item.bounds.min.y));
    if (minY < -.002) throw new Error(`${variant.id}/${clip.getName()} crosses floor: ${minY}`);
    motion.push({ name: clip.getName(), duration, minY, finalHeight: samples.at(-1).bounds.max.y - samples.at(-1).bounds.min.y });
  }
  const holdA = frame(written, death, .7).points;
  const holdB = frame(written, death, 1.5).points;
  let holdDelta = 0;
  for (let i = 0; i < holdA.length; i++) holdDelta = Math.max(holdDelta, Math.abs(holdA[i] - holdB[i]));
  if (holdDelta > .01) throw new Error(`${variant.id}: Death hold drifts ${holdDelta}`);
  const idleHeight = motion.find(item => item.name === 'Idle').finalHeight;
  const deathHeight = motion.find(item => item.name === 'Death').finalHeight;
  if (deathHeight > idleHeight * .8) throw new Error(`${variant.id}: Death remains upright ${deathHeight}/${idleHeight}`);
  const idleBounds = frame(written, clips.find(item => item.getName() === 'Idle'), 0).bounds;
  const corpseBounds = frame(written, death, 1.5).bounds;
  const idleWidth = Math.max(idleBounds.max.x - idleBounds.min.x, idleBounds.max.z - idleBounds.min.z);
  const corpseWidth = Math.max(corpseBounds.max.x - corpseBounds.min.x, corpseBounds.max.z - corpseBounds.min.z);
  if (corpseWidth < idleWidth * .65) throw new Error(`${variant.id}: Death footprint shrinks ${corpseWidth}/${idleWidth}`);
  const jointNames = written.getRoot().listSkins()[0].listJoints().map(node => node.getName());
  const jointArray = actual.getAttribute('JOINTS_0').getArray();
  const weightArray = actual.getAttribute('WEIGHTS_0').getArray();
  const legMotion = {};
  for (const clipName of ['Walk', 'Run']) {
    const clip = clips.find(item => item.getName() === clipName);
    const duration = motion.find(item => item.name === clipName).duration;
    const samples = [0, .25, .5, .75].map(part => frame(written, clip, duration * part).points);
    legMotion[clipName] = {};
    for (const leg of ['FrontLeft', 'FrontRight', 'MiddleLeft', 'MiddleRight', 'RearLeft', 'RearRight']) {
      let count = 0, sum = 0;
      for (let vertex = 0; vertex < jointArray.length / 4; vertex++) {
        let mass = 0;
        for (let slot = 0; slot < 4; slot++) {
          const offset = vertex * 4 + slot;
          if (jointNames[jointArray[offset]].startsWith(leg + '_')) mass += weightArray[offset];
        }
        if (mass <= .5) continue;
        count++;
        let max = 0;
        for (const sample of samples.slice(1)) {
          const offset = vertex * 3;
          max = Math.max(max, Math.hypot(sample[offset] - samples[0][offset],
            sample[offset + 1] - samples[0][offset + 1], sample[offset + 2] - samples[0][offset + 2]));
        }
        sum += max;
      }
      const meanMeters = sum / count;
      if (count < 20 || meanMeters < .03) throw new Error(`${variant.id}/${clipName}/${leg} motion weak: ${count}/${meanMeters}`);
      legMotion[clipName][leg] = { weightedVertices: count, meanExcursionMeters: meanMeters };
    }
  }
  const species = manifest.assets.find(item => item.id === variant.id);
  if (!species) throw new Error(`Missing production target ${variant.id}`);
  const bounds = sourceCatalog.candidate.bounds;
  const size = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, (bounds.max[i] - bounds.min[i]) * variant.scale]));
  const base = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, bounds.min[i] * variant.scale]));
  const provenance = { tool: 'Tripo Studio', modelId: sourceCatalog.source.modelId,
    sourceFile: originalRel, sourceSha256: sourceCatalog.source.sha256,
    sourceImage: sourceImageRel, sourceImageSha256: sourceCatalog.source.sourceImageSha256,
    correctedSourceFile: sourceRel, correctedSourceSha256: sha(sourceBytes),
    generatedAtlas: rel(atlasPath), generatedAtlasSha256: sha(atlasBytes),
    candidateFile: rel(outputPath), candidateSha256: sha(outputBytes),
    textureMethod: 'Built-in imagegen edit of exact UV atlas; layered detailed mineral and chitin color; derived 2K normal and ORM' };
  const entry = { id: variant.id, file: species.file, candidateFile: rel(outputPath), pack: pack.id,
    category: 'character', is: `${variant.name} six-leg beetle`,
    tags: ['creature', 'beetle', 'six-legged', 'tripo', variant.id === 'creature_beetle_golem' ? 'golem' : 'flint'],
    bytes: outputBytes.length, sha256: sha(outputBytes), size, base,
    bounds: { min: [base.x, base.y, base.z], max: [base.x + size.x, base.y + size.y, base.z + size.z] },
    groundY: 0, triangles: 4178, animations: clips.map(clip => clip.getName()), materials: [actual.getMaterial().getName()],
    impliedWalkMps: null, impliedRunMps: null, measuredGait: null, locomotionPolicy: null,
    walkClipSeconds: motion.find(item => item.name === 'Walk').duration,
    runClipSeconds: motion.find(item => item.name === 'Run').duration,
    attackSeconds: motion.find(item => item.name === 'Attack').duration, contactNormalized: .5,
    sourceProvenance: provenance,
    metadata: { family: variant.id.replace('creature_', ''), rig: '30-joint articulated six-leg beetle', height: size.y,
      presentation: { sceneScale: variant.scale, existingSpeciesScale: variant.speciesScale,
        desiredInGameHeightMeters: size.y * variant.speciesScale, habitat: variant.habitat, targetLevelRange: variant.levelTarget },
      attackContact: { seconds: motion.find(item => item.name === 'Attack').duration * .5, normalized: .5 },
      gaitMeasurement: { status: 'uncalibrated', impliedWalkMps: null, impliedRunMps: null },
      deathPose: { groundedBySeconds: .7, heldUntilSeconds: 1.5, holdVertexMaxDeltaMeters: holdDelta,
        idleHeightMeters: idleHeight, finalHeightMeters: deathHeight },
      source: 'Tripo beetle mesh and Corealm native six-leg rig, with distinct image-generated layered atlas' },
    acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false } };
  assets.push(entry);
  files[variant.id] = outputPath;
  checks.push({ id: variant.id, sha256: sha(outputBytes), size, motion, legMotion, holdDelta,
    ...(variant.id === 'creature_flint_mandible' ? { deathFootprint: { idleWidth, corpseWidth, ratio: corpseWidth / idleWidth } } : {}),
    textureHashes: Object.fromEntries(Object.entries(texture).map(([name, bytes]) => [name, sha(bytes)])) });
}
pack.generatorSha256 = sha(await readFile(path.join(repo, pack.source)));
await Promise.all([
  writeFile(path.join(here, 'lab-catalog.json'), JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', pack, assets, files }, null, 2) + '\n'),
  writeFile(path.join(here, 'promotion.json'), JSON.stringify({ schema: 'corealm-creature-promotion/1', pack,
    assets: assets.map(asset => ({ ...asset, candidateFile: path.basename(asset.candidateFile) })) }, null, 2) + '\n'),
  writeFile(path.join(here, 'validation.json'), JSON.stringify(checks, null, 2) + '\n'),
]);
console.log(JSON.stringify(checks.map(check => ({ id: check.id, sha256: check.sha256, size: check.size,
  deathHeight: check.motion.find(clip => clip.name === 'Death').finalHeight, holdDelta: check.holdDelta })), null, 2));
