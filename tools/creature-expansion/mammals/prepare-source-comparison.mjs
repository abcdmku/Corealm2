import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const base='art/rebuild/candidates/finish-quadrupeds';
const inputs=['source-fox/scaled-catalogue.json','source-feline/neutral-preview-catalogue.json','source-porcupine/candidate-catalogue.json'];
const out=path.join(base,'source-comparison');fs.mkdirSync(out,{recursive:true});
const assets=[],packs=[],files={},origins=[];
for(const input of inputs){
 const p=path.join(base,input),catalog=JSON.parse(fs.readFileSync(p));
 for(const pack of [...(catalog.packs??[]),...(catalog.pack?[catalog.pack]:[])])if(!packs.some(p=>p.id===pack.id))packs.push(pack);
 for(const asset of catalog.assets){
  const f=path.resolve(path.dirname(p),catalog.files?.[asset.id]??asset.file),bytes=fs.readFileSync(f);
  const sha=createHash('sha256').update(bytes).digest('hex');
  if(sha!==asset.sha256||bytes.length!==asset.bytes)throw Error(`Stale source preview ${asset.id}`);
  if(assets.some(a=>a.id===asset.id))throw Error('Duplicate source preview slot');
  assets.push(asset);files[asset.id]=path.relative(out,f).replaceAll('\\','/');
  origins.push({slot:asset.id,catalogue:input,sourceDescription:asset.is,sha256:sha,animations:asset.animations??[]});
 }
}
fs.writeFileSync(path.join(out,'catalogue.json'),JSON.stringify({packs,assets,files,scope:'Complete free source comparison only. Gallery slots retain production species labels; actual source bodies are Fox, neutral domestic Cat, and original Rat. Cat/Rat have zero exported clips. No species adaptation or gameplay acceptance is claimed.',origins},null,2)+'\n');
console.log(JSON.stringify({catalogue:path.join(out,'catalogue.json'),origins}));
