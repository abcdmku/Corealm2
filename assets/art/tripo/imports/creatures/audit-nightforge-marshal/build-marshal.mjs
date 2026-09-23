import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Quaternion,Vector3} from 'three';
import {addChannel,applyClip,duration,restorePose,storedPose} from '../../../../../../tools/creature-motion/pose.js';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';
const owner='assets/art/tripo/imports/creatures/audit-nightforge-marshal';
const source='assets/art/tripo/imports/creatures/starred-dark-knight/black-keep-knight-native-rig.glb';
const sourceSha='d6da27cdbfdd34e96f43c4b17184bba26dc49a0039b71efab9c634d6fa527aa4';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(source);
if(sha(bytes)!==sourceSha)throw new Error('Black Keep Knight source candidate changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.readBinary(bytes),root=doc.getRoot();
const primitive=root.listMeshes()[0].listPrimitives()[0],images=root.listTextures().map(t=>[t.getName(),sha(t.getImage())]);
const geometry=Object.fromEntries(['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'].map(a=>[a,sha(Buffer.from(primitive.getAttribute(a).getArray().buffer))]));
const indexSha=sha(Buffer.from(primitive.getIndices().getArray().buffer));
const skin=root.listSkins()[0];if(skin.listJoints().length!==25)throw new Error('Expected 25-joint source rig');
const untouched=new Map(root.listAnimations().filter(a=>a.getName()!=='Death').map(a=>[a.getName(),a.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath(),sha(Buffer.from(c.getSampler().getInput().getArray().buffer)),sha(Buffer.from(c.getSampler().getOutput().getArray().buffer))])]));
const presentation=root.listNodes().find(n=>n.getName()==='BlackKeepKnightPresentation');
const armature=root.listNodes().find(n=>n.getName()==='BlackKeepKnightArmature');
if(!presentation||!armature)throw new Error('Knight presentation rig missing');
presentation.setScale([3.25,3.25,3.25]); // .982 m source body -> 3.19 m boss.
const death=root.listAnimations().find(a=>a.getName()==='Death');
for(const sampler of death.listSamplers()){
 const oldTimes=Array.from(sampler.getInput().getArray()),oldValues=Array.from(sampler.getOutput().getArray());
 const width=sampler.getOutput().getElementSize();
 sampler.getInput().setArray(new Float32Array([...oldTimes.map(t=>t*.65/1.45),1.5]));
 sampler.getOutput().setArray(new Float32Array([...oldValues,...oldValues.slice(-width)]));
}
const fallTimes=[0,.12,.25,.4,.55,.65,1.5],fallAngles=[0,.10,.38,.83,1.23,1.48,1.48];
addChannel(doc,death,armature,'rotation',fallTimes,fallAngles.flatMap(a=>new Quaternion().setFromAxisAngle(new Vector3(1,0,0),a).toArray()));
const rest=storedPose(doc),floorTimes=Array.from({length:61},(_,i)=>i*1.5/60),raw=[];
for(const t of floorTimes){restorePose(rest);applyClip(death,t);raw.push(deformedBounds(doc));}
restorePose(rest);
const floorLift=raw.map(b=>Math.max(0,(.006-b.min[1])/3.25));
addChannel(doc,death,armature,'translation',floorTimes,floorLift.flatMap(l=>[0,l,0]));
const samples=[];
for(const t of [0,.12,.25,.4,.55,.65,.8,1,1.25,1.5]){
 restorePose(rest);applyClip(death,t);const b=deformedBounds(doc);
 samples.push({seconds:t,minY:b.min[1],topY:b.max[1],height:b.max[1]-b.min[1]});
}
restorePose(rest);const bounds=deformedBounds(doc);
if(samples.find(s=>s.seconds===.65).topY>samples[0].topY*.6)throw new Error(`Death failed collapse: ${JSON.stringify(samples)}`);
if(samples.some(s=>s.minY<-.02))throw new Error(`Death penetrates: ${JSON.stringify(samples)}`);
if(Math.abs(samples.find(s=>s.seconds===.65).topY-samples.at(-1).topY)>.003)throw new Error('Death does not hold');
const output=await io.writeBinary(doc),name='nightforge-marshal-candidate.glb',file=`${owner}/${name}`;
await writeFile(file,output);
const check=(await io.readBinary(output)).getRoot(),cp=check.listMeshes()[0].listPrimitives()[0];
for(const [attribute,hash] of Object.entries(geometry))if(sha(Buffer.from(cp.getAttribute(attribute).getArray().buffer))!==hash)throw new Error(`Changed ${attribute}`);
if(sha(Buffer.from(cp.getIndices().getArray().buffer))!==indexSha)throw new Error('Changed indices');
if(JSON.stringify(check.listTextures().map(t=>[t.getName(),sha(t.getImage())]))!==JSON.stringify(images))throw new Error('Changed source textures');
for(const [clipName,channels] of untouched){const clip=check.listAnimations().find(a=>a.getName()===clipName),actual=clip.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath(),sha(Buffer.from(c.getSampler().getInput().getArray().buffer)),sha(Buffer.from(c.getSampler().getOutput().getArray().buffer))]);if(JSON.stringify(actual)!==JSON.stringify(channels))throw new Error(`Changed ${clipName}`);}
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const existing=manifest.assets.find(a=>a.id==='creature_nightforge_marshal');
const candidate={id:'creature_nightforge_marshal',file:existing.file,candidateFile:file,pack:'corealm-tripo-audit-nightforge-marshal',category:'character',is:'Nightforge Marshal',
 tags:['creature','humanoid','nightforge','marshal','tripo'],bytes:output.length,sha256:sha(output),
 size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:0,triangles:4305,
 animations:check.listAnimations().map(a=>a.getName()),materials:check.listMaterials().map(m=>m.getName()),
 walkClipSeconds:duration(check.listAnimations().find(a=>a.getName()==='Walk')),runClipSeconds:duration(check.listAnimations().find(a=>a.getName()==='Run')),
 attackSeconds:duration(check.listAnimations().find(a=>a.getName()==='Attack')),contactNormalized:.50/.92,
 locomotionPolicy:null,impliedWalkMps:null,impliedRunMps:null,measuredGait:null,
 sourceProvenance:{tool:'Tripo Studio',sourceModelId:'8f2d7a21-7419-4337-ae73-570e04c16499',sourceCardId:'ee9e261b-ce0b-4393-8a95-f29e62aca233',
  sourceFile:'assets/art/tripo/exports/8f2d7a21-7419-4337-ae73-570e04c16499.glb',sourceSha256:'1cd47dbf8c637cf9d8f121ef5acaff0429f19ee01fa77cb2304e73e87169f121',
  reviewedCandidate:source,reviewedCandidateSha256:sourceSha,
  sourceDesignAudit:'Black-plate enclosed-helm knight with burgundy cape approved in starred creature source review',
  textureTreatment:'Existing detailed 2K base-color, metallic-roughness and normal maps retained unchanged.'},
 metadata:{identity:'Nightforge Marshal',presentation:{rawAssetHeightMeters:bounds.max[1]-bounds.min[1],sceneScale:3.25,
  note:'Single dark Marshal asset for its existing encounters; Pearl Knight and Ivory Castellan have separate current asset IDs.'},
  deathRepair:{method:'Retimed source pose plus 85-degree backward fall and sampled root grounding; held after 0.65s',seconds:1.5,samples,maximumFloorLiftMeters:Math.max(...floorLift)*3.25}},
 acceptance:{sourceAccepted:true,labAccepted:false,worldIntegrated:false}};
await writeFile(`${owner}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:[{...candidate,file:name,candidateFile:undefined}],files:{[candidate.id]:name}},null,2));
await writeFile(`${owner}/promotion.json`,JSON.stringify({schema:'corealm-creature-promotion/1',assets:[candidate],pack:{id:candidate.pack,name:'Corealm Tripo Nightforge Marshal',author:'Corealm / Tripo Studio',source:`${owner}/build-marshal.mjs`,license:'LicenseRef-Corealm-Original',generatorSha256:'TO_BE_FILLED'}},null,2));
await writeFile(`${owner}/validation.json`,JSON.stringify({sourceSha256:sourceSha,candidateSha256:candidate.sha256,restBounds:bounds,samples,maximumFloorLiftMeters:Math.max(...floorLift)*3.25,unchangedClips:[...untouched.keys()],sourceTextures:images},null,2));
console.log(JSON.stringify({id:candidate.id,sha256:candidate.sha256,restBounds:bounds,samples},null,2));
