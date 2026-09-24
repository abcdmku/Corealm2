import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const here=path.dirname(fileURLToPath(import.meta.url));
const sourceFile=path.join(here,'sources/stylized-spider-user-original.glb');
const candidateFile=path.join(here,'creature_reed_strider.glb');
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=await readFile(sourceFile);
const sourceSha='131f6e7d859aef558e55506e5e184bb229e5b7b010a57c58e81a5a89f62b6d54';
if(sha(sourceBytes)!==sourceSha)throw Error('Delivered source changed');
const io=new NodeIO(),doc=await io.readBinary(sourceBytes),root=doc.getRoot(),scene=root.listScenes()[0];
const meshNode=root.listNodes().find(n=>n.getMesh()),primitive=meshNode?.getMesh()?.listPrimitives()[0];
if(!scene||!meshNode||!primitive||meshNode.getSkin()||root.listAnimations().length)throw Error('Unexpected source scene, skin or clips');
const material=primitive.getMaterial();
if(!material?.getBaseColorTexture()||!material.getNormalTexture()||!material.getMetallicRoughnessTexture())throw Error('Source PBR maps absent');
const positions=Float32Array.from(primitive.getAttribute('POSITION').getArray());
const normals=Float32Array.from(primitive.getAttribute('NORMAL').getArray());
const uvs=Float32Array.from(primitive.getAttribute('TEXCOORD_0').getArray());
const indices=Uint32Array.from(primitive.getIndices().getArray());
const vertexCount=positions.length/3,triangleCount=indices.length/3;
if(vertexCount!==3316||triangleCount!==4874)throw Error('Unexpected source topology');
const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){bounds.min[k]=Math.min(bounds.min[k],positions[i+k]);bounds.max[k]=Math.max(bounds.max[k],positions[i+k]);}
const textureSha=new Map(root.listTextures().map(t=>[t.getName(),sha(t.getImage())]));

// Native coordinates: Y is up, Z is the bilateral leg span, and +X is anterior.
// The delivered silhouette has two raised grasping limbs, four walking limbs,
// and two short mandibles. The user confirmed this source for Reed Strider.
// Preserve its supplied anatomy without removing appendages.
const rig=[
  ['StriderRoot',null,[0,0,0]],
  ['Thorax','StriderRoot',[.055,.405,0]],
  ['Abdomen','Thorax',[-.085,.605,0]],
  ['AbdomenTip','Abdomen',[-.14,.785,0]],
  ['Head','Thorax',[.135,.335,0]],
  ['Mandible_L','Head',[.175,.27,-.043]],['Mandible_R','Head',[.175,.27,.043]],
  ['ForeUpper_L','Thorax',[.105,.495,-.075]],
  ['ForeElbow_L','ForeUpper_L',[.195,.68,-.16]],
  ['ForeBlade_L','ForeElbow_L',[.24,.84,-.275]],
  ['ForeUpper_R','Thorax',[.105,.495,.075]],
  ['ForeElbow_R','ForeUpper_R',[.195,.68,.16]],
  ['ForeBlade_R','ForeElbow_R',[.24,.84,.275]],
  ['MidUpper_L','Thorax',[.09,.455,-.075]],
  ['MidKnee_L','MidUpper_L',[.195,.445,-.30]],
  ['MidFoot_L','MidKnee_L',[.245,.43,-.47]],
  ['MidUpper_R','Thorax',[.09,.455,.075]],
  ['MidKnee_R','MidUpper_R',[.195,.445,.30]],
  ['MidFoot_R','MidKnee_R',[.245,.43,.47]],
  ['HindUpper_L','Thorax',[.09,.35,-.055]],
  ['HindKnee_L','HindUpper_L',[.19,.21,-.18]],
  ['HindFoot_L','HindKnee_L',[.22,.04,-.29]],
  ['HindUpper_R','Thorax',[.09,.35,.055]],
  ['HindKnee_R','HindUpper_R',[.19,.21,.18]],
  ['HindFoot_R','HindKnee_R',[.22,.04,.29]],
];
const defs=new Map(rig.map(([name,parent,global])=>[name,{parent,global}]));
const nodes=new Map(),locals=new Map(),ordered=[];
const container=doc.createNode('ReedStrider_Rig');scene.removeChild(meshNode);scene.addChild(container);container.addChild(meshNode);
for(const [name,parent,global] of rig){
  const p=parent?defs.get(parent).global:[0,0,0],local=global.map((x,k)=>x-p[k]);
  const node=doc.createNode(name).setTranslation(local).setRotation([0,0,0,1]);
  (parent?nodes.get(parent):container).addChild(node);nodes.set(name,node);locals.set(name,local);ordered.push(name);
}
const skin=doc.createSkin('Reed Strider six-limb skin').setSkeleton(nodes.get('StriderRoot'));
for(const name of ordered)skin.addJoint(nodes.get(name));
meshNode.setSkin(skin);
const buffer=root.listBuffers()[0]??doc.createBuffer('Reed Strider rig and clips');
const globalMat=new Map(),ibm=new Float32Array(ordered.length*16);
for(let i=0;i<ordered.length;i++){
  const name=ordered[i],parent=defs.get(name).parent,m=new THREE.Matrix4().makeTranslation(...locals.get(name));
  globalMat.set(name,parent?globalMat.get(parent).clone().multiply(m):m);
  globalMat.get(name).clone().invert().toArray(ibm,i*16);
}
skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
const dist=(p,a,b)=>{
  const ab=b.map((v,i)=>v-a[i]),ap=p.map((v,i)=>v-a[i]),den=ab.reduce((s,v)=>s+v*v,0);
  const t=den?Math.max(0,Math.min(1,ap.reduce((s,v,i)=>s+v*ab[i],0)/den)):0;
  return Math.hypot(...p.map((v,i)=>v-a[i]-ab[i]*t));
};
const segments=new Map(rig.map(([name,parent,global])=>[name,[parent?defs.get(parent).global:global,global]]));
const joints=new Uint16Array(vertexCount*4),weights=new Float32Array(vertexCount*4),coverage=new Array(ordered.length).fill(0);
const index=new Map(ordered.map((n,i)=>[n,i]));
const choose=(p)=>{
  const [x,y,z]=p,side=z<0?'L':'R',a=Math.abs(z);
  if(y>.72&&a<.085)return ['Thorax','Abdomen','AbdomenTip'];
  if(y>.55&&a<.105)return ['Thorax','Abdomen','AbdomenTip'];
  if(a>.09&&y>.57)return [`ForeUpper_${side}`,`ForeElbow_${side}`,`ForeBlade_${side}`,'Thorax'];
  if(a>.12&&y>.38&&y<.54)return [`MidUpper_${side}`,`MidKnee_${side}`,`MidFoot_${side}`,'Thorax'];
  if(a>.10&&y<.38)return [`HindUpper_${side}`,`HindKnee_${side}`,`HindFoot_${side}`,'Thorax'];
  if(x>.13&&y<.37&&a<.10)return ['Head',`Mandible_${side}`,'Thorax'];
  if(y<.31&&a<.07)return ['Head',`Mandible_${side}`,'Thorax'];
  return ['Thorax','Abdomen','Head'];
};
for(let v=0;v<vertexCount;v++){
  const p=[positions[v*3],positions[v*3+1],positions[v*3+2]],names=choose(p);
  const scored=names.map(name=>({name,weight:Math.exp(-(dist(p,...segments.get(name))**2)/(2*.095**2))})).sort((a,b)=>b.weight-a.weight).slice(0,4);
  const total=scored.reduce((s,e)=>s+e.weight,0);
  if(total<=0||!Number.isFinite(total))throw Error('No valid skin weight');
  scored.forEach((e,k)=>{joints[v*4+k]=index.get(e.name);weights[v*4+k]=e.weight/total;if(weights[v*4+k]>.00001)coverage[index.get(e.name)]++;});
}
primitive.setAttribute('JOINTS_0',doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0',doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));

const smooth=(a,b,t)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*(3-2*u);};
const pulse=(t,a,b,c,d)=>smooth(a,b,t)*(1-smooth(c,d,t));
function pose(clip,t){
  const r=new Map(),p=new Map(),s=t/clip.seconds,phase=2*Math.PI*s;
  const rot=(n,x=0,y=0,z=0)=>r.set(n,[x,y,z]);
  const tr=(n,x=0,y=0,z=0)=>p.set(n,[x,y,z]);
  if(clip.name==='Idle'){
    tr('Thorax',0,.004*(1-Math.cos(phase)),0);rot('Abdomen',.016*Math.sin(phase),0,.012*Math.sin(phase));
    rot('Head',.025*Math.sin(phase+.4),0,0);
    for(const side of ['L','R']){const sign=side==='L'?-1:1;rot(`ForeUpper_${side}`,.02*Math.sin(phase),sign*.018*Math.sin(phase),0);rot(`Mandible_${side}`,0,sign*.028*Math.sin(phase+.7),0);}
  }else if(clip.name==='Walk'||clip.name==='Run'){
    const fast=clip.name==='Run',stride=fast?.33:.20,lift=fast?.11:.065;
    tr('Thorax',0,(fast?.012:.007)*(1-Math.cos(phase*2))+(fast?.031:.018)*Math.sin(phase)**2,0);
    rot('Abdomen',.03*Math.sin(phase*2),0,.025*Math.sin(phase));rot('Head',-.025*Math.sin(phase),0,0);
    for(const [side,offset] of [['L',0],['R',Math.PI]]){
      const sign=side==='L'?-1:1,mid=phase+offset,hind=phase+offset+Math.PI;
      rot(`MidUpper_${side}`,stride*Math.sin(mid),0,sign*.09*Math.sin(mid));
      rot(`MidKnee_${side}`,-lift*Math.max(0,Math.sin(mid)),sign*.12*Math.sin(mid),0);
      rot(`MidFoot_${side}`,-.25*stride*Math.sin(mid),0,0);
      rot(`HindUpper_${side}`,stride*Math.sin(hind),0,sign*.08*Math.sin(hind));
      rot(`HindKnee_${side}`,-lift*Math.max(0,Math.sin(hind)),sign*.11*Math.sin(hind),0);
      rot(`HindFoot_${side}`,-.25*stride*Math.sin(hind),0,0);
      rot(`ForeUpper_${side}`,.08*Math.sin(phase+offset),sign*.04*Math.sin(phase+offset),0);
      rot(`ForeElbow_${side}`,-.04*Math.sin(phase+offset),0,0);
    }
  }else if(clip.name==='Attack'){
    const wind=pulse(s,.03,.26,.39,.49),stab=pulse(s,.39,.48,.57,.72),recoil=pulse(s,.53,.65,.81,.95);
    tr('Thorax',.025*stab,.026*wind+.05*stab,0);rot('Thorax',-.07*wind+.16*stab,0,0);
    rot('Abdomen',-.08*wind+.10*stab,0,0);rot('Head',-.12*wind+.19*stab,0,0);
    for(const side of ['L','R']){
      const sign=side==='L'?-1:1;
      rot(`ForeUpper_${side}`,-.28*wind+.72*stab-.15*recoil,sign*(.14*wind-.20*stab),0);
      rot(`ForeElbow_${side}`,.31*wind-.80*stab+.20*recoil,sign*.08*stab,0);
      rot(`ForeBlade_${side}`,-.20*stab,0,0);
      rot(`Mandible_${side}`,.12*stab,sign*.09*stab,0);
    }
  }else if(clip.name==='Hit'){
    const h=pulse(s,0,.12,.25,.55);
    tr('Thorax',-.03*h,.027*h,0);rot('Thorax',-.13*h,0,.06*h);rot('Abdomen',.12*h,0,0);rot('Head',-.24*h,0,0);
    for(const side of ['L','R']){rot(`ForeUpper_${side}`,-.20*h,0,0);rot(`MidUpper_${side}`,.08*h,0,0);}
  }else if(clip.name==='Death'){
    const collapse=smooth(.13,.78,s),settle=smooth(.78,1,s),flinch=pulse(s,0,.08,.15,.30);
    tr('Thorax',0,-.197*collapse,0);rot('Thorax',0,0,1.23*collapse);
    rot('Abdomen',.18*collapse,0,.18*collapse);rot('Head',-.15*flinch+.23*collapse,0,.22*collapse);
    for(const side of ['L','R']){
      const sign=side==='L'?-1:1;
      rot(`ForeUpper_${side}`,.36*collapse,sign*.18*collapse,0);
      rot(`ForeElbow_${side}`,-.38*collapse,0,0);
      rot(`MidUpper_${side}`,-.20*collapse,sign*.14*collapse,0);
      rot(`HindUpper_${side}`,.22*collapse,sign*.18*collapse,0);
      rot(`HindKnee_${side}`,-.36*collapse,0,0);
      rot(`HindFoot_${side}`,.05*settle,0,0);
    }
  }
  return {r,p};
}
const clips=[
  {name:'Idle',seconds:2,samples:41,loop:true},
  {name:'Walk',seconds:1.12,samples:33,loop:true},
  {name:'Run',seconds:.72,samples:33,loop:true},
  {name:'Attack',seconds:.95,samples:39,loop:false},
  {name:'Hit',seconds:.55,samples:25,loop:false},
  {name:'Death',seconds:1.45,samples:45,loop:false},
];
for(const clip of clips){
  const animation=doc.createAnimation(clip.name),times=Float32Array.from({length:clip.samples},(_,i)=>clip.seconds*i/(clip.samples-1));
  for(const name of ordered){
    const rotations=new Float32Array(clip.samples*4),translations=new Float32Array(clip.samples*3),base=locals.get(name);
    let movingR=false,movingT=false;
    for(let i=0;i<clip.samples;i++){
      const frame=pose(clip,times[i]);const e=frame.r.get(name)??[0,0,0],d=frame.p.get(name)??[0,0,0];
      if(e.some(v=>Math.abs(v)>1e-7))movingR=true;if(d.some(v=>Math.abs(v)>1e-7))movingT=true;
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...e,'XYZ')).toArray(rotations,4*i);
      for(let k=0;k<3;k++)translations[3*i+k]=base[k]+d[k];
    }
    for(const [pathName,type,data,moving] of [['rotation','VEC4',rotations,movingR],['translation','VEC3',translations,movingT]])if(moving){
      const input=doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer),output=doc.createAccessor().setType(type).setArray(data).setBuffer(buffer);
      const sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(name)).setTargetPath(pathName).setSampler(sampler));
    }
  }
}
const candidateBytes=await io.writeBinary(doc);await writeFile(candidateFile,candidateBytes);
const check=(await io.readBinary(candidateBytes)).getRoot(),out=check.listMeshes()[0].listPrimitives()[0];
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
for(const [name,arr] of [['POSITION',positions],['NORMAL',normals],['TEXCOORD_0',uvs]])if(!same(arr,out.getAttribute(name).getArray()))throw Error(name+' source data changed');
if(!same(indices,out.getIndices().getArray()))throw Error('Topology changed');
for(const t of check.listTextures())if(textureSha.get(t.getName())!==sha(t.getImage()))throw Error('PBR image changed: '+t.getName());
const outWeights=out.getAttribute('WEIGHTS_0').getArray(),outJoints=out.getAttribute('JOINTS_0').getArray();
let maxWeightError=0;for(let v=0;v<vertexCount;v++){let sum=0;for(let k=0;k<4;k++){const at=4*v+k,w=outWeights[at];if(w<0||!Number.isFinite(w)||outJoints[at]>=ordered.length)throw Error('Invalid skin weight');sum+=w;}maxWeightError=Math.max(maxWeightError,Math.abs(sum-1));}
if(maxWeightError>1e-5)throw Error('Skin weights not normalized');
const clipReport=check.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,seconds:clips.find(c=>c.name===a.getName()).seconds}));
if(clipReport.length!==6||clipReport.some(c=>c.channels<3))throw Error('Missing/inert clip');
const objects=new Map();
for(const [name,parent] of rig){const o=new THREE.Object3D();o.position.fromArray(locals.get(name));(parent?objects.get(parent):null)?.add(o);objects.set(name,o);}
const inverse=ordered.map(name=>globalMat.get(name).clone().invert());
const motionProof=[];
for(const clip of clips){
  const samples=[];
  for(const at of [0,.25,.5,.75,1]){
    const frame=pose(clip,at*clip.seconds);
    for(const name of ordered){const o=objects.get(name),base=locals.get(name),d=frame.p.get(name)??[0,0,0],e=frame.r.get(name)??[0,0,0];o.position.set(...base.map((x,k)=>x+d[k]));o.quaternion.setFromEuler(new THREE.Euler(...e,'XYZ'));}
    objects.get('StriderRoot').updateMatrixWorld(true);
    const matrices=ordered.map((name,i)=>objects.get(name).matrixWorld.clone().multiply(inverse[i]));
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let squared=0;
    for(let v=0;v<vertexCount;v++){
      const base=new THREE.Vector3(positions[3*v],positions[3*v+1],positions[3*v+2]),p=new THREE.Vector3();
      for(let k=0;k<4;k++){const w=outWeights[4*v+k];if(w)p.add(base.clone().applyMatrix4(matrices[outJoints[4*v+k]]).multiplyScalar(w));}
      const q=[p.x,p.y,p.z];if(q.some(x=>!Number.isFinite(x)))throw Error(`${clip.name} nonfinite pose`);
      for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],q[k]);hi[k]=Math.max(hi[k],q[k]);}
      squared+=p.distanceToSquared(base);
    }
    samples.push({at,min:lo,max:hi,rmsDisplacement:Math.sqrt(squared/vertexCount)});
  }
  const worstMinY=Math.min(...samples.map(s=>s.min[1])),maxRms=Math.max(...samples.map(s=>s.rmsDisplacement));
  if(worstMinY<-.18||samples.some(s=>s.max[1]>1.25)||(!['Idle'].includes(clip.name)&&maxRms<.005))throw Error(`${clip.name} escaped plausible geometry bounds or did not deform`);
  motionProof.push({name:clip.name,worstMinY,maxRms,samples});
}
const catalog={schema:'corealm-creature-candidate/1',id:'creature_reed_strider',displayName:'Reed Strider',status:'awaiting-root-visual-and-lab-review',acceptance:{geometryApproved:false,rigAccepted:false,motionAccepted:false,textureAccepted:false,promotable:false,labAccepted:false,worldIntegrated:false},mapping:{deliveredFilename:'stylized+spider+3d+model.glb',confirmedId:'creature_reed_strider',confirmedBy:'user',note:'Preserve supplied six-limb anatomy, including the raised grasping forelimbs; explicit user mapping governs the target ID.'},source:{file:'assets/art/tripo/imports/creatures/audit-user-reed-strider/sources/stylized-spider-user-original.glb',sha256:sourceSha,bytes:sourceBytes.length,vertices:vertexCount,triangles:triangleCount,bounds,pbrMapsPreserved:true},candidate:{file:path.basename(candidateFile),sha256:sha(candidateBytes),bytes:candidateBytes.length,vertices:vertexCount,triangles:triangleCount,joints:ordered,activeJointVertexCounts:Object.fromEntries(ordered.map((n,i)=>[n,coverage[i]])),maximumWeightSumError:maxWeightError,clips:clipReport,offlineMotionProof:motionProof,notes:['Original geometry, indices, UVs, normals, and detailed source PBR images preserved exactly.','Six-limb generic creature rig reconstructed from static source, with bilateral raised forelimbs, mid and hind walking limbs, mandibles, thorax, head and abdomen.','Offline rig and motion validation only; root owns normal-camera lab visual acceptance and promotion.']}};
await writeFile(path.join(here,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
const lab={schema:'corealm-lab-asset-candidates/1',assets:[{id:'creature_reed_strider',file:'models/creature/creature_reed_strider.glb',pack:'corealm-creature-expansion',category:'character',is:'Reed Strider',tags:['creature','insect','strider','reed','skinned','articulated'],bytes:candidateBytes.length,sha256:sha(candidateBytes),size:{x:bounds.max[0]-bounds.min[0],y:bounds.max[1]-bounds.min[1],z:bounds.max[2]-bounds.min[2]},base:{x:bounds.min[0],y:bounds.min[1],z:bounds.min[2]},bounds,groundY:0,triangles:triangleCount,animations:clips.map(c=>c.name),materials:[material.getName()],walkClipSeconds:1.12,runClipSeconds:.72,attackSeconds:.95,contactNormalized:.53,sourceProvenance:{author:'User-supplied Tripo model; Corealm candidate rig',source:'stylized+spider+3d+model.glb',sourceSha256:sourceSha}}]};
await writeFile(path.join(here,'lab-catalog.json'),JSON.stringify(lab,null,2)+'\n');
console.log(JSON.stringify({sourceSha,candidateSha:sha(candidateBytes),bytes:candidateBytes.length,vertices:vertexCount,triangles:triangleCount,joints:ordered.length,coverage:Object.fromEntries(ordered.map((n,i)=>[n,coverage[i]])),clips:clipReport,maxWeightError},null,2));
