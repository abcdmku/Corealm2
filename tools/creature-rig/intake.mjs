/**
 * Step 1: source intake for one production creature.
 *
 * Writes <work>/mesh.glb: the production mesh in its bind pose, baked to world space (metres,
 * lowest vertex on y=0, body centred over the origin), with the production materials and textures
 * and no skin, skeleton or clips. The production geometry and UVs are the reference; Blender fits,
 * weights and animates this file and the assembler writes the result back onto it.
 *
 * Also searches the Tripo source exports for a healthy rig of the same geometry. When one exists
 * its joint positions become the skeleton landmarks; otherwise the class module fits one.
 *
 *   node tools/creature-rig/intake.mjs <assetId> [--work dir]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { HEALTH_GATES, inspectRig, shapeKey } from "./rig-health.mjs";
import { assetConfig, isMain, paths, repo } from "./paths.mjs";

// Only Tripo's own exports. assets/art/tripo/imports/creatures holds the retired repo rigs
// (candidates, polish passes, earlier production copies); they pass the health gates but their
// joints are hand-typed constants, so they must never become landmarks.
const SOURCE_ROOTS = [
  path.join(repo, "assets/art/tripo/exports"),
  "C:/Users/Borg/Downloads",
];

export async function openDocument(file) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return { io, doc: await io.read(file) };
}

const mat3Normal = (m) => {
  // Inverse-transpose of the upper 3x3 of a column-major 4x4 (uniform scale and rotation only in
  // practice, but stay exact).
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4]);
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  // transpose of inverse, column-major
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
};

/** Float copy of an accessor's values. A KHR_mesh_quantization accessor (normalized integers) is
 * dequantized first, so baked values are never written back into an 8- or 16-bit array. */
export function floatArray(accessor) {
  const a = accessor.getArray();
  if (a instanceof Float32Array) return a.slice();
  if (!accessor.getNormalized()) return Float32Array.from(a);
  const max = a instanceof Int8Array ? 127 : a instanceof Uint8Array ? 255 : a instanceof Int16Array ? 32767 : 65535;
  return Float32Array.from(a, (v) => Math.max(v / max, -1));
}

/** Writes float values into an accessor and drops its quantization. */
export function setFloat(accessor, values) {
  accessor.setArray(values instanceof Float32Array ? values : Float32Array.from(values)).setNormalized(false);
}

/** A skinned mesh's bind placement. glTF ignores the mesh node's own transform and places the
 * vertices by joint world x inverse bind (the same for every joint of a bind-consistent rig). */
function skinBindMatrix(skin) {
  const J = skin.listJoints()[0].getWorldMatrix();
  const I = skin.getInverseBindMatrices().getArray().slice(0, 16);
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += J[k * 4 + r] * I[c * 4 + k];
  return o;
}

/** Per-vertex skinning matrices (column-major) of a skinned primitive at the joints' current
 * (rest) pose: the weighted sum of joint world x inverse bind. */
function restSkinning(skin, primitive, count) {
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const mats = joints.map((joint, j) => {
    const J = joint.getWorldMatrix();
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += J[k * 4 + r] * ibm[j * 16 + c * 4 + k];
    return o;
  });
  const J = primitive.getAttribute("JOINTS_0");
  const W = primitive.getAttribute("WEIGHTS_0");
  const j4 = [0, 0, 0, 0];
  const w4 = [0, 0, 0, 0];
  return Array.from({ length: count }, (_, v) => {
    J.getElement(v, j4);
    W.getElement(v, w4);
    const m = new Array(16).fill(0);
    for (let c = 0; c < 4; c += 1) if (w4[c]) for (let e = 0; e < 16; e += 1) m[e] += w4[c] * mats[j4[c]][e];
    return m;
  });
}

/** Sets every node a clip keys to that clip's first key (translation, rotation, scale), so a
 * "rest" bake skins the mesh into the pose the studio animates from. A file whose bind and node
 * rest are both contorted (a Tripo salamander with the tail curled over its back) usually stands
 * well in its own Idle. */
function poseAtClipStart(doc, name) {
  const animation = doc.getRoot().listAnimations().find((a) => a.getName() === name);
  if (!animation) throw new Error(`bind clip ${name} is not in the production file`);
  const el = [];
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const path = channel.getTargetPath();
    const out = channel.getSampler()?.getOutput();
    if (!node || !out || !["translation", "rotation", "scale"].includes(path)) continue;
    const v = out.getElement(0, el).slice();
    if (path === "translation") node.setTranslation(v);
    else if (path === "rotation") node.setRotation(v);
    else node.setScale(v);
  }
}

/** Bakes every mesh node's rest world transform into its vertices and strips skin and clips.
 * Positions and normals come out as float accessors. A skinned mesh is placed by its skin bind
 * (joint world x inverse bind); with pose "rest" it is skinned into the joints' rest pose instead,
 * for a source whose bind is contorted but whose rest stands well (config "bind": "rest"), or
 * into the first frame of a named clip (config "bind": {"clip": "Idle"}). */
export function bakeBindMesh(doc, { pose = "bind", clip = null } = {}) {
  const root = doc.getRoot();
  if (clip) poseAtClipStart(doc, clip);
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshNodes = root.listNodes().filter((node) => node.getMesh());
  const baked = [];
  const seen = new Set(); // primitives of one mesh can share an accessor: transform it once
  for (const node of meshNodes) {
    const skin = node.getSkin();
    const m0 = skin ? skinBindMatrix(skin) : node.getWorldMatrix();
    const n0 = mat3Normal(m0);
    for (const primitive of node.getMesh().listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      const normal = primitive.getAttribute("NORMAL");
      const shared = seen.has(position);
      seen.add(position);
      const p = shared ? null : floatArray(position);
      const perVertex = !shared && skin && pose === "rest" ? restSkinning(skin, primitive, p.length / 3) : null;
      const at = (i) => (perVertex ? perVertex[i / 3] : m0);
      for (let i = 0; p && i < p.length; i += 3) {
        const m = at(i);
        const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
        p[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        p[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        p[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      if (p) setFloat(position, p);
      if (!shared && normal && !seen.has(normal)) {
        seen.add(normal);
        const q = floatArray(normal);
        for (let i = 0; i < q.length; i += 3) {
          const n = perVertex ? mat3Normal(at(i)) : n0;
          const [x, y, z] = [q[i], q[i + 1], q[i + 2]];
          const v = [n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z];
          const l = Math.hypot(...v) || 1;
          q[i] = v[0] / l; q[i + 1] = v[1] / l; q[i + 2] = v[2] / l;
        }
        setFloat(normal, q);
      }
      for (const semantic of ["JOINTS_0", "WEIGHTS_0", "JOINTS_1", "WEIGHTS_1", "TANGENT"]) {
        const attribute = primitive.getAttribute(semantic);
        if (attribute) { primitive.setAttribute(semantic, null); if (!attribute.listParents().some((p) => p !== root)) attribute.dispose(); }
      }
    }
    baked.push(node);
  }
  for (const animation of root.listAnimations()) animation.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const child of scene.listChildren()) scene.removeChild(child);
  for (const node of root.listNodes()) if (!baked.includes(node)) node.dispose();
  for (const node of baked) {
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    for (const child of node.listChildren()) node.removeChild(child);
    scene.addChild(node);
  }
  return baked;
}

/** Turns every baked vertex and normal about the origin: "orient" {pitch, roll, yaw} in degrees,
 * applied in that order (pitch about +X, roll about +Z, yaw about +Y). For a body sculpted lying
 * in the wrong plane (a top-view spider stood on end), so the fit sees it standing on its legs,
 * facing +Z. The candidate keeps the turned bind; production's orientation is not reused. */
export function orientMesh(nodes, { pitch = 0, roll = 0, yaw = 0 } = {}) {
  const rad = (d) => (d * Math.PI) / 180;
  const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
  const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
  const m = mul3(ry(rad(yaw)), mul3(rz(rad(roll)), rx(rad(pitch))));
  const seen = new Set();
  for (const node of nodes) for (const primitive of node.getMesh().listPrimitives()) {
    for (const semantic of ["POSITION", "NORMAL"]) {
      const accessor = primitive.getAttribute(semantic);
      if (!accessor || seen.has(accessor)) continue;
      seen.add(accessor);
      const p = floatArray(accessor);
      for (let i = 0; i < p.length; i += 3) {
        const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
        for (let r = 0; r < 3; r += 1) p[i + r] = m[r][0] * x + m[r][1] * y + m[r][2] * z;
      }
      setFloat(accessor, p);
    }
  }
}

function boundsOf(nodes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const points = [];
  for (const node of nodes) for (const primitive of node.getMesh().listPrimitives()) {
    const p = primitive.getAttribute("POSITION").getArray();
    for (let i = 0; i < p.length; i += 3) {
      points.push([p[i], p[i + 1], p[i + 2]]);
      for (let a = 0; a < 3; a += 1) { min[a] = Math.min(min[a], p[i + a]); max[a] = Math.max(max[a], p[i + a]); }
    }
  }
  return { min, max, points };
}

function translateAll(nodes, offset) {
  const seen = new Set();
  for (const node of nodes) for (const primitive of node.getMesh().listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
    if (seen.has(position)) continue;
    seen.add(position);
    const p = position.getArray().slice();
    for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a += 1) p[i + a] += offset[a];
    position.setArray(p);
  }
}

/** Ground the lowest vertex on y=0 and centre the lowest 15% of the body (feet, hem) on the origin;
 * with centre "bounds", the whole body's bounds (a body whose legs on one side are modelled short). */
function groundAndCentre(nodes, centre) {
  const { min, max, points } = boundsOf(nodes);
  const band = centre === "bounds" ? max[1] : min[1] + (max[1] - min[1]) * 0.15;
  const low = points.filter((p) => p[1] <= band);
  const lx = low.map((p) => p[0]);
  const lz = low.map((p) => p[2]);
  const offset = [-(Math.min(...lx) + Math.max(...lx)) / 2, -min[1], -(Math.min(...lz) + Math.max(...lz)) / 2];
  translateAll(nodes, offset);
  return { offset, ...boundsOf(nodes) };
}

function listGlbs(dir, depth = 0, out = []) {
  if (!existsSync(dir) || depth > 3) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listGlbs(full, depth + 1, out);
    else if (entry.name.toLowerCase().endsWith(".glb")) out.push(full);
  }
  return out;
}

// A verdict is only reused under the gates that produced it.
const GATES_KEY = JSON.stringify(HEALTH_GATES);

/** Cached health/shape index over every source root; re-inspects only changed files. */
function sourceIndex() {
  const cacheFile = paths.sourceIndex;
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const index = {};
  for (const file of SOURCE_ROOTS.flatMap((root) => listGlbs(root))) {
    const stat = statSync(file);
    const key = `${file}|${stat.size}|${stat.mtimeMs}|${GATES_KEY}`;
    if (cache[key]) { index[key] = cache[key]; continue; }
    try {
      const report = inspectRig(file);
      index[key] = { file, vertexCount: report.vertexCount, triangleCount: report.triangleCount, bounds: report.bounds, rigged: report.rigged, healthy: report.healthy, reasons: report.reasons };
    } catch (error) {
      index[key] = { file, error: String(error.message ?? error) };
    }
  }
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(index));
  return Object.values(index);
}

/** Source exports whose geometry is the production mesh (same counts, same proportions). */
function matchingSources(production) {
  const want = shapeKey(production.bounds);
  return sourceIndex()
    .filter((entry) => !entry.error && entry.bounds && entry.vertexCount === production.vertexCount)
    .map((entry) => ({ ...entry, shapeError: Math.max(...shapeKey(entry.bounds).map((v, a) => Math.abs(v - want[a]))) }))
    .filter((entry) => entry.shapeError < 0.02);
}

/** What an intake depends on: the forced source and the production file. */
export function intakeKey(config, productionBytes) {
  return createHash("sha256").update(JSON.stringify({ source: config.source ?? null, bind: config.bind ?? null, tool: 2, orient: config.orient, centre: config.centre })).update(productionBytes).digest("hex").slice(0, 16);
}

/** True when <work>/intake.json is missing or was made from another source or production file. */
export function intakeStale(assetId, work = paths.work(assetId)) {
  const file = path.join(work, "intake.json");
  if (!existsSync(file) || !existsSync(path.join(work, "mesh.glb"))) return true;
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const entry = manifest.assets.find((asset) => asset.id === assetId);
  if (!entry) return true;
  const recorded = JSON.parse(readFileSync(file, "utf8")).intakeKey;
  return recorded !== intakeKey(assetConfig(assetId), readFileSync(path.join(paths.publicAssets, entry.file)));
}

export async function intake(assetId, work = paths.work(assetId)) {
  const config = assetConfig(assetId);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const entry = manifest.assets.find((asset) => asset.id === assetId);
  if (!entry) throw new Error(`${assetId} is not in the manifest`);
  const productionFile = path.join(paths.publicAssets, entry.file);
  const productionBytes = readFileSync(productionFile);

  const { io, doc } = await openDocument(productionFile);
  const bindClip = config.bind && typeof config.bind === "object" ? config.bind.clip : null;
  const meshNodes = bakeBindMesh(doc, { pose: config.bind === "rest" || bindClip ? "rest" : "bind", clip: bindClip });
  if (config.orient) orientMesh(meshNodes, config.orient);
  const grounded = groundAndCentre(meshNodes, config.centre);
  const vertexCount = meshNodes.reduce((n, node) => n + node.getMesh().listPrimitives().reduce((m, p) => m + p.getAttribute("POSITION").getCount(), 0), 0);
  mkdirSync(work, { recursive: true });
  await io.write(path.join(work, "mesh.glb"), doc);

  // A healthy source rig is matched against the production geometry before it is trusted.
  const productionRaw = inspectRig(productionFile);
  // A turned bind ("orient") no longer shares the source rig's space, so it is always fitted.
  const candidates = config.orient ? [] : config.source ? [{ file: path.resolve(repo, config.source), shapeError: 0 }] : matchingSources(productionRaw);
  let source = { kind: "fitted", reason: config.orient ? "the bind is turned by orient" : "no healthy source rig matches the production geometry" };
  const considered = [];
  for (const candidate of candidates) {
    const report = inspectRig(candidate.file);
    considered.push({ file: candidate.file, healthy: report.healthy, reasons: report.reasons, shapeError: candidate.shapeError });
    if (!report.healthy || source.kind === "tripo-rig") continue;
    // Map the source bind space onto the baked production space through the two bounds.
    const scale = (grounded.max[1] - grounded.min[1]) / (report.bounds.max[1] - report.bounds.min[1]);
    const map = (p) => p.map((v, a) => grounded.min[a] + (v - report.bounds.min[a]) * scale);
    source = {
      kind: "tripo-rig",
      file: candidate.file,
      joints: report.joints.map((joint) => ({ name: joint.name, parent: joint.parent, position: map(joint.bindPosition), weightShare: joint.weightShare })),
    };
  }

  const record = {
    assetId,
    // Only the config fields intake uses (source, bind, orient, centre). Class, profile and profileOverrides are read again by
    // rig.py at rig time; run.mjs repeats the intake when these or the production file change.
    intakeKey: intakeKey(config, productionBytes),
    production: {
      file: path.relative(repo, productionFile).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(productionBytes).digest("hex"),
      vertexCount,
      manifest: entry,
    },
    bindMesh: { file: "mesh.glb", offset: grounded.offset, min: grounded.min, max: grounded.max },
    source,
    considered,
  };
  writeFileSync(path.join(work, "intake.json"), JSON.stringify(record, null, 2));
  return record;
}

if (isMain(import.meta)) {
  const assetId = process.argv[2];
  if (!assetId) { console.error("usage: intake.mjs <assetId>"); process.exit(2); }
  const record = await intake(assetId);
  console.log(JSON.stringify({ assetId, source: record.source.kind, considered: record.considered, bounds: [record.bindMesh.min, record.bindMesh.max] }, null, 1));
}
