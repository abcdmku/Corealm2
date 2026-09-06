/** Per-foot contact audit of frozen normalized candidate bytes. CPU only. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Quaternion} from 'three';
const dir=new URL('./',import.meta.url),file=process.argv[2]||'cdmir-porcupine-normalized.glb';
const bytes=await readFile(new URL(file,dir)),doc=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes),root=doc.getRoot();
const mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8'));
const catalogue=JSON.parse(await readFile(new URL('porcupine-candidate-catalogue.json',dir),'utf8'));
const source=mapping.objects.Body,footNames=['FrontLeg_L','FrontLeg_R','BackLeg_L','BackLeg_R'];
const initial=new Map(root.listNodes().map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
function reset(){for(const[n,v]of initial)n.setTranslation(v.t).setRotation(v.r).setScale(v.s);}
function pose(animation,time){reset();for(const channel of animation.listChannels()){
 const sampler=channel.getSampler(),input=sampler.getInput(),output=sampler.getOutput();let lo=0,hi=input.getCount()-1;
 while(lo<hi){const m=Math.ceil((lo+hi)/2);if(input.getScalar(m)<=time)lo=m;else hi=m-1;}
 const next=Math.min(lo+1,input.getCount()-1),a=[],b=[];output.getElement(lo,a);output.getElement(next,b);const dt=input.getScalar(next)-input.getScalar(lo),u=dt?Math.max(0,Math.min(1,(time-input.getScalar(lo))/dt)):0;
 const node=channel.getTargetNode(),path=channel.getTargetPath();if(path==='rotation')node.setRotation(new Quaternion(...a).slerp(new Quaternion(...b),u).toArray());else{const v=a.map((x,k)=>x+(b[k]-x)*u);if(path==='translation')node.setTranslation(v);else if(path==='scale')node.setScale(v);}
}}
const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor((a.length-1)*q))];};
const median=a=>quantile(a,.5);
const feet={};
for(const name of footNames){
 const ids=[];
 source.originalVertexWeights.forEach((w,i)=>{const total=w.reduce((s,[,v])=>s+v,0),distal=w.filter(([bn])=>bn===name+'.002'||bn===name+'.003').reduce((s,[,v])=>s+v,0)/total;if(distal>=.6)ids.push(i);});
 const height=quantile(ids.map(i=>source.sourceWorldPositions[i][2]),.30);
 const sole=ids.filter(i=>source.sourceWorldPositions[i][2]<=height);
 feet[name]={distalSourceVertices:ids,soleSourceVertices:sole,restSoleCutoffSourceZ:height};
}
const body=root.listNodes().find(n=>n.getName()==='Body'),skin=body.getSkin(),joints=skin.listJoints();
const inv=joints.map((_,i)=>{const a=[];skin.getInverseBindMatrices().getElement(i,a);return new Matrix4().fromArray(a);});
const bodyVertices=new Map();
for(const p of body.getMesh().listPrimitives()){
 const sourceIds=p.getExtras().sourceVertexIndices;if(!sourceIds)continue;
 const pos=p.getAttribute('POSITION'),js=p.getAttribute('JOINTS_0'),ws=p.getAttribute('WEIGHTS_0');
 sourceIds.forEach((id,i)=>{if(bodyVertices.has(id))return;const v=[],j=[],w=[];pos.getElement(i,v);js.getElement(i,j);ws.getElement(i,w);bodyVertices.set(id,{p:new Vector3(...v),j,w});});
}
function positions(){const matrices=joints.map((j,i)=>new Matrix4().fromArray(j.getWorldMatrix()).multiply(inv[i])),result=new Map();for(const[id,v]of bodyVertices){const p=new Vector3();for(let k=0;k<4;k++)if(v.w[k])p.addScaledVector(v.p.clone().applyMatrix4(matrices[v.j[k]]),v.w[k]);result.set(id,p);}return result;}
function jointPosition(name){return new Vector3().setFromMatrixPosition(new Matrix4().fromArray(root.listNodes().find(n=>n.getName()===name).getWorldMatrix())).toArray();}
const clips=[];
for(const name of ['Walk','Run']){
 const animation=root.listAnimations().find(a=>a.getName()===name);if(!animation)throw Error('Missing native '+name);
 const duration=Math.max(...animation.listSamplers().map(s=>s.getInput().getScalar(s.getInput().getCount()-1))),count=240,dt=duration/count;
 const samples=[];
 for(let i=0;i<=count;i++){
  const time=i*dt;pose(animation,time);const points=positions(),foot={};
  for(const[n,s]of Object.entries(feet)){
   const p=s.soleSourceVertices.map(id=>points.get(id)),all=s.distalSourceVertices.map(id=>points.get(id));const centre=p.reduce((v,p)=>v.add(p),new Vector3()).multiplyScalar(1/p.length);
   const minIndex=all.reduce((best,p,i)=>p.y<all[best].y?i:best,0);
   foot[n]={centre:centre.toArray(),minSoleY:Math.min(...p.map(p=>p.y)),maxSoleY:Math.max(...p.map(p=>p.y)),minDistalY:Math.min(...all.map(p=>p.y)),lowestSourceVertex:s.distalSourceVertices[minIndex],ankle:jointPosition(n+'.002'),toePivot:jointPosition(n+'.003'),sole:p.map(p=>p.toArray())};
  }
  samples.push({time,hip:jointPosition('Hip'),root:root.listScenes()[0].listChildren()[0].getTranslation(),feet:foot});
 }
 for(let i=0;i<samples.length;i++)for(const n of footNames){
  const a=samples[Math.max(0,i-1)].feet[n].centre,b=samples[Math.min(count,i+1)].feet[n].centre,span=(Math.min(count,i+1)-Math.max(0,i-1))*dt;
  samples[i].feet[n].velocity=a.map((v,k)=>(b[k]-v)/span);
 }
 // Height candidates and backward sweep estimate the actor speed needed for
 // an in-place stance. This is a diagnosis, not an imposed game speed.
 const speedCandidates=[];
 for(const n of footNames){const heights=samples.map(s=>s.feet[n].minDistalY),gate=Math.min(.018,quantile(heights,.45)+.004);feet[n].heightGateMeters=gate;
  for(const s of samples){const f=s.feet[n];if(f.minDistalY<=gate&&f.velocity[2]<-.005&&Math.abs(f.velocity[1])<.15)speedCandidates.push(-f.velocity[2]);}
 }
 const speed=median(speedCandidates),perFoot={};
 for(const n of footNames){
  const phases=samples.map(s=>{const f=s.feet[n];return f.minDistalY<=feet[n].heightGateMeters&&f.velocity[2]<-.005&&Math.abs(f.velocity[1])<.15;});
  const ranges=[];let begin=null;
  for(let i=0;i<phases.length;i++){if(phases[i]&&begin===null)begin=i;if(begin!==null&&(!phases[i]||i===phases.length-1)){const end=phases[i]?i:i-1;if(end-begin>=3)ranges.push([begin,end]);begin=null;}}
  const phaseReports=ranges.map(([a,b])=>{const subset=samples.slice(a,b+1),first=subset[0].feet[n].centre;const speedFit=-median(subset.map(s=>s.feet[n].velocity[2]));
   const points=subset.map(s=>{const p=s.feet[n].centre;return[p[0]-first[0],p[1]-first[1],p[2]-first[2]+speed*(s.time-subset[0].time)];});
   const horizontal=points.map(p=>Math.hypot(p[0],p[2]));return{startTime:subset[0].time,endTime:subset.at(-1).time,phase:[a/count,b/count],sampleCount:subset.length,inferredActorSpeedMps:speedFit,soleMinY:Math.min(...subset.map(s=>s.feet[n].minSoleY)),distalMinY:Math.min(...subset.map(s=>s.feet[n].minDistalY)),stanceDriftAtGlobalFittedSpeedMeters:Math.max(...horizontal),lateralRangeMeters:Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),heightRangeMeters:Math.max(...subset.map(s=>s.feet[n].minSoleY))-Math.min(...subset.map(s=>s.feet[n].minSoleY))};});
  perFoot[n]={distalVertexCount:feet[n].distalSourceVertices.length,soleVertexCount:feet[n].soleSourceVertices.length,heightGateMeters:feet[n].heightGateMeters,minSoleY:Math.min(...samples.map(s=>s.feet[n].minSoleY)),minDistalY:Math.min(...samples.map(s=>s.feet[n].minDistalY)),peakSwingSoleHeight:Math.max(...samples.map(s=>s.feet[n].minSoleY)),candidateStanceFraction:phases.filter(Boolean).length/phases.length,stanceIntervals:phaseReports};
  const worst=samples.reduce((a,s)=>s.feet[n].minDistalY<a.feet[n].minDistalY?s:a),v=worst.feet[n].lowestSourceVertex;
  const last=samples.at(-1).feet[n],first=samples[0].feet[n];
  perFoot[n].loopSeam={centroidDelta:last.centre.map((x,k)=>x-first.centre[k]),maximumSameSoleVertexDeltaMeters:Math.max(...last.sole.map((p,i)=>Math.hypot(...p.map((x,k)=>x-first.sole[i][k]))))};
  perFoot[n].deepestPenetration={time:worst.time,phase:worst.time/duration,sourceVertex:v,sourceWeights:source.originalVertexWeights[v],ankle:worst.feet[n].ankle,toePivot:worst.feet[n].toePivot,soleMinY:worst.feet[n].minSoleY,centroidVelocity:worst.feet[n].velocity};
 }
 const hipDelta=samples.at(-1).hip.map((v,k)=>v-samples[0].hip[k]);
 clips.push({name,duration,sampleCount:samples.length,dt,allFeetClearFraction:samples.filter(s=>footNames.every(n=>s.feet[n].minDistalY>.005)).length/samples.length,rootMotion:{rootNodeDelta:samples.at(-1).root.map((v,k)=>v-samples[0].root[k]),hipCycleDelta:hipDelta,hipBounds:[0,1,2].map(k=>[Math.min(...samples.map(s=>s.hip[k])),Math.max(...samples.map(s=>s.hip[k]))])},inferredConstantActorSpeedMps:speed,perFoot,samples});
 console.log(JSON.stringify({name,speed,hipDelta,perFoot}));
}
const report={file,sha256:createHash('sha256').update(bytes).digest('hex'),normalization:catalogue.previewTransform,units:'Meters in frozen normalized GLB world coordinates; Y up and nose +Z.',method:{vertices:'Original Body vertices with at least .60 normalized original distal .002/.003 bone weight. Sole is lowest 30 percent by original rest source Z; distal min is also reported to catch ankle/paw edges.',sampling:'241 equally spaced samples per original native clip, including endpoints. Every point uses final frozen GLB positions, weights, inverse binds and interpolated channels.',stance:'Candidate stance requires distal min below min(18 mm, 45th-percentile clip foot height + 4 mm), negative local forward velocity below -5 mm/s, and absolute vertical centroid velocity below .15 m/s. Runs of fewer than four samples excluded from interval reports. Classification is provisional and explicitly not a contact label authored into the source.',drift:'Fit one diagnostic actor speed from the median backward foot sweep during height/velocity candidate stance. Report per-foot speed disagreement and horizontal drift after applying only that mathematical world-speed baseline. No animation or root motion modified.'},feet,clips,limits:['No correction candidate produced. Frozen input bytes are unchanged.','In-place source clips require an actor traversal speed before absolute world stance drift can be accepted. The fitted speed is a diagnostic estimate, not a controller change.','Contact classification uses foot geometry and velocity, not whole-body minimum. Genuine flight and swing remain observable in raw samples.','No GPU or visual gait acceptance.']};
await writeFile(new URL(process.argv[3]||'contact-audit.json',dir),JSON.stringify(report,null,2)+'\n');
