import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion } from 'three';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const sourceFile = path.join(repo, 'assets/art/tripo/imports/creatures/starred-grove-guardian/models/creature_starroot_guardian.glb');
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourceFile);
const sourceSha = sha(sourceBytes);
const source = await io.readBinary(sourceBytes);
const sourceRoot = source.getRoot();
const sourceMesh = sourceRoot.listNodes().find(node => node.getMesh());
const sourcePrimitive = sourceMesh?.getMesh()?.listPrimitives()[0];
const sourceSkin = sourceMesh?.getSkin();
if (!sourcePrimitive || sourcePrimitive.getIndices()?.getCount() !== 4478 * 3 || sourceSkin?.listJoints().length !== 54) throw new Error('Unexpected starred Tree Guardian topology or skin');
const coreClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
const clipNames = sourceRoot.listAnimations().map(a => a.getName());
if (!coreClips.every(name => clipNames.includes(name))) throw new Error(`Missing core clips: ${clipNames}`);
const material = sourcePrimitive.getMaterial();
const sourceColor = material.getBaseColorTexture();
if (!sourceColor || sourceRoot.listTextures().length !== 3) throw new Error('Expected native three-map PBR material');
const sourceColorBytes = sourceColor.getImage();
const { width, height } = await sharp(sourceColorBytes).metadata();
if (width !== 2048 || height !== 2048) throw new Error(`Unexpected source UV map size ${width}x${height}`);
const original = await sharp(sourceColorBytes).ensureAlpha().raw().toBuffer();

const variants = [
  { id: 'creature_mossback_sentinel', name: 'Mossback Sentinel', height: 2.15,
    image: 'textures/mossback-generated-bark.png', output: 'mossback-sentinel-candidate.glb', map: 'textures/mossback-basecolor-2k.jpg',
    blend: { bark: 0.58, leaf: 0.24, face: 0.12 },
    prompt: 'Seamless dark umber bark with fissures, olive and emerald moss, pale lichen and green leaf flecks; imagegen built-in mode.',
    role: 'Level-13 forest sentinel with compact rooted anatomy and dense natural moss.' },
  { id: 'fairy_garden_sapling_faeholme', name: 'Starroot Tender', height: 6.875,
    image: 'textures/starroot-generated-bark.png', output: 'starroot-tender-candidate.glb', map: 'textures/starroot-basecolor-2k.jpg',
    blend: { bark: 0.82, leaf: 0.38, face: 0.18 },
    prompt: 'Seamless pale silver bark with lavender and teal moss, magenta star blossoms and amber sap veins; imagegen built-in mode.',
    role: 'Level-115 fairy tree guardian with larger bud crown, bright layered bark and blossom detail.' },
];

function blendAtlas(tile, blend) {
  const result = Buffer.alloc(original.length);
  const W = 2048;
  for (let i = 0; i < W * W; i++) {
    const p = i * 4;
    const r = original[p], g = original[p + 1], b = original[p + 2];
    // Keep leaf veins and facial markings readable while putting generated
    // bark, moss and blossom detail into the existing UV islands.
    const leaf = g > r * 1.08 && g > b * 1.08;
    const x = i % W, y = Math.floor(i / W);
    const face = x < 370 && y > 470 && y < 950;
    const a = face ? blend.face : leaf ? blend.leaf : blend.bark;
    for (let c = 0; c < 3; c++) result[p + c] = Math.round(original[p + c] * (1 - a) + tile[p + c] * a);
    result[p + 3] = original[p + 3];
  }
  return result;
}

function checkWeights(primitive) {
  const j = primitive.getAttribute('JOINTS_0'), w = primitive.getAttribute('WEIGHTS_0');
  if (!j || !w || j.getCount() !== 2828 || w.getCount() !== 2828) throw new Error('Missing source anatomical weights');
  let minSum = Infinity, maxSum = -Infinity, maxJoint = -1, used = new Set();
  const ji = [], wi = [];
  for (let i = 0; i < j.getCount(); i++) {
    j.getElement(i, ji); w.getElement(i, wi);
    const sum = wi.reduce((a, b) => a + b, 0);
    minSum = Math.min(minSum, sum); maxSum = Math.max(maxSum, sum);
    for (let k = 0; k < 4; k++) if (wi[k] > 0.01) { maxJoint = Math.max(maxJoint, ji[k]); used.add(ji[k]); }
  }
  if (minSum < 0.998 || maxSum > 1.002 || maxJoint >= 54 || used.size < 15) throw new Error(`Invalid skin weights ${minSum}..${maxSum}; ${used.size} joints`);
  return { vertexCount: j.getCount(), usedJoints: used.size, usedJointNames: [...used].map(index => sourceSkin.listJoints()[index].getName()), minSum, maxSum, maxJoint };
}
const weights = checkWeights(sourcePrimitive);

function sampleMotion(doc) {
  const root = doc.getRoot();
  const rest = new Map(root.listNodes().map(node => [node, { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() }]));
  const samples = [];
  const restore = () => { for (const [node, pose] of rest) node.setTranslation(pose.t).setRotation(pose.r).setScale(pose.s); };
  for (const clip of root.listAnimations()) {
    const channels = clip.listChannels();
    const duration = Math.max(...channels.map(ch => {
      const a = ch.getSampler()?.getInput()?.getArray(); return a?.[a.length - 1] ?? 0;
    }));
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`No duration for ${clip.getName()}`);
    const frames = [];
    const fractions = clip.getName() === 'Attack' ? Array.from({ length: 41 }, (_, i) => i / 40) : [0, 0.25, 0.5, 0.75, 1];
    for (const fraction of fractions) {
      restore();
      const time = duration * fraction;
      for (const ch of channels) {
        const node = ch.getTargetNode(), sampler = ch.getSampler();
        const times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
        const kind = ch.getTargetPath(), stride = kind === 'rotation' ? 4 : 3;
        let k = 0; while (k < times.length - 2 && times[k + 1] < time) k++;
        const lo = times[k], hi = times[k + 1];
        const u = hi > lo ? Math.min(1, Math.max(0, (time - lo) / (hi - lo))) : 0;
        let v;
        if (kind === 'rotation') {
          const qa = new Quaternion(...values.slice(k * stride, k * stride + 4));
          const qb = new Quaternion(...values.slice((k + 1) * stride, (k + 1) * stride + 4));
          v = qa.slerp(qb, u).toArray();
          node.setRotation(v);
        } else if (kind === 'translation' || kind === 'scale') {
          v = Array.from({ length: stride }, (_, c) => values[k * stride + c] * (1 - u) + values[(k + 1) * stride + c] * u);
          if (kind === 'translation') node.setTranslation(v); else node.setScale(v);
        }
      }
      const bounds = deformedBounds(doc);
      const size = bounds.max.map((v, i) => v - bounds.min[i]);
      if (![...bounds.min, ...bounds.max, ...size].every(Number.isFinite) || Math.max(...size) > 8 || Math.min(...size) < 0.1) throw new Error(`Broken ${clip.getName()} frame ${fraction}: ${JSON.stringify(bounds)}`);
      const hand = root.listNodes().find(node => node.getName() === 'mixamorig:RightHand');
      const hips = root.listNodes().find(node => node.getName() === 'mixamorig:Hips');
      const handToHipsZ = hand && hips ? hand.getWorldMatrix()[14] - hips.getWorldMatrix()[14] : null;
      frames.push({ fraction, bounds, ...(clip.getName() === 'Attack' ? { handToHipsZ } : {}) });
    }
    samples.push({ clip: clip.getName(), duration, frames });
  }
  restore();
  return samples;
}

const records = [];
const labAssets = [];
for (const variant of variants) {
  const tile = await sharp(path.join(here, variant.image)).resize(2048, 2048).flatten({ background: '#655b4d' }).ensureAlpha().raw().toBuffer();
  const blend = blendAtlas(tile, variant.blend);
  const image = await sharp(blend, { raw: { width: 2048, height: 2048, channels: 4 } }).removeAlpha().jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
  await writeFile(path.join(here, variant.map), image);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const mesh = root.listNodes().find(node => node.getMesh());
  const color = mesh.getMesh().listPrimitives()[0].getMaterial().getBaseColorTexture();
  color.setImage(image).setMimeType('image/jpeg').setName(`${variant.id}_layered_generated_basecolor`);
  const sceneRoot = root.listScenes()[0].listChildren()[0];
  sceneRoot.setScale([variant.height, variant.height, variant.height]);
  const bounds = deformedBounds(doc);
  const motion = sampleMotion(doc);
  const timing = Object.fromEntries(motion.map(clip => [clip.clip, clip.duration]));
  const jab = motion.find(clip => clip.clip === 'Attack');
  const contactFrame = jab.frames.filter(frame => frame.fraction > 0.05 && frame.fraction < 0.7)
    .reduce((best, frame) => frame.handToHipsZ < best.handToHipsZ ? frame : best);
  const motionTiming = { idleCycleSeconds: timing.Idle, walkCycleSeconds: timing.Walk, runCycleSeconds: timing.Run,
    attackSeconds: timing.Attack, contactNormalized: contactFrame.fraction,
    contactSeconds: timing.Attack * contactFrame.fraction,
    sourceTake: 'Punch_Jab', contactMethod: 'Peak forward right-hand reach relative to hips, sampled at 41 Attack frames; model forward is negative local Z; pending gameplay contact review' };
  const bytes = await io.writeBinary(doc);
  const output = path.join(here, variant.output);
  await writeFile(output, bytes);
  const roundtrip = await io.readBinary(bytes);
  if (roundtrip.getRoot().listAnimations().length !== clipNames.length || roundtrip.getRoot().listTextures().length !== 3) throw new Error(`Roundtrip dropped motion or PBR maps: ${variant.id}`);
  const record = { schema: 'corealm-creature-candidate/1', id: variant.id, name: variant.name, status: 'awaiting-root-lab-review',
    source: { file: path.relative(repo, sourceFile).replaceAll('\\', '/'), sha256: sourceSha, tripoProjectId: '4580db8d-f714-4acf-be53-33a2543e7090', triangles: 4478, vertices: 2828, rigJoints: 54 },
    candidate: { file: variant.output, sha256: sha(bytes), bytes: bytes.length, targetHeight: variant.height,
      authoredRuntimeScale: variant.id === 'fairy_garden_sapling_faeholme' ? 0.3864705303367673 : null,
      estimatedAuthoredDrawnHeight: variant.id === 'fairy_garden_sapling_faeholme' ? variant.height * 0.3864705303367673 : null,
      bounds, clips: clipNames, weights, motion, motionTiming },
    materials: { baseColor: variant.map, generatedTile: variant.image, sourceNormalAndRoughnessPreserved: true, imagegenPrompt: variant.prompt,
      uvLayoutPreserved: true, sourceBaseColorBlendedIntoEachVariant: true },
    role: variant.role, acceptance: { cpuMotionChecked: true, labAccepted: false, worldIntegrated: false } };
  records.push(record);
  labAssets.push({ id: variant.id, file: variant.output, pack: 'corealm-tripo-audit-forest', category: 'character', is: variant.name,
    tags: ['creature', 'forest', 'tree', 'tripo', 'candidate'], bytes: bytes.length, sha256: sha(bytes), triangles: 4478,
    size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, groundY: bounds.min[1], animations: clipNames,
    walkClipSeconds: motionTiming.walkCycleSeconds, runClipSeconds: motionTiming.runCycleSeconds,
    attackSeconds: motionTiming.attackSeconds, contactNormalized: motionTiming.contactNormalized,
    materials: [material.getName()], sourceProvenance: record.source, candidateReview: record.acceptance });
}
await writeFile(path.join(here, 'candidate.json'), `${JSON.stringify({ schema: 'corealm-forest-family/1', variants: records }, null, 2)}\n`);
await writeFile(path.join(here, 'lab-catalog.json'), `${JSON.stringify({ schema: 'corealm-lab-asset-candidates/1', assets: labAssets,
  files: Object.fromEntries(labAssets.map(asset => [asset.id, asset.file])) }, null, 2)}\n`);
console.log(JSON.stringify(records.map(({ id, candidate }) => ({ id, file: candidate.file, bounds: candidate.bounds,
  clips: candidate.clips, usedJoints: candidate.weights.usedJoints, motionFrames: candidate.motion.reduce((n, x) => n + x.frames.length, 0) })), null, 2));
