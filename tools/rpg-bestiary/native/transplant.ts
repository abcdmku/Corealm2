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

export interface NativeState { as: string; source: NativeSource; clip: string }
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
    const tracks = state.source.clips.get(state.clip);
    if (!tracks) throw new Error(`${state.source.file}: no take ${state.clip}`);
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
    report.push({ name: state.as, source: `${state.clip} @ ${state.source.file}`, seconds, channels, translationScale });
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
