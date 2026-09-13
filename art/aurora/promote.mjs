// Invoke only after root inspection and a fresh critic review of this round.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const round=process.argv[2];
assert(/^aurora-r\d+$/.test(round??''),'Pass the root-reviewed Aurora round');
const file='art/item-models/candidates/armor-frostweave-aurora/catalogue.json';
const catalog=JSON.parse(readFileSync(file,'utf8'));
const review=JSON.parse(readFileSync('runs/aurora/visual-review.json','utf8'));
assert(review.passed&&review.round===round&&review.dependencySha256===catalog.dependencySha256,'Current root visual acceptance is required');
assert(catalog.assets.every(a=>review.assets.some(b=>a.itemId===b.itemId&&a.sha256===b.sha256)),'Visual review hashes are stale');
for(const gate of ['pieces','worn-cast']){
 const r=JSON.parse(readFileSync(`test-results/item-models/${round}-${gate}/report.json`,'utf8'));
 assert(r.passed&&catalog.assets.every(a=>r.assets.some(b=>a.itemId===b.itemId&&a.sha256===b.sha256)));
}
for(const a of catalog.assets)if(!a.tags.includes('aurora-tailored-approved'))a.tags.push('aurora-tailored-approved');
writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');
for(const a of catalog.assets){const r=spawnSync(process.execPath,['--import','tsx','tools/item-models/record-review.ts','armor-frostweave-aurora',a.itemId,`${round}-pieces`,'visual-approved'],{stdio:'inherit'});assert.equal(r.status,0);}
const r=spawnSync(process.execPath,['--import','tsx','tools/item-models/promote.ts','armor-frostweave-aurora',`test-results/item-models/${round}-worn-cast/report.json`],{stdio:'inherit'});assert.equal(r.status,0);
