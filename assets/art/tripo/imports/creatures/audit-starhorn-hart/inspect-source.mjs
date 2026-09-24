import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const source='game/public/assets/models/fairy-garden/fairy_garden_hart_faeholme.glb';
const dir='assets/art/tripo/imports/creatures/audit-starhorn-hart';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.readBinary(await readFile(source));
const root=doc.getRoot();
const result={nodes:root.listNodes().map(n=>({name:n.getName(),mesh:n.getMesh()?.getName(),skin:n.getSkin()?.getName(),translation:n.getTranslation(),scale:n.getScale()})),meshes:root.listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),vertices:p.getAttribute('POSITION')?.getCount(),triangles:(p.getIndices()?.getCount()??0)/3,attributes:p.listSemantics()}))})),materials:root.listMaterials().map(m=>({name:m.getName(),base:m.getBaseColorFactor(),texture:m.getBaseColorTexture()?.getName(),normal:m.getNormalTexture()?.getName(),metallic:m.getMetallicFactor(),roughness:m.getRoughnessFactor()})),skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(j=>j.getName())})),animations:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length}))};
await writeFile(`${dir}/source-inspection.json`,JSON.stringify(result,null,2));
const tex=root.listMaterials()[0]?.getBaseColorTexture();
if(tex?.getImage())await writeFile(`${dir}/source-atlas.png`,await sharp(tex.getImage()).png().toBuffer());
console.log(JSON.stringify({nodes:result.nodes.length,meshes:result.meshes,materials:result.materials,skins:result.skins,animations:result.animations,texture:tex?.getMimeType()},null,2));
for(const node of root.listNodes().filter(n=>n.getMesh())){
  const a=node.getMesh().listPrimitives()[0].getAttribute('POSITION'), v=[];
  let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.getCount();i++){a.getElement(i,v);for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],v[j]);hi[j]=Math.max(hi[j],v[j]);}}
  console.log(node.getName(),{lo,hi,skin:node.getSkin()?.listJoints().length});
}
