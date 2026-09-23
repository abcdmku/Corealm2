import type { Accessor, Document, Node } from "@gltf-transform/core";
import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { addChannel, applyClip, duration, restorePose, storedPose } from "../creature-motion/pose.js";
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
  const targetPose = storedPose(doc), sourcePose = storedPose(library);
  const hips = target("Hips"), sourceHips = source("pelvis");
  const targetHipBind = position(hips), sourceHipBind = position(sourceHips);
  const targetLeg = position(target("LeftUpLeg")).distanceTo(position(target("LeftLeg"))) + position(target("LeftLeg")).distanceTo(position(target("LeftFoot")));
  const sourceLeg = position(source("thigh_l")).distanceTo(position(source("calf_l"))) + position(source("calf_l")).distanceTo(position(source("foot_l")));
  const translationScale = targetLeg / sourceLeg;
  const pairs = Object.entries(mapping).filter(([name]) => byName.has(name)).map(([name, sourceName]) => {
    const node = target(name), sourceNode = source(sourceName), sourceBind = rotation(sourceNode), targetBind = rotation(node);
    const childName = directionChildren[name], childSource = childName && mapping[childName];
    if (childName && childSource) {
      const targetDirection = position(target(childName)).sub(position(node)).normalize();
      const sourceDirection = position(source(childSource)).sub(position(sourceNode)).normalize();
      targetBind.premultiply(new Quaternion().setFromUnitVectors(targetDirection, sourceDirection));
    }
    return { name, node, sourceNode, offset: sourceBind.invert().multiply(targetBind) };
  });
  const depth = (node: Node): number => node.getParentNode() ? 1 + depth(node.getParentNode()!) : 0;
  pairs.sort((a, b) => depth(a.node) - depth(b.node));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const ground = doc.createNode("corealm_motion_ground");
  for (const child of [...scene.listChildren()]) { scene.removeChild(child); ground.addChild(child); }
  scene.addChild(ground);
  const takes: Record<string, string> = { Idle: "Idle_Loop", Walk: "Walk_Loop", Run: "Jog_Fwd_Loop", Attack: "Punch_Jab",
    Hit: "Hit_Chest", HitLeft: "Hit_Chest", HitRight: "Hit_Chest", Death: "Death01" };
  const report = [];
  for (const [name, take] of Object.entries(takes)) {
    const original = library.getRoot().listAnimations().find(clip => clip.getName() === take);
    if (!original) throw new Error(`Missing native take ${take}`);
    const seconds = duration(original), steps = Math.ceil(seconds * 30), times: number[] = [];
    const rotations = new Map(pairs.map(pair => [pair.node, [] as number[]])), translations: number[] = [], grounding: number[] = [];
    let maximumLift = 0;
    for (let frame = 0; frame <= steps; frame++) {
      const time = frame * seconds / steps;
      restorePose(sourcePose); applyClip(original, time); restorePose(targetPose); ground.setTranslation([0, 0, 0]);
      for (const pair of pairs) {
        const desired = rotation(pair.sourceNode).multiply(pair.offset);
        const parent = pair.node.getParentNode();
        pair.node.setRotation((parent ? rotation(parent).invert().multiply(desired) : desired).normalize().toArray());
      }
      const worldHips = position(sourceHips).sub(sourceHipBind).multiplyScalar(translationScale).add(targetHipBind);
      hips.setTranslation(worldHips.applyMatrix4(new Matrix4().fromArray(hips.getParentNode()!.getWorldMatrix()).invert()).toArray());
      const lift = -deformedBounds(doc).min[1]! + .001;
      maximumLift = Math.max(maximumLift, Math.abs(lift));
      times.push(time); translations.push(...hips.getTranslation()); grounding.push(0, lift, 0);
      for (const pair of pairs) rotations.get(pair.node)!.push(...pair.node.getRotation());
    }
    if (["Idle", "Walk", "Run"].includes(name)) {
      for (const values of rotations.values()) values.splice(values.length - 4, 4, ...values.slice(0, 4));
      translations.splice(translations.length - 3, 3, ...translations.slice(0, 3));
      grounding.splice(grounding.length - 3, 3, ...grounding.slice(0, 3));
    }
    const clip = doc.createAnimation(name);
    for (const [node, values] of rotations) addChannel(doc, clip, node, "rotation", times, values);
    addChannel(doc, clip, hips, "translation", times, translations);
    addChannel(doc, clip, ground, "translation", times, grounding);
    report.push({ name, sourceTake: take, seconds, samples: steps + 1, maximumGroundCorrection: maximumLift,
      ...(name.startsWith("Hit") ? { directional: false, note: "Native frontal hit; left/right are explicit runtime aliases" } : {}) });
  }
  restorePose(targetPose); restorePose(sourcePose); ground.setTranslation([0, 0, 0]);
  return { restoredJoints, mappedJoints: pairs.length, yawDegrees: yaw * 180 / Math.PI, translationScale,
    bindBounds, clips: report, method: "Inverse-bind rest reconstruction, semantic world-space rotations with limb rest-direction alignment, source pelvis displacement scaled by leg length, sampled weighted-mesh grounding" };
}
