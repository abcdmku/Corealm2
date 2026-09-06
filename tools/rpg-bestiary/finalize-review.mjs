/** CPU-only catalogue bookkeeping; never sets visual acceptance or promotes assets. */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { applyGaitMetadata } from './gait-metadata.mjs';
import { BESTIARY_IDS } from './build.mjs';

const [directory, baseline] = process.argv.slice(2);
assert(directory && baseline, 'Usage: finalize-review.mjs candidate-directory immutable-baseline-directory');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const catalogPath = path.join(directory, 'catalog.json');
const catalog = await json(catalogPath);
for (const id of BESTIARY_IDS) assert(catalog.assets.some(entry => entry.id === `creature_${id}`), `${id}: do not synchronize production bounds from a partial review catalogue`);
const oldCatalog = await json(path.join(baseline, 'catalog.json'));
const oldReports = await json(path.join(baseline, 'compatibility.json'));
const files = (await readdir(directory)).filter(file => /^compatibility-.*\.json$/.test(file) && !file.includes('baseline'));
const fresh = (await Promise.all(files.map(file => json(path.join(directory, file))))).flat();
const reports = [];
const changes = [];
for (const entry of catalog.assets) {
  const bytes = await readFile(path.join(directory, entry.candidateFile));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.id}: binary hash mismatch`);
  const id = entry.id.replace(/^creature_/, '');
  const old = oldCatalog.assets.find(item => item.id === entry.id);
  const measured = fresh.find(item => item.id === id && item.glbSha256 === entry.sha256 && item.passed);
  if (measured) reports.push(measured);
  else {
    assert.equal(old?.sha256, entry.sha256, `${id}: changed binary lacks exact audit`);
    const prior = oldReports.find(item => item.id === id && item.glbSha256 === entry.sha256 && item.passed);
    assert(prior, `${id}: immutable baseline has no matching successful audit`);
    reports.push({ ...prior, carriedFrom: path.join(baseline, 'compatibility.json'), carriedByExactGlbSha256: true });
  }
  applyGaitMetadata(entry);
  changes.push({ id, glbChanged: old?.sha256 !== entry.sha256, beforeSha256: old?.sha256, sha256: entry.sha256 });
}
await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(path.join(directory, 'compatibility.json'), JSON.stringify(reports, null, 2) + '\n');
const contentFile = 'game/src/content/rpgBestiary.ts';
const content = await readFile(contentFile, 'utf8');
const lines = catalog.assets.map(entry => {
  const values = [...['x','y','z'].map(key => entry.base[key]), ...['x','y','z'].map(key => entry.size[key])].map(value => Number(value.toFixed(6)));
  return `  ${entry.id.replace(/^creature_/, '')}: [${values.join(', ')}],`;
});
const updated = content.replace(/(const nativeBounds:[\s\S]*?= \{\n)[\s\S]*?(\n\};)/, `$1${lines.join('\n')}$2`);
assert.notEqual(updated.indexOf(lines[0]), -1, 'Native bounds replacement failed');
await writeFile(contentFile, updated);
const catalogueSha256 = createHash('sha256').update(await readFile(catalogPath)).digest('hex');
await writeFile(path.join(directory, 'revision.json'), JSON.stringify({ baseline, catalogueSha256, geometryAcceptance: false, changes }, null, 2) + '\n');
console.log(JSON.stringify({ catalogueSha256, models: reports.length, changedModels: changes.filter(item => item.glbChanged).map(item => item.id) }));
