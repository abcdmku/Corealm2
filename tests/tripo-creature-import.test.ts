import { Document } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { repairHumanoidWeights, restoreGeometryBasis, retargetCreatureMotion, retargetHumanoid, type CreatureMotionProfile } from "../tools/tripo-creatures/retarget.js";
import { addChannel, applyClip, storedPose } from "../tools/creature-motion/pose.js";
import { deformedBounds } from "../tools/creature-motion/validate-deformation.js";

const vertices = [.5, 1, .25, .8, 1.1, .3, .6, 1.4, .7, .2, 1.2, .4];

function sharedMesh(secondNodeX = 0) {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType("VEC3").setArray(new Float32Array(vertices)).setBuffer(buffer);
  const normals = doc.createAccessor().setType("VEC3").setArray(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0])).setBuffer(buffer);
  const tangents = doc.createAccessor().setType("VEC4").setArray(new Float32Array([0, 0, 1, -1, 0, 0, 1, -1, 0, 0, 1, -1, 0, 0, 1, -1])).setBuffer(buffer);
  const mesh = doc.createMesh();
  for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", positions).setAttribute("NORMAL", normals).setAttribute("TANGENT", tangents)
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(triangle)).setBuffer(buffer)));
  }
  doc.createScene().addChild(doc.createNode().setMesh(mesh)).addChild(doc.createNode().setMesh(mesh).setTranslation([secondNodeX, 0, 0]));
  const reference = new Document(), referenceBuffer = reference.createBuffer(), referenceScene = reference.createScene();
  for (const node of doc.getRoot().listNodes()) {
    const transform = new Matrix4().makeRotationY(Math.PI / 2).multiply(new Matrix4().fromArray(node.getWorldMatrix()));
    const values = Array.from({ length: 4 }, (_, i) => new Vector3().fromArray(positions.getElement(i, [])).applyMatrix4(transform).toArray()).flat();
    referenceScene.addChild(reference.createNode().setMesh(reference.createMesh().addPrimitive(reference.createPrimitive()
      .setAttribute("POSITION", reference.createAccessor().setType("VEC3").setArray(new Float32Array(values)).setBuffer(referenceBuffer)))));
  }
  return { doc, reference, positions, normals, tangents };
}

describe("Tripo geometry basis repair", () => {
  it("rotates shared primitive and mesh-instance accessors only once", () => {
    const { doc, reference, positions, normals, tangents } = sharedMesh();
    expect(restoreGeometryBasis(doc, reference).degrees).toBe(90);
    for (let i = 0; i < 4; i++) {
      const expected = [vertices[i * 3 + 2]!, vertices[i * 3 + 1]!, -vertices[i * 3]!];
      positions.getElement(i, []).forEach((value, component) => expect(value).toBeCloseTo(expected[component]!, 6));
      normals.getElement(i, []).forEach((value, component) => expect(value).toBeCloseTo([0, 0, -1][component]!, 6));
      tangents.getElement(i, []).forEach((value, component) => expect(value).toBeCloseTo([1, 0, 0, -1][component]!, 6));
    }
  });

  it("rejects conflicting shared mesh transforms before mutating any attributes", () => {
    const { doc, reference, positions, normals, tangents } = sharedMesh(2);
    const before = [positions, normals, tangents].map(accessor => Array.from(accessor.getArray()!));
    expect(() => restoreGeometryBasis(doc, reference)).toThrow(/Shared POSITION accessor requires conflicting/);
    [positions, normals, tangents].forEach((accessor, i) => expect(Array.from(accessor.getArray()!)).toEqual(before[i]));
  });

  it("rejects a nonidentity skinned mesh transform before anatomical weight repair", () => {
    const { doc, positions } = sharedMesh(2), buffer = doc.getRoot().listBuffers()[0]!;
    const hips = doc.createNode("mixamorig:Hips"), spine = doc.createNode("mixamorig:Spine").setTranslation([0, 1, 0]);
    hips.addChild(spine); doc.getRoot().listScenes()[0]!.addChild(hips);
    const inverseBinds = doc.createAccessor().setType("MAT4").setBuffer(buffer).setArray(new Float32Array([
      ...new Matrix4().elements, ...new Matrix4().makeTranslation(0, -1, 0).elements,
    ]));
    const skin = doc.createSkin().addJoint(hips).addJoint(spine).setInverseBindMatrices(inverseBinds);
    const joints = doc.createAccessor().setType("VEC4").setBuffer(buffer).setArray(new Uint16Array(16));
    const weights = doc.createAccessor().setType("VEC4").setBuffer(buffer).setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
    for (const node of doc.getRoot().listNodes()) if (node.getMesh()) {
      node.setSkin(skin);
      for (const primitive of node.getMesh()!.listPrimitives()) primitive.setAttribute("JOINTS_0", joints).setAttribute("WEIGHTS_0", weights);
    }
    const before = [positions, weights, joints].map(accessor => Array.from(accessor.getArray()!));
    expect(() => repairHumanoidWeights(doc)).toThrow(/requires identity skinned mesh world transforms/);
    [positions, weights, joints].forEach((accessor, i) => expect(Array.from(accessor.getArray()!)).toEqual(before[i]));
  });
});

function motionRig(prefix: string, bent = false) {
  const doc = new Document(); doc.createBuffer();
  const wrapper = doc.createNode(`${prefix}wrapper`), hips = doc.createNode(`${prefix}hips`).setTranslation([0, 1, 0]);
  const arm = doc.createNode(`${prefix}arm`).setTranslation([.5, .6, 0]);
  const elbow = doc.createNode(`${prefix}elbow`).setTranslation(bent ? [.8, -.6, 0] : [1, 0, 0]);
  const hand = doc.createNode(`${prefix}hand`).setTranslation(bent ? [.8, .6, 0] : [1, 0, 0]);
  const accessory = doc.createNode(`${prefix}accessory`).setTranslation([.1, 0, 0]);
  doc.createScene().addChild(wrapper); wrapper.addChild(hips); hips.addChild(arm); arm.addChild(elbow); elbow.addChild(hand); hand.addChild(accessory);
  return { doc, wrapper, hips, arm, elbow, hand, accessory };
}

function motionProfile(overrides: Partial<CreatureMotionProfile> = {}): CreatureMotionProfile {
  return { mapping: { thips: "ships", tarm: "sarm", telbow: "selbow", thand: "shand" },
    directionChildren: { tarm: "telbow", telbow: "thand" }, sourceToTargetRotation: [0, 0, 0, 1],
    root: { target: "thips", translationScale: 1, horizontal: "in-place" }, clips: { Idle: { source: "rest", loop: true } }, ...overrides };
}

const worldPosition = (node: ReturnType<Document["createNode"]>) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
const poseValues = (doc: Document) => storedPose(doc).map(({ node, t, r, s }) => ({ name: node.getName(), t, r, s }));

describe("semantic creature motion transfer", () => {
  it("transfers a neutral studio arm pose onto bent target arms through rotated and scaled parents", () => {
    const source = motionRig("s"), target = motionRig("t", true);
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    target.wrapper.setRotation(yaw.toArray()).setScale([2, 2, 2]);
    const clip = source.doc.createAnimation("rest"), down = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2).toArray();
    addChannel(source.doc, clip, source.arm, "rotation", [0, 1], [...down, ...down]);
    const targetBefore = poseValues(target.doc), sourceBefore = poseValues(source.doc);
    retargetCreatureMotion(target.doc, source.doc, motionProfile({ sourceToTargetRotation: yaw.toArray() }));
    expect(poseValues(target.doc)).toEqual(targetBefore); expect(poseValues(source.doc)).toEqual(sourceBefore);
    applyClip(target.doc.getRoot().listAnimations()[0]!, .5);
    const upper = worldPosition(target.elbow).sub(worldPosition(target.arm));
    const lower = worldPosition(target.hand).sub(worldPosition(target.elbow));
    expect(upper.length()).toBeCloseTo(2, 6); expect(lower.length()).toBeCloseTo(2, 6);
    expect(upper.normalize().distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
    expect(lower.normalize().distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
  });

  it("removes loop travel in world space while retaining sway and writes a full reset pose", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("walk");
    addChannel(source.doc, clip, source.hips, "translation", [0, .5, 1], [0, 1, 0, .1, 1.2, 1.2, 0, 1, 2]);
    const report = retargetCreatureMotion(target.doc, source.doc, motionProfile({ root: { target: "thips", translationScale: 2, horizontal: "in-place" }, clips: { Walk: { source: "walk", loop: true } } }));
    const output = target.doc.getRoot().listAnimations()[0]!;
    expect(output.listChannels()).toHaveLength(target.doc.getRoot().listNodes().length * 3);
    expect(report.clips[0]!.removedHorizontalTravel).toEqual([0, 0, 4]);
    target.accessory.setScale([4, 5, 6]); applyClip(output, .5);
    expect(target.accessory.getScale()).toEqual([1, 1, 1]);
    expect(worldPosition(target.hips).x).toBeCloseTo(.2, 6);
    expect(worldPosition(target.hips).y).toBeCloseTo(1.4, 6);
    expect(worldPosition(target.hips).z).toBeCloseTo(.4, 6);
    applyClip(output, 0); const first = poseValues(target.doc);
    applyClip(output, 1); expect(poseValues(target.doc)).toEqual(first);
  });

  it("retimes one-shot motion and holds the actual donor ending without flattening its travel", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("fall");
    addChannel(source.doc, clip, source.hips, "translation", [0, 2], [0, 1, 0, 0, .2, 1]);
    const report = retargetCreatureMotion(target.doc, source.doc, motionProfile({ clips: { Death: { source: "fall", duration: .8, holdLastSeconds: .7 } } }));
    const output = target.doc.getRoot().listAnimations()[0]!;
    expect(report.clips[0]!.seconds).toBeCloseTo(1.5);
    applyClip(output, .9); const final = poseValues(target.doc);
    expect(target.hips.getTranslation()[1]).toBeCloseTo(.2); expect(target.hips.getTranslation()[2]).toBeCloseTo(1);
    applyClip(output, 1.5); expect(poseValues(target.doc)).toEqual(final);
  });

  it("limits floor correction impulses without changing donor motion, penetrating the floor or disturbing the held corpse", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("fall");
    addChannel(source.doc, clip, source.hips, "translation", [0, .45, .5, .55, 1], [0, 1, 0, 0, 1, 0, 0, .3, 0, 0, 1, 0, 0, 1, 0]);
    const positions = target.doc.createAccessor().setType("VEC3").setBuffer(target.doc.getRoot().listBuffers()[0]!)
      .setArray(new Float32Array([0, 0, 0, .1, 0, 0, 0, .1, 0]));
    target.accessory.setMesh(target.doc.createMesh().addPrimitive(target.doc.createPrimitive().setAttribute("POSITION", positions)));
    retargetCreatureMotion(target.doc, source.doc, motionProfile({ samplesPerSecond: 100, grounding: { floor: .01 },
      clips: { Death: { source: "fall", holdLastSeconds: .5, groundingMaxSpeedMps: 2 } } }));
    const output = target.doc.getRoot().listAnimations()[0]!, ground = target.doc.getRoot().listNodes().find(node => node.getName() === "corealm_retarget_ground")!;
    let previous: number | undefined;
    for (let i = 0; i <= 200; i++) {
      applyClip(output, i / 200); applyClip(clip, i / 200);
      const lift = ground.getTranslation()[1];
      if (previous !== undefined) expect(Math.abs(lift - previous)).toBeLessThanOrEqual(2 / 200 + 1e-6);
      expect(target.hips.getTranslation()[1]).toBeCloseTo(source.hips.getTranslation()[1], 5);
      expect(deformedBounds(target.doc).min[1]).toBeGreaterThanOrEqual(.01 - 1e-6);
      previous = lift;
    }
    expect(deformedBounds(target.doc).min[1]).toBeCloseTo(.01, 6);
    const corpse = poseValues(target.doc);
    applyClip(output, 1.5); expect(poseValues(target.doc)).toEqual(corpse);
  });

  it("refines support between keys when a fast limb sweeps below both endpoint poses", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("fall");
    const angles = [0, -80, -100, -100].flatMap(degrees => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), degrees * Math.PI / 180).toArray());
    addChannel(source.doc, clip, source.arm, "rotation", [0, .5, 16 / 30, 1], angles);
    const positions = target.doc.createAccessor().setType("VEC3").setBuffer(target.doc.getRoot().listBuffers()[0]!)
      .setArray(new Float32Array([0, 0, 0, .1, 0, 0, 0, .1, 0]));
    target.accessory.setMesh(target.doc.createMesh().addPrimitive(target.doc.createPrimitive().setAttribute("POSITION", positions)));
    retargetCreatureMotion(target.doc, source.doc, motionProfile({ grounding: { floor: 0 },
      clips: { Death: { source: "fall", groundingMaxSpeedMps: 100 } } }));
    const output = target.doc.getRoot().listAnimations()[0]!;
    const ground = output.listChannels().find(channel => channel.getTargetNode()!.getName() === "corealm_retarget_ground" && channel.getTargetPath() === "translation")!;
    const arm = output.listChannels().find(channel => channel.getTargetNode() === target.arm && channel.getTargetPath() === "rotation")!;
    expect(ground.getSampler()!.getInput()!.getCount()).toBeGreaterThan(arm.getSampler()!.getInput()!.getCount());
    expect(arm.getSampler()!.getInput()!.getCount()).toBe(31);
    for (let i = 0; i <= 400; i++) {
      applyClip(output, .5 + i / 12000);
      expect(deformedBounds(target.doc).min[1]).toBeGreaterThanOrEqual(-.0005);
    }
  });

  it("rejects ambiguous anatomy and restores both poses on a failed sampling pass", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("rest");
    const sampler = source.doc.createAnimationSampler().setInterpolation("CUBICSPLINE")
      .setInput(source.doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(source.doc.getRoot().listBuffers()[0]!))
      .setOutput(source.doc.createAccessor().setType("VEC3").setArray(new Float32Array(18)).setBuffer(source.doc.getRoot().listBuffers()[0]!));
    clip.addSampler(sampler).addChannel(source.doc.createAnimationChannel().setTargetNode(source.hips).setTargetPath("translation").setSampler(sampler));
    const targetBefore = poseValues(target.doc), sourceBefore = poseValues(source.doc);
    expect(() => retargetCreatureMotion(target.doc, source.doc, motionProfile({ grounding: { floor: 0 } }))).toThrow(/cubic source clip/);
    expect(poseValues(target.doc)).toEqual(targetBefore); expect(poseValues(source.doc)).toEqual(sourceBefore);
    expect(target.doc.getRoot().listAnimations()).toHaveLength(0);
    target.wrapper.addChild(target.doc.createNode("tarm"));
    expect(() => retargetCreatureMotion(target.doc, source.doc, motionProfile())).toThrow(/Ambiguous target node tarm/);
  });

  it("rejects nonuniform animated ancestors before changing either rig or its clips", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("rest");
    addChannel(source.doc, clip, source.arm, "rotation", [0, 1], [0, 0, 0, 1, 0, 0, .5, Math.sqrt(.75)]);
    target.wrapper.setScale([2, 1, 1]);
    const old = target.doc.createAnimation("old"), targetBefore = poseValues(target.doc), sourceBefore = poseValues(source.doc);
    expect(() => retargetCreatureMotion(target.doc, source.doc, motionProfile({ replaceAnimations: true, grounding: { floor: 0 } }))).toThrow(/nonuniform/);
    expect(target.doc.getRoot().listAnimations()).toEqual([old]);
    expect(poseValues(target.doc)).toEqual(targetBefore); expect(poseValues(source.doc)).toEqual(sourceBefore);
  });

  it("preserves target lengths while following actual donor segments under animated affine stretch", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("stretch");
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .7);
    source.wrapper.setRotation(yaw.toArray()).setScale([2, 1, 1]);
    target.wrapper.setRotation(yaw.toArray()).setScale([1.5, 1.5, 1.5]);
    const bend = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 3).toArray();
    addChannel(source.doc, clip, source.arm, "rotation", [0, 1], [0, 0, 0, 1, ...bend]);
    addChannel(source.doc, clip, source.wrapper, "scale", [0, 1], [2, 1, 1, 1, 2, 1]);
    const targetBefore = poseValues(target.doc), sourceBefore = poseValues(source.doc);
    retargetCreatureMotion(target.doc, source.doc, motionProfile({ clips: { Attack: { source: "stretch" } } }));
    expect(poseValues(target.doc)).toEqual(targetBefore); expect(poseValues(source.doc)).toEqual(sourceBefore);
    const output = target.doc.getRoot().listAnimations()[0]!;
    for (const time of [0, .5, 1]) {
      applyClip(clip, time); applyClip(output, time);
      const expected = worldPosition(source.elbow).sub(worldPosition(source.arm)).normalize();
      const actual = worldPosition(target.elbow).sub(worldPosition(target.arm));
      expect(actual.length()).toBeCloseTo(1.5, 6);
      expect(actual.normalize().distanceTo(expected)).toBeLessThan(1e-6);
    }
  });

  it("does not revive disconnected retired rig nodes in complete output poses", () => {
    const source = motionRig("s"), target = motionRig("t"), clip = source.doc.createAnimation("rest");
    const orphan = target.doc.createNode("tarm").setTranslation([99, 99, 99]);
    addChannel(source.doc, clip, source.arm, "rotation", [0, 1], [0, 0, 0, 1, 0, 0, .5, Math.sqrt(.75)]);
    retargetCreatureMotion(target.doc, source.doc, motionProfile());
    expect(target.doc.getRoot().listAnimations()[0]!.listChannels().some(channel => channel.getTargetNode() === orphan)).toBe(false);
    expect(orphan.getTranslation()).toEqual([99, 99, 99]);
  });

  it("imports exactly the six gameplay states with one Hit by default", () => {
    const doc = new Document(), donor = new Document(), buffer = doc.createBuffer(); donor.createBuffer();
    const armature = doc.createNode("Armature"); doc.createScene().addChild(armature);
    const sourceScene = donor.createScene();
    const anatomy = [
      ["Hips", "pelvis", [0, 1, 0]], ["Spine", "spine_01", [0, 1.2, 0]],
      ["LeftUpLeg", "thigh_l", [.2, 1, 0]], ["LeftLeg", "calf_l", [.2, .5, 0]],
      ["LeftFoot", "foot_l", [.2, 0, 0]], ["LeftToeBase", "ball_l", [.2, 0, .2]],
      ["RightUpLeg", "thigh_r", [-.2, 1, 0]], ["RightLeg", "calf_r", [-.2, .5, 0]],
      ["RightFoot", "foot_r", [-.2, 0, 0]], ["RightToeBase", "ball_r", [-.2, 0, .2]],
    ] as const;
    const skin = doc.createSkin(), inverse: number[] = [];
    for (const [name, sourceName, point] of anatomy) {
      const node = doc.createNode(`mixamorig:${name}`).setTranslation([...point]); armature.addChild(node); skin.addJoint(node);
      inverse.push(...new Matrix4().makeTranslation(point[0], point[1], point[2]).invert().elements);
      sourceScene.addChild(donor.createNode(sourceName).setTranslation([...point]));
    }
    skin.setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(new Float32Array(inverse)).setBuffer(buffer));
    const primitive = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0, 2, 0])).setBuffer(buffer))
      .setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(new Uint16Array(8)).setBuffer(buffer))
      .setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0])).setBuffer(buffer));
    doc.getRoot().listScenes()[0]!.addChild(doc.createNode("mesh").setMesh(doc.createMesh().addPrimitive(primitive)).setSkin(skin));
    for (const name of ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Punch_Jab", "Hit_Chest", "Death01"]) {
      const take = donor.createAnimation(name);
      addChannel(donor, take, donor.getRoot().listNodes().find(node => node.getName() === "pelvis")!, "translation", [0, .1], [0, 1, 0, 0, 1.01, 0]);
    }
    retargetHumanoid(doc, donor);
    expect(doc.getRoot().listAnimations().map(clip => clip.getName())).toEqual(["Idle", "Walk", "Run", "Attack", "Hit", "Death"]);
  });
});
