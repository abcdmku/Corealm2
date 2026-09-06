import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {FBXLoader}from'three/addons/loaders/FBXLoader.js';
import {applyFantasyWasp}from'./fantasy-wasp.mjs';import{repairWaspSkin}from'./repair-wasp-skin.mjs';
const b=fs.readFileSync(new URL('./derived/Wasp.fbx',import.meta.url)),load=()=>new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const before=load(),after=load(),repair=repairWaspSkin(after);applyFantasyWasp(before);applyFantasyWasp(after);
const ma=before.getObjectByName('Wasp'),mb=after.getObjectByName('Wasp'),ga=ma.geometry,gb=mb.geometry;
for(const name of ['position','normal','color','uv'])if(ga.attributes[name])assert.deepEqual(ga.attributes[name].array,gb.attributes[name].array);
assert.deepEqual(ga.index.array,gb.index.array);assert.deepEqual(before.animations.map(c=>c.tracks.map(t=>t.toJSON?t.toJSON():T.KeyframeTrack.toJSON(t))),after.animations.map(c=>c.tracks.map(t=>t.toJSON?t.toJSON():T.KeyframeTrack.toJSON(t))));
const orphan=new Set(repair.orphanVertices);let changed=0;for(let i=0;i<ga.attributes.position.count;i++)for(let k=0;k<4;k++)if(ga.attributes.skinWeight.array[i*4+k]!==gb.attributes.skinWeight.array[i*4+k]||ga.attributes.skinIndex.array[i*4+k]!==gb.attributes.skinIndex.array[i*4+k]){assert(orphan.has(i));changed++;}
const report={repair,changedInfluences:changed,unchanged:'All positions, normals, colors, UVs, triangles, native clips and every non-orphan skin influence',clips:[]};
const scale=.006654805;
for(let ci=0;ci<before.animations.length;ci++){
 const c=before.animations[ci],mx=new T.AnimationMixer(before),my=new T.AnimationMixer(after);for(const [m,clip]of [[mx,c],[my,after.animations[ci]]]){const a=m.clipAction(clip);a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();}
 let maximumDifferenceM=0,maxEdgeBeforeM=0,maxEdgeAfterM=0;
 for(let step=0;step<=60;step++){
  mx.setTime(c.duration*step/60);my.setTime(c.duration*step/60);before.updateMatrixWorld(true);after.updateMatrixWorld(true);ma.skeleton.update();mb.skeleton.update();
  for(const i of orphan){const a=ma.getVertexPosition(i,new T.Vector3()).applyMatrix4(ma.matrixWorld),b=mb.getVertexPosition(i,new T.Vector3()).applyMatrix4(mb.matrixWorld);maximumDifferenceM=Math.max(maximumDifferenceM,a.distanceTo(b)*scale);}
  for(let i=0;i<ga.index.count;i+=3){const ids=[0,1,2].map(k=>ga.index.getX(i+k));if(!ids.some(j=>orphan.has(j)))continue;
   const a=ids.map(j=>ma.getVertexPosition(j,new T.Vector3()).applyMatrix4(ma.matrixWorld)),b=ids.map(j=>mb.getVertexPosition(j,new T.Vector3()).applyMatrix4(mb.matrixWorld));
   for(let k=0;k<3;k++){maxEdgeBeforeM=Math.max(maxEdgeBeforeM,a[k].distanceTo(a[(k+1)%3])*scale);maxEdgeAfterM=Math.max(maxEdgeAfterM,b[k].distanceTo(b[(k+1)%3])*scale);}
  }
 }
 report.clips.push({name:c.name,maximumDifferenceM,maxEdgeBeforeM,maxEdgeAfterM,samples:61});mx.stopAllAction();my.stopAllAction();
}
const death=report.clips.find(c=>c.name.endsWith('_Death'));assert(death.maxEdgeAfterM<.3);assert(death.maxEdgeBeforeM>1);assert(report.clips.every(c=>c.maxEdgeAfterM<c.maxEdgeBeforeM));assert.equal(changed,16);
fs.writeFileSync('test-results/fantasy-wasp-source/skin-repair-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
