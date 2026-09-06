import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const base='art/rebuild/candidates/finish-quadrupeds';
const plan=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):{};
const out=path.join(base,plan.output??'source-geometry-comparison');
const inputs=plan.inputs??[
 ['source-fox-adaptation/catalogue.json','creature_redbrush_fox'],
 ['source-badger/candidate-catalogue.json','creature_rootdelve_badger'],
 ['revision8/catalogue.json','creature_ashscale_monitor'],
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const assets=[],packs=[],files={},origins=[];
// Read and validate all inputs before freezing the batch.
const entries=inputs.map(([input,id])=>{
 const cataloguePath=path.join(base,input),catalogueBytes=fs.readFileSync(cataloguePath),catalogue=JSON.parse(catalogueBytes);
 const asset=catalogue.assets.find(asset=>asset.id===id);
 if(!asset)throw Error(`Missing ${id} in ${input}`);
 if(asset.animations&&(!Array.isArray(asset.animations)||asset.animations.some(name=>typeof name!=='string')))throw Error(`Animation names must be strings for ${id}; store clip durations separately`);
 const sourcePath=path.resolve(path.dirname(cataloguePath),catalogue.files?.[id]??asset.file),bytes=fs.readFileSync(sourcePath);
 if(sha(bytes)!==asset.sha256||bytes.length!==asset.bytes)throw Error(`Stale candidate ${id}`);
 return {input,id,catalogue,asset,sourcePath,bytes,catalogueSha256:sha(catalogueBytes)};
});
fs.mkdirSync(out,{recursive:true});
for(const entry of entries){
 const {id,catalogue,asset,bytes}=entry;
 const filename=`${id}.${asset.sha256.slice(0,12)}.glb`;
 fs.writeFileSync(path.join(out,filename),bytes);
 assets.push(asset);files[id]=filename;
 for(const pack of [...(catalogue.packs??[]),...(catalogue.pack?[catalogue.pack]:[])])if(!packs.some(p=>p.id===pack.id))packs.push(pack);
 origins.push({slot:id,catalogue:entry.input,catalogueSha256:entry.catalogueSha256,sha256:asset.sha256,sourceDescription:asset.is,rightsStatus:entry.input.startsWith('source-badger/')?'Provisional. Redistribution publisher declares CC-BY-SA4; exact original creator grant remains unverified. No promotion or deep derivative.':'See original source attribution and license records.'});
}
fs.writeFileSync(path.join(out,'catalogue.json'),JSON.stringify({packs,assets,files,origins,scope:plan.scope??'Frozen geometry comparison only: Fox adaptation, provisional-rights complete static Badger source, and retained Monitor candidate. Four views each: front, side, rear, gameplay. No motion/lifecycle or promotion acceptance.'},null,2)+'\n');
console.log(JSON.stringify({catalogue:path.join(out,'catalogue.json'),origins},null,2));
