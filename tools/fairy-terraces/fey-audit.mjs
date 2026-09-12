/** Focused Node/Three check. Root still accepts NPCs in the production browser lab. */
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NodeIO, Logger } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const directory = 'test-results/fairy-terraces-assets/fey';
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
const entries = JSON.parse(await readFile(`${directory}/manifest-assets.json`,'utf8'));
const reports=[];
for (const entry of entries) {
  const doc=await io.read(`${directory}/${entry.id}.glb`);
  for(const texture of doc.getRoot().listTextures()) texture.dispose();
  const bytes=await io.writeBinary(doc);
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const meshes=[];
  gltf.scene.traverse(object=>{if(object.isSkinnedMesh)meshes.push(object)});
  const mixer=new THREE.AnimationMixer(gltf.scene);
  const clip=gltf.animations.find(a=>a.name==='Idle_Loop');
  assert(clip && clip.tracks.length===519, `${entry.id}: missing source tracks`);
  mixer.clipAction(clip).play();
  const frames=[];
  const samples=[];
  for(const time of [0,0.23,1.19,4.73,9.9]) {
    mixer.setTime(time);
    gltf.scene.updateMatrixWorld(true);
    for(const mesh of meshes)mesh.skeleton.update();
    const bounds=new THREE.Box3().setFromObject(gltf.scene,true);
    const vertices=[];
    for(const mesh of meshes) {
      const count=mesh.geometry.getAttribute('position').count;
      for(let index=0;index<count;index+=Math.max(1,Math.floor(count/50))) {
        const point=mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
        assert(point.toArray().every(Number.isFinite),`${entry.id}: non-finite skinned vertex`);
        vertices.push(point.toArray());
      }
    }
    samples.push(vertices);
    frames.push({time,min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new THREE.Vector3()).toArray()});
  }
  let largestMotion=0;
  for(let frame=1;frame<samples.length;frame++)for(let vertex=0;vertex<samples[frame].length;vertex++) {
    largestMotion=Math.max(largestMotion,new THREE.Vector3().fromArray(samples[frame][vertex]).distanceTo(new THREE.Vector3().fromArray(samples[0][vertex])));
  }
  assert(largestMotion>0.01,`${entry.id}: idle does not move source vertices`);
  assert(frames.every(frame=>frame.size[1]>0.6 && frame.size[1]<1.2),`${entry.id}: drawn body is not fairy sized`);
  const report={id:entry.id,skinnedMeshes:meshes.length,sourceJointCount:meshes[0].skeleton.bones.length,clip:clip.name,duration:clip.duration,tracks:clip.tracks.length,largestVertexMotionMetres:largestMotion,frames};
  reports.push(report);
  console.log(JSON.stringify({id:entry.id,skinnedMeshes:report.skinnedMeshes,joints:report.sourceJointCount,largestVertexMotionMetres:largestMotion,animatedHeightRange:[Math.min(...frames.map(f=>f.size[1])),Math.max(...frames.map(f=>f.size[1]))],footRange:[Math.min(...frames.map(f=>f.min[1])),Math.max(...frames.map(f=>f.min[1]))]}));
}
await writeFile(`${directory}/three-motion-audit.json`,JSON.stringify(reports,null,2)+'\n');
