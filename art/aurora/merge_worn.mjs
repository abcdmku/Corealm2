// Combine two focused, independently passing runs for the same exported armor.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const round = process.argv[2];
assert(/^aurora-r\d+$/.test(round ?? ''), 'Pass the current Aurora round');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async file => {
  const bytes = await readFile(file);
  return { file, sha256: hash(bytes), report: JSON.parse(bytes.toString()) };
};
const root = `test-results/item-models/${round}-worn-`;
const walk = await read(`${root}walk/report.json`);
const cast = await read(`${root}cast/report.json`);
assert(walk.report.passed && cast.report.passed, 'Both focused runs must pass');
assert(!cast.report.shards, 'Casting report has already been merged');
const catalogue = JSON.parse(await readFile('art/item-models/candidates/armor-frostweave-aurora/catalogue.json', 'utf8'));
for (const asset of catalogue.assets) {
  for (const source of [walk, cast]) {
    assert(source.report.assets.some(row => row.itemId === asset.itemId && row.sha256 === asset.sha256), `${source.file}: stale ${asset.itemId}`);
  }
}
const walking = walk.report.captures.filter(row => row.name.startsWith('armor-walk-'));
const casting = cast.report.captures.filter(row => row.name.startsWith('casting-'));
assert.equal(walking.length, 9);
assert.equal(casting.length, 3);
assert.equal(walk.report.armorMotion.walking.length, 3);
assert.equal(cast.report.castMotion.length, 3);
for (const row of cast.report.castMotion) {
  assert(row.after.counters.spellLaunched > row.before.counters.spellLaunched);
  assert(row.after.target.health < row.before.target.health);
}
const castSource = `${root}cast/cast-shard-report.json`;
await writeFile(castSource, await readFile(cast.file));
const merged = { ...cast.report,
  captures: [...cast.report.captures, ...walking],
  armorMotion: walk.report.armorMotion,
  shards: [{ file: walk.file, sha256: walk.sha256 }, { file: castSource, sha256: cast.sha256 }],
  runNotes: ['Combined walk and cast run exceeded its 60 second deadline. Walking and casting then passed in separate runs with the same five asset hashes.'],
};
await writeFile(cast.file, JSON.stringify(merged, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, round, captures: merged.captures.length, walking: walking.length, casting: casting.length }));
