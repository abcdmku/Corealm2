import * as THREE from 'three';

/** Remove the reviewed two disconnected source horns, preserving the helmet bowl. */
export function removeHelmetHorns(source){
  source.updateMatrixWorld(true);let removed=0,bowls=0;
  const components=[];
  source.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const geometry=mesh.geometry,p=geometry.attributes.position,index=geometry.index,keep=[];
    const bodyCount=geometry.groups.find(group=>group.materialIndex===0).count;
    for(const range of geometry.groups){
      const rows=[];for(let i=range.start;i<range.start+range.count;i+=3)rows.push([0,1,2].map(j=>index?index.getX(i+j):i+j));
      if(range.materialIndex!==1){keep.push(...rows.flat());continue;}
      const parents=rows.map((_,i)=>i),shared=new Map();
      const find=i=>{while(parents[i]!==i)i=parents[i];return i;};
      rows.forEach((row,i)=>row.forEach(vertex=>{const key=[p.getX(vertex),p.getY(vertex),p.getZ(vertex)].map(value=>Math.round(value*1e4)).join(',');if(shared.has(key))parents[find(i)]=find(shared.get(key));else shared.set(key,i);}));
      const groups=new Map();rows.forEach((row,i)=>{const key=find(i),vertices=groups.get(key)||[];vertices.push(...row);groups.set(key,vertices);});
      for(const vertices of groups.values()){
        const box=new THREE.Box3();for(const vertex of vertices)box.expandByPoint(mesh.getVertexPosition(vertex,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
        const triangles=vertices.length/3,center=box.getCenter(new THREE.Vector3());
        if(triangles===26&&box.min.y>1.6&&Math.abs(center.x)>.1){removed+=triangles;components.push({triangles,min:box.min.toArray(),max:box.max.toArray()});}
        else {keep.push(...vertices);if(triangles===92&&box.min.y>1.5)bowls++;}
      }
    }
    const remap=new Map(),ordered=[];for(const vertex of keep)if(!remap.has(vertex)){remap.set(vertex,ordered.length);ordered.push(vertex);}
    for(const [name,a]of Object.entries(geometry.attributes)){
      const values=new a.array.constructor(ordered.length*a.itemSize);ordered.forEach((old,i)=>{for(let k=0;k<a.itemSize;k++)values[i*a.itemSize+k]=a.array[old*a.itemSize+k];});
      geometry.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize,a.normalized));
    }
    geometry.setIndex(keep.map(vertex=>remap.get(vertex)));geometry.clearGroups();geometry.addGroup(0,bodyCount,0);geometry.addGroup(bodyCount,keep.length-bodyCount,1);
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
  });
  if(removed!==52||components.length!==2||bowls!==1)throw new Error(`Reviewed helmet components changed: removed=${removed}, horns=${components.length}, bowls=${bowls}`);
  return {removedHornTriangles:removed,removedHornComponents:components,retainedHelmetBowlTriangles:92,method:'Only the two reviewed disconnected 26-triangle source helmet horns removed. Retained source attributes and all rig/clip data unchanged.'};
}
