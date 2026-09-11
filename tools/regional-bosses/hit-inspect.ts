/** Exhaustive base-gait/native-hit combinations, using the production additive mask. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createMaskedHitOverlay, applyMaskedHitOverlay } from '../../game/src/render/creatureHitOverlay.js';
export async function auditBossHitMask(id: string, file = `test-results/regional-bosses/creature_boss_${id}.glb`, reaction = 'Hit') {
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), rows: { id: string; name: string; minimum: any; unusedMinimum: any }[] = [];
const doc = await io.read(file);
for (const m of doc.getRoot().listMaterials()) m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
await doc.transform(prune());
const bytes = await io.writeBinary(doc), gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const mixer = new T.AnimationMixer(gltf.scene), idle = gltf.animations.find(a => a.name === 'Idle')!, hit = gltf.animations.find(a => a.name === reaction)!;
if (!hit) throw new Error(`${id} has no ${reaction} reaction`);
const mask = createMaskedHitOverlay(gltf.scene, hit, idle), v = new T.Vector3();
for (const name of ['Idle', 'Walk', 'Run', 'Attack']) {
  mixer.stopAllAction(); const clip = gltf.animations.find(a => a.name === name)!; mixer.clipAction(clip).play();
  let minimum = { y: Infinity } as any;
  let unusedMinimum = { y: Infinity } as any;
  for (let base = 0; base < 16; base++) {
    mixer.setTime(clip.duration * base / 16);
    const pose = new Map<T.Object3D, T.Quaternion>(); gltf.scene.traverse(n => { if ((n as T.Bone).isBone) pose.set(n, n.quaternion.clone()); });
    for (let phase = 0; phase <= 16; phase++) {
    // Mixer property bindings skip identical writes; restore the base explicitly before
    // each additive evaluation so phase samples never accumulate previous overlays.
    for (const [bone, quaternion] of pose) bone.quaternion.copy(quaternion);
    applyMaskedHitOverlay(gltf.scene, mask, hit.duration * phase / 16); gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(n => {
      if (!(n as T.SkinnedMesh).isSkinnedMesh) return;
      const mesh = n as T.SkinnedMesh, pos = mesh.geometry.attributes.position!, joints = mesh.geometry.attributes.skinIndex!, weights = mesh.geometry.attributes.skinWeight!;
      const used = new Set(mesh.geometry.index?.array ?? Array.from({ length: pos.count }, (_, i) => i));
      for (let k = 0; k < pos.count; k++) {
        mesh.getVertexPosition(k, v).applyMatrix4(mesh.matrixWorld);
        const retained = used.has(k), previous = retained ? minimum : unusedMinimum;
        if (v.y < previous.y) {
          const w = [0, 1, 2, 3].map(index => weights.getComponent(k, index)), j = joints.getComponent(k, w.indexOf(Math.max(...w)));
          const result = { y: v.y, basePhase: base / 16, hitPhase: phase / 16, mesh: mesh.name,
            bone: mesh.skeleton.bones[j]!.name, rest: [pos.getX(k), pos.getY(k), pos.getZ(k)] };
          if (retained) minimum = result; else unusedMinimum = result;
        }
      }
    });
    }
    for (const [bone, quaternion] of pose) bone.quaternion.copy(quaternion);
  }
  rows.push({ id, name, minimum, unusedMinimum });
}
return rows;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const ids = process.argv.includes('--all') ? ['tempest_roc', 'galeskin', 'rootheart', 'mossbound', 'tideworn', 'ordrun', 'cinderwake'] : [process.argv[2] ?? 'tideworn'];
  for (const id of ids) for (const row of await auditBossHitMask(id, undefined, process.argv[3] ?? 'Hit')) console.log(JSON.stringify({ ...row, reaction: process.argv[3] ?? 'Hit' }));
}
