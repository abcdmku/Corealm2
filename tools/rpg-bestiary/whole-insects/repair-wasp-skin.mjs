import * as T from 'three';

/** Repair one source control point whose missing weights become Root=1 in FBXLoader. */
export function repairWaspSkin(source){
 const mesh=source.getObjectByName('Wasp'),g=mesh.geometry,root=mesh.skeleton.bones.findIndex(n=>n.name==='Root');
 const orphan=[];
 for(let i=0;i<g.attributes.position.count;i++)if(g.attributes.skinIndex.getX(i)===root&&g.attributes.skinWeight.getX(i)===1)orphan.push(i);
 if(JSON.stringify(orphan)!=='[6640,6643,6700,6703]')throw new Error('Wasp source orphan topology changed');
 const p=new T.Vector3().fromBufferAttribute(g.attributes.position,orphan[0]);p.y=-p.y;
 let mirror=-1,distance=Infinity;
 for(let i=0;i<g.attributes.position.count;i++){
  const d=p.distanceTo(new T.Vector3().fromBufferAttribute(g.attributes.position,i));
  if(d<distance){distance=d;mirror=i;}
 }
 if(distance>1e-6)throw new Error('No exact mirrored source control point');
 const indices=[],weights=[];
 for(let k=0;k<4;k++){
  const name=mesh.skeleton.bones[g.attributes.skinIndex.array[mirror*4+k]].name;
  const mirrored=name.endsWith('L')?name.slice(0,-1)+'R':name.endsWith('R')?name.slice(0,-1)+'L':name;
  const index=mesh.skeleton.bones.findIndex(n=>n.name===mirrored);
  if(index<0)throw new Error(`Missing mirrored source bone ${mirrored}`);
  indices.push(index);weights.push(g.attributes.skinWeight.array[mirror*4+k]);
 }
 for(const i of orphan)for(let k=0;k<4;k++){g.attributes.skinIndex.array[i*4+k]=indices[k];g.attributes.skinWeight.array[i*4+k]=weights[k];}
 g.attributes.skinIndex.needsUpdate=true;g.attributes.skinWeight.needsUpdate=true;
 return {method:'Mirror the exact opposite-side control point weights onto the four duplicates of one unweighted source point',orphanVertices:orphan,mirrorVertex:mirror,mirrorDistanceSourceUnits:distance,influences:indices.map((index,k)=>({bone:mesh.skeleton.bones[index].name,weight:weights[k]})),changesPositions:false,changesClips:false};
}
