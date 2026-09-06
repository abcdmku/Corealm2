import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Separate native-rig motion candidate. Never write the frozen geometry GLB.
const out=new URL('./',import.meta.url),io=new NodeIO();
const inputFile='Fox.contact-dense.glb',outputFile='Fox.gameplay-draft.glb';
const frozen=await readFile(new URL(inputFile,out)),doc=await io.readBinary(frozen),rt=doc.getRoot(),buffer=rt.listBuffers()[0];
const hash=b=>createHash('sha256').update(b).digest('hex');
const frozenHash=hash(frozen),nodes=rt.listNodes(),joints=rt.listSkins()[0].listJoints();
const objects=new Map(nodes.map(n=>[n,new THREE.Object3D()])),rest=new Map();
for(const n of nodes){const o=objects.get(n);o.name=n.getName();o.position.fromArray(n.getTranslation());o.quaternion.fromArray(n.getRotation());o.scale.fromArray(n.getScale());rest.set(n,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});if(n.getParentNode())objects.get(n.getParentNode()).add(o);}
const tops=nodes.filter(n=>!n.getParentNode()).map(n=>objects.get(n)),update=()=>tops.forEach(o=>o.updateMatrixWorld(true));update();
const byName=name=>objects.get(nodes.find(n=>n.getName()===name));
const vec=()=>new THREE.Vector3(),qtr=()=>new THREE.Quaternion(),frac=t=>t-Math.floor(t),clamp=THREE.MathUtils.clamp;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const footDefs=[
  {id:'foreRight',names:['b_RightUpperArm_06','b_RightForeArm_07','b_RightHand_08'],region:['b_RightHand_08']},
  {id:'foreLeft',names:['b_LeftUpperArm_09','b_LeftForeArm_010','b_LeftHand_011'],region:['b_LeftHand_011']},
  {id:'hindLeft',names:['b_LeftLeg01_015','b_LeftLeg02_016','b_LeftFoot01_017','b_LeftFoot02_018'],region:['b_LeftFoot01_017','b_LeftFoot02_018']},
  {id:'hindRight',names:['b_RightLeg01_019','b_RightLeg02_020','b_RightFoot01_021','b_RightFoot02_022'],region:['b_RightFoot01_021','b_RightFoot02_022']},
];
const allVertices=[];
for(const node of nodes)for(const p of node.getMesh()?.listPrimitives()??[]){const skin=node.getSkin();const matrices=skin.listJoints().map((j,i)=>({object:objects.get(j),inverse:new THREE.Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i,[]))}));const pos=p.getAttribute('POSITION'),si=p.getAttribute('JOINTS_0'),sw=p.getAttribute('WEIGHTS_0');for(let i=0;i<pos.getCount();i++)allVertices.push({p:new THREE.Vector3(...pos.getElement(i,[])),influences:si.getElement(i,[]).map((joint,k)=>({...matrices[joint],weight:sw.getElement(i,[])[k]})).filter(w=>w.weight>0)});}
const skinVertex=v=>{const p=vec();for(const w of v.influences)p.addScaledVector(v.p.clone().applyMatrix4(w.object.matrixWorld.clone().multiply(w.inverse)),w.weight);return p;};
for(const f of footDefs){
  f.chain=f.names.map(byName);f.pole=f.chain[1].getWorldPosition(vec()).sub(f.chain[0].getWorldPosition(vec()));f.end=f.chain.at(-1);f.bindQ=f.end.getWorldQuaternion(qtr());
  if(f.chain.length===4){f.hock=f.chain[2];f.hockQ=f.hock.getWorldQuaternion(qtr());f.lastSegment=f.end.getWorldPosition(vec()).sub(f.hock.getWorldPosition(vec()));}
  const candidates=allVertices.filter(v=>v.influences.reduce((n,w)=>n+(f.region.includes(w.object.name)?w.weight:0),0)>=.5);
  const low=Math.min(...candidates.map(v=>skinVertex(v).y));f.sole=candidates.filter(v=>skinVertex(v).y<low+.018);
  const points=f.sole.map(skinVertex),centroid=points.reduce((a,p)=>a.add(p),vec()).multiplyScalar(1/points.length);
  const footPos=f.end.getWorldPosition(vec());f.bindOffset=centroid.clone().sub(footPos);f.bindSoleY=low-footPos.y;
  f.centre=centroid;f.length=f.chain.slice(1).reduce((sum,o,i)=>sum+o.getWorldPosition(vec()).distanceTo(f.chain[i].getWorldPosition(vec())),0);
}
const nativeClips=rt.listAnimations().map(a=>({animation:a,name:a.getName(),duration:Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),channels:a.listChannels().map(c=>({node:c.getTargetNode(),path:c.getTargetPath(),times:Array.from(c.getSampler().getInput().getArray()),values:c.getSampler().getOutput()}))}));
function nativePose(clip,time){
  if(clip?.nativeDuration)time*=clip.nativeDuration/clip.duration;
  for(const [n,t]of rest){const o=objects.get(n);o.position.copy(t.p);o.quaternion.copy(t.q);o.scale.copy(t.s);}
  if(clip)for(const c of clip.channels){let i=0;while(i<c.times.length-2&&c.times[i+1]<time)i++;const t=clamp((time-c.times[i])/(c.times[i+1]-c.times[i]||1),0,1),a=c.values.getElement(i,[]),b=c.values.getElement(i+1,[]),o=objects.get(c.node);if(c.path==='rotation')o.quaternion.fromArray(a).slerp(qtr().fromArray(b),t);else if(c.path==='translation')o.position.fromArray(a.map((n,k)=>THREE.MathUtils.lerp(n,b[k],t)));else if(c.path==='scale')o.scale.fromArray(a.map((n,k)=>THREE.MathUtils.lerp(n,b[k],t)));}
  update();
}
function measureFoot(f){const points=f.sole.map(skinVertex);return {minY:Math.min(...points.map(p=>p.y)),centroid:points.reduce((a,p)=>a.add(p),vec()).multiplyScalar(1/points.length)};}
function setWorldQ(o,q){o.quaternion.copy(o.parent.getWorldQuaternion(qtr()).invert()).multiply(q);o.updateMatrixWorld(true);}
function solve(f,target,orientation){
  // Native chain lengths and parent transforms stay intact. Cyclic-coordinate
  // rotations start from each frame's native pose rather than a replacement rig.
  let segment=f.lastSegment;
  if(f.hock){const direction=target.clone().sub(f.chain[0].getWorldPosition(vec())).add(new THREE.Vector3(0,-.03,.05)).normalize();segment=direction.multiplyScalar(f.lastSegment.length());}
  const chain=f.hock?f.chain.slice(0,3):f.chain,end=f.hock??f.end,goal=f.hock?target.clone().sub(segment):target;
  const root=chain[0],middle=chain[1],origin=root.getWorldPosition(vec());
  const l1=middle.getWorldPosition(vec()).distanceTo(origin),l2=end.getWorldPosition(vec()).distanceTo(middle.getWorldPosition(vec()));
  const direction=goal.clone().sub(origin),distance=clamp(direction.length(),Math.abs(l1-l2)+1e-7,l1+l2-1e-7);direction.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const pole=new THREE.Vector3(0,0,f.id.startsWith('fore')?-1:1);pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const knee=origin.clone().addScaledVector(direction,along).addScaledVector(pole,height);
  let delta=qtr().setFromUnitVectors(middle.getWorldPosition(vec()).sub(origin).normalize(),knee.sub(origin).normalize());
  setWorldQ(root,delta.multiply(root.getWorldQuaternion(qtr())));
  const pivot=middle.getWorldPosition(vec());delta=qtr().setFromUnitVectors(end.getWorldPosition(vec()).sub(pivot).normalize(),goal.clone().sub(pivot).normalize());
  setWorldQ(middle,delta.multiply(middle.getWorldQuaternion(qtr())));
  if(f.hock)setWorldQ(f.hock,qtr().setFromUnitVectors(f.lastSegment.clone().normalize(),segment.clone().normalize()).multiply(f.hockQ));
  setWorldQ(f.end,orientation);
  return f.end.getWorldPosition(vec()).distanceTo(target);
}
for(const f of footDefs)f.contactVertices=allVertices.filter(v=>v.influences.reduce((sum,w)=>sum+(f.region.includes(w.object.name)?w.weight:0),0)>=.5);
const previousReport=JSON.parse(await readFile(new URL('contact-dense-review.json',out),'utf8')),evidence=[];
for(const name of ['Walk','Run']){const clip=nativeClips.find(c=>c.name===name),config=previousReport.configs.find(c=>c.clip===name),steps=previousReport.serializedAudit.find(c=>c.clip===name).samples-1,stats=new Map(footDefs.map(f=>[f.id,{maxContactVertexResidualMps:0,contactVertexIntervals:0,maxActualXZVelocityMps:0,minRearwardVelocityMps:Infinity,maxRearwardVelocityMps:-Infinity,maxWorldResidualVelocityMps:0}])),last=new Map();
 for(let i=0;i<=steps;i++){const t=i*clip.duration/steps;nativePose(clip,t);for(let fi=0;fi<footDefs.length;fi++){const f=footDefs[fi],c=config.feet[fi],u=frac(t/clip.duration-c.start),stance=u<c.duty,physical=measureFoot(f),p=physical.centroid,old=last.get(f.id),points=f.contactVertices.map(skinVertex);if(old){const dt=t-old.t,stat=stats.get(f.id);for(let vi=0;vi<points.length;vi++){const a=points[vi],b=old.points[vi];if(a.y<=.0005&&b.y<=.0005){stat.contactVertexIntervals++;stat.maxContactVertexResidualMps=Math.max(stat.maxContactVertexResidualMps,Math.hypot((a.x-b.x)/dt,(a.z-b.z)/dt+config.targetTravelMps));}}}if(physical.minY<=.0005&&old?.minY<=.0005){const dt=t-old.t,vx=(p.x-old.p.x)/dt,vz=(p.z-old.p.z)/dt,s=stats.get(f.id);s.maxActualXZVelocityMps=Math.max(s.maxActualXZVelocityMps,Math.hypot(vx,vz));s.minRearwardVelocityMps=Math.min(s.minRearwardVelocityMps,-vz);s.maxRearwardVelocityMps=Math.max(s.maxRearwardVelocityMps,-vz);s.maxWorldResidualVelocityMps=Math.max(s.maxWorldResidualVelocityMps,Math.hypot(vx,vz+config.targetTravelMps));}last.set(f.id,{p,t,u,stance,minY:physical.minY,points});}}
 evidence.push({clip:name,duration:clip.duration,samples:steps+1,feet:Object.fromEntries(stats)});
}
await writeFile(new URL('contact-dense-velocity-review.json',out),JSON.stringify({sourceSha256:frozenHash,basis:'Physical sole centroid differences at every quarter key; adjacent samples both physical sole minima <= floor+0.5mm, without stance-label filtering',evidence},null,2)+'\n');console.log(JSON.stringify(evidence));
