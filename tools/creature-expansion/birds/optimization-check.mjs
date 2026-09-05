import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { SPECIES, buildSpecies } from '../birds.mjs';

const mode=process.argv[2],file=process.argv[3];
if(!['--write','--compare'].includes(mode)||!file)throw new Error('Expected --write|--compare snapshot.json');
const digest=values=>{const h=createHash('sha256');for(const value of values)h.update(typeof value==='string'?value:Buffer.from(value.buffer));return h.digest('hex');};
const positionKey=(x,y,z)=>[x,y,z].map(v=>Math.round(v*1e7)).join(',');
const snapshots=[];
for(const id of SPECIES){
  const {object,clips,meta}=await buildSpecies(id);let mesh;object.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});
  const position=mesh.geometry.attributes.position;
  const positions=[];for(let j=0;j<position.count;j++)positions.push(positionKey(position.getX(j),position.getY(j),position.getZ(j)));
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({name:m.name,roughness:m.roughness,metalness:m.metalness,normalScale:m.normalScale.toArray(),normalMap:digest([m.normalMap.image.data])}));
  const clipHash=digest(clips.flatMap(c=>[c.name,JSON.stringify({duration:c.duration,userData:c.userData}),...c.tracks.flatMap(t=>[t.name,t.times,t.values])]));
  const skeletonHash=digest([JSON.stringify(mesh.skeleton.bones.map(b=>({name:b.name,parent:b.parent.name,position:b.position.toArray()})))]);
  const motions={};
  for(const clip of clips){
    const mixer=new THREE.AnimationMixer(object),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    const bounds=new THREE.Box3(),point=new THREE.Vector3();
    for(let frame=0;frame<=40;frame++){
      mixer.setTime(clip.duration*frame/40);object.updateMatrixWorld(true);mesh.skeleton.update();
      for(let j=0;j<position.count;j++){point.fromBufferAttribute(position,j);mesh.applyBoneTransform(j,point);bounds.expandByPoint(point);}
    }
    motions[clip.name]={min:bounds.min.toArray(),max:bounds.max.toArray()};mixer.stopAllAction();mixer.uncacheRoot(object);
  }
  snapshots.push({id,triangles:mesh.geometry.index.count/3,positions:[...new Set(positions)],materials,meta,clipHash,skeletonHash,motions});
}
if(mode==='--write'){await writeFile(file,JSON.stringify(snapshots));console.log(JSON.stringify({saved:file,triangles:snapshots.map(s=>[s.id,s.triangles])}));}
else{
  const before=JSON.parse(await readFile(file,'utf8')),result=[];
  for(const after of snapshots){
    const prior=before.find(s=>s.id===after.id),oldPoints=new Set(prior.positions);
    const newPointCount=after.positions.filter(p=>!oldPoints.has(p)).length;
    let maxOutlineDelta=0;for(const name of Object.keys(after.motions))for(const extreme of ['min','max'])for(let axis=0;axis<3;axis++)maxOutlineDelta=Math.max(maxOutlineDelta,Math.abs(after.motions[name][extreme][axis]-prior.motions[name][extreme][axis]));
    const unchanged={clips:prior.clipHash===after.clipHash,skeleton:prior.skeletonHash===after.skeletonHash,materials:JSON.stringify(prior.materials)===JSON.stringify(after.materials),metadata:JSON.stringify(prior.meta)===JSON.stringify(after.meta)};
    const row={id:after.id,before:prior.triangles,after:after.triangles,newPointCount,maxOutlineDelta,...unchanged};result.push(row);
    if(newPointCount||maxOutlineDelta>.001||Object.values(unchanged).some(v=>!v))throw new Error(`Optimization changed accepted form/contracts: ${JSON.stringify(row)}`);
  }
  console.log(JSON.stringify({passed:true,result}));
}
