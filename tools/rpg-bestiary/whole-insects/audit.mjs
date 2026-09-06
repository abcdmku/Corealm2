import fs from 'node:fs';
import * as THREE from 'three';
import { buildWholeInsect } from './index.mjs';

const results=[];
for(const id of ['webweaver_spider','marsh_wasp']){
 const {object,clips,meta}=buildWholeInsect(id),mixer=new THREE.AnimationMixer(object),rows=[];
 let maxWeightError=0;
 object.traverse(n=>{if(n.isSkinnedMesh){const w=n.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++){const sum=w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i);maxWeightError=Math.max(maxWeightError,Math.abs(sum-1));}}});
 for(const clip of clips){
  mixer.stopAllAction();const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();let floor=Infinity,largestSpan=0;const roots=[];
  for(let i=0;i<=73;i++){
   mixer.setTime(clip.duration*i/73);object.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(object,true);
   if(![...b.min.toArray(),...b.max.toArray()].every(Number.isFinite))throw new Error(`${id}/${clip.name}: nonfinite geometry`);
   floor=Math.min(floor,b.min.y);largestSpan=Math.max(largestSpan,b.getSize(new THREE.Vector3()).length());
   roots.push(object.getObjectByName('Root').getWorldPosition(new THREE.Vector3()));
  }
  if(floor<-.0001)throw new Error(`${id}/${clip.name}: floor ${floor}`);
  rows.push({clip:clip.name,duration:clip.duration,samples:74,minimumY:floor,largestBoundingDiagonal:largestSpan,rootCycleDisplacement:roots[0].distanceTo(roots.at(-1))});
 }
 const walk=clips.find(c=>c.name==='Walk'),run=clips.find(c=>c.name==='Run');
 for(const track of walk.tracks.filter(t=>!t.name.startsWith('insect_'))){
  const faster=run.tracks.find(t=>t.name===track.name);
  if(!faster||track.values.some((v,i)=>v!==faster.values[i]))throw new Error(`${id}: native run values modified`);
 }
 if(maxWeightError>1e-5)throw new Error(`${id}: unnormalized weights`);
 results.push({id,rig:meta.rig,attackContact:meta.attackContact,attackContactMethod:meta.attackContactSource,maxWeightError,nativeRunValuesIdenticalToWalk:true,clips:rows,visualAcceptance:'pending'});
}
const report={method:'CPU original weighted meshes evaluated at 74 independent times per clip; source Run joint values identical to Walk, only time scale changes.',results};
fs.writeFileSync(new URL('./cpu-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
