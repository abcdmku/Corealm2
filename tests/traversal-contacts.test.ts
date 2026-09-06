import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadGeometryGlb } from "../tools/player-locomotion-audit.js";
import { TraversalPoseLayer } from "../game/src/render/traversalPose.js";
import { CharacterRig } from "../game/src/render/characterRig.js";
import { buildTraversalContactAsset } from "../game/src/render/traversalContactAssets.js";
import { TRAVERSAL_CONTACTS, traversalContactHeight, type ContactTraversalKind } from "../game/src/systems/traversalContacts.js";
import type { TraversalSample } from "../game/src/systems/traversalMotion.js";

let body: THREE.Object3D;
let idle: THREE.AnimationClip;
let climb: THREE.AnimationClip;
beforeAll(async () => {
  const [model, library, traversalLibrary] = await Promise.all([
    loadGeometryGlb("game/public/assets/models/character/base_male.glb"),
    loadGeometryGlb("game/public/assets/models/animation/animation_library_1.glb"),
    loadGeometryGlb("game/public/assets/models/animation/animation_library_2.glb"),
  ]);
  body = model.scene;
  idle = library.animations.find((clip) => clip.name === "Idle_Loop")!;
  climb = traversalLibrary.animations.find((clip) => clip.name === "ClimbUp_1m")!;
});

describe("compact traversal physical contacts", () => {
  it("plants the actual source climbing stance on the platform top", () => {
    const root = body.clone(true);
    root.position.y = 1;
    const bones = new Map<string, THREE.Bone>();
    root.traverse((node) => { if ((node as THREE.Bone).isBone) bones.set(node.name, node as THREE.Bone); });
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(climb).play();
    mixer.setTime(climb.duration * 0.6);
    root.updateMatrixWorld(true);
    const layer = new TraversalPoseLayer();
    layer.apply(root, bones, { kind: "climb", progress: 0.5, phase: "travel", position: [0, 1, 0],
      facingRad: 0, concealed: false, curtainOpacity: 0,
      support: { origin: [0, 0, 0], width: 1.8, depth: 1.2, rise: 1, rotationY: 0 } });
    const lowest = Math.min(...["ball_l", "ball_r"].map((name) => bones.get(name)!.getWorldPosition(new THREE.Vector3()).y));
    expect(lowest).toBeCloseTo(1.012, 2);
    layer.restore();
  });
  it("frees both hands during traversal and restores each attachment's previous visibility", () => {
    const rig = new CharacterRig({} as never) as any;
    const weapon = new THREE.Group();
    const shield = new THREE.Group();
    shield.visible = false;
    rig.boneAttachments.set("mainHand", weapon);
    rig.boneAttachments.set("offHand", shield);
    const sample: TraversalSample = { kind: "climb", progress: 0.5, phase: "travel", position: [0, 1, 0],
      facingRad: 0, concealed: false, curtainOpacity: 0 };
    rig.syncTraversalPose(sample);
    rig.syncTraversalPose(sample);
    expect(weapon.visible).toBe(false);
    expect(shield.visible).toBe(false);
    rig.syncTraversalPose(null);
    expect(weapon.visible).toBe(true);
    expect(shield.visible).toBe(false);
  });
  it.each(Object.keys(TRAVERSAL_CONTACTS) as ContactTraversalKind[])("builds %s at its production dimensions", (kind) => {
    const object = buildTraversalContactAsset(kind);
    const bounds = new THREE.Box3().setFromObject(object);
    const d = TRAVERSAL_CONTACTS[kind];
    expect(bounds.max.y).toBeLessThanOrEqual(d.rise + 0.03);
    expect(bounds.min.y).toBeLessThanOrEqual(0.01);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(d.depth, 1);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(d.width, 1);
  });

  it.each(["climb", "balance", "slide"] as const)("keeps the %s path on its physical top", (kind) => {
    const { depth, rise } = TRAVERSAL_CONTACTS[kind];
    for (let i = 0; i <= 100; i++) {
      const along = -depth / 2 + depth * i / 100;
      const expectedTop = kind === "slide" ? rise * (0.5 - along / depth) + 0.025 : rise;
      expect(traversalContactHeight(kind, along, depth, rise)).toBeCloseTo(expectedTop, 6);
    }
    expect(traversalContactHeight(kind, -2.2, depth, rise)).toBe(0);
    expect(traversalContactHeight(kind, 2.2, depth, rise)).toBe(0);
  });

  it("crouches the actual production skeleton without moving planted ankles or leaking poses", () => {
    const root = body.clone(true);
    const bones = new Map<string, THREE.Bone>();
    root.traverse((node) => { if ((node as THREE.Bone).isBone) bones.set(node.name, node as THREE.Bone); });
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(idle).play();
    mixer.setTime(0.2);
    root.updateMatrixWorld(true);
    const feet = [bones.get("foot_l")!, bones.get("foot_r")!];
    const before = feet.map((foot) => foot.getWorldPosition(new THREE.Vector3()));
    const pelvisBefore = bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y;
    const original = [...bones.values()].map((bone) => [bone.position.toArray(), bone.quaternion.toArray()]);
    const layer = new TraversalPoseLayer();
    const sample: TraversalSample = { kind: "slide", progress: 0.5, phase: "travel", position: [0, 0, 0],
      facingRad: 0, concealed: false, curtainOpacity: 0 };
    layer.apply(root, bones, sample);
    expect(bones.get("pelvis")!.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(pelvisBefore - 0.3, 5);
    feet.forEach((foot, i) => expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(before[i]!)).toBeLessThan(0.002));
    layer.restore();
    expect([...bones.values()].map((bone) => [bone.position.toArray(), bone.quaternion.toArray()])).toEqual(original);
    layer.apply(root, bones, sample);
    feet.forEach((foot, i) => expect(foot.getWorldPosition(new THREE.Vector3()).distanceTo(before[i]!)).toBeLessThan(0.002));
    layer.restore();
  });
});
