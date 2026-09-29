/**
 * Step 3: write the candidate GLB from <work>/mesh.glb (production geometry, UVs, materials and
 * textures, baked to bind pose) and <work>/rig.json (skeleton, weights, clips from Blender).
 *
 * Joint nodes carry the bind pose as their rest (rest == bind), inverse binds are the exact inverse
 * of that rest, every clip is sampled at its donor rate with LINEAR rotation keys, only the hips
 * carry translation keys, and nothing carries scale keys.
 *
 *   node tools/creature-rig/assemble.mjs <assetId>
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDocument } from "./intake.mjs";
import { isMain, paths } from "./paths.mjs";

const quatToMat = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
  2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
  2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
]; // column-major 3x3

function compose(r, t) {
  const m = quatToMat(r);
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, t[0], t[1], t[2], 1];
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** Inverse of a rigid (rotation + translation) column-major 4x4. */
function invertRigid(m) {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];
  const t = [m[12], m[13], m[14]];
  return [
    r[0], r[1], r[2], 0, r[4], r[5], r[6], 0, r[8], r[9], r[10], 0,
    -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]), -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]), -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]), 1,
  ];
}

/** Maps each production vertex onto the merged Blender vertex at the same position. */
function vertexMatcher(vertices) {
  const cell = 1e-3;
  const grid = new Map();
  const key = (x, y, z) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  vertices.forEach((v, i) => {
    const k = key(...v);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  let worst = 0;
  const match = (x, y, z) => {
    let best = -1;
    let bestD = Infinity;
    const [cx, cy, cz] = [x, y, z].map((v) => Math.round(v / cell));
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const v = vertices[i];
        const d = (v[0] - x) ** 2 + (v[1] - y) ** 2 + (v[2] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    if (best < 0) {
      vertices.forEach((v, i) => {
        const d = (v[0] - x) ** 2 + (v[1] - y) ** 2 + (v[2] - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
    }
    worst = Math.max(worst, Math.sqrt(bestD));
    return best;
  };
  return { match, worst: () => worst };
}

export async function assemble(assetId, work = paths.work(assetId)) {
  const intake = JSON.parse(readFileSync(path.join(work, "intake.json"), "utf8"));
  const rig = JSON.parse(readFileSync(path.join(work, "rig.json"), "utf8"));
  const { io, doc } = await openDocument(path.join(work, "mesh.glb"));
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  // Skeleton: rest TRS from rig.json, world matrices for the inverse binds.
  const joints = new Map();
  const world = new Map();
  const container = doc.createNode(`${assetId}_rig`);
  scene.addChild(container);
  for (const bone of rig.skeleton) {
    const node = doc.createNode(bone.name).setRotation(bone.rotation).setTranslation(bone.translation);
    joints.set(bone.name, node);
    const local = compose(bone.rotation, bone.translation);
    world.set(bone.name, bone.parent ? mul(world.get(bone.parent), local) : local);
    if (bone.parent) joints.get(bone.parent).addChild(node);
    else container.addChild(node);
  }
  const names = rig.skeleton.map((bone) => bone.name);
  const ibm = new Float32Array(names.length * 16);
  names.forEach((name, i) => ibm.set(invertRigid(world.get(name)), i * 16));
  const skin = doc.createSkin(`${assetId}_skin`)
    .setSkeleton(joints.get(names[0]))
    .setInverseBindMatrices(doc.createAccessor("inverseBind").setType("MAT4").setArray(ibm).setBuffer(buffer));
  for (const name of names) skin.addJoint(joints.get(name));

  // Weights: production vertices take the weights of the merged vertex at their position, so
  // vertices split along UV seams share weights and never crack apart.
  const matcher = vertexMatcher(rig.vertices);
  for (const node of root.listNodes().filter((n) => n.getMesh())) {
    node.setSkin(skin);
    container.addChild(node);
    for (const primitive of node.getMesh().listPrimitives()) {
      const position = primitive.getAttribute("POSITION").getArray();
      const count = position.length / 3;
      const J = new Uint16Array(count * 4);
      const W = new Float32Array(count * 4);
      for (let v = 0; v < count; v += 1) {
        const m = matcher.match(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
        let sum = 0;
        for (let c = 0; c < 4; c += 1) sum += rig.weights[m][c];
        for (let c = 0; c < 4; c += 1) {
          const w = rig.weights[m][c] / sum;
          J[v * 4 + c] = w > 0 ? rig.joints[m][c] : 0;
          W[v * 4 + c] = w;
        }
      }
      primitive.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(J).setBuffer(buffer));
      primitive.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(W).setBuffer(buffer));
    }
  }
  if (matcher.worst() > 1e-4) throw new Error(`vertex match off by ${matcher.worst()} m; mesh.glb and rig.json disagree`);

  // Clips: sampled rotations for every bone, hips translation only.
  for (const clip of rig.clips) {
    const animation = doc.createAnimation(clip.name);
    const times = Float32Array.from({ length: clip.frames }, (_, i) => i / clip.fps);
    const input = doc.createAccessor(`${clip.name}_t`).setType("SCALAR").setArray(times).setBuffer(buffer);
    for (const name of names) {
      const track = clip.tracks[name].rotation;
      const flat = Float32Array.from(track.flat());
      const sampler = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
        .setOutput(doc.createAccessor().setType("VEC4").setArray(flat).setBuffer(buffer));
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints.get(name)).setTargetPath("rotation").setSampler(sampler));
    }
    const sampler = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
      .setOutput(doc.createAccessor().setType("VEC3").setArray(Float32Array.from(clip.hipsTranslation.flat())).setBuffer(buffer));
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joints.get(rig.hips)).setTargetPath("translation").setSampler(sampler));
  }

  const out = path.join(paths.models, intake.production.manifest.file.replace(/^models\//, ""));
  mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  return { out, worstVertexMatch: matcher.worst() };
}

if (isMain(import.meta)) {
  const assetId = process.argv[2];
  if (!assetId) { console.error("usage: assemble.mjs <assetId>"); process.exit(2); }
  console.log(JSON.stringify(await assemble(assetId)));
}
