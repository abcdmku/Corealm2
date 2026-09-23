import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Euler, Quaternion } from 'three';
import sharp from 'sharp';
import { addChannel, applyClip, restorePose, storedPose } from '../../../../../../tools/creature-motion/pose.ts';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.ts';

const dir = 'assets/art/tripo/imports/creatures/audit-pale-dragon';
const sourceFile = 'assets/art/tripo/imports/creatures/starred-red-dragon/starred-red-dragon_candidate.glb';
const sourceSha256 = '1f5af3e449e12a048dd980ae719b158ea674f71a4f33dbe44b83752c2fd7b49d';
const imageFile = `${dir}/pale-quarry-scales-imagegen.png`;
const builderFile = `${dir}/build-candidate.mjs`;
const candidateFile = `${dir}/pale-dragon-candidate.glb`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
if (sha(sourceBytes) !== sourceSha256) throw new Error('Approved red dragon source hash changed');
const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
const clips = root.listAnimations();
if (clips.map(clip => clip.getName()).join('|') !== 'Idle|Walk|Run|Attack|Hit|Death') throw new Error('Unexpected dragon clip set');
const skin = root.listSkins()[0], joints = skin?.listJoints().map(joint => joint.getName()) ?? [];
if (joints.length !== 41 || !['ForePaw_L','ForePaw_R','HindPaw_L','HindPaw_R','WingTip_L','WingTip_R']
  .every(name => joints.includes(name))) throw new Error('Dragon lacks four legs and two independent wings');
const primitive = root.listMeshes()[0]?.listPrimitives()[0];
if (!primitive || primitive.getIndices().getCount() / 3 !== 9327) throw new Error('Unexpected approved dragon mesh');

// Preserve the dragon's six-limb geometry and 41-joint skin. Its original
// 0.69 m height reads as a hatchling; a uniform parent scale makes a moderate
// 1.7 m young quarry dragon without changing any skin weights or stride keys.
const model = root.listNodes().find(node => node.getName() === 'RedDragon_native_rig');
if (!model || model.getScale().some(value => Math.abs(value - 1) > 1e-6)) throw new Error('Unexpected model transform');
model.setScale([2.5, 2.5, 2.5]);

// The approved Death scarcely lowers its 0.69 m silhouette. Blend a real
// stagger, body fall, curled neck/tail and folding wings into its final keys.
const death = clips.find(clip => clip.getName() === 'Death');
const fade = time => { const u = Math.max(0, Math.min(1, (time - .32) / 1.12)); return u * u * (3 - 2 * u); };
const quat = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')).normalize();
const targetRotations = {
  Pelvis: [0.02, 0, 0], SpineRear: [0.34, 0, 0], SpineMid: [0.46, 0, 0],
  Chest: [0.50, 0, -0.05], NeckBase: [0.35, 0, 0], NeckMid: [-0.10, 0, 0], Head: [-0.15, -0.08, 0],
  TailBase: [-0.15, 0.30, 0], TailMid: [-0.20, 0.45, 0], TailEnd: [-0.10, 0.60, 0], TailTip: [0, 0.75, 0],
  WingShoulder_L: [0, 0, 0], WingShoulder_R: [0, 0, 0],
  WingArm_L: [0, 0, 0], WingArm_R: [0, 0, 0],
  WingElbow_L: [0, 0, 0], WingElbow_R: [0, 0, 0],
  ForeUpper_L: [-0.35, 0, 0], ForeUpper_R: [-0.35, 0, 0],
  ForeLower_L: [-0.55, 0, 0], ForeLower_R: [-0.55, 0, 0],
  HindUpper_L: [-0.30, 0, 0], HindUpper_R: [-0.30, 0, 0],
  HindLower_L: [-0.55, 0, 0], HindLower_R: [-0.55, 0, 0],
};
for (const channel of death.listChannels()) {
  const node = channel.getTargetNode().getName(), path = channel.getTargetPath(), sampler = channel.getSampler();
  const times = sampler.getInput().getArray(), output = Float32Array.from(sampler.getOutput().getArray());
  if (path === 'translation' && node === 'Pelvis') {
    for (let index = 0; index < times.length; index++) {
      const amount = fade(Number(times[index]));
      output[index * 3 + 1] -= .09 * amount;
      output[index * 3 + 2] += .035 * amount;
    }
  } else if (path === 'translation' && node.startsWith('ForePaw_')) {
    for (let index = 0; index < times.length; index++) output[index * 3 + 1] += .14 * fade(Number(times[index]));
  } else if (path === 'rotation' && targetRotations[node]) {
    const end = quat(...targetRotations[node]);
    for (let index = 0; index < times.length; index++) {
      const at = index * 4;
      const original = new Quaternion(...output.slice(at, at + 4)).normalize();
      const blended = original.slerp(end, fade(Number(times[index])));
      output.set(blended.toArray(), at);
    }
  } else continue;
  sampler.getOutput().setArray(output);
}
const rigRoot = root.listNodes().find(node => node.getName() === 'DragonRoot');
addChannel(doc, death, rigRoot, 'translation', [0, .32, .84, 1.26, 1.68], [
  0, 0, 0,
  0, 0, 0,
  0, .03, 0,
  0, .075, 0,
  0, .10, 0,
]);

// Gameplay fades a dead creature shortly after one second. Keep the approved
// fall trajectory, but finish it before the fade and hold the grounded pose.
for (const channel of death.listChannels()) {
  const sampler = channel.getSampler();
  const input = sampler.getInput(), output = sampler.getOutput();
  const times = Array.from(input.getArray(), Number);
  const values = Array.from(output.getArray(), Number);
  const width = output.getElementSize();
  const finish = times.at(-1);
  if (finish <= 0 || values.length !== times.length * width) throw new Error('Unexpected Death sampler');
  const buffer = root.listBuffers()[0];
  sampler.setInput(doc.createAccessor().setType('SCALAR')
    .setArray(Float32Array.from([...times.map(time => time * .66 / finish), 1.68])).setBuffer(buffer));
  sampler.setOutput(doc.createAccessor().setType(output.getType())
    .setArray(Float32Array.from([...values, ...values.slice(-width)])).setBuffer(buffer));
}

const imagegen = await readFile(imageFile);
const metadata = await sharp(imagegen).metadata();
if (metadata.width !== metadata.height || metadata.width < 1024) throw new Error('Imagegen atlas is not a square detailed texture');
const runtimeTexture = await sharp(imagegen).resize(2048, 2048, { kernel: 'lanczos3' })
  .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
const material = root.listMaterials()[0];
const baseColor = material.getBaseColorTexture(), normal = material.getNormalTexture(), roughness = material.getMetallicRoughnessTexture();
if (!baseColor || !normal || !roughness) throw new Error('Approved PBR texture stack missing');
const normalHash = sha(normal.getImage()), roughnessHash = sha(roughness.getImage());
baseColor.setImage(runtimeTexture).setMimeType('image/jpeg').setName('Pale Dragon layered quarry scales');
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/pale-quarry-scales-runtime.jpg`, runtimeTexture);

const rest = storedPose(doc), samples = [];
for (const time of [0, .42, .73, .84, 1.26, 1.68]) {
  applyClip(death, time);
  const bounds = deformedBounds(doc);
  samples.push({ time, min: bounds.min, max: bounds.max, height: bounds.max[1] - bounds.min[1] });
  restorePose(rest);
}
if (samples.some(sample => ![...sample.min, ...sample.max].every(Number.isFinite))) throw new Error('Nonfinite Death deformation');
if (samples.at(-1).max[1] >= samples[0].max[1] * .78) throw new Error('Death does not visibly fall');
if (samples.at(-1).min[1] < -.08) throw new Error('Death body sinks too far below the ground');
if (samples.find(sample => sample.time === .73).max[1] >= samples[0].max[1] * .65) {
  throw new Error('Death does not reach its collapsed pose before corpse fade');
}
if (sha(normal.getImage()) !== normalHash || sha(roughness.getImage()) !== roughnessHash) throw new Error('Source PBR maps changed');

const sourceRoot = (await io.readBinary(sourceBytes)).getRoot();
const digestArray = array => sha(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
const sourcePrimitive = sourceRoot.listMeshes()[0].listPrimitives()[0];
for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
  if (digestArray(sourcePrimitive.getAttribute(key).getArray()) !== digestArray(primitive.getAttribute(key).getArray())) {
    throw new Error(`${key} changed from approved source`);
  }
}
if (digestArray(sourcePrimitive.getIndices().getArray()) !== digestArray(primitive.getIndices().getArray())) throw new Error('Mesh topology changed');
for (let clipIndex = 0; clipIndex < 5; clipIndex++) {
  const before = sourceRoot.listAnimations()[clipIndex], after = clips[clipIndex];
  if (before.getName() !== after.getName() || before.listChannels().length !== after.listChannels().length) {
    throw new Error(`Non-Death clip structure changed at ${clipIndex}`);
  }
  for (let index = 0; index < before.listChannels().length; index++) {
    const a = before.listChannels()[index], b = after.listChannels()[index];
    if (a.getTargetNode().getName() !== b.getTargetNode().getName() || a.getTargetPath() !== b.getTargetPath()) {
      throw new Error(`${before.getName()} channel binding changed`);
    }
    if (digestArray(a.getSampler().getInput().getArray()) !== digestArray(b.getSampler().getInput().getArray()) ||
        digestArray(a.getSampler().getOutput().getArray()) !== digestArray(b.getSampler().getOutput().getArray())) {
      throw new Error(`${before.getName()} keys changed`);
    }
  }
}

const candidateBytes = await io.writeBinary(doc);
await writeFile(candidateFile, candidateBytes);
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const previous = manifest.assets.find(asset => asset.id === 'creature_quarry_nightmare');
if (!previous) throw new Error('Pale Dragon production slot missing');
const bounds = deformedBounds(doc), size = bounds.min.map((value, index) => bounds.max[index] - value);
const xyz = values => ({ x: values[0], y: values[1], z: values[2] });
const entry = {
  ...previous, pack: 'corealm-tripo-audit-pale-dragon', category: 'character', is: 'Pale Dragon',
  tags: [...new Set([...previous.tags, 'candidate', 'tripo', 'young-dragon', 'quarry'])],
  bytes: candidateBytes.length, sha256: sha(candidateBytes), triangles: 9327,
  size: xyz(size), base: xyz(bounds.min), bounds, groundY: bounds.min[1],
  animations: clips.map(clip => clip.getName()), materials: root.listMaterials().map(item => item.getName()), candidateFile,
  sourceProvenance: {
    sourceAssetId: 'creature_starred_red_dragon', sourceFile, sourceSha256,
    tripoSourceFile: 'assets/art/tripo/exports/d20f1d55-1dce-46f6-b4e4-375769915b1f.glb',
    tripoSourceSha256: 'a4e053f8f0df3aef8c1503fcbcb47988f656d3b009cdfe8c382b703db7b96ef0',
    sourceImageFile: 'assets/art/tripo/refs/crown-wild-red-dragon.png',
    sourceImageSha256: '7938d512e86acba10ed37cfe8767193ad8a066e0b71891ca0f5e4a664b550d99',
    imagegenFile: imageFile, imagegenSha256: sha(imagegen), runtimeTextureFile: `${dir}/pale-quarry-scales-runtime.jpg`,
    runtimeTextureSha256: sha(runtimeTexture), builderFile, builderSha256: sha(await readFile(builderFile)),
    changes: 'Approved six-limb dragon geometry and 41-joint skin retained; parent scale 2.5, layered image-generated quarry albedo, Death falls and curls. Other five clips and normal/metallic-roughness maps retained.',
  },
  acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false,
    labAccepted: false, worldIntegrated: false },
};
const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [entry], files: { creature_quarry_nightmare: 'pale-dragon-candidate.glb' } };
await writeFile(`${dir}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
await mkdir(`${dir}/promotions`, { recursive: true });
const pack = { id: entry.pack, name: 'Corealm Tripo Pale Dragon', author: 'Corealm / Tripo Studio',
  source: builderFile, license: 'LicenseRef-Corealm-Original', generatorSha256: entry.sourceProvenance.builderSha256 };
const promotion = { schema: 'corealm-creature-promotion/1', packs: [pack], assets: [{
  ...entry, tags: entry.tags.filter(tag => tag !== 'candidate'),
  sourceProvenance: { ...entry.sourceProvenance, productionBeforeSha256: previous.sha256 },
  acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
}] };
await writeFile(`${dir}/promotions/pale-dragon.json`, JSON.stringify(promotion, null, 2) + '\n');
console.log(JSON.stringify({ candidateFile, sha256: entry.sha256, size: entry.size, death: samples }, null, 2));
