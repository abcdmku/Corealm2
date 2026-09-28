import type { Accessor, Document, Node } from "@gltf-transform/core";
import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from "../creature-motion/pose.js";
import { deformedBounds } from "../creature-motion/validate-deformation.js";

const mapping: Record<string, string> = {
  Hips: "pelvis", Spine: "spine_01", Spine1: "spine_02", Spine2: "spine_03", Neck: "neck_01", Head: "Head",
};
for (const [side, suffix] of [["Left", "l"], ["Right", "r"]]) {
  for (const [target, source] of [["Shoulder", "clavicle"], ["Arm", "upperarm"], ["ForeArm", "lowerarm"],
    ["Hand", "hand"], ["UpLeg", "thigh"], ["Leg", "calf"], ["Foot", "foot"], ["ToeBase", "ball"]]) {
    mapping[`${side}${target}`] = `${source}_${suffix}`;
  }
  for (const finger of ["Index", "Middle", "Ring", "Pinky", "Thumb"]) for (let segment = 1; segment <= 3; segment++) {
    mapping[`${side}Hand${finger}${segment}`] = `${finger.toLowerCase()}_0${segment}_${suffix}`;
  }
}
const directionChildren: Record<string, string> = { Hips: "Spine", Spine: "Spine1", Spine1: "Spine2", Spine2: "Neck", Neck: "Head" };
for (const side of ["Left", "Right"]) {
  for (const [bone, child] of [["Shoulder", "Arm"], ["Arm", "ForeArm"], ["ForeArm", "Hand"],
    ["Hand", "HandMiddle1"], ["UpLeg", "Leg"], ["Leg", "Foot"], ["Foot", "ToeBase"]]) directionChildren[side + bone] = side + child;
}
const position = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
const rotation = (node: Node) => {
  const q = new Quaternion();
  new Matrix4().fromArray(node.getWorldMatrix()).decompose(new Vector3(), q, new Vector3());
  return q.normalize();
};

export interface CreatureMotionProfile {
  /** Exact, unique node names. No name guessing or anatomical skin replacement occurs. */
  mapping: Record<string, string>;
  directionChildren?: Record<string, string>;
  sourceDirectionChildren?: Record<string, string>;
  /** Verified rotation from donor world axes to target world axes. Both worlds are Y-up. */
  sourceToTargetRotation: [number, number, number, number];
  root: { target: string; source?: string; translationScale: number; horizontal?: "preserve" | "in-place" };
  clips: Record<string, { source: string; loop?: boolean; duration?: number; holdLastSeconds?: number;
    /** Bound support correction for a one-shot in world metres/second; donor joint motion stays intact. */
    groundingMaxSpeedMps?: number }>;
  replaceAnimations?: boolean;
  samplesPerSecond?: number;
  grounding?: { floor: number; maxCorrection?: number };
}

/** Smallest speed-limited curve above every required floor correction, so smoothing never lowers a sampled pose through the floor. */
export function limitGroundCorrectionSpeed(times: readonly number[], required: readonly number[], maxSpeedMps: number): number[] {
  if (!(Number.isFinite(maxSpeedMps) && maxSpeedMps > 0) || times.length !== required.length || !times.length
    || !times.every((time, index) => Number.isFinite(time) && (!index || time > times[index - 1]!)) || !required.every(Number.isFinite)) {
    throw new Error('Invalid grounding speed envelope');
  }
  const values = [...required];
  for (let i = 1; i < values.length; i++) values[i] = Math.max(values[i]!, values[i - 1]! - maxSpeedMps * (times[i]! - times[i - 1]!));
  for (let i = values.length - 2; i >= 0; i--) values[i] = Math.max(values[i]!, values[i + 1]! - maxSpeedMps * (times[i + 1]! - times[i]!));
  return values;
}

/** Refine support against the final interpolated pose. The callback must exclude any existing floor correction. */
export function sampleGroundSupport(times: readonly number[], requiredAt: (time: number) => number): { times: number[]; required: number[] } {
  if (times.length < 2 || !times.every((time, index) => Number.isFinite(time) && (!index || time > times[index - 1]!))) throw new Error('Invalid support sample times');
  const cache = new Map<number, number>(), refined: number[] = [];
  const read = (time: number): number => {
    const found = cache.get(time); if (found !== undefined) return found;
    const value = requiredAt(time); if (!Number.isFinite(value)) throw new Error('Nonfinite floor correction');
    cache.set(time, value); return value;
  };
  const refine = (left: number, right: number, depth: number): void => {
    const middle = (left + right) / 2, a = read(left), b = read(right);
    // A limb crossing an inflection can have its midpoint on the chord but dip elsewhere.
    const dips = [.25, .5, .75].some(alpha => read(left + (right - left) * alpha) > a * (1 - alpha) + b * alpha + .00025);
    if (depth < 10 && dips) { refine(left, middle, depth + 1); refine(middle, right, depth + 1); }
    else refined.push(left);
  };
  for (let i = 1; i < times.length; i++) for (let part = 0; part < 4; part++) {
    const start = times[i - 1]!, width = times[i]! - start;
    refine(start + width * part / 4, start + width * (part + 1) / 4, 0);
  }
  refined.push(times[times.length - 1]!);
  return { times: refined, required: refined.map(time => read(time) + (time > times[0]! && time < times[times.length - 1]! ? .0005 : 0)) };
}

/**
 * Transfer compatible anatomy through world space, then reconstruct target-local tracks.
 * The caller supplies verified rest poses and a facing basis. Source and target bind poses
 * need not have equal arm angles, bone rolls, proportions, parent transforms, or node names.
 * Geometry, skin weights, inverse binds, materials, and the serialized target rest stay intact.
 */
export function retargetCreatureMotion(doc: Document, donor: Document, profile: CreatureMotionProfile) {
  const reachableNodes = (document: Document) => {
    const nodes = new Set<Node>();
    const visit = (node: Node) => { if (nodes.has(node)) return; nodes.add(node); for (const child of node.listChildren()) visit(child); };
    for (const scene of document.getRoot().listScenes()) for (const child of scene.listChildren()) visit(child);
    return nodes;
  };
  const uniqueNodes = (document: Document, label: string) => {
    const result = new Map<string, Node>();
    const duplicates = new Set<string>();
    for (const node of reachableNodes(document)) {
      if (result.has(node.getName())) duplicates.add(node.getName());
      result.set(node.getName(), node);
    }
    return (name: string) => {
      if (duplicates.has(name)) throw new Error(`Ambiguous ${label} node ${name}`);
      const node = result.get(name);
      if (!node) throw new Error(`Missing ${label} node ${name}`);
      return node;
    };
  };
  if (doc === donor) throw new Error("Source and target documents must differ");
  const target = uniqueNodes(doc, "target"), source = uniqueNodes(donor, "source");
  const fps = profile.samplesPerSecond ?? 30;
  if (!(fps > 0 && fps <= 240 && Number.isFinite(fps))) throw new Error("Invalid motion sample rate");
  if (!(profile.root.translationScale > 0 && Number.isFinite(profile.root.translationScale))) throw new Error("Invalid root translation scale");
  const basis = new Quaternion().fromArray(profile.sourceToTargetRotation);
  if (!profile.sourceToTargetRotation.every(Number.isFinite) || Math.abs(basis.length() - 1) > 1e-5) throw new Error("Source-to-target basis must be a normalized quaternion");
  if (new Vector3(0, 1, 0).applyQuaternion(basis).distanceTo(new Vector3(0, 1, 0)) > 1e-5) throw new Error("Source-to-target basis must preserve the verified Y-up axis");
  if (profile.grounding && (!Number.isFinite(profile.grounding.floor) || (profile.grounding.maxCorrection !== undefined && !(profile.grounding.maxCorrection >= 0)))) throw new Error("Invalid motion grounding policy");
  if (doc.getRoot().listAnimations().length && !profile.replaceAnimations) throw new Error("Replacing target animations requires replaceAnimations");
  const targetRoot = target(profile.root.target), sourceRoot = source(profile.root.source ?? profile.mapping[profile.root.target]!);
  if (!profile.mapping[profile.root.target]) throw new Error("The target motion root must be mapped");
  const targetRootBind = position(targetRoot), sourceRootBind = position(sourceRoot);
  const assertRotationSpace = (node: Node) => {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix()), elements = matrix.elements;
    const axes = [new Vector3(elements[0], elements[1], elements[2]), new Vector3(elements[4], elements[5], elements[6]), new Vector3(elements[8], elements[9], elements[10])];
    const lengths = axes.map(axis => axis.length()), largest = Math.max(...lengths), smallest = Math.min(...lengths);
    if (!(smallest > 1e-10) || largest - smallest > largest * 1e-5 || matrix.determinant() <= 0) throw new Error(`Motion node ${node.getName()} has nonuniform, reflected, or singular world scale; normalize its rig basis before retargeting`);
    axes.forEach(axis => axis.normalize());
    if (Math.max(Math.abs(axes[0]!.dot(axes[1]!)), Math.abs(axes[0]!.dot(axes[2]!)), Math.abs(axes[1]!.dot(axes[2]!))) > 1e-5) throw new Error(`Motion node ${node.getName()} has a sheared world transform; normalize its rig basis before retargeting`);
  };
  const targetRotation = (node: Node) => { assertRotationSpace(node); return rotation(node); };
  const sourceRotation = (node: Node) => {
    const affine = new Matrix3().setFromMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
    const largest = Math.max(...affine.elements.map(Math.abs));
    if (!affine.elements.every(Number.isFinite) || !(largest > 0)) throw new Error(`Donor node ${node.getName()} has a nonfinite or singular world transform`);
    // Uniform normalization improves convergence for studio rigs authored in centimetres.
    // The polar factor is unchanged by a positive scalar, unlike quaternion decomposition
    // of a sheared matrix, which does not produce a valid bone orientation.
    affine.multiplyScalar(1 / largest);
    if (!(affine.determinant() > 1e-12)) throw new Error(`Donor node ${node.getName()} has a reflected or singular world transform`);
    let polar = affine;
    for (let iteration = 0; iteration < 32; iteration++) {
      const inverseTranspose = polar.clone().invert().transpose(), next = polar.clone();
      let error = 0;
      for (let i = 0; i < 9; i++) {
        next.elements[i] = .5 * (polar.elements[i]! + inverseTranspose.elements[i]!);
        error = Math.max(error, Math.abs(next.elements[i]! - polar.elements[i]!));
      }
      polar = next;
      if (error < 1e-10) return new Quaternion().setFromRotationMatrix(new Matrix4().setFromMatrix3(polar)).normalize();
    }
    throw new Error(`Donor node ${node.getName()} polar rotation did not converge`);
  };
  const depth = (node: Node): number => node.getParentNode() ? 1 + depth(node.getParentNode()!) : 0;
  const pairs = Object.entries(profile.mapping).map(([name, sourceName]) => {
    const node = target(name), sourceNode = source(sourceName);
    // A quaternion cannot invert an affine shear or nonuniform ancestor scale.
    // Reject before creating wrappers or replacing clips instead of baking wrong directions.
    for (let ancestor: Node | null = node; ancestor; ancestor = ancestor.getParentNode()) assertRotationSpace(ancestor);
    for (let ancestor: Node | null = sourceNode; ancestor; ancestor = ancestor.getParentNode()) sourceRotation(ancestor);
    const sourceBind = basis.clone().multiply(sourceRotation(sourceNode)), targetBind = targetRotation(node);
    const childName = profile.directionChildren?.[name];
    let sourceChild: Node | undefined, targetLocalDirection: Vector3 | undefined;
    if (childName) {
      const sourceChildName = profile.sourceDirectionChildren?.[sourceName] ?? profile.mapping[childName];
      if (!sourceChildName) throw new Error(`Missing donor direction child for ${name}`);
      const targetDirection = position(target(childName)).sub(position(node));
      sourceChild = source(sourceChildName);
      const sourceDirection = position(sourceChild).sub(position(sourceNode)).applyQuaternion(basis);
      if (targetDirection.lengthSq() < 1e-12 || sourceDirection.lengthSq() < 1e-12) throw new Error(`Zero-length anatomical segment ${name}`);
      targetLocalDirection = targetDirection.clone().normalize().applyQuaternion(targetBind.clone().invert());
      targetBind.premultiply(new Quaternion().setFromUnitVectors(targetDirection.normalize(), sourceDirection.normalize()));
    }
    return { node, sourceNode, sourceChild, targetLocalDirection, offset: sourceBind.invert().multiply(targetBind) };
  }).sort((a, b) => depth(a.node) - depth(b.node));
  if (!pairs.length) throw new Error("Motion mapping is empty");
  const takes = Object.entries(profile.clips).map(([name, spec]) => {
    const matches = donor.getRoot().listAnimations().filter(clip => clip.getName() === spec.source);
    if (matches.length !== 1) throw new Error(`Expected one donor take ${spec.source}, found ${matches.length}`);
    const clip = matches[0]!, sourceSeconds = duration(clip), seconds = spec.duration ?? sourceSeconds;
    const hold = spec.holdLastSeconds ?? 0;
    if (!(sourceSeconds > 0 && seconds > 0 && Number.isFinite(seconds) && hold >= 0 && Number.isFinite(hold))) throw new Error(`Invalid duration for ${name}`);
    if (spec.loop && hold) throw new Error(`Loop ${name} cannot hold its last frame`);
    if (spec.groundingMaxSpeedMps !== undefined && (!profile.grounding || spec.loop
      || !(Number.isFinite(spec.groundingMaxSpeedMps) && spec.groundingMaxSpeedMps > 0))) {
      throw new Error(`Grounding speed limit requires grounded one-shot ${name}`);
    }
    return { name, spec, clip, sourceSeconds, seconds, hold };
  });
  if (!takes.length) throw new Error("No output motion clips requested");

  const targetPose = storedPose(doc), sourcePose = storedPose(donor);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene || doc.getRoot().listScenes().length !== 1) throw new Error("Motion target requires one scene");
  const children = [...scene.listChildren()];
  let ground: Node | undefined;
  if (profile.grounding) {
    if (doc.getRoot().listNodes().some(node => node.getName() === "corealm_retarget_ground")) throw new Error("Target already has a corealm_retarget_ground wrapper; rebuild from its original source");
    ground = doc.createNode("corealm_retarget_ground");
    for (const child of children) { scene.removeChild(child); ground.addChild(child); }
    scene.addChild(ground);
  }
  // Every scene node receives a complete pose, including unmapped accessories and old clip
  // targets. Entering Idle after Death must not retain the previous clip's root/limb values.
  const active = reachableNodes(doc), outputPose = storedPose(doc).filter(({ node }) => active.has(node));
  const baked: { name: string; times: number[]; tracks: Map<Node, { t: number[]; r: number[]; s: number[]; translationTimes?: number[] }>; report: {
    name: string; sourceTake: string; sourceSeconds: number; seconds: number; samples: number; loop: boolean;
    heldSeconds: number; maximumGroundCorrection: number; removedHorizontalTravel: number[];
  } }[] = [];
  let completed = false;
  try {
    for (const { name, spec, clip, sourceSeconds, seconds, hold } of takes) {
      const steps = Math.max(1, Math.ceil(seconds * fps));
      const times = Array.from({ length: steps + 1 }, (_, frame) => frame * seconds / steps);
      const tracks = new Map(outputPose.map(({ node }) => [node, { t: [] as number[], r: [] as number[], s: [] as number[], translationTimes: undefined as number[] | undefined }]));
      restorePose(sourcePose); applyClip(clip, 0); const startRoot = position(sourceRoot);
      restorePose(sourcePose); applyClip(clip, sourceSeconds); const endRoot = position(sourceRoot);
      const removeTravel = spec.loop && profile.root.horizontal === "in-place";
      const removed = removeTravel ? endRoot.clone().sub(startRoot).applyQuaternion(basis).multiplyScalar(profile.root.translationScale) : new Vector3();
      let maximumGroundCorrection = 0;
      for (let frame = 0; frame <= steps; frame++) {
        const phase = frame / steps;
        restorePose(sourcePose); applyClip(clip, phase * sourceSeconds); restorePose(outputPose);
        for (const pair of pairs) {
          const desired = basis.clone().multiply(sourceRotation(pair.sourceNode)).multiply(pair.offset);
          if (pair.sourceChild && pair.targetLocalDirection) {
            const direction = position(pair.sourceChild).sub(position(pair.sourceNode)).applyQuaternion(basis);
            if (direction.lengthSq() < 1e-12) throw new Error(`Donor ${pair.sourceNode.getName()} collapses its anatomical segment in ${name}`);
            // Studio stretch can shear descendants. Match the actual animated segment,
            // retaining the polar rotation's twist without copying donor scale or length.
            const predicted = pair.targetLocalDirection.clone().applyQuaternion(desired).normalize();
            desired.premultiply(new Quaternion().setFromUnitVectors(predicted, direction.normalize())).normalize();
          }
          const parent = pair.node.getParentNode();
          pair.node.setRotation((parent ? targetRotation(parent).invert().multiply(desired) : desired).normalize().toArray());
        }
        const displacement = position(sourceRoot).sub(sourceRootBind).applyQuaternion(basis).multiplyScalar(profile.root.translationScale);
        if (removeTravel) {
          const baseline = startRoot.clone().lerp(endRoot, phase).sub(sourceRootBind).applyQuaternion(basis).multiplyScalar(profile.root.translationScale);
          displacement.x -= baseline.x; displacement.z -= baseline.z;
        }
        const desiredRoot = targetRootBind.clone().add(displacement), parent = targetRoot.getParentNode();
        targetRoot.setTranslation((parent ? desiredRoot.applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert()) : desiredRoot).toArray());
        if (ground && profile.grounding) {
          const lift = profile.grounding.floor - deformedBounds(doc).min[1]!;
          maximumGroundCorrection = Math.max(maximumGroundCorrection, Math.abs(lift));
          if (spec.groundingMaxSpeedMps === undefined && maximumGroundCorrection > (profile.grounding.maxCorrection ?? Infinity)) throw new Error(`${name} exceeds allowed ground correction: ${maximumGroundCorrection}`);
          ground.setTranslation([0, lift, 0]);
        }
        for (const { node } of outputPose) {
          const values = tracks.get(node)!;
          values.t.push(...node.getTranslation()); values.r.push(...node.getRotation()); values.s.push(...node.getScale());
        }
      }
      if (spec.loop) for (const values of tracks.values()) {
        values.t.splice(values.t.length - 3, 3, ...values.t.slice(0, 3));
        values.r.splice(values.r.length - 4, 4, ...values.r.slice(0, 4));
        values.s.splice(values.s.length - 3, 3, ...values.s.slice(0, 3));
      }
      if (ground && spec.groundingMaxSpeedMps !== undefined) {
        // A fast hand or crown can dip below both baked key poses. Sample the exact
        // interpolated target tracks, preserving their authored keys, before limiting support.
        const cached = new Map<number, number>();
        const qa = new Quaternion(), qb = new Quaternion();
        const requiredAt = (frame: number): number => {
          const found = cached.get(frame); if (found !== undefined) return found;
          const left = Math.floor(frame), right = Math.min(left + 1, steps), alpha = frame - left;
          for (const { node } of outputPose) {
            if (node === ground) { node.setTranslation([0, 0, 0]); continue; }
            const values = tracks.get(node)!;
            const vector = (data: number[]): [number, number, number] => [0, 1, 2].map(axis =>
              data[left * 3 + axis]! * (1 - alpha) + data[right * 3 + axis]! * alpha) as [number, number, number];
            node.setTranslation(vector(values.t)); node.setScale(vector(values.s));
            node.setRotation(qa.fromArray(values.r, left * 4).slerp(qb.fromArray(values.r, right * 4), alpha).toArray());
          }
          const required = profile.grounding!.floor - deformedBounds(doc).min[1]!;
          cached.set(frame, required); return required;
        };
        const sampled = sampleGroundSupport(Array.from({ length: steps + 1 }, (_, frame) => frame), requiredAt);
        const supportTimes = sampled.times.map(frame => frame * seconds / steps), required = sampled.required;
        const limited = limitGroundCorrectionSpeed(supportTimes, required, spec.groundingMaxSpeedMps);
        maximumGroundCorrection = Math.max(...limited.map(Math.abs));
        if (maximumGroundCorrection > (profile.grounding!.maxCorrection ?? Infinity)) throw new Error(`${name} exceeds allowed ground correction: ${maximumGroundCorrection}`);
        const support = tracks.get(ground)!;
        support.t = limited.flatMap(value => [0, value, 0]); support.translationTimes = supportTimes;
      }
      if (hold) {
        times.push(seconds + hold);
        for (const values of tracks.values()) {
          values.t.push(...values.t.slice(-3)); values.r.push(...values.r.slice(-4)); values.s.push(...values.s.slice(-3));
          values.translationTimes?.push(seconds + hold);
        }
      }
      baked.push({ name, times, tracks, report: { name, sourceTake: spec.source, sourceSeconds, seconds: seconds + hold, samples: times.length,
        loop: Boolean(spec.loop), heldSeconds: hold, maximumGroundCorrection, removedHorizontalTravel: [removed.x, 0, removed.z] } });
    }
    // No old clip is discarded until all donor samples and grounding limits have succeeded.
    for (const clip of [...doc.getRoot().listAnimations()]) removeClip(doc, clip.getName());
    for (const { name, times, tracks } of baked) {
      const clip = doc.createAnimation(name);
      for (const [node, values] of tracks) {
        addChannel(doc, clip, node, "translation", values.translationTimes ?? times, values.t);
        addChannel(doc, clip, node, "rotation", times, values.r);
        addChannel(doc, clip, node, "scale", times, values.s);
      }
    }
    completed = true;
  } finally {
    restorePose(sourcePose); restorePose(targetPose); ground?.setTranslation([0, 0, 0]);
    if (!completed && ground) {
      for (const child of children) { ground.removeChild(child); scene.addChild(child); }
      scene.removeChild(ground); ground.dispose();
    }
  }
  return { mappedJoints: pairs.length, poseNodes: outputPose.length, sourceToTargetRotation: profile.sourceToTargetRotation,
    translationScale: profile.root.translationScale, clips: baked.map(item => item.report), requiresVisualReview: true,
    method: "Verified facing basis, polar donor rotations and exact animated anatomical directions, scaled root travel, complete target-pose clips" };
}

function rotateGeometry(doc: Document, rotation: Matrix4) {
  const transforms = new Map<Accessor, { semantic: string; local: Matrix4; normal: Matrix3 }>();
  for (const node of doc.getRoot().listNodes()) {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    const local = matrix.clone().invert().multiply(rotation).multiply(matrix), normal = new Matrix3().getNormalMatrix(local);
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      for (const semantic of ["POSITION", "NORMAL", "TANGENT"]) {
        const accessor = primitive.getAttribute(semantic); if (!accessor) continue;
        const existing = transforms.get(accessor);
        if (existing && (existing.semantic !== semantic || existing.local.elements.some((value, i) => Math.abs(value - local.elements[i]!) > 1e-10))) {
          throw new Error(`Shared ${semantic} accessor requires conflicting geometry basis transforms`);
        }
        if (!existing) transforms.set(accessor, { semantic, local, normal });
      }
    }
  }
  // Validate every use before writing, so shared mesh instances cannot be partly transformed.
  for (const [accessor, { semantic, local, normal }] of transforms) {
    for (let vertex = 0; vertex < accessor.getCount(); vertex++) {
      const values = accessor.getElement(vertex, []), p = new Vector3().fromArray(values);
      if (semantic === "POSITION") p.applyMatrix4(local); else p.applyMatrix3(normal).normalize();
      accessor.setElement(vertex, semantic === "TANGENT" ? [...p.toArray(), values[3]!] : p.toArray());
    }
  }
}

function geometrySymmetry(doc: Document) {
  const points = doc.getRoot().listNodes().flatMap(node => {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    return node.getMesh()?.listPrimitives().flatMap(primitive => {
      const positions = primitive.getAttribute("POSITION")!;
      return Array.from({ length: positions.getCount() }, (_, i) => new Vector3().fromArray(positions.getElement(i, [])).applyMatrix4(matrix));
    }) ?? [];
  });
  if (!points.length) throw new Error("No geometry available for symmetry check");
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const point of points) { min.min(point); max.max(point); }
  const stride = Math.max(1, Math.floor(points.length / 256));
  const measure = (axis: "x" | "z") => {
    const center = (min[axis] + max[axis]) / 2, distances: number[] = [];
    for (let i = 0; i < points.length; i += stride) {
      const point = points[i]!.clone(); point[axis] = 2 * center - point[axis];
      let nearest = Infinity;
      for (const candidate of points) nearest = Math.min(nearest, point.distanceTo(candidate));
      distances.push(nearest);
    }
    distances.sort((a, b) => a - b);
    return { planeCenter: center, rms: Math.sqrt(distances.reduce((sum, value) => sum + value * value, 0) / distances.length),
      p95: distances[Math.min(distances.length - 1, Math.floor(distances.length * .95))]!, max: distances[distances.length - 1]!, samples: distances.length };
  };
  return { x: measure("x"), z: measure("z") };
}

function bindLateralAxis(doc: Document) {
  const skin = doc.getRoot().listSkins()[0], inverse = skin?.getInverseBindMatrices();
  if (!skin || !inverse) throw new Error("No inverse binds available for basis check");
  const joints = skin.listJoints(), left = joints.findIndex(joint => joint.getName().replace(/^mixamorig:/, "") === "LeftUpLeg"),
    right = joints.findIndex(joint => joint.getName().replace(/^mixamorig:/, "") === "RightUpLeg");
  if (left < 0 || right < 0) throw new Error("No bilateral leg binds available for basis check");
  const bind = (index: number) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(inverse.getElement(index, [])).invert());
  return bind(right).sub(bind(left)).normalize();
}

/** Tripo GLB exports can omit node TRS while preserving complete inverse binds. */
export function restoreTripoBindPose(doc: Document) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin?.getInverseBindMatrices()) throw new Error("No exported skin inverse binds");
  const binds = new Map(skin.listJoints().map((joint, index) => [joint,
    new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, [])).invert()]));
  for (const [joint, world] of binds) {
    const parent = joint.getParentNode();
    const parentWorld = parent ? binds.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
    joint.setMatrix(parentWorld.clone().invert().multiply(world).toArray());
  }
  return binds.size;
}

/** Recover the omitted mesh basis only when an exact static export proves the rotation. */
export function restoreGeometryBasis(doc: Document, reference: Document) {
  const points = (document: Document) => document.getRoot().listNodes().flatMap(node => {
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    return node.getMesh()?.listPrimitives().flatMap(primitive => {
      const positions = primitive.getAttribute("POSITION")!;
      return Array.from({ length: positions.getCount() }, (_, i) => new Vector3().fromArray(positions.getElement(i, [])).applyMatrix4(matrix));
    }) ?? [];
  });
  const source = points(doc), original = points(reference);
  const fits = [0, 90, -90, 180].map(degrees => {
    const rotation = new Matrix4().makeRotationY(degrees * Math.PI / 180);
    let sum = 0, maximum = 0, count = 0;
    for (let i = 0; i < source.length; i += 17) {
      const p = source[i]!.clone().applyMatrix4(rotation);
      let distance = Infinity;
      for (const candidate of original) distance = Math.min(distance, p.distanceToSquared(candidate));
      sum += distance; maximum = Math.max(maximum, distance); count++;
    }
    return { degrees, rms: Math.sqrt(sum / count), maximum: Math.sqrt(maximum), samples: count };
  }).sort((a, b) => a.rms - b.rms);
  const fit = fits[0]!;
  if (fit.maximum > .0001 || fit.rms > .00002) throw new Error("Rigged geometry has no verified basis match to static source");
  const rotation = new Matrix4().makeRotationY(fit.degrees * Math.PI / 180);
  rotateGeometry(doc, rotation);
  return { ...fit, testedRotations: fits, method: "Closest-point comparison against original static export, before any skeleton or motion transformations" };
}

/** Apply a verified source-to-bind geometry basis correction while retaining the source mesh topology. */
export function applyGeometryBasisRotation(doc: Document, degrees: number) {
  if (![90, -90, 180].includes(degrees)) throw new Error(`Unsupported geometry basis rotation ${degrees}`);
  const sourceSymmetry = geometrySymmetry(doc), lateralAxis = bindLateralAxis(doc);
  if (degrees === 90 && !(sourceSymmetry.x.rms < .02 && sourceSymmetry.x.rms * 2 < sourceSymmetry.z.rms && Math.abs(lateralAxis.z) > .85)) {
    throw new Error("The +90 degree basis correction requires X-symmetric mesh geometry and a Z-aligned bilateral bind axis");
  }
  rotateGeometry(doc, new Matrix4().makeRotationY(degrees * Math.PI / 180));
  const resultSymmetry = geometrySymmetry(doc);
  if (degrees === 90 && !(resultSymmetry.z.rms < .02 && resultSymmetry.z.rms * 2 < resultSymmetry.x.rms)) {
    throw new Error("Geometry basis rotation did not align the mesh symmetry plane to the bind-limb axis");
  }
  return { degrees, sourceSymmetry, bindLateralAxis: lateralAxis.toArray(), resultSymmetry,
    method: "Explicit source-to-bind basis correction verified by bilateral mesh symmetry and the inverse-bind leg axis; positions, normals and tangents rotated without changing topology" };
}

/** Rebuild an export whose weight accessors collapsed onto Hips, using its actual anatomical joints. */
export function repairHumanoidWeights(doc: Document) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error("No exported humanoid skin");
  const identity = new Matrix4().elements;
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh() || node.getSkin() !== skin) continue;
    if (node.getWorldMatrix().some((value, i) => Math.abs(value - identity[i]!) > 1e-8)) {
      throw new Error("Humanoid weight repair requires identity skinned mesh world transforms");
    }
  }
  restoreTripoBindPose(doc);
  const joints = skin.listJoints();
  const byName = new Map(joints.map((joint, index) => [joint.getName().replace(/^mixamorig:/, ""), { joint, index }]));
  const bounds = deformedBounds(doc), height = bounds.max[1]! - bounds.min[1]!, sigma = height * .035;
  const ends: Record<string, string> = { ...directionChildren, Head: "HeadTop_End" };
  for (const side of ["Left", "Right"]) { ends[side + "Hand"] = side + "HandMiddle1"; ends[side + "ToeBase"] = side + "Toe_End"; }
  const capsules = Object.entries(ends).map(([name, child]) => {
    const a = byName.get(name), b = byName.get(child);
    if (!a || (!b && name !== "Head")) throw new Error(`Missing repair anatomy ${name}/${child}`);
    return { name, index: a.index, a: position(a.joint), b: b ? position(b.joint) : position(a.joint).add(new Vector3(0, height * .08, 0)) };
  });
  const buffer = doc.getRoot().listBuffers()[0]!;
  let vertices = 0; const assigned = new Map<string, number>();
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh() || node.getSkin() !== skin) continue;
    const matrix = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!, indices = new Uint16Array(positions.getCount() * 4), weights = new Float32Array(positions.getCount() * 4);
      for (let vertex = 0; vertex < positions.getCount(); vertex++) {
        const p = new Vector3().fromArray(positions.getElement(vertex, [])).applyMatrix4(matrix);
        const nearest = capsules.map(capsule => {
          const segment = capsule.b.clone().sub(capsule.a), t = Math.max(0, Math.min(1, p.clone().sub(capsule.a).dot(segment) / segment.lengthSq()));
          return { ...capsule, distance: p.distanceTo(capsule.a.clone().addScaledVector(segment, t)) };
        }).sort((a, b) => a.distance - b.distance).slice(0, 4);
        const minimum = nearest[0]!.distance;
        const values = nearest.map(item => Math.exp(-((item.distance * item.distance - minimum * minimum) / (sigma * sigma))));
        const sum = values.reduce((a, b) => a + b, 0);
        nearest.forEach((item, i) => { indices[vertex * 4 + i] = item.index; weights[vertex * 4 + i] = values[i]! / sum; });
        assigned.set(nearest[0]!.name, (assigned.get(nearest[0]!.name) ?? 0) + 1); vertices++;
      }
      primitive.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(indices).setBuffer(buffer));
      primitive.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(weights).setBuffer(buffer));
    }
  }
  return { method: "Four nearest anatomical bone segments, Gaussian distance blending against recovered Tripo bind joints; hands follow palm and feet follow ankle/toes", vertices,
    dominantJointVertices: Object.fromEntries(assigned), sourceWeightFailure: "Export assigned more than98% of vertices toHips", requiresVisualReview: true };
}

/** Map the actual Mixamo skin to existing native humanoid takes in world bind space. */
export function retargetHumanoid(doc: Document, library: Document) {
  if (doc.getRoot().listAnimations().length) throw new Error("Refusing to overwrite exported animations");
  const restoredJoints = restoreTripoBindPose(doc);
  const byName = new Map(doc.getRoot().listNodes().map(node => [node.getName().replace(/^mixamorig:/, ""), node]));
  const sourceByName = new Map(library.getRoot().listNodes().map(node => [node.getName(), node]));
  const target = (name: string) => { const node = byName.get(name); if (!node) throw new Error(`Missing Mixamo bone ${name}`); return node; };
  const source = (name: string) => { const node = sourceByName.get(name); if (!node) throw new Error(`Missing native bone ${name}`); return node; };
  const armature = target("Armature");
  const forward = position(target("LeftToeBase")).sub(position(target("LeftFoot")))
    .add(position(target("RightToeBase")).sub(position(target("RightFoot"))));
  forward.y = 0; forward.normalize();
  const yaw = -Math.atan2(forward.x, forward.z);
  armature.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).toArray());
  const bindBounds = deformedBounds(doc);
  const targetLeg = position(target("LeftUpLeg")).distanceTo(position(target("LeftLeg"))) + position(target("LeftLeg")).distanceTo(position(target("LeftFoot")));
  const sourceLeg = position(source("thigh_l")).distanceTo(position(source("calf_l"))) + position(source("calf_l")).distanceTo(position(source("foot_l")));
  const translationScale = targetLeg / sourceLeg;
  const takes: Record<string, string> = { Idle: "Idle_Loop", Walk: "Walk_Loop", Run: "Jog_Fwd_Loop", Attack: "Punch_Jab",
    Hit: "Hit_Chest", Death: "Death01" };
  const report = retargetCreatureMotion(doc, library, {
    mapping: Object.fromEntries(Object.entries(mapping).filter(([name]) => byName.has(name)).map(([name, donor]) => [target(name).getName(), donor])),
    directionChildren: Object.fromEntries(Object.entries(directionChildren).filter(([name, child]) => byName.has(name) && byName.has(child))
      .map(([name, child]) => [target(name).getName(), target(child).getName()])),
    sourceToTargetRotation: [0, 0, 0, 1], root: { target: target("Hips").getName(), source: "pelvis", translationScale, horizontal: "in-place" },
    clips: Object.fromEntries(Object.entries(takes).map(([name, take]) => [name, { source: take, loop: ["Idle", "Walk", "Run"].includes(name) }])),
    grounding: { floor: .001 },
  });
  return { ...report, restoredJoints, yawDegrees: yaw * 180 / Math.PI, bindBounds };
}
