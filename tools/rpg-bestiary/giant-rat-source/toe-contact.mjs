import * as T from 'three';

/** Approved scope: Walk hind distal toes and Death front-right distal toe only. */
export function repairIsolatedToeContact(object,clips){
  const meshes=[];object.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
  const plans={Walk:['BackLeg_L_003','BackLeg_R_003'],Death:['FrontLeg_R_003']};
  const mixer=new T.AnimationMixer(object),report={targetClearanceMeters:.0005,axis:'minimum slerp toward upright native Idle toe orientation, preserving each current toe pivot; excludes inverted-foot alternative solutions',changedChannels:[],untouchedHold:['Walk front feet','Run'],maximumAngularCorrectionDegrees:0};
  mixer.clipAction(clips.find(c=>c.name==='Idle')).play();mixer.setTime(0);object.updateMatrixWorld(true);
  const idleWorld=new Map(meshes[0].skeleton.bones.map(b=>[b.name,b.getWorldQuaternion(new T.Quaternion())]));mixer.stopAllAction();
  for(const [name,suffixes]of Object.entries(plans)){
    const clip=clips.find(c=>c.name===name),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const count=Math.ceil(clip.duration*240),sampleSet=new Set(Array.from({length:count+1},(_,i)=>clip.duration*i/count));
    for(const track of clip.tracks)for(const time of track.times)sampleSet.add(time);
    mixer.setTime(0);object.updateMatrixWorld(true);
    const times=[...sampleSet].sort((a,b)=>a-b),targets=suffixes.map(suffix=>{
      const bone=meshes[0].skeleton.bones.find(b=>b.name.endsWith(suffix));if(!bone)throw new Error(`Missing distal toe ${suffix}`);
      const affected=[];for(const mesh of meshes){const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;for(let v=0;v<indices.count;v++)for(let k=0;k<4;k++)if(mesh.skeleton.bones[indices.array[v*4+k]]===bone&&weights.array[v*4+k]>1e-8){affected.push([mesh,v]);break;}}
      return {bone,referenceWorld:idleWorld.get(bone.name).clone(),affected,values:[],maxAngle:0,changedSamples:0,unresolvedSamples:0,minimumNativeY:Infinity};
    });
    for(const time of times){
      mixer.setTime(time);object.updateMatrixWorld(true);
      for(const target of targets){
        const {bone,affected}=target,original=bone.quaternion.clone(),world=bone.getWorldQuaternion(new T.Quaternion()),parentInverse=bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
        const minimum=()=>Math.min(...affected.map(([mesh,v])=>mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld).y));
        const reference=target.referenceWorld.clone();
        const setWorld=q=>{bone.quaternion.copy(parentInverse).multiply(q);object.updateMatrixWorld(true);return minimum();};
        const nativeY=minimum();target.minimumNativeY=Math.min(target.minimumNativeY,nativeY);
        let desired=reference.clone();
        if(setWorld(desired)<.0005){
          let found=false;
          outer:for(let degrees=1;degrees<=45;degrees++)for(let direction=0;direction<36;direction++){
            const a=direction*Math.PI/18,axis=new T.Vector3(Math.cos(a),0,Math.sin(a));
            const q=new T.Quaternion().setFromAxisAngle(axis,degrees*Math.PI/180).multiply(reference);
            if(setWorld(q)>=.0005){desired=q;found=true;break outer;}
          }
          if(!found)throw new Error(`No upright distal orientation clears ${name}/${bone.name} at ${time}`);
        }
        const idleUp=new T.Vector3(0,1,0).applyQuaternion(reference.clone().invert());
        const evaluate=weight=>{const q=world.clone().slerp(desired,weight),up=idleUp.clone().applyQuaternion(q).y;const floor=setWorld(q);return floor>=.0005&&up>=.75;};
        let chosen=0;
        if(!evaluate(0)){
          let hi=0,found=false;for(let step=1;step<=100;step++){hi=step/100;if(evaluate(hi)){found=true;break;}}
          if(!found)throw new Error(`No bounded upright toe interpolation for ${name}/${bone.name} at ${time}`);
          let lo=hi-.01;for(let k=0;k<17;k++){const mid=(lo+hi)/2;if(evaluate(mid))hi=mid;else lo=mid;}chosen=hi;target.changedSamples++;
        }
        evaluate(chosen);
        const correctionAngle=original.angleTo(bone.quaternion);
        target.values.push(...bone.quaternion.toArray());target.maxAngle=Math.max(target.maxAngle,correctionAngle);
        bone.quaternion.copy(original);object.updateMatrixWorld(true);
      }
    }
    action.stop();mixer.uncacheClip(clip);
    for(const target of targets){const channel=`${target.bone.name}.quaternion`;clip.tracks=clip.tracks.filter(t=>t.name!==channel);clip.tracks.push(new T.QuaternionKeyframeTrack(channel,times,target.values));const maxDegrees=target.maxAngle*180/Math.PI;report.maximumAngularCorrectionDegrees=Math.max(report.maximumAngularCorrectionDegrees,maxDegrees);report.changedChannels.push({clip:name,channel,samples:times.length,affectedExpandedVertices:target.affected.length,changedSamples:target.changedSamples,maximumAngularCorrectionDegrees:maxDegrees,minimumNativeY:target.minimumNativeY});}
  }
  mixer.stopAllAction();object.updateMatrixWorld(true);return report;
}
