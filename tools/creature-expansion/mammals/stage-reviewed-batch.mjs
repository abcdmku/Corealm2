import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const input=process.argv[2]??'test-results/finish-quadrupeds-v8';
const out=process.argv[3]??'art/rebuild/candidates/finish-quadrupeds/revision8';
const report=JSON.parse(fs.readFileSync(`${input}/gallery.json`));
if(report.errors.length||/swiftshader|software|llvmpipe/i.test(report.renderer))throw Error('Invalid hardware evidence');
fs.mkdirSync(`${out}/models`,{recursive:true});
const assets=[],files={};
for(const record of report.records){
 const a=record.assetMetadata;if(!a)throw Error('Missing exact candidate metadata');
 const src=`test-results/creature-expansion/models/${a.id}.glb`;
 const bytes=fs.readFileSync(src),sha=createHash('sha256').update(bytes).digest('hex');
 if(sha!==a.sha256)throw Error(`Export changed since capture: ${a.id}`);
 fs.copyFileSync(src,`${out}/models/${a.id}.glb`);
 const sources=`test-results/creature-expansion/${record.id}.sources.json`;
 if(fs.existsSync(sources)){
  const provenance=JSON.parse(fs.readFileSync(sources));
  if(provenance.candidateSha256!==sha)throw Error(`Source provenance describes different export: ${a.id}`);
  fs.copyFileSync(sources,`${out}/${record.id}.sources.json`);
 }
 fs.writeFileSync(`${out}/${record.id}.json`,JSON.stringify(a,null,2)+'\n');
 files[a.id]=`models/${a.id}.glb`;assets.push(a);
}
const manifest=JSON.parse(fs.readFileSync('game/public/assets/manifest.json'));
const packs=manifest.packs.filter(p=>assets.some(a=>a.pack===p.id));
fs.writeFileSync(`${out}/catalogue.json`,JSON.stringify({packs,assets,files,review:{renderer:report.renderer,sourceReport:path.resolve(input,'gallery.json'),labAccepted:false,scope:'Captured geometry/art comparison. Mammal contact sampling was improved after this capture; these frozen bytes retain the earlier animation and remain rejected for anatomy.'}},null,2)+'\n');
console.log(JSON.stringify({out,assets:assets.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes}))}));
