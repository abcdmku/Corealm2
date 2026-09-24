import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';

const dir='assets/art/tripo/imports/creatures/audit-polish-zombies';
await mkdir(`${dir}/source-maps`,{recursive:true});
const io=new NodeIO();
for(const id of ['creature_zombie','creature_plague_zombie']){
  const doc=await io.read(`game/public/assets/models/creature/${id}.glb`);
  const root=doc.getRoot();
  const materials=[];
  for(let i=0;i<root.listMaterials().length;i++){
    const material=root.listMaterials()[i];
    const texture=material.getBaseColorTexture();
    const image=texture?.getImage();
    const file=image?`${dir}/source-maps/${id}-${i}.${texture.getMimeType()==='image/jpeg'?'jpg':'png'}`:null;
    if(image)await writeFile(file,image);
    materials.push({name:material.getName(),image:file,mime:texture?.getMimeType(),bytes:image?.length});
  }
  console.log(JSON.stringify({id,materials,meshes:root.listMeshes().length,skins:root.listSkins().map(s=>s.listJoints().length),clips:root.listAnimations().map(a=>a.getName())}));
}
