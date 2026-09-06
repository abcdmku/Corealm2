import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Separate native-rig motion candidate. Never write the frozen geometry GLB.
const out=new URL('./',import.meta.url),io=new NodeIO();
const pawMode=process.argv.includes('--paw'),inputFile=pawMode?'Fox.paws.glb':'Fox.adapted.glb',outputFile='Fox.contact-dense-high.glb',reportFile='contact-dense-high-review.json',catalogueFile='contact-dense-high-catalogue.json';
const frozen=await readFile(new URL(inputFile,out)),doc=await io.readBinary(frozen),rt=doc.getRoot(),buffer=rt.listBuffers()[0];
const hash=b=>createHash('sha256').update(b).digest('hex');
const frozenHash=hash(frozen),nodes=rt.listNodes(),joints=rt.listSkins()[0].listJoints();
const objects=new Map(nodes.map(n=>[n,new THREE.Object3D()])),rest=new Map();
for(const n of nodes){const o=objects.get(n);o.name=n.getName();o.position.fromArray(n.getTranslation());o.quaternion.fromArray(n.getRotation());o.scale.fromArray(n.getScale());rest.set(n,{p:o.position.clone(),q:o.quaternion.clone(),s:o.scale.clone()});if(n.getParentNode())objects.get(n.getParentNode()).add(o);}
const tops=nodes.filter(n=>!n.getParentNode()).map(n=>objects.get(n)),update=()=>tops.forEach(o=>o.updateMatrixWorld(true));update();
const byName=name=>objects.get(nodes.find(n=>n.getName()===name));
const vec=()=>new THREE.Vector3(),qtr=()=>new THREE.Quaternion(),frac=t=>t-Math.floor(t),clamp=THREE.MathUtils.clamp;
const quintic=t=>{t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t));};
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
  const low=Math.min(...candidates.map(v=>skinVertex(v).y));f.sole=candidates.filter(v=>skinVertex(v).y<low+.0005);
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
const configs=[],baked=[],nativeSurveyHash=hash(JSON.stringify(nativeClips.find(c=>c.name==='Survey').channels.map(c=>({n:c.node.getName(),p:c.path,t:c.times,v:Array.from(c.values.getArray())}))));
for(const clip of nativeClips.filter(c=>['Walk','Run'].includes(c.name))){
  if(clip.name==='Run'){clip.nativeDuration=clip.duration;clip.duration=.4;}
  const run=clip.name==='Run',nativeSamples=[];
  for(let i=0;i<240;i++){nativePose(clip,i*clip.duration/240);nativeSamples.push(footDefs.map(measureFoot));}
  const duty=run?.30:.62;
  // These are NEW target speeds, deliberately below the inconsistent source
  // foot medians. They are not published as measurements of the native clips.
  const speed=run?1.8:.58,footConfigs=footDefs.map((f,fi)=>{
    const samples=nativeSamples.map((s,i)=>({i,...s[fi]})),lowest=samples.reduce((a,b)=>a.minY<b.minY?a:b);
    const minZ=Math.min(...samples.map(s=>s.centroid.z)),maxZ=Math.max(...samples.map(s=>s.centroid.z));
    return {id:f.id,start:frac(lowest.i/240-duty*.5),duty,sweep:speed*clip.duration*duty,
      measuredNativeMinimumAt:lowest.i*clip.duration/240,measuredNativeSweep:maxZ-minZ,
      nativeMinimumY:lowest.minY,centreZ:f.centre.z,centreX:f.centre.x,
      lift:run?.14:.065};
  });
  const frames=Math.ceil(clip.duration*(run?7680:240)),times=[],values=new Map(joints.map(n=>[n,[]])),hipValues=[],frameReports=[];
  const previousLimbQuaternions=new Map();
  for(let i=-frames*2;i<=frames;i++){
    const time=frac(i/frames)*clip.duration;nativePose(clip,time);
    update();
    const goals=footDefs.map((f,fi)=>{const c=footConfigs[fi],u=frac(time/clip.duration-c.start),stance=u<c.duty;
      const progress=stance?u/c.duty:(u-c.duty)/(1-c.duty);
      const derivative=-(1-c.duty)/c.duty,swingProgress=derivative*progress+(1-derivative)*quintic((progress-.12)/.76);
      const z=c.centreZ+c.sweep*(stance?.5-progress:-.5+swingProgress);
      const y=stance?0:c.lift*64*progress**3*(1-progress)**3;
      return {stance,u,desiredCentroid:new THREE.Vector3(c.centreX,y,z),target:new THREE.Vector3(c.centreX-f.bindOffset.x,y-f.bindSoleY,z-f.bindOffset.z)};
    });
    // Reach-driven pelvis lowering, computed from native hips and each target.
    // This never raises the animal to conceal penetration; it lets unchanged
    // chains reach the corrected feet without stretching their bones.
    let lower=0;
    for(let f=0;f<footDefs.length;f++){const hip=footDefs[f].chain[0].getWorldPosition(vec()),goal=goals[f].target,reach=footDefs[f].length*.965,xz=Math.hypot(hip.x-goal.x,hip.z-goal.z);const maxY=goal.y+Math.sqrt(Math.max(.0001,reach*reach-xz*xz));lower=Math.max(lower,hip.y-maxY);}
    lower=Math.max(0,lower);const hip=byName('b_Hip_01');
    if(lower>0){const p=hip.getWorldPosition(vec());p.y-=lower;hip.position.copy(hip.parent.worldToLocal(p));update();}
    const feet=[];
    for(let fi=0;fi<footDefs.length;fi++){
      const f=footDefs[fi],g=goals[fi];let reachError=0;
      for(let pass=0;pass<10;pass++){
        reachError=solve(f,g.target,f.bindQ);const physical=measureFoot(f),residual=g.desiredCentroid.clone().sub(physical.centroid);
        residual.y=g.desiredCentroid.y-physical.minY;
        if(residual.length()<.0000001)break;g.target.add(residual);
      }
      const physical=measureFoot(f);feet.push({id:f.id,stance:g.stance,u:g.u,minY:physical.minY,centroid:physical.centroid.toArray(),targetCentroid:g.desiredCentroid.toArray(),reachError});
    }
    for(const f of footDefs)for(const o of f.chain)previousLimbQuaternions.set(o,o.quaternion.clone());
    if(i<0)continue;
    times.push(i*clip.duration/frames);for(const n of joints)values.get(n).push(...objects.get(n).quaternion.toArray());hipValues.push(...hip.position.toArray());frameReports.push({time:i*clip.duration/frames,pelvisLowering:lower,feet});
  }
  configs.push({clip:clip.name,duration:clip.duration,nativeDuration:clip.nativeDuration??clip.duration,cycleDerivation:clip.nativeDuration?'New .4 second cycle with native upperbody phase resampled, 30% stance duty, articulated hock; authored common stance1.8m/s':'Native duration, contact-corrected limbs',targetTravelMps:speed,targetSpeedStatus:'new authored common stance target, not a claimed native measurement',phaseBasis:'each foot native physical-sole minimum anchors stance midpoint; source flight/stance timing then regularized to explicit duty',feet:footConfigs,frames:frames+1,maxPelvisLowering:Math.max(...frameReports.map(r=>r.pelvisLowering))});
  baked.push({clip,times,values,hipValues,frameReports});
}
const acc=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
for(const b of baked){
  const a=b.clip.animation;for(const c of [...a.listChannels()])c.dispose();for(const s of [...a.listSamplers()])s.dispose();
  const input=acc(b.clip.name+'_corrected_times','SCALAR',new Float32Array(b.times));
  for(const n of joints){const sampler=doc.createAnimationSampler().setInput(input).setOutput(acc(n.getName()+'_corrected_rotation','VEC4',new Float32Array(b.values.get(n)))).setInterpolation('LINEAR');a.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(n).setTargetPath('rotation').setSampler(sampler));}
  const sampler=doc.createAnimationSampler().setInput(input).setOutput(acc('corrected_hip_translation','VEC3',new Float32Array(b.hipValues))).setInterpolation('LINEAR');a.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.find(n=>n.getName()==='b_Hip_01')).setTargetPath('translation').setSampler(sampler));
}
const bytes=Buffer.from(await io.writeBinary(doc));await writeFile(new URL(outputFile,out),bytes);
const report={schema:1,frozenGeometrySha256:frozenHash,motionSha256:hash(bytes),geometryChanged:false,originalGeometryVariantUnchanged:true,
  method:'Native-joint analytic two-bone solves with anatomical bend poles and articulated reach-aligned hock, authored explicit stance paths, physical adapted-sole residual feedback and reach-driven pelvis lowering. Native Survey is unchanged; Walk/Run are separately marked corrected derivatives.',
  floorY:0,configs,bakedFrameEvidence:baked.map(b=>({clip:b.clip.name,frames:b.frameReports})),
  acceptance:{hardware:false,wholeVertexBetweenKeyAudit:false,nativeMotionPreserved:false,sourceDerivationPreserved:true},missingBehaviors:['Attack','Hit','HitLeft','HitRight','Death']};
await writeFile(new URL(reportFile,out),JSON.stringify(report,null,2)+'\n');
if(hash(await readFile(new URL(inputFile,out)))!==frozenHash)throw Error('Frozen geometry candidate changed');
console.log(JSON.stringify(configs.map(c=>({clip:c.clip,speed:c.targetTravelMps,maxPelvisLowering:c.maxPelvisLowering,feet:c.feet.map(f=>({id:f.id,start:f.start,sweep:f.sweep}))}))));
// Audit serialized accessors, then sample every quarter interval with all mesh vertices.
const serialized=await io.readBinary(bytes);
const meshHash=d=>hash(JSON.stringify(d.getRoot().listMeshes().map(m=>m.listPrimitives().map(p=>({indices:Array.from(p.getIndices()?.getArray()??[]),attributes:p.listSemantics().map(s=>[s,Array.from(p.getAttribute(s).getArray())])})))));
const beforeDoc=await io.readBinary(frozen);
const animationHash=a=>hash(JSON.stringify(a.listChannels().map(c=>({n:c.getTargetNode().getName(),p:c.getTargetPath(),t:Array.from(c.getSampler().getInput().getArray()),v:Array.from(c.getSampler().getOutput().getArray())}))));
report.preservation={meshAttributesAndIndicesEqual:meshHash(beforeDoc)===meshHash(serialized),surveyEqual:animationHash(beforeDoc.getRoot().listAnimations().find(a=>a.getName()==='Survey'))===animationHash(serialized.getRoot().listAnimations().find(a=>a.getName()==='Survey')),frozenFileEqual:hash(await readFile(new URL(inputFile,out)))===frozenHash};
report.serializedAudit=[];
for(const b of baked){
 const a=serialized.getRoot().listAnimations().find(a=>a.getName()===b.clip.name);
 const clip={duration:b.clip.duration,channels:a.listChannels().map(c=>({node:nodes.find(n=>n.getName()===c.getTargetNode().getName()),path:c.getTargetPath(),times:Array.from(c.getSampler().getInput().getArray()),values:c.getSampler().getOutput()}))};
 let minimum={y:Infinity},maxStanceHeight=0,maxStancePathError=0,maxStanceDrift=0;const previous=new Map(),maxJointStep=new Map(),stanceSamples=new Map(footDefs.map(f=>[f.id,[]]));
 const config=configs.find(c=>c.clip===b.clip.name),steps=(b.times.length-1)*4;
 for(let i=0;i<=steps;i++){
  const time=i*clip.duration/steps;nativePose(clip,time);
  const matrices=new Map();for(const v of allVertices)for(const w of v.influences)if(!matrices.has(w.object))matrices.set(w.object,w.object.matrixWorld.clone().multiply(w.inverse).elements);
  let low=Infinity,lowIndex=-1;
  for(let vi=0;vi<allVertices.length;vi++){const v=allVertices[vi];let y=0;for(const w of v.influences){const e=matrices.get(w.object);y+=w.weight*(e[1]*v.p.x+e[5]*v.p.y+e[9]*v.p.z+e[13]);}if(y<low){low=y;lowIndex=vi;}}
  if(low<minimum.y)minimum={y:low,time,vertex:lowIndex,bones:allVertices[lowIndex].influences.map(w=>({name:w.object.name,weight:w.weight}))};
  for(let fi=0;fi<footDefs.length;fi++){const f=footDefs[fi],c=config.feet[fi],p=measureFoot(f),u=frac(time/clip.duration-c.start),stance=u<c.duty,z=c.centreZ+c.sweep*(.5-u/c.duty);if(stance){if(u>.03*c.duty&&u<.97*c.duty)stanceSamples.get(f.id).push([u*clip.duration,p.centroid.z]);maxStanceHeight=Math.max(maxStanceHeight,Math.abs(p.minY));maxStancePathError=Math.max(maxStancePathError,Math.hypot(p.centroid.x-c.centreX,p.centroid.z-z));const old=previous.get(f.id);if(old?.stance&&Math.abs(u-old.u)<.1)maxStanceDrift=Math.max(maxStanceDrift,Math.hypot(p.centroid.x-old.p.x,p.centroid.z-old.p.z+config.targetTravelMps*(time-old.time)));}previous.set(f.id,{p:p.centroid,stance,u,time});}
  for(const n of joints){const q=objects.get(n).quaternion,old=maxJointStep.get(n);if(old)old.max=Math.max(old.max,old.q.angleTo(q));maxJointStep.set(n,{q:q.clone(),max:old?.max??0});}
 }
 const measuredStanceSpeedMps=Object.fromEntries([...stanceSamples].map(([id,points])=>{const n=points.length,mt=points.reduce((s,p)=>s+p[0],0)/n,mz=points.reduce((s,p)=>s+p[1],0)/n;return [id,-points.reduce((s,p)=>s+(p[0]-mt)*(p[1]-mz),0)/points.reduce((s,p)=>s+(p[0]-mt)**2,0)];}));
 report.serializedAudit.push({clip:b.clip.name,measuredStanceSpeedMps,samples:steps+1,minimum,maxStanceSoleHeightM:maxStanceHeight,maxStancePathErrorM:maxStancePathError,maxConsecutiveWorldStanceDriftM:maxStanceDrift,maximumQuarterKeyJointAngleRadians:Math.max(...[...maxJointStep.values()].map(x=>x.max)),soleGoal1mmPassed:minimum.y>=-.001&&maxStanceHeight<=.001});
}
report.acceptance.wholeVertexBetweenKeyAudit=true;
report.acceptance.contactGoal1mm=report.serializedAudit.every(a=>a.soleGoal1mmPassed);
report.bytes={geometry:frozen.length,motion:bytes.length,increase:bytes.length-frozen.length};
await writeFile(new URL(reportFile,out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({preservation:report.preservation,audit:report.serializedAudit,bytes:report.bytes}));

for(const b of baked){const first=b.frameReports[0],last=b.frameReports.at(-1);const loopQuaternionMax=Math.max(...[...b.values.values()].map(v=>new THREE.Quaternion(...v.slice(0,4)).normalize().angleTo(new THREE.Quaternion(...v.slice(-4)).normalize())));const loopHip=Math.hypot(...b.hipValues.slice(0,3).map((x,k)=>(x-b.hipValues.at(-3+k))*.01));report.serializedAudit.find(a=>a.clip===b.clip.name).loop={maxJointQuaternionRadians:loopQuaternionMax,hipTranslationM:loopHip,maxSoleCentroidM:Math.max(...first.feet.map((f,i)=>Math.hypot(...f.centroid.map((x,k)=>x-last.feet[i].centroid[k]))))};}
report.reviewRisks=[`Reach-driven pelvis lowering reaches ${Math.round(configs[0].maxPelvisLowering*1000)} mm Walk and ${Math.round(configs[1].maxPelvisLowering*1000)} mm Run; crouch and hock/limb presentation need hardware visual review.`,'Stance phases derive from native sole minima. Run is a newly authored .4 s cycle; native upper-body phase is resampled. Walk duration is preserved. These are derivative gaits.','Native Survey remains unchanged and retains approximately 1.32 mm penetration.','Combat, directional hit and death clips are absent.'];
await writeFile(new URL(reportFile,out),JSON.stringify(report,null,2)+'\n');
const catalogue=JSON.parse(await readFile(new URL('catalogue.json',out),'utf8'));
catalogue.scope='Separate contact-corrected Fox source derivative review; geometry frozen; new authored gait speeds; hardware acceptance pending.';
catalogue.files.creature_redbrush_fox=outputFile;
for(const asset of catalogue.assets){asset.impliedWalkMps=.58;asset.impliedRunMps=1.8;asset.reviewOnly.nativeDataExactlyPreserved=false;asset.walkClipSeconds=configs.find(c=>c.clip==='Walk').duration;asset.runClipSeconds=configs.find(c=>c.clip==='Run').duration;asset.sourceProvenance.modifications.push('Connected distal paw surface reshaped; derivative limb contact animation and reach correction; see motion review.');asset.sha256=hash(bytes);asset.bytes=bytes.length;asset.motionReview={candidateFile:outputFile,nativeSurveyPreserved:true,correctedClips:['Walk','Run'],authoredWalkSpeedMps:.58,authoredRunSpeedMps:1.8,speedBasis:'new authored world stance target, not native speed measurement',hardwareAccepted:false,report:reportFile};}
await writeFile(new URL(catalogueFile,out),JSON.stringify(catalogue,null,2)+'\n');
console.log(JSON.stringify(report.serializedAudit.map(a=>({clip:a.clip,loop:a.loop}))));





