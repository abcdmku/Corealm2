import fs from 'node:fs';
import * as T from 'three';
import {buildHarpy} from './harpy.mjs';
const ids=process.argv.slice(2);if(!ids.length)ids.push('harpy','cliff_harpy','storm_harpy');
const v=new T.Vector3();
function bounds(object){object.updateMatrixWorld(true);const box=new T.Box3();object.traverse(n=>{if(!n.isMesh)return;for(let i=0;i<n.geometry.attributes.position.count;i++){if(n.isSkinnedMesh)n.getVertexPosition(i,v);else v.fromBufferAttribute(n.geometry.attributes.position,i);box.expandByPoint(v.applyMatrix4(n.matrixWorld));}});return [...box.min.toArray(),...box.max.toArray()];}
function stats(object){let meshes=0,triangles=0,vertices=0;const materials=new Set();object.traverse(n=>{if(!n.isMesh)return;meshes++;triangles+=(n.geometry.index?.count||n.geometry.attributes.position.count)/3;vertices+=n.geometry.attributes.position.count;materials.add(n.material.name);});return{meshes,triangles,vertices,materials:[...materials].sort()};}
for(const id of ids){
 const before=buildHarpy(id,{mergeAttachments:false}),after=buildHarpy(id),bm=new T.AnimationMixer(before.object),am=new T.AnimationMixer(after.object),samples=[];let maximumDifference=0,minimumY=Infinity;
 for(let c=0;c<before.clips.length;c++){
  const a=before.clips[c],b=after.clips[c];
  if(JSON.stringify(a.toJSON())!==JSON.stringify(b.toJSON())){const ac=a.toJSON(),bc=b.toJSON();delete ac.uuid;delete bc.uuid;if(JSON.stringify(ac)!==JSON.stringify(bc))throw Error(`${id} ${a.name} tracks changed`);}
  const ba=bm.clipAction(a),aa=am.clipAction(b);for(const action of [ba,aa]){action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();}
  const count=Math.ceil(a.duration*120),times=[...new Set([...a.tracks.flatMap(t=>Array.from(t.times)),...Array.from({length:count+1},(_,i)=>i/count*a.duration)])].sort((a,b)=>a-b);let difference=0;
  for(const t of times){bm.setTime(t);am.setTime(t);const x=bounds(before.object),y=bounds(after.object),d=Math.max(...x.map((v,i)=>Math.abs(v-y[i])));difference=Math.max(difference,d);minimumY=Math.min(minimumY,y[1]);if(d>0.00001)throw Error(`${id} ${a.name}@${t} bounds diff ${d}: ${x} / ${y}`);}
  maximumDifference=Math.max(maximumDifference,difference);samples.push({clip:a.name,sampleCount:times.length,maximumBoundsDifference:difference});ba.stop();aa.stop();
 }
 const prior=stats(before.object),current=stats(after.object);if(prior.triangles!==current.triangles||prior.vertices!==current.vertices||JSON.stringify(prior.materials)!==JSON.stringify(current.materials))throw Error('Merge changed geometry counts or materials');
 const record={id,before:prior,after:current,minimumY,maximumBoundsDifference:maximumDifference,samples};fs.writeFileSync(`tools/rpg-bestiary/harpy-source/${id}-merge-check.json`,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}
