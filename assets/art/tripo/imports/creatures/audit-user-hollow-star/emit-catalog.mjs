import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const dir='assets/art/tripo/imports/creatures/audit-user-hollow-star';
const validation=JSON.parse(await readFile(dir+'/validation.json','utf8'));
const audit=JSON.parse(await readFile(dir+'/motion-audit.json','utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const builderSha=sha(await readFile(dir+'/build-candidate.mjs'));
const bytes=await readFile(validation.candidateFile);
if(sha(bytes)!==validation.candidateSha256)throw Error('Candidate changed after validation');
const idle=audit.clips.Idle.samples[0],death=audit.clips.Death.samples.at(-1);
const pack={id:'corealm-user-hollow-star',name:'Corealm User Hollow Star',author:'User / Corealm',source:dir+'/build-candidate.mjs',license:'LicenseRef-Corealm-Original',generatorSha256:builderSha};
const asset={
 id:'creature_hollow_star',file:'models/creature/creature_hollow_star.glb',candidateFile:validation.candidateFile,pack:pack.id,
 category:'character',is:'The Hollow Star',tags:['creature','cosmic','radial','membrane','nonhuman','user-supplied','tripo'],
 bytes:bytes.length,sha256:validation.candidateSha256,
 size:{x:idle.size[0],y:idle.size[1],z:idle.size[2]},base:{x:idle.min[0],y:idle.min[1],z:idle.min[2]},
 bounds:{min:idle.min,max:idle.max},groundY:idle.min[1],vertices:validation.vertices,triangles:validation.triangles,
 animations:validation.clips.map(c=>c.name),materials:['tripo_mat_2d2299b2-1c9c-4e7d-a2cb-11cf046df19f'],
 walkClipSeconds:1.55,runClipSeconds:.92,attackSeconds:1.28,contactNormalized:validation.attackContactNormalized,
 impliedWalkMps:null,impliedRunMps:null,locomotionPolicy:'definition-speed; in-place radial floating motion',
 metadata:{is:'User-supplied radial cosmic frame with an open core',walkClipSeconds:1.55,runClipSeconds:.92,attackSeconds:1.28,contactSeconds:.55,contactNormalized:validation.attackContactNormalized,contactBasis:'Radial membranes flare and the core lunges forward at .55 s; recovery completes at 1.28 s.',renderedIdleHeightMeters:idle.size[1],gaitCalibration:'floating in-place; no foot stride'},
 sourceProvenance:{author:'User-supplied Tripo Hollow Star; Corealm radial rig and animation',sourceFile:validation.sourceFile,sourceSha256:validation.sourceSha256,sourceBytes:validation.sourceBytes,candidateFile:validation.candidateFile,candidateSha256:validation.candidateSha256,rigMethod:'Nine-joint radial skin with overlapping membrane sectors around the hollow core; no humanoid skeleton.',geometryPreserved:true,pbrTexturesPreserved:true,textures:validation.textureMaps,cpuMotionAudit:dir+'/motion-audit.json',deathFinalMinY:death.min[1],deathFinalHeightMeters:death.size[1],candidateStatus:'awaiting-root-lab-review'},
 acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false,evidence:'CPU geometry and motion only; browser state, screenshot, combat, and corpse review pending'},measuredGait:null
};
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:[asset],files:{creature_hollow_star:resolve(validation.candidateFile)}};
const promotion={schema:'corealm-asset-promotion/1',pack,assets:[asset]};
await writeFile(dir+'/lab-catalog.json',JSON.stringify(lab,null,2)+'\n');
await writeFile(dir+'/promotion.json',JSON.stringify(promotion,null,2)+'\n');
console.log(JSON.stringify({candidateSha256:validation.candidateSha256,builderSha,rest:idle,deathFinal:death,accepted:false},null,2));
