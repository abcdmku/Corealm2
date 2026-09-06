import fs from 'node:fs';
import * as T from 'three';
import {buildHarpy} from './harpy.mjs';
const ids=process.argv.slice(2);if(!ids.length)ids.push('harpy','cliff_harpy','storm_harpy');
const materialKey=m=>JSON.stringify([m.name,m.color.getHex(),m.roughness,m.metalness,m.side,m.opacity]);
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function exactAttribute(a,b,label){assert(a.itemSize===b.itemSize&&a.count===b.count,label+' dimensions');for(let i=0;i<a.array.length;i++)assert(a.array[i]===b.array[i],label+' value '+i);}
for(const id of ids){
 const before=buildHarpy(id,{mergeAttachments:false}),after=buildHarpy(id),oldSources=[],newSources=[],rigid=[],merged=new Map();
 before.object.traverse(n=>{if(n.isSkinnedMesh)oldSources.push(n);else if(n.isMesh)rigid.push(n);});
 after.object.traverse(n=>{if(!n.isMesh)return;if(n.name.startsWith(`${id}_batched_`))merged.set(materialKey(n.material),n);else newSources.push(n);});
 assert(oldSources.length===newSources.length,'Source mesh count');for(let i=0;i<oldSources.length;i++){const a=oldSources[i],b=newSources[i];assert(a.name===b.name&&materialKey(a.material)===materialKey(b.material),'Source identity');for(const key of Object.keys(a.geometry.attributes))exactAttribute(a.geometry.attributes[key],b.geometry.attributes[key],a.name+' '+key);exactAttribute(a.geometry.index,b.geometry.index,a.name+' index');}
 const offsets=new Map(),mapping=[];let attachmentVertices=0,attachmentTriangles=0;
 for(const oldMesh of rigid){const key=materialKey(oldMesh.material),newMesh=merged.get(key);assert(newMesh,'Missing material '+key);const offset=offsets.get(key)||{vertex:0,index:0};const a=oldMesh.geometry,b=newMesh.geometry,count=a.attributes.position.count,boneIndex=newMesh.skeleton.bones.findIndex(n=>n.name===oldMesh.parent.name);assert(boneIndex>=0,'Missing bone');
  for(let i=0;i<count;i++){for(let k=0;k<a.attributes.uv.itemSize;k++)assert(a.attributes.uv.array[i*2+k]===b.attributes.uv.array[(offset.vertex+i)*2+k],oldMesh.name+' UV');for(let k=0;k<4;k++){assert(b.attributes.skinIndex.array[(offset.vertex+i)*4+k]===(k===0?boneIndex:0),'Attachment joint assignment');assert(b.attributes.skinWeight.array[(offset.vertex+i)*4+k]===(k===0?1:0),'Attachment weight');}}
  for(let i=0;i<a.index.count;i++)assert(a.index.array[i]+offset.vertex===b.index.array[i+offset.index],oldMesh.name+' topology');
  mapping.push({oldMesh,newMesh,start:offset.vertex,count,boneIndex});attachmentVertices+=count;attachmentTriangles+=a.index.count/3;offsets.set(key,{vertex:offset.vertex+count,index:offset.index+a.index.count});
 }
 for(const [key,offset]of offsets){const g=merged.get(key).geometry;assert(offset.vertex===g.attributes.position.count&&offset.index===g.index.count,'Merged range coverage');}
 const x=new T.Vector3(),y=new T.Vector3(),nx=new T.Vector3(),ny=new T.Vector3(),skinMatrix=new T.Matrix4(),oldNormal=new T.Matrix3(),newNormal=new T.Matrix3(),skinNormal=new T.Matrix3();
 let maximumWorldPointDifference=0,maximumWorldNormalDifference=0;const poses=[];
 function compare(label){before.object.updateMatrixWorld(true);after.object.updateMatrixWorld(true);let point=0,normal=0;for(const {oldMesh,newMesh,start,count,boneIndex}of mapping){const bone=newMesh.skeleton.bones[boneIndex];oldNormal.getNormalMatrix(oldMesh.matrixWorld);newNormal.getNormalMatrix(newMesh.matrixWorld);skinMatrix.copy(newMesh.bindMatrixInverse).multiply(bone.matrixWorld).multiply(newMesh.skeleton.boneInverses[boneIndex]).multiply(newMesh.bindMatrix);skinNormal.setFromMatrix4(skinMatrix);
   for(let i=0;i<count;i++){x.fromBufferAttribute(oldMesh.geometry.attributes.position,i).applyMatrix4(oldMesh.matrixWorld);newMesh.getVertexPosition(start+i,y).applyMatrix4(newMesh.matrixWorld);point=Math.max(point,x.distanceTo(y));nx.fromBufferAttribute(oldMesh.geometry.attributes.normal,i).applyNormalMatrix(oldNormal);ny.fromBufferAttribute(newMesh.geometry.attributes.normal,start+i).applyMatrix3(skinNormal).applyNormalMatrix(newNormal);normal=Math.max(normal,nx.distanceTo(ny));}
  }assert(point<1e-6,`${id} ${label} point ${point}`);assert(normal<1e-5,`${id} ${label} normal ${normal}`);maximumWorldPointDifference=Math.max(maximumWorldPointDifference,point);maximumWorldNormalDifference=Math.max(maximumWorldNormalDifference,normal);poses.push({pose:label,maximumWorldPointDifference:point,maximumWorldNormalDifference:normal});}
 compare('rest');const bm=new T.AnimationMixer(before.object),am=new T.AnimationMixer(after.object);
 for(let c=0;c<before.clips.length;c++){const ba=bm.clipAction(before.clips[c]),aa=am.clipAction(after.clips[c]);for(const a of [ba,aa]){a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();}for(const phase of [0,.25,.5,.75,1]){bm.setTime(before.clips[c].duration*phase);am.setTime(after.clips[c].duration*phase);compare(`${before.clips[c].name}@${phase}`);}ba.stop();aa.stop();}
 const record={id,passed:true,sourceMeshesExactlyPreserved:oldSources.length,attachmentMeshRanges:mapping.length,attachmentVertices,attachmentTriangles,uvValuesExactlyPreserved:true,triangleIndicesExactlyPreserved:true,materialAssignmentsExactlyPreserved:true,boneNamesAndRigidWeightsExactlyPreserved:true,maximumWorldPointDifference,maximumWorldNormalDifference,poses};fs.writeFileSync(`tools/rpg-bestiary/harpy-source/${id}-surface-check.json`,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({...record,poses:poses.length}));
}
