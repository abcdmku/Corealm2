/** CPU-only manifest/GLB/timing inventory; never treats clip metadata as gameplay proof. */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { CREATURE_MOTION_TIMING } from '../../game/src/content/creatureMotionTiming.js';
import { argValue, repoRoot } from '../lib/paths.js';

const args = process.argv.slice(2);
const out = path.resolve(repoRoot, argValue(args, '--out') ?? 'tools/creature-motion/motion-metadata-audit.json');
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'game/public/assets/manifest.json'), 'utf8'));
const candidateRoot = path.join(repoRoot, 'art/rebuild/candidates/finish-motion');
const legacy = JSON.parse(await readFile(path.join(candidateRoot, 'legacy-catalog.json'), 'utf8'));
const rhinos = JSON.parse(await readFile(path.join(candidateRoot, 'rhino-attack/catalog.json'), 'utf8'));
const ground = [...JSON.parse(await readFile(path.join(candidateRoot, 'ground-creature-gaits/manifest-updates.json'), 'utf8')),
  ...JSON.parse(await readFile(path.join(candidateRoot, 'scorpion-ground-gait/manifest-updates.json'), 'utf8'))];
const ids: string[] = [...legacy.assets.map((asset: any) => asset.id), 'animal_frog', 'animal_frog_green', 'animal_crab', 'animal_scorpion', ...rhinos.assets.map((asset: any) => asset.id)];
const required = ['Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];
const rows: any[] = [];
for (const id of ids) {
  const asset = manifest.assets.find((asset: any) => asset.id === id);
  if (!asset) throw new Error(`Manifest lacks ${id}`);
  const bytes = await readFile(path.join(repoRoot, 'game/public/assets', asset.file));
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`Invalid GLB ${id}`);
  const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const bin = bytes.subarray(28 + jsonLength);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const problems: string[] = [], observations: string[] = [];
  const clips = (gltf.animations ?? []).map((animation: any) => {
    let seconds = 0, invalidTimes = 0;
    for (const sampler of animation.samplers) {
      const accessor = gltf.accessors[sampler.input], view = gltf.bufferViews[accessor.bufferView];
      if (accessor.componentType !== 5126 || accessor.type !== 'SCALAR') throw new Error(`Nonfloat animation time ${id}/${animation.name}`);
      let previous = -Infinity;
      for (let i = 0; i < accessor.count; i++) {
        const value = bin.readFloatLE((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 4));
        if (!Number.isFinite(value) || value < previous) invalidTimes++;
        previous = value; seconds = Math.max(seconds, value);
      }
    }
    const targets = animation.channels.map((channel: any) => `${channel.target.node}/${channel.target.path}`);
    return { name: animation.name, seconds, marker: animation.extras?.contactNormalized ?? null,
      invalidTimes, duplicateTargets: targets.length - new Set(targets).size, channels: targets.length,
      extras: animation.extras ?? null };
  });
  for (const name of required) if (!clips.some((clip: any) => clip.name === name)) problems.push(`Missing ${name}`);
  if (sha256 !== asset.sha256.toLowerCase()) problems.push('Production bytes differ from manifest SHA');
  if (bytes.length !== asset.bytes) problems.push('Production byte count differs from manifest');
  const timing = CREATURE_MOTION_TIMING[id], attack = clips.find((clip: any) => clip.name === 'Attack');
  if (!timing) problems.push('No runtime Attack timing row');
  else if (attack) {
    if (Math.abs(timing.seconds - attack.seconds) > .00001) problems.push('Attack duration differs from runtime timing');
    if (attack.marker === null) observations.push('Attack marker absent from GLB; runtime uses separate timing table');
    else if (Math.abs(attack.marker - timing.contactNormalized) > .000001) problems.push('Attack marker differs from runtime timing');
  }
  for (const clip of clips) {
    if (clip.invalidTimes || clip.duplicateTargets) problems.push(`Invalid channel/time metadata: ${clip.name}`);
    if (required.includes(clip.name) && !asset.animations.includes(clip.name)) problems.push(`Manifest omits ${clip.name}`);
  }
  for (const [name, field] of [['Walk', 'walkClipSeconds'], ['Run', 'runClipSeconds']]) {
    const clip = clips.find((clip: any) => clip.name === name);
    if (clip && (typeof asset[field!] !== 'number' || Math.abs(asset[field!] - clip.seconds) > .00001)) problems.push(`${name} manifest duration missing or mismatched`);
  }
  const candidate = [...legacy.assets, ...ground, ...rhinos.assets].find((candidate: any) => candidate.id === id);
  const currentCandidateMatch = candidate ? candidate.sha256.toLowerCase() === sha256 : null;
  if (!clips.some((clip: any) => /stagger/i.test(clip.name))) observations.push('No distinct Stagger clip');
  if (!clips.some((clip: any) => /turn/i.test(clip.name))) observations.push('No distinct Turn clip; turning uses locomotion');
  if (currentCandidateMatch === false) observations.push('Production is not the latest staged candidate; candidate review cannot be attributed to current public bytes');
  rows.push({ id, sha256, currentCandidateMatch, candidateSha256: candidate?.sha256 ?? null,
    stagedCandidateTiming: rhinos.timingUpdates?.[id] ?? null, manifestAnimations: asset.animations, runtimeAttackTiming: timing,
    clips, metadata: Object.fromEntries(Object.entries(asset).filter(([key]) => /ground|base|walk|run|stride|motion|animation|phase|residen/i.test(key))),
    problems, observations, gameplayAcceptedByThisAudit: false });
}
const report = { generatedAt: new Date().toISOString(), scope: '12 legacy, 4 ground, 3 rhino production assets',
  assetCount: rows.length, metadataProblemCount: rows.reduce((sum, row) => sum + row.problems.length, 0), rows,
  residency: { perAssetPhaseMetadataRequired: false,
    implementation: 'game/src/render/creatureMotion.ts owns per-actor time, previous clip/time and blend state; manifest gait durations/speeds support both representations.',
    limitation: 'Presence of that implementation does not prove phase preservation while real actors cross live/sampled/resident boundaries.' },
  recommendedBrowserShards: [
    { ids: ['animal_bear', 'animal_cattle', 'animal_boar'], proof: 'Heavy quadrupeds: real attack/damage contact, all hit directions, death endpoint, actor movement into/out of live rig range.' },
    { ids: ['animal_coyote', 'animal_goat', 'animal_deer'], proof: 'Canine/caprine/cervine: normal attack anticipation/recovery, death silhouette, phase continuity across live/sampled changes.' },
    { ids: ['animal_hog', 'animal_rat', 'animal_rabbit'], proof: 'Small mammals and Walk-only pursuit: real contact/recoil/death and no playback reset on representation switches.' },
    { ids: ['animal_frog', 'animal_crab', 'animal_scorpion'], proof: 'Different anatomies: attack interruption, directional hit/death, planted transition and actual representation crossing.' },
    { ids: ['boss_rhino_earth', 'boss_rhino_water'], proof: 'Natural Attack contact plus actual front/left/right hit clips; whole head/player visual relation and retained feet.' },
  ],
  limitations: ['No browser/GPU session run.', 'No death, recoil, attack contact or residency acceptance inferred from gait approval.',
    'Null Hit/Death contact markers are not inherently missing metadata: damage timing uses Attack; Hit onset and Death endpoint require gameplay review.'] };
await writeFile(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, assets: rows.length, problems: rows.filter(row => row.problems.length).map(row => ({ id: row.id, problems: row.problems })) }, null, 2));
