import type { Document, Node } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { addChannel, applyClip, curve, removeClip, restorePose, storedPose } from "./pose.js";

export type HoovedAnimal = "animal_cattle" | "animal_aurochs" | "animal_boar";
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

interface HoofLeg {
  hip: Node; knee: Node; fetlock: Node; ankle: Node;
  upper: number; lower: number; pole: Vector3;
  distal: Vector3; fetlockRotation: Quaternion; anklePosition: Vector3; ankleRotation: Quaternion;
  contacts: { node: Node; position: Vector3 }[];
}

/**
 * These rigs have Hip -> Knee1 -> Knee2 -> Ankle, unlike the bear's two segments.
 * Guide the short distal segment from the planted hoof, then solve the two long segments.
 * Knee2 receives its own world rotation; a repeated knee-name gesture would rotate it twice.
 */
function plantHoof(leg: HoofLeg, distalPitch: number): void {
  const pitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), distalPitch);
  const fetlock = leg.anklePosition.clone().sub(leg.distal.clone().applyQuaternion(pitch));
  const hip = worldPosition(leg.hip);
  const toward = fetlock.clone().sub(hip);
  const distance = toward.length();
  if (distance > leg.upper + leg.lower + 1e-5 || distance < Math.abs(leg.upper - leg.lower)) {
    throw new Error(`Hoof recoil puts ${leg.hip.getName()} beyond its planted reach (${distance.toFixed(5)} m)`);
  }
  toward.normalize();
  const bend = leg.pole.clone().addScaledVector(toward, -leg.pole.dot(toward)).normalize();
  const along = (leg.upper ** 2 - leg.lower ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, leg.upper ** 2 - along ** 2));
  const knee = hip.clone().addScaledVector(toward, along).addScaledVector(bend, height);
  const hipDelta = new Quaternion().setFromUnitVectors(worldPosition(leg.knee).sub(hip).normalize(), knee.clone().sub(hip).normalize());
  setWorldRotation(leg.hip, hipDelta.multiply(worldRotation(leg.hip)));
  const kneePosition = worldPosition(leg.knee);
  const kneeDelta = new Quaternion().setFromUnitVectors(
    worldPosition(leg.fetlock).sub(kneePosition).normalize(), fetlock.clone().sub(kneePosition).normalize(),
  );
  setWorldRotation(leg.knee, kneeDelta.multiply(worldRotation(leg.knee)));
  setWorldRotation(leg.fetlock, pitch.multiply(leg.fetlockRotation.clone()));
  setWorldRotation(leg.ankle, leg.ankleRotation.clone());
}

/** Author the animal's own heavy recoil while keeping all four hoof contact poses fixed. */
export function authorHoovedHit(doc: Document, id: HoovedAnimal, side: -1 | 0 | 1): void {
  const boar = id === "animal_boar";
  const prefix = boar ? "WildBoar" : "Cow";
  const seconds = boar ? 0.70 : 0.84;
  const impact = boar ? 0.09 : 0.11;
  const phases = (boar ? [0, 0.045, impact, 0.19, 0.29, 0.46, 0.59, seconds] : [0, 0.06, impact, 0.24, 0.37, 0.56, 0.71, seconds]).map(t => t / seconds);
  const name = side < 0 ? "HitLeft" : side > 0 ? "HitRight" : "Hit";
  const direction = side || 0.65;
  const original = storedPose(doc);
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === "Idle");
  if (!idle) throw new Error(`${id} Hit needs the original Idle stance`);
  applyClip(idle, 0);
  const initial = storedPose(doc);
  const joints = new Set(doc.getRoot().listSkins().flatMap(skin => skin.listJoints()));
  const requireBone = (suffix: string): Node => {
    const matches = [...joints].filter(node => node.getName() === `${prefix}_${suffix}SHJnt`);
    if (matches.length !== 1) throw new Error(`${id} Hit needs exactly one skin joint ${suffix}, found ${matches.length}`);
    return matches[0]!;
  };
  const pelvis = requireBone("ROOT");
  const pelvisPosition = worldPosition(pelvis);
  const legs: HoofLeg[] = ["l_FrontLeg", "r_FrontLeg", "l_HindLeg", "r_HindLeg"].map(part => {
    const [hip, knee, fetlock, ankle] = ["Hip", "Knee1", "Knee2", "Ankle"].map(joint => requireBone(`${part}_${joint}`)) as [Node, Node, Node, Node];
    if (knee.getParentNode() !== hip || fetlock.getParentNode() !== knee || ankle.getParentNode() !== fetlock) throw new Error(`${id}: unexpected ${part} hierarchy`);
    const a = worldPosition(hip), b = worldPosition(knee), c = worldPosition(fetlock), d = worldPosition(ankle);
    const axis = c.clone().sub(a).normalize();
    const pole = b.clone().sub(a);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const contacts = [...joints].filter(node => node.getName() === `${prefix}_${part}_BallSHJnt` || node.getName() === `${prefix}_${part}_ToeSHJnt`)
      .map(node => ({ node, position: worldPosition(node) }));
    if (!contacts.length) throw new Error(`${id}: ${part} has no hoof contact joint`);
    return { hip, knee, fetlock, ankle, upper: a.distanceTo(b), lower: b.distanceTo(c), pole,
      distal: d.clone().sub(c), fetlockRotation: worldRotation(fetlock), anklePosition: d, ankleRotation: worldRotation(ankle), contacts };
  });
  const gestures: { node: Node; axis: Vector3; angles: number[] }[] = [];
  const gesture = (suffix: string, axis: "x" | "y" | "z", angles: number[]) => {
    const node = requireBone(suffix);
    gestures.push({ node, angles, axis: new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0)
      .applyQuaternion(worldRotation(node).invert()).normalize() });
  };
  // Cattle throw the muzzle and horns away from impact; boars recoil through their short neck.
  gesture("Neck_01", "x", boar ? [0, -12, -15, -8, 3, 1, 0, 0] : [0, -11, -14, -9, 3, 1, 0, 0]);
  gesture("Neck_02", "x", boar ? [0, -10, -14, -8, 2, 1, 0, 0] : [0, -9, -12, -8, 2, 1, 0, 0]);
  gesture("Neck_Top", "x", [0, -3, -4, -2, -1, 0, 0, 0]);
  gesture("Neck_01", "y", [0, -8, -13, -11, -4, 2, 0, 0].map(v => v * direction));
  gesture("Neck_02", "y", [0, -5, -8, -7, -3, 1, 0, 0].map(v => v * direction));
  gesture("Spine_02", "x", [0, 0.5, 2, 4, 3, 1, 0, 0]);
  gesture("Spine_03", "x", [0, 0.5, 2, 4, 3, 1, 0, 0]);
  gesture("Spine_04", "x", [0, 0.5, 2, 3, 2, 0.5, 0, 0]);
  gesture("Spine_02", "y", [0, 0, -1, -3, -2, -0.5, 0, 0].map(v => v * direction));
  gesture("Spine_03", "y", [0, 0, -2, -3, -2, -0.5, 0, 0].map(v => v * direction));
  gesture("Spine_04", "z", [0, 0, -1, -3, -2, -0.5, 0, 0].map(v => v * direction));
  gesture("l_Ear_01_01", "x", [0, 0, -10, -6, 3, 1, 0, 0]);
  gesture("r_Ear_01_01", "x", [0, 0, -10, -6, 3, 1, 0, 0]);
  const compression = boar ? 0.065 : 0.09;
  const baseTargets = new Set(idle.listChannels().map(channel => channel.getTargetNode()!));
  const recorded = initial.filter(pose => joints.has(pose.node) || baseTargets.has(pose.node))
    .map(pose => ({ node: pose.node, translation: [] as number[], rotation: [] as number[], scale: [] as number[] }));
  const steps = Math.ceil(seconds * 60);
  const times = Array.from({ length: steps + 1 }, (_, index) => index * seconds / steps);
  let maxHoofError = 0;
  for (const time of times) {
    restorePose(initial);
    const phase = time / seconds;
    for (const gesture of gestures) {
      gesture.node.setRotation(new Quaternion().fromArray(gesture.node.getRotation()).multiply(new Quaternion()
        .setFromAxisAngle(gesture.axis, curve(phases, gesture.angles, phase) * Math.PI / 180)).normalize().toArray());
    }
    const drop = curve(phases, [0, 0.18, 0.55, 1, 0.8, 0.3, 0.06, 0], phase) * compression;
    const target = pelvisPosition.clone().add(new Vector3(0, -drop, 0));
    const parent = pelvis.getParentNode();
    if (parent) target.applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert());
    pelvis.setTranslation(target.toArray());
    // The boar's short pastern shares weights with the sole; a cattle-sized flex shears it.
    const distalPitch = curve(phases, [0, 0.5, 2, 4, 3, 1, 0, 0], phase) * (boar ? 0.25 : 1) * Math.PI / 180;
    for (const leg of legs) {
      plantHoof(leg, distalPitch);
      for (const contact of leg.contacts) maxHoofError = Math.max(maxHoofError, worldPosition(contact.node).distanceTo(contact.position));
    }
    for (const track of recorded) {
      track.translation.push(...track.node.getTranslation());
      track.rotation.push(...track.node.getRotation());
      track.scale.push(...track.node.getScale());
    }
  }
  restorePose(original);
  if (maxHoofError > 0.0001) throw new Error(`${id} ${name}: hoof constraint error ${maxHoofError} m`);
  removeClip(doc, name);
  const clip = doc.createAnimation(name);
  const bind = new Map(original.map(pose => [pose.node, pose]));
  for (const track of recorded) for (const [property, values] of [["translation", track.translation], ["rotation", track.rotation], ["scale", track.scale]] as const) {
    const width = property === "rotation" ? 4 : 3;
    const varying = values.some((value, index) => Math.abs(value - values[index % width]!) > 1e-7);
    const rest = bind.get(track.node)!;
    const restValues = property === "rotation" ? rest.r : property === "translation" ? rest.t : rest.s;
    if (!varying && values.slice(0, width).every((value, index) => Math.abs(value - restValues[index]!) < 1e-7)) continue;
    addChannel(doc, clip, track.node, property, varying ? times : [0, seconds], varying ? values : [...values.slice(0, width), ...values.slice(0, width)]);
  }
  clip.setExtras({ authored: true, contactNormalized: impact / seconds, hoovedHitVersion: 1,
    description: `${boar ? "short-neck tusk" : "muzzle and horn"} recoil, delayed shoulder compression, three-segment legs and four planted hooves`,
    bodyCompressionMetres: compression, plantedHoofErrorMetres: maxHoofError });
}
