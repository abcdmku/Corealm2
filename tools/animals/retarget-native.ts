/**
 * Rest-relative retarget of one Animal pack deluxe take onto another body built from the same
 * author's rig template (Ibex -> Deer, Crocodile -> FireSalamander, ...).
 *
 * World-space rotation deltas: for every mapped joint, the donor's rotation away from its own bind
 * pose (in skeleton space) is applied to the target's bind pose, and the target local rotation is
 * recovered under the target's animated parent. That is independent of how each rig orients its
 * local joint axes. Only the skeleton root and its direct children receive translation (hip bob and
 * travel, scaled by the ratio of pelvis heights); every other joint keeps its bind translation, so
 * no bone changes length. No scale tracks. Joints without a donor stay at bind pose.
 */
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Quaternion, Vector3 } from "three";
import type { ExtractedSourceClip, SourceTrack } from "../creature-motion/source-clips.js";

/** Donor joints map to target joints by swapping the rig prefix, plus explicit extra pairs. */
export interface RetargetMap { from: string; to: string; extra?: Record<string, string>; skip?: RegExp }

const SAMPLE_FPS = 30;

interface Rest { name: string; parent: string | null; t: Vector3; q: Quaternion }

function restOf(doc: Document): { byName: Map<string, Rest>; order: string[]; nodes: Map<string, GltfNode> } {
  const joints = new Set(doc.getRoot().listSkins().flatMap((skin) => skin.listJoints()));
  const parents = new Map<GltfNode, GltfNode>();
  for (const node of doc.getRoot().listNodes()) for (const child of node.listChildren()) parents.set(child, node);
  const byName = new Map<string, Rest>();
  const nodes = new Map<string, GltfNode>();
  const order: string[] = [];
  const roots = [...joints].filter((joint) => {
    for (let at = parents.get(joint); at; at = parents.get(at)) if (joints.has(at)) return false;
    return true;
  });
  // Depth-first from the skeleton roots; the first node of a repeated name wins (the deer's horn
  // skin nests a same-named copy under its neck/head/ear joints, which follows its parent).
  const visit = (node: GltfNode, parent: string | null) => {
    const name = node.getName();
    if (!byName.has(name)) {
      byName.set(name, { name, parent, t: new Vector3(...node.getTranslation()), q: new Quaternion(...node.getRotation()) });
      nodes.set(name, node);
      order.push(name);
    }
    for (const child of node.listChildren()) visit(child, name);
  };
  for (const root of roots) visit(root, null);
  return { byName, order, nodes };
}

function sampler(track: SourceTrack) {
  const size = track.values.length / track.times.length;
  return (time: number): number[] => {
    const times = track.times;
    if (time <= times[0]!) return track.values.slice(0, size);
    const last = times.length - 1;
    if (time >= times[last]!) return track.values.slice(last * size, last * size + size);
    let i = 1;
    while (times[i]! < time) i++;
    const f = (time - times[i - 1]!) / (times[i]! - times[i - 1]!);
    const a = track.values.slice((i - 1) * size, i * size), b = track.values.slice(i * size, (i + 1) * size);
    if (size === 4) {
      const q = new Quaternion(...(a as [number, number, number, number])).slerp(new Quaternion(...(b as [number, number, number, number])), f);
      return [q.x, q.y, q.z, q.w];
    }
    return a.map((value, c) => value + (b[c]! - value) * f);
  };
}

const docCache = new Map<string, Promise<Document>>();
export function readDonor(file: string): Promise<Document> {
  let doc = docCache.get(file);
  if (!doc) { doc = new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file); docCache.set(file, doc); }
  return doc;
}

export function retargetClip(clip: ExtractedSourceClip, map: RetargetMap, donorDoc: Document, targetDoc: Document): ExtractedSourceClip {
  const donor = restOf(donorDoc), target = restOf(targetDoc);
  const rotation = new Map<string, (time: number) => number[]>();
  const translation = new Map<string, (time: number) => number[]>();
  for (const track of clip.tracks) {
    const [name, property] = [track.name.slice(0, track.name.lastIndexOf(".")), track.name.slice(track.name.lastIndexOf(".") + 1)];
    if (property === "quaternion") rotation.set(name, sampler(track));
    if (property === "position") translation.set(name, sampler(track));
  }
  const inverse = new Map<string, string>();
  for (const name of donor.order) {
    if (map.skip?.test(name) || !name.startsWith(map.from)) continue;
    const to = map.to + name.slice(map.from.length);
    if (target.byName.has(to)) inverse.set(to, name);
  }
  for (const [from, to] of Object.entries(map.extra ?? {})) inverse.set(to, from);
  const donorRoot = donor.order[0]!, targetRoot = target.order[0]!;
  const pelvis = (rest: ReturnType<typeof restOf>, root: string) =>
    rest.order.filter((name) => rest.byName.get(name)!.parent === root);
  const donorHeight = Math.max(...[donorRoot, ...pelvis(donor, donorRoot)].map((name) => Math.abs(donor.byName.get(name)!.t.y)));
  const targetHeight = Math.max(...[targetRoot, ...pelvis(target, targetRoot)].map((name) => Math.abs(target.byName.get(name)!.t.y)));
  const heightScale = targetHeight / donorHeight;
  const translated = new Set([targetRoot, ...pelvis(target, targetRoot)]);

  // Skeleton-space bind rotations.
  const worldRest = (rest: ReturnType<typeof restOf>) => {
    const out = new Map<string, Quaternion>();
    for (const name of rest.order) {
      const entry = rest.byName.get(name)!;
      out.set(name, entry.parent ? out.get(entry.parent)!.clone().multiply(entry.q) : entry.q.clone());
    }
    return out;
  };
  const donorBind = worldRest(donor), targetBind = worldRest(target);

  const frames = Math.round(clip.duration * SAMPLE_FPS);
  const times = Array.from({ length: frames + 1 }, (_, i) => Math.min(clip.duration, i / SAMPLE_FPS));
  const outRotation = new Map<string, number[]>(), outTranslation = new Map<string, number[]>();
  for (const time of times) {
    const donorWorld = new Map<string, Quaternion>();
    for (const name of donor.order) {
      const entry = donor.byName.get(name)!;
      const local = rotation.has(name) ? new Quaternion(...(rotation.get(name)!(time) as [number, number, number, number])) : entry.q.clone();
      donorWorld.set(name, entry.parent ? donorWorld.get(entry.parent)!.clone().multiply(local) : local);
    }
    const targetWorld = new Map<string, Quaternion>();
    for (const name of target.order) {
      const entry = target.byName.get(name)!;
      const source = inverse.get(name);
      let world: Quaternion;
      if (source && donorWorld.has(source)) {
        const delta = donorWorld.get(source)!.clone().multiply(donorBind.get(source)!.clone().invert());
        world = delta.multiply(targetBind.get(name)!);
      } else {
        world = entry.parent ? targetWorld.get(entry.parent)!.clone().multiply(entry.q) : entry.q.clone();
      }
      targetWorld.set(name, world);
      if (!source || !donorWorld.has(source)) continue;
      const local = entry.parent ? targetWorld.get(entry.parent)!.clone().invert().multiply(world) : world.clone();
      const list = outRotation.get(name) ?? [];
      const previous = list.length ? new Quaternion(...(list.slice(-4) as [number, number, number, number])) : null;
      if (previous && previous.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      list.push(local.x, local.y, local.z, local.w);
      outRotation.set(name, list);
      if (translated.has(name) && translation.has(source)) {
        const donorRest = donor.byName.get(source)!.t;
        const value = new Vector3(...(translation.get(source)!(time) as [number, number, number]));
        const moved = value.sub(donorRest).multiplyScalar(heightScale).add(entry.t);
        outTranslation.set(name, [...(outTranslation.get(name) ?? []), moved.x, moved.y, moved.z]);
      }
    }
  }

  const tracks: SourceTrack[] = [];
  const targets: ExtractedSourceClip["targets"] = [];
  let id = 1;
  for (const name of target.order) {
    if (!outRotation.has(name)) continue;
    const fbxId = id++;
    const entry = target.byName.get(name)!;
    const chain: string[] = [];
    for (let at = entry.parent; at; at = target.byName.get(at)!.parent) chain.unshift(at);
    targets.push({ name, type: "Bone", fbxId, parentChain: chain, translation: entry.t.toArray(), rotation: entry.q.toArray() as number[], scale: [1, 1, 1] });
    tracks.push({ name: `${name}.quaternion`, sourceNodeId: fbxId, type: "quaternion", interpolation: 2301, times, values: outRotation.get(name)! });
    if (outTranslation.has(name)) tracks.push({ name: `${name}.position`, sourceNodeId: fbxId, type: "vector", interpolation: 2301, times, values: outTranslation.get(name)! });
  }
  return { ...clip, tracks, targets };
}
