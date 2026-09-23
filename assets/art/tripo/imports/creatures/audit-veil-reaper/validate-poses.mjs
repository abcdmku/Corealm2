import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';

const file='assets/art/tripo/imports/creatures/audit-veil-reaper/veil-reaper-native-rig.glb';
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(file));
const root=doc.getRoot(),primitive=root.listMeshes()[0].listPrimitives()[0],skin=root.listSkins()[0];
const positions=primitive.getAttribute('POSITION').getArray(),joints=primitive.getAttribute('JOINTS_0').getArray(),weights=primitive.getAttribute('WEIGHTS_0').getArray();
const inverse=skin.getInverseBindMatrices().getArray(),jointNodes=skin.listJoints();
const clips=new Map(root.listAnimations().map(a=>[a.getName(),a]));
function sample(name,time){
  const pose=new Map();
  for(const channel of clips.get(name).listChannels()){
    const target=channel.getTargetNode(),path=channel.getTargetPath(),sampler=channel.getSampler();
    const times=sampler.getInput().getArray(),values=sampler.getOutput().getArray(),stride=path==='rotation'?4:3;
    let j=0;while(j<times.length-2&&times[j+1]<time)j++;
    const alpha=Math.min(1,Math.max(0,(time-times[j])/(times[j+1]-times[j]||1)));
    const a=Array.from(values.slice(j*stride,j*stride+stride)),b=Array.from(values.slice((j+1)*stride,(j+1)*stride+stride));
    let value;
    if(path==='rotation'){const q=new Quaternion(...a).slerp(new Quaternion(...b),alpha);value=[q.x,q.y,q.z,q.w];}
    else value=a.map((v,k)=>v+(b[k]-v)*alpha);
    if(!pose.has(target))pose.set(target,{});pose.get(target)[path]=value;
  }
  const world=new Map();
  function matrix(node){if(world.has(node))return world.get(node);const p=pose.get(node)??{};const local=new Matrix4().compose(new Vector3(...(p.translation??node.getTranslation())),new Quaternion(...(p.rotation??node.getRotation())),new Vector3(...(p.scale??node.getScale())));const parent=node.getParentNode();const out=parent?matrix(parent).clone().multiply(local):local;world.set(node,out);return out;}
  const transforms=jointNodes.map((node,i)=>matrix(node).clone().multiply(new Matrix4().fromArray(inverse,i*16)));
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const vertex=new Vector3(),part=new Vector3();
  for(let i=0;i<positions.length/3;i++){
    const out=new Vector3(),base=new Vector3(positions[i*3],positions[i*3+1],positions[i*3+2]);
    for(let s=0;s<4;s++){const w=weights[i*4+s];if(!w)continue;part.copy(base).applyMatrix4(transforms[joints[i*4+s]]);out.addScaledVector(part,w);}
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],out.getComponent(k));max[k]=Math.max(max[k],out.getComponent(k));}
  }
  return {clip:name,time,min,max,size:max.map((v,k)=>v-min[k])};
}
const poses=[['Idle',0],['Idle',1.1],['Walk',.3],['Walk',.6],['Run',.18],['Attack',0],['Attack',.46],['Hit',.1],['Death',0],['Death',.4],['Death',.65],['Death',1.4]].map(([n,t])=>sample(n,t));
const idle=poses[0],dead=poses.at(-1);
if(dead.min[1]<-.015||dead.min[1]>.25)throw new Error(`Death floor clearance is ${dead.min[1].toFixed(3)} m.`);
if(dead.size[1]>idle.size[1]*.55)throw new Error(`Death remains too tall: ${dead.size[1].toFixed(3)} m vs ${idle.size[1].toFixed(3)} m idle.`);
console.log(JSON.stringify({poses,deathHeightRatio:dead.size[1]/idle.size[1]},null,2));
