/** Locate source surface triangles in a recorded acceptance image without rendering. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import {readFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read('test-results/regional-bosses/creature_boss_tideworn.glb');
for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
await doc.transform(prune());const bytes=await io.writeBinary(doc),g=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const report=JSON.parse(await readFile('test-results/regional-bosses/lab-tideworn-ordrun-cinderwake/lab.json','utf8')),s=report.evidence.find(x=>x.id==='tideworn'&&x.motion==='attack').samples[3];
const camera=new T.PerspectiveCamera(55,1440/900,.1,200);camera.position.copy(s.camera.position);camera.lookAt(new T.Vector3().copy(s.camera.target));camera.updateMatrixWorld(true);
const mixer=new T.AnimationMixer(g.scene),clip=g.animations.find(a=>a.name==='Attack');mixer.clipAction(clip).play();mixer.setTime(s.motion.time);g.scene.position.fromArray(s.motion.drawnPosition);g.scene.rotation.y=s.motion.drawnRotationY;g.scene.updateMatrixWorld(true);
g.scene.traverse(n=>{if(!n.isSkinnedMesh)return;const p=n.geometry.attributes.position,j=n.geometry.attributes.skinIndex,w=n.geometry.attributes.skinWeight,ids=n.geometry.index?.array??Array.from({length:p.count},(_,i)=>i);for(let i=0;i<ids.length;i+=3){const out=Array.from(ids.slice(i,i+3),k=>{const world=n.getVertexPosition(k,new T.Vector3()).applyMatrix4(n.matrixWorld),screen=world.clone().project(camera);return {screen:[(screen.x+1)*720,(1-screen.y)*450],rest:[p.getX(k),p.getY(k),p.getZ(k)],joints:[0,1,2,3].map(t=>[n.skeleton.bones[j.getComponent(k,t)].name,w.getComponent(k,t)]).filter(x=>x[1])};});if(out.every(v=>v.screen[0]>906&&v.screen[0]<965&&v.screen[1]>273&&v.screen[1]<320))console.log(JSON.stringify({mesh:n.name,triangle:i/3,vertices:out}));}});
