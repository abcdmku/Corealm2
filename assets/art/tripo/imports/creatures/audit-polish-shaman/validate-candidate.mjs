import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Quaternion,Vector3} from 'three';
const dir='assets/art/tripo/imports/creatures/audit-polish-shaman';
const sourcePath='game/public/assets/models/creature/creature_goblin_shaman.glb';
const candidatePath=`${dir}/goblin-shaman-polish-candidate.glb`;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [source,candidate]=await Promise.all([io.read(sourcePath),io.read(candidatePath)]);
const sha=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const sr=source.getRoot(),cr=candidate.getRoot();
const sourcePrimitives=sr.listMeshes().flatMap(m=>m.listPrimitives());
const candidatePrimitives=cr.listMeshes().flatMap(m=>m.listPrimitives());
const geometry=sourcePrimitives.map((p,i)=>({i,vertices:p.getAttribute('POSITION').getCount(),triangles:p.getIndices().getCount()/3,attributes:Object.fromEntries(p.listSemantics().map(key=>[key,sha(p.getAttribute(key).getArray())===sha(candidatePrimitives[i].getAttribute(key).getArray())])),indices:sha(p.getIndices().getArray())===sha(candidatePrimitives[i].getIndices().getArray())}));
const clipRows=[];
for(let i=0;i<sr.listAnimations().length;i++){
 const a=sr.listAnimations()[i],b=cr.listAnimations()[i];
 const inputMatches=a.listSamplers().every((s,j)=>sha(s.getInput().getArray())===sha(b.listSamplers()[j].getInput().getArray()));
 const outputsChanged=a.listSamplers().map((s,j)=>sha(s.getOutput().getArray())!==sha(b.listSamplers()[j].getOutput().getArray()));
 const changedNodes=[...new Set(b.listChannels().filter(c=>outputsChanged[b.listSamplers().indexOf(c.getSampler())]).map(c=>c.getTargetNode().getName()))];
 clipRows.push({name:a.getName(),channels:a.listChannels().length,inputMatches,changedNodes});
}
function sample(channel,time){const s=channel.getSampler(),times=s.getInput().getArray(),v=s.getOutput().getArray(),n=channel.getTargetPath()==='rotation'?4:3;let i=1;while(i<times.length-1&&times[i]<time)i++;const p=i-1,f=Math.max(0,Math.min(1,(time-times[p])/(times[i]-times[p])));if(n===4)return new Quaternion(...v.slice(p*4,p*4+4)).slerp(new Quaternion(...v.slice(i*4,i*4+4)),f).toArray();return new Vector3(...v.slice(p*3,p*3+3)).lerp(new Vector3(...v.slice(i*3,i*3+3)),f).toArray();}
function pose(doc,clipName,time,full=false){
 const root=doc.getRoot(),animation=root.listAnimations().find(a=>a.getName()===clipName),override=new Map();
 for(const c of animation.listChannels()){const n=c.getTargetNode(),o=override.get(n)??{};o[c.getTargetPath()]=sample(c,time);override.set(n,o);}
 const world=new Map();
 function visit(n,parent){const o=override.get(n)??{};const m=parent.clone().multiply(new Matrix4().compose(new Vector3(...(o.translation??n.getTranslation())),new Quaternion(...(o.rotation??n.getRotation())),new Vector3(...n.getScale())));world.set(n,m);for(const child of n.listChildren())visit(child,m);}
 for(const n of root.listScenes()[0].listChildren())visit(n,new Matrix4());
 const loc=name=>new Vector3().setFromMatrixPosition(world.get(root.listNodes().find(n=>n.getName()===name)));
 const result={time,leftHand:loc('hand_l').toArray(),rightHand:loc('hand_r').toArray(),head:loc('Head').toArray(),staff:loc('goblin_shaman_rpg_weapon_staff').toArray()};
 if(!full)return result;
 let minY=Infinity,maxY=-Infinity,nearFloorVertices=0;
 for(const node of root.listNodes()){
  const mesh=node.getMesh();if(!mesh)continue;
  const skin=node.getSkin();
  const boneMatrices=skin?skin.listJoints().map((joint,i)=>world.get(joint).clone().multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getArray(),i*16))):null;
  for(const p of mesh.listPrimitives()){
   const pos=p.getAttribute('POSITION').getArray(),ids=p.getAttribute('JOINTS_0')?.getArray(),weightAccessor=p.getAttribute('WEIGHTS_0'),weights=weightAccessor?.getArray(),scale=weightAccessor?.getNormalized()&&weights instanceof Uint8Array?1/255:1;
   for(let i=0;i<pos.length;i+=3){const original=new Vector3(pos[i],pos[i+1],pos[i+2]);let v;
    if(boneMatrices){v=new Vector3();for(let k=0;k<4;k++){const w=weights[i/3*4+k]*scale;if(w)v.addScaledVector(original.clone().applyMatrix4(boneMatrices[ids[i/3*4+k]]),w);}}
    else v=original.applyMatrix4(world.get(node));
    minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);if(v.y<.06)nearFloorVertices++;
   }
  }
 }
 result.minY=minY;result.maxY=maxY;result.nearFloorVertices=nearFloorVertices;
 return result;
}
const attackTimes=[0,.1,.21,.32,.42,.5];
const attack=attackTimes.map(time=>{const a=pose(source,'Attack',time),b=pose(candidate,'Attack',time);const sourceLift=a.leftHand[1]-a.head[1],candidateLift=b.leftHand[1]-b.head[1];return {time,sourceHandY:a.leftHand[1],candidateHandY:b.leftHand[1],sourceAboveHead:sourceLift,candidateAboveHead:candidateLift,staffDelta:new Vector3(...a.staff).distanceTo(new Vector3(...b.staff))};});
const floor=[];
for(const clip of ['Idle','Walk','Run','Attack','Death']){
 const seconds=Math.max(...sr.listAnimations().find(a=>a.getName()===clip).listSamplers().map(s=>s.getInput().getArray().at(-1)));
 for(const fraction of clip==='Attack'?[0,.42,1]:[0,.25,.5,.75,1]){
  const time=seconds*fraction,a=pose(source,clip,time,true),b=pose(candidate,clip,time,true);
  floor.push({clip,time:+time.toFixed(3),sourceMinY:+a.minY.toFixed(4),candidateMinY:+b.minY.toFixed(4),floorDelta:+(b.minY-a.minY).toFixed(6),sourceNearFloorVertices:a.nearFloorVertices,candidateNearFloorVertices:b.nearFloorVertices});
 }
}
const report={schema:'corealm-goblin-shaman-cpu-validation/1',geometry,clips:clipRows,attack,floor};
const changed=clipRows.find(c=>c.name==='Attack').changedNodes.sort();
if(geometry.length!==8||geometry.some(g=>!g.indices||Object.values(g.attributes).some(v=>!v))||clipRows.some(c=>!c.inputMatches)||clipRows.some(c=>c.name!=='Attack'&&c.changedNodes.length)||JSON.stringify(changed)!==JSON.stringify(['clavicle_l','hand_l','lowerarm_l','upperarm_l'].sort())||attack.find(p=>p.time===.21).candidateAboveHead<.12||attack.some(p=>p.staffDelta>1e-6)||floor.some(f=>Math.abs(f.floorDelta)>.0001))throw new Error(`Candidate validation failed: ${JSON.stringify(report)}`);
await writeFile(`${dir}/validation.json`,JSON.stringify(report,null,2)+'\n');
const catalogPath=`${dir}/catalog.json`;
const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
catalog.acceptance.cpuValidated=true;
await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({geometryPreserved:geometry.length,clips:clipRows,contact:attack.find(p=>p.time===.21),maximumFloorDelta:Math.max(...floor.map(f=>Math.abs(f.floorDelta)))},null,2));
