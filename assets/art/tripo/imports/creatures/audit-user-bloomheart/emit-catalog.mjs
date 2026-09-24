import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const dir='assets/art/tripo/imports/creatures/audit-user-bloomheart',sha=b=>createHash('sha256').update(b).digest('hex');
const base=JSON.parse(await readFile(dir+'/validation.json','utf8'));
const motion=JSON.parse(await readFile(dir+'/motion-audit.json','utf8'));
const sovereign=JSON.parse(await readFile(dir+'/sovereign-validation.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const definitions=[
 {id:'creature_bloomheart_matriarch',name:'Bloomheart Matriarch',kind:'bloomheart-matriarch',file:'models/fairy-crown/creature_bloomheart_matriarch.glb'},
 {id:'creature_amethyst_sovereign',name:'Amethyst Sovereign',kind:'amethyst-sovereign',file:'models/fairy-crown/creature_amethyst_sovereign.glb'},
];
const assets=[],files={};
for(const def of definitions){
 const candidateFile=`${dir}/${def.kind}-candidate.glb`,bytes=await readFile(candidateFile),doc=await io.readBinary(bytes);
 const bounds=motion[def.kind].Idle.samples[0].bounds;
 const size={x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]};
 const asset={id:def.id,file:def.file,candidateFile,pack:'corealm-user-bloomheart',category:'character',is:def.name,
  tags:['creature','fairy','treant','flower-crown','root-skirt','user-supplied','tripo',...(def.id.includes('amethyst')?['amethyst','sovereign','crystal']:[])],
  bytes:bytes.length,sha256:sha(bytes),size,base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:bounds.min[1],
  vertices:doc.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((a,p)=>a+(p.getAttribute('POSITION')?.getCount()||0),0),0),
  triangles:doc.getRoot().listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((a,p)=>a+(p.getIndices()?.getCount()||0)/3,0),0),
  animations:doc.getRoot().listAnimations().map(a=>a.getName()),materials:doc.getRoot().listMaterials().map(m=>m.getName()),
  walkClipSeconds:1.3,runClipSeconds:.82,attackSeconds:1.3,contactNormalized:base.contactNormalized,
  impliedWalkMps:null,impliedRunMps:null,measuredGait:null,locomotionPolicy:'definition-speed; authored in-place planted root gait',
  metadata:{is:def.name,contactSeconds:.67,contactNormalized:base.contactNormalized,renderedIdleHeightMeters:size.y,sourceTexturePolicy:def.id.includes('amethyst')?'image-generated UV-aligned silverwood albedo, source normal and ORM at 2K':'source PBR downsampled to 2K',rig:'13 anatomical joints, four normalized weights',deathFinalHeightRatio:motion[def.kind].Death.finalHeight/motion[def.kind].Idle.finalHeight,
   ...(def.id.includes('amethyst')?{crystalGrowths:sovereign.crystalCount,imageGeneratedCrystalMap:sovereign.imageGeneratedMap,imageGeneratedSilverwoodMap:sovereign.silverwoodMap}:{})},
  sourceProvenance:{author:'User-supplied Tripo Tree Spirit; Corealm fitted skin and motion',license:'LicenseRef-Corealm-Original',sourceFile:base.sourceFile,sourceSha256:base.sourceSha256,sourceBytes:base.sourceBytes,
   sourceGeometryPreserved:true,sourcePositionSha256:base.sourcePositionSha256,sourceIndicesSha256:base.sourceIndicesSha256,
   pbrTextures:base.textures,animationMethod:'Fitted anatomical root, trunk, face, crown, branch and root-limb skin; authored six clips; CPU floor correction',
   cpuMotionAudit:dir+'/motion-audit.json',minimumY:Object.fromEntries(Object.entries(motion[def.kind]).map(([name,v])=>[name,v.minimumY])),
   ...(def.id.includes('amethyst')?{generatedSilverwoodMap:sovereign.silverwoodMap,silverwoodMapSha256:sha(await readFile(sovereign.silverwoodMap)),generatedCrystalMap:sovereign.imageGeneratedMap,crystalMapSha256:sha(await readFile(sovereign.imageGeneratedMap)),crystalCount:sovereign.crystalCount}:{}),
   candidateStatus:'awaiting-root-lab-review'},
  acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
 assets.push(asset);files[asset.id]=path.resolve(candidateFile).replaceAll('\\','/');
}
const pack={id:'corealm-user-bloomheart',name:'Corealm User Bloomheart',author:'User / Corealm',source:dir+'/build-candidate.mjs',license:'LicenseRef-Corealm-Original',generatorSha256:sha(await readFile(dir+'/build-candidate.mjs'))};
base.candidateSha256=assets[0].sha256;base.candidateBytes=assets[0].bytes;base.status='awaiting-root-lab-review';
sovereign.sha256=assets[1].sha256;sovereign.bytes=assets[1].bytes;
await writeFile(dir+'/validation.json',JSON.stringify(base,null,2)+'\n');
await writeFile(dir+'/sovereign-validation.json',JSON.stringify(sovereign,null,2)+'\n');
await writeFile(dir+'/lab-catalog.json',JSON.stringify({schema:'corealm-lab-asset-candidates/1',pack,assets,files},null,2)+'\n');
await writeFile(dir+'/promotion.json',JSON.stringify({schema:'corealm-creature-promotion/1',sourceRoot:'.',destinationRoot:'game/public/assets',pack,assets},null,2)+'\n');
console.log(JSON.stringify(assets.map(a=>({id:a.id,sha256:a.sha256,bytes:a.bytes,size:a.size,triangles:a.triangles,deathRatio:a.metadata.deathFinalHeightRatio})),null,2));
