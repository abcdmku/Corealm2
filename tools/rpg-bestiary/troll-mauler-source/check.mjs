import fs from 'node:fs';
import * as THREE from 'three';
import {buildTrollMauler} from './index.mjs';
const r=await buildTrollMauler();let meshes=0,badWeights=0,bones=0;
r.object.traverse(o=>{if(o.isSkinnedMesh){meshes++;bones=Math.max(bones,o.skeleton.bones.length);const w=o.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++){let sum=0;for(let j=0;j<4;j++)sum+=w.array[i*4+j];if(!Number.isFinite(sum)||Math.abs(sum-1)>1e-5)badWeights++;}}});
let minY=Infinity,maxY=-Infinity;const mix=new THREE.AnimationMixer(r.object);const clip=r.clips[0];mix.clipAction(clip).play();
for(let i=0;i<=100;i++){mix.setTime(clip.duration*i/100);r.object.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(r.object,true);minY=Math.min(minY,b.min.y);maxY=Math.max(maxY,b.max.y);}
const experimental=await buildTrollMauler('troll_mauler_experimental',{includeExperimentalMotions:true});
const clipBounds=[];
for(const c of experimental.clips){const m=new THREE.AnimationMixer(experimental.object),a=m.clipAction(c);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();let minimum=Infinity,maximum=-Infinity;for(let i=0;i<=151;i++){m.setTime(c.duration*i/151);experimental.object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(experimental.object,true);minimum=Math.min(minimum,box.min.y);maximum=Math.max(maximum,box.max.y);}m.stopAllAction();m.uncacheRoot(experimental.object);clipBounds.push({name:c.name,duration:c.duration,minY:minimum,maxY:maximum});}
const report={meshes,bones,badWeights,sourceClips:r.clips.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),experimentalClips:experimental.clips.map(c=>c.name),experimentalClipBounds:clipBounds,sampledIdleBounds:{minY,maxY},triangles:r.meta.triangles,vertices:r.meta.retainedSourceVertices,acceptance:r.meta.acceptance};
fs.writeFileSync('test-results/troll-mauler-source/adapter-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(badWeights||meshes!==3||bones!==33||minY<-.002)process.exitCode=1;
