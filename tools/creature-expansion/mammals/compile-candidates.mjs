import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Root schedules this Chromium-backed export. Preserve the source checkout
// hashes alongside each candidate so later CPU edits cannot obscure provenance.
const ids=process.argv.slice(2);
if(!ids.length||ids.some(id=>!/^\w+$/.test(id)))throw Error('Pass explicit species IDs');
const families=new Set(ids.map(id=>['redbrush_fox','duskoak_lynx','rootdelve_badger','quillback_porcupine'].includes(id)?'mammals':['marchwild_horse','cairn_bighorn','marsh_moose','bracken_tapir'].includes(id)?'hoofed':'reptiles'));
const sourceFiles=['tools/build-creature-expansion.ts','tools/creature-expansion/packs.ts','package-lock.json'];
for(const family of families){
 sourceFiles.push(`tools/creature-expansion/${family}.mjs`);
 const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.(mjs|ts)$/.test(file))sourceFiles.push(file.replaceAll('\\','/'));}};
 walk(`tools/creature-expansion/${family}`);
}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const snapshot=()=>Object.fromEntries(sourceFiles.filter(f=>fs.existsSync(f)).sort().map(file=>[file,hash(file)]));
const before=snapshot();
const result=spawnSync(process.execPath,['--import','tsx','tools/build-creature-expansion.ts','--only',ids.join(',')],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status??1);
const after=snapshot();
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during export; do not accept mixed provenance');
for(const id of ids){
 const file=`test-results/creature-expansion/models/creature_${id}.glb`;
 fs.writeFileSync(`test-results/creature-expansion/${id}.sources.json`,JSON.stringify({id,candidateSha256:hash(file),sourceHashes:before,scope:'Source checkout hashes captured before and after export. Family directory includes authoring helpers and diagnostic tools; the hash set is deliberately broader than only runtime imports.'},null,2)+'\n');
}
