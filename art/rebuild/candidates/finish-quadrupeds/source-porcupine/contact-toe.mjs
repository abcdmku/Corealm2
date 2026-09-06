/** Separate bounded toe pitch repair, leaving frozen inputs unchanged. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Quaternion} from 'three';
const dir=new URL('./',import.meta.url),file='cdmir-porcupine-normalized.glb',output='cdmir-porcupine-contact-toe.glb';
const bytes=await readFile(new URL(file,dir)),io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS),doc=await io.readBinary(bytes),root=doc.getRoot();
const map=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8')).objects.Body;
const initial=new Map(root.listNodes().map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
function reset(){for(const[n,v]of initial)n.setTranslation(v.t).setRotation(v.r).setScale(v.s);}
function pose(animation,time){reset();for(const channel of animation.listChannels()){
 const sampler=channel.getSampler(),input=sampler.getInput(),out=sampler.getOutput();let lo=0,hi=input.getCount()-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(input.getScalar(m)<=time)lo=m;else hi=m-1;}
 const next=Math.min(lo+1,input.getCount()-1),a=[],b=[];out.getElement(lo,a);out.getElement(next,b);const d=input.getScalar(next)-input.getScalar(lo),u=d?Math.max(0,Math.min(1,(time-input.getScalar(lo))/d)):0,path=channel.getTargetPath(),node=channel.getTargetNode();if(path==='rotation')node.setRotation(new Quaternion(...a).slerp(new Quaternion(...b),u).toArray());else{const v=a.map((x,k)=>x+(b[k]-x)*u);if(path==='translation')node.setTranslation(v);else if(path==='scale')node.setScale(v);}
}}
const body=root.listNodes().find(n=>n.getName()==='Body'),skin=body.getSkin(),joints=skin.listJoints();
const inv=joints.map((_,i)=>{const a=[];skin.getInverseBindMatrices().getElement(i,a);return new Matrix4().fromArray(a);});
const rows=new Map();
for(const p of body.getMesh().listPrimitives()){const ids=p.getExtras().sourceVertexIndices;if(!ids)continue;const pos=p.getAttribute('POSITION'),js=p.getAttribute('JOINTS_0'),ws=p.getAttribute('WEIGHTS_0');ids.forEach((id,i)=>{if(rows.has(id))return;const a=[],j=[],w=[];pos.getElement(i,a);js.getElement(i,j);ws.getElement(i,w);rows.set(id,{id,p:new Vector3(...a),j,w});});}
const weight=(id,bone)=>{const ws=map.originalVertexWeights[id],sum=ws.reduce((s,[,v])=>s+v,0);return ws.filter(([n])=>n===bone).reduce((s,[,v])=>s+v,0)/sum;};
const limbs=['FrontLeg_L','FrontLeg_R','BackLeg_L','BackLeg_R'].map(name=>{
 const toe=name+'.003',index=joints.findIndex(j=>j.getName()===toe),affected=new Map([[index,1]]);
 joints.forEach((j,i)=>{const match=/^correct_Body_(\d+)$/.exec(j.getName());if(match){const id=+match[1],w=weight(id,toe);if(w>.05&&map.sourceWorldPositions[id][2]<.35)affected.set(i,w);}});
 return{name,toe,index,affected,vertices:[...rows.values()].filter(v=>weight(v.id,toe)>=.8)};
});
const axis=new Vector3(1,0,0),maxAngle=35*Math.PI/180,clearance=.00025;
function point(row,matrices){const p=new Vector3();for(let k=0;k<4;k++)if(row.w[k])p.addScaledVector(row.p.clone().applyMatrix4(matrices[row.j[k]]),row.w[k]);return p;}
function rotatedWorld(world,pivot,angle){return new Matrix4().makeTranslation(...pivot.toArray()).multiply(new Matrix4().makeRotationX(angle)).multiply(new Matrix4().makeTranslation(...pivot.clone().negate().toArray())).multiply(world);}
const clipReports=[],blocked=[];
for(const animation of root.listAnimations().filter(a=>['Walk','Run'].includes(a.getName()))){
 const duration=Math.max(...animation.listSamplers().map(s=>s.getInput().getScalar(s.getInput().getCount()-1))),times=new Set(Array.from({length:481},(_,i)=>i*duration/480));
 for(const s of animation.listSamplers()){const a=s.getInput();for(let i=0;i<a.getCount();i++)times.add(a.getScalar(i));}
 const ordered=[...times].sort((a,b)=>a-b),tracks=new Map(),samples=[];
 for(const limb of limbs)for(const[index]of limb.affected)tracks.set(index,{t:[],q:[]});
 for(const time of ordered){
  pose(animation,time);const worlds=joints.map(j=>new Matrix4().fromArray(j.getWorldMatrix())),originalSkin=worlds.map((w,i)=>w.clone().multiply(inv[i])),modifiedWorld=worlds.map(w=>w.clone()),angles={};
  for(const limb of limbs){
   const pivot=new Vector3().setFromMatrixPosition(worlds[limb.index]);
   const minimum=angle=>{const matrices=originalSkin.slice();for(const[index,factor]of limb.affected)matrices[index]=rotatedWorld(worlds[index],pivot,angle*factor).multiply(inv[index]);return Math.min(...limb.vertices.map(v=>point(v,matrices).y));};
   const baseline=minimum(0);let angle=0,achieved=baseline;
   if(baseline<-.0001){
    let bracket=null,best={degrees:0,minY:baseline};
    for(let deg=1;deg<=35&&!bracket;deg++)for(const sign of [-1,1]){const a=sign*deg*Math.PI/180,min=minimum(a);if(min>best.minY)best={degrees:sign*deg,minY:min};if(min>=clearance){bracket=[sign*(deg-1)*Math.PI/180,a];break;}}
    if(!bracket){blocked.push({clip:animation.getName(),time,limb:limb.name,baseline,bestWithinBound:best,reason:'No toe-only pitch within 35 degrees clears toe vertices.'});}
    else {let[a,b]=bracket;for(let i=0;i<12;i++){const m=(a+b)/2;if(minimum(m)>=clearance)b=m;else a=m;}angle=b;achieved=minimum(angle);}
   }
   for(const[index,factor]of limb.affected)modifiedWorld[index]=rotatedWorld(worlds[index],pivot,angle*factor);
   angles[limb.name]={radians:angle,degrees:angle*180/Math.PI,beforeToeMinY:baseline,afterToeMinY:achieved};
  }
  for(const[index,track]of tracks){
   const parent=joints[index].getParentNode(),parentInv=parent?new Matrix4().fromArray(parent.getWorldMatrix()).invert():new Matrix4(),local=parentInv.multiply(modifiedWorld[index]);
   const t=new Vector3(),q=new Quaternion(),s=new Vector3();local.decompose(t,q,s);track.t.push(...t.toArray());const old=track.q.slice(-4);if(old.length&&q.toArray().reduce((v,x,k)=>v+x*old[k],0)<0)q.set(-q.x,-q.y,-q.z,-q.w);track.q.push(...q.toArray());
  }
  samples.push({time,angles});
 }
 // Retain all non-foot channels byte-for-byte in memory. Rewrite only the
 // corrected toe/corresponding corrective-joint translation and rotation tracks.
 const buffer=root.listBuffers()[0],input=doc.createAccessor().setType('SCALAR').setArray(new Float32Array(ordered)).setBuffer(buffer);
 for(const[index,track]of tracks)for(const[path,data,type]of [['translation',track.t,'VEC3'],['rotation',track.q,'VEC4']]){
  const node=joints[index];for(const c of [...animation.listChannels()])if(c.getTargetNode()===node&&c.getTargetPath()===path)animation.removeChannel(c);
  const accessor=doc.createAccessor().setType(type).setArray(new Float32Array(data)).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(input).setOutput(accessor).setInterpolation('LINEAR'),channel=doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler);animation.addSampler(sampler).addChannel(channel);
 }
 clipReports.push({name:animation.getName(),samples:samples.length,duration,changedJoints:[...tracks.keys()].map(i=>joints[i].getName()),limbs:Object.fromEntries(limbs.map(l=>[l.name,{toeVertices:l.vertices.length,maxCorrectionDegrees:Math.max(...samples.map(s=>Math.abs(s.angles[l.name].degrees))),correctedSamples:samples.filter(s=>s.angles[l.name].radians!==0).length,maxBeforePenetrationMeters:Math.max(0,-Math.min(...samples.map(s=>s.angles[l.name].beforeToeMinY))),maxAfterPenetrationMeters:Math.max(0,-Math.min(...samples.map(s=>s.angles[l.name].afterToeMinY)))}])),series:samples});
 console.log(JSON.stringify({clip:animation.getName(),samples:samples.length,limbs:clipReports.at(-1).limbs,blocked:blocked.length}));
}
reset();
const report={input:file,inputSha256:createHash('sha256').update(bytes).digest('hex'),output,method:'Only four native .003 toe joints and low-foot corrective joints with original toe influence change. Apply the smallest world-X pitch that clears >=.80 original-toe-weight vertices to .25 mm when penetration exceeds .10 mm. Search both directions, hard 35-degree bound. Preserve each toe pivot, torso/root/ankle joints, scale, skin weights and all 13 clip names. No stance locking, root lift or body lift.',limits:['Toe-only candidate cannot repair ankle/paw vertices predominantly weighted to .001/.002.','Source ankle paths, stance drift and genuine flight are intentionally retained pending separate review.','Dense final-byte contact and continuity audit required before candidate acceptance.'],releaseReady:false,blocked,clips:clipReports};
if(!blocked.length){const out=await io.writeBinary(doc);await writeFile(new URL(output,dir),out);report.sha256=createHash('sha256').update(out).digest('hex');report.bytes=out.length;}
await writeFile(new URL('contact-toe-report.json',dir),JSON.stringify(report,null,2)+'\n');

