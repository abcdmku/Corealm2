import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const doc = await new NodeIO().read(path.join(dir, 'sources/prehistoric-bird-user-original.glb'));
const root = doc.getRoot();
console.log('nodes', root.listNodes().map(n => ({ name: n.getName(), mesh: !!n.getMesh(), skin: !!n.getSkin(), translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale(), children: n.listChildren().map(c => c.getName()) })));
console.log('meshes', JSON.stringify(root.listMeshes().map(m => ({ name: m.getName(), primitives: m.listPrimitives().map(p => { const a = p.getAttribute('POSITION'); const v = a?.getArray(); const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]; for(let i=0;i<v.length;i+=3) for(let k=0;k<3;k++){min[k]=Math.min(min[k],v[i+k]);max[k]=Math.max(max[k],v[i+k]);} return { vertices:a?.getCount(), triangles:p.getIndices()?.getCount()/3, attributes:p.listSemantics(), material:p.getMaterial()?.getName(), bounds:{min,max}}; }) })), null, 2));
console.log('skins', root.listSkins().map(s => ({ name:s.getName(), joints:s.listJoints().map(j=>j.getName()) })));
console.log('animations', root.listAnimations().map(a=>a.getName()));
for(const m of root.listMaterials()) console.log('material', m.getName(), {base: m.getBaseColorTexture()?.getName(), normal:m.getNormalTexture()?.getName(), rm:m.getMetallicRoughnessTexture()?.getName(), alpha:m.getAlphaMode()});
for(const t of root.listTextures()){const im=t.getImage(); const meta=im?await sharp(im).metadata():{}; console.log('texture',t.getName(), t.getMimeType(), im?.length,meta.width,meta.height);}
