import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const doc = await new NodeIO().read(path.join(dir, 'sources/stylized-spider-user-original.glb'));
const root = doc.getRoot();
console.log('nodes', root.listNodes().map(n => ({ name: n.getName(), mesh: !!n.getMesh(), skin: !!n.getSkin(), translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale(), children: n.listChildren().map(c => c.getName()) })));
console.log('meshes', JSON.stringify(root.listMeshes().map(m => ({ name: m.getName(), primitives: m.listPrimitives().map(p => { const a = p.getAttribute('POSITION'); const v = a?.getArray(); const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]; for(let i=0;i<v.length;i+=3) for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[i+k]);max[k]=Math.max(max[k],v[i+k]);} return { vertices:a?.getCount(), triangles:p.getIndices()?.getCount()/3, attributes:p.listSemantics(), material:p.getMaterial()?.getName(), bounds:{min,max}}; }) })), null, 2));
console.log('skins', root.listSkins().map(s => ({ name:s.getName(), joints:s.listJoints().map(j=>j.getName()) })));
console.log('animations', root.listAnimations().map(a=>a.getName()));
for(const m of root.listMaterials()) console.log('material', m.getName(), {base: m.getBaseColorTexture()?.getName(), normal:m.getNormalTexture()?.getName(), rm:m.getMetallicRoughnessTexture()?.getName(), alpha:m.getAlphaMode()});
for(const t of root.listTextures()){const im=t.getImage(); const meta=im?await sharp(im).metadata():{}; console.log('texture',t.getName(), t.getMimeType(), im?.length,meta.width,meta.height);}
const p=root.listMeshes()[0].listPrimitives()[0],v=p.getAttribute('POSITION').getArray(),idx=p.getIndices().getArray();
const parent=Array.from({length:v.length/3},(_,i)=>i);
const find=(i)=>parent[i]===i?i:(parent[i]=find(parent[i]));
const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
for(let i=0;i<idx.length;i+=3){union(idx[i],idx[i+1]);union(idx[i],idx[i+2]);}
const comp=new Map();
for(let i=0;i<v.length/3;i++){
  const key=find(i),c=comp.get(key)??{vertices:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],sum:[0,0,0]};
  c.vertices++;
  for(let k=0;k<3;k++){const x=v[3*i+k];c.min[k]=Math.min(c.min[k],x);c.max[k]=Math.max(c.max[k],x);c.sum[k]+=x;}
  comp.set(key,c);
}
console.log('components', [...comp.values()].sort((a,b)=>b.vertices-a.vertices).slice(0,40).map(c=>({vertices:c.vertices,min:c.min,max:c.max,center:c.sum.map(x=>x/c.vertices)})));

