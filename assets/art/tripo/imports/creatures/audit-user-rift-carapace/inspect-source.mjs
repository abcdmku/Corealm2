import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const file='assets/art/tripo/imports/creatures/audit-user-rift-carapace/sources/rift-carapace-original.glb';
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(file));
const root=doc.getRoot();
console.log('scenes',root.listScenes().map(s=>({name:s.getName(),nodes:s.listChildren().map(n=>n.getName())})));
console.log('nodes',root.listNodes().map(n=>({name:n.getName(),mesh:n.getMesh()?.getName(),children:n.listChildren().map(c=>c.getName()),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()})));
console.log('skins',root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(j=>j.getName())})));
console.log('animations',root.listAnimations().map(a=>a.getName()));
for(const m of root.listMeshes()) for(const p of m.listPrimitives()) {
 const a=p.getAttribute('POSITION'),v=a?.getArray(), min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<v.length;i+=3) for(let j=0;j<3;j++){min[j]=Math.min(min[j],v[i+j]);max[j]=Math.max(max[j],v[i+j]);}
 console.log('primitive',m.getName(),{vertices:a?.getCount(),triangles:p.getIndices()?.getCount()/3,attributes:p.listSemantics(),bounds:{min,max},material:p.getMaterial()?.getName()});
}
for(const m of root.listMaterials()) console.log('material',m.getName(),{base:m.getBaseColorTexture()?.getName(),normal:m.getNormalTexture()?.getName(),mr:m.getMetallicRoughnessTexture()?.getName(),emissive:m.getEmissiveTexture()?.getName()});
for(const t of root.listTextures()) console.log('texture',t.getName(),await sharp(t.getImage()).metadata().then(x=>({width:x.width,height:x.height,format:x.format,bytes:t.getImage().length})));
const p=root.listMeshes()[0].listPrimitives()[0],a=p.getAttribute('POSITION').getArray(),inds=p.getIndices().getArray(),parent=Int32Array.from({length:a.length/3},(_,i)=>i);
function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
for(let i=0;i<inds.length;i+=3){const x=find(inds[i]);parent[find(inds[i+1])]=x;parent[find(inds[i+2])]=x;}
const cc=new Map();for(let i=0;i<parent.length;i++){const id=find(i),v=cc.get(id)??{n:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};v.n++;for(let j=0;j<3;j++){v.min[j]=Math.min(v.min[j],a[i*3+j]);v.max[j]=Math.max(v.max[j],a[i*3+j]);}cc.set(id,v);}
console.log('components',cc.size,[...cc.values()].sort((a,b)=>b.n-a.n).slice(0,24));
