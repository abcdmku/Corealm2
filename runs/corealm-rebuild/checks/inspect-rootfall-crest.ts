import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as THREE from 'three';
import {mkdir,writeFile} from 'node:fs/promises';
import {assembleFeatureLabStructure} from '../../../game/src/featureLab/structures.js';
import {buildRootfallNavigationSources} from '../../../game/src/render/rootfallNavigation.js';
import {ROOTFALL_STUMP} from '../../../game/src/world/rootfallStump.js';
const loaded=new Map<string,THREE.Group>();
for(const id of ['corealm_stump_oak','stairs_exterior']){
 const path=id.startsWith('corealm')?`corealm/nature/${id}`:`building/${id}`;
 const document=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`game/public/assets/models/${path}.glb`),root=new THREE.Group();
 for(const node of document.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
  const p=primitive.getAttribute('POSITION')!,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p.getArray()!,3));
  if(primitive.getIndices())g.setIndex(Array.from(primitive.getIndices()!.getArray()!));g.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));root.add(new THREE.Mesh(g));
 }
 loaded.set(id,root);
}
const fixture=assembleFeatureLabStructure({kind:'composition',id:'rootfall_stump',kit:'timber',width:6,depth:6,seed:1},[0,0,0]);
const sources=await buildRootfallNavigationSources({load:async id=>loaded.get(id)!,instance:id=>loaded.get(id)!.clone(true)},fixture.entities);
const ray=new THREE.Raycaster(),sin=Math.sin(ROOTFALL_STUMP.stairYaw),cos=Math.cos(ROOTFALL_STUMP.stairYaw),overlaps:any[]=[],centre:any[]=[];
for(let d=.8;d<=3.8;d+=.025)for(let lateral=-1.4;lateral<=1.4001;lateral+=.025){
 const x=sin*d+cos*lateral,z=cos*d-sin*lateral;ray.set(new THREE.Vector3(x,5,z),new THREE.Vector3(0,-1,0));
 const hits=ray.intersectObjects(sources.meshes,false);
 const stump=hits.find(hit=>!String(hit.object.userData.structureNavigation).includes('#step_'));
 const stair=hits.find(hit=>String(hit.object.userData.structureNavigation).includes('#step_'));
 if(!stump||!stair)continue;
 const sample={d,lateral,x,z,stumpY:stump.point.y,stairY:stair.point.y,overlap:stump.point.y-stair.point.y};
 if(Math.abs(lateral)<.013)centre.push(sample);
 if(sample.overlap>.005&&sample.overlap<.6)overlaps.push(sample);
}
const limits=(key:string)=>[Math.min(...overlaps.map(row=>row[key])),Math.max(...overlaps.map(row=>row[key]))];
const report={sampleSpacing:.025,source:'Native stump and four production stair meshes, exact production transforms',overlapCount:overlaps.length,overlapBounds:{distance:limits('d'),lateral:limits('lateral'),height:limits('overlap')},centre,overlaps};
await mkdir('test-results/rootfall-crest',{recursive:true});await writeFile('test-results/rootfall-crest/overlap.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,centre:undefined,overlaps:undefined}));
