import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const file = new URL('./sources/medieval+rogue+3d+model.glb', import.meta.url);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const root = (await io.readBinary(await readFile(file))).getRoot();
const pos=root.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],bands={};
for(let i=0;i<pos.length;i+=3){for(let k=0;k<3;k++){min[k]=Math.min(min[k],pos[i+k]);max[k]=Math.max(max[k],pos[i+k]);}const b=(Math.floor(pos[i+1]*10)/10).toFixed(1);(bands[b]??=[]).push([pos[i],pos[i+2]]);}
const slices=Object.entries(bands).sort((a,b)=>Number(a[0])-Number(b[0])).map(([y,pts])=>({y,n:pts.length,x:[Math.min(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[0]))],z:[Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[1]))]}));
const out = {
  bounds:{min,max},slices,
  scenes: root.listScenes().map(s => ({name:s.getName(), children:s.listChildren().map(n=>n.getName())})),
  nodes: root.listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName(), mesh:n.getMesh()?.getName(),skin:n.getSkin()?.getName(),t:n.getTranslation(),r:n.getRotation(),s:n.getScale()})),
  meshes: root.listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),attributes:Object.fromEntries(p.listSemantics().map(k=>[k,p.getAttribute(k)?.getCount()])),triangles:p.getIndices()?.getCount()/3}))})),
  skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(j=>j.getName())})),
  materials:root.listMaterials().map(m=>({name:m.getName(),baseColor:m.getBaseColorFactor(),metallic:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),baseTexture:m.getBaseColorTexture()?.getName(),normalTexture:m.getNormalTexture()?.getName(),mrTexture:m.getMetallicRoughnessTexture()?.getName(),occlusionTexture:m.getOcclusionTexture()?.getName()})),
  textures:root.listTextures().map(t=>({name:t.getName(),mimeType:t.getMimeType(),bytes:t.getImage()?.length})),
  animations:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,duration:Math.max(...a.listSamplers().map(s=>Math.max(...s.getInput().getArray()))),targetNodes:[...new Set(a.listChannels().map(c=>c.getTargetNode()?.getName()))]})),
};
console.log(JSON.stringify(out,null,2));
