import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generatorFileSha256 } from './generator-hash.js';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { appendGaitAnimations, auditGroundGait } from '../repair-ground-creature-gaits.js';
import { authorCervineGait } from './cervine-gait.js';

const out = 'art/rebuild/candidates/finish-motion/legacy-cervines'; await mkdir(out, { recursive: true });
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS), sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')), results = [];
const generatorSha256 = Object.fromEntries(await Promise.all(['tools/creature-motion/cervine-gait.ts', 'tools/creature-motion/stage-cervine-gaits.ts', 'tools/lib/ground-gait.ts', 'tools/repair-ground-creature-gaits.ts'].map(async file => [file, await generatorFileSha256(file)])));
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : ['animal_deer']) {
  if (!['animal_deer'].includes(id)) throw new Error('Cervine helper owns only deer');
  const entry = manifest.assets.find((asset: any) => asset.id === id), sourceFile = `game/public/assets/${entry.file}`, source = await readFile(sourceFile);
  if (sha(source) !== entry.sha256.toLowerCase()) throw new Error(`Public source hash mismatch ${id}`);
  const doc = await io.readBinary(source), floorY = entry.groundY ?? entry.base.y;
  const gaits = (['Walk', 'Run'] as const).map(name => authorCervineGait(doc, name, name === 'Walk' ? entry.impliedWalkMps : entry.impliedRunMps, floorY));
  const bytes = appendGaitAnimations(source, gaits), candidate = await io.readBinary(bytes);
  const audit = gaits.map(gait => auditGroundGait(candidate, gait, 'deer_body', floorY, 7680));
  const row = { id, sourceFile, stagedFile: `${out}/${id}.glb`, sourceSha256: sha(source), sha256: sha(bytes), bytes: bytes.length, generatorSha256, offlinePassed: audit.every(row => row.passed), visualAccepted: false, promotable: false,
    set: { impliedWalkMps: entry.impliedWalkMps, impliedRunMps: entry.impliedRunMps, walkClipSeconds: gaits[0]!.seconds, runClipSeconds: gaits[1]!.seconds }, audit };
  await writeFile(row.stagedFile, bytes); await writeFile(`${out}/${id}.json`, JSON.stringify(row, null, 2)); results.push(row);
  console.log(JSON.stringify({ id, passed: row.offlinePassed, clips: audit.map(row => ({ name: row.name, failures: row.failures, maxSoleSlip: Math.max(...row.feet.map(foot => foot.physicalNearFloorSoleSlipMps.max ?? Infinity)), penetration: row.maximumMeshPenetrationM })) }));
}
const combined = [];
for (const id of ['animal_deer']) {
  try { const { audit, ...row } = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8')); combined.push(row); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
await writeFile(`${out}/manifest-updates.json`, JSON.stringify(combined, null, 2));
if (results.some(row => !row.offlinePassed)) process.exitCode = 1;

