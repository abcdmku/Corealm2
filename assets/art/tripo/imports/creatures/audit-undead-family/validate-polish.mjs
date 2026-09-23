import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';

const io=new NodeIO(),dir='assets/art/tripo/imports/creatures/audit-undead-family';
const pairs=[
  ['creature_banshee','assets/art/tripo/imports/creatures/starred-banshee/banshee-native-rig-candidate.glb',`${dir}/banshee-motion-polish.glb`],
  ['creature_grave_lantern','game/public/assets/models/creature/creature_grave_lantern.glb',`${dir}/ashen-ghoul-polish.glb`],
];
const digest=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
for(const [id,sourcePath,candidatePath] of pairs){
  const source=(await io.readBinary(await readFile(sourcePath))).getRoot();
  const candidate=(await io.readBinary(await readFile(candidatePath))).getRoot();
  const meshes=[source.listMeshes(),candidate.listMeshes()];
  if(meshes[0].length!==meshes[1].length)throw new Error(`${id}: mesh count changed`);
  for(let i=0;i<meshes[0].length;i++){
    const prims=meshes.map(m=>m[i].listPrimitives());
    if(prims[0].length!==prims[1].length)throw new Error(`${id}: primitive count changed`);
    for(let j=0;j<prims[0].length;j++)for(const key of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0','indices']){
      const a=key==='indices'?prims[0][j].getIndices():prims[0][j].getAttribute(key);
      const b=key==='indices'?prims[1][j].getIndices():prims[1][j].getAttribute(key);
      if(Boolean(a)!==Boolean(b)||a&&digest(a.getArray())!==digest(b.getArray()))throw new Error(`${id}: ${key} changed at mesh ${i}, primitive ${j}`);
    }
  }
  const clips=[source.listAnimations(),candidate.listAnimations()];
  if(clips[0].map(a=>a.getName()).join('|')!==clips[1].map(a=>a.getName()).join('|'))throw new Error(`${id}: clip list changed`);
  const skins=[source.listSkins(),candidate.listSkins()];
  if(skins[0].map(s=>s.listJoints().length).join('|')!==skins[1].map(s=>s.listJoints().length).join('|'))throw new Error(`${id}: joints changed`);
  console.log(`${id}: geometry, UV, skin attributes and clip list preserved; ${meshes[1].length} meshes, ${skins[1][0]?.listJoints().length} joints, ${clips[1].length} clips`);
}
