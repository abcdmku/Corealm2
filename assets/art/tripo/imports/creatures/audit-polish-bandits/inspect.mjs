import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const dir = 'assets/art/tripo/imports/creatures/audit-polish-bandits';
await mkdir(`${dir}/source-maps`, { recursive: true });
for (const gender of ['female', 'male']) {
  const id = `outfit_${gender}_ranger`;
  const document = await io.read(`game/public/assets/models/outfit/${id}.glb`);
  const root = document.getRoot();
  const report = {
    id,
    scenes: root.listScenes().map(s => s.getName()),
    nodes: root.listNodes().length,
    skins: root.listSkins().map(s => ({ name: s.getName(), joints: s.listJoints().length })),
    animations: root.listAnimations().map(a => a.getName()),
    meshes: root.listMeshes().map(m => ({name:m.getName(), primitives:m.listPrimitives().map(p => ({material:p.getMaterial()?.getName(), vertices:p.getAttribute('POSITION')?.getCount(), joints:!!p.getAttribute('JOINTS_0'), weights:!!p.getAttribute('WEIGHTS_0'), uv:!!p.getAttribute('TEXCOORD_0')}))})),
    materials: root.listMaterials().map(m => ({name:m.getName(), factor:m.getBaseColorFactor(), roughness:m.getRoughnessFactor(), metalness:m.getMetallicFactor(), baseColorTexture:m.getBaseColorTexture()?.getName(), normalTexture:m.getNormalTexture()?.getName()})),
    textures: [],
  };
  for (const [i,t] of root.listTextures().entries()) {
    const bytes=t.getImage();
    const extension=t.getMimeType()==='image/jpeg'?'jpg':'png';
    const path=`${dir}/source-maps/${id}-${i}.${extension}`;
    await writeFile(path,bytes);
    report.textures.push({name:t.getName(),mime:t.getMimeType(),path,bytes:bytes.length,info:await sharp(bytes).metadata()});
  }
  console.log(JSON.stringify(report,null,2));
}
