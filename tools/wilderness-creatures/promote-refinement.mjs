/** Root-only promotion after visual review. Every exported hash needs passing lab evidence. */
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const reports=[
 'test-results/wilderness-dragons/lab-shallow-full/report.json',
 'test-results/wilderness-dragons/lab-deep-materials/report.json',
 'test-results/wilderness-dragons/lab-deep-amethyst_dragon-materials/report.json',
 ...['shallow','shallow_refined','deep','shallow_keepers','deep_keepers_refined','hollow_refined'].map(batch=>`test-results/wilderness-creatures/lab-${batch}/report.json`),
];
const proofs=await Promise.all(reports.map(async file=>({file,report:await read(file)})));
const manifestPath='game/public/assets/manifest.json',manifest=await read(manifestPath),rows=[];
for(const catalogPath of ['test-results/wilderness-dragons/catalog.json','test-results/wilderness-creatures/refined/catalog.json']){
 const catalog=await read(catalogPath);
 for(const candidate of catalog.assets){
  const file=path.resolve(path.dirname(catalogPath),catalog.files[candidate.id]);
  const bytes=await readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,candidate.sha256);assert.equal(bytes.length,candidate.bytes);
  const proof=proofs.find(({report:r})=>r.passed&&r.evidence.some(e=>
   (e.id===candidate.id.replace(/^creature_/,''))&&(e.sha256===hash||r.candidateHashes?.[candidate.id]===hash)));
  assert(proof,`${candidate.id}: no passing current-hash lab report`);
  const index=manifest.assets.findIndex(a=>a.id===candidate.id),live=manifest.assets[index];
  if(live?.sha256===hash)continue;
  rows.push({candidate,file,index,live,proof:proof.file});
 }
}
console.log(JSON.stringify(rows.map(r=>({id:r.candidate.id,proof:r.proof})),null,2));
if(!process.argv.includes('--promote'))process.exit(0);
for(const {candidate,file,index,live,proof} of rows){
 await copyFile(file,`game/public/assets/${candidate.file}`);
 const entry={...live,...candidate,acceptance:{exported:true,labAccepted:true,worldIntegrated:false,labReport:proof}};
 if(index<0)manifest.assets.push(entry);else manifest.assets[index]=entry;
}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
// The existing run-cadence contract is three measured strides per second.
const timingPath='game/src/content/creatureMotionTiming.ts';let timing=await readFile(timingPath,'utf8');
for(const {candidate:a} of rows.filter(r=>r.candidate.metadata?.provenance?.generator==='tools/wilderness-dragons/build.mjs')){
 const cap=Number((3*a.impliedRunMps*a.runClipSeconds).toFixed(4));
 const line=`CREATURE_PURSUIT_CEILING_MPS["${a.id}"] = ${cap};`;
 const existing=new RegExp(`CREATURE_PURSUIT_CEILING_MPS\\["${a.id}"\\] = [0-9.]+;`);
 timing=existing.test(timing)?timing.replace(existing,line):timing+'\n'+line+'\n';
}
await writeFile(timingPath,timing);
