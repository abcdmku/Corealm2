/** CPU readback of the bytes actually exported; no renderer or Blender state. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Quaternion,Box3} from 'three';
const directory=new URL('./',import.meta.url),file=process.argv[2]||'cdmir-porcupine-adapted.glb';
const bytes=await readFile(new URL(file,directory)),doc=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes),root=doc.getRoot();
const initial=new Map(root.listNodes().map(n=>[n,{t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}]));
function reset(){for(const [n,v] of initial)n.setTranslation(v.t).setRotation(v.r).setScale(v.s);}
function pose(animation,time){reset();for(const channel of animation.listChannels()){
 const sampler=channel.getSampler(),input=sampler.getInput(),output=sampler.getOutput(),count=input.getCount();let lo=0,hi=count-1;
 while(lo<hi){const middle=Math.ceil((lo+hi)/2);if(input.getScalar(middle)<=time)lo=middle;else hi=middle-1;}
 const next=Math.min(lo+1,count-1),a=[],b=[];output.getElement(lo,a);output.getElement(next,b);const dt=input.getScalar(next)-input.getScalar(lo),t=dt>0?Math.max(0,Math.min(1,(time-input.getScalar(lo))/dt)):0;
 if(sampler.getInterpolation()!=='LINEAR')throw Error('Unsupported exported interpolation '+sampler.getInterpolation());
 const path=channel.getTargetPath(),node=channel.getTargetNode();if(path==='rotation')node.setRotation(new Quaternion(...a).slerp(new Quaternion(...b),t).toArray());else {const v=a.map((v,k)=>v+(b[k]-v)*t);if(path==='translation')node.setTranslation(v);else if(path==='scale')node.setScale(v);else throw Error('Unsupported channel '+path);}
 }}
function bounds(){const box=new Box3(),meshes={};let vertices=0,lowest=null;
 for(const node of root.listNodes())if(node.getMesh()){
 const local=new Box3(),skin=node.getSkin(),matrices=skin?.listJoints().map((j,i)=>{const b=[];skin.getInverseBindMatrices().getElement(i,b);return new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(b));});
 for(const prim of node.getMesh().listPrimitives()){const positions=prim.getAttribute('POSITION'),js=prim.getAttribute('JOINTS_0'),ws=prim.getAttribute('WEIGHTS_0');for(let i=0;i<positions.getCount();i++){
 const p=[],j=[],w=[];positions.getElement(i,p);const point=new Vector3();if(skin){js.getElement(i,j);ws.getElement(i,w);for(let k=0;k<4;k++)if(w[k])point.addScaledVector(new Vector3(...p).applyMatrix4(matrices[j[k]]),w[k]);}else point.fromArray(p).applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
 if(!point.toArray().every(Number.isFinite))throw Error('Nonfinite '+node.getName()+' vertex '+i);if(point.y<box.min.y)lowest={mesh:node.getName(),primitive:node.getMesh().listPrimitives().indexOf(prim),vertex:i,sourceVertex:prim.getExtras().sourceVertexIndices?.[i],position:point.toArray()};box.expandByPoint(point);local.expandByPoint(point);vertices++;
 }}meshes[node.getName()]={min:local.min.toArray(),max:local.max.toArray()};
 }return {min:box.min.toArray(),max:box.max.toArray(),vertices,meshes,lowest};}
let seed=68337;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const clips=[];for(const animation of root.listAnimations()){
 let duration=0;for(const s of animation.listSamplers()){const input=s.getInput();duration=Math.max(duration,input.getScalar(input.getCount()-1));}
 const times=[0,duration];for(let i=0;i<32&&duration;i++)times.push(random()*duration);times.sort((a,b)=>a-b);
 const samples=times.map(time=>{pose(animation,time);return {time,...bounds()};});clips.push({name:animation.getName(),duration,samples});console.log(animation.getName()+' '+samples.length+' finite byte-readback samples');
}
reset();const report={file,sha256:createHash('sha256').update(bytes).digest('hex'),coordinateSystem:'Drawn glTF Y up, source units; no automatic floor or normalization.',rest:bounds(),clips,limits:['Random finite bounds prove neither foot contact nor visual animation quality.','No GPU renderer used. Normals and materials still require hardware review.']};await writeFile(new URL(file.replace('.glb','-motion-readback.json'),directory),JSON.stringify(report,null,2)+'\n');

