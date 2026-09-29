/**
 * Measures how far a creature's clips drive one body part through another: a limb through the
 * chest, the thighs through each other, a wing through the torso, a staff through the body.
 *
 *   node tools/creature-motion/self-intersection.mjs <glb> [<glb> ...] [--manifest] [--clips A,B]
 *        [--fps 15] [--min 4] [--cut 3] [--top 3] [--jobs 22] [--json out.json]
 *
 * `--manifest` adds every manifest model with a Death clip (the creature set). Files run in
 * parallel worker threads.
 *
 * Each triangle belongs to the bone with the largest summed skin weight over its three vertices
 * (a rigid mesh parented to a bone belongs to that bone). Every pair of distinct parts is tested
 * (Möller's tri-tri test over a uniform grid of triangle bounds, CPU skinning); triangles sharing a
 * welded corner are skipped. Parts up to three bones apart meet at joints, so for those pairs a hit
 * within a joint's crease radius of a bone head on the path between them is the crease, not a
 * fault. The radius is 1.5x the seam's reach around that joint at bind, doubled for a parent and
 * child (a deep knee folds the calf against the thigh). A wing sweeping through its parent torso
 * away from the root still counts.
 *
 * Per pair the tool measures the intersecting triangle pairs and the length of the intersection
 * curve. The pair's baseline is the larger of the bind pose and Idle's first frame, so modelled
 * contacts don't count. Every clip is sampled at `--fps` plus its last frame, and a pair is
 * reported when it exceeds its baseline by at least `--min` triangle pairs and by a curve length
 * of at least `--cut` percent of the body diagonal. `cut` does not depend on tessellation: a limb
 * passing through another leaves a loop about its girth long. `share` is the larger of the two
 * parts' fractions of surface on intersecting triangles, over baseline.
 *
 * A frame's score is the summed excess cut of its reported pairs; a clip's score is its worst
 * frame; the model score is its worst clip. The cut measures length, not depth: a planar part lying
 * flush against the body (a folded wing, stacked wing blades) scores without showing. Render
 * flagged frames with `contact-sheet.mjs --views audit` before calling anything a fault.
 */
import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Parses a GLB with its images stripped: Node has no image decoder and geometry is all we need. */
async function loadGlbGeometry(file) {
  const bytes = await readFile(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Not a GLB: ${file}`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  json.materials = json.materials?.map((material) => ({ name: material.name, doubleSided: material.doubleSided }));
  json.images = []; json.textures = []; json.samplers = [];
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((name) => !/texture|KHR_materials/i.test(name));
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((name) => !/texture/i.test(name));
  const text = Buffer.from(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const tail = bytes.subarray(20 + jsonLength);
  const rebuilt = Buffer.alloc(20 + padded + tail.length, 0x20);
  rebuilt.writeUInt32LE(0x46546c67, 0); rebuilt.writeUInt32LE(2, 4); rebuilt.writeUInt32LE(rebuilt.length, 8);
  rebuilt.writeUInt32LE(padded, 12); rebuilt.writeUInt32LE(0x4e4f534a, 16);
  text.copy(rebuilt, 20); tail.copy(rebuilt, 20 + padded);
  await MeshoptDecoder.ready;
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(new Uint8Array(rebuilt).buffer, "");
}

// ---------------------------------------------------------------------------------------------
// Triangle-triangle intersection (Möller 1997, interval overlap on the planes' intersection line).
// Coplanar and merely touching triangles do not count.

const tv = new Float64Array(18);
let EPS = 1e-7;
/** Crease radius as a multiple of the seam's 90th-percentile distance from the joint. */
const CREASE = 1.5;
/** A child folds against its parent along its length (a deep knee), so that crease reaches farther. */
const CHILD_CREASE = 2;

function interval(p0, p1, p2, d0, d1, d2, out) {
  const d0d1 = d0 * d1, d0d2 = d0 * d2;
  let a, b, c, da, db, dc;
  if (d0d1 > 0) { a = p2; b = p0; c = p1; da = d2; db = d0; dc = d1; }
  else if (d0d2 > 0) { a = p1; b = p0; c = p2; da = d1; db = d0; dc = d2; }
  else if (d1 * d2 > 0 || d0 !== 0) { a = p0; b = p1; c = p2; da = d0; db = d1; dc = d2; }
  else if (d1 !== 0) { a = p1; b = p0; c = p2; da = d1; db = d0; dc = d2; }
  else if (d2 !== 0) { a = p2; b = p0; c = p1; da = d2; db = d0; dc = d1; }
  else return false;
  const s = a + (b - a) * da / (da - db), t = a + (c - a) * da / (da - dc);
  out[0] = Math.min(s, t); out[1] = Math.max(s, t);
  return true;
}

const iv1 = new Float64Array(2), iv2 = new Float64Array(2);
/** After a hit: midpoint xyz and length of the intersection segment. */
const seg = new Float64Array(4);
/** tv holds v0 v1 v2 u0 u1 u2 (xyz each). */
function triTri() {
  const [v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z, u0x, u0y, u0z, u1x, u1y, u1z, u2x, u2y, u2z] = tv;
  // Plane of V.
  let e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z, e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
  let n1x = e1y * e2z - e1z * e2y, n1y = e1z * e2x - e1x * e2z, n1z = e1x * e2y - e1y * e2x;
  let len = Math.hypot(n1x, n1y, n1z);
  if (len === 0) return false;
  n1x /= len; n1y /= len; n1z /= len;
  const d1 = -(n1x * v0x + n1y * v0y + n1z * v0z);
  let du0 = n1x * u0x + n1y * u0y + n1z * u0z + d1, du1 = n1x * u1x + n1y * u1y + n1z * u1z + d1, du2 = n1x * u2x + n1y * u2y + n1z * u2z + d1;
  if (Math.abs(du0) < EPS) du0 = 0; if (Math.abs(du1) < EPS) du1 = 0; if (Math.abs(du2) < EPS) du2 = 0;
  if (du0 * du1 > 0 && du0 * du2 > 0) return false;
  // Plane of U.
  e1x = u1x - u0x; e1y = u1y - u0y; e1z = u1z - u0z; e2x = u2x - u0x; e2y = u2y - u0y; e2z = u2z - u0z;
  let n2x = e1y * e2z - e1z * e2y, n2y = e1z * e2x - e1x * e2z, n2z = e1x * e2y - e1y * e2x;
  len = Math.hypot(n2x, n2y, n2z);
  if (len === 0) return false;
  n2x /= len; n2y /= len; n2z /= len;
  const d2 = -(n2x * u0x + n2y * u0y + n2z * u0z);
  let dv0 = n2x * v0x + n2y * v0y + n2z * v0z + d2, dv1 = n2x * v1x + n2y * v1y + n2z * v1z + d2, dv2 = n2x * v2x + n2y * v2y + n2z * v2z + d2;
  if (Math.abs(dv0) < EPS) dv0 = 0; if (Math.abs(dv1) < EPS) dv1 = 0; if (Math.abs(dv2) < EPS) dv2 = 0;
  if (dv0 * dv1 > 0 && dv0 * dv2 > 0) return false;
  // Project onto the largest axis of the intersection line.
  const dx = Math.abs(n1y * n2z - n1z * n2y), dy = Math.abs(n1z * n2x - n1x * n2z), dz = Math.abs(n1x * n2y - n1y * n2x);
  let vp0, vp1, vp2, up0, up1, up2;
  if (dx >= dy && dx >= dz) { vp0 = v0x; vp1 = v1x; vp2 = v2x; up0 = u0x; up1 = u1x; up2 = u2x; }
  else if (dy >= dz) { vp0 = v0y; vp1 = v1y; vp2 = v2y; up0 = u0y; up1 = u1y; up2 = u2y; }
  else { vp0 = v0z; vp1 = v1z; vp2 = v2z; up0 = u0z; up1 = u1z; up2 = u2z; }
  if (!interval(vp0, vp1, vp2, dv0, dv1, dv2, iv1)) return false;
  if (!interval(up0, up1, up2, du0, du1, du2, iv2)) return false;
  const lo = Math.max(iv1[0], iv2[0]), hi = Math.min(iv1[1], iv2[1]);
  if (hi <= lo) return false;
  // The intersection segment: a point on the planes' line, then the overlap's midpoint and length.
  const Dx = n1y * n2z - n1z * n2y, Dy = n1z * n2x - n1x * n2z, Dz = n1x * n2y - n1y * n2x;
  const DD = Dx * Dx + Dy * Dy + Dz * Dz;
  if (DD < 1e-12) return false;
  const h1 = -d1, h2 = -d2;
  const ox = (h1 * (n2y * Dz - n2z * Dy) + h2 * (Dy * n1z - Dz * n1y)) / DD;
  const oy = (h1 * (n2z * Dx - n2x * Dz) + h2 * (Dz * n1x - Dx * n1z)) / DD;
  const oz = (h1 * (n2x * Dy - n2y * Dx) + h2 * (Dx * n1y - Dy * n1x)) / DD;
  const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;
  const Da = axis === 0 ? Dx : axis === 1 ? Dy : Dz, Oa = axis === 0 ? ox : axis === 1 ? oy : oz;
  const k = ((lo + hi) / 2 - Oa) / Da;
  seg[0] = ox + Dx * k; seg[1] = oy + Dy * k; seg[2] = oz + Dz * k;
  seg[3] = (hi - lo) * Math.sqrt(DD) / Math.abs(Da);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Model: parts, triangles, CPU skinning.

function buildModel(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const restTRS = [];
  root.traverse((node) => restTRS.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
  const restore = () => { for (const [node, p, q, s] of restTRS) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); } root.updateMatrixWorld(true); };

  const skinned = [], plain = [];
  root.traverse((node) => { if (node.isSkinnedMesh) skinned.push(node); else if (node.isMesh) plain.push(node); });
  const boneIndex = new Map();
  const boneInverse = new Map();
  for (const mesh of skinned) mesh.skeleton.bones.forEach((bone, i) => {
    if (!boneIndex.has(bone)) boneIndex.set(bone, boneIndex.size);
    if (!boneInverse.has(bone)) boneInverse.set(bone, mesh.skeleton.boneInverses[i]);
  });
  root.traverse((node) => { if (node.isBone && !boneIndex.has(node)) boneIndex.set(node, boneIndex.size); });
  const bones = [...boneIndex.keys()];
  const parent = bones.map((bone) => { let p = bone.parent; while (p && !boneIndex.has(p)) p = p.parent; return p ? boneIndex.get(p) : -1; });
  const P = bones.length;
  // Parts close in the tree meet at joints: for pairs up to three bones apart, intersections
  // within a joint's crease radius of any bone head on the path between them (the common ancestor
  // excluded) are the crease, not a fault. Farther pairs are compared everywhere.
  const depth = parent.map((_, i) => { let d = 0; for (let p = parent[i]; p >= 0; p = parent[p]) d += 1; return d; });
  const pathJoints = (a, b) => {
    const joints = [];
    while (depth[a] > depth[b]) { joints.push(a); a = parent[a]; }
    while (depth[b] > depth[a]) { joints.push(b); b = parent[b]; }
    while (a !== b) { joints.push(a, b); a = parent[a]; b = parent[b]; }
    return a >= 0 && joints.length <= 3 ? joints : null;
  };
  const candidate = new Uint8Array(P * P);
  const joints = new Array(P * P).fill(null);
  for (let a = 0; a < P; a += 1) for (let b = 0; b < P; b += 1) {
    if (a === b) continue;
    candidate[a * P + b] = 1;
    joints[a * P + b] = pathJoints(a, b);
  }

  // Meshes -> one vertex and triangle list. Rigid meshes with no bone ancestor are skipped.
  const entries = [];
  let vertexCount = 0;
  const triangles = [], parts = [];
  const bindMatrixFor = (mesh) => {
    let p = mesh.parent; while (p && !boneIndex.has(p)) p = p.parent;
    if (!p) return null;
    // Bone at bind in scene space is the inverse of its inverse bind matrix; keep the mesh's offset from it.
    const inverse = boneInverse.get(p);
    const boneBind = inverse ? inverse.clone().invert() : p.matrixWorld.clone();
    return { bone: boneIndex.get(p), bind: boneBind.multiply(p.matrixWorld.clone().invert()).multiply(mesh.matrixWorld) };
  };
  for (const mesh of [...skinned, ...plain]) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) continue;
    const count = position.count;
    let rigidPart = -1, bind = null;
    if (!mesh.isSkinnedMesh) {
      const found = bindMatrixFor(mesh);
      if (!found) continue;
      rigidPart = found.bone; bind = found.bind;
    }
    const source = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) { source[i * 3] = position.getX(i); source[i * 3 + 1] = position.getY(i); source[i * 3 + 2] = position.getZ(i); }
    const entry = { mesh, offset: vertexCount, count, source, rigidPart, bind };
    if (mesh.isSkinnedMesh) {
      const si = geometry.getAttribute("skinIndex"), sw = geometry.getAttribute("skinWeight");
      entry.joints = new Uint16Array(count * 4); entry.weights = new Float32Array(count * 4);
      entry.map = mesh.skeleton.bones.map((bone) => boneIndex.get(bone));
      for (let i = 0; i < count; i += 1) {
        const w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
        const sum = w[0] + w[1] + w[2] + w[3] || 1;
        entry.joints.set([si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], i * 4);
        entry.weights.set(w.map((x) => x / sum), i * 4);
      }
      entry.morph = !!(geometry.morphAttributes.position?.length && mesh.morphTargetInfluences);
    }
    const index = geometry.index;
    const triCount = index ? index.count / 3 : count / 3;
    for (let t = 0; t < triCount; t += 1) {
      const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      triangles.push(a + vertexCount, b + vertexCount, c + vertexCount);
      if (rigidPart >= 0) { parts.push(rigidPart); continue; }
      const score = new Map();
      for (const v of [a, b, c]) for (let k = 0; k < 4; k += 1) {
        const w = entry.weights[v * 4 + k];
        if (w > 0) { const bone = entry.map[entry.joints[v * 4 + k]]; score.set(bone, (score.get(bone) ?? 0) + w); }
      }
      let best = -1, bestW = -1;
      for (const [bone, w] of score) if (w > bestW) { best = bone; bestW = w; }
      parts.push(best);
    }
    entries.push(entry);
    vertexCount += count;
  }
  const model = {
    root, restore, bones, parent, P, candidate, joints, entries, vertexCount,
    tri: Int32Array.from(triangles), part: Int32Array.from(parts), T: parts.length,
  };
  // Bind pose: every skinning matrix is the identity in bind space.
  const bindPose = new Float32Array(vertexCount * 3);
  skin(model, bindPose, true);
  // glTF bind space ignores the armature's own transform, so an FBX-born rig binds at 100x the
  // scene scale. Bring the bind pose (and its bone heads) to scene scale by the median ratio of
  // bone lengths at rest and at bind; intersections don't care about the offset or rotation.
  const head = new Float64Array(P * 3), restHead = new Float64Array(P * 3);
  bones.forEach((bone, b) => {
    const inverse = boneInverse.get(bone);
    const e = (inverse ? inverse.clone().invert() : bone.matrixWorld).elements, r = bone.matrixWorld.elements;
    head.set([e[12], e[13], e[14]], b * 3); restHead.set([r[12], r[13], r[14]], b * 3);
  });
  const ratios = [];
  for (let b = 0; b < P; b += 1) {
    const p = parent[b];
    if (p < 0) continue;
    const bindLength = Math.hypot(head[b * 3] - head[p * 3], head[b * 3 + 1] - head[p * 3 + 1], head[b * 3 + 2] - head[p * 3 + 2]);
    const restLength = Math.hypot(restHead[b * 3] - restHead[p * 3], restHead[b * 3 + 1] - restHead[p * 3 + 1], restHead[b * 3 + 2] - restHead[p * 3 + 2]);
    if (bindLength > 1e-9 && restLength > 1e-9) ratios.push(restLength / bindLength);
  }
  ratios.sort((x, y) => x - y);
  const scale = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  for (let i = 0; i < bindPose.length; i += 1) bindPose[i] *= scale;
  for (let i = 0; i < head.length; i += 1) head[i] *= scale;
  model.bindPose = bindPose;
  model.bindHead = head;
  // Weld vertices that coincide at bind (UV/normal seams), so triangles sharing a corner across a
  // seam are not tested against each other.
  const box = new THREE.Box3();
  for (let i = 0; i < vertexCount; i += 1) box.expandByPoint(new THREE.Vector3(bindPose[i * 3], bindPose[i * 3 + 1], bindPose[i * 3 + 2]));
  const diag = box.getSize(new THREE.Vector3()).length();
  model.diag = diag;
  const q = diag * 1e-5, weld = new Map(), vid = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) {
    const key = `${Math.round(bindPose[i * 3] / q)},${Math.round(bindPose[i * 3 + 1] / q)},${Math.round(bindPose[i * 3 + 2] / q)}`;
    let id = weld.get(key); if (id === undefined) { id = weld.size; weld.set(key, id); }
    vid[i] = id;
  }
  model.vid = vid;
  // Part areas at bind, and a grid cell size from the typical triangle extent.
  const triArea = new Float32Array(model.T), partArea = new Float64Array(P), extents = [];
  for (let t = 0; t < model.T; t += 1) {
    const [a, b, c] = [model.tri[t * 3], model.tri[t * 3 + 1], model.tri[t * 3 + 2]];
    const A = new THREE.Vector3().fromArray(bindPose, a * 3), B = new THREE.Vector3().fromArray(bindPose, b * 3), C = new THREE.Vector3().fromArray(bindPose, c * 3);
    const area = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).length() / 2;
    triArea[t] = area;
    if (model.part[t] >= 0) partArea[model.part[t]] += area;
    extents.push(Math.max(Math.abs(A.x - B.x), Math.abs(A.x - C.x), Math.abs(A.y - B.y), Math.abs(A.y - C.y), Math.abs(A.z - B.z), Math.abs(A.z - C.z)));
  }
  extents.sort((x, y) => x - y);
  model.triArea = triArea; model.partArea = partArea;
  model.cell = Math.max(extents[Math.floor(extents.length * 0.75)] ?? diag / 50, diag / 200) * 1.5;

  // Crease radius per joint (bone head at bind): the seam where the bone's part meets the rest of
  // the body, i.e. its vertices shared with a part that is not its own or a descendant's. A part
  // with no seam (a separate rigid piece) uses its vertices nearest the head.
  const parentOf = model.parent;
  const partsAt = new Map();
  for (let t = 0; t < model.T; t += 1) for (let k = 0; k < 3; k += 1) {
    const id = vid[model.tri[t * 3 + k]];
    let set = partsAt.get(id); if (!set) partsAt.set(id, set = new Set());
    set.add(model.part[t]);
  }
  const descends = (p, j) => { for (; p >= 0; p = parentOf[p]) if (p === j) return true; return false; };
  const seam = Array.from({ length: P }, () => []), own = Array.from({ length: P }, () => []);
  const firstAt = new Map();
  for (let v = 0; v < vertexCount; v += 1) if (!firstAt.has(vid[v])) firstAt.set(vid[v], v);
  for (const [id, set] of partsAt) {
    const v = firstAt.get(id);
    for (const j of set) {
      if (j < 0) continue;
      const d = Math.hypot(bindPose[v * 3] - head[j * 3], bindPose[v * 3 + 1] - head[j * 3 + 1], bindPose[v * 3 + 2] - head[j * 3 + 2]);
      own[j].push(d);
      for (const p of set) if (p >= 0 && p !== j && !descends(p, j)) { seam[j].push(d); break; }
    }
  }
  const pct = (values, q) => { values.sort((x, y) => x - y); return values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0; };
  model.crease = Float64Array.from({ length: P }, (_, j) => seam[j].length >= 3 ? pct(seam[j], 0.9) * CREASE : own[j].length ? pct(own[j], 0.1) * CREASE : 0);
  return model;
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
/** World positions of every vertex at the current pose (or the bind pose). */
function skin(model, out, bind = false) {
  for (const entry of model.entries) {
    const { mesh, offset, count, source } = entry;
    if (!mesh.isSkinnedMesh) {
      const e = (bind ? entry.bind : mesh.matrixWorld).elements;
      for (let i = 0; i < count; i += 1) {
        const x = source[i * 3], y = source[i * 3 + 1], z = source[i * 3 + 2], o = (offset + i) * 3;
        out[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      continue;
    }
    if (entry.morph && !bind) {
      for (let i = 0; i < count; i += 1) {
        mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld);
        out[(offset + i) * 3] = _v.x; out[(offset + i) * 3 + 1] = _v.y; out[(offset + i) * 3 + 2] = _v.z;
      }
      continue;
    }
    const { skeleton, bindMatrix, bindMatrixInverse, matrixWorld } = mesh;
    const nb = skeleton.bones.length, mats = new Float64Array(nb * 16);
    for (let j = 0; j < nb; j += 1) {
      _m.copy(matrixWorld).multiply(bindMatrixInverse);
      if (!bind) _m.multiply(skeleton.bones[j].matrixWorld).multiply(skeleton.boneInverses[j]);
      _m.multiply(bindMatrix);
      mats.set(_m.elements, j * 16);
    }
    const { joints, weights } = entry;
    for (let i = 0; i < count; i += 1) {
      const x = source[i * 3], y = source[i * 3 + 1], z = source[i * 3 + 2];
      let rx = 0, ry = 0, rz = 0;
      for (let k = 0; k < 4; k += 1) {
        const w = weights[i * 4 + k];
        if (!w) continue;
        const e = joints[i * 4 + k] * 16;
        rx += w * (mats[e] * x + mats[e + 4] * y + mats[e + 8] * z + mats[e + 12]);
        ry += w * (mats[e + 1] * x + mats[e + 5] * y + mats[e + 9] * z + mats[e + 13]);
        rz += w * (mats[e + 2] * x + mats[e + 6] * y + mats[e + 10] * z + mats[e + 14]);
      }
      const o = (offset + i) * 3;
      out[o] = rx; out[o + 1] = ry; out[o + 2] = rz;
    }
  }
}

/** Bone head positions at the current pose. */
function heads(model) {
  const out = new Float64Array(model.P * 3);
  model.bones.forEach((bone, b) => { const e = bone.matrixWorld.elements; out[b * 3] = e[12]; out[b * 3 + 1] = e[13]; out[b * 3 + 2] = e[14]; });
  return out;
}

/**
 * Intersecting triangle pairs per candidate part pair: Map key (a*P+b, a<b) -> { n, a:Set, b:Set }.
 * Uniform grid over triangle bounds; a pair is tested only in the cell holding the low corner of
 * the overlap of their bounds, so each pair is tested once.
 */
function intersect(model, pos, heads, points = false) {
  const { T, tri, part, P, candidate, vid } = model;
  const box = new Float32Array(T * 6);
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let t = 0; t < T; t += 1) {
    if (part[t] < 0) continue;
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const x0 = Math.min(pos[a], pos[b], pos[c]), y0 = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]), z0 = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]);
    const x1 = Math.max(pos[a], pos[b], pos[c]), y1 = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]), z1 = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
    box[t * 6] = x0; box[t * 6 + 1] = y0; box[t * 6 + 2] = z0; box[t * 6 + 3] = x1; box[t * 6 + 4] = y1; box[t * 6 + 5] = z1;
    if (x0 < minx) minx = x0; if (y0 < miny) miny = y0; if (z0 < minz) minz = z0;
    if (x1 > maxx) maxx = x1; if (y1 > maxy) maxy = y1; if (z1 > maxz) maxz = z1;
  }
  let cs = model.cell;
  const span = Math.max(maxx - minx, maxy - miny, maxz - minz);
  if (span / cs > 160) cs = span / 160;
  const nx = Math.floor((maxx - minx) / cs) + 1, ny = Math.floor((maxy - miny) / cs) + 1, nz = Math.floor((maxz - minz) / cs) + 1;
  const cells = nx * ny * nz;
  const counts = new Int32Array(cells + 1);
  const cellRange = (t, fn) => {
    const i0 = Math.floor((box[t * 6] - minx) / cs), j0 = Math.floor((box[t * 6 + 1] - miny) / cs), k0 = Math.floor((box[t * 6 + 2] - minz) / cs);
    const i1 = Math.floor((box[t * 6 + 3] - minx) / cs), j1 = Math.floor((box[t * 6 + 4] - miny) / cs), k1 = Math.floor((box[t * 6 + 5] - minz) / cs);
    for (let k = k0; k <= k1; k += 1) for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) fn(i + nx * (j + ny * k));
  };
  for (let t = 0; t < T; t += 1) if (part[t] >= 0) cellRange(t, (c) => { counts[c + 1] += 1; });
  for (let c = 0; c < cells; c += 1) counts[c + 1] += counts[c];
  const fill = counts.slice(0, cells), list = new Int32Array(counts[cells]);
  for (let t = 0; t < T; t += 1) if (part[t] >= 0) cellRange(t, (c) => { list[fill[c]++] = t; });

  const pairs = new Map();
  for (let c = 0; c < cells; c += 1) {
    const s = counts[c], e = counts[c + 1];
    if (e - s < 2) continue;
    const ci = c % nx, cj = Math.floor(c / nx) % ny, ck = Math.floor(c / (nx * ny));
    for (let x = s; x < e; x += 1) {
      const ta = list[x], pa = part[ta];
      for (let y = x + 1; y < e; y += 1) {
        const tb = list[y], pb = part[tb];
        if (!candidate[pa * P + pb]) continue;
        const A = ta * 6, B = tb * 6;
        if (box[A] > box[B + 3] || box[B] > box[A + 3] || box[A + 1] > box[B + 4] || box[B + 1] > box[A + 4] || box[A + 2] > box[B + 5] || box[B + 2] > box[A + 5]) continue;
        if (Math.floor((Math.max(box[A], box[B]) - minx) / cs) !== ci || Math.floor((Math.max(box[A + 1], box[B + 1]) - miny) / cs) !== cj || Math.floor((Math.max(box[A + 2], box[B + 2]) - minz) / cs) !== ck) continue;
        const a0 = vid[tri[ta * 3]], a1 = vid[tri[ta * 3 + 1]], a2 = vid[tri[ta * 3 + 2]];
        const b0 = vid[tri[tb * 3]], b1 = vid[tri[tb * 3 + 1]], b2 = vid[tri[tb * 3 + 2]];
        if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) continue;
        for (let k = 0; k < 3; k += 1) {
          const va = tri[ta * 3 + k] * 3, vb = tri[tb * 3 + k] * 3;
          tv[k * 3] = pos[va]; tv[k * 3 + 1] = pos[va + 1]; tv[k * 3 + 2] = pos[va + 2];
          tv[9 + k * 3] = pos[vb]; tv[9 + k * 3 + 1] = pos[vb + 1]; tv[9 + k * 3 + 2] = pos[vb + 2];
        }
        if (!triTri()) continue;
        const [lo, hi, tlo, thi] = pa < pb ? [pa, pb, ta, tb] : [pb, pa, tb, ta];
        const key = lo * P + hi;
        const near = model.joints[key];
        if (near && near.some((j) => Math.hypot(seg[0] - heads[j * 3], seg[1] - heads[j * 3 + 1], seg[2] - heads[j * 3 + 2]) < model.crease[j] * (near.length === 1 ? CHILD_CREASE : 1))) continue;
        let entry = pairs.get(key);
        if (!entry) { entry = { n: 0, len: 0, a: new Set(), b: new Set() }; pairs.set(key, entry); }
        entry.n += 1; entry.len += seg[3]; entry.a.add(tlo); entry.b.add(thi);
        if (points) (entry.points ??= []).push(seg[0], seg[1], seg[2]);
      }
    }
  }
  return pairs;
}

/** Fraction of the more-involved part's surface sitting on intersecting triangles. */
function share(model, key, entry) {
  const a = Math.floor(key / model.P), b = key % model.P;
  let sa = 0, sb = 0;
  for (const t of entry.a) sa += model.triArea[t];
  for (const t of entry.b) sb += model.triArea[t];
  return Math.max(sa / (model.partArea[a] || 1), sb / (model.partArea[b] || 1));
}

function sampleClip(model, clip) {
  const mixer = new THREE.AnimationMixer(model.root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  return {
    at(t) { mixer.setTime(Math.min(t, clip.duration)); model.root.updateMatrixWorld(true); },
    done() { action.stop(); mixer.uncacheRoot(model.root); model.restore(); },
  };
}

async function analyze(file, opts) {
  const started = Date.now();
  const gltf = await loadGlbGeometry(file);
  const model = buildModel(gltf);
  EPS = model.diag * 1e-7;
  const name = (i) => model.bones[i].name || `bone${i}`;
  const pos = new Float32Array(model.vertexCount * 3);
  // Baseline: bind pose and Idle's first frame.
  const base = new Map();
  const zero = { n: 0, len: 0, share: 0 };
  const take = (pairs) => { for (const [key, e] of pairs) { const prev = base.get(key) ?? zero; base.set(key, { n: Math.max(prev.n, e.n), len: Math.max(prev.len, e.len), share: Math.max(prev.share, share(model, key, e)) }); } };
  take(intersect(model, model.bindPose, model.bindHead));
  const idle = gltf.animations.find((clip) => clip.name === "Idle");
  if (idle) { const s = sampleClip(model, idle); s.at(0); skin(model, pos); take(intersect(model, pos, heads(model))); s.done(); }

  const clips = {};
  let score = 0, worst = null;
  for (const clip of gltf.animations) {
    if (opts.clips.length && !opts.clips.includes(clip.name)) continue;
    const times = [];
    for (let t = 0; t < clip.duration - 1e-6; t += 1 / opts.fps) times.push(t);
    times.push(clip.duration);
    const s = sampleClip(model, clip);
    const frames = [];
    for (const t of times) {
      s.at(t); skin(model, pos);
      const pairs = [];
      for (const [key, e] of intersect(model, pos, heads(model))) {
        const b = base.get(key) ?? zero;
        const excess = e.n - b.n, cut = (100 * (e.len - b.len)) / model.diag;
        if (excess < opts.min || cut < opts.cut) continue;
        const a = Math.floor(key / model.P), c = key % model.P;
        pairs.push({ a: name(a), b: name(c), hops: model.joints[key]?.length ?? 4, cut: +cut.toFixed(2), excess, n: e.n, base: b.n, share: +Math.max(0, share(model, key, e) - b.share).toFixed(4) });
      }
      pairs.sort((x, y) => y.cut - x.cut);
      frames.push({ t: +t.toFixed(3), phase: +(t / (clip.duration || 1)).toFixed(3), score: +pairs.reduce((sum, p) => sum + p.cut, 0).toFixed(2), excess: pairs.reduce((sum, p) => sum + p.excess, 0), share: pairs.reduce((m, p) => Math.max(m, p.share), 0), pairs });
    }
    s.done();
    const ranked = [...frames].sort((x, y) => y.score - x.score).filter((f) => f.score > 0);
    const clipScore = ranked[0]?.score ?? 0;
    clips[clip.name] = {
      duration: +clip.duration.toFixed(3), frames: frames.length, flaggedFrames: ranked.length, score: clipScore,
      share: ranked.reduce((m, f) => Math.max(m, f.share), 0),
      scores: frames.map((f) => f.score),
      worst: ranked.slice(0, opts.top).map((f) => ({ ...f, pairs: f.pairs.slice(0, 6) })),
    };
    if (clipScore > score) { score = clipScore; worst = { clip: clip.name, ...ranked[0], pairs: ranked[0].pairs.slice(0, 3) }; }
  }
  const baseline = [...base].filter(([, b]) => b.n > 0).sort((x, y) => y[1].len - x[1].len).slice(0, 12)
    .map(([key, b]) => ({ a: name(Math.floor(key / model.P)), b: name(key % model.P), n: b.n, cut: +((100 * b.len) / model.diag).toFixed(2), share: +b.share.toFixed(4) }));
  return { file: path.relative(repo, path.resolve(file)).replaceAll("\\", "/"), triangles: model.T, bones: model.P, score, worst, baseline, clips, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------------------------

/** Pieces for one-off probes (e.g. marking a flagged frame's intersection points in a render). */
export { loadGlbGeometry, buildModel, skin, intersect, heads };

if (!isMainThread) {
  parentPort.on("message", async (file) => {
    try { parentPort.postMessage({ file, result: await analyze(file, workerData) }); }
    catch (error) { parentPort.postMessage({ file, error: String(error?.stack ?? error) }); }
  });
} else if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const option = (flag, fallback) => { const i = args.indexOf(`--${flag}`); return i >= 0 ? args[i + 1] : fallback; };
  const valued = new Set(["--clips", "--fps", "--min", "--cut", "--top", "--jobs", "--json"]);
  const files = args.filter((arg, i) => !arg.startsWith("--") && !valued.has(args[i - 1]));
  if (args.includes("--manifest")) {
    const manifest = JSON.parse(await readFile(path.join(repo, "game/public/assets/manifest.json"), "utf8"));
    for (const asset of manifest.assets) if (asset.animations?.includes("Death") && asset.file?.endsWith(".glb")) files.push(path.join(repo, "game/public/assets", asset.file));
  }
  if (!files.length) {
    console.error("usage: self-intersection.mjs <glb> [<glb> ...] [--manifest] [--clips A,B] [--fps 15] [--min 4] [--top 3] [--jobs N] [--json out.json]");
    process.exit(2);
  }
  const opts = { clips: option("clips", "") ? option("clips", "").split(",") : [], fps: Number(option("fps", "15")), min: Number(option("min", "4")), cut: Number(option("cut", "3")), top: Number(option("top", "3")) };
  const jobs = Math.max(1, Math.min(files.length, Number(option("jobs", String(Math.max(1, availableParallelism() - 2))))));
  const results = [];
  const queue = [...files];
  const started = Date.now();
  await Promise.all(Array.from({ length: jobs }, () => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: opts });
    const next = () => { const file = queue.shift(); if (file) worker.postMessage(file); else worker.terminate().then(resolve); };
    worker.on("message", ({ file, result, error }) => {
      if (error) { console.error(`${path.basename(file)}: ${error}`); results.push({ file, error }); }
      else results.push(result);
      next();
    });
    worker.on("error", reject);
    next();
  })));
  results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  for (const r of results) {
    if (r.error) continue;
    const w = r.worst;
    console.log(`${String(r.score).padStart(5)}  ${path.basename(r.file, ".glb").padEnd(34)} ${w ? `${w.clip} t=${w.t} (${w.phase})  ${w.pairs.map((p) => `${p.a} x ${p.b} cut ${p.cut}% +${p.excess} tris area ${(p.share * 100).toFixed(1)}%`).join(", ")}` : "clean"}`);
    if (files.length <= 4) for (const [clip, c] of Object.entries(r.clips)) {
      const f = c.worst[0];
      console.log(`       ${clip.padEnd(18)} score ${String(c.score).padStart(4)}  flagged ${c.flaggedFrames}/${c.frames}${f ? `  worst t=${f.t} (${f.phase}) ${f.pairs.slice(0, 3).map((p) => `${p.a} x ${p.b} cut ${p.cut}% +${p.excess} tris area ${(p.share * 100).toFixed(1)}%`).join(", ")}` : ""}`);
    }
  }
  console.log(`${results.length} models in ${((Date.now() - started) / 1000).toFixed(1)} s on ${jobs} workers`);
  const out = option("json", "");
  if (out) { await writeFile(out, JSON.stringify({ options: opts, generatedAt: new Date().toISOString(), results }, null, 1)); console.log(out); }
}
