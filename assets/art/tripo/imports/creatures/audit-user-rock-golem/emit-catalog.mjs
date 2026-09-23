import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const dir = 'assets/art/tripo/imports/creatures/audit-user-rock-golem';
const candidateFile = `${dir}/quarry-warden-user-rock-golem-candidate.glb`;
const sourceFile = `${dir}/rock-golem-user-original.glb`;
const builderFile = `${dir}/build-candidate.mjs`;
const floorFile = `${dir}/audit-motion.mjs`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(candidateFile), digest = sha(bytes);
const validation = JSON.parse(await readFile(`${dir}/validation.json`, 'utf8'));
const motion = JSON.parse(await readFile(`${dir}/motion-audit.json`, 'utf8'));
if (digest !== validation.candidateSha256) throw new Error('Candidate hash differs from final validation report.');
for (const [name, result] of Object.entries(motion)) if (name !== 'Idle' && result.minY < .0055) throw new Error(`${name} weighted floor below target: ${result.minY}`);
if (motion.Death.final.height / motion.Idle.final.height > .62) throw new Error('Death corpse stays too tall.');
const root = (await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes)).getRoot();
const sourceRoot = (await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(sourceFile))).getRoot();
const sourceJoints = sourceRoot.listSkins()[0].listJoints();
const outputJoints = root.listSkins()[0].listJoints();
for (let i = 0; i < sourceJoints.length; i++) {
  const a = sourceJoints[i], b = outputJoints[i];
  const at = [...a.getTranslation(), ...a.getRotation(), ...a.getScale()];
  const bt = [...b.getTranslation(), ...b.getRotation(), ...b.getScale()];
  if (a.getName() !== b.getName() || Math.max(...at.map((x, k) => Math.abs(x - bt[k]))) > 1e-5) throw new Error(`Default joint TRS changed at ${a.getName()}`);
}
const primitive = root.listMeshes()[0].listPrimitives()[0];
const values = primitive.getAttribute('POSITION').getArray();
const scale = 4.12;
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < values.length; i += 3) for (let axis = 0; axis < 3; axis++) {
  min[axis] = Math.min(min[axis], values[i + axis] * scale);
  max[axis] = Math.max(max[axis], values[i + axis] * scale);
}
const size = { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] };
const base = { x: min[0], y: min[1], z: min[2] };
const packId = 'corealm-user-tripo-rock-golem-quarry-warden';
const pack = { id: packId, name: 'Corealm User Rock Golem Quarry Warden', author: 'User / Corealm', source: builderFile, license: 'LicenseRef-Corealm-Original', generatorSha256: sha(await readFile(builderFile)) };
const rootPath = path.resolve('.').replaceAll('\\', '/');
const asset = {
  id: 'creature_boss_ordrun', file: 'models/creature/creature_boss_ordrun.glb', pack: packId,
  category: 'character', is: 'Quarry Warden', tags: ['creature', 'boss', 'quarrykeeper', 'ordrun', 'stone', 'golem', 'user-supplied', 'tripo'],
  bytes: bytes.length, sha256: digest, size, base, bounds: { min, max }, groundY: 0,
  triangles: 4771, vertices: 7424,
  animations: root.listAnimations().map((a) => a.getName()), materials: root.listMaterials().map((m) => m.getName()),
  walkClipSeconds: 1.08, runClipSeconds: .72, attackSeconds: 1.02, contactNormalized: .43 / 1.02,
  impliedWalkMps: null, impliedRunMps: null, locomotionPolicy: 'definition-speed; authored in-place animation',
  metadata: { is: 'User-supplied stone-skinned golem', walkClipSeconds: 1.08, runClipSeconds: .72, attackSeconds: 1.02, contactNormalized: .43 / 1.02, contactSeconds: .43, contactBasis: 'Authored forward right-arm crushing punch, chest drive and +Z hip lunge peak at 0.43 s.', gamePresentationScale: .8691519590640763, renderedIdleHeightMeters: motion.Idle.final.height * .8691519590640763 },
  sourceProvenance: { author: 'User-supplied rigged Tripo GLB', sourceFile, sourceSha256: sha(await readFile(sourceFile)), sourceBytes: (await readFile(sourceFile)).length, candidateFile, candidateSha256: digest, rigMethod: 'Kept original 67-joint skin, four influence slots, source weights and bind matrices; authored eight action clips on existing skeleton.', geometryPreserved: true, pbrTexturesPreserved: true, textures: validation.textures, nativeScale: scale, floorCorrectionGenerator: floorFile, floorCorrectionSha256: sha(await readFile(floorFile)), cpuMotionAudit: `${dir}/motion-audit.json`, cpuMotionSamplesPerClip: 193, deathFinalHeightRatio: motion.Death.final.height / motion.Idle.final.height, maximumPenetrationMeters: 0 },
  acceptance: { assetAudit: true, labAccepted: false, worldIntegrated: false },
  candidateFile,
};
const lab = { schema: 'corealm-lab-asset-candidates/1', pack, assets: [asset], files: { [asset.id]: `${rootPath}/${candidateFile}` } };
await writeFile(`${dir}/lab-catalog.json`, JSON.stringify(lab, null, 2) + '\n');
const promotion = { schema: 'corealm-creature-promotion/1', sourceRoot: '.', destinationRoot: 'game/public/assets', pack, assets: [asset] };
await writeFile('test-results/creature-audit/promotions/user-quarry-warden.json', JSON.stringify(promotion, null, 2) + '\n');
console.log(JSON.stringify({ catalog: `${dir}/lab-catalog.json`, promotion: 'test-results/creature-audit/promotions/user-quarry-warden.json', candidateSha256: digest, size, idleRenderedHeight: asset.metadata.renderedIdleHeightMeters, deathHeightRatio: asset.sourceProvenance.deathFinalHeightRatio }, null, 2));
