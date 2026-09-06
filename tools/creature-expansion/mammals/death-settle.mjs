import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

/**
 * Slice 05: when does a Death clip actually stop moving? Reports, per sample, the maximum
 * per-second whole-skinned-mesh vertex speed, and the earliest time after which no vertex moves
 * more than `--still` metres for the rest of the clip. That time is what justifies a settled-corpse
 * capture margin, instead of guessing one. Skinned world space; joints carry the scene scale.
 * Usage: npx tsx tools/creature-expansion/mammals/death-settle.mjs <glb> [--clip Death] [--still 0.002] [--samples 200]
 */
const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!file) throw Error('Pass one GLB path');
const opt = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const clipName = opt('--clip', 'Death'), still = Number(opt('--still', 0.002)), samples = Number(opt('--samples', 200));
const bytes = await readFile(file), sha = createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO(), doc = await io.readBinary(bytes), rt = doc.getRoot(), nodes = rt.listNodes();
const objects = new Map(nodes.map(n => [n, new THREE.Object3D()])), rest = new Map();
for (const n of nodes) { const o = objects.get(n); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale()); rest.set(n, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }); if (n.getParentNode()) objects.get(n.getParentNode()).add(o); }
const tops = nodes.filter(n => !n.getParentNode()).map(n => objects.get(n)), update = () => tops.forEach(o => o.updateMatrixWorld(true));
const skin = rt.listSkins()[0], joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
const verts = [];
for (const node of nodes) for (const p of node.getMesh()?.listPrimitives() ?? []) {
  const pos = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0');
  for (let i = 0; i < pos.getCount(); i++) { const js = J.getElement(i, []), ws = W.getElement(i, []); verts.push({ p: new THREE.Vector3(...pos.getElement(i, [])), w: js.map((j, k) => [j, ws[k]]).filter(x => x[1] > 0) }); }
}
const anim = rt.listAnimations().find(a => a.getName() === clipName);
if (!anim) throw Error(`No ${clipName} clip in ${file}`);
const channels = anim.listChannels().map(c => ({ node: c.getTargetNode(), path: c.getTargetPath(), times: Array.from(c.getSampler().getInput().getArray()), values: c.getSampler().getOutput() }));
const duration = Math.max(...anim.listSamplers().map(s => Math.max(...s.getInput().getArray())));
function pose(time) {
  for (const [n, t] of rest) { const o = objects.get(n); o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s); }
  for (const c of channels) { let i = 0; while (i < c.times.length - 2 && c.times[i + 1] < time) i++; const t = THREE.MathUtils.clamp((time - c.times[i]) / (c.times[i + 1] - c.times[i] || 1), 0, 1), a = c.values.getElement(i, []), b = c.values.getElement(i + 1, []), o = objects.get(c.node);
    if (c.path === 'rotation') o.quaternion.fromArray(a).slerp(new THREE.Quaternion().fromArray(b), t); else if (c.path === 'translation') o.position.fromArray(a.map((n, k) => THREE.MathUtils.lerp(n, b[k], t))); else if (c.path === 'scale') o.scale.fromArray(a.map((n, k) => THREE.MathUtils.lerp(n, b[k], t))); }
  update();
  const mats = joints.map((j, i) => objects.get(j).matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))).elements);
  const out = new Float64Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) { const v = verts[i]; for (const [j, w] of v.w) { const e = mats[j]; out[i * 3] += w * (e[0] * v.p.x + e[4] * v.p.y + e[8] * v.p.z + e[12]); out[i * 3 + 1] += w * (e[1] * v.p.x + e[5] * v.p.y + e[9] * v.p.z + e[13]); out[i * 3 + 2] += w * (e[2] * v.p.x + e[6] * v.p.y + e[10] * v.p.z + e[14]); } }
  return out;
}
const dt = duration / samples, final = pose(duration), rows = [];
for (let s = 0; s <= samples; s++) {
  const t = s * dt, now = pose(t);
  let maxToFinal = 0;
  for (let i = 0; i < now.length; i += 3) maxToFinal = Math.max(maxToFinal, Math.hypot(now[i] - final[i], now[i + 1] - final[i + 1], now[i + 2] - final[i + 2]));
  rows.push({ t: Number(t.toFixed(4)), maxDistanceToFinalPoseM: maxToFinal });
}
let settledAt = duration;
for (let s = rows.length - 1; s >= 0; s--) { if (rows[s].maxDistanceToFinalPoseM <= still) settledAt = rows[s].t; else break; }
console.log(JSON.stringify({ file, sha256: sha, clip: clipName, durationSeconds: duration, stillnessThresholdM: still,
  settledFromSeconds: settledAt, settleMarginSeconds: Number((duration - settledAt).toFixed(4)),
  basis: `${samples + 1} samples; maximum distance of any skinned vertex from its final-frame position`,
  tail: rows.slice(-12) }, null, 1));
