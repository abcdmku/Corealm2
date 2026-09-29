import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMaskedHitOverlay, applyMaskedHitOverlay } from '../game/src/render/creatureHitOverlay.js';
import { NodeIO, type JSONDocument } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { repairStudioFairy } from '../tools/tripo-creatures/profiles/studio-fairy.js';
import { applyClip, duration, restorePose, storedPose } from '../tools/creature-motion/pose.js';
import { deformedBounds } from '../tools/creature-motion/validate-deformation.js';

/** Repair the pinned source after promotion rather than applying a source profile twice. */
async function repairSource(io: NodeIO, entry: { file: string; motionRepair?: { sourceGitBlob?: string } }) {
  const pin = entry.motionRepair?.sourceGitBlob;
  if (!pin) return io.read(`game/public/assets/${entry.file}`);
  const bytes = execFileSync('git', ['cat-file', 'blob', pin], { maxBuffer: 128 * 1024 * 1024 });
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const resources: JSONDocument['resources'] = { '@glb.bin': new Uint8Array(bytes.subarray(28 + length)) };
  json.buffers[0].uri = '@glb.bin';
  for (const image of json.images ?? []) if (image.uri && !image.uri.startsWith('data:')) {
    resources[image.uri] = new Uint8Array(readFileSync(path.resolve('game/public/assets', path.dirname(entry.file), decodeURIComponent(image.uri))));
  }
  return io.readJSON({ json, resources });
}

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

describe('studio trial native motion repair', () => {
  it('fairy_monster_16 preserves native gait and skin, holds its corpse, and reproduces its production bytes', async () => {
    const id = 'fairy_monster_16';
    const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8'));
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const readAsset = async (assetId: string) => io.read(`game/public/assets/${manifest.assets.find((a: { id: string }) => a.id === assetId).file}`);
    const entry = manifest.assets.find((a: { id: string }) => a.id === id), doc = await repairSource(io, entry);
    const native = doc.getRoot().listAnimations().filter(c => ['Idle', 'Walk'].includes(c.getName()));
    const originalChannels = native.flatMap(c => c.listChannels()).map(c => ({ channel: c, values: Array.from(c.getSampler()!.getOutput()!.getArray()!) }));
    const skin = doc.getRoot().listSkins().map(s => Array.from(s.getInverseBindMatrices()!.getArray()!));
    const mesh = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).map(p => Array.from(p.getAttribute('POSITION')!.getArray()!));
    await repairStudioFairy(doc, { assetId: id, entry, readAsset });
    for (const { channel, values } of originalChannels) expect(Array.from(channel.getSampler()!.getOutput()!.getArray()!)).toEqual(values);
    expect(doc.getRoot().listSkins().map(s => Array.from(s.getInverseBindMatrices()!.getArray()!))).toEqual(skin);
    expect(doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).map(p => Array.from(p.getAttribute('POSITION')!.getArray()!))).toEqual(mesh);
    const death = doc.getRoot().listAnimations().find(c => c.getName() === 'Death')!, rest = storedPose(doc);
    restorePose(rest); applyClip(death, duration(death) - .29); const held = deformedBounds(doc);
    restorePose(rest); applyClip(death, duration(death)); const end = deformedBounds(doc);
    expect(end.min[1]).toBeCloseTo(.016, 5);
    for (let axis = 0; axis < 3; axis++) { expect(end.min[axis]).toBeCloseTo(held.min[axis]!, 5); expect(end.max[axis]).toBeCloseTo(held.max[axis]!, 5); }
    restorePose(rest);
    expect(createHash('sha256').update(await io.writeBinary(doc)).digest('hex')).toBe(entry.sha256);
  });
});
