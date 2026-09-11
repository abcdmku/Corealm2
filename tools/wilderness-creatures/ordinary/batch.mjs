import * as T from 'three';

/** Re-express rigid bone children as identical single-joint skinning, then join material batches. */
export function batchRigidAnatomy(doc,id){
 const root=doc.getRoot(),scene=root.listScenes()[0],buffer=root.listBuffers()[0],nodes=root.listNodes().filter(n=>n.getMesh());
 const parents=[...new Set(nodes.map(n=>n.getParentNode()))];
 if(parents.some(n=>!n))throw Error(`${id}: every rigid anatomy part must have an animated bone parent`);
 if(nodes.some(n=>n.getSkin()))throw Error(`${id}: rigid batch does not accept an existing weighted mesh`);
 const skin=doc.createSkin(`${id}_batched_rigid_skin`);for(const joint of parents)skin.addJoint(joint);
 const attr=(type,values)=>doc.createAccessor().setType(type).setArray(values).setBuffer(buffer);
 skin.setInverseBindMatrices(attr('MAT4',Float32Array.from(parents.flatMap(j=>new T.Matrix4().fromArray(j.getWorldMatrix()).invert().toArray()))));
 const groups=new Map();
 for(const node of nodes){const joint=parents.indexOf(node.getParentNode()),world=new T.Matrix4().fromArray(node.getWorldMatrix()),normalMatrix=new T.Matrix3().getNormalMatrix(world);
  for(const p of node.getMesh().listPrimitives()){
   const material=p.getMaterial();if(!groups.has(material))groups.set(material,{position:[],normal:[],uv:[],color:[],joints:[],weights:[],parts:[]});const g=groups.get(material),position=p.getAttribute('POSITION'),normal=p.getAttribute('NORMAL'),uv=p.getAttribute('TEXCOORD_0'),color=p.getAttribute('COLOR_0');
   const indices=Array.from(p.getIndices()?.getArray()??Array.from({length:position.getCount()},(_,i)=>i)),offset=g.position.length/3;
   if(!uv||!normal||!color)throw Error(`${id}: missing anatomy attribute before material batch`);
   for(const i of indices){const v=new T.Vector3().fromArray(position.getArray(),i*3).applyMatrix4(world),n=new T.Vector3().fromArray(normal.getArray(),i*3).applyMatrix3(normalMatrix).normalize();g.position.push(...v.toArray());g.normal.push(...n.toArray());g.uv.push(uv.getArray()[i*2],uv.getArray()[i*2+1]);g.color.push(...color.getArray().slice(i*3,i*3+3));g.joints.push(joint,0,0,0);g.weights.push(1,0,0,0);}
   g.parts.push({sourceNode:node.getName(),vertexOffset:offset,sourceIndices:indices});
  }
  node.setMesh(null);
 }
 const mesh=doc.createMesh(`${id}_weighted_anatomy`);
 for(const [material,g]of groups){const p=doc.createPrimitive().setMaterial(material).setExtras({batchParts:g.parts});
  p.setAttribute('POSITION',attr('VEC3',Float32Array.from(g.position))).setAttribute('NORMAL',attr('VEC3',Float32Array.from(g.normal))).setAttribute('TEXCOORD_0',attr('VEC2',Float32Array.from(g.uv))).setAttribute('COLOR_0',attr('VEC3',Float32Array.from(g.color))).setAttribute('JOINTS_0',attr('VEC4',Uint16Array.from(g.joints))).setAttribute('WEIGHTS_0',attr('VEC4',Float32Array.from(g.weights)));mesh.addPrimitive(p);
 }
 scene.addChild(doc.createNode(`${id}_weighted_anatomy`).setMesh(mesh).setSkin(skin));
 return {sourceMeshes:nodes.length,renderedPrimitives:groups.size,joints:parents.length,method:'Unchanged rigid anatomy re-expressed in a common bind space with one original parent-bone weight per vertex; joined by material'};
}
