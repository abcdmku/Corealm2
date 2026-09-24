import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='assets/art/tripo/imports/creatures/audit-user-rift-carapace';
const validation=JSON.parse(await readFile(dir+'/validation.json','utf8'));
const motion=JSON.parse(await readFile(dir+'/motion-audit.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const builderHash=hash(await readFile(dir+'/build-candidate.mjs'));
const idle=motion.clips.Idle[0],min=idle.min.map(v=>Math.abs(v)<1e-6?0:v),max=idle.max;
const asset={
 id:'creature_rift_carapace',file:'models/creature/creature_rift_carapace.glb',candidateFile:dir+'/rift-carapace-candidate.glb',pack:'corealm-audit-user-rift-carapace',category:'character',is:'Rift Carapace',
 tags:['creature','wilderness','rift','crab','arachnid','user-supplied'],bytes:validation.candidateBytes,sha256:validation.candidateSha256,
 size:{x:max[0]-min[0],y:max[1]-min[1],z:max[2]-min[2]},base:{x:min[0],y:min[1],z:min[2]},bounds:{min,max},groundY:min[1],
 vertices:validation.vertices,triangles:validation.triangles,animations:validation.clips.map(x=>x.name),materials:['tripo_mat_0c4f36c6-f3a5-4330-8937-980b84c04bf5'],
 walkClipSeconds:1.05,runClipSeconds:.68,attackSeconds:1.18,contactNormalized:validation.contactNormalized,
 metadata:{is:'User-supplied violet crystalline armored crab-arachnid',walkClipSeconds:1.05,runClipSeconds:.68,attackSeconds:1.18,contactSeconds:.58,contactNormalized:validation.contactNormalized,contactBasis:'Paired crushing claws converge at 0.58 seconds.',renderedIdleHeightMeters:max[1]-min[1],gaitCalibration:'uncalibrated in-place gait; use creature definition speed'},
 sourceProvenance:{author:'User supplied original; Corealm anatomical skin and animation',sourceFile:validation.sourceFile,sourceSha256:validation.sourceSha256,sourceBytes:validation.sourceBytes,candidateFile:validation.candidateFile,candidateSha256:validation.candidateSha256,geometryPreserved:true,pbrTexturesPreserved:true,textures:validation.textures,cpuMotionAudit:dir+'/motion-audit.json',rigMethod:'10-joint shell, paired claw/pincer, rear and middle leg skin with socket blends; six native clips'},
 acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false,evidence:'CPU skinned geometry audit only; root browser/screenshot acceptance pending'}
};
const catalog={schema:'corealm-lab-asset-candidates/1',pack:{id:'corealm-audit-user-rift-carapace',name:'User Rift Carapace candidate',author:'User / Corealm',source:dir+'/build-candidate.mjs',license:'User supplied; source license pending user confirmation',generatorSha256:builderHash},assets:[asset],files:{creature_rift_carapace:validation.candidateFile}};
await writeFile(dir+'/lab-catalog.json',JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({candidateSha256:asset.sha256,sourceSha256:validation.sourceSha256,bounds:asset.bounds,clips:asset.animations,acceptance:asset.acceptance},null,2));
