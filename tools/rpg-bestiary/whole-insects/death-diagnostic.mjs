import fs from 'node:fs';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {applyFantasyWasp} from './fantasy-wasp.mjs';
const bytes=fs.readFileSync(new URL('./derived/Wasp.fbx',import.meta.url));
const reports=[];
for(const revised of [false,true]){
 const source=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 if(revised)applyFantasyWasp(source);
 const mesh=source.getObjectByName('Wasp'),g=mesh.geometry;
 const mixer=new T.AnimationMixer(source),clip=source.animations.find(c=>c.name.endsWith('_Death'));
 const a=mixer.clipAction(clip);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();
 for(const time of [0,.25,.5,.7,.75]){
  mixer.setTime(time);source.updateMatrixWorld(true);mesh.skeleton.update();
  const p=Array.from({length:g.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld));
  const edges=[];
  for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i+=3){
   const indices=[0,1,2].map(j=>g.index?g.index.getX(i+j):i+j),length=Math.max(...indices.map((n,j)=>p[n].distanceTo(p[indices[(j+1)%3]])));
   edges.push({triangle:i/3,material:mesh.material[group.materialIndex].name,length,indices});
  }
  edges.sort((a,b)=>b.length-a.length);
  reports.push({revised,time,largest:edges.slice(0,5).map(e=>({...e,vertices:e.indices.map(i=>({i,rest:new T.Vector3().fromBufferAttribute(g.attributes.position,i).toArray(),posed:p[i].toArray(),skin:Array.from({length:4},(_,k)=>({bone:mesh.skeleton.bones[g.attributes.skinIndex.array[i*4+k]].name,weight:g.attributes.skinWeight.array[i*4+k]}))}))}))});
 }
}
fs.mkdirSync('test-results/fantasy-wasp-source',{recursive:true});fs.writeFileSync('test-results/fantasy-wasp-source/death-diagnostic.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports.map(r=>({revised:r.revised,time:r.time,largest:r.largest[0]})),null,2));
