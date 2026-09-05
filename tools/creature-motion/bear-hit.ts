import type { Document, Node } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { addChannel, applyClip, curve, removeClip, restorePose, storedPose } from "./pose.js";
import type { JointGesture } from "./profiles.js";

const SECONDS = 0.78;
const PHASES = [0, 0.06, 0.11, 0.22, 0.34, 0.52, 0.66, SECONDS].map(t => t / SECONDS);
const worldPosition = (node: Node): Vector3 => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
function worldRotation(node: Node): Quaternion {
  const rotation = new Quaternion();
  new Matrix4().fromArray(node.getWorldMatrix()).decompose(new Vector3(), rotation, new Vector3());
  return rotation;
}
function setWorldRotation(node: Node, rotation: Quaternion): void {
  const parent = node.getParentNode();
  node.setRotation((parent ? worldRotation(parent).invert().multiply(rotation) : rotation).normalize().toArray());
}

interface Leg {
  hip: Node; knee: Node; ankle: Node; ball: Node; toe: Node;
  upper: number; lower: number;
  pole: Vector3; anklePosition: Vector3; ankleRotation: Quaternion;
  ballPosition: Vector3; toePosition: Vector3;
}

/** Rotate the leg at its joints; preserve both segment lengths and the complete paw's world pose. */
function plantLeg(leg: Leg): void {
  const hip = worldPosition(leg.hip);
  const toward = leg.anklePosition.clone().sub(hip);
  const distance = toward.length();
  if (distance > leg.upper + leg.lower + 1e-5 || distance < Math.abs(leg.upper - leg.lower)) {
    throw new Error(`Bear recoil puts ${leg.hip.getName()} beyond its planted reach (${distance.toFixed(5)} m)`);
  }
  toward.normalize();
  const bend = leg.pole.clone().addScaledVector(toward, -leg.pole.dot(toward)).normalize();
  const along = (leg.upper * leg.upper - leg.lower * leg.lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, leg.upper * leg.upper - along * along));
  const knee = hip.clone().addScaledVector(toward, along).addScaledVector(bend, height);
  const hipDelta = new Quaternion().setFromUnitVectors(worldPosition(leg.knee).sub(hip).normalize(), knee.clone().sub(hip).normalize());
  setWorldRotation(leg.hip, hipDelta.multiply(worldRotation(leg.hip)));
  const kneePosition = worldPosition(leg.knee);
  const kneeDelta = new Quaternion().setFromUnitVectors(
    worldPosition(leg.ankle).sub(kneePosition).normalize(), leg.anklePosition.clone().sub(kneePosition).normalize(),
  );
  setWorldRotation(leg.knee, kneeDelta.multiply(worldRotation(leg.knee)));
  setWorldRotation(leg.ankle, leg.ankleRotation.clone());
}

/** A heavy animal absorbs the blow through its shoulders and legs; the navigation origin stays fixed. */
export function authorBearHit(doc: Document, side: -1 | 0 | 1): void {
  const name = side < 0 ? "HitLeft" : side > 0 ? "HitRight" : "Hit";
  const direction = side || 0.7;
  const gestures: JointGesture[] = [];
  const gesture = (name: string, axis: JointGesture["axis"], angles: number[]) =>
    gestures.push({ bone: new RegExp(`^Bear_${name}SHJnt$`), axis, angles });
  gesture("Neck_01", "x", [0, -15, -16, -8, 4, 2, 0, 0]);
  gesture("Neck_02", "x", [0, -12, -14, -9, 3, 2, 0, 0]);
  gesture("Neck_Top", "x", [0, -4, -6, -3, -2, -1, 0, 0]);
  gesture("Neck_01", "y", [0, -9, -13, -12, -4, 2, 0, 0].map(a => a * direction));
  gesture("Neck_02", "y", [0, -6, -9, -8, -3, 1, 0, 0].map(a => a * direction));
  gesture("Spine_02", "x", [0, 1, 3, 5, 4, 1, 0, 0]);
  gesture("Spine_03", "x", [0, 1, 3, 4, 3, 1, 0, 0]);
  gesture("Spine_04", "x", [0, 1, 3, 4, 2, 0, 0, 0]);
  gesture("Spine_02", "y", [0, 0, -2, -4, -3, -1, 0, 0].map(a => a * direction));
  gesture("Spine_03", "y", [0, -1, -3, -5, -3, -1, 0, 0].map(a => a * direction));
  gesture("Spine_04", "z", [0, 0, -2, -4, -3, -1, 0, 0].map(a => a * direction));
  gesture("Head_Jaw", "x", [0, 5, 7, 4, 0, 0, 0, 0]);
  gesture("l_Ear_01_01", "x", [0, 0, -12, -7, 3, 0, 0, 0]);
  gesture("r_Ear_01_01", "x", [0, 0, -12, -7, 3, 0, 0, 0]);

  const original = storedPose(doc);
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === "Idle");
  if (!idle) throw new Error("Bear Hit needs the original Idle stance");
  applyClip(idle, 0);
  const initial = storedPose(doc);
  const byName = new Map(doc.getRoot().listNodes().map(node => [node.getName(), node]));
  const requireBone = (name: string): Node => {
    const node = byName.get(`Bear_${name}SHJnt`);
    if (!node) throw new Error(`Bear Hit is missing joint ${name}`);
    return node;
  };
  const pelvis = requireBone("ROOT");
  const pelvisPosition = worldPosition(pelvis);
  const legs: Leg[] = ["l_FrontLeg", "r_FrontLeg", "l_HindLeg", "r_HindLeg"].map(prefix => {
    const [hip, knee, ankle, ball, toe] = ["Hip", "Knee", "Ankle", "Ball", "Toe"].map(part => requireBone(`${prefix}_${part}`)) as [Node, Node, Node, Node, Node];
    const a = worldPosition(hip), b = worldPosition(knee), c = worldPosition(ankle);
    const axis = c.clone().sub(a).normalize();
    const pole = b.clone().sub(a);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    return { hip, knee, ankle, ball, toe, upper: a.distanceTo(b), lower: b.distanceTo(c), pole,
      anklePosition: c, ankleRotation: worldRotation(ankle), ballPosition: worldPosition(ball), toePosition: worldPosition(toe) };
  });
  const jointGestures = gestures.map(gesture => {
    const node = initial.find(pose => gesture.bone.test(pose.node.getName()))?.node;
    if (!node) throw new Error(`Bear Hit is missing ${gesture.bone}`);
    const axis = new Vector3(gesture.axis === "x" ? 1 : 0, gesture.axis === "y" ? 1 : 0, gesture.axis === "z" ? 1 : 0)
      .applyQuaternion(worldRotation(node).invert()).normalize();
    return { ...gesture, node, axis };
  });
  const joints = new Set(doc.getRoot().listSkins().flatMap(skin => skin.listJoints()));
  const baseTargets = new Set(idle.listChannels().map(channel => channel.getTargetNode()!));
  const recorded = initial.filter(pose => joints.has(pose.node) || baseTargets.has(pose.node))
    .map(pose => ({ node: pose.node, translation: [] as number[], rotation: [] as number[], scale: [] as number[] }));
  // Fine keys also preserve the nonlinear knee constraint between samples during runtime slerp.
  const steps = Math.ceil(SECONDS * 60);
  const times = Array.from({ length: steps + 1 }, (_, index) => index * SECONDS / steps);
  let maxPawError = 0;
  for (const time of times) {
    restorePose(initial);
    for (const gesture of jointGestures) {
      const radians = curve(PHASES, gesture.angles, time / SECONDS) * Math.PI / 180;
      gesture.node.setRotation(new Quaternion().fromArray(gesture.node.getRotation())
        .multiply(new Quaternion().setFromAxisAngle(gesture.axis, radians)).normalize().toArray());
    }
    const compression = curve(PHASES, [0, -0.025, -0.065, -0.11, -0.09, -0.035, -0.008, 0], time / SECONDS);
    const target = pelvisPosition.clone().add(new Vector3(0, compression, 0));
    const parent = pelvis.getParentNode();
    if (parent) target.applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert());
    pelvis.setTranslation(target.toArray());
    for (const leg of legs) {
      plantLeg(leg);
      maxPawError = Math.max(maxPawError, worldPosition(leg.ball).distanceTo(leg.ballPosition), worldPosition(leg.toe).distanceTo(leg.toePosition));
    }
    for (const track of recorded) {
      track.translation.push(...track.node.getTranslation());
      track.rotation.push(...track.node.getRotation());
      track.scale.push(...track.node.getScale());
    }
  }
  restorePose(original);
  if (maxPawError > 0.0001) throw new Error(`${name}: paw constraint error ${maxPawError} m`);
  removeClip(doc, name);
  const clip = doc.createAnimation(name);
  const bind = new Map(original.map(pose => [pose.node, pose]));
  for (const track of recorded) {
    for (const [property, values] of [["translation", track.translation], ["rotation", track.rotation], ["scale", track.scale]] as const) {
      const width = property === "rotation" ? 4 : 3;
      const varying = values.some((value, index) => Math.abs(value - values[index % width]!) > 1e-7);
      const rest = bind.get(track.node)!;
      const restValues = property === "rotation" ? rest.r : property === "translation" ? rest.t : rest.s;
      if (!varying && values.slice(0, width).every((value, index) => Math.abs(value - restValues[index]!) < 1e-7)) continue;
      addChannel(doc, clip, track.node, property, varying ? times : [0, SECONDS], varying ? values : [...values.slice(0, width), ...values.slice(0, width)]);
    }
  }
  clip.setExtras({ authored: true, contactNormalized: 0.11 / SECONDS,
    description: "head and neck recoil, delayed shoulder compression and twist, four planted paws, heavy recovery",
    bodyCompressionMetres: 0.11, plantedPawErrorMetres: maxPawError, bearHitVersion: 2 });
}
