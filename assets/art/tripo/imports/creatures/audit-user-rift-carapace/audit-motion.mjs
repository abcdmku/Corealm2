import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Vector3,Quaternion} from 'three';
import sharp from 'sharp';
const dir='assets/art/tripo/imports/creatures/audit-user-rift-carapace';
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(dir+'/rift-carapace-candidate.glb'));
const root=doc.getRoot(),skin=root.listSkins()[0],joints=skin.listJoints(),primitive=root.listMeshes()[0].listPrimitives()[0];
const pos=primitive.getAttribute('POSITION').getArray(),ids=primitive.getAttribute('JOINTS_0').getArray(),weights=primitive.getAttribute('WEIGHTS_0').getArray();
const inv=skin.getInverseBindMatrices().getArray(),rest=new Map(root.listNodes().map(n=>[n,{t:[...n.getTranslation()],r:[...n.getRotation()]}]));
const q0=new Quaternion(),q1=new Quaternion();
let finalVertices=[];
function sample(animation,time){
 for(const [n,v] of rest){n.setTranslation(v.t);n.setRotation(v.r);}
 for(const channel of animation.listChannels()){
  const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray(),path=channel.getTargetPath(),stride=path==='rotation'?4:3;
  let k=0;while(k<times.length-2&&times[k+1]<time)k++;
  const factor=Math.max(0,Math.min(1,(time-times[k])/(times[k+1]-times[k]||1))),a=Array.from(values.slice(k*stride,(k+1)*stride)),b=Array.from(values.slice((k+1)*stride,(k+2)*stride));
  const value=path==='rotation'?(q0.fromArray(a),q1.fromArray(b),q0.slerp(q1,factor).toArray()):a.map((v,i)=>v+(b[i]-v)*factor);
  if(path==='rotation')channel.getTargetNode().setRotation(value);else channel.getTargetNode().setTranslation(value);
 }
 const matrices=joints.map((joint,i)=>new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inv,i*16)));
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],centres={Claw_L:[0,0,0,0],Claw_R:[0,0,0,0],RearLeg_L:[0,0,0,0],RearLeg_R:[0,0,0,0]};
 const capture=animation.getName()==='Death'&&time>1.6?[]:null;
 let low=null,high=null;
 for(let i=0;i<pos.length/3;i++){
  const src=new Vector3(pos[3*i],pos[3*i+1],pos[3*i+2]),v=new Vector3();
  for(let j=0;j<4;j++){const w=weights[4*i+j];if(w)v.addScaledVector(src.clone().applyMatrix4(matrices[ids[4*i+j]]),w);}
  if(capture)capture.push(v.toArray());
  for(let j=0;j<3;j++){min[j]=Math.min(min[j],v.getComponent(j));max[j]=Math.max(max[j],v.getComponent(j));}
  const name=joints[ids[4*i]].getName();if(centres[name]){const c=centres[name];c[0]+=v.x;c[1]+=v.y;c[2]+=v.z;c[3]++;}
  if(!low||v.y<low.y)low={i,y:v.y,source:src.toArray(),joint:name};
  if(!high||v.y>high.y)high={i,y:v.y,source:src.toArray(),joint:name};
 }
 if(capture)finalVertices=capture;
 return {time,min,max,height:max[1]-min[1],low,high,centres:Object.fromEntries(Object.entries(centres).map(([k,c])=>[k,c.slice(0,3).map(v=>v/c[3])]))};
}
const clips={};for(const a of root.listAnimations()){
 const times=a.listSamplers()[0].getInput().getArray(),d=times[times.length-1];
 const sampleTimes=a.getName()==='Death'?[...new Set([...Array.from(times),...Array.from({length:17},(_,i)=>d*i/16)])].sort((x,y)=>x-y):[0,.25,.5,.75,1].map(f=>d*f);
 clips[a.getName()]=sampleTimes.map(t=>sample(a,t));
}
const span=s=>s.centres.Claw_L[0]-s.centres.Claw_R[0];
const proof={
 idleHeightMeters:clips.Idle[0].height,
 idleGroundY:clips.Idle[0].min[1],
 walkRearLegForwardMeters:clips.Walk[1].centres.RearLeg_L[2]-clips.Walk[0].centres.RearLeg_L[2],
 runRearLegForwardMeters:clips.Run[1].centres.RearLeg_L[2]-clips.Run[0].centres.RearLeg_L[2],
 attackClawClosureMeters:span(clips.Attack[0])-span(clips.Attack[2]),
 deathFinalGroundY:clips.Death.at(-1).min[1],
 deathFinalHeightMeters:clips.Death.at(-1).height,
 deathFinalWidthMeters:clips.Death.at(-1).max[0]-clips.Death.at(-1).min[0]
};
proof.deathMaximumPenetrationMeters=Math.max(0,-Math.min(...clips.Death.map(s=>s.min[1])));
proof.deathMaximumHoverMeters=Math.max(...clips.Death.map(s=>s.min[1]));
if(finalVertices.length){
 const idx=primitive.getIndices().getArray(),tris=[];
 for(let i=0;i<idx.length;i+=3){const points=[finalVertices[idx[i]],finalVertices[idx[i+1]],finalVertices[idx[i+2]]];tris.push({depth:points.reduce((a,v)=>a+v[0]+v[2],0),points});}
 tris.sort((a,b)=>a.depth-b.depth);
 const xy=p=>[Math.round(500+(p[0]-p[2])*.5*280),Math.round(760-p[1]*280+(p[0]+p[2])*.20*280)].join(',');
 const polys=tris.map(t=>`<polygon points="${t.points.map(xy).join(' ')}" fill="#392547" stroke="#1b1520" stroke-width=".5"/>`).join('');
 await writeFile('test-results/creature-audit/user-rift-carapace/death-cpu.png',await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900"><rect width="1000" height="900" fill="#d4d0ca"/>${polys}</svg>`)).png().toBuffer());
}
if(proof.walkRearLegForwardMeters<.06||proof.runRearLegForwardMeters<.10||proof.attackClawClosureMeters<.08||Math.abs(proof.deathFinalGroundY)>.015||proof.deathMaximumPenetrationMeters>.025||proof.deathMaximumHoverMeters>.03||proof.deathFinalHeightMeters<1.7||proof.deathFinalWidthMeters<1.8)throw Error('CPU motion proof failed: '+JSON.stringify(proof));
const report={candidate:dir+'/rift-carapace-candidate.glb',joints:joints.map(j=>j.getName()),clips,proof,attackContactSeconds:.58,contactNormalized:.58/1.18,acceptance:{cpuGeometry:true,lab:false,visual:false}};
await writeFile(dir+'/motion-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(clips).map(([k,v])=>[k,v.map(x=>({t:x.time,minY:x.min[1],maxY:x.max[1],height:x.height}))])),null,2));
