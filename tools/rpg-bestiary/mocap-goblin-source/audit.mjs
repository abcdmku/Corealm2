import fs from 'node:fs';
import * as T from 'three';
import {buildNativeGoblin,buildMocapGoblin} from './goblin.mjs';
const {object,clips,meshes,data}=buildNativeGoblin(),mixer=new T.AnimationMixer(object),rows=[];
for(const sample of data.nativeSamples){
  const clip=clips.find(c=>c.name===sample.action),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(sample.time);object.updateMatrixWorld(true);
  let maxError=0,sum=0,count=0;for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    const vertex=mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld),expected=new T.Vector3().fromArray(sample.positions[mesh.userData.sourceControlIndices[i]]),error=vertex.distanceTo(expected);maxError=Math.max(maxError,error);sum+=error*error;count++;
  }
  rows.push({clip:sample.action,time:sample.time,maxError,rmsError:Math.sqrt(sum/count)});action.stop();mixer.uncacheClip(clip);
}
const built=buildMocapGoblin(),runtimeMixer=new T.AnimationMixer(built.object),runtime=[];
for(const clip of built.clips){const action=runtimeMixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();let minFloor=Infinity,maxSpan=0;
  for(let i=0;i<=Math.ceil(clip.duration*60);i++){runtimeMixer.setTime(Math.min(clip.duration,i/60));built.object.updateMatrixWorld(true);const b=new T.Box3().setFromObject(built.object,true);minFloor=Math.min(minFloor,b.min.y);maxSpan=Math.max(maxSpan,b.getSize(new T.Vector3()).length());}
  runtime.push({clip:clip.name,duration:clip.duration,minFloor,maxSpan});action.stop();runtimeMixer.uncacheClip(clip);
}
const report={sourceWeightReduction:data.weightReduction,sourceParity:rows,runtime,acceptance:'CPU conversion audit only; native mocap self-intersection warning remains pending production review'};
fs.mkdirSync('test-results/mocap-goblin-source',{recursive:true});fs.writeFileSync('test-results/mocap-goblin-source/audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({maxSourceError:Math.max(...rows.map(r=>r.maxError)),weightReduction:data.weightReduction,runtime}));
if(rows.some(r=>r.maxError>.001))throw Error('Source pose mismatch');
if(runtime.some(r=>r.minFloor<-.003))throw Error('Ground penetration');
