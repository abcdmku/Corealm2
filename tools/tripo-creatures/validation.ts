import type { Animation, AnimationChannel, AnimationSampler, Document, Node, Primitive } from "@gltf-transform/core";
import { Box3, Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { restorePose, storedPose } from "../creature-motion/pose.js";

export const REQUIRED_CREATURE_STATES = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"] as const;
export type CreatureStateName = typeof REQUIRED_CREATURE_STATES[number];

export interface CreatureStateValidation {
  name: string;
  seconds: number;
  samples: number;
  maximumVertexMotion: number;
  maximumSpanRatio: number;
  minimumSpanRatio: number;
  loopSeam: number | null;
  edgeStretchP99: number;
  maximumEdgeStretch: number;
  stretchedEdgeFraction: number;
}

export interface CreatureValidation {
  passed: boolean;
  problems: string[];
  warnings: string[];
  states: CreatureStateValidation[];
  /** Numerical checks reject broken exports. They cannot approve anatomy, poses or movement. */
  requiresVisualReview: true;
}

const finite = (values: ArrayLike<number>) => Array.from(values).every(Number.isFinite);
const vector = new Vector3(), transformed = new Vector3(), combined = new Vector3();

/** glTF TRS interpolation, including cubic tangents and the last STEP key. */
function sampleChannel(channel: AnimationChannel, seconds: number): number[] {
  const sampler = channel.getSampler()!, times = sampler.getInput()!.getArray()!;
  const output = sampler.getOutput()!, values = output.getArray()!, width = output.getElementSize();
  const cubic = sampler.getInterpolation() === "CUBICSPLINE", stride = width * (cubic ? 3 : 1);
  const value = (key: number, part = cubic ? 1 : 0) => Array.from(values.slice(key * stride + part * width, key * stride + (part + 1) * width));
  let right = 0, high = times.length;
  while (right < high) {
    const middle = (right + high) >>> 1;
    if (times[middle]! <= seconds) right = middle + 1;
    else high = middle;
  }
  if (right === 0) return value(0);
  if (right === times.length) return value(times.length - 1);
  const left = right - 1, a = value(left), b = value(right);
  if (sampler.getInterpolation() === "STEP") return a;
  const span = times[right]! - times[left]!, t = (seconds - times[left]!) / span;
  if (cubic) {
    const outgoing = value(left, 2), incoming = value(right, 0), t2 = t * t, t3 = t2 * t;
    const result = a.map((v, i) => (2 * t3 - 3 * t2 + 1) * v + (t3 - 2 * t2 + t) * span * outgoing[i]!
      + (-2 * t3 + 3 * t2) * b[i]! + (t3 - t2) * span * incoming[i]!);
    return channel.getTargetPath() === "rotation" ? new Quaternion().fromArray(result).normalize().toArray() : result;
  }
  return channel.getTargetPath() === "rotation"
    ? new Quaternion().fromArray(a).slerp(new Quaternion().fromArray(b), t).toArray()
    : a.map((v, i) => v + (b[i]! - v) * t);
}

function validateSampler(channel: AnimationChannel, label: string, problems: string[]): void {
  const sampler: AnimationSampler | null = channel.getSampler();
  const input = sampler?.getInput(), output = sampler?.getOutput();
  if (!input?.getArray() || !output?.getArray()) { problems.push(`${label}: missing animation data`); return; }
  const times = input.getArray()!, values = output.getArray()!, path = channel.getTargetPath();
  if (input.getType() !== "SCALAR" || !times.length || !finite(times)
    || times.some((time, i) => time < 0 || (i > 0 && time <= times[i - 1]!))) problems.push(`${label}: invalid key times`);
  const multiplier = sampler!.getInterpolation() === "CUBICSPLINE" ? 3 : 1;
  const width = path === "rotation" ? 4 : 3;
  if (output.getElementSize() !== width || output.getCount() !== input.getCount() * multiplier || !finite(values)) {
    problems.push(`${label}: invalid animation values`); return;
  }
  if (path === "rotation") for (let key = 0; key < times.length; key++) {
    const offset = (key * multiplier + (multiplier === 3 ? 1 : 0)) * 4;
    const length = Math.hypot(...Array.from(values.slice(offset, offset + 4)));
    if (Math.abs(length - 1) > .01) { problems.push(`${label}: nonunit rotation key`); break; }
  }
}

interface MeshPart { node: Node; primitive: Primitive; count: number }

function evaluatedVertices(parts: MeshPart[]): { vertices: Float64Array; span: number } {
  const vertices = new Float64Array(parts.reduce((sum, part) => sum + part.count * 3, 0)), bounds = new Box3();
  const point: number[] = [], joints: number[] = [], weights: number[] = [];
  let offset = 0;
  for (const { node, primitive, count } of parts) {
    const skin = node.getSkin(), positions = primitive.getAttribute("POSITION")!;
    const indices = primitive.getAttribute("JOINTS_0"), influence = primitive.getAttribute("WEIGHTS_0");
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    const matrices = skin?.listJoints().map((joint, i) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(i, []))));
    for (let i = 0; i < count; i++) {
      vector.fromArray(positions.getElement(i, point));
      if (matrices) {
        indices!.getElement(i, joints); influence!.getElement(i, weights); combined.set(0, 0, 0);
        for (let slot = 0; slot < 4; slot++) if (weights[slot]! > 0) {
          combined.add(transformed.copy(vector).applyMatrix4(matrices[joints[slot]!]!).multiplyScalar(weights[slot]!));
        }
      } else combined.copy(vector).applyMatrix4(world);
      if (![combined.x, combined.y, combined.z].every(Number.isFinite)) throw new Error("nonfinite deformed vertex");
      combined.toArray(vertices, offset); offset += 3; bounds.expandByPoint(combined);
    }
  }
  return { vertices, span: bounds.getSize(new Vector3()).length() };
}

function bodyDisplacement(a: Float64Array, b: Float64Array, parts: MeshPart[]): number {
  let maximum = 0, offset = 0;
  for (const part of parts) {
    const end = offset + part.count * 3;
    // An accessory appearing or moving cannot stand in for animation of the creature's body.
    if (part.node.getSkin()) for (let i = offset; i < end; i += 3) {
      maximum = Math.max(maximum, Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!));
    }
    offset = end;
  }
  return maximum;
}

interface Edge { a: number; b: number; length: number }
const edgeLength = (vertices: Float64Array, a: number, b: number) => Math.hypot(
  vertices[a]! - vertices[b]!, vertices[a + 1]! - vertices[b + 1]!, vertices[a + 2]! - vertices[b + 2]!);

/** Use actual triangle adjacency. Nearby vertices on separate limbs are not connected edges. */
function deformationEdges(parts: MeshPart[], baseline: Float64Array, span: number): Edge[] {
  const edges: Edge[] = [];
  let offset = 0;
  for (const { primitive, count } of parts) {
    if (primitive.getMode() !== 4) { offset += count * 3; continue; }
    const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({ length: count }, (_, i) => i);
    const seen = new Set<string>();
    for (let i = 0; i + 2 < indices.length; i += 3) for (let side = 0; side < 3; side++) {
      const a = offset + indices[i + side]! * 3, b = offset + indices[i + (side + 1) % 3]! * 3;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const length = edgeLength(baseline, a, b);
      // UV seams and tiny degenerate faces otherwise magnify numerical noise.
      if (length > span * .002) edges.push({ a, b, length });
    }
    offset += count * 3;
  }
  return edges;
}

/** Select one quantile without sorting every edge for every animation frame. */
function percentile99(values: Float64Array): number {
  if (!values.length) return 1;
  const rank = Math.min(values.length - 1, Math.floor(values.length * .99));
  let left = 0, right = values.length - 1;
  while (left < right) {
    const pivot = values[(left + right) >>> 1]!;
    let i = left, j = right;
    while (i <= j) {
      while (values[i]! < pivot) i++;
      while (values[j]! > pivot) j--;
      if (i <= j) { const value = values[i]!; values[i++] = values[j]!; values[j--] = value; }
    }
    if (rank <= j) right = j;
    else if (rank >= i) left = i;
    else break;
  }
  return values[rank]!;
}

/** Interior extrema of a glTF Hermite component, in the interval's normalized time. */
function cubicExtrema(a: number, b: number, outgoing: number, incoming: number, seconds: number): number[] {
  const cubic = 2 * a - 2 * b + seconds * (outgoing + incoming);
  const quadratic = -3 * a + 3 * b - seconds * (2 * outgoing + incoming);
  const linear = seconds * outgoing;
  // Normalize the derivative coefficients before solving, including nearly linear segments.
  const magnitude = Math.max(Math.abs(3 * cubic), Math.abs(2 * quadratic), Math.abs(linear));
  if (!magnitude) return [];
  const x = 3 * cubic / magnitude, y = 2 * quadratic / magnitude, z = linear / magnitude;
  if (Math.abs(x) < 1e-12) return Math.abs(y) < 1e-12 ? [] : [-z / y].filter(t => t > 0 && t < 1);
  const discriminant = y * y - 4 * x * z;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-y - root) / (2 * x), (-y + root) / (2 * x)].filter(t => t > 0 && t < 1);
}

/** Keep dense IK/contact bakes bounded while retaining key and Hermite interpolation extrema. */
function sampleTimes(clip: Animation, seconds: number, bodySpan: number): number[] {
  const keys = [...new Set([0, ...clip.listSamplers().flatMap(sampler => Array.from(sampler.getInput()!.getArray()!))])].sort((a, b) => a - b);
  const all = [...new Set([...keys, ...keys.slice(1).map((time, i) => (time + keys[i]!) / 2),
    ...Array.from({ length: 9 }, (_, i) => i * seconds / 8)])].sort((a, b) => a - b);
  if (all.length <= 121 && !clip.listSamplers().some(sampler => sampler.getInterpolation() === "CUBICSPLINE")) return all;
  const extrema = new Map<number, { score: number; midpoint?: number }>();
  const candidate = (time: number, score: number, midpoint?: number) => {
    const prior = extrema.get(time);
    extrema.set(time, { score: (prior?.score ?? 0) + score, midpoint: midpoint ?? prior?.midpoint });
  };
  for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler()!, input = sampler.getInput()!.getArray()!, output = sampler.getOutput()!;
    const values = output.getArray()!, width = output.getElementSize(), cubic = sampler.getInterpolation() === "CUBICSPLINE";
    const value = (key: number, component: number) => values[(key * (cubic ? 3 : 1) + (cubic ? 1 : 0)) * width + component]!;
    for (let component = 0; component < width; component++) {
      let minimum = 0, maximum = 0;
      for (let key = 1; key < input.length; key++) {
        if (value(key, component) < value(minimum, component)) minimum = key;
        if (value(key, component) > value(maximum, component)) maximum = key;
      }
      for (const key of value(minimum, component) === value(maximum, component) ? [] : [minimum, maximum]) {
        const v = Math.abs(value(key, component)), path = channel.getTargetPath();
        const score = path === "scale" ? Math.max(v, 1 / Math.max(v, 1e-6))
          : path === "translation" ? (value(maximum, component) - value(minimum, component)) / bodySpan : 1;
        candidate(input[key]!, score);
      }
      if (!cubic) continue;
      for (let left = 0; left + 1 < input.length; left++) {
        const a = value(left, component), b = value(left + 1, component), span = input[left + 1]! - input[left]!;
        const outgoing = values[(left * 3 + 2) * width + component]!, incoming = values[((left + 1) * 3) * width + component]!;
        for (const phase of cubicExtrema(a, b, outgoing, incoming, span)) {
          const time = input[left]! + span * phase, sampled = sampleChannel(channel, time);
          const expected = a + (b - a) * phase, path = channel.getTargetPath();
          // Rank actual interpolated deviation, not tangent magnitude. Very short intervals
          // scale tangents by their duration; quaternion channels normalize the result.
          const deviation = Math.abs(sampled[component]! - expected);
          if (deviation < 1e-9) continue;
          const scale = path === "translation" ? bodySpan
            : path === "scale" ? Math.max(Math.abs(a), Math.abs(b), 1e-6) : 1;
          candidate(time, deviation / scale, (input[left]! + input[left + 1]!) / 2);
        }
      }
    }
  }
  const selected = new Set(all.length <= 61 ? all : Array.from({ length: 61 }, (_, i) => i * seconds / 60));
  for (const [time, { midpoint }] of [...extrema].sort((a, b) => b[1].score - a[1].score || a[0] - b[0])) {
    const additions = [...new Set([time, ...(midpoint === undefined ? [] : [midpoint])])].filter(value => !selected.has(value));
    if (selected.size + additions.length > 121) continue;
    additions.forEach(value => selected.add(value));
    if (selected.size === 121) break;
  }
  return [...selected].sort((a, b) => a - b);
}

/** Equal endpoints do not repair a loop that snaps back to its first pose in one frame. */
function validateLoopBoundaryVelocity(clip: Animation, seconds: number, bodySpan: number, problems: string[]): void {
  if (!/^(Idle|Walk|Run)$/.test(clip.getName())) return;
  const a = new Quaternion(), b = new Quaternion(), translation = new Vector3();
  for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler()!, times = sampler.getInput()!.getArray()!;
    // Two or three keys cannot establish a separate normal cadence for comparison.
    if (sampler.getInterpolation() !== "LINEAR" || times.length < 4) continue;
    const output = sampler.getOutput()!, values = output.getArray()!, width = output.getElementSize(), path = channel.getTargetPath();
    const parent = channel.getTargetNode()!.getParentNode();
    const parentBasis = new Matrix3().setFromMatrix4(parent ? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4());
    const threshold = path === "rotation" ? .2 : path === "translation" ? bodySpan * .03 : .1;
    const intervals: { delta: number; velocity: number }[] = [];
    for (let key = 0; key + 1 < times.length; key++) {
      const left = key * width, right = (key + 1) * width;
      let delta: number;
      if (path === "rotation") delta = a.fromArray(values, left).normalize().angleTo(b.fromArray(values, right).normalize());
      else if (path === "translation") delta = translation.set(values[right]! - values[left]!, values[right + 1]! - values[left + 1]!,
        values[right + 2]! - values[left + 2]!).applyMatrix3(parentBasis).length();
      else delta = Math.max(...[0, 1, 2].map(component => Math.abs(values[right + component]! - values[left + component]!)));
      intervals.push({ delta, velocity: delta / (times[key + 1]! - times[key]!) });
    }
    for (const [index, boundary] of [[0, "start"], [intervals.length - 1, "end"]] as const) {
      // A short channel that holds its last key long before the clip ends has no final seam interval.
      if (boundary === "start" ? times[0]! > 1e-6 : times[times.length - 1]! < seconds - 1e-6) continue;
      const interval = intervals[index]!;
      // Include the opposite boundary in the normal rate. Matched fast excursions on both
      // sides are not an isolated copied-frame correction, and rapid wing cycles stay valid.
      const normal = Math.max(...intervals.filter((_, i) => i !== index).map(other => other.velocity));
      if (interval.delta > threshold && interval.velocity > normal * 4) {
        problems.push(`${clip.getName()}/${channel.getTargetNode()!.getName()}/${path}: isolated ${boundary}-of-loop jump`);
      }
    }
  }
}

/**
 * Reject malformed imports before candidate export. All vertices are sampled in every clip;
 * relaxed limbs, correct pivots, weights, facing and believable motion still require devdocs.
 * The document's default pose is restored even when sampling fails.
 */
export function validateCreatureDocument(doc: Document, requiredStates: readonly CreatureStateName[] = REQUIRED_CREATURE_STATES): CreatureValidation {
  const problems: string[] = [], warnings: string[] = [], states: CreatureStateValidation[] = [];
  const result = (): CreatureValidation => ({ passed: problems.length === 0, problems: [...new Set(problems)], warnings,
    states, requiresVisualReview: true });
  const root = doc.getRoot(), nodes = root.listNodes(), parts: MeshPart[] = [], clips = root.listAnimations();
  // GLTFLoader publishes the selected scene, not every object retained in the document.
  // An animated orphan or a mesh in another scene cannot prove that the drawn body moves.
  const scene = root.getDefaultScene() ?? root.listScenes()[0], reachable = new Set<Node>();
  scene?.traverse(node => reachable.add(node));
  if (!scene) problems.push("No default creature scene");
  if (![...reachable].some(node => node.getMesh() && node.getSkin())) problems.push("No creature skin");
  const joints = new Set(root.listSkins().flatMap(skin => skin.listJoints())), hiddenRigidNodes = new Set<Node>();
  for (const node of reachable) {
    if (!node.getScale().some(scale => scale === 0)) continue;
    const subtree: Node[] = []; node.traverse(child => subtree.push(child));
    // Studio bow clips hide the rigid nocked arrow with explicit zero scale. A skeleton
    // joint or skinned descendant makes this an invalid rig transform, not visibility.
    if (subtree.every(child => !child.getSkin() && !joints.has(child))) subtree.forEach(child => hiddenRigidNodes.add(child));
  }
  if (!requiredStates.includes('Idle') || new Set(requiredStates).size !== requiredStates.length) problems.push('Invalid creature state requirements');
  for (const name of requiredStates) if (!clips.some(clip => clip.getName() === name)) problems.push(`Missing usable ${name} clip`);
  if (new Set(clips.map(clip => clip.getName())).size !== clips.length) problems.push("Duplicate clip names");
  for (const node of nodes) {
    if (!reachable.has(node)) continue;
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    if (!finite(matrix.elements) || (Math.abs(matrix.determinant()) < 1e-12 && !hiddenRigidNodes.has(node))) problems.push(`${node.getName()}: invalid default transform`);
    if (!finite(node.getRotation()) || Math.abs(Math.hypot(...node.getRotation()) - 1) > .01) problems.push(`${node.getName()}: invalid default rotation`);
    const skin = node.getSkin(), bones = skin?.listJoints(), inverse = skin?.getInverseBindMatrices();
    if (skin && (!bones!.length || !inverse || inverse.getType() !== "MAT4" || inverse.getCount() !== bones!.length)) {
      problems.push(`${node.getName()}: inverse-bind count mismatch`);
    } else if (skin) for (let i = 0; i < bones!.length; i++) {
      if (!reachable.has(bones![i]!)) problems.push(`${node.getName()}: skin joint ${bones![i]!.getName()} is outside the default scene`);
      const bind = new Matrix4().fromArray(inverse!.getElement(i, []));
      if (!finite(bind.elements) || Math.abs(bind.determinant()) < 1e-12) problems.push(`${node.getName()}: invalid inverse bind ${i}`);
    }
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute("POSITION"), count = positions?.getCount() ?? 0;
      if (!count || positions?.getType() !== "VEC3" || !finite(positions.getArray()!)) { problems.push(`${node.getName()}: invalid positions`); continue; }
      parts.push({ node, primitive, count });
      if (primitive.listTargets().length) problems.push(`${node.getName()}: morph deformation needs a production sampler before import`);
      const triangles = primitive.getIndices()?.getArray();
      if (triangles?.some(index => !Number.isInteger(index) || index < 0 || index >= count)) problems.push(`${node.getName()}: invalid geometry indices`);
      if (!skin) continue;
      const indices = primitive.getAttribute("JOINTS_0"), weights = primitive.getAttribute("WEIGHTS_0");
      if (primitive.getAttribute("JOINTS_1") || primitive.getAttribute("WEIGHTS_1")) problems.push(`${node.getName()}: more than four skin influences need a production sampler before import`);
      if (!indices || !weights || indices.getType() !== "VEC4" || weights.getType() !== "VEC4" || indices.getCount() !== count || weights.getCount() !== count) {
        problems.push(`${node.getName()}: missing or mismatched skin attributes`); continue;
      }
      const mass = new Map<number, number>();
      for (let vertex = 0; vertex < count; vertex++) {
        const js = indices.getElement(vertex, []), ws = weights.getElement(vertex, []);
        if (js.some(j => !Number.isInteger(j) || j < 0 || j >= bones!.length) || !finite(ws) || ws.some(w => w < 0)
          || Math.abs(ws.reduce((sum, w) => sum + w, 0) - 1) > .002) { problems.push(`${node.getName()}: invalid skin vertex ${vertex}`); break; }
        js.forEach((joint, slot) => mass.set(joint, (mass.get(joint) ?? 0) + ws[slot]!));
      }
      if (bones!.length > 1 && Math.max(0, ...mass.values()) / count > .98) warnings.push(`${node.getName()}: nearly rigid single-joint skin; inspect articulation in devdocs`);
    }
  }
  if (!parts.length) problems.push("Creature has no vertices");
  for (const clip of clips) {
    const targets = new Set<string>();
    if (!clip.listChannels().length) problems.push(`${clip.getName()}: no animation channels`);
    for (const channel of clip.listChannels()) {
      const node = channel.getTargetNode(), path = channel.getTargetPath(), label = `${clip.getName()}/${node?.getName() ?? "missing"}/${path}`;
      if (!node || !nodes.includes(node)) problems.push(`${label}: missing target`);
      else if (!reachable.has(node)) problems.push(`${label}: animation target is outside the default scene`);
      if (path === null || !["translation", "rotation", "scale"].includes(path)) { problems.push(`${label}: unsupported deformation channel`); continue; }
      const target = `${nodes.indexOf(node!)}:${path}`;
      if (targets.has(target)) problems.push(`${label}: duplicate target channel`);
      targets.add(target); validateSampler(channel, label, problems);
    }
  }
  if (problems.length) return result();
  const rest = storedPose(doc);
  try {
    const baseline = evaluatedVertices(parts);
    if (!(baseline.span > 1e-9)) { problems.push("Collapsed default geometry"); return result(); }
    const edges = deformationEdges(parts, baseline.vertices, baseline.span), ratios = new Float64Array(edges.length);
    for (const clip of clips) {
      const seconds = Math.max(...clip.listSamplers().map(sampler => sampler.getInput()!.getArray()!.at(-1)!));
      if (!(seconds > 0)) { problems.push(`${clip.getName()}: zero duration`); continue; }
      restorePose(rest);
      validateLoopBoundaryVelocity(clip, seconds, baseline.span, problems);
      const times = sampleTimes(clip, seconds, baseline.span);
      const report: CreatureStateValidation = { name: clip.getName(), seconds, samples: times.length, maximumVertexMotion: 0,
        maximumSpanRatio: 0, minimumSpanRatio: Infinity, loopSeam: null, edgeStretchP99: 1, maximumEdgeStretch: 1, stretchedEdgeFraction: 0 };
      let first: Float64Array | undefined;
      for (let frame = 0; frame < report.samples; frame++) {
        restorePose(rest);
        for (const channel of clip.listChannels()) {
          const node = channel.getTargetNode()!, values = sampleChannel(channel, times[frame]!);
          if (channel.getTargetPath() === "rotation") node.setRotation(values as [number, number, number, number]);
          else if (channel.getTargetPath() === "translation") node.setTranslation(values as [number, number, number]);
          else node.setScale(values as [number, number, number]);
        }
        const pose = evaluatedVertices(parts), ratio = pose.span / baseline.span;
        report.maximumSpanRatio = Math.max(report.maximumSpanRatio, ratio); report.minimumSpanRatio = Math.min(report.minimumSpanRatio, ratio);
        first ??= pose.vertices;
        report.maximumVertexMotion = Math.max(report.maximumVertexMotion, bodyDisplacement(first, pose.vertices, parts));
        if (frame === report.samples - 1 && /^(Idle|Walk|Run)$/.test(clip.getName())) report.loopSeam = bodyDisplacement(first, pose.vertices, parts) / baseline.span;
        let stretched = 0;
        edges.forEach((edge, i) => {
          const stretch = edgeLength(pose.vertices, edge.a, edge.b) / edge.length;
          ratios[i] = stretch;
          report.maximumEdgeStretch = Math.max(report.maximumEdgeStretch, stretch);
          if (stretch > 3) stretched++;
        });
        report.edgeStretchP99 = Math.max(report.edgeStretchP99, percentile99(ratios));
        report.stretchedEdgeFraction = Math.max(report.stretchedEdgeFraction, stretched / Math.max(1, edges.length));
      }
      if (report.maximumVertexMotion < baseline.span * 1e-6) problems.push(`${clip.getName()}: no visible vertex motion`);
      if (report.maximumSpanRatio > 4) problems.push(`${clip.getName()}: deformed span exceeds four times the default`);
      if (report.minimumSpanRatio < .05) problems.push(`${clip.getName()}: deformed geometry collapses`);
      if (report.loopSeam !== null && report.loopSeam > .15) problems.push(`${clip.getName()}: loop endpoint jumps more than 15% of the body span`);
      if (report.edgeStretchP99 > 3 && report.stretchedEdgeFraction >= .01) problems.push(`${clip.getName()}: connected skin edges stretch over 3x across at least 1% of the mesh`);
      else if (report.maximumEdgeStretch > 8) warnings.push(`${clip.getName()}: isolated connected edges stretch over 8x; inspect skin weights in devdocs`);
      states.push(report);
    }
  } catch (error) { problems.push(`Deformation sampling failed: ${error instanceof Error ? error.message : String(error)}`); }
  finally { restorePose(rest); }
  return result();
}
