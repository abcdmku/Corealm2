import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir='assets/art/tripo/imports/creatures/audit-user-beetle-golem';
const validation=JSON.parse(await readFile(dir+'/validation.json','utf8'));
const motion=JSON.parse(await readFile(dir+'/motion-audit.json','utf8'));
const candidate=await readFile(validation.candidateFile);
const sha=(value)=>createHash('sha256').update(value).digest('hex');
if (sha(candidate)!==validation.candidateSha256) throw Error('Candidate hash differs from CPU-audited validation');
const idle=motion.Idle.samples[0], bounds=idle.bounds;
if (!bounds || Object.values(idle.contactY).some((y)=>!Number.isFinite(y))) throw Error('Missing CPU contact measurements');
const size={x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]};
const base={x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]};
const candidateRel=validation.candidateFile;
const rigMethod='Preserved original 67-joint skin, bind matrices, geometry, four-slot weights, and source PBR; authored a planted four-limb animation rest plus six native clips.';
const asset={
  id:'creature_beetle_golem',
  file:'models/creature/creature_beetle_golem.glb',
  candidateFile:candidateRel,
  pack:'corealm-user-beetle-golem',
  category:'character',
  is:'Beetle Golem',
  tags:['creature','beetle','golem','construct','quadruped','user-supplied','tripo','candidate'],
  bytes:candidate.length,sha256:sha(candidate),size,base,bounds,groundY:bounds.min[1],
  vertices:validation.vertices,triangles:validation.triangles,animations:validation.clips.map((clip)=>clip.name),
  materials:['tripo_mat_1aa3aade-7d07-42b7-9818-b03e7661363a'],
  walkClipSeconds:1.12,runClipSeconds:.72,attackSeconds:1.14,contactNormalized:validation.contactNormalized,
  impliedWalkMps:null,impliedRunMps:null,measuredGait:null,locomotionPolicy:'definition-speed; authored in-place quadruped gait',
  metadata:{
    is:'User-supplied iridescent beetle golem',
    walkClipSeconds:1.12,runClipSeconds:.72,attackSeconds:1.14,
    contactSeconds:.56,contactNormalized:validation.contactNormalized,
    contactBasis:'After a hind-leg rise, the right forearm swing reaches its forward impact at 0.56 s; settles back to four-limb stance by 1.14 s.',
    renderedIdleHeightMeters:size.y,
    gaitCalibration:'uncalibrated; no defensible world-space stride speed inferred from in-place clip',
  },
  sourceProvenance:{
    author:'User-supplied Tripo Beetle Golem; Corealm native rig animation',
    sourceFile:validation.sourceFile,sourceSha256:validation.sourceSha256,sourceBytes:validation.sourceBytes,
    referenceImage:dir+'/sources/beetle-golem-reference.png',
    candidateFile:candidateRel,candidateSha256:sha(candidate),rigMethod,
    geometryPreserved:true,sourceSkinAndWeightsPreserved:true,pbrTexturesPreserved:true,
    textures:validation.textures,optics:validation.optics,
    cpuMotionAudit:dir+'/motion-audit.json',
    idleContacts:idle.contactY,attackPeakHeightMeters:motion.Attack.peak.height,
    deathFinalHeightRatio:motion.Death.final.height/idle.height,
    maximumPenetrationMeters:Math.min(...Object.values(motion).map((entry)=>entry.minY)),
    candidateStatus:'awaiting-root-lab-review',
  },
  acceptance:{assetAudit:true,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false},
};
const pack={id:'corealm-user-beetle-golem',name:'Corealm User Beetle Golem',author:'User / Corealm',
  source:dir+'/build-candidate.mjs',license:'LicenseRef-Corealm-Original',
  generatorSha256:sha(await readFile(dir+'/build-candidate.mjs'))};
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:[asset],files:{creature_beetle_golem:path.resolve(candidateRel).replaceAll('\\','/')}};
const promotion={schema:'corealm-creature-promotion/1',sourceRoot:'.',destinationRoot:'game/public/assets',pack,assets:[asset]};
await writeFile(dir+'/lab-catalog.json',JSON.stringify(lab,null,2)+'\n');
await writeFile(dir+'/promotion.json',JSON.stringify(promotion,null,2)+'\n');
console.log(JSON.stringify({candidateSha256:sha(candidate),size,idleContacts:idle.contactY,attackPeakHeightMeters:motion.Attack.peak.height,deathFinalHeightRatio:motion.Death.final.height/idle.height},null,2));
