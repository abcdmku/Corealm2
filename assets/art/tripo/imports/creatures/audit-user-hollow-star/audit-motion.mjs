import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Quaternion,Vector3} from 'three';

const dir='assets/art/tripo/imports/creatures/audit-user-hollow-star';
const bytes=await readFile(dir+'/hollow-star-user-candidate.glb');
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes),root=doc.getRoot();
const mesh=root.listMeshes()[0],primitive=mesh.listPrimitives()[0],meshNode=root.listNodes().find(n=>n.getMesh()===mesh),skin=meshNode.getSkin();
const positions=primitive.getAttribute('POSITION').getArray(),weights=primitive.getAttribute('WEIGHTS_0').getArray(),ids=primitive.getAttribute('JOINTS_0').getArray();
const joints=skin.listJoints(),ibm=skin.getInverseBindMatrices().getArray(),inverse=joints.map((_,i)=>new Matrix4().fromArray(ibm.slice(i*16,i*16+16)));
const sample=(channel,time)=>{const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray(),stride=channel.getTargetPath()==='rotation'?4:3;let hi=1;while(hi<times.length-1&&times[hi]<time)hi++;const lo=hi-1,f=Math.max(0,Math.min(1,(time-times[lo])/(times[hi]-times[lo]||1))),a=Array.from(values.slice(lo*stride,(lo+1)*stride)),b=Array.from(values.slice(hi*stride,(hi+1)*stride));return stride===4?new Quaternion(...a).slerp(new Quaternion(...b),f).toArray():a.map((v,i)=>v+(b[i]-v)*f);};
function evaluate(animation,time){
 const overrides=new Map();for(const c of animation.listChannels()){const node=c.getTargetNode();if(!overrides.has(node))overrides.set(node,{});overrides.get(node)[c.getTargetPath()]=sample(c,time);}
 const world=new Map();const getWorld=n=>{if(!n)return new Matrix4();if(world.has(n))return world.get(n);const o=overrides.get(n)??{},m=getWorld(n.getParentNode()).clone().multiply(new Matrix4().compose(new Vector3(...(o.translation??n.getTranslation())),new Quaternion(...(o.rotation??n.getRotation())),new Vector3(...n.getScale())));world.set(n,m);return m;};
 const transforms=joints.map((j,i)=>getWorld(j).clone().multiply(inverse[i]));
 const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},p=new Vector3();
 for(let v=0;v<positions.length/3;v++){
  p.set(positions[v*3],positions[v*3+1],positions[v*3+2]);let x=0,y=0,z=0;
  for(let k=0;k<4;k++){const w=weights[v*4+k];if(w<=0)continue;const q=p.clone().applyMatrix4(transforms[ids[v*4+k]]);x+=q.x*w;y+=q.y*w;z+=q.z*w;}
  for(const [i,val] of [x,y,z].entries()){bounds.min[i]=Math.min(bounds.min[i],val);bounds.max[i]=Math.max(bounds.max[i],val);}
 }
 return {...bounds,size:bounds.max.map((v,i)=>v-bounds.min[i])};
}
const clips=Object.fromEntries(root.listAnimations().map(a=>{const duration=Math.max(...a.listSamplers().map(s=>s.getInput().getArray().at(-1)));return[a.getName(),{duration,samples:Array.from({length:13},(_,i)=>({time:duration*i/12,...evaluate(a,duration*i/12)}))}];}));
const report={source:'CPU skinning of candidate GLB; visual and gameplay acceptance pending',joints:joints.map(j=>j.getName()),clips};
await writeFile(dir+'/motion-audit.json',JSON.stringify(report,null,2)+'\n');
for(const [name,c] of Object.entries(clips)){const minY=Math.min(...c.samples.map(s=>s.min[1])),maxY=Math.max(...c.samples.map(s=>s.max[1])),end=c.samples.at(-1);console.log(name,JSON.stringify({duration:c.duration,minY,maxY,end}));}
