import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {Box3,Matrix4,Vector3} from 'three';
const root='art/rebuild/candidates/finish-structures/source-bedding/closed-source/rock_09';
const source=await new NodeIO().read(`${root}/rock_09.gltf`),points=[];
for(const node of source.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){const m=new Matrix4().fromArray(node.getWorldMatrix()),position=p.getAttribute('POSITION');for(let i=0;i<position.getCount();i++)points.push(new Vector3().fromArray(position.getElement(i,[])).applyMatrix4(m));}
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')),candidates={};
for(const id of ['cliff_step_2','cliff_step_3']){
 const legacy=manifest.assets.find(a=>a.id===id),target=new Vector3(legacy.size.x,legacy.size.y,legacy.size.z),rows=[];
 for(let yaw=0;yaw<360;yaw+=5)for(let pitch=-45;pitch<=45;pitch+=3){
  const rotation=new Matrix4().makeRotationY(yaw*Math.PI/180).multiply(new Matrix4().makeRotationX(pitch*Math.PI/180)),rotated=points.map(p=>p.clone().applyMatrix4(rotation)),bounds=new Box3().setFromPoints(rotated),size=bounds.getSize(new Vector3()),fit=target.clone().divide(size),uniform=Math.cbrt(fit.x*fit.y*fit.z),ratios=fit.clone().divideScalar(uniform);
  let front=-Infinity,rear=-Infinity,lowVertices=0;for(const p of rotated){if(p.z>bounds.min.z+size.z*.75)front=Math.max(front,p.y);if(p.z<bounds.min.z+size.z*.25)rear=Math.max(rear,p.y);if((p.y-bounds.min.y)*fit.y<.35)lowVertices++;}
  const drop=(rear-front)*fit.y,distortion=Math.max(...ratios.toArray())/Math.min(...ratios.toArray());
  if(id==='cliff_step_3'&&drop<2)continue;
  rows.push({yawDegrees:yaw,pitchDegrees:pitch,rotationOrder:'world yaw after source X pitch',rigidBounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray()},fitScale:fit.toArray(),uniformScale:uniform,relativeAxisScale:ratios.toArray(),anisotropyRatio:distortion,rearToFrontQuarterDrop:drop,verticesWithin35cmOfBottom:lowVertices,vertexCount:points.length});
 }
 rows.sort((a,b)=>a.anisotropyRatio-b.anisotropyRatio);candidates[id]=id==='cliff_step_3'?[...rows.slice(0,5),...rows.filter(row=>row.rearToFrontQuarterDrop>=2.2).slice(0,3)]:rows.slice(0,8);
}
const inspection=JSON.parse(await readFile(`${root}/inspection.json`,'utf8'));
const report={sourceBinSha256:inspection.files.find(f=>f.file.endsWith('.bin')).sha256,method:'Measured original vertices under rigid rotations only; axis fit calculated but not applied or exported.',candidates,limitations:['AABB fitting is not ground support proof. Tilted undersides can require terrain embedding.','No adapted model was created, and no visual acceptance is implied.']};
await writeFile(`${root}/fit-proposals.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(candidates).map(([id,rows])=>[id,rows.slice(0,3)])),null,2));
