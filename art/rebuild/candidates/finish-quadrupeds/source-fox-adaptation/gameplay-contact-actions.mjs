import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Separate native-rig motion candidate. Never write the frozen geometry GLB.
const out=new URL('./',import.meta.url),io=new NodeIO();
const inputFile='Fox.contact-dense.glb',outputFile='Fox.gameplay-contact-draft.glb';
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
const base=nativeClips.find(c=>c.name==='Survey'),hip=byName('b_Hip_01');
const bell=(a,b,c,t)=>smooth((t-a)/(b-a))*(1-smooth((t-b)/(c-b)));
const worldRotate=(name,axis,angle)=>{const o=byName(name);setWorldQ(o,qtr().setFromAxisAngle(axis,angle).multiply(o.getWorldQuaternion(qtr())));};
const X=new THREE.Vector3(1,0,0),Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1);
const moveHip=(x,y,z)=>{const p=hip.getWorldPosition(vec()).add(new THREE.Vector3(x,y,z));hip.position.copy(hip.parent.worldToLocal(p));update();};
function bounds(){const matrices=new Map();for(const v of allVertices)for(const w of v.influences)if(!matrices.has(w.object))matrices.set(w.object,w.object.matrixWorld.clone().multiply(w.inverse).elements);let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],index=-1;for(let i=0;i<allVertices.length;i++){const v=allVertices[i],p=[0,0,0];for(const w of v.influences){const e=matrices.get(w.object);for(let k=0;k<3;k++)p[k]+=w.weight*(e[k]*v.p.x+e[k+4]*v.p.y+e[k+8]*v.p.z+e[k+12]);}for(let k=0;k<3;k++){if(p[k]<min[k]){min[k]=p[k];if(k===1)index=i;}max[k]=Math.max(max[k],p[k]);}}return {min,max,index};}
function plant(goals){let lower=0;for(let i=0;i<footDefs.length;i++){const f=footDefs[i],p=f.chain[0].getWorldPosition(vec()),desired=goals[i],g=new THREE.Vector3(desired.x-f.bindOffset.x,desired.y-f.bindSoleY,desired.z-f.bindOffset.z),reach=f.length*.965;lower=Math.max(lower,p.y-g.y-Math.sqrt(Math.max(.0001,reach*reach-(p.x-g.x)**2-(p.z-g.z)**2)));}if(lower>0)moveHip(0,-lower,0);for(let i=0;i<footDefs.length;i++){const f=footDefs[i],g=goals[i],target=new THREE.Vector3(g.x-f.bindOffset.x,g.y-f.bindSoleY,g.z-f.bindOffset.z);for(let pass=0;pass<6;pass++){solve(f,target,f.bindQ);const m=measureFoot(f),error=new THREE.Vector3(g.x-m.centroid.x,g.y-m.minY,g.z-m.centroid.z);if(error.length()<.000025)break;target.add(error);}}return Math.max(0,lower);}
function pose(name,time){nativePose(null,0);const goals=footDefs.map(f=>new THREE.Vector3(f.centre.x,0,f.centre.z));let lower=0;
 if(name==='Attack'){
  const crouch=bell(0,.16,.29,time),launch=bell(.22,.37,.54,time),lunge=bell(.12,.43,.80,time),strike=bell(.32,.46,.68,time);
  moveHip(0,-.035*crouch+.085*launch,.105*lunge);
  worldRotate('b_Spine02_03',X,.11*crouch+.13*strike);worldRotate('b_Neck_04',X,-.10*crouch+.20*strike);worldRotate('b_Head_05',X,.22*strike);
  worldRotate('b_Tail01_012',X,-.16*launch);worldRotate('b_Tail02_013',Y,.08*lunge);
  goals.forEach((g,i)=>{const fore=i<2;g.y=.085*launch+(fore?.045*bell(.11,.23,.38,time):.015*bell(.15,.24,.32,time));g.z+=(fore?.14:.05)*lunge;});
  lower=plant(goals);
 }else if(name.startsWith('Hit')){
  const side=name==='HitLeft'?1:name==='HitRight'?-1:0,recoil=bell(0,.13,.58,time),brace=bell(0,.20,.65,time);
  moveHip(.035*side*recoil,-.027*brace,-.045*recoil);worldRotate('b_Spine02_03',Y,.17*side*recoil);worldRotate('b_Neck_04',Y,.22*side*recoil);worldRotate('b_Head_05',X,-.16*recoil);worldRotate('b_Spine01_02',Z,-.07*side*recoil);worldRotate('b_Tail01_012',Y,-.13*side*recoil);
  lower=plant(goals);
 }else if(name==='Death'){
  const fall=smooth((time-.10)/.85),collapse=smooth(time/.30),settle=smooth((time-.70)/.25);
  lower=plant(goals);worldRotate('b_Spine02_03',Y,0);worldRotate('b_Neck_04',X,.20*fall);worldRotate('b_Neck_04',Y,.02*fall);worldRotate('b_Head_05',Y,.02*fall);
  worldRotate('b_RightUpperArm_06',X,.38*fall);worldRotate('b_LeftUpperArm_09',X,.20*fall);worldRotate('b_RightForeArm_07',X,-.32*fall);worldRotate('b_LeftForeArm_010',X,-.18*fall);
  worldRotate('b_LeftLeg01_015',X,-.27*fall);worldRotate('b_RightLeg01_019',X,-.18*fall);worldRotate('b_Tail01_012',Y,.03*fall);worldRotate('b_Tail02_013',Y,.02*fall);
  worldRotate('b_Hip_01',Z,Math.PI*.5*fall);moveHip(.14*fall,-.05*collapse,0);
  // Surface-derived support places the rolling body on the authored floor.
  // This varies with contact geometry; it is not a constant floor offset.
  const support=bounds();moveHip(0,-support.min[1],0);
 }
 return {lower,bounds:bounds(),feet:footDefs.map(f=>({id:f.id,...measureFoot(f)}))};
}
const roles=[{name:'Attack',duration:1.05,provenance:'Authored anticipation crouch, short pounce, downward head strike, landing and braced recovery. No jaw animation or bite claim.',events:{anticipation:.16,launch:.22,impact:.46,recovery:.80}},{name:'Hit',duration:.72,provenance:'Authored rearward recoil and four-paw brace with recovery.',events:{peak:.13,recovered:.65}},{name:'HitLeft',duration:.72,provenance:'Authored left-side impact response: rightward trunk displacement, yaw and counter-tail, planted paws.',events:{peak:.13,recovered:.65}},{name:'HitRight',duration:.72,provenance:'Authored right-side impact response: leftward trunk displacement, yaw and counter-tail, planted paws.',events:{peak:.13,recovered:.65}},{name:'Death',duration:1.40,provenance:'Authored collapse, limb folding, side roll, head/tail rest and geometry-derived body support. Final .45 seconds held motionless.',events:{collapse:.10,sideContact:.85,settled:.95}}];
const accessor=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer),authored=[];
for(const role of roles){const frames=Math.ceil(role.duration*240),times=[],rotations=new Map(joints.map(n=>[n,[]])),translations=[],evidence=[];for(let i=0;i<=frames;i++){const t=i*role.duration/frames,result=pose(role.name,t);times.push(t);for(const n of joints)rotations.get(n).push(...objects.get(n).quaternion.toArray());translations.push(...hip.position.toArray());evidence.push({time:t,pelvisReachLowering:result.lower,minY:result.bounds.min[1]});}
 const animation=doc.createAnimation(role.name),input=accessor(role.name+'_times','SCALAR',new Float32Array(times));for(const n of joints){const sampler=doc.createAnimationSampler().setInput(input).setOutput(accessor(role.name+'_'+n.getName(),'VEC4',new Float32Array(rotations.get(n)))).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(n).setTargetPath('rotation').setSampler(sampler));}const sampler=doc.createAnimationSampler().setInput(input).setOutput(accessor(role.name+'_hip','VEC3',new Float32Array(translations))).setInterpolation('LINEAR');animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.find(n=>n.getName()==='b_Hip_01')).setTargetPath('translation').setSampler(sampler));authored.push({...role,frames:frames+1,evidence});}
const bytes=Buffer.from(await io.writeBinary(doc));await writeFile(new URL(outputFile,out),bytes);
const serialized=await io.readBinary(bytes),report={sourceSha256:frozenHash,candidateSha256:hash(bytes),roleProvenance:roles,sourceGeometryUnchanged:true,hardwareAccepted:false,roles:[],bytes:bytes.length};
for(const role of authored){const a=serialized.getRoot().listAnimations().find(a=>a.getName()===role.name),clip={duration:role.duration,channels:a.listChannels().map(c=>({node:nodes.find(n=>n.getName()===c.getTargetNode().getName()),path:c.getTargetPath(),times:Array.from(c.getSampler().getInput().getArray()),values:c.getSampler().getOutput()}))};let minimum={y:Infinity},finalBounds,settledStart,settledMaxDrift=0,finite=true;const steps=(role.frames-1)*4;
 for(let i=0;i<=steps;i++){const t=i*role.duration/steps;nativePose(clip,t);const box=bounds();finite&&=[...box.min,...box.max].every(Number.isFinite);if(box.min[1]<minimum.y)minimum={y:box.min[1],time:t,vertex:box.index,bones:allVertices[box.index].influences.map(w=>({name:w.object.name,weight:w.weight}))};if(role.name==='Death'&&t>=.96){const values=joints.flatMap(n=>[...objects.get(n).quaternion.toArray(),...objects.get(n).position.toArray()]);if(!settledStart)settledStart=values;settledMaxDrift=Math.max(settledMaxDrift,...values.map((v,k)=>Math.abs(v-settledStart[k])));}if(i===steps)finalBounds=box;}
 const settledRegionMinimumY={};if(role.name==='Death')for(const vertex of allVertices){const name=vertex.influences.reduce((a,b)=>a.weight>b.weight?a:b).object.name,y=skinVertex(vertex).y;settledRegionMinimumY[name]=Math.min(settledRegionMinimumY[name]??Infinity,y);}
 report.roles.push({name:role.name,settledRegionMinimumY:role.name==='Death'?settledRegionMinimumY:undefined,duration:role.duration,samples:steps+1,minimum,finite,contact1mm:minimum.y>=-.001,finalBounds,settledMaxTransformDrift:role.name==='Death'?settledMaxDrift:null});
}
const animHash=a=>hash(JSON.stringify(a.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetPath(),Array.from(c.getSampler().getInput().getArray()),Array.from(c.getSampler().getOutput().getArray())])));
const original=await io.readBinary(frozen);report.originalClipsPreserved=original.getRoot().listAnimations().every(a=>animHash(a)===animHash(serialized.getRoot().listAnimations().find(b=>b.getName()===a.getName())));report.uniqueRoleData=new Set(serialized.getRoot().listAnimations().map(animHash)).size===serialized.getRoot().listAnimations().length;
await writeFile(new URL('gameplay-contact-draft-review.json',out),JSON.stringify(report,null,2)+'\n');const catalogue=JSON.parse(await readFile(new URL('contact-dense-catalogue.json',out),'utf8'));catalogue.files.creature_redbrush_fox=outputFile;catalogue.scope='Source-derived Fox gameplay draft, eight distinct clips; hardware review pending';const asset=catalogue.assets[0];asset.impliedWalkMps=.58;asset.impliedRunMps=1.8;asset.sha256=hash(bytes);asset.bytes=bytes.length;asset.animations=serialized.getRoot().listAnimations().map(a=>a.getName());asset.reviewOnly.missingProductionBehaviors=[];asset.gameplayRoleProvenance=roles;asset.motionReview.candidateFile=outputFile;asset.motionReview.report='gameplay-contact-draft-review.json';await writeFile(new URL('gameplay-contact-draft-catalogue.json',out),JSON.stringify(catalogue,null,2)+'\n');console.log(JSON.stringify(report));


const meshDataHash=d=>hash(JSON.stringify(d.getRoot().listMeshes().map(m=>m.listPrimitives().map(p=>({indices:Array.from(p.getIndices()?.getArray()??[]),attributes:p.listSemantics().map(s=>[s,Array.from(p.getAttribute(s).getArray())])})))));
const rigHash=d=>hash(JSON.stringify({nodes:d.getRoot().listNodes().map(n=>[n.getName(),n.getParentNode()?.getName(),n.getTranslation(),n.getRotation(),n.getScale()]),skins:d.getRoot().listSkins().map(s=>[s.listJoints().map(j=>j.getName()),Array.from(s.getInverseBindMatrices().getArray())])}));
report.sourceGeometryUnchanged=meshDataHash(original)===meshDataHash(serialized);report.sourceRigUnchanged=rigHash(original)===rigHash(serialized);report.frozenSourceUnchanged=hash(await readFile(new URL(inputFile,out)))===frozenHash;
for(const r of report.roles){const a=serialized.getRoot().listAnimations().find(a=>a.getName()===r.name);let maxEndDelta=0,maxAnimatedAngle=0;for(const c of a.listChannels()){const v=c.getSampler().getOutput(),first=v.getElement(0,[]),last=v.getElement(v.getCount()-1,[]);if(c.getTargetPath()==='rotation'){const q=new THREE.Quaternion(...first).normalize();maxEndDelta=Math.max(maxEndDelta,q.angleTo(new THREE.Quaternion(...last).normalize()));for(let i=0;i<v.getCount();i++)maxAnimatedAngle=Math.max(maxAnimatedAngle,q.angleTo(new THREE.Quaternion(...v.getElement(i,[])).normalize()));}else maxEndDelta=Math.max(maxEndDelta,...first.map((x,k)=>Math.abs(x-last[k])));}r.recoveryEndpointMaxDelta=r.name==='Death'?null:maxEndDelta;r.maximumAuthoredJointExcursionRadians=maxAnimatedAngle;}
report.settledDeathTorsoContact1mm=report.roles.find(r=>r.name==='Death').settledRegionMinimumY.b_Spine01_02<.001;
await writeFile(new URL('gameplay-contact-draft-review.json',out),JSON.stringify(report,null,2)+'\n');
