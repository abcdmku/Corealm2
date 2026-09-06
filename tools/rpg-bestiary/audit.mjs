/** Geometry/animation compatibility audit, deliberately separate from art acceptance. */
import { writeFile, readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { buildBestiary, skinArticulated, BESTIARY_IDS } from './build.mjs';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
const directory = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'art/rebuild/candidates/finish-bestiary';
const ids = args.includes('--ids') ? args[args.indexOf('--ids') + 1].split(',') : BESTIARY_IDS;
const factory=args.includes('--expansion')?(await import('./export-expansion.mjs')).buildExpansion:buildBestiary;
globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async blob => {
  const metadata = await sharp(Buffer.from(await blob.arrayBuffer())).metadata();
  return { width: metadata.width, height: metadata.height, close() {} };
};
const reports = [];
const catalog = JSON.parse(await readFile(`${directory}/catalog.json`, 'utf8'));
for (const id of ids) {
  const { object, clips } = await factory(id), skin = skinArticulated(object);
  const originalMixer = new THREE.AnimationMixer(object), skinMixer = new THREE.AnimationMixer(skin);
  const file = `${directory}/${catalog.files[`creature_${id}`]}`;
  const glbSha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  if (glbSha256 !== catalog.assets.find(asset => asset.id === `creature_${id}`).sha256) throw new Error(`${id}: staged GLB hash differs from catalogue`);
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const doc = await io.read(file);
  const bytes = await io.writeBinary(doc);
  const loaded = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const loadedMixer = new THREE.AnimationMixer(loaded.scene);
  const samples = [], errors = []; let lowestY = Infinity, maxBoundsDifference = 0;
  for (const clip of clips) {
    originalMixer.stopAllAction(); skinMixer.stopAllAction(); loadedMixer.stopAllAction();
    for (const mixer of [originalMixer, skinMixer]) { const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); }
    const loadedClip = loaded.animations.find(c => c.name === clip.name);
    if (!loadedClip) throw new Error(`${id}: loader missing ${clip.name}`);
    const loadedAction = loadedMixer.clipAction(loadedClip); loadedAction.setLoop(THREE.LoopOnce, 1); loadedAction.clampWhenFinished = true; loadedAction.play();
    let minY = Infinity, maxDifference = 0;
    for (let sample = 0; sample <= 24; sample++) {
      const t = sample * clip.duration / 24;
      originalMixer.setTime(t); skinMixer.setTime(t); object.updateMatrixWorld(true); skin.updateMatrixWorld(true);
      loadedMixer.setTime(t); loaded.scene.updateMatrixWorld(true);
      const a = new THREE.Box3().setFromObject(object, true), b = new THREE.Box3().setFromObject(skin, true);
      const c = new THREE.Box3().setFromObject(loaded.scene, true);
      const coordinates = [...a.min.toArray(), ...a.max.toArray(), ...b.min.toArray(), ...b.max.toArray()];
      if (coordinates.some(v => !Number.isFinite(v))) errors.push(`${clip.name}: nonfinite bounds`);
      maxDifference = Math.max(maxDifference, a.min.distanceTo(b.min), a.max.distanceTo(b.max), a.min.distanceTo(c.min), a.max.distanceTo(c.max));
      minY = Math.min(minY, b.min.y);
    }
    lowestY = Math.min(lowestY, minY); maxBoundsDifference = Math.max(maxBoundsDifference, maxDifference);
    samples.push({ clip: clip.name, minimumY: minY, maxBoundsDifference: maxDifference });
  }
  if (maxBoundsDifference > .001) errors.push(`Skin conversion changes bounds by ${maxBoundsDifference}m`);
  if (lowestY < -.01) errors.push(`Animated geometry penetrates floor by ${-lowestY}m`);
  let weightedVertices = 0;
  for (const node of doc.getRoot().listNodes()) for (const p of node.getMesh()?.listPrimitives() ?? []) {
    const positions = p.getAttribute('POSITION'), weights = p.getAttribute('WEIGHTS_0');
    if (node.getSkin() && (!weights || !p.getAttribute('JOINTS_0'))) errors.push('Missing skin attributes on bound skin');
    for (const attribute of p.listAttributes()) if (Array.from(attribute.getArray()).some(v => !Number.isFinite(v))) errors.push(`Nonfinite ${attribute.getName()}`);
    if (node.getSkin()) weightedVertices += positions.getCount();
  }
  if (!weightedVertices) errors.push('No weighted character geometry');
  reports.push({ id, glbSha256, passed: errors.length === 0, weightedVertices, lowestY, maxBoundsDifference, samples, errors, acceptance: { labAccepted: false, gaitAccepted: false } });
}
await writeFile(`${directory}/compatibility.json`, JSON.stringify(reports, null, 2) + '\n');
console.log(JSON.stringify({ models: reports.length, failed: reports.filter(r => !r.passed).map(r => ({id:r.id,errors:r.errors})), worstFloorM: Math.min(...reports.map(r => r.lowestY)), maximumConversionDifferenceM: Math.max(...reports.map(r => r.maxBoundsDifference)) }, null, 2));
if (reports.some(r => !r.passed)) process.exitCode = 1;
