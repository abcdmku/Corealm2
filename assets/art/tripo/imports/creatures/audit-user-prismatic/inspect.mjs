import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const file = 'assets/art/tripo/imports/creatures/audit-user-prismatic/sources/fantasy+insect+3d+model.glb';
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(file));
const root = doc.getRoot();
const primitive=root.listMeshes()[0].listPrimitives()[0];
const positions=primitive.getAttribute('POSITION').getArray();
const bounds=[0,1,2].map(axis=>{const values=Array.from({length:positions.length/3},(_,i)=>positions[i*3+axis]);return [Math.min(...values),Math.max(...values)];});
console.log('bounds',bounds);
await writeFile('test-results/creature-audit/user-prismatic/geometry.json',JSON.stringify({positions:Array.from(positions),indices:Array.from(primitive.getIndices().getArray())}));
for(const t of root.listTextures()) await writeFile('test-results/creature-audit/user-prismatic/'+t.getName()+ (t.getMimeType()==='image/png'?'.png':'.jpg'),t.getImage());
console.log(JSON.stringify({
  scenes: root.listScenes().map(x=>({name:x.getName(),nodes:x.listChildren().map(n=>n.getName())})),
  nodes: root.listNodes().map(n=>({name:n.getName(),mesh:n.getMesh()?.getName(),skin:n.getSkin()?.getName(),parent:n.getParentNode()?.getName(),t:n.getTranslation(),r:n.getRotation(),s:n.getScale()})),
  meshes: root.listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({vertices:p.getAttribute('POSITION')?.getCount(),triangles:p.getIndices()?.getCount()/3,attributes:p.listSemantics(),material:p.getMaterial()?.getName()}))})),
  materials: root.listMaterials().map(m=>({name:m.getName(),base:m.getBaseColorTexture()?.getName(),normal:m.getNormalTexture()?.getName(),mr:m.getMetallicRoughnessTexture()?.getName(),emissive:m.getEmissiveTexture()?.getName(),alpha:m.getAlphaMode()})),
  textures: await Promise.all(root.listTextures().map(async t=>({name:t.getName(),mime:t.getMimeType(),info:await sharp(t.getImage()).metadata().then(x=>({width:x.width,height:x.height}))}))),
  skins: root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(j=>j.getName())})),animations:root.listAnimations().map(a=>a.getName())
},null,2));
