import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';

const file = 'assets/art/tripo/imports/creatures/audit-gloam-fox/source-preview.glb';
const bytes = await readFile(file);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder}).read(file);
const root = doc.getRoot();
const meshes = root.listMeshes().map(mesh => ({name: mesh.getName(), primitives: mesh.listPrimitives().map(p => {
  const pos = p.getAttribute('POSITION')?.getArray();
  const idx = p.getIndices()?.getArray();
  const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  if (pos) for (let i = 0; i < pos.length; i += 3) for (let j = 0; j < 3; j++) {
    bounds[0][j] = Math.min(bounds[0][j], pos[i+j]);
    bounds[1][j] = Math.max(bounds[1][j], pos[i+j]);
  }
  return { vertices: pos?.length / 3, triangles: idx?.length / 3, bounds, attributes: p.listAttributes().map(a => a.getName()), material: p.getMaterial()?.getName() };
})}));
const textures = await Promise.all(root.listTextures().map(async t => { const meta = await sharp(t.getImage()).metadata(); return {name:t.getName(), mime:t.getMimeType(), width:meta.width, height:meta.height, bytes:t.getImage().length}; }));
if (process.argv.includes('--texture')) await sharp(root.listTextures()[0].getImage()).resize(1024).jpeg({quality:85}).toFile('assets/art/tripo/imports/creatures/audit-gloam-fox/source-coat-review.jpg');
console.log(JSON.stringify({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),meshes,textures,skins:root.listSkins().map(s=>({name:s.getName(),joints:s.listJoints().length})),animations:root.listAnimations().map(a=>a.getName()),nodes:root.listNodes().map(n=>({name:n.getName(),mesh:n.getMesh()?.getName(),skin:n.getSkin()?.getName(),translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale()}))},null,2));
const pos = root.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
for (const [a,b,label] of [[0,1,'X/Y'],[2,1,'Z/Y'],[0,2,'X/Z top']]) {
  const grid=Array.from({length:32},()=>Array(64).fill(' '));
  for(let i=0;i<pos.length;i+=3){const x=Math.max(0,Math.min(63,Math.floor((pos[i+a]+0.5)*63)));const y=Math.max(0,Math.min(31,Math.floor((pos[i+b]+0.05)*30)));grid[31-y][x]='*';}
  console.log(label+'\n'+grid.map(row=>row.join('')).join('\n'));
}
const world=(node)=>{const t=new THREE.Vector3(...node.getTranslation()),q=new THREE.Quaternion(...node.getRotation()),s=new THREE.Vector3(...node.getScale());const m=new THREE.Matrix4().compose(t,q,s);return node.getParentNode()?world(node.getParentNode()).multiply(m):m;};
console.log('Bone positions:');
for(const n of root.listNodes().filter(n=>n.getName().startsWith('bone_'))) {const p=new THREE.Vector3().setFromMatrixPosition(world(n));const ang=0.76;const x=Math.cos(ang)*p.x-Math.sin(ang)*p.z,z=Math.sin(ang)*p.x+Math.cos(ang)*p.z;console.log(n.getName(),[x,p.y,z].map(v=>+v.toFixed(3)).join(','));}
