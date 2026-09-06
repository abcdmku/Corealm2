import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

/**
 * Per-clip ground contact for one GLB, over ALL skinned vertices rather than bone tips.
 *
 * For every clip, sampled at each animation key time and each interval midpoint, reports the lowest
 * skinned world Y reached, when and where, and how long the clip spends with its lowest vertex more
 * than `--float` metres above the floor. A creature that never touches the ground in its idle is
 * floating; one whose minimum is negative is sinking through it. Both read as wrong on screen and
 * neither shows up in a bone-tip check.
 *
 * Usage: npx tsx tools/creature-expansion/mammals/clip-floor-audit.mjs <glb> [--float 0.01]
 */
const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!file) throw Error('Pass one GLB path');
const floatLimit = (() => { const i = process.argv.indexOf('--float'); return i < 0 ? 0.01 : Number(process.argv[i + 1]); })();
const bytes = await readFile(file), sha = createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO(), doc = await io.readBinary(bytes), rt = doc.getRoot(), nodes = rt.listNodes();
const objects = new Map(nodes.map(n => [n, new THREE.Object3D()])), rest = new Map();
for (const n of nodes) { const o = objects.get(n); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale()); rest.set(n, {p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone()}); if (n.getParentNode()) objects.get(n.getParentNode()).add(o); }
const tops = nodes.filter(n => !n.getParentNode()).map(n => objects.get(n)), update = () => tops.forEach(o => o.updateMatrixWorld(true));
const skin = rt.listSkins()[0], joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
const verts = [];
for (const node of nodes) for (const p of node.getMesh()?.listPrimitives() ?? []) {
  const pos = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0');
  for (let i = 0; i < pos.getCount(); i++) { const js = J.getElement(i, []), ws = W.getElement(i, []); verts.push({p: new THREE.Vector3(...pos.getElement(i, [])), w: js.map((j, k) => [j, ws[k]]).filter(x => x[1] > 0), index: verts.length}); }
}
function lowestAt(channels, time) {
  for (const [n, t] of rest) { const o = objects.get(n); o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s); }
  for (const c of channels) { let i = 0; while (i < c.times.length - 2 && c.times[i + 1] < time) i++; const t = THREE.MathUtils.clamp((time - c.times[i]) / (c.times[i + 1] - c.times[i] || 1), 0, 1), a = c.values.getElement(i, []), b = c.values.getElement(i + 1, []), o = objects.get(c.node);
    if (c.path === 'rotation') o.quaternion.fromArray(a).slerp(new THREE.Quaternion().fromArray(b), t); else if (c.path === 'translation') o.position.fromArray(a.map((v, k) => THREE.MathUtils.lerp(v, b[k], t))); else if (c.path === 'scale') o.scale.fromArray(a.map((v, k) => THREE.MathUtils.lerp(v, b[k], t))); }
  update();
  const mats = joints.map((j, i) => objects.get(j).matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))).elements);
  let min = Infinity, at = -1;
  for (const v of verts) { let y = 0; for (const [j, w] of v.w) { const e = mats[j]; y += w * (e[1] * v.p.x + e[5] * v.p.y + e[9] * v.p.z + e[13]); } if (y < min) { min = y; at = v.index; } }
  return {min, at};
}
const clips = [];
for (const anim of rt.listAnimations()) {
  const channels = anim.listChannels().map(c => ({node: c.getTargetNode(), path: c.getTargetPath(), times: Array.from(c.getSampler().getInput().getArray()), values: c.getSampler().getOutput()}));
  const keys = [...new Set(channels.flatMap(c => c.times))].sort((a, b) => a - b);
  const times = [];
  for (let i = 0; i < keys.length; i++) { times.push(keys[i]); if (i + 1 < keys.length) times.push((keys[i] + keys[i + 1]) / 2); }
  let lowest = Infinity, lowestAtTime = 0, lowestVertex = -1, highestMin = -Infinity, highestMinTime = 0, airborne = 0;
  for (const t of times) { const r = lowestAt(channels, t); if (r.min < lowest) { lowest = r.min; lowestAtTime = t; lowestVertex = r.at; } if (r.min > highestMin) { highestMin = r.min; highestMinTime = t; } if (r.min > floatLimit) airborne++; }
  clips.push({clip: anim.getName(), seconds: keys[keys.length - 1], samples: times.length,
    lowestWorldYM: lowest, atSeconds: lowestAtTime, vertex: lowestVertex,
    highestLowestWorldYM: highestMin, atSecondsHighest: highestMinTime,
    samplesFullyAboveFloatLimit: airborne, fractionAirborne: Number((airborne / times.length).toFixed(4))});
}
console.log(JSON.stringify({file, sha256: sha, floatLimitM: floatLimit,
  basis: 'every animation key time and interval midpoint; all skinned vertices; skinned world space',
  clips}, null, 1));
