/** Consolidates accepted motion evidence without treating superseded Hit clips as current. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const base = 'test-results/regional-bosses';
const read = async file => JSON.parse(await readFile(`${base}/${file}`, 'utf8'));
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const catalog = await read('catalog.json');
const hitDir = 'lab-tempest_roc-galeskin-rootheart-mossbound-tideworn-ordrun-cinderwake-hit';
const hit = await read(`${hitDir}/lab.json`);
assert.deepEqual(hit.consoleErrors, []);
assert.deepEqual(hit.pageErrors, []);
const sources = {
  tempest_roc: { report: 'tempest-accepted-full-cycles.json', images: 'lab-tempest_roc-tideworn', backup: 'tempest-before-hit-repair.glb', identity: 'tempest-hit-identity.json', coverage: 'Complete live Idle, Walk, Run and Attack cycles' },
  tideworn: { report: 'lab-tideworn/lab.json', images: 'lab-tideworn', backup: 'tideworn-before-directional-hit-repair.glb', identity: 'tideworn-hit-identity.json', coverage: 'Complete live Idle, Walk, Run and Attack cycles; real melee damage' },
  galeskin: { report: 'lab-tempest_roc-galeskin-rootheart-mossbound/lab.json', images: 'lab-tempest_roc-galeskin-rootheart-mossbound', coverage: 'Previously reviewed Idle, Walk, Run and Attack samples' },
  rootheart: { report: 'lab-tempest_roc-galeskin-rootheart-mossbound/lab.json', images: 'lab-tempest_roc-galeskin-rootheart-mossbound', coverage: 'Previously reviewed Idle, Walk, Run and Attack samples' },
  mossbound: { report: 'lab-tempest_roc-galeskin-rootheart-mossbound/lab.json', images: 'lab-tempest_roc-galeskin-rootheart-mossbound', coverage: 'Previously reviewed Idle, Walk, Run and Attack samples; real melee damage' },
  ordrun: { report: 'lab-tideworn-ordrun-cinderwake/lab.json', images: 'lab-tideworn-ordrun-cinderwake', coverage: 'Previously reviewed Idle, Walk, Run and Attack samples' },
  cinderwake: { report: 'lab-cinderwake/lab.json', images: 'lab-cinderwake', coverage: 'Previously reviewed repaired furnace Idle, Walk, Run and Attack samples; real melee damage' },
};
const rows = [];
for (const asset of catalog.assets) {
  const id = asset.id.replace('creature_boss_', ''), source = sources[id];
  const file = `${base}/creature_boss_${id}.glb`;
  assert.equal(await digest(file), asset.sha256, `Catalog/file identity for ${id}`);
  assert.equal(hit.candidateHashes[asset.id], asset.sha256, `Final Hit identity for ${id}`);
  const report = await read(source.report);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.pageErrors, []);
  let identity = null;
  if (source.identity) {
    assert.equal(await digest(`${base}/${source.backup}`), report.candidateHashes[asset.id]);
    execFileSync(process.execPath, ['tools/regional-bosses/immutable-audit.mjs', `${base}/${source.backup}`, file, `${base}/${source.identity}`], { stdio: 'pipe' });
    identity = { report: `${base}/${source.identity}`, ...await read(source.identity) };
  } else assert.equal(report.candidateHashes[asset.id], asset.sha256, `Body/clip identity for ${id}`);
  const bodySamples = report.evidence.filter(row => row.id === id && ['idle', 'walk', 'run', 'attack'].includes(row.motion)).flatMap(row => row.samples);
  const reactions = hit.evidence.filter(row => row.id === id);
  assert.equal(reactions.length, source.identity ? 2 : 1);
  const hits = reactions.map(row => {
    const overlays = row.samples.map(sample => sample.motion.hitOverlay).filter(Boolean);
    assert.equal(row.samples.length, 9);
    assert(overlays.length >= 3 && overlays.every(overlay => overlay.maskStatus === 'native-masked' && overlay.bones.length > 0));
    assert(Math.max(...overlays.map(overlay => overlay.weight)) > .5);
    assert.equal(row.samples.at(-1).motion.hitOverlay, null);
    return { impactSide: row.impactSide, sampleCount: row.samples.length, activeSamples: overlays.length,
      observedMs: row.observedMs, completed: true,
      minClearance: Math.min(...row.samples.map(sample => sample.clearance)),
      maxClearance: Math.max(...row.samples.map(sample => sample.clearance)),
      screenshot: `${base}/${hitDir}/${id}-hit${row.impactSide === 'right' ? '-right' : ''}-1.png` };
  });
  rows.push({ id, sha256: asset.sha256, triangles: asset.triangles, height: asset.size.y,
    bodyReport: `${base}/${source.report}`, coverage: source.coverage, identity,
    bodySampleCount: bodySamples.length,
    minBodyClearance: Math.min(...bodySamples.map(sample => sample.clearance)),
    maxBodyClearance: Math.max(...bodySamples.map(sample => sample.clearance)),
    idle: `${base}/${source.images}/${id}-idle-1.png`, attack: `${base}/${source.images}/${id}-attack-3.png`,
    hitReport: `${base}/${hitDir}/lab.json`, hits,
    combat: report.evidence.filter(row => row.id === id && row.combatBefore).map(row => ({ before: row.combatBefore.target, after: row.combatAfter.target })) });
}
const summary = { rows, finalHitElapsedMs: hit.elapsedMs,
  finalHitSamples: hit.evidence.flatMap(row => row.samples).length,
  consoleErrors: hit.consoleErrors, pageErrors: hit.pageErrors,
  visualReview: 'Worker inspected all seven current front Hit views and both current stone-boss HitRight views. Tempest and Tideworn repaired full-cycle material, jaw attachment and silhouette views were also inspected. Their geometry, materials, bind data and non-Hit clips match that earlier evidence exactly. Root and fresh critic final acceptance remain separate.',
  camera: 'Every cited view uses a ground-level player-follow camera, 8 m requested zoom, normal gameplay pitch and mouse orbit. No detached camera.',
};
await writeFile(`${base}/lab-acceptance-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ rows: rows.map(row => ({ id: row.id, sha256: row.sha256, hitReactions: row.hits.length })), finalHitElapsedMs: hit.elapsedMs, finalHitSamples: summary.finalHitSamples }));
