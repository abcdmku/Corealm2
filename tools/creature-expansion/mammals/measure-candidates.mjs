import * as THREE from 'three';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildSpecies as mammal,SPECIES as mammals} from '../mammals.mjs';
import {buildSpecies as hoofed,SPECIES as hoofedIds} from '../hoofed.mjs';

const out=new URL('../../../art/rebuild/candidates/finish-quadrupeds/',import.meta.url);
await mkdir(out,{recursive:true});
const changed=new Set(['cairn_bighorn','bracken_tapir','duskoak_lynx']);
const assets=[];
for(const id of [...hoofedIds,...mammals]){
  const built=await (hoofedIds.includes(id)?hoofed:mammal)(id);
  built.object.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(built.object,true);
  let vertices=0,triangles=0;
  const footPivots=[];
  built.object.traverse(node=>{
    if(node.isMesh){vertices+=node.geometry.attributes.position.count;triangles+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;}
    if(node.isBone&&/Foot$|_Paw$/.test(node.name))footPivots.push({name:node.name,position:node.getWorldPosition(new THREE.Vector3()).toArray()});
  });
  assets.push({id:`creature_${id}`,generator:hoofedIds.includes(id)?'tools/creature-expansion/hoofed.mjs':'tools/creature-expansion/mammals.mjs',status:changed.has(id)?'rebuilt-candidate-awaiting-visual-review':'existing-candidate-awaiting-visual-audit',bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},size:bounds.getSize(new THREE.Vector3()).toArray(),vertices,triangles,footPivots,clips:built.clips.map(c=>({name:c.name,seconds:c.duration})),metadata:built.meta,acceptance:{sourceMeasured:true,labAccepted:false,worldIntegrated:false}});
  built.object.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
}
const manifest=JSON.parse(await readFile(new URL('../../../game/public/assets/manifest.json',import.meta.url),'utf8'));
const families=/wolf|bear|boar|cattle|deer|goat|crocodile|salamander/;
const catalogueAudit=manifest.assets.filter(a=>/^(animal_|creature_)/.test(a.id)&&families.test([a.id,a.is,...(a.tags??[])].join(' '))&&a.category==='character').map(a=>({id:a.id,file:a.file,pack:a.pack,provenance:manifest.packs.find(p=>p.id===a.pack),sourceProvenance:a.sourceProvenance??null,decision:'review-required',reason:'No new front, side, rear, gameplay-distance or moving production-light review has been performed this round. Existing source-pack provenance does not establish quality.'}));
await writeFile(new URL('catalogue.json',out),JSON.stringify({schema:1,assets,catalogueAudit,compiler:'node --import tsx tools/build-creature-expansion.ts --only cairn_bighorn,bracken_tapir,duskoak_lynx',compilerOutput:'test-results/creature-expansion',promotion:'Root must copy reviewed models and their matching exported metadata into this candidate folder, then run production lab visual acceptance before public promotion. Preserve existing asset IDs.'},null,2)+'\n');
console.log(JSON.stringify(assets.map(a=>({id:a.id,bounds:a.bounds,triangles:a.triangles})),null,2));
