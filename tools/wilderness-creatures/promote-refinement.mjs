/** Root-only promotion after visual review. Every exported hash needs passing lab evidence. */
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const reports=[
 'test-results/wilderness-dragons/lab-shallow-full/report.json',
 'test-results/wilderness-dragons/lab-deep-materials/report.json',
 'test-results/wilderness-dragons/lab-deep-amethyst_dragon-materials/report.json',
 ...['shallow','shallow_refined','deep','shallow_keepers','deep_keepers_refined','hollow_refined'].map(batch=>`test-results/wilderness-creatures/lab-${batch}/report.json`),
];
for (const entry of await readdir('test-results/wilderness-creatures',{withFileTypes:true})) {
 if(entry.isDirectory()&&entry.name.startsWith('lab-family_')) reports.push(`test-results/wilderness-creatures/${entry.name}/report.json`);
}
for (const entry of await readdir('test-results/wilderness-dragons',{withFileTypes:true})) {
 if(entry.isDirectory()&&entry.name.startsWith('lab-')) {
  const file=`test-results/wilderness-dragons/${entry.name}/report.json`;
  if(!reports.includes(file)) reports.push(file);
 }
}
const proofs=(await Promise.all(reports.map(async file=>{
 try{return {file,report:await read(file)};}catch{return null;}
}))).filter(Boolean);
const manifestPath='game/public/assets/manifest.json',manifest=await read(manifestPath),rows=[];
const selected=process.argv.includes('--ids')?new Set(process.argv[process.argv.indexOf('--ids')+1].split(',').map(id=>id.startsWith('creature_')?id:`creature_${id}`)):null;
const catalogs=process.argv.includes('--catalog')?[process.argv[process.argv.indexOf('--catalog')+1]]:
 ['test-results/wilderness-dragons/catalog.json',...['crawlers','keepers','wraiths','undead','woodland'].map(f=>`test-results/wilderness-creatures/families/${f}/catalog.json`),
 ...['grazer','maw','colossus','kiln'].map(f=>`test-results/wilderness-creatures/families/stone/native-${f}/catalog.json`)];
for(const catalogPath of catalogs){
 const catalog=await read(catalogPath);
 for(const candidate of catalog.assets){
  if(selected&&!selected.has(candidate.id))continue;
  const file=path.resolve(path.dirname(catalogPath),catalog.files[candidate.id]);
  const bytes=await readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,candidate.sha256);assert.equal(bytes.length,candidate.bytes);
  const proof=proofs.find(({report:r})=>r.passed&&r.evidence.some(e=>
   (e.id===candidate.id.replace(/^creature_/,''))&&(e.sha256===hash||r.candidateHashes?.[candidate.id]===hash)));
  assert(proof,`${candidate.id}: no passing current-hash lab report`);
  const index=manifest.assets.findIndex(a=>a.id===candidate.id),live=manifest.assets[index];
  if(live?.sha256===hash){
   // Source records and display descriptions can be corrected without changing a GLB.
   if(process.argv.includes('--promote'))manifest.assets[index]={...live,...candidate,acceptance:live.acceptance};
   continue;
  }
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
for(const {candidate:a} of rows){
 const existing=new RegExp(`CREATURE_PURSUIT_CEILING_MPS\\["${a.id}"\\] = [0-9.]+;`);
 if(Number.isFinite(a.impliedRunMps)&&a.impliedRunMps>0&&a.runClipSeconds>0){
  const cap=Number((3*a.impliedRunMps*a.runClipSeconds).toFixed(4));
  const line=`CREATURE_PURSUIT_CEILING_MPS["${a.id}"] = ${cap};`;
  timing=existing.test(timing)?timing.replace(existing,line):timing+'\n'+line+'\n';
 }else timing=timing.replace(existing,'');
 if(a.attackSeconds>0&&a.contactNormalized>0&&a.contactNormalized<1){
  const line=`CREATURE_MOTION_TIMING["${a.id}"] = { seconds: ${a.attackSeconds}, contactNormalized: ${a.contactNormalized} };`;
  const previous=new RegExp(`CREATURE_MOTION_TIMING\\["${a.id}"\\] = \\{[^}]+\\};`);
  timing=previous.test(timing)?timing.replace(previous,line):timing+'\n'+line+'\n';
 }
}
await writeFile(timingPath,timing);
