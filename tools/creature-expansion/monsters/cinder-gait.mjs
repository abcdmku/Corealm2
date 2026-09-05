import * as THREE from 'three';
import { closeLoop } from './common.mjs';

const point = bone => bone.getWorldPosition(new THREE.Vector3());
const quaternion = bone => bone.getWorldQuaternion(new THREE.Quaternion());

function aim(bone, child, target) {
  bone.updateWorldMatrix(true,true);
  const turn = new THREE.Quaternion().setFromUnitVectors(point(child).sub(point(bone)).normalize(),target.clone().sub(point(bone)).normalize());
  const world = quaternion(bone).premultiply(turn);
  bone.quaternion.copy(quaternion(bone.parent).invert().multiply(world)).normalize();
  bone.updateWorldMatrix(true,true);
}

function solveLeg(leg, ankleTarget, ankleWorldQuaternion, sourcePole) {
  const origin = point(leg.hip), first = origin.distanceTo(point(leg.knee)), second = point(leg.knee).distanceTo(point(leg.ankle));
  const direction = ankleTarget.clone().sub(origin), distance = direction.length();
  if (distance > first+second-.0001 || distance < Math.abs(first-second)+.0001) throw new Error(`Cinder ${leg.side} leg target unreachable: ${distance} / ${first+second}`);
  direction.normalize();
  const pole = sourcePole.clone().addScaledVector(direction,-sourcePole.dot(direction));
  if (pole.lengthSq()<1e-8) {pole.set(leg.side==='l'?.2:-.2,0,1);pole.addScaledVector(direction,-pole.dot(direction));}
  pole.normalize();
  const cosine = THREE.MathUtils.clamp((first*first+distance*distance-second*second)/(2*first*distance),-1,1);
  const targetKnee = origin.clone().addScaledVector(direction,first*cosine).addScaledVector(pole,first*Math.sqrt(1-cosine*cosine));
  aim(leg.hip,leg.knee,targetKnee);
  aim(leg.knee,leg.ankle,ankleTarget);
  leg.ankle.quaternion.copy(quaternion(leg.ankle.parent).invert().multiply(ankleWorldQuaternion)).normalize();
  leg.ankle.updateWorldMatrix(true,true);
  const residual = point(leg.ankle).distanceTo(ankleTarget);
  if (residual>.001) throw new Error(`Cinder ${leg.side} IK residual ${residual}`);
  return {residual,kneeDegrees:THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp((first*first+second*second-distance*distance)/(2*first*second),-1,1)))};
}

function footPath(phase, speed, duration, support, lift) {
  const sweep = speed*duration*support;
  if (phase<support) return {z:sweep*(.5-phase/support),y:0,stance:true};
  const u=(phase-support)/(1-support),u2=u*u,u3=u2*u;
  const tangent=-sweep*(1-support)/support;
  // The swing enters and leaves with the same backward velocity as stance,
  // so the planted path has no sudden velocity change at lift-off or landing.
  const z=(2*u3-3*u2+1)*(-sweep/2)+(u3-2*u2+u)*tangent+(-2*u3+3*u2)*(sweep/2)+(u3-u2)*tangent;
  return {z,y:lift*Math.sin(Math.PI*u)**2,stance:false};
}

function footVertices(object, side) {
  const selected=[];
  object.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    const boneIds=new Set(mesh.skeleton.bones.flatMap((bone,index)=>(bone.name===`foot${side}` || bone.name.startsWith('toes_')&&bone.name.endsWith(side))?[index]:[]));
    const vertices=[];
    for(let i=0;i<indices.count;i++){
      let footWeight=0;
      for(let c=0;c<4;c++)if(boneIds.has(indices.getComponent(i,c)))footWeight+=weights.getComponent(i,c);
      if(footWeight>.001)vertices.push(i);
    }
    if(vertices.length)selected.push({mesh,vertices});
  });
  if(!selected.length)throw new Error(`Cinder ${side} foot has no weighted contact vertices`);
  return selected;
}

function soleHeight(parts) {
  const vertex=new THREE.Vector3();let height=Infinity;
  for(const {mesh,vertices} of parts)for(const index of vertices){mesh.getVertexPosition(index,vertex).applyMatrix4(mesh.matrixWorld);height=Math.min(height,vertex.y);}
  return height;
}

/** Preserve source torso/foot roll and solve shorter, exactly planted toe paths. */
export function compressCinderGaits(object, clips) {
  const pelvis=object.getObjectByName('rootx');
  const legs=['l','r'].map(side=>({side,hip:object.getObjectByName(`thigh_stretch${side}`),knee:object.getObjectByName(`leg_stretch${side}`),ankle:object.getObjectByName(`foot${side}`),toe:object.getObjectByName(`toes_01${side}`),sole:footVertices(object,side)}));
  const originalPose=new Map();
  object.traverse(node=>{if(node.isBone)originalPose.set(node,{position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone()});});
  const report=[];
  const lower=[];
  object.traverse(node=>{if(node.isBone && /^(?:thigh_|leg_|foot[lr]$|toes_)/.test(node.name))lower.push(node);});
  for(const name of ['Walk','Run']) {
    const index=clips.findIndex(clip=>clip.name===name),source=clips[index];
    const run=name==='Run',speed=run?3:.9,support=run?.34:.60,lift=run?.24:.12;
    const sourceSamplers=source.tracks.map(track=>{const split=track.name.lastIndexOf('.');return{node:object.getObjectByName(track.name.slice(0,split)),property:track.name.slice(split+1),interpolant:track.createInterpolant()};});
    // IK overwrites source channels. Direct sampling restores even constant
    // channels that AnimationMixer would otherwise skip on its unchanged-value path.
    const sourcePose=time=>{for(const node of [pelvis,...lower]){const saved=originalPose.get(node);node.position.copy(saved.position);node.quaternion.copy(saved.quaternion);node.scale.copy(saved.scale);}for(const {node,property,interpolant} of sourceSamplers)node[property].fromArray(interpolant.evaluate(time));object.updateMatrixWorld(true);};
    const neutralAnkles=new Map(),neutralPoles=new Map();
    for(const leg of legs){sourcePose(source.duration*(leg.side==='r'?.1:.6));neutralAnkles.set(leg.side,quaternion(leg.ankle));const hip=point(leg.hip),axis=point(leg.ankle).sub(hip).normalize(),pole=point(leg.knee).sub(hip);neutralPoles.set(leg.side,pole.addScaledVector(axis,-pole.dot(axis)).normalize());}
    const bakeHz=run?960:240,frames=Math.ceil(source.duration*bakeHz),times=[];
    const channels=new Map(lower.map(node=>[node,{position:[],quaternion:[],scale:[]} ]));
    const rootPositions=[],samples=[];let maxResidual=0,minKnee=Infinity,maxKnee=0;
    for(let i=0;i<=frames;i++) {
      const t=source.duration*i/frames,phase=i/frames;
      sourcePose(t);
      const references=legs.map(leg=>{
        const hip=point(leg.hip),sourceAxis=point(leg.ankle).sub(hip).normalize(),pole=point(leg.knee).sub(hip);
        pole.addScaledVector(sourceAxis,-pole.dot(sourceAxis));
        if(pole.lengthSq()<1e-8)pole.copy(neutralPoles.get(leg.side));
        pole.normalize();
        if(run)pole.lerp(neutralPoles.get(leg.side),.5).normalize();
        const ankleQ=quaternion(leg.ankle);
        // The original sprint rolls the ankle through a six-metre stride.
        // Retain its timing, with smaller roll around the source planted pose.
        if(run)ankleQ.copy(neutralAnkles.get(leg.side).clone().slerp(ankleQ,.4));
        const toeOffset=leg.toe.position.clone().multiply(leg.ankle.getWorldScale(new THREE.Vector3())).applyQuaternion(ankleQ);
        return {leg,ankleQ,toeOffset,pole};
      });
      // Short strides need less hip rise than the original six-metre sprint.
      // Keep the source pelvic rotation, lateral motion and full upper-body pose.
      const pelvisWorld=point(pelvis);
      pelvisWorld.y=(run?1.17:1.215)+(run?.016:.008)*Math.cos(4*Math.PI*phase);
      pelvis.position.copy(pelvis.parent.worldToLocal(pelvisWorld));
      object.updateMatrixWorld(true);
      for(const {leg,ankleQ,toeOffset,pole} of references) {
        const footPhase=(phase+(leg.side==='r'?.07:.57))%1;
        const path=footPath(footPhase,speed,source.duration,support,lift);
        const toeTarget=new THREE.Vector3(leg.side==='l'?.34:-.34,.035+path.y,path.z);
        solveLeg(leg,toeTarget.clone().sub(toeOffset),ankleQ,pole);
        // Source ankle roll changes the sole's offset below the toe bone.
        // Ground the actual weighted foot surface without lifting the body.
        object.updateMatrixWorld(true);
        toeTarget.y+=.002+path.y-soleHeight(leg.sole);
        const result=solveLeg(leg,toeTarget.clone().sub(toeOffset),ankleQ,pole);
        maxResidual=Math.max(maxResidual,result.residual);
        minKnee=Math.min(minKnee,result.kneeDegrees);maxKnee=Math.max(maxKnee,result.kneeDegrees);
        if(i<frames)samples.push({phase,side:leg.side,stance:path.stance,toeTarget:toeTarget.toArray(),actualToe:point(leg.toe).toArray()});
      }
      object.updateMatrixWorld(true);times.push(t);rootPositions.push(...pelvis.position.toArray());
      for(const node of lower){const data=channels.get(node);data.position.push(...node.position.toArray());data.quaternion.push(...node.quaternion.toArray());data.scale.push(...node.scale.toArray());}
    }
    for(const [node,saved] of originalPose){node.position.copy(saved.position);node.quaternion.copy(saved.quaternion);node.scale.copy(saved.scale);}
    object.updateMatrixWorld(true);
    const rewritten=new Set([`${pelvis.name}.position`,...lower.flatMap(node=>['position','quaternion','scale'].map(property=>`${node.name}.${property}`))]);
    const tracks=source.tracks.filter(track=>!rewritten.has(track.name)).map(track=>track.clone());
    tracks.push(new THREE.VectorKeyframeTrack(`${pelvis.name}.position`,times,rootPositions));
    for(const [node,data] of channels){tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`,times,data.position),new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`,times,data.quaternion),new THREE.VectorKeyframeTrack(`${node.name}.scale`,times,data.scale));}
    clips[index]=closeLoop(new THREE.AnimationClip(name,source.duration,tracks));
    report.push({name,nativeDuration:source.duration,targetStanceMps:speed,supportFraction:support,toeStanceSweepM:speed*source.duration*support,liftM:lift,bakeHz,maxIkResidualM:maxResidual,kneeInteriorDegrees:[minKnee,maxKnee],method:'Toe target moves backward at constant world metres per second while planted. Source foot roll and projected source knee bend plane are retained, with Run roll at 40% and knee-plane variation at 50% around the source planted pose. Two-bone IK changes only lower-body gait channels; source upper-body channels are copied.',samples});
  }
  for(const [node,saved] of originalPose){node.position.copy(saved.position);node.quaternion.copy(saved.quaternion);node.scale.copy(saved.scale);}
  object.updateMatrixWorld(true);
  return report;
}

/** Seal the remaining between-key skin curvature without changing contact X/Z. */
export function sealCinderGaitFloor(object, clips) {
  const root=object.getObjectByName('rootx'),report=[];
  object.updateMatrixWorld(true);
  const origin=root.parent.localToWorld(new THREE.Vector3());
  const unitY=root.parent.localToWorld(new THREE.Vector3(0,1,0)).y-origin.y;
  for(const clip of clips) {
    const track=clip.tracks.find(track=>track.name==='rootx.position');
    const corrections=new Float32Array(track.times.length),mixer=new THREE.AnimationMixer(object);
    const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const frames=Math.ceil(clip.duration*480);let index=0,lowest=Infinity;
    for(let i=0;i<=frames;i++) {
      const t=clip.duration*i/frames;
      mixer.setTime(t);object.updateMatrixWorld(true);
      const y=new THREE.Box3().setFromObject(object,true).min.y;lowest=Math.min(lowest,y);
      while(index+1<track.times.length && track.times[index+1]<t)index++;
      const correction=y<.001?.001-y:0;
      corrections[index]=Math.max(corrections[index],correction);
      const next=Math.min(index+1,corrections.length-1);corrections[next]=Math.max(corrections[next],correction);
    }
    mixer.stopAllAction();mixer.uncacheRoot(object);
    corrections[0]=corrections[corrections.length-1]=Math.max(corrections[0],corrections[corrections.length-1]);
    for(let i=0;i<corrections.length;i++)track.values[i*3+1]+=corrections[i]/unitY;
    closeLoop(clip);
    report.push({name:clip.name,minimumBeforeM:lowest,maxAdditionalLiftM:Math.max(...corrections),sampleHz:480});
  }
  return report;
}
