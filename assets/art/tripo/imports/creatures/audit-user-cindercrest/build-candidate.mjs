import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.ts';
import { duration, storedPose, restorePose, applyClip } from '../../../../../../tools/creature-motion/pose.ts';

const dir='assets/art/tripo/imports/creatures/audit-user-cindercrest';
const source=`${dir}/source-original.glb`, output=`${dir}/creature_cindercrest_salamander.glb`;
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(source), sourceSha=sha(sourceBytes);
if(sourceSha!=='2578c1c3957b3cbe6e00dbca719f5e9d2a833e5105b8fa8cc6a338111fdbb478')throw Error('Source changed');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS), doc=await io.readBinary(sourceBytes), root=doc.getRoot();
const scene=root.listScenes()[0], mesh=root.listMeshes()[0], primitive=mesh?.listPrimitives()[0], meshNode=scene?.listChildren()[0];
if(root.listSkins().length||root.listAnimations().length||root.listMeshes().length!==1||!primitive||meshNode?.getMesh()!==mesh)throw Error('Unexpected source hierarchy');
const position=primitive.getAttribute('POSITION');
// PCA of the source's ground plane gives a diagonal head-to-tail axis. Rotate
// coordinates into an anatomical frame without changing topology, UVs or maps.
const c=.53880269,s=.84243199;
for(const semantic of ['POSITION','NORMAL']){
 const a=primitive.getAttribute(semantic),old=Float32Array.from(a.getArray()),turned=new Float32Array(old.length);
 for(let i=0;i<old.length;i+=3){turned[i]=c*old[i]-s*old[i+2];turned[i+1]=old[i+1];turned[i+2]=s*old[i]+c*old[i+2]}
 a.setArray(turned);
}
const sourcePositions=Float32Array.from(position.getArray());
const vertices=position.getCount(), triangles=primitive.getIndices().getCount()/3;
if(vertices!==3561||triangles!==5000)throw Error('Source topology changed');
const material=primitive.getMaterial();
if(!material?.getBaseColorTexture()||!material.getNormalTexture()||!material.getMetallicRoughnessTexture())throw Error('Missing source PBR');
const textureSha=root.listTextures().map(t=>({name:t.getName(),mime:t.getMimeType(),bytes:t.getImage().length,sha256:sha(t.getImage())}));
const B=(name,parent,p,sigma,group)=>({name,parent,p,sigma,group});
// Source faces +X. The high rear form is a curled ember tail, not an upright body.
const bones=[
 B('SalamanderRoot',null,[0,0,0],.5,'root'),
 B('Pelvis','SalamanderRoot',[-.15,.33,0],.20,'body'),
 B('Spine','Pelvis',[-.02,.38,0],.18,'body'),
 B('Chest','Spine',[.14,.37,0],.16,'body'),
 B('Neck','Chest',[.25,.32,0],.11,'head'),
 B('Head','Neck',[.34,.29,0],.13,'head'),
 B('Muzzle','Head',[.43,.25,0],.07,'head'),
 B('TailBase','Pelvis',[-.27,.38,0],.12,'tail'),
 B('TailMid','TailBase',[-.37,.58,0],.12,'tail'),
 B('TailTip','TailMid',[-.45,.84,0],.12,'tail'),
 B('FrontLeftUpper','Chest',[.24,.25,.23],.12,'frontL'),
 B('FrontLeftFoot','FrontLeftUpper',[.38,.06,.37],.10,'frontL'),
 B('FrontRightUpper','Chest',[.24,.25,-.23],.12,'frontR'),
 B('FrontRightFoot','FrontRightUpper',[.38,.06,-.37],.10,'frontR'),
 B('HindLeftUpper','Pelvis',[.07,.24,.22],.12,'hindL'),
 B('HindLeftFoot','HindLeftUpper',[.16,.06,.32],.10,'hindL'),
 B('HindRightUpper','Pelvis',[.07,.24,-.22],.12,'hindR'),
 B('HindRightFoot','HindRightUpper',[.16,.06,-.32],.10,'hindR'),
];
const byName=new Map(bones.map((b,i)=>[b.name,{...b,index:i}])), nodeByName=new Map();
const rig=doc.createNode('CindercrestRig').setRotation([0,-Math.SQRT1_2,0,Math.SQRT1_2]).setScale([1.15,1.15,1.15]);
scene.removeChild(meshNode);scene.addChild(rig);rig.addChild(meshNode);meshNode.setName('CindercrestMesh');
for(const b of bones){
 const parent=b.parent?byName.get(b.parent):null;
 const local=parent?b.p.map((v,i)=>v-parent.p[i]):b.p;
 const node=doc.createNode(b.name).setTranslation(local);
 (b.parent?nodeByName.get(b.parent):rig).addChild(node);nodeByName.set(b.name,node);
}
const buffer=root.listBuffers()[0],skin=doc.createSkin('CindercrestSalamanderGeneric').setSkeleton(nodeByName.get('SalamanderRoot'));
for(const b of bones)skin.addJoint(nodeByName.get(b.name));
const ibm=new Float32Array(bones.length*16);
for(let i=0;i<bones.length;i++){let [x,y,z]=bones[i].p;ibm.set([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1],i*16)}
skin.setInverseBindMatrices(doc.createAccessor('InverseBinds').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer));meshNode.setSkin(skin);
const sigmoid=x=>1/(1+Math.exp(-x));
function segmentDistance(p,a,b){let ab=b.map((v,i)=>v-a[i]),den=ab.reduce((s,v)=>s+v*v,0),t=Math.max(0,Math.min(1,p.reduce((s,v,i)=>s+(v-a[i])*ab[i],0)/(den||1)));return Math.hypot(...p.map((v,i)=>v-a[i]-t*ab[i]))}
const joints=new Uint16Array(vertices*4),weights=new Float32Array(vertices*4),influences=new Uint32Array(bones.length);
for(let v=0;v<vertices;v++){
 const p=[sourcePositions[v*3],sourcePositions[v*3+1],sourcePositions[v*3+2]], [x,y,z]=p;
 const scores=bones.slice(1).map(b=>{
  let gate=1;
  if(b.group==='head')gate=sigmoid((x-.20)/.05);
  else if(b.group==='tail')gate=sigmoid((-.19-x)/.055)*sigmoid((y-.35)/.08);
  else if(b.group.startsWith('front'))gate=sigmoid((x-.13)/.055)*sigmoid((.32-y)/.06)*sigmoid(((b.group.endsWith('L')?1:-1)*z-.10)/.045);
  else if(b.group.startsWith('hind'))gate=sigmoid((.26-x)/.055)*sigmoid((.30-y)/.06)*sigmoid(((b.group.endsWith('L')?1:-1)*z-.10)/.045);
  else gate=sigmoid((.30-Math.abs(z))/.06)*sigmoid((.60-y)/.07);
  let parent=byName.get(b.parent),d=segmentDistance(p,parent?.p??b.p,b.p);
  return {index:byName.get(b.name).index,score:(.001+gate)*Math.exp(-.5*(d/b.sigma)**2)};
 }).sort((a,b)=>b.score-a.score).slice(0,4);
 let total=scores.reduce((s,a)=>s+a.score,0),assigned=0;
 for(let k=0;k<4;k++){let w=k===3?1-assigned:scores[k].score/total;joints[v*4+k]=scores[k].index;weights[v*4+k]=w;assigned+=w;if(w>1e-5)influences[scores[k].index]++}
}
primitive.setAttribute('JOINTS_0',doc.createAccessor('JointIndices').setType(Accessor.Type.VEC4).setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor('JointWeights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));
// Retain all three original image maps and the original material response.
const quat=(axis,a)=>{let s=Math.sin(a/2),c=Math.cos(a/2);return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c]};
const clips=[];
function addClip(name,seconds,tracks){let clip=doc.createAnimation(name);for(let tr of tracks){let input=doc.createAccessor(`${name}_${tr.name}_t`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(tr.t)).setBuffer(buffer),output=doc.createAccessor(`${name}_${tr.name}_v`).setType(tr.path==='translation'?Accessor.Type.VEC3:Accessor.Type.VEC4).setArray(Float32Array.from(tr.v.flat())).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodeByName.get(tr.name)).setTargetPath(tr.path??'rotation').setSampler(sampler))}clips.push(clip)}
const rot=(name,axis,t,angles)=>({name,t,v:angles.map(a=>quat(axis,a))});
const move=(name,t,xs,ys)=>({name,path:'translation',t,v:xs.map((x,i)=>[x,ys[i],0])});
const rootT=(t,xs,ys)=>move('SalamanderRoot',t,xs,ys);
const cycle=[0,.125,.25,.375,.5,.625,.75,.875,1];
addClip('Idle',3,[rootT([0,.75,1.5,2.25,3],[0,0,0,0,0],[0,.008,0,.006,0]),rot('Chest','y',[0,.75,1.5,2.25,3],[0,.025,0,-.025,0]),rot('TailTip','y',[0,.75,1.5,2.25,3],[0,.09,0,-.09,0])]);
function gait(name,seconds,swing,lift){let t=cycle.map(q=>q*seconds),tracks=[rootT(t,cycle.map(()=>0),cycle.map(q=>.005+lift*(1-Math.cos(4*Math.PI*q))*.5)),rot('Spine','y',t,cycle.map(q=>.065*Math.sin(2*Math.PI*q))),rot('TailBase','y',t,cycle.map(q=>-.12*Math.sin(2*Math.PI*q))),rot('TailMid','y',t,cycle.map(q=>-.17*Math.sin(2*Math.PI*q-.5)))];for(const [n,phase,sign] of [['FrontLeft',0,1],['HindRight',0,-1],['FrontRight',.5,-1],['HindLeft',.5,1]]){tracks.push(rot(n+'Upper','z',t,cycle.map(q=>sign*swing*Math.sin(2*Math.PI*(q+phase)))));tracks.push(rot(n+'Foot','z',t,cycle.map(q=>sign*.16*Math.max(0,Math.sin(2*Math.PI*(q+phase))))))}addClip(name,seconds,tracks)}
gait('Walk',1.2,.23,.007);gait('Run',.72,.38,.018);
addClip('Attack',.88,[rootT([0,.18,.36,.58,.88],[0,-.035,.10,.06,0],[0,.015,.025,.01,0]),rot('Chest','z',[0,.18,.36,.58,.88],[0,-.10,.18,.08,0]),rot('Head','z',[0,.18,.36,.58,.88],[0,-.13,.23,.08,0]),rot('TailBase','y',[0,.18,.36,.58,.88],[0,.10,-.19,-.08,0])]);
addClip('Hit',.48,[rootT([0,.11,.25,.48],[0,-.045,-.02,0],[0,.018,.008,0]),rot('Chest','y',[0,.11,.25,.48],[0,.24,-.10,0]),rot('Head','z',[0,.11,.25,.48],[0,-.16,.08,0])]);
addClip('Death',1.6,[rootT([0,.3,.8,1.3,1.6],[0,0,0,0,0],[0,.005,.02,.025,.025]),rot('Chest','z',[0,.3,.8,1.3,1.6],[0,.04,-.10,-.14,-.14]),rot('Head','z',[0,.3,.8,1.3,1.6],[0,.04,-.17,-.25,-.25]),rot('TailBase','z',[0,.3,.8,1.3,1.6],[0,-.18,-.48,-.82,-.82]),rot('TailMid','z',[0,.3,.8,1.3,1.6],[0,-.12,-.29,-.44,-.44]),rot('TailTip','z',[0,.3,.8,1.3,1.6],[0,-.10,-.21,-.27,-.27])]);
const pose=storedPose(doc),motion=[];let rest;
for(const clip of clips){let samples=[];for(const f of [0,.25,.5,.75,1]){restorePose(pose);applyClip(clip,duration(clip)*f);let b=deformedBounds(doc);samples.push({time:+(duration(clip)*f).toFixed(3),minY:b.min[1],maxY:b.max[1],size:b.max.map((v,i)=>v-b.min[i])})}motion.push({name:clip.getName(),seconds:duration(clip),channels:clip.listChannels().length,samples});}
restorePose(pose);rest=deformedBounds(doc);
const bytes=Buffer.from(await io.writeBinary(doc));await writeFile(output,bytes);
const verify=await io.readBinary(bytes),vr=verify.getRoot(),vp=vr.listMeshes()[0].listPrimitives()[0];
if(vr.listSkins()[0].listJoints().length!==bones.length||vr.listAnimations().length!==6||vp.getAttribute('POSITION').getCount()!==vertices)throw Error('Export roundtrip invalid');
for(let i=0;i<vr.listTextures().length;i++)if(sha(vr.listTextures()[i].getImage())!==textureSha[i].sha256)throw Error('Source texture changed');
const bounds=rest,size={x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},base={x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]};
const builderSha=sha(await readFile(import.meta.filename));
const catalogSource=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')).assets.find(a=>a.id==='creature_cindercrest_salamander');
const provenance={sourceFile:source,sourceOriginalPath:'C:/Users/Borg/Downloads/lava+salamander+3d+model.glb',sourceSha256:sourceSha,sourceBytes:sourceBytes.length,sourceGenerator:'Tripo',sourceLicense:'LicenseRef-Tripo-Generated; user-supplied export, entitlement to be confirmed by project owner',sourceTextures:textureSha,builderFile:`${dir}/build-candidate.mjs`,builderSha256:builderSha,sourceTopologyPreserved:true,sourcePbrImagesPreservedByteForByte:true,rigMethod:'18-joint geometry-aware quadruped skin fitted to the delivered static mesh'};
const entry={...catalogSource,pack:'corealm-user-cindercrest-candidate',bytes:bytes.length,sha256:sha(bytes),triangles,size,base,bounds,groundY:bounds.min[1],animations:clips.map(c=>c.getName()),materials:vr.listMaterials().map(m=>m.getName()),walkClipSeconds:duration(clips[1]),runClipSeconds:duration(clips[2]),attackSeconds:duration(clips[3]),contactNormalized:.41,sourceProvenance:provenance,metadata:{is:'cindercrest salamander',tags:['salamander','amphibian','cindercrest','volcanic','quadruped'],provenance,attackSeconds:duration(clips[3]),contactNormalized:.41,walkClipSeconds:duration(clips[1]),runClipSeconds:duration(clips[2]),sourceBuilderSha256:builderSha,boneNames:bones.map(b=>b.name),gaitFootBones:['FrontLeftFoot','FrontRightFoot','HindLeftFoot','HindRightFoot'],regionalVariant:catalogSource.metadata?.regionalVariant,notes:'User-supplied salamander with original PBR maps and topology preserved. New anatomy-aware rig and clips; gait calibration awaits moving lab review.'},candidateFile:output,acceptance:{assetAudit:false,rigAccepted:false,motionAccepted:false,texturesAccepted:false,labAccepted:false,worldIntegrated:false}};
delete entry.measuredGait;delete entry.impliedWalkMps;delete entry.impliedRunMps;
await writeFile(`${dir}/lab-catalog.json`,JSON.stringify({schema:'corealm-lab-asset-candidates/1',pack:{id:'corealm-user-cindercrest-candidate',name:'User Cindercrest Salamander candidate',author:'Corealm',source:source,license:provenance.sourceLicense,generatorSha256:builderSha},assets:[entry],files:{creature_cindercrest_salamander:'creature_cindercrest_salamander.glb'}},null,2));
await writeFile(`${dir}/promotion.json`,JSON.stringify({schema:'corealm-creature-candidate-promotion/1',status:'awaiting-root-lab-review',accepted:false,assetId:entry.id,candidateFile:output,productionFile:`game/public/assets/${catalogSource.file}`,candidateSha256:entry.sha256,candidateBytes:bytes.length,bounds,joints:bones.map(b=>b.name),clips:motion.map(m=>({name:m.name,seconds:m.seconds,channels:m.channels})),contactNormalized:.41,sourceProvenance:provenance,labCatalog:`${dir}/lab-catalog.json`,cpuValidation:`${dir}/validation.json`,remainingAcceptance:['Root gameplay-camera lab screenshot review','Root semantic combat and death verification','Root production integration and build']},null,2));
await writeFile(`${dir}/validation.json`,JSON.stringify({schema:'corealm-cindercrest-cpu-validation/1',sourceSha256:sourceSha,candidateSha256:entry.sha256,sourceVertices:vertices,sourceTriangles:triangles,jointInfluenceCounts:bones.map((b,i)=>({name:b.name,count:influences[i]})),restBounds:bounds,motion,sourceTextures:textureSha},null,2));
console.log(JSON.stringify({output,sha256:entry.sha256,bytes:bytes.length,bounds,motion:motion.map(m=>({name:m.name,seconds:m.seconds,minY:Math.min(...m.samples.map(s=>s.minY))}))},null,2));
