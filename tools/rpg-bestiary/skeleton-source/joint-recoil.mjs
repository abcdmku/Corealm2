import * as THREE from 'three';

export const HIT_PROVENANCE='Corealm-authored joint recoil (Spine1/Neck/Head/clavicles/arms) over source idle pose; replaces the earlier root-lean proposal';
export const RECOIL_TIMES=[0,.1,.27,.58];
const ENVELOPE=[0,1,.45,0];
const quaternion=values=>new THREE.Quaternion().fromArray(values);

/** Author absolute rotations, with optional original role Hit arm curves as the base.
 * World -X pitches an upright +Y chest toward -Z. Convert through the idle
 * parent frame, then through idle local rotation for right-multiplied deltas:
 * delta = idle^-1 * parentWorld^-1 * worldDelta * parentWorld * idle.
 * No hierarchy state or input clip is mutated; absent channels stay absent.
 */
export function jointRecoil(object,idle,side,existing=idle) {
  if(![0,1,-1].includes(side))throw new Error('Invalid recoil side');
  const states=[];object.traverse(node=>states.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]));
  try {
    for(const track of idle.tracks){const split=track.name.lastIndexOf('.'),node=object.getObjectByName(track.name.slice(0,split));if(node)node[track.name.slice(split+1)].fromArray(track.createInterpolant().evaluate(0));}
    object.updateMatrixWorld(true);
    const specs=[['Bip001',0,0,0],['Bip001_Spine1',-.14,0,side*.10],['Bip001_Neck',-.10,0,side*.08],['Bip001_Head',-.18,0,0]];
    for(const [label,sign] of [['L',1],['R',-1]]) {
      specs.push([`Bip001_${label}_Clavicle`,0,0,sign*.05]);
      // Mirrored world Z flare and world X backward swing, total angle .20.
      specs.push([`Bip001_${label}_UpperArm`,.12,0,sign*.16]);
      specs.push([`Bip001_${label}_Forearm`,.15,0,0]);
    }
    return specs.flatMap(([name,x,y,z])=>{
      const key=name+'.quaternion',input=existing.tracks.find(track=>track.name===key),idleTrack=idle.tracks.find(track=>track.name===key);
      if(!input||!idleTrack)return [];
      const node=object.getObjectByName(name);if(!node)throw new Error('Missing recoil node '+name);
      const idleValues=Array.from(idleTrack.createInterpolant().evaluate(0)),idleQ=quaternion(idleValues).normalize();
      const parentQ=node.parent.getWorldQuaternion(new THREE.Quaternion()).normalize();
      const axis=new THREE.Vector3(x,y,z),angle=axis.length();axis.normalize().applyQuaternion(parentQ.clone().invert()).applyQuaternion(idleQ.clone().invert());
      const arm=/_(UpperArm|Forearm)$/.test(name),sample=input.createInterpolant();
      // Retain every role curve knot as well as the four envelope knots.
      const times=Array.from(new Set([...RECOIL_TIMES.map(Math.fround),...(arm?Array.from(input.times).filter(t=>t<=Math.fround(.58)):[])])).sort((a,b)=>a-b);
      const values=times.flatMap(time=>{
        let i=0;while(i<2&&time>Math.fround(RECOIL_TIMES[i+1]))i++;
        const a=Math.fround(RECOIL_TIMES[i]),b=Math.fround(RECOIL_TIMES[i+1]);
        const weight=THREE.MathUtils.lerp(ENVELOPE[i],ENVELOPE[i+1],(time-a)/(b-a));
        const base=arm?Array.from(sample.evaluate(time)):idleValues;
        if(weight===0||angle===0)return base; // Exact original endpoint components.
        return quaternion(base).multiply(new THREE.Quaternion().setFromAxisAngle(axis,angle*weight)).toArray();
      });
      return [new THREE.QuaternionKeyframeTrack(key,times,values)];
    });
  } finally {
    for(const [node,p,q,s] of states){node.position.copy(p);node.quaternion.copy(q);node.scale.copy(s);}object.updateMatrixWorld(true);
  }
}
