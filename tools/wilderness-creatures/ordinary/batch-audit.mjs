/** Compare every batched Colossus vertex with its original rigid part at 120 Hz. */
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import {readFile,writeFile} from 'node:fs/promises';
const out='test-results/wilderness-creatures/ordinary',io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function load(file){const doc=await io.read(file);for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null).setEmissiveTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);const b=await io.writeBinary(doc);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const before=await load(`${out}/voidstone-prebatch.glb`),after=await load(`${out}/creature_voidstone_colossus.glb`),oldMeshes=new Map(),pairs=[];
before.scene.traverse(n=>{if(n.isMesh)oldMeshes.set(n.name,n);});
let afterMeshes=0;after.scene.traverse(n=>{if(!n.isMesh)return;afterMeshes++;assert(n.isSkinnedMesh,'Batched anatomy must use the production skin path');for(const part of n.geometry.userData.batchParts??[]){const old=oldMeshes.get(part.sourceNode);assert(old,`Missing source part ${part.sourceNode}`);pairs.push({old,next:n,part});}});
assert.equal(afterMeshes,4);assert.equal(pairs.length,oldMeshes.size);
const oldMixer=new T.AnimationMixer(before.scene),newMixer=new T.AnimationMixer(after.scene),oldPoint=new T.Vector3(),newPoint=new T.Vector3(),rows=[];
for(const clip of before.animations){const next=after.animations.find(a=>a.name===clip.name);assert(next);assert.equal(next.duration,clip.duration);oldMixer.stopAllAction();newMixer.stopAllAction();for(const [mixer,c]of [[oldMixer,clip],[newMixer,next]]){const a=mixer.clipAction(c).setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();}
 const count=Math.max(120,Math.ceil(clip.duration*120)),oldUnion=new T.Box3(),newUnion=new T.Box3();let maxError=0,minFloor=Infinity,maxFloor=-Infinity;
 for(let frame=0;frame<=count;frame++){const time=clip.duration*frame/count;oldMixer.setTime(time);newMixer.setTime(time);before.scene.updateMatrixWorld(true);after.scene.updateMatrixWorld(true);const oldBox=new T.Box3(),newBox=new T.Box3();
  for(const {old,next,part}of pairs){for(let j=0;j<part.sourceIndices.length;j++){old.getVertexPosition(part.sourceIndices[j],oldPoint).applyMatrix4(old.matrixWorld);next.getVertexPosition(part.vertexOffset+j,newPoint).applyMatrix4(next.matrixWorld);maxError=Math.max(maxError,oldPoint.distanceTo(newPoint));oldBox.expandByPoint(oldPoint);newBox.expandByPoint(newPoint);}
   const a=old.geometry.attributes.uv,b=next.geometry.attributes.uv;if(a||b){assert(a&&b,'Only one side retained mapped UVs');for(let j=0;j<part.sourceIndices.length;j++){assert.equal(a.getX(part.sourceIndices[j]),b.getX(part.vertexOffset+j));assert.equal(a.getY(part.sourceIndices[j]),b.getY(part.vertexOffset+j));}}
  }
  oldUnion.union(oldBox);newUnion.union(newBox);minFloor=Math.min(minFloor,newBox.min.y);maxFloor=Math.max(maxFloor,newBox.min.y);
 }
 assert(maxError<.00005,`${clip.name} batch changed a vertex by ${maxError}m`);assert(minFloor>-.035&&maxFloor<.045,`${clip.name} floor ${minFloor}..${maxFloor}`);
 rows.push({clip:clip.name,samples:count+1,maxVertexErrorM:maxError,minFloor,maxFloor,oldEnvelope:{min:oldUnion.min.toArray(),max:oldUnion.max.toArray()},newEnvelope:{min:newUnion.min.toArray(),max:newUnion.max.toArray()}});console.log(`${clip.name}: ${count+1} poses, max vertex difference ${maxError.toExponential(3)}m`);
}
const oldCatalog=JSON.parse(await readFile(`${out}/catalog-prebatch.json`,'utf8')),newCatalog=JSON.parse(await readFile(`${out}/catalog.json`,'utf8'));for(const a of oldCatalog.assets)if(a.id!=='creature_voidstone_colossus')assert.equal(a.sha256,newCatalog.assets.find(n=>n.id===a.id).sha256,`${a.id} unexpected export`);
await writeFile(`${out}/batch-audit.json`,JSON.stringify({sourceMeshes:oldMeshes.size,batchedMeshes:afterMeshes,otherFiveHashesUnchanged:true,rows},null,2)+'\n');
