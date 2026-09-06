import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Freeze one or more freshly built creature-expansion species into a durable, hash-pinned staging
 * batch that `review-catalogue.mjs`, `lifecycle-proof.ts` and `promote-candidate.mjs` can all read.
 *
 * `tools/build-creature-expansion.ts` writes its GLBs and manifest-shaped asset entries into
 * `test-results/`, which is deliberately never committed and gets pruned. Copying them here, with
 * the generator and species-source SHA-256s recorded alongside, is what makes a later promotion
 * reproducible: anyone can re-run the generator and check they get the same bytes.
 *
 * Usage:
 *   npx tsx tools/creature-expansion/mammals/stage-expansion-batch.mjs \
 *     --out <batch-dir-name> --ids cairn_bighorn,marsh_moose --scope "<why this batch exists>" \
 *     [--sources tools/creature-expansion/hoofed.mjs,tools/creature-expansion/hoofed/moose-anatomy.mjs]
 */
const args = process.argv.slice(2), arg = n => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const batch = arg('--out'), ids = arg('--ids')?.split(','), scope = arg('--scope');
if (!batch || !ids?.length || !scope) throw Error('Usage: stage-expansion-batch.mjs --out <dir> --ids <a,b> --scope "<text>"');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const built = path.join(repo, 'test-results/creature-expansion');
const dir = path.join(repo, 'art/rebuild/candidates/finish-quadrupeds', batch);
await mkdir(path.join(dir, 'models'), {recursive: true});

const manifest = JSON.parse(await readFile(path.join(repo, 'game/public/assets/manifest.json'), 'utf8'));
const assets = [], files = {}, origins = [];
for (const id of ids) {
  const asset = JSON.parse(await readFile(path.join(built, `${id}.json`), 'utf8'));
  if (asset.buildFailed) throw Error(`${id} did not build`);
  const audit = JSON.parse(await readFile(path.join(built, `${id}.audit.json`), 'utf8'));
  if (audit.passed !== true) throw Error(`${id} audit did not pass`);
  const source = path.join(built, 'models', `${asset.id}.glb`), bytes = await readFile(source), sha = sha256(bytes);
  if (sha !== asset.sha256 || bytes.length !== asset.bytes) throw Error(`${id} export changed after its audit`);
  const name = `${asset.id}.${sha.slice(0, 12)}.glb`;
  await copyFile(source, path.join(dir, 'models', name));
  await writeFile(path.join(dir, `${id}.audit.json`), JSON.stringify(audit, null, 2) + '\n');
  files[asset.id] = `models/${name}`;
  assets.push({...asset, acceptance: {assetAudit: true, labAccepted: false, worldIntegrated: false}});
  origins.push({slot: asset.id, sha256: sha, bytes: bytes.length,
    priorProductionSha256: manifest.assets.find(a => a.id === asset.id)?.sha256 ?? null,
    priorProductionBytes: manifest.assets.find(a => a.id === asset.id)?.bytes ?? null});
}

// Pin whatever produced these bytes. A promotion that cannot name its generator is not reproducible.
const sourceFiles = (arg('--sources')?.split(',') ?? []).concat([
  'package-lock.json', 'tools/build-creature-expansion.ts', 'tools/creature-expansion/packs.ts',
]);
const sourceHashes = {};
for (const file of [...new Set(sourceFiles)]) sourceHashes[file] = sha256(await readFile(path.join(repo, file)));
const packs = manifest.packs.filter(p => assets.some(a => a.pack === p.id))
  .map(p => p.source && sourceHashes[p.source] ? {...p, generatorSha256: sourceHashes[p.source]} : p);
for (const pack of packs) if (pack.source && !sourceHashes[pack.source]) {
  sourceHashes[pack.source] = sha256(await readFile(path.join(repo, pack.source)));
  pack.generatorSha256 = sourceHashes[pack.source];
}

await writeFile(path.join(dir, 'catalogue.json'), JSON.stringify({
  schema: 'corealm-asset-candidates/1', scope, packs, files, assets, origins, sourceHashes,
}, null, 2) + '\n');
console.log(JSON.stringify({batch, assets: assets.map(a => ({id: a.id, sha256: a.sha256, bytes: a.bytes, triangles: a.triangles, animations: a.animations.length}))}, null, 2));
