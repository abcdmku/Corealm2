import * as THREE from "three";
import type { TraversalSample } from "../systems/traversalMotion.js";

const worldPosition = (node: THREE.Object3D): THREE.Vector3 => node.getWorldPosition(new THREE.Vector3());
const worldRotation = (node: THREE.Object3D): THREE.Quaternion => node.getWorldQuaternion(new THREE.Quaternion());

function aim(node: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  if (!node.parent) return;
  const origin = worldPosition(node);
  const delta = new THREE.Quaternion().setFromUnitVectors(
    worldPosition(child).sub(origin).normalize(), target.clone().sub(origin).normalize(),
  );
  node.quaternion.copy(worldRotation(node.parent).invert().multiply(worldRotation(node).premultiply(delta))).normalize();
  node.updateMatrixWorld(true);
}

/** Applies a two-bone leg solve while preserving the source foot's orientation and toe articulation. */
function plant(hip: THREE.Bone, knee: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3, forward: THREE.Vector3,
  footRotation: THREE.Quaternion): void {
  const origin = worldPosition(hip);
  const upper = origin.distanceTo(worldPosition(knee));
  const lower = worldPosition(knee).distanceTo(worldPosition(foot));
  const offset = target.clone().sub(origin);
  const distance = Math.min(upper + lower - 0.0001, Math.max(0.0001, offset.length()));
  const axis = offset.normalize();
  const pole = forward.clone().addScaledVector(axis, -forward.dot(axis)).normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const bend = origin.clone().addScaledVector(axis, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  aim(hip, knee, bend);
  aim(knee, foot, target);
  foot.quaternion.copy(worldRotation(knee).invert().multiply(footRotation)).normalize();
  foot.updateMatrixWorld(true);
}

/**
 * Original balance and crouched-slide posing over the production skeleton. The layer restores
 * every edited transform before the next mixer update, including constant animation channels.
 * This prevents accumulated joint rotations and leaves ordinary idle/walk untouched.
 */
export class TraversalPoseLayer {
  private saved: { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];

  restore(): void {
    for (const { bone, position, quaternion } of this.saved) {
      bone.position.copy(position);
      bone.quaternion.copy(quaternion);
    }
    this.saved = [];
  }

  apply(root: THREE.Object3D, bones: ReadonlyMap<string, THREE.Bone>, sample: TraversalSample | null): void {
    if (!sample || sample.concealed || (sample.kind !== "balance" && sample.kind !== "slide" && !(sample.kind === "climb" && sample.support))) return;
    const amount = Math.min(1, sample.progress / 0.16, (1 - sample.progress) / 0.14);
    if (amount <= 0) return;
    const names = ["pelvis", "spine_01", "spine_02", "upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r",
      "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"];
    this.saved = names.flatMap((name) => {
      const bone = bones.get(name);
      return bone ? [{ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }] : [];
    });
    root.updateMatrixWorld(true);
    const orientation = worldRotation(root);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
    const legs = (["l", "r"] as const).flatMap((side) => {
      const hip = bones.get(`thigh_${side}`), knee = bones.get(`calf_${side}`), foot = bones.get(`foot_${side}`);
      if (!hip || !knee || !foot) return [];
      return [{ side, hip, knee, foot, target: worldPosition(foot), rotation: worldRotation(foot) }];
    });
    const pelvis = bones.get("pelvis");
    if (sample.kind === "climb" && sample.support && pelvis?.parent) {
      const support = sample.support;
      const candidates = legs.flatMap((leg) => {
        const ball = bones.get(`ball_${leg.side}`);
        if (!ball) return [];
        const contact = worldPosition(ball);
        const dx = contact.x - support.origin[0], dz = contact.z - support.origin[2];
        const across = dx * Math.cos(support.rotationY) - dz * Math.sin(support.rotationY);
        const along = dx * Math.sin(support.rotationY) + dz * Math.cos(support.rotationY);
        return Math.abs(across) <= support.width / 2 && Math.abs(along) <= support.depth / 2
          ? [{ leg, contact }] : [];
      }).sort((a, b) => a.contact.y - b.contact.y);
      const stance = candidates[0];
      if (stance) {
        const target = stance.leg.target.clone();
        target.y += (support.origin[1] + support.rise + 0.012 - stance.contact.y) * amount;
        // The source climb raises its pelvis too. Lower it only when that would otherwise force
        // the planted leg beyond its measured chain length after the root reaches the platform.
        const reach = worldPosition(stance.leg.hip).distanceTo(worldPosition(stance.leg.knee))
          + worldPosition(stance.leg.knee).distanceTo(worldPosition(stance.leg.foot)) - 0.002;
        for (let iteration = 0; iteration < 2; iteration++) {
          const excess = worldPosition(stance.leg.hip).distanceTo(target) - reach;
          if (excess <= 0) break;
          const lowered = worldPosition(pelvis).add(new THREE.Vector3(0, -excess - 0.002, 0));
          pelvis.position.copy(pelvis.parent.worldToLocal(lowered));
          pelvis.updateMatrixWorld(true);
        }
        plant(stance.leg.hip, stance.leg.knee, stance.leg.foot, target, forward, stance.leg.rotation);
      }
      root.updateMatrixWorld(true);
      return;
    }
    if (sample.kind === "slide" && pelvis?.parent) {
      const crouch = worldPosition(pelvis).add(new THREE.Vector3(0, -0.3 * amount, 0))
        .addScaledVector(forward, -0.07 * amount);
      pelvis.position.copy(pelvis.parent.worldToLocal(crouch));
      pelvis.updateMatrixWorld(true);
    }
    for (const leg of legs) {
      if (sample.kind === "balance") {
        const rootPosition = worldPosition(root);
        const lateral = leg.target.clone().sub(rootPosition).dot(right);
        const wanted = leg.side === "l" ? 0.065 : -0.065;
        leg.target.addScaledVector(right, (wanted - lateral) * amount);
      }
      plant(leg.hip, leg.knee, leg.foot, leg.target, forward, leg.rotation);
    }
    for (const [side, sign] of [["l", 1], ["r", -1]] as const) {
      const arm = bones.get(`upperarm_${side}`), elbow = bones.get(`lowerarm_${side}`), hand = bones.get(`hand_${side}`);
      if (!arm || !elbow || !hand) continue;
      const shoulder = worldPosition(arm);
      const target = shoulder.clone().addScaledVector(right, sign * (sample.kind === "balance" ? 0.46 : 0.25))
        .addScaledVector(forward, sample.kind === "balance" ? 0.06 : 0.26)
        .add(new THREE.Vector3(0, sample.kind === "balance" ? -0.10 : -0.28, 0));
      const before = arm.quaternion.clone();
      aim(arm, elbow, target);
      arm.quaternion.slerpQuaternions(before, arm.quaternion.clone(), amount);
      arm.updateMatrixWorld(true);
      const handTarget = worldPosition(elbow).addScaledVector(right, sign * 0.22)
        .addScaledVector(forward, 0.10).add(new THREE.Vector3(0, -0.04, 0));
      const elbowBefore = elbow.quaternion.clone();
      aim(elbow, hand, handTarget);
      elbow.quaternion.slerpQuaternions(elbowBefore, elbow.quaternion.clone(), amount);
      elbow.updateMatrixWorld(true);
    }
    root.updateMatrixWorld(true);
  }
}
