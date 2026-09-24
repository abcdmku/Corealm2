import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';
const dir='assets/art/tripo/imports/creatures/audit-goblin-shaman';
const source='game/public/assets/models/creature/creature_goblin_shaman.glb';
const bytes=await readFile(source);
const sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!=='3cca8fe953e3b1dc59c948bd65d865497625b4567ba12f66a8d8a3d53069d421')throw new Error('Source hash mismatch');
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(source);
const root=doc.getRoot();
const report={source,sha256,bytes:bytes.length,meshes:root.listMeshes().map(mesh=>({name:mesh.getName(),primitives:mesh.listPrimitives().map(p=>({material:p.getMaterial()?.getName(),vertices:p.getAttribute('POSITION')?.getCount(),triangles:p.getIndices()?.getCount()/3,semantics:p.listSemantics()}))})),nodes:root.listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName(),mesh:n.getMesh()?.getName(),skin:n.getSkin()?.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()})),skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().map(n=>n.getName())})),materials:root.listMaterials().map(m=>({name:m.getName(),baseColorFactor:m.getBaseColorFactor(),baseColorTexture:m.getBaseColorTexture()?.getName(),normalTexture:m.getNormalTexture()?.getName(),metallic:m.getMetallicFactor(),roughness:m.getRoughnessFactor()})),textures:[],animations:root.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().length,seconds:Math.max(...a.listSamplers().map(s=>s.getInput().getArray().at(-1))),nodes:[...new Set(a.listChannels().map(c=>c.getTargetNode().getName()))]}))};
for(let i=0;i<root.listTextures().length;i++){
 const t=root.listTextures()[i],data=t.getImage(),meta=await sharp(data).metadata(),extension=t.getMimeType()==='image/png'?'png':'jpg';
 const file=`${dir}/source-texture-${i}.${extension}`;
 await writeFile(file,data);
 report.textures.push({index:i,name:t.getName(),mimeType:t.getMimeType(),width:meta.width,height:meta.height,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),file});
}
await writeFile(`${dir}/source-inspection.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sha256,meshes:report.meshes,skins:report.skins.map(s=>({name:s.name,joints:s.joints.length})),materials:report.materials,textures:report.textures,animations:report.animations.map(a=>({name:a.name,channels:a.channels,seconds:a.seconds,nodes:a.nodes.slice(0,20)}))},null,2));
