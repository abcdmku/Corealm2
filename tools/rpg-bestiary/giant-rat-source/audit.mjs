import fs from 'node:fs';
import * as T from 'three';
import {loadNativeRatSource} from '../../creature-expansion/mammals/source-porcupine.mjs';
import {buildGiantRat} from './giant-rat.mjs';
const upstream=await loadNativeRatSource(),built=await buildGiantRat('giant_rat',{repair:false}),document=upstream.document,root=document.getRoot(),mixer=new T.AnimationMixer(built.object),rows=[];
const originalNodes=root.listNodes(),rest=originalNodes.map(n=>({n,t:[...n.getTranslation()],r:[...n.getRotation()],s:[...n.getScale()]}));
const meshes=[];built.object.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
function animate(animation,time){
  for(const {n,t,r,s}of rest)n.setTranslation(t).setRotation(r).setScale(s);
  for(const channel of animation.listChannels()){
    const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray(),type=channel.getTargetPath(),size=type==='rotation'?4:3;
    let a=0;while(a<times.length-1&&times[a+1]<=time)a++;const b=Math.min(a+1,times.length-1),f=a===b||sampler.getInterpolation()==='STEP'?0:(time-times[a])/(times[b]-times[a]);
    const result=type==='rotation'?new T.Quaternion().fromArray(values,a*size).slerp(new T.Quaternion().fromArray(values,b*size),f).toArray():new T.Vector3().fromArray(values,a*size).lerp(new T.Vector3().fromArray(values,b*size),f).toArray();
    const node=channel.getTargetNode();if(type==='rotation')node.setRotation(result);else if(type==='translation')node.setTranslation(result);else node.setScale(result);
  }
}
for(const clip of built.clips){
  const nativeName=built.meta.nativeClipMapping[clip.name],animation=root.listAnimations().find(a=>a.getName()===nativeName),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();let maxError=0,minFloor=Infinity;
  for(const phase of [0,.173,.5,.831,1]){
    const time=clip.duration*phase;animate(animation,time);mixer.setTime(time);built.object.updateMatrixWorld(true);
    minFloor=Math.min(minFloor,new T.Box3().setFromObject(built.object,true).min.y);
    const unwrap=built.object.getObjectByName('giant_rat_floor').matrixWorld.clone().invert();let mi=0;
    for(const node of originalNodes)if(node.getMesh()){
      const skin=node.getSkin(),jointMatrices=skin.listJoints().map((joint,i)=>new T.Matrix4().fromArray(joint.getWorldMatrix()).multiply(new T.Matrix4().fromArray(skin.getInverseBindMatrices().getArray(),i*16)));
      for(const primitive of node.getMesh().listPrimitives()){
        const mesh=meshes[mi++],position=primitive.getAttribute('POSITION').getArray(),indices=primitive.getAttribute('JOINTS_0').getArray(),weights=primitive.getAttribute('WEIGHTS_0').getArray();
        for(let v=0;v<position.length/3;v++){
          const expected=new T.Vector3(),original=new T.Vector3().fromArray(position,v*3);for(let k=0;k<4;k++)if(weights[v*4+k])expected.addScaledVector(original.clone().applyMatrix4(jointMatrices[indices[v*4+k]]),weights[v*4+k]);
          const actual=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(unwrap);maxError=Math.max(maxError,expected.distanceTo(actual)*upstream.normalizedPreviewScale);
        }
      }
    }
  }
  action.stop();mixer.uncacheClip(clip);rows.push({clip:clip.name,nativeName,samples:5,maxNormalizedErrorMeters:maxError,minFloor});
}
const result={sha256:upstream.sha256,joints:meshes[0].skeleton.bones.length,upstreamCorrectives:upstream.report.translationCorrectiveJoints,rows};
fs.writeFileSync('tools/rpg-bestiary/giant-rat-source/audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(result.joints!==133||rows.some(r=>r.maxNormalizedErrorMeters>1e-5))throw new Error('Adapter parity or floor audit failed');
