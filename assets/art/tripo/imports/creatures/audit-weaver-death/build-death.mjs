import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Quaternion,Vector3} from 'three';
import {addChannel,applyClip,duration,restorePose,storedPose} from '../../../../../../tools/creature-motion/pose.js';
import {deformedBounds} from '../../../../../../tools/creature-motion/validate-deformation.js';

const owner='assets/art/tripo/imports/creatures/audit-weaver-death';
const sourceCatalogues=[
  JSON.parse(await readFile('test-results/creature-audit/promotions/weavers.json','utf8')),
  JSON.parse(await readFile('test-results/creature-audit/promotions/weaver-variants.json','utf8')),
];
const sourceEntries=sourceCatalogues.flatMap(c=>c.assets);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const accessorHash=a=>a?sha(Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength)):null;
const renderFingerprint=root=>JSON.stringify({
  meshes:root.listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({
    indices:accessorHash(p.getIndices()),material:p.getMaterial()?.getName(),
    attributes:Object.fromEntries(p.listSemantics().sort().map(s=>[s,accessorHash(p.getAttribute(s))]))}))})),
  textures:root.listTextures().map(t=>[t.getName(),sha(t.getImage()||new Uint8Array())]),
  skins:root.listSkins().map(s=>[s.listJoints().map(j=>j.getName()),accessorHash(s.getInverseBindMatrices())]),
});
const times=[0,.12,.28,.48,.72,1.55];
const smooth=t=>{const u=Math.max(0,Math.min(1,t));return u*u*(3-2*u)};
const qFactor=(source,factor,blend)=>{
  const q=new Quaternion(...source).normalize();
  const theta=2*Math.acos(Math.max(-1,Math.min(1,q.w)));
  const axis=new Vector3(q.x,q.y,q.z);
  if(axis.lengthSq()<1e-10)return [0,0,0,1];
  axis.normalize();
  return new Quaternion().setFromAxisAngle(axis,theta*factor*blend).toArray();
};
const metrics=[];
const labAssets=[];
const promotionAssets=[];
for(const sourceEntry of sourceEntries){
  const id=sourceEntry.id;
  const sourceBytes=await readFile(sourceEntry.candidateFile);
  if(sourceBytes.length!==sourceEntry.bytes||sha(sourceBytes)!==sourceEntry.sha256)throw new Error(`${id}: source candidate drift`);
  const doc=await io.readBinary(sourceBytes),root=doc.getRoot();
  const sourceRenderFingerprint=renderFingerprint(root);
  const death=root.listAnimations().find(a=>a.getName()==='Death');
  if(!death||root.listSkins()[0]?.listJoints().length!==29)throw new Error(`${id}: unexpected six-leg rig`);
  const untouchedClips=new Map(root.listAnimations().filter(a=>a!==death).map(a=>[a.getName(),a.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath(),sha(Buffer.from(c.getSampler().getInput().getArray().buffer)),sha(Buffer.from(c.getSampler().getOutput().getArray().buffer))])]));
  const initialBounds=deformedBounds(doc);
  let legChannels=0;
  for(const channel of death.listChannels()){
    const node=channel.getTargetNode()?.getName(),path=channel.getTargetPath(),sampler=channel.getSampler();
    if(!node||!sampler)throw new Error(`${id}: detached Death channel`);
    if(path==='translation'&&node==='BodyCore'){
      const first=sampler.getOutput().getElement(0,[]);
      const values=times.flatMap(t=>{const phase=smooth((t-.07)/.63);return [first[0],first[1]-.25*phase,first[2]-.045*phase]});
      sampler.getInput().setArray(new Float32Array(times));
      sampler.getOutput().setArray(new Float32Array(values));
    }else if(path==='rotation'){
      const output=sampler.getOutput(),last=output.getElement(output.getCount()-1,[]);
      const leg=/(Fore|Mid|Hind)[LR]_(Hip|Knee|Ankle|Foot)/.exec(node);
      const factor=leg?({Hip:3.4,Knee:3.0,Ankle:2.7,Foot:2.0})[leg[2]]:
        node==='BodyCore'?3.5:node==='Carapace'?2.3:node==='Hood'?2.0:1.0;
      if(leg)legChannels++;
      const onset=leg?(leg[1]==='Hind'?.12:leg[1]==='Mid'?.09:.06)+(leg[2]==='Foot'?.06:0):.08;
      const finish=leg?.78:.68;
      const values=times.flatMap(t=>qFactor(last,factor,smooth((t-onset)/(finish-onset))));
      sampler.getInput().setArray(new Float32Array(times));
      sampler.getOutput().setArray(new Float32Array(values));
    }
  }
  if(legChannels!==24)throw new Error(`${id}: expected 24 articulated leg tracks, got ${legChannels}`);
  const bodyJoint=root.listSkins()[0].listJoints().find(n=>n.getName()==='BodyCore');
  if(!bodyJoint)throw new Error(`${id}: missing body joint`);
  addChannel(doc,death,bodyJoint,'scale',times,times.flatMap(t=>{const p=smooth((t-.08)/.64);return [1-.12*p,1-.38*p,1-.10*p]}));
  const rest=storedPose(doc);
  const floorTimes=Array.from({length:33},(_,i)=>i*1.55/32);
  const raw=[];
  for(const t of floorTimes){restorePose(rest);applyClip(death,t);raw.push(deformedBounds(doc));}
  restorePose(rest);
  const rootJoint=root.listSkins()[0].listJoints().find(n=>n.getName()==='VaultweaverRoot');
  if(!rootJoint)throw new Error(`${id}: missing root`);
  const world=rootJoint.getWorldMatrix(),rootYScale=Math.hypot(world[4],world[5],world[6]);
  const floorLift=raw.map(b=>Math.max(0,(.008-b.min[1])/rootYScale));
  addChannel(doc,death,rootJoint,'translation',floorTimes,floorLift.flatMap(l=>[0,l,0]));
  const sampleTimes=[0,.28,.48,.72,1.0,1.38,1.55];
  const deathSamples=[];
  for(const t of sampleTimes){restorePose(rest);applyClip(death,t);const b=deformedBounds(doc);deathSamples.push({seconds:t,minY:b.min[1],maxY:b.max[1],height:b.max[1]-b.min[1]});}
  restorePose(rest);
  const end=deathSamples.at(-1),start=deathSamples[0];
  if(end.maxY>start.maxY*.86||deathSamples.find(s=>s.seconds===.72).maxY>start.maxY*.87)throw new Error(`${id}: Death still reads as standing: ${JSON.stringify(deathSamples)}`);
  if(deathSamples.some(s=>s.minY<-.012))throw new Error(`${id}: Death penetrates ground`);
  const output=await io.writeBinary(doc),name=`${id}-death-collapse.glb`,file=`${owner}/${name}`;
  await writeFile(file,output);
  const check=await io.readBinary(output),checkRoot=check.getRoot();
  if(renderFingerprint(checkRoot)!==sourceRenderFingerprint)throw new Error(`${id}: mesh, texture or skin changed`);
  for(const [clipName,channels] of untouchedClips){
    const clip=checkRoot.listAnimations().find(a=>a.getName()===clipName);
    const actual=clip?.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath(),sha(Buffer.from(c.getSampler().getInput().getArray().buffer)),sha(Buffer.from(c.getSampler().getOutput().getArray().buffer))]);
    if(JSON.stringify(channels)!==JSON.stringify(actual))throw new Error(`${id}: ${clipName} changed`);
  }
  const outputSha=sha(output);
  const candidate={...sourceEntry,candidateFile:file,bytes:output.length,sha256:outputSha,
    sourceProvenance:{...sourceEntry.sourceProvenance,candidateFile:file,candidateSha256:outputSha,deathRepair:{sourceCandidate:sourceEntry.candidateFile,sourceCandidateSha256:sourceEntry.sha256,
      method:'Shared six-leg collapse: body descends, carapace tilts, all 24 leg joints curl, root receives measured floor correction.',
      onlyDeathClipChanged:true}},
    metadata:{...sourceEntry.metadata,deathRepair:{sourceTopY:initialBounds.max[1],samples:deathSamples,maximumFloorLift:Math.max(...floorLift),legChannels}},
    acceptance:{...sourceEntry.acceptance,labAccepted:false,worldIntegrated:false,motionAccepted:false}};
  labAssets.push({...candidate,file:name,candidateFile:undefined});
  promotionAssets.push(candidate);
  metrics.push({id,file,sha256:candidate.sha256,bytes:candidate.bytes,sourceSha256:sourceEntry.sha256,sourceTopY:initialBounds.max[1],deathSamples,maximumFloorLift:Math.max(...floorLift)});
}
await writeFile(`${owner}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',assets:labAssets,
  files:Object.fromEntries(metrics.map(m=>[m.id,m.file.split('/').at(-1)]))},null,2));
await writeFile(`${owner}/promotion.json`,JSON.stringify({schema:'corealm-creature-promotion/1',assets:promotionAssets,
  packs:sourceCatalogues.map(c=>c.pack)},null,2));
await writeFile(`${owner}/deformation.json`,JSON.stringify(metrics,null,2));
console.log(JSON.stringify(metrics.map(m=>({id:m.id,sha256:m.sha256,topStart:m.deathSamples[0].maxY,topAt72:m.deathSamples[3].maxY,topEnd:m.deathSamples.at(-1).maxY,maxFloorLift:m.maximumFloorLift})),null,2));
