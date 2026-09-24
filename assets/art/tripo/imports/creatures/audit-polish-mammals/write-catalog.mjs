import { NodeIO } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '../../../../../..');
const io = new NodeIO().registerExtensions([KHRTextureTransform]);
const hash = data => createHash('sha256').update(data).digest('hex');
const build = JSON.parse(await readFile(path.join(here,'build-results.json'),'utf8'));
const builderSha256 = hash(await readFile(path.join(here,'build-candidates.mjs')));
const catalogBuilderSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
const pack = { id:'corealm-mammal-polish-candidates', name:'Mammal polish candidates', author:'Corealm',
  source:'assets/art/tripo/imports/creatures/audit-polish-mammals/build-candidates.mjs',
  generatorSha256:builderSha256, license:'LicenseRef-Corealm-Original' };
const data = {
  bracken_tapir:{is:'a black and pale-saddled woodland tapir',tags:['creature','animal','mammal','tapir','candidate'],attackSeconds:.90,contactNormalized:.48,walkClipSeconds:.93,runClipSeconds:.64,rootScale:1.15},
  duskoak_lynx:{is:'a spotted woodland lynx with tall tufted ears',tags:['creature','animal','mammal','lynx','candidate'],attackSeconds:1.02,contactNormalized:.43,walkClipSeconds:1.16,runClipSeconds:.67,rootScale:.90},
  quillback_porcupine:{is:'a stocky crested porcupine with banded defensive quills',tags:['creature','animal','mammal','porcupine','candidate'],attackSeconds:1.16,contactNormalized:.54,walkClipSeconds:1.25,runClipSeconds:.76,rootScale:1.15},
};
const entries=[];
for(const result of build){
  const species=result.id.replace('creature_',''), spec=data[species], doc=await io.read(path.join(here,result.candidateFile)), r=doc.getRoot();
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  let triangles=0, vertices=0;
  for(const mesh of r.listMeshes())for(const primitive of mesh.listPrimitives()){
    const pos=primitive.getAttribute('POSITION'),index=primitive.getIndices();
    vertices+=pos?.getCount()??0; triangles+=(index?.getCount()??0)/3;
    if(pos)for(let i=0;i<pos.getCount();i++){const p=pos.getElement(i,[]);for(let j=0;j<3;j++){bounds.min[j]=Math.min(bounds.min[j],p[j]);bounds.max[j]=Math.max(bounds.max[j],p[j]);}}
  }
  const animations=r.listAnimations().map(a=>a.getName());
  const durations=Object.fromEntries(r.listAnimations().map(a=>{
    const duration=Math.max(...a.listSamplers().map(s=>s.getInput()?.getMax([])?.[0]??0));return[a.getName(),duration];
  }));
  const entry={id:result.id,file:`models/creature/${result.id}.glb`,candidateFile:result.candidateFile,pack:pack.id,
    category:'character',is:spec.is,tags:spec.tags,bytes:result.bytes,sha256:result.sha256,
    size:Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,bounds.max[i]-bounds.min[i]])),
    base:Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,bounds.min[i]])),bounds,groundY:bounds.min[1],
    triangles,vertices,animations,materials:r.listMaterials().map(m=>m.getName()),
    walkClipSeconds:spec.walkClipSeconds,runClipSeconds:spec.runClipSeconds,
    attackSeconds:spec.attackSeconds,contactNormalized:spec.contactNormalized,
    sourceProvenance:{sourceFile:result.sourceFile,sourceSha256:result.sourceSha256,sourceBytes:result.sourceBytes,
      license:'LicenseRef-Corealm-Original',rigMethod:'Preserved production source skin, joints, animation samples, clip names and timings.',
      imageGeneratedSourceFile:result.generatedSourceFile,imageGeneratedSourceSha256:result.generatedSourceSha256,
      coatMapFile:result.textureFile,coatMapSha256:result.textureSha256,
      originalPbrRetained:species==='bracken_tapir'},
    polish:{...result.edits,description:species==='bracken_tapir'?'Image-generated coarse bristled coat over existing saddle colors; source normal and roughness retained.':
      species==='duskoak_lynx'?'Fine spotted image-generated fur, enlarged existing ear shells and tufts, broadened cheek ruff.':
      'Image-generated coarse underfur; thicker defensive shafts with broad terminal bands, reduced guard-hair visual noise, and smaller eyes.'},
    animationDurations:durations,rootScaleRecommendation:spec.rootScale,
    acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
  entries.push(entry);
}
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:entries};
const promotion={schema:'corealm-creature-promotion/1',sourceRoot:path.relative(rootDir,here).replaceAll('\\','/'),
  destinationRoot:'game/public/assets',pack,assets:entries,
  notes:'CPU metadata only. Root must inspect normal-camera lab views and semantic motion/combat before promotion. No world integration is claimed.',
  catalogBuilderSha256};
await writeFile(path.join(here,'lab-catalog.json'),JSON.stringify(lab,null,2)+'\n');
await writeFile(path.join(here,'promotion.json'),JSON.stringify(promotion,null,2)+'\n');
console.log(entries.map(e=>({id:e.id,sha256:e.sha256,bytes:e.bytes,bounds:e.bounds,triangles:e.triangles,animations:e.animations})))
