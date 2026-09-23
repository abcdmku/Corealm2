import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {removeClip,applyClip,duration,restorePose,storedPose} from '../../../../../../tools/creature-motion/pose.js';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';
import {retargetHumanoid} from '../../../../../../tools/tripo-creatures/retarget.js';

const owner='assets/art/tripo/imports/creatures/audit-ogre-family';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const accessorHash=a=>a?sha(Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength)):null;
const sourceFingerprint=root=>JSON.stringify({
 meshes:root.listMeshes().map(m=>m.listPrimitives().map(p=>({indices:accessorHash(p.getIndices()),attributes:Object.fromEntries(p.listSemantics().sort().map(s=>[s,accessorHash(p.getAttribute(s))]))}))),
 textures:root.listTextures().map(t=>[t.getName(),sha(t.getImage()||new Uint8Array())]),
 skin:root.listSkins().map(s=>[s.listJoints().map(j=>j.getName()),accessorHash(s.getInverseBindMatrices())]),
});
const source={
 creature_boss_tideworn:{file:'assets/art/tripo/imports/creatures/undercrag-mawer/models/creature_boss_tideworn.glb',sha256:'34da520bbabbabc3c8b529a5d150b6cef418a375db8fd8f78d8c057fb810bb82',name:'Cave Ogre',level:40,sourceExport:'assets/art/tripo/exports/corealm_undercrag_mawer_31201699_8k_rigged.glb',exportSha256:'fe89fbf980791cf7a21b0f17a67dc36fdeb2a4076de242ebdd5fcd4675c98e5d',modelId:'31201699-cc20-4688-88cf-f29f8eb754cb',sourceImageId:'1dd13260-2b8c-47e1-897c-9ede10d64aec',pack:'corealm-tripo-undercrag-ogre'},
 creature_boss_cinderwake:{file:'assets/art/tripo/imports/creatures/emberbank-brute/emberbank-brute-native-rig-candidate.glb',sha256:'4354c8395529806b7303cf6d64a53fa90c2d5da12038b47bc813140177876250',name:'Fire Ogre',level:80,sourceExport:'assets/art/tripo/exports/corealm_emberbank_brute_2b3179ac_8k_rigged.glb',exportSha256:'3368af107a2b4afcfee27c18f2da9e6a113679123fc7691cdeecd9012d31383b',modelId:'2b3179ac-d360-4e46-83fb-69681850ab0c',sourceImageId:'ec644492-32d4-4cac-914f-079adef1e98d',pack:'corealm-tripo-emberbank-ogre'},
};
const libraryPath='game/public/assets/models/animation/animation_library_1.glb';
const libraryBytes=await readFile(libraryPath);
if(sha(libraryBytes)!=='751f4431be3e703fcacbc49e74c9b742a758cf03c82a9bb36ac295b18d7a481e')throw new Error('Native motion library changed');
const library=await io.readBinary(libraryBytes);
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const assets=[],labAssets=[],metrics=[];
for(const [id,record] of Object.entries(source)){
 const bytes=await readFile(record.file);
 if(sha(bytes)!==record.sha256)throw new Error(`${id}: reviewed source changed`);
 const doc=await io.readBinary(bytes),root=doc.getRoot();
 const originalFingerprint=sourceFingerprint(root);
 const oldBounds=deformedBounds(doc),oldAnimations=root.listAnimations().map(a=>a.getName());
 let motionSource='Existing native retarget and weighted skin retained';
 if(id==='creature_boss_cinderwake'){
  for(const name of oldAnimations)removeClip(doc,name);
  const retarget=retargetHumanoid(doc,library);
  const scene=root.listScenes()[0],ground=scene.listChildren().find(n=>n.getName()==='corealm_motion_ground');
  if(!ground)throw new Error(`${id}: retarget ground missing`);
  const presentation=doc.createNode('FireOgrePresentation').setScale([3,3,3]);
  scene.removeChild(ground);presentation.addChild(ground);scene.addChild(presentation);
  motionSource=`Native humanoid takes retargeted in bind space: ${retarget.clips.map(c=>`${c.name}=${c.sourceTake}`).join(', ')}`;
  for(const material of root.listMaterials())material.setRoughnessFactor(.82).setMetallicFactor(0);
 }
 const death=root.listAnimations().find(a=>a.getName()==='Death');
 if(!death)throw new Error(`${id}: no Death clip`);
 for(const sampler of death.listSamplers()){
  const input=sampler.getInput(),array=input.getArray();
  input.setArray(Float32Array.from(array,t=>Number(t)*.625));
 }
 const rest=storedPose(doc),samples=[],deathSeconds=duration(death),idle=root.listAnimations().find(a=>a.getName()==='Idle');
 for(const t of [0,.3,.5,.8,1,1.2,deathSeconds]){
  restorePose(rest);applyClip(death,Math.min(t,deathSeconds));
  const b=deformedBounds(doc);samples.push({seconds:+t.toFixed(3),minY:b.min[1],topY:b.max[1]});
 }
 restorePose(rest);applyClip(idle,0);const idleBounds=deformedBounds(doc);restorePose(rest);
 const sampleAt=seconds=>samples.find(s=>s.seconds===seconds);
 if(sampleAt(1).topY>idleBounds.max[1]*.6)throw new Error(`${id}: Death failed 40% collapse by 1s: ${JSON.stringify(samples)}`);
 if(samples.some(s=>s.minY<-.03))throw new Error(`${id}: Death goes underground: ${JSON.stringify(samples)}`);
 const bounds=deformedBounds(doc),name=`${id}-ogre-candidate.glb`,file=`${owner}/${name}`;
 const output=await io.writeBinary(doc);await writeFile(file,output);
 const check=await io.readBinary(output),checkRoot=check.getRoot();
 if(sourceFingerprint(checkRoot)!==originalFingerprint)throw new Error(`${id}: source geometry, texture, or skin changed`);
 const clipNames=checkRoot.listAnimations().map(a=>a.getName());
 for(const required of ['Idle','Walk','Run','Attack','Hit','Death'])if(!clipNames.includes(required))throw new Error(`${id}: missing ${required}`);
 if(checkRoot.listSkins()[0]?.listJoints().length!==54)throw new Error(`${id}: rig changed`);
 const existing=manifest.assets.find(a=>a.id===id);
 const candidate={id,file:existing.file,candidateFile:file,pack:record.pack,category:'character',is:record.name,tags:['creature','ogre','tripo'],
  bytes:output.length,sha256:sha(output),size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},
  base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:0,triangles:root.listMeshes().flatMap(m=>m.listPrimitives()).reduce((n,p)=>n+(p.getIndices()?.getCount()??0)/3,0),
  animations:clipNames,materials:checkRoot.listMaterials().map(m=>m.getName()),
  walkClipSeconds:duration(checkRoot.listAnimations().find(a=>a.getName()==='Walk')),
  runClipSeconds:duration(checkRoot.listAnimations().find(a=>a.getName()==='Run')),
  attackSeconds:duration(checkRoot.listAnimations().find(a=>a.getName()==='Attack')),
  locomotionPolicy:null,impliedWalkMps:null,impliedRunMps:null,measuredGait:null,
  sourceProvenance:{tool:'Tripo Studio',modelId:record.modelId,sourceImageId:record.sourceImageId,sourceFile:record.sourceExport,sourceSha256:record.exportSha256,
   reviewedCandidate:record.file,reviewedCandidateSha256:record.sha256,motionSource,sourceDesignAudit:'approved',faceAudit:'approved',textureTreatment:'Retained existing detailed source base-color map; no recolor or generated reskin.'},
  metadata:{identity:record.name,level:record.level,authoring:'Simple readable humanoid ogre; mature Fire Ogre remains larger than Cave Ogre.',
   deathRepair:{method:'Native fall compressed to complete before corpse fade; weighted mesh floor and top sampled.',seconds:deathSeconds,sourceSeconds:deathSeconds/.625,samples}},
  acceptance:{sourceAccepted:true,labAccepted:false,worldIntegrated:false}};
 assets.push(candidate);labAssets.push({...candidate,file:name,candidateFile:undefined});
 metrics.push({id,oldBounds,restBounds:bounds,idleBounds,deathSeconds,samples,clips:clipNames,sha256:candidate.sha256,bytes:candidate.bytes});
}
await writeFile(`${owner}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:labAssets,files:Object.fromEntries(labAssets.map(a=>[a.id,a.file]))},null,2));
await writeFile(`${owner}/validation.json`,JSON.stringify(metrics,null,2));
console.log(JSON.stringify(metrics,null,2));
