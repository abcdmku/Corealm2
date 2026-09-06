import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readSourceGlb} from '../humanoid-source/read-glb.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
/** Complete original Troll Mauler. Texture embedding is delegated through explicit bindings. */
export async function buildTrollMauler(id='troll_mauler',{includeExperimentalMotions=false}={}){
 const src=readSourceGlb(path.join(dir,'derived/troll-mauler.glb'));
 const provenance=JSON.parse(fs.readFileSync(path.join(dir,'derived/source.json'),'utf8'));
 provenance.legacyOcclusionLayers=JSON.parse(fs.readFileSync(path.join(dir,'legacy-material-slots.json'),'utf8'));
 provenance.legacyColorRecipe=JSON.parse(fs.readFileSync(path.join(dir,'derived/legacy-color-recipe.json'),'utf8'));
 const json=structuredClone(src.json);
 for(const material of json.materials??[]){delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;if(material.pbrMetallicRoughness){delete material.pbrMetallicRoughness.baseColorTexture;delete material.pbrMetallicRoughness.metallicRoughnessTexture;}}
 delete json.images;delete json.textures;delete json.samplers;
 json.buffers=[{byteLength:src.bin.length,uri:`data:application/octet-stream;base64,${src.bin.toString('base64')}`}];
 if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class ProgressEvent{constructor(type,init={}){this.type=type;Object.assign(this,init);}};
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(json),'');
 const object=new THREE.Group();object.name=id;const floorRoot=new THREE.Group();floorRoot.name=`${id}_ground`;object.add(floorRoot);floorRoot.add(gltf.scene);object.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(object,true);gltf.scene.position.y-=bounds.min.y;object.updateMatrixWorld(true);
 const sourceIdle=gltf.animations.find(c=>c.name==='Idle');if(!sourceIdle)throw new Error('Pinned source Idle missing');
 const clips=includeExperimentalMotions?gltf.animations:[sourceIdle];
 const floorCorrections={};
 for(const clip of clips){
  const mixer=new THREE.AnimationMixer(object),act=mixer.clipAction(clip);act.setLoop(THREE.LoopOnce,1);act.clampWhenFinished=true;act.play();
  const count=Math.ceil(clip.duration*180),times=[],values=[];let maximum=0;
  for(let i=0;i<=count;i++){
   const time=clip.duration*i/count;mixer.setTime(time);object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object,true);const correction=.001-box.min.y;
   times.push(time);values.push(0,correction,0);maximum=Math.max(maximum,Math.abs(correction));
  }
  mixer.stopAllAction();mixer.uncacheRoot(object);clip.tracks.push(new THREE.VectorKeyframeTrack(`${floorRoot.name}.position`,times,values));floorCorrections[clip.name]={samples:count+1,maxCorrectionM:maximum};
 }
 const materialNames=new Set();let vertices=0,triangles=0;
 object.traverse(n=>{if(n.isMesh){vertices+=n.geometry.attributes.position.count;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;for(const m of (Array.isArray(n.material)?n.material:[n.material])){materialNames.add(m.name);m.side=THREE.DoubleSide;}}});
 const textureBindings=provenance.textureBindings.map(b=>({...b,...Object.fromEntries(Object.entries(b).filter(([k])=>k.endsWith('Path')).map(([k,v])=>[k,path.join(dir,'derived',path.basename(v))]))}));
 for(const binding of textureBindings){const composed=provenance.legacyColorRecipe.outputs.find(o=>o.materialName===binding.materialName);if(composed){binding.originalBaseColorPath=binding.baseColorPath;binding.baseColorPath=path.join(dir,'derived',composed.path);}}
 for(const b of textureBindings)if(!materialNames.has(b.materialName))throw new Error(`Missing material ${b.materialName}`);
 return {object,clips,meta:{family:'troll',heightM:bounds.max.y-bounds.min.y,retainedSourceVertices:vertices,triangles,textureBindings,provenance,nativeClips:provenance.nativeClips,floorCorrections,missingClips:includeExperimentalMotions?[]:['Walk','Run','Attack','Hit','HitLeft','HitRight','Death'],attackContactPhase:includeExperimentalMotions?.55:null,experimentalMotionBlocker:'Four-influence refit across92 poses limits body deviation to11.4mm; original cloth retains66.9mm worst deviation. Authored motions excluded by default pending visual/deformation/contact acceptance.',rig:'Original 33-bone Troll Mauler armature; original body, loincloth and eyes',acceptance:'CPU source candidate; authored motions remain experimental; no production visual or gameplay acceptance'}};
}
