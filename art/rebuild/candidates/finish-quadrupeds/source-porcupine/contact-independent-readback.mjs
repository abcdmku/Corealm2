/** Independent read-only audit of exported bytes. No solver contact labels used. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Quaternion} from 'three';
const directory=new URL('./',import.meta.url),file=process.argv[2]||'cdmir-porcupine-normalized.glb',tag=process.argv[3]||'baseline';
const bytes=await readFile(new URL(file,directory)),doc=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes),root=doc.getRoot(),mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',directory),'utf8'));
const footNames=['FrontLeg_L','FrontLeg_R','BackLeg_L','BackLeg_R'];
const initial=new Map(root.listNodes().map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
function reset(){for(const [n,v] of initial)n.setTranslation(v.t).setRotation(v.r).setScale(v.s);}
function pose(animation,time){reset();for(const c of animation.listChannels()){
 const s=c.getSampler(),input=s.getInput(),out=s.getOutput();let lo=0,hi=input.getCount()-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(input.getScalar(m)<=time)lo=m;else hi=m-1;}
 const next=Math.min(lo+1,input.getCount()-1),a=[],b=[];out.getElement(lo,a);out.getElement(next,b);const dt=input.getScalar(next)-input.getScalar(lo),t=dt>0?Math.max(0,Math.min(1,(time-input.getScalar(lo))/dt)):0,n=c.getTargetNode(),path=c.getTargetPath();if(s.getInterpolation()!=='LINEAR')throw Error('Nonlinear exported sampler unsupported by this checker');
 if(path==='rotation')n.setRotation(new Quaternion(...a).slerp(new Quaternion(...b),t).toArray());else if(path==='translation')n.setTranslation(a.map((v,k)=>v+(b[k]-v)*t));else if(path==='scale')n.setScale(a.map((v,k)=>v+(b[k]-v)*t));
 }}
const meshes=root.listNodes().filter(n=>n.getMesh()).map(node=>({node,skin:node.getSkin(),primitives:node.getMesh().listPrimitives().map(p=>{
 const pos=p.getAttribute('POSITION'),j=p.getAttribute('JOINTS_0'),w=p.getAttribute('WEIGHTS_0'),source=p.getExtras().sourceVertexIndices;const vertices=[];
 for(let i=0;i<pos.getCount();i++){const a=[],js=[],ws=[];pos.getElement(i,a);j?.getElement(i,js);w?.getElement(i,ws);let foot=null;if(node.getName()==='Body'&&source){const raw=mapping.objects.Body.originalVertexWeights[source[i]],sum=raw.reduce((s,[,v])=>s+v,0);for(const f of footNames)if(raw.filter(([n])=>n===f+'.002'||n===f+'.003').reduce((s,[,v])=>s+v,0)/sum>=.6)foot=f;}vertices.push({a,js,ws,foot,original:!!source,source:source?.[i]});}
 return {vertices};
})}));
function frame(){let minY=Infinity,originalMinY=Infinity,index=0;const points=[],feet=Object.fromEntries(footNames.map(f=>[f,Infinity]));
 for(const m of meshes){const matrices=m.skin?.listJoints().map((j,i)=>{const b=[];m.skin.getInverseBindMatrices().getElement(i,b);return new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(b));});for(const p of m.primitives)for(const v of p.vertices){const q=new Vector3();if(m.skin){for(let k=0;k<4;k++)if(v.ws[k])q.addScaledVector(new Vector3(...v.a).applyMatrix4(matrices[v.js[k]]),v.ws[k]);}else q.fromArray(v.a).applyMatrix4(new Matrix4().fromArray(m.node.getWorldMatrix()));if(!q.toArray().every(Number.isFinite))throw Error('Nonfinite exported vertex');minY=Math.min(minY,q.y);if(v.original){originalMinY=Math.min(originalMinY,q.y);points.push({index:index++,p:q,foot:v.foot,source:v.source});}if(v.foot)feet[v.foot]=Math.min(feet[v.foot],q.y);}}
 return {points,minY,originalMinY,feet,hip:new Vector3().setFromMatrixPosition(new Matrix4().fromArray(root.listNodes().find(n=>n.getName()==='Hip').getWorldMatrix())).toArray()};
}
const clips=[];
for(const name of ['Walk','Run']){
 const animation=root.listAnimations().find(a=>a.getName()===name),speed=name==='Walk'?.32:1,keys=new Set([0]);for(const s of animation.listSamplers())for(const t of s.getInput().getArray())keys.add(t);
 const sorted=[...keys].sort((a,b)=>a-b),duration=sorted.at(-1),times=new Set(sorted);for(let i=1;i<sorted.length;i++)for(const f of [.25,.5,.75])times.add(sorted[i-1]+(sorted[i]-sorted[i-1])*f);for(let i=0;i<=Math.ceil(duration*480);i++)times.add(duration*i/Math.ceil(duration*480));
 const samples=[...times].sort((a,b)=>a-b).filter((t,i,a)=>i===0||t-a[i-1]>1e-7);let previous=null,first=null,maxBurial=0,maxOriginalBurial=0,maxSlip=0,slipWitness=null,maxVertexSpeed=0,vertexSpeedWitness=null,flightSamples=0,flightDuration=0;
 const feet=Object.fromEntries(footNames.map(f=>[f,{groundedIntervals:0,groundedDuration:0,maxSlipMps:0,minimumY:Infinity}]));
 for(const t of samples){pose(animation,t);const current=frame();if(!first)first=current;maxBurial=Math.max(maxBurial,-current.minY);maxOriginalBurial=Math.max(maxOriginalBurial,-current.originalMinY);const flight=footNames.every(f=>current.feet[f]>.005);if(flight)flightSamples++;
 for(const f of footNames)feet[f].minimumY=Math.min(feet[f].minimumY,current.feet[f]);
 if(previous){const dt=t-previous.time,grounded=new Set();if(dt>1e-6){if(flight&&previous.flight)flightDuration+=dt;for(let i=0;i<current.points.length;i++){const a=previous.frame.points[i],b=current.points[i];const rawSpeed=b.p.distanceTo(a.p)/dt;if(rawSpeed>maxVertexSpeed){maxVertexSpeed=rawSpeed;vertexSpeedWitness={time:t,dt,sourceVertex:b.source,foot:b.foot,from:a.p.toArray(),to:b.p.toArray()};}if(a.p.y<=.000501&&b.p.y<=.000501){const vx=(b.p.x-a.p.x)/dt,vy=(b.p.y-a.p.y)/dt,vz=(b.p.z-a.p.z)/dt+speed,slip=Math.hypot(vx,vy,vz);if(slip>maxSlip){maxSlip=slip;slipWitness={time:t,dt,sourceVertex:b.source,foot:b.foot,vx,vy,vz,y:[a.p.y,b.p.y]};}if(b.foot){grounded.add(b.foot);if(slip>feet[b.foot].maxSlipMps)feet[b.foot].velocityWitness={time:t,dt,sourceVertex:b.source,vx,vy,vz,y:[a.p.y,b.p.y]};feet[b.foot].maxSlipMps=Math.max(feet[b.foot].maxSlipMps,slip);}}}for(const f of grounded){feet[f].groundedIntervals++;feet[f].groundedDuration+=dt;}}}
 previous={time:t,frame:current,flight};
 }
 const last=previous.frame;clips.push({name,duration,authoredComparisonSpeedMps:speed,samples:samples.length,maximumWholeMeshBurialMeters:maxBurial,maximumOriginalMeshBurialMeters:maxOriginalBurial,maxSameVertexGroundVelocityMps:maxSlip,slipWitness,maximumOriginalVertexSpeedMps:maxVertexSpeed,vertexSpeedWitness,allFeetClearSampleFraction:flightSamples/samples.length,allFeetClearTimeFraction:flightDuration/duration,perFoot:feet,hipLoopDelta:last.hip.map((v,k)=>v-first.hip[k]),maximumOriginalVertexLoopDeltaMeters:Math.max(...last.points.map((p,i)=>p.p.distanceTo(first.points[i].p)))});console.log(JSON.stringify(clips.at(-1)));
}
const report={file,sha256:createHash('sha256').update(bytes).digest('hex'),method:'Actual byte readback with keys, quarter/midpoints and >=480 Hz samples. Skin uses exactly JOINTS_0/WEIGHTS_0 and inverse binds. Same original vertex <= floor+0.5 mm plus 1 micrometre in both adjacent samples gets full XYZ world velocity; burial never excluded. Velocity norm includes vertical motion using explicit .32/1 m/s controller comparison. No solver stance labels.',clips,limits:['Contact coverage must be nonzero and appropriate; a low slip value with hovering paws is not acceptance.','Toe roll/support changes and sliding must still be inspected in hardware.','This is a fixed-speed comparison, not measurement of the original author intended traversal speed.']};await writeFile(new URL('contact-independent-'+tag+'.json',directory),JSON.stringify(report,null,2)+'\n');



