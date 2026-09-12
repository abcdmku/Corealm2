import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMaskedHitOverlay, applyMaskedHitOverlay } from '../game/src/render/creatureHitOverlay.js';

/** Load the promoted production skeleton and clips; GPU materials are irrelevant to support transforms. */
async function actualRig(id:string) {
  const manifest=JSON.parse(readFileSync('game/public/assets/manifest.json','utf8'));
  const entry=manifest.assets.find((a:{id:string})=>a.id===id);
  const bytes=readFileSync(`game/public/assets/${entry.file}`),length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+length).toString());
  delete json.images;delete json.textures;delete json.materials;
  for(const mesh of json.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  json.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(28+length).toString('base64')}`;
  (globalThis as any).ProgressEvent??=class {constructor(public type:string,init:unknown){Object.assign(this,init);}};
  return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}

describe('fairy crawler support during recoil',()=>{
  it.each(['fairy_monster_11','fairy_monster_14'])('%s preserves its lower walking arms in each base action',async id=>{
    const gltf=await actualRig(id),root=gltf.scene;
    const idle=gltf.animations.find(c=>c.name==='Idle')!,hit=gltf.animations.find(c=>c.name==='Hit')!;
    const overlay=createMaskedHitOverlay(root,hit,idle);
    expect(overlay.status).toBe('native-masked');
    expect(overlay.boneNames).toEqual(expect.arrayContaining(['headx','neckx']));
    const supports=['rootx','shoulderl','arm_stretchl','forearm_stretchl','handl',
      'shoulderr','arm_stretchr','forearm_stretchr','handr',
      'shoulder_dupli_002l','hand_dupli_002l','shoulder_dupli_002r','hand_dupli_002r','c_tail_00x'];
    if(id==='fairy_monster_14')supports.push('shoulder_dupli_001l','hand_dupli_001l','shoulder_dupli_001r','hand_dupli_001r');
    expect(overlay.protectedBoneNames).toEqual(expect.arrayContaining(supports));
    expect(overlay.boneNames.some(name=>supports.includes(name))).toBe(false);
    const mixer=new THREE.AnimationMixer(root);
    for(const name of ['Idle','Walk','Run','Attack','Hit','Death']) {
      const clip=gltf.animations.find(c=>c.name===name)!;
      for(const phase of [.15,.45,.8]) {
        mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(clip.duration*phase);root.updateMatrixWorld(true);
        const before=new Map(overlay.protectedBoneNames.map(bone=>[bone,root.getObjectByName(bone)!.matrixWorld.elements.slice()]));
        applyMaskedHitOverlay(root,overlay,hit.duration*.4);root.updateMatrixWorld(true);
        for(const [bone,matrix] of before)expect(root.getObjectByName(bone)!.matrixWorld.elements,`${id}/${name}@${phase}:${bone}`).toEqual(matrix);
      }
    }
    mixer.stopAllAction();mixer.uncacheRoot(root);
    // An incomplete lower support chain must not inherit the explicit exemption.
    root.getObjectByName('hand_dupli_002l')!.removeFromParent();
    expect(createMaskedHitOverlay(root,hit,idle).status).toBe('no-safe-mask');
  });
});
