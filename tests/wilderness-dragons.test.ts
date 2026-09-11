import {describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WILDERNESS_DRAGON_CANDIDATES as WILDERNESS_DRAGONS} from '../game/src/content/wildernessDragons.js';
import {tierSilhouetteScale} from '../game/src/core/math.js';
import {enemyCombatLevel} from '../game/src/content/index.js';

const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function assetFor(id:string){
 const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
 let asset=process.env.WILDERNESS_CANDIDATES?undefined:manifest.assets.find((a:any)=>a.id===id),file=asset?`game/public/assets/${asset.file}`:'';
 if(!asset){const staged=JSON.parse(await readFile('test-results/wilderness-dragons/catalog.json','utf8'));asset=staged.assets.find((a:any)=>a.id===id);file=`test-results/wilderness-dragons/${staged.files[id]}`;}
 const bytes=await readFile(file);return{asset,bytes,doc:await io.readBinary(bytes)};
}

describe('Wilderness winged dragon production assets',()=>{
 it('keeps three juvenile and four adult identities at native authored metres',()=>{
  expect(WILDERNESS_DRAGONS).toHaveLength(7);expect(new Set(WILDERNESS_DRAGONS.map(s=>s.id)).size).toBe(7);
  for(const s of WILDERNESS_DRAGONS){expect(s.assetId).toBe(`creature_${s.id}`);expect(s.stats.family).toBe(s.id);expect(s.regionId).toBe('wilderness');expect(s.stats.tier).toBe(s.id.startsWith('baby_')?50:70);expect(s.scale*tierSilhouetteScale(s.stats.tier)).toBeCloseTo(1,6);}
  expect(WILDERNESS_DRAGONS.map(s=>enemyCombatLevel(s.stats))).toEqual([50,53,56,72,75,78,78]);
  for(const s of WILDERNESS_DRAGONS){expect(s.stats.attackSpeedMs).toBe(s.stats.tier===50?2800:3600);expect(s.stats.moveSpeedMps).toBe(s.stats.tier===50?1.4:1.8);}
 });
 it('ships lean winged rigs, native UVs, normalized skin and distinct juvenile geometry',async()=>{
  const sources=new Set<string>(),measurements=new Map<string,any>();
  for(const s of WILDERNESS_DRAGONS){
   const{asset,bytes,doc}=await assetFor(s.assetId),root=doc.getRoot();
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);expect(bytes.length).toBe(asset.bytes);
   expect(asset.pack).toBe('dungeon-mason-four-evil-dragons-pbr');sources.add(asset.metadata.provenance.sourceMesh);
   expect(root.listAnimations().map(a=>a.getName())).toEqual(expect.arrayContaining(['Idle','Walk','Run','Attack','Hit','Death','Breath']));
   expect(root.listSkins()[0]!.listJoints().filter(n=>/Wing/i.test(n.getName())).length).toBeGreaterThan(15);
   expect(asset.metadata.provenance.sculptedVertices).toBeGreaterThan(11000);
   expect(asset.size.y).toBeGreaterThan(s.stats.tier===50?1.15:2.8);expect(asset.size.y).toBeLessThan(s.stats.tier===50?1.5:3.5);
   for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
    expect(p.getAttribute('TEXCOORD_0')).toBeTruthy();expect(p.getAttribute('POSITION')!.getArray()!.every(Number.isFinite)).toBe(true);
    const weights=p.getAttribute('WEIGHTS_0')!;for(let i=0;i<weights.getCount();i++)expect(weights.getElement(i,[]).reduce((a,b)=>a+b,0)).toBeCloseTo(1,4);
   }
   for(const m of root.listMaterials()){expect(m.getBaseColorTexture()).toBeTruthy();expect(m.getNormalTexture()).toBeTruthy();expect(m.getOcclusionTexture()).toBeTruthy();}
   const molten=s.id==='baby_lava_dragon'||s.id==='purple_wilderness_dragon'||s.id==='amethyst_dragon';
   expect(root.listMaterials().some(m=>!!m.getEmissiveTexture())).toBe(molten);
   if(molten&&s.id!=='amethyst_dragon'){const fissures=asset.metadata.provenance.textures.fissures;expect(fissures.litFraction).toBeGreaterThan(.002);expect(fissures.litFraction).toBeLessThan(.025);}
   measurements.set(s.id,{asset,doc});
  }
  expect(sources.size).toBe(2);
  for(const[baby,adult]of[['baby_red_dragon','red_wilderness_dragon'],['baby_black_dragon','black_wilderness_dragon'],['baby_lava_dragon','purple_wilderness_dragon']]){
   const b=measurements.get(baby!),a=measurements.get(adult!);
   // Juveniles have a different height/length ratio, so this rejects a uniform scale-only copy.
   expect(Math.abs(b.asset.size.y/b.asset.size.z-a.asset.size.y/a.asset.size.z)).toBeGreaterThan(.015);
  }
 },20000);
 it('keeps interpolated skinned poses grounded and locomotion rooted after GLB roundtrip',async()=>{
  for(const s of WILDERNESS_DRAGONS){
   const{doc}=await assetFor(s.assetId);for(const m of doc.getRoot().listMaterials())m.setBaseColorTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
   await doc.transform(prune());const bytes=await io.writeBinary(doc),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,''),mixer=new THREE.AnimationMixer(gltf.scene);
   for(const clip of gltf.animations){
    mixer.stopAllAction();const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    for(const phase of [.0713,.2731,.5177,.8931]){
     mixer.setTime(clip.duration*phase);gltf.scene.updateMatrixWorld(true);
     const bounds=new THREE.Box3().setFromObject(gltf.scene,true);
     expect(bounds.min.y,`${s.id}/${clip.name}/${phase}`).toBeGreaterThan(-.028);
     expect(bounds.min.y,`${s.id}/${clip.name}/${phase}`).toBeLessThan(.06);
     expect(bounds.max.y-bounds.min.y).toBeLessThan(8);
    }
    for(const t of clip.tracks)if(/(?:^|\.)Root(?:_Pelvis)?\.position$/.test(t.name)){
     for(let i=0;i<t.values.length;i+=3){expect(t.values[i]).toBeCloseTo(t.values[0]!,5);expect(t.values[i+2]).toBeCloseTo(t.values[2]!,5);}
    }
   }
  }
 },25000);
});
