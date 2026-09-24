import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function load(file){const doc=await io.readBinary(await readFile(file));for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);await doc.transform(prune());const bytes=await io.writeBinary(doc);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
function frame(gltf,clip,time){const scene=cloneRigged(gltf.scene),mixer=new THREE.AnimationMixer(scene);mixer.clipAction(clip).play();mixer.setTime(time);scene.updateMatrixWorld(true);const all=new THREE.Box3(),gear=new THREE.Box3(),sourcePoints=[];const p=new THREE.Vector3();scene.traverse(n=>{if(!n.isMesh)return;for(let i=0;i<n.geometry.attributes.position.count;i++){if(n.isSkinnedMesh)n.getVertexPosition(i,p);else p.fromBufferAttribute(n.geometry.attributes.position,i);p.applyMatrix4(n.matrixWorld);assert(p.toArray().every(Number.isFinite));all.expandByPoint(p);if(n.name==='EliteRoleArmor')gear.expandByPoint(p);if(n.name==='skeleton_mesh')sourcePoints.push(...p.toArray());}});return {allMin:all.min.toArray(),allMax:all.max.toArray(),gearMin:gear.min.toArray(),gearMax:gear.max.toArray(),sourcePoints};}
const out=[];
for(const kind of ['archer','mage','soldier']){
  const stage=await load(`assets/art/tripo/imports/creatures/audit-skeleton-elites/creature_skeleton_${kind}_elite.glb`);
  const polish=await load(`assets/art/tripo/imports/creatures/audit-polish-skeletons/creature_skeleton_${kind}_elite.glb`);
  assert.deepEqual(stage.animations.map(x=>x.name),polish.animations.map(x=>x.name));
  let maxSourceVertexDelta=0,minGearY=Infinity,maxWidth=0;const clips=[];
  for(let i=0;i<stage.animations.length;i++){
    const a=stage.animations[i],b=polish.animations[i];assert(Math.abs(a.duration-b.duration)<1e-6);
    const phases=[];
    for(const phase of [0,.25,.5,.75,.999]){
      const t=phase*b.duration,f=frame(polish,b,t),s=frame(stage,a,t);assert.equal(f.sourcePoints.length,s.sourcePoints.length);
      for(let j=0;j<f.sourcePoints.length;j++)maxSourceVertexDelta=Math.max(maxSourceVertexDelta,Math.abs(f.sourcePoints[j]-s.sourcePoints[j]));
      minGearY=Math.min(minGearY,f.gearMin[1]);maxWidth=Math.max(maxWidth,f.allMax[0]-f.allMin[0]);
      assert(f.gearMin.every(Number.isFinite)&&f.gearMax.every(Number.isFinite));
      phases.push({phase,allMin:f.allMin,allMax:f.allMax,gearMin:f.gearMin,gearMax:f.gearMax});
    }
    clips.push({name:b.name,duration:b.duration,phases});
  }
  assert(maxSourceVertexDelta<1e-5,`${kind}: original skinned mesh changed`);
  out.push({kind,maxSourceVertexDelta,minGearY,maxWidth,clips});
}
console.log(JSON.stringify(out,null,2));
