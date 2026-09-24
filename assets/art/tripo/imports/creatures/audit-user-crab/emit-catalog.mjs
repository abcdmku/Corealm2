import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
const dir='assets/art/tripo/imports/creatures/audit-user-crab',path=`${dir}/animal_crab-candidate.glb`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const validation=JSON.parse(await readFile(`${dir}/validation.json`,'utf8'));
const bytes=await readFile(path),builder=await readFile(`${dir}/build-candidate.mjs`);
if(sha(bytes)!==validation.candidateSha256)throw Error('Candidate changed');
const doc=await new NodeIO().readBinary(bytes),root=doc.getRoot(),p=root.listMeshes()[0].listPrimitives()[0],arr=p.getAttribute('POSITION').getArray();
let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
for(let i=0;i<arr.length;i+=3){const xyz=[arr[i+2]*.315,arr[i+1]*.315,-arr[i]*.315];for(let k=0;k<3;k++){min[k]=Math.min(min[k],xyz[k]);max[k]=Math.max(max[k],xyz[k]);}}
const size=min.map((v,k)=>max[k]-v),names=root.listAnimations().map(a=>a.getName()),materials=root.listMaterials().map(m=>m.getName());
const asset={id:'animal_crab',file:'models/animal/animal_crab.glb',candidateFile:path,pack:'corealm-user-creek-crab',category:'character',is:'Creek Crab',tags:['animal','creature','crab','creek','user-supplied'],bytes:bytes.length,sha256:sha(bytes),size:{x:size[0],y:size[1],z:size[2]},base:{x:min[0],y:min[1],z:min[2]},bounds:{min,max},groundY:min[1],vertices:p.getAttribute('POSITION').getCount(),triangles:p.getIndices().getCount()/3,joints:root.listSkins()[0].listJoints().map(j=>j.getName()),animations:names,materials,walkClipSeconds:1,runClipSeconds:.62,attackSeconds:.9,contactNormalized:.42/.9,impliedWalkMps:null,impliedRunMps:null,locomotionPolicy:'definition-speed; in-place sideways scuttle',metadata:{walkClipSeconds:1,runClipSeconds:.62,attackSeconds:.9,contactSeconds:.42,contactNormalized:.42/.9,contactBasis:'Paired claws and distal pincers close at 0.42 seconds.',nativeScale:.315,renderedIdleHeightMeters:size[1],gaitCalibration:'uncalibrated; no world-space stride inferred'},sourceProvenance:{author:'User-supplied Tripo crab; Corealm native rig animation',sourceFile:validation.sourceFile,sourceSha256:validation.sourceSha256,sourceBytes:validation.sourceBytes,candidateFile:path,candidateSha256:sha(bytes),rigMethod:'Added 14-joint geometry-aware skin; original source had no rig or clips.',geometryPreserved:true,pbrTexturesPreserved:true,textures:validation.textures,cpuMotionAudit:`${dir}/motion-audit.json`,cpuMotionSamplesPerClip:193,maximumPenetrationMeters:0.00163,deathFinalHeightMeters:.29982},acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
const pack={id:'corealm-user-creek-crab',name:'Corealm User Creek Crab',author:'User / Corealm',source:`${dir}/build-candidate.mjs`,license:'LicenseRef-Corealm-Original',generatorSha256:sha(builder)};
const catalog={schema:'corealm-lab-asset-candidates/1',pack,assets:[asset],files:{animal_crab:`C:/Users/Borg/Documents/GitHub/Corealm2/${path}`}};
const promotion={schema:'corealm-creature-promotion/1',sourceRoot:'.',destinationRoot:'game/public/assets',pack,assets:[asset]};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(catalog,null,2)+'\n');await writeFile(`${dir}/promotion.json`,JSON.stringify(promotion,null,2)+'\n');console.log(JSON.stringify({sha256:sha(bytes),bytes:bytes.length,bounds:{min,max},joints:asset.joints.length,animations:names,builderSha256:pack.generatorSha256}));

