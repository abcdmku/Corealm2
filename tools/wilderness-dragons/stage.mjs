/**
 * Shared staging for native studio candidates (Dungeon Mason dragons, Dragon Boar, Fantasy Rhino).
 *
 * Writes `<out>/models/<manifest file>` and upserts `<out>/catalog.json` in the format
 * tools/promote-finish-assets.ts reads. Manifest fields are copied from the current entry; bytes,
 * sha256, size, base and animations are recomputed from the candidate. Measurement is read-only:
 * nothing here changes a clip or a node.
 */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
export const MANIFEST = 'game/public/assets/manifest.json';
export const PUBLIC = 'game/public/assets';

export const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

export async function manifestEntry(id) {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const entry = manifest.assets.find(asset => asset.id === id);
  if (!entry) throw new Error(`No manifest entry ${id}`);
  return entry;
}

/** Textureless three.js copy of a document, so GLTFLoader can run in Node without image decoding. */
export async function bareScene(doc) {
  const bare = await io.readBinary(await io.writeBinary(doc));
  for (const m of bare.getRoot().listMaterials()) m.setBaseColorTexture(null).setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null);
  await bare.transform(prune());
  const bytes = await io.writeBinary(bare);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

/**
 * Skinned bounds at Idle t=0 (size/base), per-clip vertical range, and, when `feet` matches bones,
 * the median backward foot speed while planted (the implied ground speed of an in-place gait).
 */
export async function measure(doc, {feet = /^$/, head = null} = {}) {
  const gltf = await bareScene(doc), scene = gltf.scene, mixer = new THREE.AnimationMixer(scene);
  const footBones = []; scene.traverse(n => { if (n.isBone && feet.test(n.name)) footBones.push(n); });
  const clips = {}; let idle = null, attackContact = null;
  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    let minY = Infinity, maxY = -Infinity, reach = -Infinity;
    const samples = footBones.map(() => []), steps = Math.ceil(clip.duration * 60);
    for (let i = 0; i <= steps; i++) {
      const t = Math.min(clip.duration, i / 60); mixer.setTime(t); scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene, true);
      minY = Math.min(minY, box.min.y); maxY = Math.max(maxY, box.max.y);
      if (clip.name === 'Idle' && i === 0) idle = box.clone();
      if (clip.name === 'Attack' && head) { const z = scene.getObjectByName(head).getWorldPosition(new THREE.Vector3()).z; if (z > reach) { reach = z; attackContact = t / clip.duration; } }
      footBones.forEach((f, k) => samples[k].push(f.getWorldPosition(new THREE.Vector3())));
    }
    const stance = [];
    for (const s of samples) {
      const low = Math.min(...s.map(p => p.y)), high = Math.max(...s.map(p => p.y));
      for (let i = 1; i < s.length; i++) { const speed = (s[i - 1].z - s[i].z) * 60; if (speed > .015 && s[i].y < low + (high - low) * .35) stance.push(speed); }
    }
    stance.sort((a, b) => a - b);
    clips[clip.name] = {seconds: clip.duration, minY, maxY, impliedMps: stance[Math.floor(stance.length / 2)] ?? 0};
  }
  mixer.stopAllAction();
  if (!idle) { scene.updateMatrixWorld(true); idle = new THREE.Box3().setFromObject(scene, true); }
  const size = idle.getSize(new THREE.Vector3());
  return {size: {x: size.x, y: size.y, z: size.z}, base: {x: idle.min.x, y: idle.min.y, z: idle.min.z}, clips, attackContact};
}

/** Write one candidate and upsert its catalog row. `set` overrides copied manifest fields. */
export async function stageCandidate({out, id, doc, motionProvenance, measurement, set = {}}) {
  const entry = await manifestEntry(id);
  const bytes = Buffer.from(await io.writeBinary(doc));
  const candidateFile = `models/${entry.file.replace(/^models\//, '')}`;
  await mkdir(path.dirname(path.join(out, candidateFile)), {recursive: true});
  await writeFile(path.join(out, candidateFile), bytes);
  const m = measurement ?? await measure(doc);
  const row = {
    ...entry,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: m.size,
    base: m.base,
    ...(entry.groundY !== undefined ? {groundY: m.base.y} : {}),
    ...(entry.bounds !== undefined ? {bounds: {min: [m.base.x, m.base.y, m.base.z], max: [m.base.x + m.size.x, m.base.y + m.size.y, m.base.z + m.size.z]}} : {}),
    animations: doc.getRoot().listAnimations().map(a => a.getName()),
    materials: [...new Set(doc.getRoot().listMaterials().map(mat => mat.getName()))],
    ...set,
    candidateFile,
    motionProvenance,
  };
  const catalogPath = path.join(out, 'catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8').catch(() => '{"assets":[]}'));
  const index = catalog.assets.findIndex(a => a.id === id);
  if (index < 0) catalog.assets.push(row); else catalog.assets[index] = row;
  catalog.assets.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  return {row, file: path.join(out, candidateFile), measurement: m};
}
