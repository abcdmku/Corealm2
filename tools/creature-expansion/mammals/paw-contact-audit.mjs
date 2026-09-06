import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

/**
 * Slice 05 paw audit. Measures each foot's ACTUAL ground contact patch in metres, in the bind pose
 * skinned world space, plus a top-down occupancy map of the sole. The contact patch is the set of
 * skinned vertices within `--band` metres (default 0.003) of the foot's lowest skinned vertex, not
 * bone tips. Joint transforms already carry the source scene scale, so every figure below is metres.
 * Usage: npx tsx tools/creature-expansion/mammals/paw-contact-audit.mjs <glb> [--band 0.003] [--map]
 *          [--feet FR_Paw,FL_Paw,HR_Paw,HL_Paw]   default: the Khronos Fox terminal joints
 */
const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!file) throw Error('Pass one GLB path');
const argOf = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : Number(process.argv[i + 1]); };
const band = argOf('--band', 0.003), wantMap = process.argv.includes('--map');
const bytes = await readFile(file), sha = createHash('sha256').update(bytes).digest('hex');
const io = new NodeIO(), doc = await io.readBinary(bytes), rt = doc.getRoot(), nodes = rt.listNodes();
const objects = new Map(nodes.map(n => [n, new THREE.Object3D()]));
for (const n of nodes) { const o = objects.get(n); o.name = n.getName(); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale()); if (n.getParentNode()) objects.get(n.getParentNode()).add(o); }
nodes.filter(n => !n.getParentNode()).forEach(n => objects.get(n).updateMatrixWorld(true));
const skin = rt.listSkins()[0], joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
const mats = joints.map((j, i) => objects.get(j).matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))));
const verts = [];
for (const node of nodes) for (const p of node.getMesh()?.listPrimitives() ?? []) {
  const pos = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0');
  for (let i = 0; i < pos.getCount(); i++) {
    const js = J.getElement(i, []), ws = W.getElement(i, []), local = new THREE.Vector3(...pos.getElement(i, [])), out = new THREE.Vector3();
    const weightByJoint = new Map();
    for (let k = 0; k < 4; k++) if (ws[k] > 0) { out.add(local.clone().applyMatrix4(mats[js[k]]).multiplyScalar(ws[k])); weightByJoint.set(js[k], (weightByJoint.get(js[k]) ?? 0) + ws[k]); }
    verts.push({ world: out, weightByJoint });
  }
}
// A foot region is every vertex with at least half its weight on the terminal foot/hand joint.
const feetArg = (() => { const i = process.argv.indexOf('--feet'); return i < 0 ? null : process.argv[i + 1]; })();
const feet = feetArg ? feetArg.split(',') : ['b_RightHand_08', 'b_LeftHand_011', 'b_LeftFoot02_018', 'b_RightFoot02_022'];
const report = { file, sha256: sha, bandMetres: band, units: 'metres', feet: [] };
for (const name of feet) {
  const index = joints.findIndex(j => j.getName() === name);
  if (index < 0) { report.feet.push({ bone: name, error: 'missing joint' }); continue; }
  const region = verts.filter(v => (v.weightByJoint.get(index) ?? 0) >= 0.5);
  if (!region.length) { report.feet.push({ bone: name, error: 'no vertices' }); continue; }
  const lowest = Math.min(...region.map(v => v.world.y));
  const patch = region.filter(v => v.world.y <= lowest + band);
  const ext = arr => ({ min: Math.min(...arr), max: Math.max(...arr), span: Math.max(...arr) - Math.min(...arr) });
  const x = ext(patch.map(v => v.world.x)), z = ext(patch.map(v => v.world.z));
  // Width profile along the foot's long axis, so a pointed toe shows up as a collapsing width.
  const slices = 8, profile = [];
  for (let s = 0; s < slices; s++) {
    const lo = z.min + (s / slices) * z.span, hi = z.min + ((s + 1) / slices) * z.span;
    const inSlice = patch.filter(v => v.world.z >= lo - 1e-9 && v.world.z <= hi + 1e-9);
    profile.push({ zFromRear: Number(((lo - z.min) * 100).toFixed(2)), vertices: inSlice.length, widthCm: inSlice.length ? Number(((Math.max(...inSlice.map(v => v.world.x)) - Math.min(...inSlice.map(v => v.world.x))) * 100).toFixed(2)) : 0 });
  }
  const row = { bone: name, regionVertices: region.length, lowestWorldYM: lowest, contactVertices: patch.length,
    contactWidthCm: Number((x.span * 100).toFixed(2)), contactLengthCm: Number((z.span * 100).toFixed(2)),
    aspect: Number((x.span / z.span).toFixed(3)), widthProfileCm: profile };
  if (wantMap) {
    const cols = 16, rows = 20, grid = Array.from({ length: rows }, () => Array(cols).fill('.'));
    for (const v of patch) { const c = Math.min(cols - 1, Math.floor((v.world.x - x.min) / (x.span || 1) * cols)), r = Math.min(rows - 1, Math.floor((v.world.z - z.min) / (z.span || 1) * rows)); grid[r][c] = '#'; }
    row.topDownMap = grid.map(r => r.join(''));
  }
  report.feet.push(row);
}
console.log(JSON.stringify(report, null, 1));
