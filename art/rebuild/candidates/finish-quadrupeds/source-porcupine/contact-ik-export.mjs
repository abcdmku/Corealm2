/** Transfer evaluated source IK deltas into a separate frozen-shape derivative. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO,PropertyType} from '@gltf-transform/core';
import {prune,dedup} from '@gltf-transform/functions';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Quaternion} from 'three';
import {adaptSourcePoint} from './porcupine-surface.mjs';
const dir=new URL('./',import.meta.url),input='cdmir-porcupine-normalized.glb',output=process.argv[3]||'cdmir-porcupine-contact-ik-clearance.glb';
const absoluteSource=process.argv[5]==='absolute-source';
const proof=JSON.parse(await readFile(new URL(process.argv[2]||'contact-source-ik.json',dir),'utf8')),mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8'));
if(proof.failures.length)throw Error('Source IK exceeded bound; no export');
const bytes=await readFile(new URL(input,dir));if(createHash('sha256').update(bytes).digest('hex')!==proof.inputSha256)throw Error('Frozen input hash changed');
const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS),doc=await io.readBinary(bytes),root=doc.getRoot(),buffer=root.listBuffers()[0];
const initial=new Map(root.listNodes().map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
function reset(){for(const[n,v]of initial)n.setTranslation(v.t).setRotation(v.r).setScale(v.s);}
function pose(animation,time){reset();for(const channel of animation.listChannels()){
 const sampler=channel.getSampler(),input=sampler.getInput(),out=sampler.getOutput();let lo=0,hi=input.getCount()-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(input.getScalar(m)<=time)lo=m;else hi=m-1;}
 const next=Math.min(lo+1,input.getCount()-1),a=[],b=[];out.getElement(lo,a);out.getElement(next,b);const d=input.getScalar(next)-input.getScalar(lo),u=d?Math.max(0,Math.min(1,(time-input.getScalar(lo))/d)):0,path=channel.getTargetPath(),node=channel.getTargetNode();if(path==='rotation')node.setRotation(new Quaternion(...a).slerp(new Quaternion(...b),u).toArray());else{const v=a.map((x,k)=>x+(b[k]-x)*u);if(path==='translation')node.setTranslation(v);else if(path==='scale')node.setScale(v);}
}}
const nodeByName=new Map(root.listNodes().map(n=>[n.getName(),n]));
const decode=s=>new Float32Array(Uint8Array.from(Buffer.from(s,'base64')).buffer);
const matrix=(array,sample,bone)=>new Matrix4().fromArray(array.slice((sample*proof.bones.length+bone)*16,(sample*proof.bones.length+bone+1)*16)).transpose();
const point=(array,sample,id)=>Array.from(array.slice((sample*proof.correctives.length+id)*3,(sample*proof.correctives.length+id+1)*3));
const relevantCorrectives=proof.correctives.map((c,index)=>({...c,index})).filter(c=>mapping.objects[c.object].originalVertexWeights[c.vertex].some(([n,w])=>proof.bones.includes(n)&&w>.02));
const result=[];
for(const clip of proof.clips){
 const animation=root.listAnimations().find(a=>a.getName()===clip.name),before=decode(clip.boneMatricesBefore),after=decode(clip.boneMatricesAfter),beforeP=decode(clip.correctivePositionsBefore),afterP=decode(clip.correctivePositionsAfter);
 const tracks=new Map([...proof.bones,...relevantCorrectives.map(c=>c.name)].map(name=>[name,{t:[],q:[],s:[]}]));
 for(let si=0;si<clip.times.length;si++){
  pose(animation,clip.times[si]);const matricesBefore=proof.bones.map((_,i)=>matrix(before,si,i)),matricesAfter=proof.bones.map((_,i)=>matrix(after,si,i));
  const changed=new Map();
  proof.bones.forEach((name,i)=>{const node=nodeByName.get(name),delta=matricesAfter[i].clone().multiply(matricesBefore[i].clone().invert());changed.set(name,absoluteSource?matricesAfter[i].clone():delta.multiply(new Matrix4().fromArray(node.getMatrix())));});
  for(const c of relevantCorrectives){
   const source=mapping.objects[c.object],raw=source.originalVertexWeights[c.vertex],sum=raw.reduce((n,[,w])=>n+w,0),weights=raw.map(([n,w])=>[n,w/sum]);
   const oldPoint=new Vector3(...adaptSourcePoint(point(beforeP,si,c.index),c.object,weights)),newPoint=new Vector3(...adaptSourcePoint(point(afterP,si,c.index),c.object,weights));
   const restPoint=new Vector3(...adaptSourcePoint(source.sourceWorldPositions[c.vertex],c.object,weights)),node=nodeByName.get(c.name),oldMatrix=new Matrix4().fromArray(node.getMatrix()),target=absoluteSource?newPoint:restPoint.clone().applyMatrix4(oldMatrix).add(newPoint.sub(oldPoint));
   const t=new Vector3(),q=new Quaternion(),s=new Vector3();oldMatrix.decompose(t,q,s);const dominant=[...weights].sort((a,b)=>b[1]-a[1])[0][0],bi=proof.bones.indexOf(dominant);
   if(bi>=0){const a=new Quaternion(),b=new Quaternion();matricesBefore[bi].decompose(new Vector3(),a,new Vector3());matricesAfter[bi].decompose(new Vector3(),b,new Vector3());q.premultiply(b.multiply(a.invert())).normalize();}
   const translation=target.sub(restPoint.clone().multiply(s).applyQuaternion(q));changed.set(c.name,new Matrix4().compose(translation,q,s));
  }
  for(const[name,m]of changed){const track=tracks.get(name),t=new Vector3(),q=new Quaternion(),s=new Vector3();m.decompose(t,q,s);const old=track.q.slice(-4);if(old.length&&q.toArray().reduce((a,x,k)=>a+x*old[k],0)<0)q.set(-q.x,-q.y,-q.z,-q.w);track.t.push(...t.toArray());track.q.push(...q.toArray());track.s.push(...s.toArray());}
 }
 const timeAccessor=doc.createAccessor().setType('SCALAR').setArray(new Float32Array(clip.times)).setBuffer(buffer);
 for(const[name,track]of tracks)for(const[path,array,type]of [['translation',track.t,'VEC3'],['rotation',track.q,'VEC4'],['scale',track.s,'VEC3']]){
  const node=nodeByName.get(name);for(const c of [...animation.listChannels()])if(c.getTargetNode()===node&&c.getTargetPath()===path)animation.removeChannel(c);
  const accessor=doc.createAccessor().setType(type).setArray(new Float32Array(array)).setBuffer(buffer),sampler=doc.createAnimationSampler().setInput(timeAccessor).setOutput(accessor).setInterpolation('LINEAR'),channel=doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler);animation.addSampler(sampler).addChannel(channel);
 }
 result.push({clip:clip.name,samples:clip.times.length,changedJoints:[...tracks.keys()]});
}
reset();
if(absoluteSource){
 for(const animation of root.listAnimations()){
  const used=new Set(animation.listChannels().map(c=>c.getSampler()));
  for(const sampler of [...animation.listSamplers()])if(!used.has(sampler))animation.removeSampler(sampler);
 }
 await doc.transform(prune({keepAttributes:true,keepExtras:true}),dedup({propertyTypes:[PropertyType.ACCESSOR]}));
}
const out=await io.writeBinary(doc);await writeFile(new URL(output,dir),out);
await writeFile(new URL(process.argv[4]||'contact-ik-export.json',dir),JSON.stringify({input,inputSha256:proof.inputSha256,output,sha256:createHash('sha256').update(out).digest('hex'),bytes:out.length,clips:result,sourceSolver:process.argv[2]||'contact-source-ik.json',sourceMethod:proof.method,method:'Evaluate original source IK chains, transfer each limb joint before/after matrix delta onto frozen candidate, and rebake affected corrective vertices from species-warped source vertex deltas. Skin topology, weights, binds, materials, root, torso controls and unrelated native clips preserved.',releaseReady:false,limits:['Separate contact candidate only; final-byte contact, flight and continuity audit still required.','Controller traversal speeds remain unchanged.']},null,2)+'\n');
console.log(JSON.stringify({output,bytes:out.length,clips:result}));



