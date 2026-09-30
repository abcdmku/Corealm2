/**
 * Faithful native export: keep the production body (mesh, skin, binds, textures, props) and replace
 * its clips with the studio's own takes. Allowed edits are renaming, one uniform scale on
 * rest-relative translation deltas, and removing horizontal root drift. No floor wrappers, retiming,
 * synthesized states or IK. See D:/corealm-scratch/anim-audit/BRIEF.md.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { type Animation, type Document, type Node, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { applyClip, restorePose, sample, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';

export type ChannelPath = 'translation' | 'rotation' | 'scale';
export interface Track { node: string; path: ChannelPath; times: Float32Array; values: Float32Array; interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }
export interface Rest { t: number[]; r: number[]; s: number[] }
export interface NativeSource { file: string; sha256: string; rest: Map<string, Rest>; clips: Map<string, Track[]> }

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_');

/**
 * Bind-pose local transforms. Node TRS is not always the bind pose (some production bodies were
 * saved mid-pose), so joints under a joint of the same skin take theirs from the inverse binds.
 */
export function bindRest(doc: Document): Map<Node, Rest> {
  const rest = new Map<Node, Rest>(doc.getRoot().listNodes().map(node => [node, { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() }]));
  for (const skin of doc.getRoot().listSkins()) {
    const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices();
    if (!ibm) continue;
    const inverse = new Map(joints.map((joint, i) => [joint, new THREE.Matrix4().fromArray(ibm.getElement(i, []))]));
    for (const joint of joints) {
      const parent = joint.getParentNode();
      if (!parent || !inverse.has(parent)) continue;
      const local = inverse.get(parent)!.clone().multiply(inverse.get(joint)!.clone().invert());
      const t = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3();
      local.decompose(t, r, s);
      rest.set(joint, { t: t.toArray(), r: r.toArray(), s: s.toArray() });
    }
  }
  return rest;
}

/** A GLB whose animations are the native takes. `rename` receives the node and its JSON index. */
export async function gltfSource(file: string, rename: (name: string, index: number) => string = name => name): Promise<NativeSource> {
  const doc = await io.read(file), nodes = doc.getRoot().listNodes();
  const names = new Map<Node, string>(nodes.map((node, index) => [node, rename(node.getName(), index)]));
  const binds = bindRest(doc), rest = new Map<string, Rest>();
  for (const node of nodes) rest.set(names.get(node)!, binds.get(node)!);
  const clips = new Map<string, Track[]>();
  for (const clip of doc.getRoot().listAnimations()) clips.set(clip.getName(), clip.listChannels().map(channel => {
    const sampler = channel.getSampler()!;
    return { node: names.get(channel.getTargetNode()!)!, path: channel.getTargetPath() as ChannelPath,
      times: new Float32Array(sampler.getInput()!.getArray()!), values: new Float32Array(sampler.getOutput()!.getArray()!),
      interpolation: sampler.getInterpolation() };
  }));
  return { file, sha256: sha256(file), rest, clips };
}

interface SourceJson {
  nodes: { name: string; position: number[]; quaternion: number[]; scale: number[] }[];
  clips: { name: string; times: number[]; tracks: { node: number; position: number[]; quaternion: number[]; scale: number[] }[] }[];
}
/** The sampled Blender/ufbx source records under tools/rpg-bestiary/*-source/derived/source.json. */
export function sourceJson(file: string, prefix: string): NativeSource {
  const data = JSON.parse(readFileSync(file, 'utf8')) as SourceJson;
  const name = (index: number) => `${prefix}_${index}_${sanitize(data.nodes[index]!.name)}`;
  const rest = new Map(data.nodes.map((node, index) => [name(index), { t: node.position, r: node.quaternion, s: node.scale }]));
  const clips = new Map(data.clips.map(clip => {
    const times = new Float32Array(clip.times);
    return [clip.name, clip.tracks.flatMap(track => ([['translation', track.position], ['rotation', track.quaternion], ['scale', track.scale]] as const)
      .map(([path, values]) => ({ node: name(track.node), path, times, values: new Float32Array(values), interpolation: 'LINEAR' as const })))];
  }));
  return { file, sha256: sha256(file), rest, clips };
}

/** FBX model plus one FBX per take, parsed by three's FBXLoader (as the original factory did). */
export function fbxSource(model: string, takes: Record<string, string>): NativeSource {
  const manager = new THREE.LoadingManager();
  // Parse the rig and takes only; texture files are never read.
  manager.addHandler(/./, { path: '', setPath() { return this; }, load: () => new THREE.Texture() } as unknown as THREE.Loader);
  const parse = (file: string) => { const bytes = readFileSync(file); return new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, ''); };
  const rest = new Map<string, Rest>();
  parse(model).traverse(node => rest.set(node.name, { t: node.position.toArray(), r: node.quaternion.toArray(), s: node.scale.toArray() }));
  const property: Record<string, ChannelPath> = { position: 'translation', quaternion: 'rotation', scale: 'scale' };
  const clips = new Map<string, Track[]>();
  for (const [name, file] of Object.entries(takes)) {
    const clip = parse(file).animations[0];
    if (!clip) throw new Error(`No take in ${file}`);
    clips.set(name, clip.tracks.map(track => {
      const dot = track.name.lastIndexOf('.');
      return { node: track.name.slice(0, dot), path: property[track.name.slice(dot + 1)]!, times: new Float32Array(track.times), values: new Float32Array(track.values), interpolation: 'LINEAR' };
    }));
  }
  return { file: `${model} + ${Object.values(takes).join(', ')}`, sha256: sha256(model), rest, clips };
}

/** One studio take, optionally trimmed to [from, to] seconds (endpoints interpolated). */
export type TakePart = readonly [take: string, range?: readonly [from: number, to: number]];
/** `range` trims the take and restarts it at 0; `then` chains further trimmed takes after it (a
 * loop rotation or an enter/shoot/exit chain). Chained parts must meet at matching poses. */
export interface NativeState { as: string; source: NativeSource; clip: string; range?: readonly [from: number, to: number]; then?: TakePart[] }

/** The tracks of `parts` played back to back; each later part drops its first key (the seam). */
export function chainTracks(source: NativeSource, parts: TakePart[]): Track[] {
  const byKey = new Map<string, Track>();
  let offset = 0;
  for (const [index, [take, range]] of parts.entries()) {
    const native = source.clips.get(take);
    if (!native) throw new Error(`${source.file}: no take ${take}`);
    const [from, to] = range ?? [0, Math.max(...native.map(track => track.times[track.times.length - 1]!))];
    const tracks = native.map(track => trimTrack(track, from, to)), seconds = to - from;
    for (const track of tracks) {
      const key = `${track.node}/${track.path}`, width = track.path === 'rotation' ? 4 : 3, skip = index > 0 ? 1 : 0;
      const times = Array.from(track.times.slice(skip), time => time + offset), values = Array.from(track.values.slice(skip * width));
      const previous = byKey.get(key);
      if (!previous && index > 0) throw new Error(`${take}: ${key} is not in the first chained take`);
      byKey.set(key, previous ? { ...previous, times: new Float32Array([...previous.times, ...times]), values: new Float32Array([...previous.values, ...values]) }
        : { ...track, times: new Float32Array(times), values: new Float32Array(values) });
    }
    offset += seconds;
  }
  return [...byKey.values()];
}

/** Keys of one track inside [from, to], endpoints interpolated, times shifted to start at 0. */
export function trimTrack(track: Track, from: number, to: number): Track {
  const width = track.path === 'rotation' ? 4 : 3, t = track.times, v = track.values;
  const at = (time: number) => {
    let i = 0; while (i < t.length - 1 && t[i + 1]! <= time) i++;
    const j = Math.min(i + 1, t.length - 1), a = v.slice(i * width, (i + 1) * width), b = v.slice(j * width, (j + 1) * width);
    const alpha = j === i || time <= t[i]! ? 0 : Math.min(1, (time - t[i]!) / (t[j]! - t[i]!));
    if (track.interpolation === 'STEP' || alpha === 0) return Array.from(a);
    if (width === 4) return new THREE.Quaternion().fromArray(Array.from(a)).slerp(new THREE.Quaternion().fromArray(Array.from(b)), alpha).toArray();
    return Array.from(a, (x, k) => x + (b[k]! - x) * alpha);
  };
  const times = [from, ...Array.from(t).filter(time => time > from + 1e-6 && time < to - 1e-6), to];
  return { ...track, times: new Float32Array(times.map(time => time - from)), values: new Float32Array(times.flatMap(at)) };
}
export interface TransplantOptions {
  /** Production clips kept byte-for-byte (e.g. a Death with no native replacement). */
  keep: string[];
  states: NativeState[];
  /** Map a source node name to the production node name; return null to skip (e.g. mesh nodes). */
  target?: (sourceName: string) => string | null;
  /** raw: copy values. rest: apply the native delta from the source rest onto the production rest. */
  rotation: 'raw' | 'rest';
  translation: 'raw' | 'rest';
  /** Uniform scale on translation deltas in rest mode: target / source rest length of this node
   * (e.g. `pelvis`, the hip height above the UAL root). Defaults to 1. */
  translationScaleFrom?: string;
  /** Nodes whose translation stays at the production rest (UAL `root`). */
  pinned?: string[];
  /** Hold these local translation axes at their first key: removes horizontal root drift only. */
  inPlace?: { node: string; axes: number[]; clips?: string[] };
}

export interface TransplantReport { clips: { name: string; source: string; seconds: number; channels: number; translationScale: number }[]; skipped: string[]; maxRestDelta: { rotationDeg: number; translation: number; node: string } }

const angleDeg = (a: number[], b: number[]) => 2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!))) * 180 / Math.PI;

export function transplant(doc: Document, options: TransplantOptions): TransplantReport {
  const root = doc.getRoot(), buffer = root.listBuffers()[0]!;
  const byName = new Map<string, Node>(), duplicate = new Set<string>();
  // Skin joints win over same-named stray nodes (e.g. an unused armature left by a mesh merge).
  const joints = new Set(root.listSkins().flatMap(skin => skin.listJoints()));
  for (const pass of [true, false]) {
    const seen = new Set<string>();
    for (const node of root.listNodes()) {
      if (joints.has(node) !== pass || (!pass && byName.has(node.getName()) && !seen.has(node.getName()))) continue;
      if (seen.has(node.getName())) duplicate.add(node.getName());
      seen.add(node.getName()); byName.set(node.getName(), node);
    }
  }
  for (const clip of [...root.listAnimations()]) if (!options.keep.includes(clip.getName())) clip.dispose();
  for (const name of options.keep) if (!root.listAnimations().some(clip => clip.getName() === name)) throw new Error(`Kept clip ${name} is absent`);
  const skipped = new Set<string>();
  const maxRestDelta = { rotationDeg: 0, translation: 0, node: '' };
  const report: TransplantReport['clips'] = [];
  const binds = bindRest(doc);
  const target = (sourceName: string) => options.target ? options.target(sourceName) : sourceName;
  const scaleFor = (source: NativeSource) => {
    if (!options.translationScaleFrom) return 1;
    const node = byName.get(target(options.translationScaleFrom) ?? ''), rest = source.rest.get(options.translationScaleFrom);
    if (!node || !rest) throw new Error(`No ${options.translationScaleFrom} to derive the translation scale`);
    return Math.hypot(...binds.get(node)!.t) / Math.hypot(...rest.t);
  };
  for (const state of options.states) {
    const translationScale = scaleFor(state.source);
    const native = state.source.clips.get(state.clip);
    if (!native) throw new Error(`${state.source.file}: no take ${state.clip}`);
    const tracks = state.then ? chainTracks(state.source, [[state.clip, state.range], ...state.then])
      : state.range ? native.map(track => trimTrack(track, state.range![0], state.range![1])) : native;
    const clip = doc.createAnimation(state.as);
    let seconds = 0, channels = 0;
    for (const track of tracks) {
      const name = target(track.node);
      if (name === null) continue;
      if (duplicate.has(name)) throw new Error(`Ambiguous production node ${name}`);
      const node = byName.get(name);
      if (!node) { skipped.add(`${track.node}`); continue; }
      const sourceRest = state.source.rest.get(track.node);
      if (!sourceRest) throw new Error(`No source rest for ${track.node}`);
      const values = new Float32Array(track.values), width = track.path === 'rotation' ? 4 : 3;
      if (track.interpolation === 'CUBICSPLINE') throw new Error('Cubic native takes need tangent-aware conversion');
      if (track.path === 'rotation') {
        const bind = binds.get(node)!, delta = angleDeg(sourceRest.r, bind.r);
        if (delta > maxRestDelta.rotationDeg) Object.assign(maxRestDelta, { rotationDeg: delta, node: name });
        if (options.rotation === 'rest') {
          const correction = new THREE.Quaternion(...bind.r).multiply(new THREE.Quaternion(...sourceRest.r).invert());
          const q = new THREE.Quaternion();
          for (let i = 0; i < values.length; i += 4) values.set(q.fromArray(values, i).premultiply(correction).normalize().toArray(), i);
        }
      } else if (track.path === 'translation') {
        const targetRest = binds.get(node)!.t;
        maxRestDelta.translation = Math.max(maxRestDelta.translation, Math.hypot(...targetRest.map((v, k) => v - sourceRest.t[k]!)));
        if (options.pinned?.includes(name)) for (let i = 0; i < values.length; i += 3) values.set(targetRest, i);
        else if (options.translation === 'rest') {
          const k = translationScale;
          for (let i = 0; i < values.length; i += 3) for (let a = 0; a < 3; a++) values[i + a] = targetRest[a]! + (values[i + a]! - sourceRest.t[a]!) * k;
        }
      } else if (options.translation === 'rest') {
        const targetRest = binds.get(node)!.s;
        for (let i = 0; i < values.length; i += 3) for (let a = 0; a < 3; a++) values[i + a] = targetRest[a]! * values[i + a]! / sourceRest.s[a]!;
      }
      if (options.inPlace?.node === name && track.path === 'translation' && (!options.inPlace.clips || options.inPlace.clips.includes(state.as))) {
        for (let i = 0; i < values.length; i += 3) for (const a of options.inPlace.axes) values[i + a] = values[a]!;
      }
      // A channel that only ever holds the production rest value is a lossless no-op.
      const restValue = track.path === 'rotation' ? node.getRotation() : track.path === 'translation' ? node.getTranslation() : node.getScale();
      if (values.every((value, i) => Math.abs(value - restValue[i % width]!) < 1e-7)) continue;
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(track.times)).setBuffer(buffer);
      const output = doc.createAccessor().setType(width === 4 ? 'VEC4' : 'VEC3').setArray(values).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(track.interpolation);
      clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(track.path).setSampler(sampler));
      seconds = Math.max(seconds, track.times[track.times.length - 1]!); channels++;
    }
    if (!channels) throw new Error(`${state.as}: no channel reached the production rig`);
    report.push({ name: state.as, source: `${[[state.clip, state.range] as TakePart, ...(state.then ?? [])].map(([take, range]) => `${take}${range ? ` [${range[0]}-${range[1]} s]` : ''}`).join(' + ')} @ ${state.source.file}`, seconds, channels, translationScale });
  }
  return { clips: report, skipped: [...skipped], maxRestDelta };
}

/** Drop orphaned animation data without touching nodes, meshes, materials or textures. */
export async function compact(doc: Document) {
  await doc.transform(
    prune({ propertyTypes: [PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
  );
}

export const clipSeconds = (clip: Animation) => Math.max(...clip.listSamplers().map(sampler => { const t = sampler.getInput()!.getArray()!; return t[t.length - 1]!; }));

/**
 * A body thicker or longer-waisted than the studio mannequin goes through the floor when a take
 * lays it down. The same rule as the creature-rig retarget (crlib `lying_lift`): only for a clip whose
 * hips drop below half their rest height, lift the hips by a smooth envelope of the skinned mesh's
 * floor penetration (sliding max, then a sliding mean of the same span, never below the need).
 * Standing clips are never touched. Returns the lift at the last key (0 when nothing was needed).
 * `lead` (crlib liftLead): keys of look-ahead only, so a falling body is not lifted before it lands.
 * `minY`: the lowest point to keep off the floor (default: the whole skinned mesh).
 */
export function lyingLift(doc: Document, clipName: string, rootNames: string[], options: { lead?: number; minY?: () => number } = {}): number {
  // rootNames: the hips first, then any other top joints that do not hang from it (IK leg roots).
  const root = doc.getRoot(), clip = root.listAnimations().find(c => c.getName() === clipName);
  const roots = rootNames.map(name => root.listNodes().find(n => n.getName() === name));
  const channels = roots.map(node => clip?.listChannels().find(c => c.getTargetNode() === node && c.getTargetPath() === 'translation'));
  const hips = roots[0];
  if (!clip || !hips || channels.some(c => !c)) return 0;
  // Every key time in the clip (a sparse hips track would otherwise miss a limb's dip between its keys).
  const times = [...new Set(clip.listSamplers().flatMap(s => Array.from(s.getInput()!.getArray()!)))].sort((a, b) => a - b);
  const stored = storedPose(doc), restY = new THREE.Matrix4().fromArray(hips.getWorldMatrix()).elements[13]!;
  const height = deformedBounds(doc).max[1]!;
  const need: number[] = [], hipsY: number[] = [];
  for (let i = 0; i < times.length; i++) {
    restorePose(stored); applyClip(clip, times[i]!);
    hipsY.push(hips.getWorldMatrix()[13]!);
    need.push(Math.max(-(options.minY ? options.minY() : deformedBounds(doc).min[1]!), 0));
  }
  restorePose(stored);
  if (Math.max(...hipsY.map(y => restY - y)) < 0.5 * restY) return 0;
  const floor = need.map(n => (n < 0.003 * height ? 0 : n));
  if (!floor.some(Boolean)) return 0;
  const span = 9, lead = options.lead, at = (a: number[], i: number) => a[Math.min(a.length - 1, Math.max(0, i))]!;
  const mean = (a: number[], from: number, count: number) => Array.from({ length: count }, (_, k) => at(a, from + k)).reduce((x, y) => x + y) / count;
  const envelope = floor.map((_, i) => Math.max(...Array.from({ length: span + (lead ?? span) + 1 }, (_, k) => at(floor, i - span + k))));
  const lift = envelope.map((_, i) => Math.max(floor[i]!, lead === undefined ? mean(envelope, i - (span >> 1), span) : mean(envelope, i - (span >> 1), (span >> 1) + 1)));
  roots.forEach((node, index) => {
    const sampler = channels[index]!.getSampler()!, output = sampler.getOutput()!;
    const values = times.flatMap(time => sample(sampler, time));
    // World up in this joint's parent frame (direction only).
    const parent = node!.getParentNode(), inverse = new THREE.Matrix4().fromArray(parent ? parent.getWorldMatrix() : new THREE.Matrix4().toArray()).invert();
    const local = new THREE.Vector3(0, 1, 0).applyMatrix4(inverse.setPosition(0, 0, 0));
    const lifted = new Float32Array(values);
    for (let i = 0; i < times.length; i++) for (let a = 0; a < 3; a++) lifted[i * 3 + a] = values[i * 3 + a]! + local.getComponent(a) * lift[i]!;
    sampler.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(output.getBuffer()))
      .setOutput(doc.createAccessor().setType('VEC3').setArray(lifted).setBuffer(output.getBuffer())).setInterpolation('LINEAR');
  });
  return lift[lift.length - 1]!;
}
