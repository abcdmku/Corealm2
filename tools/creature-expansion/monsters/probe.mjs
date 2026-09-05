import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
globalThis.window={URL:{createObjectURL:()=>''}};
globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(v){},style:{}})};
const paths=process.argv.slice(2);
for(const path of paths){
 const b=fs.readFileSync(path),root=new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root,true);
 const mesh=[],bones=[];root.traverse(n=>{if(n.isMesh)mesh.push({name:n.name,vertices:n.geometry.attributes.position.count,materials:(Array.isArray(n.material)?n.material:[n.material]).map(m=>m.name),box:new THREE.Box3().setFromObject(n,true)});if(n.isBone)bones.push({name:n.name,parent:n.parent?.name,p:n.position.toArray(),world:n.getWorldPosition(new THREE.Vector3()).toArray()});});
 console.log(JSON.stringify({path,size:box.getSize(new THREE.Vector3()).toArray(),box,mesh,bones,clips:root.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length,start:c.tracks[0]?.times[0],last:c.tracks[0]?.times.at(-1)}))},null,2));
}
