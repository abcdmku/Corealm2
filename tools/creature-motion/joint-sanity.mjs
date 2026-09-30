/**
 * Joint sanity for animated creature GLBs: limb joints that bend the wrong way in a clip, skin that
 * wrings round a limb, and joints that do not sit in the modelled limb. Numbers point at frames;
 * contact sheets confirm them (contact-sheet.mjs <glb> --clips <clip> --views audit).
 *
 *   node tools/creature-motion/joint-sanity.mjs [<glb> ...] [--ids a,b] [--json out.json] [--top 40]
 *        [--workers N] [--fps 30] [--min-frames 3] [--min-hyper 20] [--min-plane 35]
 *        [--min-lateral 45] [--min-arm-lateral 65] [--min-wrap 60] [--min-bind-bend 8]
 *        [--min-offcentre 1] [--min-crease 0.4] [--min-stray 0.5] [--min-outside 0.25]
 *
 * With no GLB paths it audits every manifest asset that ships a Death clip (the creature set).
 * A clip finding needs --min-frames frames past its threshold.
 *
 * A. Motion. Limb chains come from the skeleton: a branch bone (pelvis, chest, body) starts a chain
 *    that follows the main child to a leaf; it is a limb when its names say arm/leg or it drops to
 *    the floor. Hinges are the joints after the ball joint (hip, or shoulder behind a clavicle):
 *    knee/elbow everywhere, plus the second hinge (hock, heel) of legs when both of its segments are
 *    long. Each hinge A→B→C has an axis fixed in A's frame from the bind bend (when over
 *    --min-bind-bend) or the dominant bend over every clip frame. Clips are sampled at --fps.
 *      hyperextension  the lower segment, inside the hinge plane, passes straight and bends back;
 *      overfold        the lower segment folds within 30° of lying on the upper one (either side);
 *      outOfPlane      a bend of 20°+ whose axis leaves the joint's dominant plane by --min-plane and
 *                      whose lower segment leaves it by --min-lateral (legs) / --min-arm-lateral;
 *      wrap            skinned vertices of a lower-limb segment roll about the bone axis by
 *                      --min-wrap in the frame of the bone that drives them (candy-wrapper);
 *      role            the reference fold is wrong for the anatomy: a biped knee folding forward,
 *                      an elbow backward, a bird heel backward (quadrupeds are not judged);
 *      bindOpposesMotion / planeMismatch  the clips fold the joint against, or across, the bend the
 *                      mesh was modelled with; the clips then set the reference.
 * B. Bind pose, for joints on a limb:
 *      outsideMesh     ray parity over nine directions says an inner joint is outside the mesh;
 *      offCentre       a limb joint lies off the centre of the limb's cross-section (a thin slab
 *                      normal to the limb) by more than --min-offcentre of the section's half-width;
 *      offCrease       a first hinge lies more than --min-crease of the limb length from the bend of
 *                      a bent limb or its clear narrowing;
 *      straySkin       a limb bone whose weighted vertices mostly lie off the segment it drives.
 *
 * Death-clip findings rank at 0.4x: a collapse legitimately folds and tucks limbs.
 * Defaults are tuned against the studio-native bodies and takes, which are the clean reference;
 * a clip finding is marked alsoInNative when a studio-native take shows it at the same joint, clip
 * and time (a shared donor), not introduced by the retarget.
 *
 * Bind pose is the skinning space: vertices bindMatrix·v, joints inverse(IBM). three.js renders
 * attached skins as boneWorld·IBM·bindMatrix·v, so animated joints are mapped back into that space
 * with the inverse of meshWorld·bindMatrix⁻¹ (rest pose), which also undoes the Z-up and centimetre
 * roots of studio files. The creature faces +Z in world.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), "../..");
const DEG = 180 / Math.PI;

const DEFAULTS = { fps: 30, hyper: 20, plane: 35, lateral: 45, armLateral: 65, wrap: 60, frames: 3, bindBend: 8, offcentre: 1, crease: 0.4, stray: 0.5, outside: 0.25 };

// ---------------------------------------------------------------------------------------------
// Loading

async function loadGlb(file) {
  const bytes = await readFile(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Not a GLB: ${file}`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  // Node's GLTFLoader cannot decode images: keep geometry, skins and clips only.
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
// Names

const lower = (name) => name.toLowerCase();
const EXCLUDE = /spine|spline|neck|head|tail|jaw|tongue|(^|[^r])ear|eye|brow|mouth|lip|hair|antenna|cercus|palp|seg_?\d|abdomen|wing|tentacle|horn|crest|cloth|skirt|cape|cloak|tabard|coat|breast|belly|sting|mandible|fang|beard|mane|finger|thumb|index|pinky|toe|digit|weapon|sword|shield|staff|prop|chain|jiggle|ponytail/;
const FRONT = /arm(?!ature)|hand|elbow|wrist|clavicle|collar|shoulder|scapula|front|palm|carpus/;
const HIND = /leg|thigh|calf|shin|knee|hock|foot|feet|ankle|tarsus|femur|tibia|heel|hip(?!s)|hind|upperreg|rowerreg/;
const HELPER = /twist|roll|(^|[^a-z])ik|ik($|[^a-z])|pole|target|helper|null|nub|_end$|end$|sole|socket|weapon|prop/;
const CLAVICLE = /clavicle|collar|scapula|shoulder(?!.*arm)|hipjoint|pelvis_?side/;

// ---------------------------------------------------------------------------------------------
// Small math

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const signedAngle = (u, v, axis) => Math.atan2(v3().crossVectors(u, v).dot(axis), u.dot(v)) * DEG;
const unsignedAngle = (u, v) => Math.acos(Math.max(-1, Math.min(1, u.dot(v) / (u.length() * v.length() || 1)))) * DEG;
const percentile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : NaN;
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : value;

function rotationOf(matrix) {
  const position = v3(), quaternion = new THREE.Quaternion(), scale = v3();
  matrix.decompose(position, quaternion, scale);
  return quaternion;
}


// Nine fixed, non-axis-aligned ray directions for the parity test.
const RAYS = [
  [1, 0.13, 0.07], [-0.11, 1, 0.17], [0.09, -0.21, 1], [-1, 0.19, -0.13], [0.15, -1, 0.08],
  [-0.07, 0.12, -1], [0.58, 0.61, -0.54], [-0.6, -0.52, 0.6], [0.55, -0.6, 0.58],
].map(([x, y, z]) => v3(x, y, z).normalize());

// ---------------------------------------------------------------------------------------------
// Model

function buildModel(gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
  if (!meshes.length) return null;
  meshes.sort((a, b) => b.geometry.getAttribute("position").count - a.geometry.getAttribute("position").count);

  // Bones: every bone any skin uses, with its bind matrix (inverse IBM) in skinning space.
  const bones = [], index = new Map(), bindMatrix = [];
  for (const mesh of meshes) {
    mesh.skeleton.bones.forEach((bone, i) => {
      if (index.has(bone)) return;
      index.set(bone, bones.length);
      bones.push(bone);
      bindMatrix.push(mesh.skeleton.boneInverses[i].clone().invert());
    });
  }
  // Skinning space → rest world. Frames are mapped back with its inverse.
  const owner = meshes[0];
  const toWorld = owner.matrixWorld.clone().multiply(owner.bindMatrix.clone().invert());
  const toBind = toWorld.clone().invert();

  const parent = bones.map((bone) => {
    let node = bone.parent;
    while (node && !index.has(node)) node = node.parent;
    return node ? index.get(node) : -1;
  });
  const children = bones.map(() => []);
  parent.forEach((p, i) => { if (p >= 0) children[p].push(i); });
  const names = bones.map((bone) => bone.name);
  const bindPos = bindMatrix.map((m) => v3().setFromMatrixPosition(m));
  const bindRot = bindMatrix.map(rotationOf);

  // Bind vertices with their four strongest influences (global bone ids).
  let count = 0;
  for (const mesh of meshes) count += mesh.geometry.getAttribute("position").count;
  const pos = new Float32Array(count * 3), skin = new Int32Array(count * 4).fill(-1), weight = new Float32Array(count * 4);
  const triangles = [];
  let offset = 0;
  const p = v3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position"), skinIndex = geometry.getAttribute("skinIndex"), skinWeight = geometry.getAttribute("skinWeight");
    const local = mesh.skeleton.bones.map((bone) => index.get(bone));
    for (let i = 0; i < position.count; i += 1) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
      pos[(offset + i) * 3] = p.x; pos[(offset + i) * 3 + 1] = p.y; pos[(offset + i) * 3 + 2] = p.z;
      for (let k = 0; k < 4; k += 1) {
        const w = skinWeight.getComponent(i, k);
        if (w <= 0) continue;
        skin[(offset + i) * 4 + k] = local[skinIndex.getComponent(i, k)];
        weight[(offset + i) * 4 + k] = w;
      }
    }
    const indexAttr = geometry.getIndex();
    const tri = indexAttr ? indexAttr.count : position.count;
    for (let i = 0; i < tri; i += 1) triangles.push(offset + (indexAttr ? indexAttr.getX(i) : i));
    offset += position.count;
  }
  const deform = new Float64Array(bones.length);
  for (let i = 0; i < count * 4; i += 1) if (skin[i] >= 0) deform[skin[i]] += weight[i];

  let minY = Infinity, maxY = -Infinity;
  const box = new THREE.Box3();
  for (let i = 0; i < count; i += 1) box.expandByPoint(p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  // Bind-space up and forward, from the rest-world mapping.
  const linear = new THREE.Matrix3().setFromMatrix4(toWorld);
  const inverseLinear = linear.clone().invert();
  const up = v3(0, 1, 0).applyMatrix3(inverseLinear).normalize();
  const forward = v3(0, 0, 1).applyMatrix3(inverseLinear).normalize();
  for (let i = 0; i < count; i += 1) {
    const h = pos[i * 3] * up.x + pos[i * 3 + 1] * up.y + pos[i * 3 + 2] * up.z;
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
  }
  const size = box.getSize(v3());
  // Residual of the mapping: rest joints mapped back to bind space vs inverse IBM.
  const residual = bones.map((bone, i) => v3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(toBind).distanceTo(bindPos[i]));
  residual.sort((a, b) => a - b);
  return {
    scene, meshes, bones, index, names, lowerNames: names.map(lower), parent, children, bindMatrix, bindPos, bindRot,
    pos, skin, weight, count, triangles: Uint32Array.from(triangles), deform, toBind, toWorld, up, forward,
    height: maxY - minY, floor: minY, diagonal: size.length(), restResidual: percentile(residual, 0.5),
    animations: gltf.animations,
  };
}

const heightOf = (model, point) => point.dot(model.up);

// ---------------------------------------------------------------------------------------------
// Limb chains

function subtree(model, bone) {
  const out = [bone];
  for (let i = 0; i < out.length; i += 1) out.push(...model.children[out[i]]);
  return out;
}

function limbChains(model) {
  const { children, lowerNames, bindPos, deform, height } = model;
  const totalDeform = deform.reduce((a, b) => a + b, 0) || 1;
  const reach = (bone, child) => Math.max(...subtree(model, child).map((j) => bindPos[j].distanceTo(bindPos[bone])));
  const significant = (bone) => children[bone].filter((child) => {
    if (HELPER.test(lowerNames[child]) && !children[child].length) return false;
    const tree = subtree(model, child);
    const weight = tree.reduce((sum, j) => sum + deform[j], 0);
    return weight > totalDeform * 0.002 && reach(bone, child) > height * 0.06;
  });
  const sig = model.bones.map((_, i) => significant(i));
  const mainChild = (bone) => {
    const options = sig[bone];
    if (!options.length) return -1;
    return options.map((child) => ({ child, weight: subtree(model, child).reduce((sum, j) => sum + deform[j], 0) + subtree(model, child).length * 1e-6 }))
      .sort((a, b) => b.weight - a.weight)[0].child;
  };
  const chains = [];
  for (let branch = 0; branch < model.bones.length; branch += 1) {
    if (sig[branch].length < 2) continue;
    for (const start of sig[branch]) {
      const chain = [start];
      let bone = start;
      while (sig[bone].length === 1 && chain.length < 12) { bone = mainChild(bone); chain.push(bone); }
      // A branch inside a chain that ends in a hand or foot (fingers, toes) still ends the limb.
      if (sig[bone].length >= 2 && chain.length < 12) {
        const fingers = sig[bone].every((child) => /finger|thumb|index|middle|ring|pinky|toe|digit|claw|nail/.test(lowerNames[child]) || reach(bone, child) < height * 0.12);
        if (fingers) { const next = mainChild(bone); if (next >= 0) chain.push(next); }
      }
      if (chain.length < 2) continue;
      const text = chain.map((j) => lowerNames[j]).join(" ");
      if (EXCLUDE.test(lowerNames[start]) && !FRONT.test(lowerNames[start]) && !HIND.test(lowerNames[start])) continue;
      if (EXCLUDE.test(lowerNames[start]) && /finger|thumb|index|pinky|toe|digit|wing|tail|palp/.test(lowerNames[start])) continue;
      let kind = FRONT.test(text) ? "front" : HIND.test(text) ? "hind" : null;
      const top = heightOf(model, bindPos[chain[0]]), end = heightOf(model, bindPos[chain[chain.length - 1]]);
      const path = chain.slice(1).reduce((sum, j, i) => sum + bindPos[j].distanceTo(bindPos[chain[i]]), 0);
      const grounded = end - model.floor < height * 0.2 && top - end > path * 0.5;
      if (!kind && grounded && chain.length >= 3) kind = "ground";
      if (!kind) continue;
      if (path < height * 0.12) continue;
      // Many short links in a row is a spine, tail or snake body, whatever it is called.
      if (chain.length >= 8 && path / (chain.length - 1) < height * 0.08) continue;
      chains.push({ branch, bones: chain, kind, grounded, helpers: chain.flatMap((j) => children[j].filter((c) => !chain.includes(c) && !children[c].length)) });
    }
  }
  return chains;
}

/** Body plan and anatomical expectations. Returns null when roles cannot be judged. */
function bodyPlan(model, chains, rigClass, tags) {
  const front = chains.filter((c) => c.kind === "front"), hind = chains.filter((c) => c.kind !== "front");
  const names = model.lowerNames.join(" ");
  const bird = rigClass === "bird" || tags.some((t) => /^(bird|fowl|waterfowl|wader)$/.test(t)) || /chicken|goose|turkey|heron|bustard/.test(names);
  if (["arthropod", "serpent", "rooted", "winged"].includes(rigClass) || rigClass?.startsWith("special")) {
    if (!(rigClass === "winged" && front.length === 2 && hind.length === 2)) return { plan: "other" };
  }
  if (hind.length > 4 || front.length > 4) return { plan: "other" };
  if (bird && hind.length === 2) return { plan: "bird" };
  if (["humanoid", "golem", "treant", "knuckle"].includes(rigClass)) return { plan: "biped" };
  if (rigClass === "quadruped") return { plan: "quadruped" };
  if (front.length === 2 && hind.length === 2) {
    const frontGround = front.every((c) => c.grounded);
    return { plan: frontGround ? "quadruped" : "biped" };
  }
  if (hind.length === 4 && front.length === 0) return { plan: "quadruped" };
  return { plan: "other" };
}

/**
 * Expected fold of the lower segment at a hinge: +1 forward, -1 backward, 0 unknown.
 * Bipeds: the first hinge is the knee (shin folds back) or the elbow (forearm folds forward).
 * Birds: the free joint low in the leg (15-65% of its height) is the heel, folding forward.
 * Quadrupeds are not judged: rigs disagree on what their bones are (a Tripo quadruped's "thigh"
 * runs from hip to hock, a deer's front "Knee1" is its carpus, a bear's elbow sits where a deer's
 * carpus does), so the clips, retargeted from studio donors, are the reference.
 */
function expectedFold(plan, chain, order, height) {
  if (plan === "biped") return order === 0 ? (chain.kind === "front" ? 1 : -1) : 0;
  if (plan === "bird" && chain.kind !== "front" && height >= 0.15 && height <= 0.65) return 1;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Bind-pose fit (check B)

function rayHits(model, origin, dir) {
  const { pos, triangles } = model;
  let hits = 0;
  const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - pos[a], sy = oy - pos[a + 1], sz = oz - pos[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 1e-9) hits += 1;
  }
  return hits;
}

function insideTest(model, point) {
  let odd = 0, escapes = 0;
  for (const dir of RAYS) {
    const hits = rayHits(model, point, dir);
    if (hits % 2) odd += 1;
    if (!hits) escapes += 1;
  }
  return { odd, escapes, inside: odd >= 5 || escapes === 0 };
}

/** Vertex ids influenced (weight ≥ minWeight) by any bone of `set`. */
function verticesOf(model, set, minWeight = 0.15) {
  const out = [];
  for (let i = 0; i < model.count; i += 1) {
    for (let k = 0; k < 4; k += 1) {
      const bone = model.skin[i * 4 + k];
      if (bone >= 0 && set.has(bone) && model.weight[i * 4 + k] >= minWeight) { out.push(i); break; }
    }
  }
  return out;
}

/** Cross-section of `ids` in a slab through `point` normal to `axis`: centre, half-widths, count. */
function slab(model, ids, point, axis, half, cap) {
  const e1 = v3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0)).normalize();
  const e2 = v3().crossVectors(axis, e1).normalize();
  const xs = [], ys = [];
  const d = v3();
  for (const i of ids) {
    d.set(model.pos[i * 3] - point.x, model.pos[i * 3 + 1] - point.y, model.pos[i * 3 + 2] - point.z);
    if (Math.abs(d.dot(axis)) > half) continue;
    if (d.lengthSq() > cap * cap) continue;
    xs.push(d.dot(e1)); ys.push(d.dot(e2));
  }
  if (xs.length < 8) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const x0 = percentile(xs, 0.04), x1 = percentile(xs, 0.96), y0 = percentile(ys, 0.04), y1 = percentile(ys, 0.96);
  const hx = Math.max((x1 - x0) / 2, 1e-9), hy = Math.max((y1 - y0) / 2, 1e-9);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // The joint is at the slab origin; its elliptic distance from the centre.
  const off = Math.hypot(cx / hx, cy / hy);
  const centre = point.clone().addScaledVector(e1, cx).addScaledVector(e2, cy);
  return { off, radius: (hx + hy) / 2, hx, hy, count: xs.length, centre };
}

function fitLine(points) {
  const mean = points.reduce((sum, p) => sum.add(p), v3()).multiplyScalar(1 / points.length);
  // Principal direction by power iteration on the covariance.
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p.x - mean.x, p.y - mean.y, p.z - mean.z];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) c[i][j] += d[i] * d[j];
  }
  let dir = v3(1, 1, 1).normalize();
  for (let k = 0; k < 30; k += 1) {
    dir = v3(c[0][0] * dir.x + c[0][1] * dir.y + c[0][2] * dir.z, c[1][0] * dir.x + c[1][1] * dir.y + c[1][2] * dir.z, c[2][0] * dir.x + c[2][1] * dir.y + c[2][2] * dir.z);
    if (dir.lengthSq() < 1e-30) return null;
    dir.normalize();
  }
  return { mean, dir };
}

function closestBetweenLines(a, b) {
  const w = v3().subVectors(a.mean, b.mean);
  const d1 = a.dir, d2 = b.dir;
  const bb = d1.dot(d2), d = d1.dot(w), e = d2.dot(w);
  const denom = 1 - bb * bb;
  if (denom < 1e-6) return null;
  const s = (bb * e - d) / denom, t = (e - bb * d) / denom;
  const p1 = a.mean.clone().addScaledVector(d1, s), p2 = b.mean.clone().addScaledVector(d2, t);
  return p1.add(p2).multiplyScalar(0.5);
}

function fitChecks(model, chain, hinges, opts) {
  const findings = [];
  const { bindPos } = model;
  const set = new Set([...chain.bones, ...chain.helpers]);
  const allIds = verticesOf(model, set, 0.15);
  const helpersOf = (bone) => model.children[bone].filter((c) => chain.helpers.includes(c));
  const joints = chain.bones;
  for (let k = 0; k < joints.length; k += 1) {
    const bone = joints[k];
    const point = bindPos[bone];
    const prev = k > 0 ? bindPos[joints[k - 1]] : bindPos[chain.branch];
    const next = k + 1 < joints.length ? bindPos[joints[k + 1]] : null;
    const upper = v3().subVectors(point, prev), lowerSeg = next ? v3().subVectors(next, point) : upper.clone();
    const lengthUp = upper.length(), lengthDown = lowerSeg.length();
    const scale = Math.max(lengthUp, lengthDown, model.height * 0.03);
    const inside = insideTest(model, point);
    const name = model.names[bone];
    // Nearest limb vertex: how far outside the joint sits, relative to the limb's local radius.
    let nearest = Infinity;
    for (const i of allIds) nearest = Math.min(nearest, Math.hypot(model.pos[i * 3] - point.x, model.pos[i * 3 + 1] - point.y, model.pos[i * 3 + 2] - point.z));
    // Cross-section at the joint, perpendicular to the bisector of the two segments.
    const axis = v3().addVectors(upper.clone().normalize(), lowerSeg.clone().normalize());
    if (axis.lengthSq() < 1e-6) axis.copy(lowerSeg);
    axis.normalize();
    const local = new Set([k > 0 ? joints[k - 1] : -1, bone, next ? joints[k + 1] : -1, ...helpersOf(bone), ...(k > 0 ? helpersOf(joints[k - 1]) : [])]);
    const ids = verticesOf(model, local, 0.15);
    let section = null;
    for (const half of [0.04, 0.08, 0.16]) {
      section = slab(model, ids, point, axis, scale * half, scale * 0.9);
      if (section && section.count >= 20) break;
    }
    // A slab thinner than 3% of the segment is a strap or a weapon sliver, not the limb.
    if (section && (section.radius < scale * 0.03 || section.count < 20)) section = null;
    const interior = k > 0 && next;
    const bend = next ? unsignedAngle(upper, lowerSeg) : 0;
    const radius = Math.max(section?.radius ?? 0, scale * 0.05);
    // The chain's last joint is often a tip marker on the surface (toe end): only inner joints count.
    if (!inside.inside && k > 0 && next && Number.isFinite(nearest) && nearest / radius > opts.outside) {
      findings.push({ check: "outsideMesh", joint: name, chain: chainName(model, chain), odd: inside.odd, escapes: inside.escapes,
        distance: round(nearest / radius, 2), severity: 2 + Math.min(3, nearest / radius) });
    }
    // A bisector slab through a sharply bent joint (an ankle at 90°) cuts across the foot: skip it.
    // Hip and shoulder sit inside the torso, where a limb has no cross-section of its own.
    const extremity = /hand|palm|paw|ball|toe|finger|foot|feet|digit|claw|ankle|wrist/.test(model.lowerNames[bone]);
    if (section && interior && !extremity && k >= hinges.first && bend < 60 && section.off > opts.offcentre) {
      findings.push({ check: "offCentre", joint: name, chain: chainName(model, chain), ratio: round(section.off), radius: round(section.radius, 4),
        slabVertices: section.count, severity: 1 + Math.min(3, (section.off - opts.offcentre) / 0.5) });
    }
    // Crease and narrowing, for a first hinge only (knee, elbow, stifle).
    const order = hinges.get(bone);
    if (order === 0 && next) {
      const crease = creaseCheck(model, chain, k, opts);
      if (crease) findings.push(crease);
    }
    // Skin that strays off the segment this bone drives.
    if (next && lengthDown > model.height * 0.03) {
      const stray = strayCheck(model, bone, point, bindPos[joints[k + 1]], helpersOf(bone));
      if (stray && stray.fraction > opts.stray) findings.push({ check: "straySkin", joint: name, chain: chainName(model, chain), ...stray, severity: 1 + 3 * stray.fraction });
    }
  }
  return findings;
}

function creaseCheck(model, chain, k, opts) {
  const joints = chain.bones;
  const A = model.bindPos[joints[k - 1] ?? chain.branch], B = model.bindPos[joints[k]], C = model.bindPos[joints[k + 1]];
  if (k === 0) return null;
  const u = v3().subVectors(B, A), v = v3().subVectors(C, B);
  const L1 = u.length(), L2 = v.length(), L = L1 + L2;
  if (L1 < 1e-9 || L2 < 1e-9) return null;
  const du = u.clone().normalize(), dv = v.clone().normalize();
  const setIds = verticesOf(model, new Set([joints[k - 1], joints[k], ...model.children[joints[k - 1]].filter((c) => chain.helpers.includes(c)), ...model.children[joints[k]].filter((c) => chain.helpers.includes(c))]), 0.15);
  const samples = [];
  const N = 28;
  for (let i = 1; i < N; i += 1) {
    const s = (i / N) * L;
    const point = s < L1 ? A.clone().addScaledVector(du, s) : B.clone().addScaledVector(dv, s - L1);
    const axis = s < L1 ? du : dv;
    const section = slab(model, setIds, point, axis, L / (N * 1.2), Math.max(L1, L2) * 0.8);
    if (section) samples.push({ s: s / L, radius: section.radius, centre: section.centre });
  }
  if (samples.length < 10) return null;
  const jointAt = L1 / L;
  const bend = unsignedAngle(u, v);
  let target = null, how = null, depth = 0;
  if (bend >= 25) {
    // A bent limb: intersect the centre lines of its two halves.
    const top = samples.filter((q) => q.s > 0.1 && q.s < jointAt - 0.08).map((q) => q.centre);
    const bottom = samples.filter((q) => q.s > jointAt + 0.08 && q.s < 0.9).map((q) => q.centre);
    if (top.length >= 3 && bottom.length >= 3) {
      const a = fitLine(top), b = fitLine(bottom);
      if (a && b && unsignedAngle(a.dir, b.dir) > 20 && unsignedAngle(a.dir, b.dir) < 160) {
        const point = closestBetweenLines(a, b);
        if (point) { target = point; how = "bend"; }
      }
    }
  }
  if (!target) {
    // A straight limb: a clear local narrowing between 20% and 80% of its length.
    const window = samples.filter((q) => q.s > 0.2 && q.s < 0.8);
    let best = null;
    for (let i = 1; i < window.length - 1; i += 1) {
      const q = window[i];
      if (q.radius > window[i - 1].radius || q.radius > window[i + 1].radius) continue;
      const leftMax = Math.max(...samples.filter((x) => x.s < q.s).map((x) => x.radius));
      const rightMax = Math.max(...samples.filter((x) => x.s > q.s).map((x) => x.radius));
      const d = Math.min(leftMax, rightMax) / q.radius - 1;
      if (!best || d > best.d) best = { q, d };
    }
    if (best && best.d > 0.18) {
      const s = best.q.s * L;
      target = s < L1 ? A.clone().addScaledVector(du, s) : B.clone().addScaledVector(dv, s - L1);
      how = "narrowing"; depth = best.d;
    }
  }
  if (!target) return null;
  const distance = target.distanceTo(B) / L;
  if (distance <= opts.crease) return null;
  return { check: "offCrease", joint: model.names[joints[k]], chain: chainName(model, chain), by: how, distance: round(distance), depth: round(depth),
    along: round((target.clone().sub(A).dot(du)) / L), jointAt: round(jointAt), severity: 1 + (distance - opts.crease) / 0.1 };
}

function strayCheck(model, bone, P0, P1, helpers) {
  const axis = v3().subVectors(P1, P0);
  const L = axis.length();
  axis.normalize();
  const ids = verticesOf(model, new Set([bone, ...helpers]), 0.5);
  if (ids.length < 12) return null;
  const radial = [], entries = [];
  const d = v3();
  for (const i of ids) {
    d.set(model.pos[i * 3] - P0.x, model.pos[i * 3 + 1] - P0.y, model.pos[i * 3 + 2] - P0.z);
    const t = d.dot(axis) / L;
    const r = Math.sqrt(Math.max(0, d.lengthSq() - (t * L) ** 2));
    radial.push(r); entries.push({ t, r });
  }
  radial.sort((a, b) => a - b);
  const rMed = percentile(radial, 0.5);
  const limit = Math.max(3 * rMed, 0.5 * L, 0.1 * model.height);
  let stray = 0;
  for (const { t, r } of entries) {
    const along = t < 0 ? -t * L : t > 1 ? (t - 1) * L : 0;
    if (Math.hypot(along, r) > limit) stray += 1;
  }
  return { fraction: round(stray / entries.length), vertices: entries.length, medianRadius: round(rMed / L), length: round(L, 4) };
}

const chainName = (model, chain) => chain.bones.map((j) => model.names[j]).join(">");

// ---------------------------------------------------------------------------------------------
// Motion (check A)

function sampleClips(model, fps, wanted) {
  const { scene, bones, toBind } = model;
  const saved = [];
  scene.traverse((node) => saved.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
  const restore = () => { for (const [node, p, q, s] of saved) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); } };
  const mixer = new THREE.AnimationMixer(scene);
  const clips = [];
  const inverseBind = model.bindMatrix.map((m) => m.clone().invert());
  for (const clip of model.animations) {
    restore();
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    const frames = [];
    const steps = Math.max(1, Math.round(clip.duration * fps));
    for (let f = 0; f <= steps; f += 1) {
      const time = Math.min(clip.duration, f / fps);
      mixer.setTime(Math.min(time, Math.max(0, clip.duration - 1e-4)));
      scene.updateMatrixWorld(true);
      // Per bone: its matrix in skinning space, and the skin matrix that carries bind vertices.
      const pos = [], rot = [], mat = [], skin = [];
      for (const j of wanted) {
        const matrix = new THREE.Matrix4().multiplyMatrices(toBind, bones[j].matrixWorld);
        mat[j] = matrix;
        skin[j] = matrix.clone().multiply(inverseBind[j]);
        pos[j] = v3().setFromMatrixPosition(matrix);
        rot[j] = rotationOf(matrix);
      }
      frames.push({ time, pos, rot, mat, skin });
    }
    action.stop(); mixer.uncacheAction(clip);
    clips.push({ name: clip.name, duration: clip.duration, frames });
  }
  restore();
  scene.updateMatrixWorld(true);
  return clips;
}

/**
 * Candy-wrapper: skinned vertices of a limb segment rolling about the segment's axis, each seen in
 * the frame of the bone that drives it most (a twist helper when one carries it). A vertex that
 * follows its bone stays put in that frame; one blended between bones that roll against each other
 * swings round the axis and the segment wrings like a rope. Joint transforms alone miss this when
 * the blend comes from the weights.
 */
function wrapCheck(model, chain, first, clips, opts, native) {
  const findings = [];
  const joints = chain.bones;
  const helpersOf = (bone) => model.children[bone].filter((c) => chain.helpers.includes(c));
  const p = v3(), s = v3(), q = v3(), cross = v3();
  const inverseBind = new Map();
  const invBindOf = (j) => { if (!inverseBind.has(j)) inverseBind.set(j, model.bindMatrix[j].clone().invert()); return inverseBind.get(j); };
  for (let k = Math.max(first, 1); k + 1 < joints.length; k += 1) {
    const bone = joints[k], next = joints[k + 1];
    if (/finger|thumb|index|pinky|toe|digit|claw|nail|ball|paw|hand|palm/.test(model.lowerNames[bone])) continue;
    const P0 = model.bindPos[bone], P1 = model.bindPos[next];
    const axis = v3().subVectors(P1, P0);
    const L = axis.length();
    if (L < model.height * 0.03) continue;
    axis.normalize();
    const own = new Set([bone, ...helpersOf(bone)]);
    const picked = [];
    for (let i = 0; i < model.count; i += 1) {
      let best = -1, bestWeight = 0;
      for (let c = 0; c < 4; c += 1) if (model.weight[i * 4 + c] > bestWeight) { bestWeight = model.weight[i * 4 + c]; best = model.skin[i * 4 + c]; }
      if (!own.has(best)) continue;
      p.set(model.pos[i * 3] - P0.x, model.pos[i * 3 + 1] - P0.y, model.pos[i * 3 + 2] - P0.z);
      const t = p.dot(axis) / L;
      if (t < 0.1 || t > 0.9) continue;
      picked.push({ i, driver: best, r: Math.sqrt(Math.max(0, p.lengthSq() - (t * L) ** 2)) });
    }
    if (picked.length < 30) continue;
    const rMed = percentile(picked.map((x) => x.r).sort((a, b) => a - b), 0.5);
    // Vertices near the axis have no meaningful roll angle.
    const usable = picked.filter((x) => x.r >= 0.5 * rMed);
    const stride = Math.max(1, Math.ceil(usable.length / 160));
    const sample = usable.filter((_, n) => n % stride === 0).map((x) => {
      const invBind = invBindOf(x.driver);
      const origin = P0.clone().applyMatrix4(invBind);
      const axisLocal = P1.clone().applyMatrix4(invBind).sub(origin).normalize();
      const rest = v3(model.pos[x.i * 3], model.pos[x.i * 3 + 1], model.pos[x.i * 3 + 2]).applyMatrix4(invBind).sub(origin);
      rest.addScaledVector(axisLocal, -rest.dot(axisLocal));
      return { ...x, origin, axisLocal, rest };
    });
    for (const clip of clips) {
      let worst = null, over = 0;
      for (const frame of clip.frames) {
        const inverse = new Map();
        const angles = [];
        for (const v of sample) {
          const i = v.i;
          p.set(model.pos[i * 3], model.pos[i * 3 + 1], model.pos[i * 3 + 2]);
          s.set(0, 0, 0);
          for (let c = 0; c < 4; c += 1) {
            const j = model.skin[i * 4 + c], w = model.weight[i * 4 + c];
            if (j >= 0 && w > 0) s.addScaledVector(q.copy(p).applyMatrix4(frame.skin[j]), w);
          }
          if (!inverse.has(v.driver)) inverse.set(v.driver, frame.mat[v.driver].clone().invert());
          const local = s.applyMatrix4(inverse.get(v.driver)).sub(v.origin);
          local.addScaledVector(v.axisLocal, -local.dot(v.axisLocal));
          if (local.lengthSq() < 1e-20) continue;
          angles.push(Math.abs(Math.atan2(cross.crossVectors(v.rest, local).dot(v.axisLocal), v.rest.dot(local)) * DEG));
        }
        angles.sort((a, b) => a - b);
        const roll = percentile(angles, 0.9);
        if (roll > opts.wrap) over += 1;
        if (!worst || roll > worst.angle) worst = { angle: roll, time: frame.time };
      }
      if (worst && over >= opts.frames) {
        const spread = over / clip.frames.length > 0.25 ? 1.3 : over < 3 ? 0.6 : 1;
        findings.push({ check: "wrap", joint: model.names[bone], chain: chainName(model, chain), clip: clip.name, native: native.includes(clip.name),
          time: round(worst.time), angle: round(worst.angle, 1), frames: `${over}/${clip.frames.length}`, vertices: picked.length,
          severity: (1 + (worst.angle - opts.wrap) / 20) * spread });
      }
    }
  }
  return findings;
}

/** Which joints of a chain are judged as hinges, with their order (0 = knee, elbow, stifle). */
function hingeJoints(model, chain, plan) {
  const joints = chain.bones, { bindPos, lowerNames } = model;
  // The first joint after the branch is a ball (hip); so is the shoulder behind a clavicle.
  const lead = joints.length > 2 && (CLAVICLE.test(lowerNames[joints[0]]) ||
    bindPos[joints[1]].distanceTo(bindPos[joints[0]]) < 0.3 * bindPos[joints[2]].distanceTo(bindPos[joints[1]]));
  const first = lead ? 2 : 1;
  const front = chain.kind === "front";
  // Distal joints flex both ways in healthy motion (a dog's carpus hyperextends in stance, toes and
  // paws roll): only the main hinges are judged.
  const orders = plan === "biped" ? [0] : plan === "quadruped" ? (front ? [0] : [0, 1]) : plan === "bird" ? (front ? [] : [0, 1]) : [0, 1];
  const out = [];
  out.first = first;
  // A hinge joins two long segments. Short ones (pastern, paw, foot pad) are digits, whatever the
  // bone is called: a deer's "Knee2" is its fetlock.
  const length = (k) => bindPos[joints[k + 1]].distanceTo(bindPos[joints[k]]);
  let total = 0;
  for (let k = first - 1; k + 1 < joints.length; k += 1) total += length(k);
  for (let k = first; k + 1 < joints.length; k += 1) {
    const order = k - first;
    if (!orders.includes(order)) continue;
    if (order > 0 && (length(k - 1) < 0.15 * total || length(k) < 0.15 * total)) continue;
    if (/finger|thumb|index|pinky|toe|digit|claw|nail|ball|paw|hand|palm/.test(lowerNames[joints[k]])) continue;
    // A Tripo bird's "thigh" spans femur and tibia: its first hinge is already the heel.
    if (plan === "bird" && order === 1 && /tarsus|heel/.test(lowerNames[joints[k - 1]])) continue;
    out.push({ k, order });
  }
  return out;
}

function motionChecks(model, chain, clips, plan, opts, native) {
  const findings = [], summary = [];
  const { bindPos, bindRot, names } = model;
  const joints = chain.bones;
  const hinges = new Map();
  const judged = hingeJoints(model, chain, plan);
  hinges.first = judged.first;
  for (const { k, order } of judged) {
    const [a, b, c] = [joints[k - 1], joints[k], joints[k + 1]];
    const u0 = v3().subVectors(bindPos[b], bindPos[a]), w0 = v3().subVectors(bindPos[c], bindPos[b]);
    if (u0.length() < model.height * 0.025 || w0.length() < model.height * 0.025) continue;
    hinges.set(b, order);
    const bindBend = unsignedAngle(u0, w0);
    const qA0inv = bindRot[a].clone().invert();
    // Every frame: the bend axis in A's frame, the bend, and B's roll about B→C against bind.
    const perFrame = [];
    const sum = v3();
    for (const clip of clips) {
      for (const frame of clip.frames) {
        const uf = v3().subVectors(frame.pos[b], frame.pos[a]), wf = v3().subVectors(frame.pos[c], frame.pos[b]);
        // A stretch bone scaled towards zero has no direction to judge.
        if (uf.length() < 0.3 * u0.length() || wf.length() < 0.3 * w0.length()) continue;
        const u = uf.normalize(), w = wf.normalize();
        const qAinv = frame.rot[a].clone().invert();
        const crossLocal = v3().crossVectors(u, w).applyQuaternion(qAinv);
        sum.add(crossLocal);
        perFrame.push({ clip: clip.name, time: frame.time, u, w, qA: frame.rot[a], crossLocal, bend: unsignedAngle(u, w) });
      }
    }
    if (!perFrame.length) continue;
    const bindAxis = bindBend > opts.bindBend ? v3().crossVectors(u0.clone().normalize(), w0.clone().normalize()).applyQuaternion(qA0inv).normalize() : null;
    const motionAxis = sum.length() > 1e-6 ? sum.clone().normalize() : null;
    if (!bindAxis && !motionAxis) continue;
    // Signed bend inside the hinge plane: the lower segment projected onto the plane normal to
    // `ref`. A frame whose lower segment leaves the plane by more than 60° has no in-plane sign.
    const signed = (frame, ref) => {
      const axis = ref.clone().applyQuaternion(frame.qA);
      const inPlane = frame.w.clone().addScaledVector(axis, -frame.w.dot(axis));
      if (inPlane.length() < 0.5) return null;
      return signedAngle(frame.u, inPlane, axis);
    };
    // Where the lower segment goes when bending about `ref`, in rest world (creature faces +Z).
    const linear = new THREE.Matrix3().setFromMatrix4(model.toWorld);
    const foldOf = (ref) => v3().crossVectors(ref.clone().applyQuaternion(bindRot[a]), u0.clone().normalize()).applyMatrix3(linear).normalize();
    const top = heightOf(model, bindPos[joints[0]]) - model.floor;
    const expected = expectedFold(plan, chain, order, top > 0 ? (heightOf(model, bindPos[b]) - model.floor) / top : 0);
    const role = { 1: "forward", [-1]: "backward", 0: "unknown" }[expected];
    const judge = (fold) => expected === 0 ? null : fold.z * expected > 0.3 ? "ok" : fold.z * expected < -0.3 ? "wrong" : "sideways";
    const base0 = { joint: names[b], chain: chainName(model, chain), order, role };
    let reference = bindAxis ?? motionAxis, from = bindAxis ? "bind" : "motion";
    if (bindAxis && motionAxis) {
      const between = unsignedAngle(bindAxis, motionAxis);
      if (between >= 135) {
        // Motion folds this joint against its modelled bend. Anatomy decides which one is wrong.
        const bindVerdict = judge(foldOf(bindAxis)), motionVerdict = judge(foldOf(motionAxis));
        findings.push({ check: "bindOpposesMotion", ...base0, bindBend: round(bindBend, 1), between: round(between, 1),
          bindFold: round(foldOf(bindAxis).z), motionFold: round(foldOf(motionAxis).z), bindVerdict, motionVerdict,
          severity: motionVerdict === "wrong" ? 5 : 1.5 });
        if (motionVerdict !== "wrong") { reference = motionAxis; from = "motion(bind opposed)"; }
      } else if (between > 45) {
        // The clips fold this joint in another plane than the mesh was modelled bent in.
        findings.push({ check: "planeMismatch", ...base0, bindBend: round(bindBend, 1), between: round(between, 1),
          bindFold: foldOf(bindAxis).toArray().map((x) => round(x)), motionFold: foldOf(motionAxis).toArray().map((x) => round(x)),
          severity: 1 + (between - 45) / 30 });
        reference = motionAxis; from = "motion(bind plane off)";
      }
    }
    const fold = foldOf(reference);
    const verdict = judge(fold);
    if (verdict === "wrong" || (verdict === "sideways" && chain.kind !== "front" && Math.abs(fold.x) > 0.75)) {
      findings.push({ check: "role", ...base0, reference: from, fold: fold.toArray().map((x) => round(x)), severity: verdict === "wrong" ? 4 : 2 });
    }
    // Per clip: hyperextension, overfold, out of plane.
    // A quadruped's front main hinge is its elbow in some rigs and its carpus in others, and a
    // carpus flexes both ways in a healthy stride: it is not judged for hyperextension.
    const bendsOneWay = !(plan === "quadruped" && chain.kind === "front");
    const byClip = new Map();
    for (const frame of perFrame) {
      let entry = byClip.get(frame.clip);
      if (!entry) byClip.set(frame.clip, entry = { frames: 0, hyper: [], over: [], plane: [] });
      entry.frames += 1;
      // Past 150° the lower segment lies nearly folded on the upper one and the sign cannot tell a
      // joint bent back from a tight curl (a dead spider, a tortoise tucking in): its own finding.
      const angle = signed(frame, reference);
      if (angle !== null) {
        if (angle < -opts.hyper && angle > -150 && bendsOneWay) entry.hyper.push({ time: frame.time, angle: -angle });
        if (Math.abs(angle) >= 150) entry.over.push({ time: frame.time, angle: Math.abs(angle) });
      }
      if (frame.bend >= 20) {
        // Axis swing, and how far the lower segment itself leaves the hinge plane (what shows).
        const plane = motionAxis ?? reference;
        const dev = Math.acos(Math.min(1, Math.abs(frame.crossLocal.clone().normalize().dot(plane)))) * DEG;
        const lateral = Math.asin(Math.min(1, Math.abs(frame.w.dot(plane.clone().applyQuaternion(frame.qA))))) * DEG;
        if (dev > opts.plane && lateral > (chain.kind === "front" ? opts.armLateral : opts.lateral)) entry.plane.push({ time: frame.time, angle: dev, lateral, bend: frame.bend });
      }
    }
    const worst = (list) => list.reduce((best, x) => (x.angle > best.angle ? x : best), list[0]);
    const spread = (list, frames) => (list.length / frames > 0.25 ? 1.3 : list.length < 3 ? 0.6 : 1);
    for (const [clip, entry] of byClip) {
      const base = { ...base0, clip, native: native.includes(clip) };
      if (entry.hyper.length >= opts.frames) {
        const w = worst(entry.hyper);
        findings.push({ check: "hyperextension", ...base, time: round(w.time), angle: round(w.angle, 1), frames: `${entry.hyper.length}/${entry.frames}`, reference: from,
          severity: (1 + (w.angle - opts.hyper) / 12) * spread(entry.hyper, entry.frames) });
      }
      if (entry.over.length >= opts.frames) {
        const w = worst(entry.over);
        findings.push({ check: "overfold", ...base, time: round(w.time), angle: round(w.angle, 1), frames: `${entry.over.length}/${entry.frames}`, reference: from,
          severity: spread(entry.over, entry.frames) });
      }
      if (entry.plane.length >= opts.frames) {
        const w = worst(entry.plane);
        findings.push({ check: "outOfPlane", ...base, time: round(w.time), angle: round(w.angle, 1), lateral: round(w.lateral, 1), bend: round(w.bend, 1), frames: `${entry.plane.length}/${entry.frames}`, reference: from,
          severity: (1 + (w.angle - opts.plane) / 15) * spread(entry.plane, entry.frames) });
      }
    }
    summary.push({ joint: names[b], order, role, reference: from, bindBend: round(bindBend, 1), fold: fold.toArray().map((x) => round(x)) });
  }
  return { findings, summary, hinges };
}

// ---------------------------------------------------------------------------------------------
// One model

async function analyse(job, opts) {
  const started = Date.now();
  const gltf = await loadGlb(job.path);
  const model = buildModel(gltf);
  if (!model) return { id: job.id, file: job.file, error: "no skinned mesh" };
  const chains = limbChains(model);
  const { plan } = bodyPlan(model, chains, job.rigClass, job.tags ?? []);
  const wanted = model.bones.map((_, i) => i);
  const clips = sampleClips(model, opts.fps, wanted);
  const findings = [], chainSummary = [];
  for (const chain of chains) {
    const motion = motionChecks(model, chain, clips, plan, opts, job.native ?? []);
    findings.push(...motion.findings);
    findings.push(...fitChecks(model, chain, motion.hinges, opts));
    findings.push(...wrapCheck(model, chain, motion.hinges.first, clips, opts, job.native ?? []));
    chainSummary.push({ chain: chainName(model, chain), kind: chain.kind, hinges: motion.summary });
  }
  // A death collapse folds, tucks and curls limbs in ways a stride never does, and it plays once:
  // its findings rank below the same numbers in a looping clip.
  for (const f of findings) f.severity = round(f.severity * (f.clip === "Death" ? 0.4 : 1), 2);
  // Model severity, per check: the worst joint plus a quarter of the others, where each joint
  // counts its worst clip plus a quarter of the rest. A fault in every clip outranks one clip; a
  // twenty-legged body does not outrank a biped for repeating one small fault on every leg.
  const damped = (list) => { list.sort((a, b) => b - a); return list[0] + 0.25 * list.slice(1).reduce((a, b) => a + b, 0); };
  const byCheck = new Map();
  for (const f of findings) {
    const joints = byCheck.get(f.check) ?? new Map();
    joints.set(f.joint, [...(joints.get(f.joint) ?? []), f.severity]);
    byCheck.set(f.check, joints);
  }
  const severity = round([...byCheck.values()].reduce((sum, joints) => sum + damped([...joints.values()].map(damped)), 0), 2);
  findings.sort((a, b) => b.severity - a.severity);
  return {
    id: job.id, file: job.file, rigClass: job.rigClass ?? null, plan, provenance: job.provenance, native: job.native,
    clips: clips.map((c) => `${c.name}:${round(c.duration)}`), bones: model.bones.length, vertices: model.count,
    height: round(model.height, 4), restResidual: round(model.restResidual / (model.height || 1), 4),
    chains: chainSummary, severity, findings, ms: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------------------------
// CLI and worker pool

export { loadGlb, buildModel, limbChains, sampleClips, analyse };
const cli = path.resolve(process.argv[1] ?? "") === self;
if (!isMainThread) {
  parentPort.on("message", async (job) => {
    try { parentPort.postMessage(await analyse(job, workerData.opts)); }
    catch (error) { parentPort.postMessage({ id: job.id, file: job.file, error: String(error?.stack ?? error) }); }
  });
} else if (cli) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  const files = args.filter((arg, i) => !arg.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const opts = {
    fps: Number(option("fps", DEFAULTS.fps)), hyper: Number(option("min-hyper", DEFAULTS.hyper)), plane: Number(option("min-plane", DEFAULTS.plane)),
    frames: Number(option("min-frames", DEFAULTS.frames)), lateral: Number(option("min-lateral", DEFAULTS.lateral)), armLateral: Number(option("min-arm-lateral", DEFAULTS.armLateral)), outside: Number(option("min-outside", DEFAULTS.outside)), wrap: Number(option("min-wrap", DEFAULTS.wrap)), bindBend: Number(option("min-bind-bend", DEFAULTS.bindBend)),
    offcentre: Number(option("min-offcentre", DEFAULTS.offcentre)), crease: Number(option("min-crease", DEFAULTS.crease)), stray: Number(option("min-stray", DEFAULTS.stray)),
  };
  const manifest = JSON.parse(await readFile(path.join(repo, "game/public/assets/manifest.json"), "utf8"));
  const byFile = new Map(manifest.assets.filter((a) => a.file).map((a) => [path.resolve(repo, "game/public/assets", a.file), a]));
  const rigClass = async (id) => {
    try { return JSON.parse(await readFile(path.join(repo, "tools/creature-rig/assets", `${id}.json`), "utf8")).class ?? null; } catch { return null; }
  };
  const provenanceOf = (asset) => {
    const clips = asset?.animations ?? [];
    const native = asset?.motionProvenance?.native ?? [];
    if (!asset?.motionProvenance) return { provenance: "unknown", native: [] };
    const covered = clips.filter((c) => native.includes(c)).length;
    return { provenance: covered === clips.length ? "studio-native" : covered ? "mixed" : "repo", native };
  };
  let assets;
  if (files.length) assets = files.map((file) => ({ path: path.resolve(file), asset: byFile.get(path.resolve(file)) }));
  else {
    const ids = option("ids", "") ? option("ids", "").split(",") : null;
    assets = manifest.assets.filter((a) => a.file?.endsWith(".glb") && (a.animations ?? []).includes("Death") && (!ids || ids.includes(a.id)))
      .map((a) => ({ path: path.resolve(repo, "game/public/assets", a.file), asset: a }));
  }
  const jobs = [];
  for (const { path: file, asset } of assets) {
    const id = asset?.id ?? path.basename(file, ".glb");
    jobs.push({ id, file: asset?.file ?? file, path: file, rigClass: await rigClass(id), tags: [asset?.is, ...(asset?.tags ?? [])].filter(Boolean), ...provenanceOf(asset) });
  }
  const workers = Math.max(1, Math.min(Number(option("workers", Math.max(1, os.cpus().length - 1))), jobs.length));
  const results = [];
  const started = Date.now();
  await new Promise((resolve) => {
    let next = 0, done = 0;
    for (let w = 0; w < workers; w += 1) {
      const worker = new Worker(self, { workerData: { opts } });
      const feed = () => { if (next < jobs.length) worker.postMessage(jobs[next++]); else worker.terminate(); };
      worker.on("message", (result) => {
        results.push(result);
        done += 1;
        if (process.stderr.isTTY) process.stderr.write(`\r${done}/${jobs.length}`);
        if (done === jobs.length) resolve();
        feed();
      });
      worker.on("error", (error) => { console.error(error); done += 1; if (done === jobs.length) resolve(); feed(); });
      feed();
    }
  });
  if (process.stderr.isTTY) process.stderr.write("\n");
  results.sort((a, b) => (b.severity ?? -1) - (a.severity ?? -1));
  // A motion finding that a studio-native take shows at the same joint, clip and time is inherited
  // from that take (shared donor clips), not introduced by the retarget.
  const nativeKeys = new Set();
  const keyOf = (f) => `${f.check}|${f.joint}|${f.clip}|${Math.round(f.time * 10)}`;
  for (const r of results) for (const f of r.findings ?? []) if (f.clip && f.native) nativeKeys.add(keyOf(f));
  for (const r of results) for (const f of r.findings ?? []) if (f.clip && !f.native && nativeKeys.has(keyOf(f))) f.alsoInNative = true;
  const out = option("json", "");
  if (out) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await writeFile(path.resolve(out), JSON.stringify({ generatedAt: new Date().toISOString(), thresholds: opts, models: results }, null, 1));
  }
  const top = Number(option("top", 40));
  const fmt = (f) => {
    const where = f.clip ? ` ${f.clip}${f.native ? "(native)" : ""} t=${f.time}` : "";
    const num = f.angle != null ? ` ${f.angle}°${f.frames ? ` ${f.frames}f` : ""}` : f.ratio != null ? ` off ${f.ratio}` : f.distance != null ? ` d=${f.distance}` : f.fraction != null ? ` ${f.fraction}` : f.opposedFrames ? ` ${f.opposedFrames} (bind ${f.bindVerdict}, motion ${f.motionVerdict})` : f.expected ? ` expected ${f.expected} got ${f.fold}` : "";
    return `${f.check} ${f.joint}${where}${num}`;
  };
  for (const r of results.slice(0, top)) {
    if (r.error) { console.log(`${r.id}: ERROR ${r.error.split("\n")[0]}`); continue; }
    if (!r.findings.length) continue;
    console.log(`${String(r.severity).padStart(6)}  ${r.id} [${r.plan}${r.rigClass ? `/${r.rigClass}` : ""}, ${r.provenance}] ${r.findings.length} findings`);
    for (const f of r.findings.slice(0, 4)) console.log(`          ${fmt(f)} (${f.severity})`);
  }
  const errors = results.filter((r) => r.error);
  const clean = results.filter((r) => !r.error && !r.findings.length).length;
  console.log(`${results.length} models, ${clean} clean, ${errors.length} errors, ${((Date.now() - started) / 1000).toFixed(1)}s${out ? ` → ${out}` : ""}`);
  for (const e of errors) console.log(`  error ${e.id}: ${e.error.split("\n")[0]}`);
}
