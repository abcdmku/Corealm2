/**
 * Measures what the runtime needs to know about a creature GLB's motion, from the skinned mesh
 * itself rather than from rig-specific bone names, so any body (studio or re-rigged) measures the
 * same way.
 *
 * - impliedWalkMps / impliedRunMps: median backward speed of skinned vertices while they are in
 *   the contact band above the clip's floor. An in-place cycle that looks like it covers ground at
 *   v m/s has its planted soles sliding backwards at v.
 * - groundY: median over Idle of the lowest skinned point (the standing sole).
 * - contactNormalized: Attack phase at which the body's front-most point reaches furthest forward.
 */
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface MotionMeasurement {
  animations: string[];
  durations: Record<string, number>;
  size: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  triangles: number;
  groundY: number;
  walkClipSeconds?: number;
  runClipSeconds?: number;
  impliedWalkMps?: number;
  impliedRunMps?: number;
  attackSeconds?: number;
  contactNormalized?: number;
}

/** Parses a GLB with its images stripped: Node has no image decoder and geometry is all we need. */
export async function loadGlbGeometry(file: string): Promise<GLTF> {
  const bytes = await readFile(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`Not a GLB: ${file}`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  json.materials = json.materials?.map((material: { name?: string; doubleSided?: boolean }) => ({ name: material.name, doubleSided: material.doubleSided }));
  json.images = []; json.textures = []; json.samplers = [];
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((name: string) => !/texture|KHR_materials/i.test(name));
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((name: string) => !/texture/i.test(name));
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

interface Sampler { meshes: THREE.SkinnedMesh[]; picks: { mesh: THREE.SkinnedMesh; index: number }[] }

function sampler(root: THREE.Object3D, limit = 6000): Sampler {
  const meshes: THREE.SkinnedMesh[] = [];
  const plain: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh);
    else if ((node as THREE.Mesh).isMesh) plain.push(node as THREE.Mesh);
  });
  const all = [...meshes, ...plain] as THREE.SkinnedMesh[];
  const total = all.reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
  const stride = Math.max(1, Math.ceil(total / limit));
  const picks: Sampler["picks"] = [];
  for (const mesh of all) {
    const count = mesh.geometry.getAttribute("position").count;
    for (let index = 0; index < count; index += stride) picks.push({ mesh, index });
  }
  return { meshes, picks };
}

/** World positions of the sampled vertices at `time` in `clip` (skinning applied). */
function pose(root: THREE.Object3D, mixer: THREE.AnimationMixer, time: number, s: Sampler, out: Float32Array): void {
  mixer.setTime(time);
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  s.picks.forEach(({ mesh, index }, i) => {
    mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
    out[i * 3] = point.x; out[i * 3 + 1] = point.y; out[i * 3 + 2] = point.z;
  });
}

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

function sampleClip(root: THREE.Object3D, clip: THREE.AnimationClip, s: Sampler, samples: number): Float32Array[] {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const frames: Float32Array[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const frame = new Float32Array(s.picks.length * 3);
    pose(root, mixer, (clip.duration * i) / samples, s, frame);
    frames.push(frame);
  }
  action.stop();
  mixer.uncacheRoot(root);
  return frames;
}

/** Median backward sole speed while planted; undefined when the cycle has no planted contact. */
function contactSpeed(frames: Float32Array[], duration: number, height: number): number | undefined {
  let floor = Infinity;
  for (const frame of frames) for (let i = 1; i < frame.length; i += 3) floor = Math.min(floor, frame[i]!);
  const band = floor + Math.max(0.004, height * 0.012);
  const dt = duration / (frames.length - 1);
  // A planted sole is a vertex that stays in the contact band for a stretch of the cycle while
  // sliding back at a steady rate. Brief grazes (a tail tip, a wing dipping during a bound) are
  // not stances, so only spans of at least 4% of the cycle with a consistent velocity count.
  const minSpan = Math.max(3, Math.round((frames.length - 1) * 0.04));
  const spans: { speed: number; length: number }[] = [];
  const count = frames[0]!.length / 3;
  for (let v = 0; v < count; v += 1) {
    let start = -1;
    for (let f = 0; f <= frames.length; f += 1) {
      const inBand = f < frames.length && frames[f]![v * 3 + 1]! <= band;
      if (inBand && start < 0) start = f;
      if (!inBand && start >= 0) {
        const length = f - 1 - start;
        if (length >= minSpan) {
          const steps: number[] = [];
          for (let g = start + 1; g < f; g += 1) steps.push((frames[g]![v * 3 + 2]! - frames[g - 1]![v * 3 + 2]!) / dt);
          const mean = steps.reduce((sum, value) => sum + value, 0) / steps.length;
          const spread = Math.sqrt(steps.reduce((sum, value) => sum + (value - mean) ** 2, 0) / steps.length);
          if (Math.abs(mean) > 1e-3 && spread < Math.abs(mean) * 0.5) spans.push({ speed: mean, length });
        }
        start = -1;
      }
    }
  }
  if (spans.length < 4) return undefined;
  // Creatures face +Z, so planted soles slide towards -Z. Take the dominant direction's magnitude
  // so a body authored facing -Z still measures; weight each stance by its length.
  const backward = spans.filter((span) => span.speed < 0).reduce((sum, span) => sum + span.length, 0);
  const forward = spans.filter((span) => span.speed > 0).reduce((sum, span) => sum + span.length, 0);
  const sign = backward >= forward ? -1 : 1;
  const weighted = spans.filter((span) => Math.sign(span.speed) === sign)
    .flatMap((span) => Array<number>(span.length).fill(Math.abs(span.speed)));
  const speed = median(weighted);
  return speed !== undefined && speed > 1e-3 ? speed : undefined;
}

export async function measureCreatureGlb(file: string): Promise<MotionMeasurement> {
  const gltf = await loadGlbGeometry(file);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const rest = new THREE.Box3().setFromObject(root, true);
  const size = rest.getSize(new THREE.Vector3());
  let triangles = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const index = mesh.geometry.getIndex();
    triangles += (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
  });
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip] as const));
  const s = sampler(root);
  const result: MotionMeasurement = {
    animations: gltf.animations.map((clip) => clip.name),
    durations: Object.fromEntries(gltf.animations.map((clip) => [clip.name, +clip.duration.toFixed(6)])),
    size: { x: +size.x.toFixed(6), y: +size.y.toFixed(6), z: +size.z.toFixed(6) },
    base: { x: +rest.min.x.toFixed(6), y: +rest.min.y.toFixed(6), z: +rest.min.z.toFixed(6) },
    triangles: Math.round(triangles),
    groundY: +rest.min.y.toFixed(4),
  };
  const idle = clips.get("Idle");
  if (idle) {
    const mins = sampleClip(root, idle, s, 48).map((frame) => { let min = Infinity; for (let i = 1; i < frame.length; i += 3) min = Math.min(min, frame[i]!); return min; });
    result.groundY = +median(mins)!.toFixed(4);
  }
  for (const [name, key] of [["Walk", "walk"], ["Run", "run"]] as const) {
    const clip = clips.get(name);
    if (!clip) continue;
    result[`${key}ClipSeconds`] = +clip.duration.toFixed(6);
    const speed = contactSpeed(sampleClip(root, clip, s, 160), clip.duration, size.y);
    if (speed !== undefined) result[key === "walk" ? "impliedWalkMps" : "impliedRunMps"] = +speed.toFixed(6);
  }
  const attack = clips.get("Attack");
  if (attack) {
    result.attackSeconds = +attack.duration.toFixed(6);
    const frames = sampleClip(root, attack, s, 60);
    let best = 0, reach = -Infinity;
    frames.forEach((frame, index) => {
      let front = -Infinity;
      for (let i = 2; i < frame.length; i += 3) front = Math.max(front, frame[i]!);
      if (front > reach + 1e-6) { reach = front; best = index; }
    });
    const phase = best / (frames.length - 1);
    result.contactNormalized = +Math.min(0.9, Math.max(0.15, phase)).toFixed(3);
  }
  return result;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("measure.ts")) {
  for (const file of process.argv.slice(2)) console.log(file, JSON.stringify(await measureCreatureGlb(file), null, 1));
}
