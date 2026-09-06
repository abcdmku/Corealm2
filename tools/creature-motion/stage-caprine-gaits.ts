import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { appendGaitAnimations, auditGroundGait } from '../repair-ground-creature-gaits.js';
import { authorCaprineGait } from './caprine-gait.js';

const out = resolve('art/rebuild/candidates/finish-motion/legacy-caprines');
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
await mkdir(out, { recursive: true });
const generator = await Promise.all(['tools/creature-motion/caprine-gait.ts', 'tools/creature-motion/stage-caprine-gaits.ts', 'tools/lib/ground-gait.ts', 'tools/repair-ground-creature-gaits.ts', 'tools/creature-motion/pose.ts'].map(async file => ({ file, sha256: sha(await readFile(file)) })));
const rows = [];
for (const id of ['animal_goat', 'animal_ibex']) {
  const asset = manifest.assets.find((a: any) => a.id === id), sourceFile = resolve('game/public/assets', asset.file), source = await readFile(sourceFile);
  if (sha(source) !== asset.sha256.toLowerCase()) throw new Error(`${id} source hash differs`);
  try {
    const doc = await io.readBinary(source), floor = asset.groundY ?? asset.base.y;
    const gaits = (['Walk', 'Run'] as const).map(name => authorCaprineGait(doc, id, name, name === 'Walk' ? asset.impliedWalkMps : asset.impliedRunMps, floor));
    const output = appendGaitAnimations(source, gaits), restored = await io.readBinary(output);
    const audit = gaits.map(g => auditGroundGait(restored, g, id === 'animal_goat' ? 'goat_mesh' : 'buk26', floor, 7680));
    const row = { id, sourceFile, sourceSha256: sha(source), stagedFile: resolve(out, `${id}.glb`), sha256: sha(output), bytes: output.length, generator, preserved: { originalBinPrefix: true, originalNonlocomotionSamplers: true, originalGeometryAndRig: true, originalNativeGaitSpeeds: true, originalGaitDurations: true }, offlinePassed: audit.every(a => a.passed), visualAccepted: false, promotable: false, audit };
    await writeFile(row.stagedFile, output); await writeFile(resolve(out, `${id}.json`), JSON.stringify(row, null, 2)); rows.push(row);
    console.log(JSON.stringify({ id, passed: row.offlinePassed, audit: audit.map(a => ({ name: a.name, failures: a.failures, penetration: a.maximumMeshPenetrationM })) }));
  } catch (error) { const row = { id, offlinePassed: false, refusal: String(error) }; rows.push(row); console.log(JSON.stringify(row)); }
}
await writeFile(resolve(out, 'manifest-updates.json'), JSON.stringify(rows, null, 2));
if (rows.some(r => !r.offlinePassed)) process.exitCode = 1;

