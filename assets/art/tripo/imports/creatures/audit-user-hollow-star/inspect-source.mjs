import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const bytes = await readFile(new URL('./sources/fantasy+symbol+3d+model.glb', import.meta.url));
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
const root = doc.getRoot();
const summary = {
  scenes:root.listScenes().map(x=>x.getName()),
  nodes:root.listNodes().map(x=>({name:x.getName(),mesh:x.getMesh()?.getName(),skin:x.getSkin()?.getName(),parent:x.getParentNode()?.getName(),t:x.getTranslation(),r:x.getRotation(),s:x.getScale()})),
  meshes:root.listMeshes().map(x=>({name:x.getName(),primitives:x.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),attributes:p.listSemantics(),vertices:p.getAttribute('POSITION')?.getCount(),triangles:p.getIndices()?.getCount()/3}))})),
  skins:root.listSkins().map(x=>({name:x.getName(),joints:x.listJoints().map(j=>j.getName())})),
  animations:root.listAnimations().map(x=>x.getName()),
  materials:root.listMaterials().map(x=>({name:x.getName(),base:x.getBaseColorTexture()?.getName(),normal:x.getNormalTexture()?.getName(),orm:x.getMetallicRoughnessTexture()?.getName(),emissive:x.getEmissiveTexture()?.getName(),metal:x.getMetallicFactor(),rough:x.getRoughnessFactor(),alphaMode:x.getAlphaMode()})),
  textures:await Promise.all(root.listTextures().map(async x=>({name:x.getName(),mime:x.getMimeType(),bytes:x.getImage()?.length,size:await sharp(x.getImage()).metadata().then(m=>[m.width,m.height])})))
};
console.log(JSON.stringify(summary,null,2));
const p=root.listMeshes()[0].listPrimitives()[0], a=p.getAttribute('POSITION'), xyz=a.getArray();
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],mean=[0,0,0];
for(let i=0;i<xyz.length;i+=3){for(let k=0;k<3;k++){min[k]=Math.min(min[k],xyz[i+k]);max[k]=Math.max(max[k],xyz[i+k]);mean[k]+=xyz[i+k]/a.getCount();}}
const hist=[0,0,0,0,0,0,0,0,0,0];
for(let i=0;i<xyz.length;i+=3){const r=Math.hypot(xyz[i]-mean[0],xyz[i+2]-mean[2]);hist[Math.min(9,Math.floor(r*2))]++;}
console.log(JSON.stringify({min,max,mean,hist},null,2));
