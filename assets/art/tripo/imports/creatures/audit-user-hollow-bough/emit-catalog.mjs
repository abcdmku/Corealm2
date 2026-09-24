import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const dir='assets/art/tripo/imports/creatures/audit-user-hollow-bough';
const candidateFile=`${dir}/creature_hollow_bough.glb`;
const builderFile=`${dir}/build-candidate.mjs`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(candidateFile),digest=sha(bytes);
const validation=JSON.parse(await readFile(`${dir}/validation.json`,'utf8'));
const motion=JSON.parse(await readFile(`${dir}/motion-audit.json`,'utf8'));
if(digest!==validation.candidateSha256)throw new Error('Build validation hash mismatch');
if(motion.deathHeightRatio>.5||Math.abs(motion.deathGroundY)>.015)throw new Error('Death pose floor or height failed');
const root=(await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes)).getRoot();
const bounds={min:[-1.62182598,0,-.4221192],max:[1.62182598,2.67236464,.4221192]};
const packId='corealm-user-hollow-bough';
const pack={id:packId,name:'Corealm User Hollow Bough',author:'User / Corealm',source:builderFile,license:'LicenseRef-Corealm-Original',generatorSha256:sha(await readFile(builderFile))};
const asset={
  id:'creature_hollow_bough',file:'models/creature/creature_hollow_bough.glb',candidateFile,pack:packId,
  category:'character',is:'Hollow Bough',tags:['creature','treant','rootwood','hollow-bough','user-supplied','tripo'],
  bytes:bytes.length,sha256:digest,size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1],z:bounds.max[2]-bounds.min[2]},
  base:{x:bounds.min[0],y:0,z:bounds.min[2]},bounds,groundY:0,vertices:7492,triangles:4771,
  animations:root.listAnimations().map(a=>a.getName()),materials:root.listMaterials().map(m=>m.getName()),
  walkClipSeconds:1.18,runClipSeconds:.78,attackSeconds:1.2,contactNormalized:.52/1.2,
  impliedWalkMps:null,impliedRunMps:null,locomotionPolicy:'definition-speed; authored in-place biped gait',
  metadata:{is:'User-supplied branch-armed rootwood humanoid',walkClipSeconds:1.18,runClipSeconds:.78,attackSeconds:1.2,contactSeconds:.52,contactNormalized:.52/1.2,contactBasis:'Right branch arm and trunk lunge reach at 0.52 s.',renderedIdleHeightMeters:motion.clips.Idle.final.height,gaitCalibration:'uncalibrated; in-place clips'},
  sourceProvenance:{author:'User-supplied static Tripo tree humanoid; Corealm anatomical rig and animation',sourceFile:validation.sourceFile,sourceSha256:validation.sourceSha256,sourceBytes:validation.sourceBytes,candidateFile,candidateSha256:digest,rigMethod:'Custom 18-joint Y-up biped skin, four normalized influences per vertex, geometry/UVs/normals/source material roles preserved; PBR maps downsampled.',sourceGeometryPreserved:true,sourceTextures:validation.sourceTextures,runtimeTextures:validation.runtimeTextures,nativeScale:validation.nativeScale,faceAxis:'source +X rotated to runtime +Z',cpuMotionAudit:`${dir}/motion-audit.json`,deathFinalHeightRatio:motion.deathHeightRatio,deathGroundY:motion.deathGroundY},
  acceptance:{assetAudit:false,labAccepted:false,worldIntegrated:false}
};
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:[asset],files:{[asset.id]:`${path.resolve('.').replaceAll('\\','/')}/${candidateFile}`}};
const promotion={schema:'corealm-creature-promotion/1',sourceRoot:'.',destinationRoot:'game/public/assets',pack,assets:[asset]};
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n');
await writeFile(`${dir}/promotion.json`,JSON.stringify(promotion,null,2)+'\n');
console.log(JSON.stringify({candidateSha256:digest,bytes:bytes.length,bounds,deathHeightRatio:motion.deathHeightRatio,deathGroundY:motion.deathGroundY,labCatalog:`${dir}/lab-catalog.json`,promotion:`${dir}/promotion.json`},null,2));
