import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { authorCanineGait } from './canine-gait.js';
import { appendGaitAnimations, auditGroundGait } from '../repair-ground-creature-gaits.js';
import { duration } from './pose.js';
const out = 'art/rebuild/candidates/finish-motion/legacy-canines';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')), io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
await mkdir(out, { recursive: true });
const rows = [];
const generator = await Promise.all(['tools/creature-motion/canine-gait.ts', 'tools/creature-motion/stage-canine-gaits.ts', 'tools/creature-motion/pose.ts', 'tools/lib/ground-gait.ts', 'tools/repair-ground-creature-gaits.ts'].map(async file => ({ file, sha256: sha(await readFile(file)) })));
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['animal_coyote', 'animal_bear']) {
  const asset = manifest.assets.find((a: any) => a.id === id), source = await readFile(`game/public/assets/${asset.file}`), doc = await io.readBinary(source);
  if (sha(source) !== asset.sha256.toLowerCase()) throw new Error('Source manifest mismatch');
  const gaits = (['Walk', 'Run'] as const).map(name => authorCanineGait(doc, id, name, duration(doc.getRoot().listAnimations().find(c => c.getName() === name)!), asset.groundY, name === 'Walk' ? asset.impliedWalkMps : asset.impliedRunMps));
  const bytes = appendGaitAnimations(source, gaits), reloaded = await io.readBinary(bytes);
  const audits = gaits.map(gait => auditGroundGait(reloaded, gait, id === 'animal_coyote' ? 'Wolf_Mesh' : 'brown_bea4', asset.groundY, 7680));
  const row = { id, sourceFile: `game/public/assets/${asset.file}`, sourceSha256: sha(source), sha256: sha(bytes), bytes: bytes.length, stagedFile: `${out}/${id}.glb`, generator, offlinePassed: audits.every(a => a.passed), visualAccepted: false, promotable: false, preserved: { originalBinPrefix: true, nonlocomotionClips: true, geometrySkinMaterialsHierarchy: true, durationsAndNativeSpeeds: true }, diagnostics: gaits.map(g => g.diagnostics), audits };
  await writeFile(`${out}/${id}.json`, JSON.stringify(row, null, 2));
  console.log(JSON.stringify({ id, passed: row.offlinePassed, audits: audits.map(a => ({ name: a.name, failures: a.failures })) }));
  if (!row.offlinePassed) throw new Error(`${id} physical contact audit failed`);
  await writeFile(row.stagedFile, bytes); rows.push(row);
}
// A per-ID rerun must retain other successfully staged candidates.
const proposals = [];
for (const id of ['animal_coyote', 'animal_bear']) {
  let report;
  try { report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
  if (!report.offlinePassed) continue;
  if (sha(await readFile(report.stagedFile)) !== report.sha256) throw new Error(`${id} staged hash mismatch`);
  const { audits, diagnostics, ...proposal } = report; proposals.push(proposal);
}
await writeFile(`${out}/manifest-updates.json`, JSON.stringify(proposals, null, 2));

