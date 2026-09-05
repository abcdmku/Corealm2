import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
THREE.TextureLoader.prototype.load=function(url,onload){const t=new THREE.Texture();t.name=url;return t;};
globalThis.window={URL:URL};
const b=fs.readFileSync('test-results/creature-expansion/sources/monsters/mantis/Assets/Stylized3DMonster/Monster09/Monster09.fbx');
const obj=new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const nodes=[];obj.traverse(o=>nodes.push({name:o.name,type:o.type,position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),vertices:o.geometry?.attributes.position.count,material:o.material?.name}));
console.log(JSON.stringify({box:new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).toArray(),animations:obj.animations.map(c=>[c.name,c.duration,c.tracks.length]),nodes},null,2));
