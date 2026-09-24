import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion } from 'three';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = [
  { id: 'creature_wild_goblin', sourceDir: 'wild-goblin-round1' },
  { id: 'creature_troll_mauler', sourceDir: 'troll-mauler-round2' },
  { id: 'creature_cave_roach', sourceDir: 'cave-roach-round1' },
];

function duration(clip) {
  return Math.max(...clip.listChannels().map(ch => {
    const arr = ch.getSampler().getInput().getArray(); return arr[arr.length - 1];
  }));
}

function sampleClip(doc, clip, fractions) {
  const root = doc.getRoot();
  const rest = new Map(root.listNodes().map(n => [n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() }]));
  const restore = () => { for (const [n, p] of rest) n.setTranslation(p.t).setRotation(p.r).setScale(p.s); };
  const frames = [];
  const seconds = duration(clip);
  for (const fraction of fractions) {
    restore(); const time = seconds * fraction;
    for (const ch of clip.listChannels()) {
      const node = ch.getTargetNode(), sampler = ch.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
      const kind = ch.getTargetPath(), width = kind === 'rotation' ? 4 : 3;
      let i = 0; while (i < times.length - 2 && times[i + 1] < time) i++;
      const u = sampler.getInterpolation() === 'STEP' ? 0 : times[i + 1] > times[i] ? Math.min(1, Math.max(0, (time - times[i]) / (times[i + 1] - times[i]))) : 0;
      if (kind === 'rotation') {
        const a = new Quaternion(...values.slice(i * width, i * width + width));
        const b = new Quaternion(...values.slice((i + 1) * width, (i + 1) * width + width));
        node.setRotation(a.slerp(b, u).toArray());
      } else if (kind === 'translation' || kind === 'scale') {
        const value = Array.from({ length: width }, (_, k) => values[i * width + k] * (1 - u) + values[(i + 1) * width + k] * u);
        if (kind === 'translation') node.setTranslation(value); else node.setScale(value);
      }
    }
    const bounds = deformedBounds(doc);
    const size = bounds.max.map((v, i) => v - bounds.min[i]);
    if (![...bounds.min, ...bounds.max, ...size].every(Number.isFinite)) throw new Error(`${clip.getName()} nonfinite frame ${fraction}`);
    frames.push({ fraction, seconds: time, bounds, height: size[1] });
  }
  restore();
  return { clip: clip.getName(), duration: seconds, frames };
}

const inspect = process.argv.includes('--inspect');
const summary = [];
for (const entry of entries) {
  const sourceDir = path.join(repo, 'art/rebuild/candidates/finish-bestiary', entry.sourceDir);
  const catalog = JSON.parse(await readFile(path.join(sourceDir, 'catalog.json'), 'utf8'));
  const original = catalog.assets.find(a => a.id === entry.id);
  if (!original) throw new Error(`Missing catalog ${entry.id}`);
  const sourceFile = path.join(sourceDir, original.candidateFile);
  const sourceBytes = await readFile(sourceFile);
  if (hash(sourceBytes) !== original.sha256 || sourceBytes.length !== original.bytes) throw new Error(`Source hash mismatch ${entry.id}`);
  const doc = await io.read(sourceFile);
  const root = doc.getRoot();
  const originalClips = root.listAnimations().map(a => a.getName());
  const originalMaterials = root.listMaterials().map(m => m.getName());
  if (JSON.stringify(originalClips.slice().sort()) !== JSON.stringify(original.animations.slice().sort()) ||
      JSON.stringify(originalMaterials.slice().sort()) !== JSON.stringify(original.materials.slice().sort())) throw new Error(`Metadata mismatch ${entry.id}`);
  let materialRepair = null;
  if (!inspect && entry.id === 'creature_troll_mauler') {
    const cloth = root.listMaterials().find(m => m.getName() === 'animal_rpg_troll_mauler_cloth');
    if (!cloth?.getBaseColorTexture()?.getImage()) throw new Error('Troll cloth atlas missing');
    cloth.setAlphaMode('MASK').setAlphaCutoff(.5);
    materialRepair = { material: cloth.getName(), alphaMode: 'MASK', alphaCutoff: .5,
      reason: 'Cloth PNG contains a transparent ragged hem; OPAQUE rendered its white atlas backing as a rectangle.' };
  }
  const death = root.listAnimations().find(a => a.getName() === 'Death');
  const sourceDeath = sampleClip(doc, death, [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1]);
  const startHeight = sourceDeath.frames[0].height, endHeight = sourceDeath.frames.at(-1).height;
  const sourceFloor = Math.min(...sourceDeath.frames.map(f => f.bounds.min[1]));
  const sourceResult = { id: entry.id, sourceFile: path.relative(repo, sourceFile).replaceAll('\\', '/'), sourceSha256: original.sha256,
    sourceDeath: { duration: sourceDeath.duration, startHeight, endHeight, endHeightRatio: endHeight / startHeight, minY: sourceFloor,
      samples: sourceDeath.frames.map(f => ({ fraction: f.fraction, height: f.height, minY: f.bounds.min[1] })) } };
  if (inspect) { summary.push(sourceResult); continue; }
  // Death must settle before the combat workbench fades the corpse at 1.5s.
  // Each unique source time accessor is cloned; no locomotion or attack action is retimed.
  const oldDuration = duration(death), collapseDuration = .72, newDuration = 1.5;
  const replacements = new Map();
  for (const channel of death.listChannels()) {
    const sampler = channel.getSampler(), input = sampler.getInput(), output = sampler.getOutput();
    if (!replacements.has(input)) {
      const times = input.getArray();
      const retimed = Float32Array.from([...times].map(value => value * collapseDuration / oldDuration).concat([newDuration]));
      replacements.set(input, doc.createAccessor(`${entry.id}_death_held_1.5s`).setType('SCALAR').setArray(retimed));
    }
    const values = output.getArray(), stride = values.length / input.getCount();
    if (!Number.isInteger(stride) || ![3, 4].includes(stride)) throw new Error(`Unexpected Death output stride ${stride}`);
    const held = new Float32Array(values.length + stride);
    held.set(values); held.set(values.slice(values.length - stride), values.length);
    if (entry.id === 'creature_cave_roach' && channel.getTargetNode()?.getName() === 'roach_source_ground' && channel.getTargetPath() === 'translation') {
      const sourceTimes = input.getArray(), lastSourceKey = sourceTimes.length - 1;
      for (let i = lastSourceKey - 1; i >= 0 && Math.abs(sourceTimes[i] - sourceTimes[lastSourceKey]) < 1e-6; i--)
        held.set(values.slice(lastSourceKey * stride, (lastSourceKey + 1) * stride), i * stride);
    }
    sampler.setInput(replacements.get(input));
    sampler.setOutput(doc.createAccessor(`${entry.id}_death_held_pose`).setType(output.getType()).setArray(held));
  }
  let authoredFall = null;
  if (entry.id === 'creature_cave_roach') {
    // The native roach Death sags but stays high. A restrained local shell
    // pitch lowers the carapace without tumbling the complete rig/legs.
    const spine = root.listNodes().find(n => n.getName() === 'roach_2_SpineHigh');
    const channel = death.listChannels().find(ch => ch.getTargetNode() === spine && ch.getTargetPath() === 'rotation');
    if (!channel) throw new Error('Roach Death spine rotation missing');
    const sampler = channel.getSampler(), times = sampler.getInput().getArray(), oldRotations = sampler.getOutput().getArray();
    const rotationValues = [];
    for (let i = 0; i < times.length; i++) {
      const u = Math.min(1, Math.max(0, (times[i] - .25) / (collapseDuration - .25)));
      const angle = -(Math.PI / 6) * u * u * (3 - 2 * u);
      const rotation = new Quaternion(...oldRotations.slice(i * 4, i * 4 + 4));
      rotation.multiply(new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, angle));
      rotationValues.push(...rotation.toArray());
    }
    sampler.setOutput(doc.createAccessor(`${entry.id}_shell_sag`).setType('VEC4').setArray(Float32Array.from(rotationValues)));
    const wrapper = root.listScenes()[0].listChildren()[0];
    const baseTranslation = wrapper.getTranslation();
    const count = 49;
    const fallTimes = doc.createAccessor(`${entry.id}_fall_times`).setType('SCALAR')
      .setArray(Float32Array.from({ length: count }, (_, i) => collapseDuration * i / (count - 1)));
    const translationValues = Array.from({ length: count }, () => [...baseTranslation]);
    const translations = doc.createAccessor(`${entry.id}_fall_translation`).setType('VEC3').setArray(Float32Array.from(translationValues.flat()));
    const translateSampler = doc.createAnimationSampler(`${entry.id}_fall_translation`).setInput(fallTimes).setOutput(translations).setInterpolation('LINEAR');
    death.addSampler(translateSampler).addChannel(doc.createAnimationChannel().setTargetNode(wrapper).setTargetPath('translation').setSampler(translateSampler));
    const trial = sampleClip(doc, death, Array.from({ length: count }, (_, i) => collapseDuration / newDuration * i / (count - 1)));
    for (let i = 0; i < count; i++) translationValues[i][1] += .006 - trial.frames[i].bounds.min[1];
    translations.setArray(Float32Array.from(translationValues.flat()));
    // The source armature and scene scale amplify wrapper translation in the
    // CPU skin path, so measure the response rather than assuming unit gain.
    const corrected = sampleClip(doc, death, Array.from({ length: count }, (_, i) => collapseDuration / newDuration * i / (count - 1)));
    const lastShift = translationValues.at(-1)[1] - baseTranslation[1];
    const gain = (corrected.frames.at(-1).bounds.min[1] - trial.frames.at(-1).bounds.min[1]) / lastShift;
    if (!Number.isFinite(gain) || gain < .5 || gain > 20) throw new Error(`Unexpected roach floor response ${gain}`);
    for (let i = 0; i < count; i++) translationValues[i][1] = baseTranslation[1] + (.006 - trial.frames[i].bounds.min[1]) / gain;
    translations.setArray(Float32Array.from(translationValues.flat()));
    authoredFall = { joint: spine.getName(), additiveLocalPitchDegrees: -30, keys: count,
      trialFinalMinY: trial.frames.at(-1).bounds.min[1], floorResponseGain: gain,
      finalVerticalOffset: translationValues.at(-1)[1] - baseTranslation[1],
      method: 'Native death limb pose with subtle shell sag and per-key grounded vertical offsets' };
  }
  const checked = root.listAnimations().map(clip => sampleClip(doc, clip,
    clip.getName() === 'Death' ? [...new Set([...Array.from({ length: 31 }, (_, i) => i / 30), collapseDuration / newDuration])].sort((a,b)=>a-b) : [0, .25, .5, .75, 1]));
  const deathCheck = checked.find(row => row.clip === 'Death');
  const collapseFrame = deathCheck.frames.find(frame => Math.abs(frame.seconds - collapseDuration) < .0001);
  const floorRange = Object.fromEntries(checked.map(row => [row.clip, {
    minY: Math.min(...row.frames.map(f => f.bounds.min[1])), maxY: Math.max(...row.frames.map(f => f.bounds.max[1])),
    duration: row.duration, samples: row.frames.length,
  }]));
  const stageFile = path.join(here, original.file);
  await mkdir(path.dirname(stageFile), { recursive: true });
  const bytes = await io.writeBinary(doc);
  await writeFile(stageFile, bytes);
  const roundtrip = await io.readBinary(bytes);
  if (roundtrip.getRoot().listAnimations().length !== originalClips.length ||
      JSON.stringify(roundtrip.getRoot().listMaterials().map(m => m.getName()).sort()) !== JSON.stringify(originalMaterials.sort())) throw new Error(`Roundtrip loss ${entry.id}`);
  summary.push({ ...sourceResult, candidateFile: path.relative(here, stageFile).replaceAll('\\', '/'),
    candidateSha256: hash(bytes), candidateBytes: bytes.length, clips: originalClips, materials: original.materials,
    rigSkins: root.listSkins().map(s => s.listJoints().length),
    materialRepair,
    deathRetime: { duration: deathCheck.duration, endHeight: deathCheck.frames.at(-1).height,
      endHeightRatio: deathCheck.frames.at(-1).height / deathCheck.frames[0].height,
      endMinY: deathCheck.frames.at(-1).bounds.min[1], finalReachedAtSeconds: collapseDuration,
      collapseHeight: collapseFrame?.height, collapseMinY: collapseFrame?.bounds.min[1],
      heldUntilSeconds: newDuration,
      authoredFall,
      cpuCollapseByHeight: deathCheck.frames.at(-1).height / deathCheck.frames[0].height < .55,
      visualAcceptancePending: true },
    cpuMotion: floorRange });
}
await writeFile(path.join(here, inspect ? 'source-motion.json' : 'validation.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.map(s => ({ id: s.id, sourceDeath: s.sourceDeath, candidateSha256: s.candidateSha256,
  deathRetime: s.deathRetime })), null, 2));
