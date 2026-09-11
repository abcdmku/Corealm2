/** CPU occlusion diagnosis; final material readability still requires normal-camera browser review. */
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import {readFile,writeFile} from 'node:fs/promises';
const out='test-results/wilderness-creatures/ordinary',io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function load(file){const doc=await io.read(file);for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null).setEmissiveTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);const b=await io.writeBinary(doc);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const rows=[],opening=process.argv.includes('--opening');
for(const [id,oldFile,targetName]of opening?[['furnace_grazer','grazer-pre-opening.glb','furnace_grazer_molten_shoulder_interior']]:[['basalt_maw','basalt-pre-cavity.glb','basalt_maw_molten_gullet'],['furnace_grazer','grazer-pre-cavity.glb','furnace_grazer_molten_shoulder_interior']]){
 const result={id,before:[],after:[]};
 for(const [key,file]of [['before',oldFile],['after',`creature_${id}.glb`]]){
  const gltf=await load(`${out}/${file}`),scene=gltf.scene,mixer=new T.AnimationMixer(scene),idle=gltf.animations.find(a=>a.name==='Idle');mixer.clipAction(idle).play();mixer.setTime(0);scene.updateMatrixWorld(true);
  const target=scene.getObjectByName(targetName);assert(target);const center=new T.Box3().setFromObject(target,true).getCenter(new T.Vector3()),ray=new T.Raycaster();
  for(const yaw of [-.5,0,.5]){const origin=center.clone().add(new T.Vector3(Math.sin(yaw)*6,3,Math.cos(yaw)*6)),forward=center.clone().sub(origin).normalize(),right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0)).normalize(),up=new T.Vector3().crossVectors(right,forward).normalize();let exposedCore=0,blockedCore=0,other=0;
   for(let y=-15;y<=15;y++)for(let x=-15;x<=15;x++){const aim=center.clone().addScaledVector(right,x/15*.70).addScaledVector(up,y/15*.70);ray.set(origin,aim.sub(origin).normalize());const hits=ray.intersectObjects(scene.children,true),coreIndex=hits.findIndex(h=>h.object===target);if(coreIndex===0)exposedCore++;else if(coreIndex>0)blockedCore++;else other++;}
   result[key].push({yaw,exposedCore,blockedCore,other,samples:961});
  }
 }
 const before=result.before.reduce((n,r)=>n+r.exposedCore,0),after=result.after.reduce((n,r)=>n+r.exposedCore,0);assert(after>before,`${id}: cavity repair did not expose additional core rays`);rows.push(result);console.log(`${id}: visible core sample rays ${before} -> ${after}`);
}
const previous=JSON.parse(await readFile(`${out}/catalog-pre-${opening?'opening':'cavity'}.json`,'utf8')),current=JSON.parse(await readFile(`${out}/catalog.json`,'utf8'));
for(const a of previous.assets)if(!(opening?['creature_furnace_grazer']:['creature_basalt_maw','creature_furnace_grazer']).includes(a.id))assert.equal(a.sha256,current.assets.find(b=>b.id===a.id).sha256,`${a.id} unexpected export`);
await writeFile(`${out}/${opening?'opening':'cavity'}-audit.json`,JSON.stringify({rows,unaffectedHashesUnchanged:true},null,2)+'\n');
