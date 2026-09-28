// Isolated source import audit. The root owns GLB compilation and browser acceptance.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? new Response(await fs.readFile(fileURLToPath(parsed))) : originalFetch(url, options);
};
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
THREE.TextureLoader.prototype.loadAsync = async function () { return new THREE.Texture(); };
const { buildNightmare } = await import('../nightmare.mjs');
const { object, clips, meta } = await buildNightmare();
const rest = [];
object.traverse(node => rest.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
const restore = () => rest.forEach(([node, position, quaternion, scale]) => {
  node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale);
});
function pose(clip, time) {
  restore();
  const mixer = new THREE.AnimationMixer(object);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(time);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object, true);
  mixer.stopAllAction();
  mixer.uncacheRoot(object);
  restore();
  return { box };
}
const targetNames = [];
object.traverse(node => { if (node.name) targetNames.push(node.name); });
const duplicateNodes = targetNames.filter((name, index) => targetNames.indexOf(name) !== index);
const clipReports = clips.map(clip => {
  const duplicateTracks = clip.tracks.filter((track, index) => clip.tracks.findIndex(candidate => candidate.name === track.name) !== index).map(track => track.name);
  const invalid = clip.tracks.filter(track => [...track.times, ...track.values].some(value => !Number.isFinite(value))).map(track => track.name);
  const unbound = clip.tracks.filter(track => !object.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.')))).map(track => track.name);
  let maxQuaternionSeamDegrees = 0;
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const first = new THREE.Quaternion().fromArray(track.values);
    const last = new THREE.Quaternion().fromArray(track.values, track.values.length - 4);
    maxQuaternionSeamDegrees = Math.max(maxQuaternionSeamDegrees, THREE.MathUtils.radToDeg(first.angleTo(last)));
  }
  let minimumY = Infinity;
  let maximumY = -Infinity;
  const sampleCount = Math.ceil(clip.duration * 240);
  for (let i = 0; i <= sampleCount; i++) {
    const { box } = pose(clip, clip.duration * i / sampleCount);
    minimumY = Math.min(minimumY, box.min.y);
    maximumY = Math.max(maximumY, box.max.y);
  }
  return { name: clip.name, duration: clip.duration, tracks: clip.tracks.length, duplicateTracks, invalid, unbound,
    maxQuaternionSeamDegrees, minimumY, maximumY };
});
restore();
object.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(object, true);
const report = { sourceOnly: true, texturesStubbedForNode: true, browserAcceptance: 'Root pending', meta,
  size: bounds.getSize(new THREE.Vector3()).toArray(), duplicateNodes, clipReports };
const failures = [...duplicateNodes, ...clipReports.flatMap(clip => [...clip.duplicateTracks, ...clip.invalid, ...clip.unbound])];
if (clipReports.some(clip => clip.minimumY < -0.001)) failures.push('Nightmare posed mesh penetrates the ground');
report.failures = failures;
await fs.writeFile(new URL('../../../../test-results/creature-expansion/sources/monsters/nightmare/import-audit.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ size: report.size, speeds: [meta.impliedWalkMps, meta.impliedRunMps], clipReports, failures }, null, 2));
if (failures.length) process.exitCode = 1;
