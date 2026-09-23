import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion, Vector3 } from 'three';
import { applyClip, storedPose, restorePose } from '../../../../../../tools/creature-motion/pose.ts';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.ts';

const dir = 'assets/art/tripo/imports/creatures/audit-banshee-death';
const sourceFile = 'assets/art/tripo/imports/creatures/audit-undead-family/banshee-motion-polish.glb';
const sourceSha256 = 'e5eee04aa258239fd134a563573208e7acc27daf7726406c7a88f2e2d4fb954c';
const candidateFile = `${dir}/banshee-death-collapse.glb`;
const builderFile = `${dir}/build-candidate.mjs`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
if (sha(sourceBytes) !== sourceSha256) throw new Error('Banshee polish source changed');
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const clips = root.listAnimations();
const death = clips.find(clip => clip.getName() === 'Death');
if (!death || clips.map(clip => clip.getName()).join('|') !== 'Idle|Walk|Run|Attack|Hit|Death') {
  throw new Error('Unexpected Banshee clip set');
}

const times = [0, 0.25, 0.65, 1.05, 1.5];
const curve = (nodeName, path, values) => {
  const channel = death.listChannels().find(c => c.getTargetNode()?.getName() === nodeName && c.getTargetPath() === path);
  if (!channel) throw new Error(`Missing Death ${nodeName}/${path}`);
  const sampler = channel.getSampler();
  const input = [...sampler.getInput().getArray()];
  if (input.length !== times.length || input.some((time, index) => Math.abs(time - times[index]) > 1e-4)) {
    throw new Error(`Unexpected Death timing for ${nodeName}`);
  }
  sampler.getOutput().setArray(Float32Array.from(values));
};
const quat = (axis, radians) => new Quaternion().setFromAxisAngle(new Vector3(...axis), radians).toArray();
const rotations = (nodeName, axis, angles) => curve(nodeName, 'rotation', angles.flatMap(angle => quat(axis, angle)));

// The death begins with the original recoil, then the core loses lift and
// folds to one side. Opposing cloth and ribbon turns keep the silhouette
// broad while the spectral body sinks; no vertices or skin weights change.
curve('BansheeRoot', 'translation', [
  0, 0, 0,
  0, 0.04, 0,
  -0.04, -0.10, -0.025,
  -0.18, -0.40, -0.10,
  -0.30, -0.68, -0.16,
]);
rotations('mixamorigHips', [0, 0, 1], [0, -0.06, -0.30, -0.86, -1.18]);
rotations('mixamorigSpine1', [1, 0, 0], [0, -0.04, -0.18, -0.51, -0.74]);
rotations('mixamorigHead', [0, 0, 1], [0, 0.08, 0.21, 0.42, 0.55]);
rotations('mixamorigLeftArm', [1, 0, 0], [0, -0.05, -0.35, -0.80, -1.02]);
rotations('mixamorigRightArm', [1, 0, 0], [0, -0.06, -0.28, -0.68, -0.94]);
rotations('BansheeShroudMid', [1, 0, 0], [0, 0.05, 0.25, 0.70, 1.03]);
rotations('BansheeMistTipL', [0, 0, 1], [0, 0.10, 0.30, 0.62, 0.86]);
rotations('BansheeMistTipR', [0, 0, 1], [0, -0.10, -0.28, -0.59, -0.82]);

const rest = storedPose(doc);
const samples = [];
for (const time of [0, 0.25, 0.65, 1.05, 1.5]) {
  applyClip(death, time);
  const bounds = deformedBounds(doc);
  samples.push({ time, min: bounds.min, max: bounds.max,
    height: bounds.max[1] - bounds.min[1] });
  restorePose(rest);
}
if (samples.some(s => ![...s.min, ...s.max].every(Number.isFinite))) throw new Error('Death deform became nonfinite');
if (samples.at(-1).max[1] > samples[0].max[1] * 0.72) throw new Error('Final collapse remains too upright');
if (samples.some(s => s.height > samples[0].height * 1.45)) throw new Error('Death deform stretches excessively');

const candidateBytes = await io.writeBinary(doc);
const baseline = (await io.readBinary(sourceBytes)).getRoot();
const compare = (label, a, b) => {
  if (sha(Buffer.from(a.buffer, a.byteOffset, a.byteLength)) !==
      sha(Buffer.from(b.buffer, b.byteOffset, b.byteLength))) throw new Error(`${label} changed`);
};
for (const [index, clip] of clips.entries()) {
  if (clip.getName() === 'Death') continue;
  const original = baseline.listAnimations()[index];
  if (original.getName() !== clip.getName() || original.listChannels().length !== clip.listChannels().length) {
    throw new Error(`Non-Death clip ${clip.getName()} changed shape`);
  }
  for (let channelIndex = 0; channelIndex < clip.listChannels().length; channelIndex++) {
    const a = original.listChannels()[channelIndex], b = clip.listChannels()[channelIndex];
    if (a.getTargetNode().getName() !== b.getTargetNode().getName() || a.getTargetPath() !== b.getTargetPath()) {
      throw new Error(`Non-Death clip ${clip.getName()} changed bindings`);
    }
    compare(`${clip.getName()} time`, a.getSampler().getInput().getArray(), b.getSampler().getInput().getArray());
    compare(`${clip.getName()} pose`, a.getSampler().getOutput().getArray(), b.getSampler().getOutput().getArray());
  }
}
for (const [index, mesh] of root.listMeshes().entries()) {
  const original = baseline.listMeshes()[index];
  if (!original || original.listPrimitives().length !== mesh.listPrimitives().length) throw new Error('Mesh structure changed');
  for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
    const before = original.listPrimitives()[primitiveIndex];
    for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
      const a = before.getAttribute(key), b = primitive.getAttribute(key);
      if (Boolean(a) !== Boolean(b)) throw new Error(`${key} presence changed`);
      if (a) compare(key, a.getArray(), b.getArray());
    }
    compare('indices', before.getIndices().getArray(), primitive.getIndices().getArray());
  }
}
if (baseline.listSkins().map(skin => skin.listJoints().map(j => j.getName()).join('|')).join(';') !==
    root.listSkins().map(skin => skin.listJoints().map(j => j.getName()).join('|')).join(';')) throw new Error('Rig changed');
for (const [index, texture] of root.listTextures().entries()) compare('texture', baseline.listTextures()[index].getImage(), texture.getImage());
await mkdir(dir, { recursive: true });
await writeFile(candidateFile, candidateBytes);
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const production = manifest.assets.find(asset => asset.id === 'creature_banshee');
if (!production) throw new Error('Production Banshee missing');
const staged = {
  ...production,
  tags: [...new Set([...production.tags, 'candidate', 'death-collapse'])],
  bytes: candidateBytes.length,
  sha256: sha(candidateBytes),
  animations: clips.map(clip => clip.getName()),
  candidateFile,
  sourceProvenance: {
    sourceAssetId: 'creature_banshee', sourceFile, sourceSha256,
    tripoSourceFile: 'assets/art/tripo/exports/88a36c89-9ab9-4471-a3df-f8158b6bd0a8.glb',
    tripoSourceSha256: '5df89799c3b9a27e0f151e2f93897de852a8cc780255ff9997d7c38a543495c7',
    builderFile, builderSha256: sha(await readFile(builderFile)),
    changes: 'Only Death animation accessors changed: sideways core collapse, lowering, inward shroud fold, and trailing mist ribbons. Other clips, rig, geometry, materials, and textures retained.',
  },
  acceptance: { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false,
    labAccepted: false, worldIntegrated: false },
};
const lab = { schema: 'corealm-lab-asset-candidates/1', assets: [staged], files: { creature_banshee: 'banshee-death-collapse.glb' } };
await writeFile(`${dir}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
await mkdir(`${dir}/promotions`, { recursive: true });
const pack = { id: 'corealm-tripo-audit-banshee-death', name: 'Corealm Tripo Banshee Death',
  author: 'Corealm / Tripo Studio', source: builderFile,
  license: 'LicenseRef-Corealm-Original', generatorSha256: staged.sourceProvenance.builderSha256 };
const promotion = { schema: 'corealm-creature-promotion/1', packs: [pack], assets: [{
  ...staged, pack: pack.id, tags: staged.tags.filter(tag => tag !== 'candidate'),
  sourceProvenance: { ...staged.sourceProvenance, productionBeforeSha256: production.sha256 },
  acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
}] };
await writeFile(`${dir}/promotions/banshee-death.json`, JSON.stringify(promotion, null, 2) + '\n');
console.log(JSON.stringify({ candidateFile, sha256: staged.sha256, samples }, null, 2));
