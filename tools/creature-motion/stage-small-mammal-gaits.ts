import { duration } from './pose.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { appendGaitAnimations, auditGroundGait } from '../repair-ground-creature-gaits.js';
import { authorSmallMammalGait } from './small-mammal-gait.js';

const out = 'art/rebuild/candidates/finish-motion/legacy-small-mammals'; await mkdir(out, { recursive: true });
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS), sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')), results = [];
const generatorSha256 = Object.fromEntries(await Promise.all(['tools/creature-motion/small-mammal-gait.ts', 'tools/creature-motion/stage-small-mammal-gaits.ts', 'tools/creature-motion/pose.ts', 'tools/lib/ground-gait.ts', 'tools/repair-ground-creature-gaits.ts'].map(async file => [file, sha(await readFile(file))])));
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['animal_rat', 'animal_rabbit', 'animal_rabbit_dark']) {
  if (!['animal_rat', 'animal_rabbit', 'animal_rabbit_dark'].includes(id)) throw new Error('Small mammal helper owns only rat and rabbits');
  const entry = manifest.assets.find((asset: any) => asset.id === id), sourceFile = `game/public/assets/${entry.file}`, source = await readFile(sourceFile);
  if (sha(source) !== entry.sha256.toLowerCase()) throw new Error(`Public source hash mismatch ${id}`);
  const doc = await io.readBinary(source), floorY = entry.groundY ?? entry.base.y;
  const gaits = (['Walk', 'Run'] as const).filter(name => doc.getRoot().listAnimations().some(c=>c.getName()===name)).map(name => authorSmallMammalGait(doc, id, name, duration(doc.getRoot().listAnimations().find(c=>c.getName()===name)!), floorY, name === 'Walk' ? entry.impliedWalkMps : entry.impliedRunMps));
  const sourceAudit = gaits.map(gait => auditGroundGait(doc, gait, id === 'animal_rat' ? 'rat_exp15' : 'wild_rabbit_test5', floorY, 7680));
  const bytes = appendGaitAnimations(source, gaits), candidate = await io.readBinary(bytes);
  const audit = gaits.map(gait => auditGroundGait(candidate, gait, id === 'animal_rat' ? 'rat_exp15' : 'wild_rabbit_test5', floorY, 7680));
  const row = { id, sourceFile, stagedFile: `${out}/${id}.glb`, sourceSha256: sha(source), sha256: sha(bytes), bytes: bytes.length, generatorSha256, offlinePassed: audit.every(row => row.passed), visualAccepted: false, promotable: false,
    set: { impliedWalkMps: entry.impliedWalkMps, impliedRunMps: entry.impliedRunMps, walkClipSeconds: gaits[0]!.seconds, runClipSeconds: gaits[1]?.seconds }, sourceAudit, audit };
  await writeFile(row.stagedFile, bytes); await writeFile(`${out}/${id}.json`, JSON.stringify(row, null, 2)); results.push(row);
  console.log(JSON.stringify({ id, passed: row.offlinePassed, clips: audit.map(row => ({ name: row.name, failures: row.failures, maxSoleSlip: Math.max(...row.feet.map(foot => foot.physicalNearFloorSoleSlipMps.max ?? Infinity)), penetration: row.maximumMeshPenetrationM })) }));
}
const combined = [];
for (const id of ['animal_rat', 'animal_rabbit', 'animal_rabbit_dark']) {
  try { const { audit, sourceAudit, ...row } = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8')); combined.push(row); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
await writeFile(`${out}/manifest-updates.json`, JSON.stringify(combined, null, 2));
if (results.some(row => !row.offlinePassed)) process.exitCode = 1;

