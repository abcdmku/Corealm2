import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const dir='assets/art/tripo/imports/creatures/audit-user-hollow-bough';
const root=(await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(`${dir}/creature_hollow_bough.glb`))).getRoot();
const p=root.listMeshes()[0].listPrimitives()[0],pos=p.getAttribute('POSITION').getArray(),joints=p.getAttribute('JOINTS_0').getArray(),weights=p.getAttribute('WEIGHTS_0').getArray();
const skin=root.listSkins()[0], bones=skin.listJoints(),bind=skin.getInverseBindMatrices().getArray();
const boneIndex=new Map(bones.map((b,i)=>[b,i]));
const rest=bones.map(b=>({t:b.getTranslation(),q:b.getRotation()}));
const matrix=()=>new THREE.Matrix4();
const ibms=bones.map((_,i)=>matrix().fromArray(bind,i*16));
const identity=new THREE.Vector3(1,1,1);
function sample(animation,time){
  const poses=rest.map(r=>({t:[...r.t],q:[...r.q]}));
  for(const channel of animation.listChannels()){
    const i=boneIndex.get(channel.getTargetNode()),path=channel.getTargetPath(),sampler=channel.getSampler();
    if(i===undefined)continue;
    const times=sampler.getInput().getArray(),values=sampler.getOutput().getArray(),stride=path==='rotation'?4:3;
    let lo=0;while(lo<times.length-2 && time>times[lo+1])lo++;
    const hi=Math.min(lo+1,times.length-1),f=times[hi]===times[lo]?0:Math.max(0,Math.min(1,(time-times[lo])/(times[hi]-times[lo])));
    const a=Array.from(values.slice(lo*stride,(lo+1)*stride)),b=Array.from(values.slice(hi*stride,(hi+1)*stride));
    poses[i][path==='rotation'?'q':'t']=path==='rotation'?new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b),f).toArray():a.map((v,k)=>v+(b[k]-v)*f);
  }
  const worlds=[];
  for(let i=0;i<bones.length;i++){
    const pose=poses[i],parent=boneIndex.get(bones[i].getParentNode());
    const local=matrix().compose(new THREE.Vector3(...pose.t),new THREE.Quaternion(...pose.q),identity);
    worlds[i]=parent===undefined?local:worlds[parent].clone().multiply(local);
  }
  const skinMatrices=worlds.map((w,i)=>w.clone().multiply(ibms[i]));
  const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
  const v=new THREE.Vector3(),tmp=new THREE.Vector3();
  for(let i=0;i<pos.length/3;i++){
    v.set(0,0,0);
    for(let s=0;s<4;s++){
      const w=weights[i*4+s];if(w<=0)continue;
      tmp.set(pos[i*3],pos[i*3+1],pos[i*3+2]).applyMatrix4(skinMatrices[joints[i*4+s]]);
      v.addScaledVector(tmp,w);
    }
    for(let k=0;k<3;k++){const n=v.getComponent(k)*3.25;bounds.min[k]=Math.min(bounds.min[k],n);bounds.max[k]=Math.max(bounds.max[k],n);}
  }
  return {...bounds,height:bounds.max[1]-bounds.min[1]};
}
const results={};
for(const a of root.listAnimations()){
  const samplers=a.listSamplers(),duration=Math.max(...samplers.map(s=>s.getInput().getArray().at(-1)));
  const samples=Array.from({length:17},(_,i)=>({time:duration*i/16,...sample(a,duration*i/16)}));
  results[a.getName()]={duration,samples,minY:Math.min(...samples.map(s=>s.min[1])),final:samples.at(-1)};
}
const idle=results.Idle.final,death=results.Death.final;
const summary={jointCount:bones.length,vertexCount:pos.length/3,clips:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,{duration:r.duration,minY:r.minY,final:r.final}])),deathHeightRatio:death.height/idle.height,deathGroundY:death.min[1],attackContactSeconds:.52,attackContactBounds:sample(root.listAnimations().find(a=>a.getName()==='Attack'),.52)};
await writeFile(`${dir}/motion-audit.json`,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
