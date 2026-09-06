import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Separate native-rig motion candidate. Never write the frozen geometry GLB.
const out=new URL('./',import.meta.url),io=new NodeIO();
const inputFile='Fox.completed-high.glb',outputFile='Fox.adaptive-actor.glb';
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
function bounds(){const matrices=new Map();for(const v of allVertices)for(const w of v.influences)if(!matrices.has(w.object))matrices.set(w.object,w.object.matrixWorld.clone().multiply(w.inverse).elements);let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],index=-1;for(let i=0;i<allVertices.length;i++){const v=allVertices[i],p=[0,0,0];for(const w of v.influences){const e=matrices.get(w.object);for(let k=0;k<3;k++)p[k]+=w.weight*(e[k]*v.p.x+e[k+4]*v.p.y+e[k+8]*v.p.z+e[k+12]);}for(let k=0;k<3;k++){if(p[k]<min[k]){min[k]=p[k];if(k===1)index=i;}max[k]=Math.max(max[k],p[k]);}}return {min,max,index};}
const started=performance.now(),run=nativeClips.find(c=>c.name==='Run'),times=run.channels[0].times,frames=[];
for(let i=0;i<times.length;i++){const frame=new Map(nodes.map(n=>[n,{p:rest.get(n).p.clone(),q:rest.get(n).q.clone()}]));for(const c of run.channels){const v=c.values.getElement(i,[]),f=frame.get(c.node);if(c.path==='rotation')f.q.fromArray(v);else if(c.path==='translation')f.p.fromArray(v);}frames.push(frame);}
const footVertices=allVertices.filter(v=>v.influences.reduce((n,w)=>n+(/Hand|Foot/.test(w.object.name)?w.weight:0),0)>=.5);
const skinMatrices=[...new Map(footVertices.flatMap(v=>v.influences.map(w=>[w.object,w]))).values()];
const matrixIndex=new Map(skinMatrices.map((w,i)=>[w.object,i]));
const feet=footVertices.map(v=>({p:v.p,weights:v.influences.map(w=>({index:matrixIndex.get(w.object),weight:w.weight}))}));
const positions=()=>{const matrices=skinMatrices.map(w=>w.object.matrixWorld.clone().multiply(w.inverse).elements),out=new Float64Array(feet.length*3);for(let i=0;i<feet.length;i++){const v=feet[i];for(const w of v.weights){const e=matrices[w.index];for(let k=0;k<3;k++)out[i*3+k]+=w.weight*(e[k]*v.p.x+e[k+4]*v.p.y+e[k+8]*v.p.z+e[k+12]);}}return out;};
const interpolate=(a,b,t)=>{for(const n of nodes){const o=objects.get(n);o.position.copy(frames[a].get(n).p).lerp(frames[b].get(n).p,t);o.quaternion.copy(frames[a].get(n).q).slerp(frames[b].get(n).q,t);}update();};
const fractions=[0,.015625,.0625,.125,.1875,.25,.333,.375,.5,.625,.667,.75,.8125,.875,.9375,.984375,1];let tested=0,worstAccepted=0;
function check(a,b){tested++;let old,oldTime;for(const fraction of fractions){interpolate(a,b,fraction);const points=positions(),time=times[a]+(times[b]-times[a])*fraction;for(let i=0;i<points.length;i+=3){if(points[i+1]<-.001)return false;if(old&&points[i+1]<=.0005&&old[i+1]<=.0005){const dt=time-oldTime,residual=Math.hypot((points[i]-old[i])/dt,(points[i+2]-old[i+2])/dt+1.8);if(residual>.0085)return false;}}old=points;oldTime=time;}return true;}
const keep=[0];let anchor=0;
while(anchor<times.length-1){let good=anchor+1,bad=null,stride=2;while(anchor+stride<times.length){if(check(anchor,anchor+stride)){good=anchor+stride;stride*=2;if(stride>256)break;}else{bad=anchor+stride;break;}}if(bad!==null){let lo=good+1,hi=bad-1;while(lo<=hi){const m=Math.floor((lo+hi)/2);if(check(anchor,m)){good=m;lo=m+1;}else hi=m-1;}}keep.push(good);anchor=good;}
const original=await io.readBinary(frozen),beforeAccessorBytes=rt.listAccessors().reduce((n,a)=>n+a.getArray().byteLength,0),beforeChannels=run.animation.listChannels();
const input=doc.createAccessor('Run_adaptive_times').setType('SCALAR').setArray(new Float32Array(keep.map(i=>times[i]))).setBuffer(buffer);
const oldAccessors=new Set();let channelRecords=[];
for(const c of beforeChannels){const sampler=c.getSampler(),oldIn=sampler.getInput(),oldOut=sampler.getOutput(),size=oldOut.getElementSize();oldAccessors.add(oldIn);oldAccessors.add(oldOut);let selected=keep;
 // Root tracks and independent head/neck/tail tracks do not move physical paws.
 const independent=/^(_rootJoint|b_Root_00|b_Head_|b_Neck_|b_Tail)/.test(c.getTargetNode().getName());
 if(independent){const reduced=[0];function split(a,b){let worst=0,index=-1;const va=oldOut.getElement(a,[]),vb=oldOut.getElement(b,[]);for(let i=a+1;i<b;i++){const t=(times[i]-times[a])/(times[b]-times[a]),v=oldOut.getElement(i,[]);let error;if(size===4){const q=new THREE.Quaternion(...va).slerp(new THREE.Quaternion(...vb),t).normalize();error=q.angleTo(new THREE.Quaternion(...v).normalize());}else error=Math.hypot(...v.map((x,k)=>x-THREE.MathUtils.lerp(va[k],vb[k],t)));if(error>worst){worst=error;index=i;}}if(worst>1e-5&&index>0){split(a,index);reduced.push(index);split(index,b);}}split(0,times.length-1);reduced.push(times.length-1);selected=[...new Set(reduced)].sort((a,b)=>a-b);}
 const ownInput=selected===keep?input:doc.createAccessor(c.getTargetNode().getName()+'_adaptive_times').setType('SCALAR').setArray(new Float32Array(selected.map(i=>times[i]))).setBuffer(buffer),output=doc.createAccessor(c.getTargetNode().getName()+'_adaptive_values').setType(oldOut.getType()).setArray(new Float32Array(selected.flatMap(i=>oldOut.getElement(i,[])))).setBuffer(buffer);
 sampler.setInput(ownInput).setOutput(output);channelRecords.push({node:c.getTargetNode().getName(),path:c.getTargetPath(),before:times.length,after:selected.length});
}
for(const a of oldAccessors)if(a.listParents().every(p=>p===rt))a.dispose();
const bytes=Buffer.from(await io.writeBinary(doc));await writeFile(new URL(outputFile,out),bytes);
const serialized=await io.readBinary(bytes),animation=serialized.getRoot().listAnimations().find(a=>a.getName()==='Run'),adapted={duration:run.duration,channels:animation.listChannels().map(c=>({node:nodes.find(n=>n.getName()===c.getTargetNode().getName()),path:c.getTargetPath(),times:Array.from(c.getSampler().getInput().getArray()),values:c.getSampler().getOutput()}))};
const report={sourceSha256:frozenHash,candidateSha256:hash(bytes),method:'Synchronized adaptive limb intervals tested against actual same-vertex ground residual8.5mm/s, leaving margin to the unchanged12mm/s limit. Independent head/neck/tail tracks reduced to1e-5rad interpolation error.',originalTimes:times.length,retainedLimbTimes:keep.length,segmentTests:tested,channelRecords,bytes:{before:frozen.length,after:bytes.length},accessorBytes:{before:beforeAccessorBytes,after:serialized.getRoot().listAccessors().reduce((n,a)=>n+a.getArray().byteLength,0)},hardwareAccepted:false};
let randomState=0x5f3759df;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
const validationTimes=[...new Set(keep.slice(0,-1).flatMap((a,k)=>{const b=keep[k+1];return [0,.013,.079,.211,.371,.5,.619,.787,.923,.989,1,...Array.from({length:6},()=>.02+.96*random())].map(f=>times[a]+(times[b]-times[a])*f);}))].sort((a,b)=>a-b);
let residualSquaredSum=0,residualCount=0,maxAdjacentResidualVelocityJump=0;const previousResidual=new Float64Array(feet.length*2).fill(NaN);
let min=Infinity,residualMax=0,worstResidual=null,pointVelocityMax=0,boneAngularVelocityMax=0,old,oldTime,oldQuats;
for(const time of validationTimes){nativePose(adapted,time);const points=positions(),box=bounds();min=Math.min(min,box.min[1]);const qs=joints.map(j=>objects.get(j).getWorldQuaternion(qtr()));if(old){const dt=time-oldTime;for(let i=0;i<points.length;i+=3){const speed=Math.hypot((points[i]-old[i])/dt,(points[i+1]-old[i+1])/dt,(points[i+2]-old[i+2])/dt);pointVelocityMax=Math.max(pointVelocityMax,speed);if(points[i+1]<=.0005&&old[i+1]<=.0005){const rx=(points[i]-old[i])/dt,rz=(points[i+2]-old[i+2])/dt+1.8,residual=Math.hypot(rx,rz),ri=i/3*2;residualSquaredSum+=residual*residual;residualCount++;if(Number.isFinite(previousResidual[ri]))maxAdjacentResidualVelocityJump=Math.max(maxAdjacentResidualVelocityJump,Math.hypot(rx-previousResidual[ri],rz-previousResidual[ri+1]));previousResidual[ri]=rx;previousResidual[ri+1]=rz;if(residual>residualMax){residualMax=residual;worstResidual={time,previousTime:oldTime,dt,footVertex:i/3,y:points[i+1],previousY:old[i+1],bones:footVertices[i/3].influences.map(w=>({name:w.object.name,weight:w.weight}))};}}}for(let i=0;i<qs.length;i++)boneAngularVelocityMax=Math.max(boneAngularVelocityMax,qs[i].normalize().angleTo(oldQuats[i].normalize())/dt);}old=points;oldTime=time;oldQuats=qs;}
report.validation={contactResidualRmsMps:Math.sqrt(residualSquaredSum/residualCount),contactVertexIntervals:residualCount,maxSuccessiveContactObservationVelocityJumpMps:maxAdjacentResidualVelocityJump,randomSeed:0x5f3759df,randomSamplesPerInterval:6,worstResidual,samples:validationTimes.length,wholeMeshMinimumY:min,sameVertexContactResidualMaxMps:residualMax,allPawPointVelocityMaxMps:pointVelocityMax,boneAngularVelocityMaxRadiansPerSecond:boneAngularVelocityMax,contactVelocity12mmPassed:residualMax<=.012,contact1mmPassed:min>=-.001};report.cpuSeconds=(performance.now()-started)/1000;
const animationHash=a=>hash(JSON.stringify(a.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath(),Array.from(c.getSampler().getInput().getArray()),Array.from(c.getSampler().getOutput().getArray())])));report.nonRunClipsPreserved=original.getRoot().listAnimations().filter(a=>a.getName()!=='Run').every(a=>animationHash(a)===animationHash(serialized.getRoot().listAnimations().find(b=>b.getName()===a.getName())));
await writeFile(new URL('adaptive-actor-review.json',out),JSON.stringify(report,null,2)+'\n');const catalogue=JSON.parse(await readFile(new URL('completed-high-catalogue.json',out),'utf8'));catalogue.files.creature_redbrush_fox=outputFile;catalogue.assets[0].sha256=hash(bytes);catalogue.assets[0].bytes=bytes.length;catalogue.assets[0].motionReview.candidateFile=outputFile;catalogue.assets[0].motionReview.report='adaptive-actor-review.json';catalogue.assets[0].clipDurations=Object.fromEntries(serialized.getRoot().listAnimations().map(a=>[a.getName(),Math.max(...a.listSamplers().flatMap(s=>Array.from(s.getInput().getArray())))]));catalogue.assets[0].runClipSeconds=catalogue.assets[0].clipDurations.Run;catalogue.assets[0].walkClipSeconds=catalogue.assets[0].clipDurations.Walk;await writeFile(new URL('adaptive-actor-catalogue.json',out),JSON.stringify(catalogue,null,2)+'\n');console.log(JSON.stringify(report));

