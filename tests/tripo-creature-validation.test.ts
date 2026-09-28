import { Document } from "@gltf-transform/core";
import { Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { addChannel } from "../tools/creature-motion/pose.js";
import { REQUIRED_CREATURE_STATES, validateCreatureDocument } from "../tools/tripo-creatures/validation.js";
import { normalizeImportedCreatureClips } from "../tools/tripo-creatures/import.js";

function creature() {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  const root = doc.createNode("BodyRoot"), limb = doc.createNode("Limb").setTranslation([0, .5, 0]);
  root.addChild(limb); scene.addChild(root);
  const skin = doc.createSkin().addJoint(root).addJoint(limb).setInverseBindMatrices(doc.createAccessor().setType("MAT4").setBuffer(buffer)
    .setArray(new Float32Array([...new Matrix4().elements, ...new Matrix4().makeTranslation(0, -.5, 0).elements])));
  const positions = [-.2, 0, -.2, .2, 0, -.2, -.2, 0, .2, .2, 0, .2, -.2, 1, -.2, .2, 1, -.2, -.2, 1, .2, .2, 1, .2];
  const accessor = (type: "VEC3" | "VEC4", values: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(values).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute("POSITION", accessor("VEC3", new Float32Array(positions)))
    .setAttribute("JOINTS_0", accessor("VEC4", new Uint16Array(Array.from({ length: 8 }, (_, i) => [i < 4 ? 0 : 1, 0, 0, 0]).flat())))
    .setAttribute("WEIGHTS_0", accessor("VEC4", new Float32Array(Array.from({ length: 8 }, () => [1, 0, 0, 0]).flat())));
  primitive.setIndices(doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Uint16Array([
    0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0, 2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7,
  ])));
  scene.addChild(doc.createNode("Body").setSkin(skin).setMesh(doc.createMesh().addPrimitive(primitive)));
  for (const name of REQUIRED_CREATURE_STATES) {
    const angles = name === "Death" ? [0, .6, .6] : [0, .1, 0];
    addChannel(doc, doc.createAnimation(name), limb, "rotation", [0, .5, 1],
      angles.flatMap(angle => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray()));
  }
  const clip = (name: string) => doc.getRoot().listAnimations().find(animation => animation.getName() === name)!;
  return { doc, root, limb, skin, primitive, clip };
}

describe("creature import rejection gate", () => {
  it("samples every state, permits a held death ending and preserves the default pose", () => {
    const f = creature(), before = f.doc.getRoot().listNodes().map(node => node.getMatrix());
    const report = validateCreatureDocument(f.doc);
    expect(report.problems).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.requiresVisualReview).toBe(true);
    expect(report.states.map(state => state.name)).toEqual([...REQUIRED_CREATURE_STATES]);
    expect(report.states.every(state => state.samples >= 9 && state.maximumVertexMotion > 0)).toBe(true);
    expect(f.doc.getRoot().listNodes().map(node => node.getMatrix())).toEqual(before);
  });

  it("rejects a missing lifecycle state", () => {
    const f = creature(); f.clip("Walk").dispose();
    expect(validateCreatureDocument(f.doc).problems).toContain("Missing usable Walk clip");
  });

  it("removes incoming directional hits and directional aliases before validating the six gameplay states", () => {
    const f = creature();
    f.clip("Idle").setName("IdleNative");
    for (const name of ["HitLeft", "HitRight", "Stagger"]) f.doc.createAnimation(name);
    normalizeImportedCreatureClips(f.doc, { IdleNative: "Idle", HitLeft: "Hit", Stagger: "HitRight" });
    expect(f.doc.getRoot().listAnimations().map(clip => clip.getName())).toEqual([...REQUIRED_CREATURE_STATES]);
    expect(validateCreatureDocument(f.doc).passed).toBe(true);
  });

  it("rejects named clips with no rendered motion, including motion on an unweighted bone", () => {
    const f = creature(), unused = f.doc.createNode("UnusedJoint"); f.root.addChild(unused);
    f.clip("Idle").listChannels()[0]!.setTargetNode(unused);
    expect(validateCreatureDocument(f.doc).problems).toContain("Idle: no visible vertex motion");
    f.clip("Idle").listChannels()[0]!.setTargetNode(f.limb);
    f.clip("Idle").listSamplers()[0]!.getOutput()!.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(validateCreatureDocument(f.doc).problems).toContain("Idle: no visible vertex motion");
  });

  it.each(["orphan", "other scene"])("ignores motion on a retired mesh in an %s when the visible body is static", location => {
    const f = creature(), retired = f.doc.createNode("RetiredMesh").setMesh(f.doc.getRoot().listMeshes()[0]!);
    if (location === "other scene") f.doc.createScene("RetiredScene").addChild(retired);
    for (const name of REQUIRED_CREATURE_STATES) {
      f.clip(name).listSamplers()[0]!.getOutput()!.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
      addChannel(f.doc, f.clip(name), retired, "translation", [0, .5, 1], [0, 0, 0, .1, 0, 0, 0, 0, 0]);
    }
    const report = validateCreatureDocument(f.doc);
    expect(report.passed).toBe(false);
    expect(report.problems).toEqual(REQUIRED_CREATURE_STATES.map(name => `${name}: no visible vertex motion`));
    expect(report.states.every(state => state.maximumVertexMotion === 0)).toBe(true);
  });

  it("rejects an out-of-range skin index even in a zero-weight slot without throwing", () => {
    const f = creature(), indices = f.primitive.getAttribute("JOINTS_0")!;
    indices.setElement(0, [0, 900, 0, 0]);
    expect(validateCreatureDocument(f.doc).problems).toContain("Body: invalid skin vertex 0");
  });

  it.each([[-.1, 1.1, 0, 0], [.4, 0, 0, 0], [NaN, 0, 0, 0]].map(values => ({ values })))("rejects invalid skin weights $values", ({ values }) => {
    const f = creature(); f.primitive.getAttribute("WEIGHTS_0")!.setElement(0, values);
    expect(validateCreatureDocument(f.doc).passed).toBe(false);
  });

  it("rejects singular inverse bindings", () => {
    const f = creature(); f.skin.getInverseBindMatrices()!.setElement(0, Array(16).fill(0));
    expect(validateCreatureDocument(f.doc).problems).toContain("Body: invalid inverse bind 0");
  });

  it("rejects malformed times and nonunit quaternion keys", () => {
    const f = creature(), sampler = f.clip("Idle").listSamplers()[0]!;
    sampler.getInput()!.setArray(new Float32Array([0, .5, .5]));
    sampler.getOutput()!.setElement(1, [0, 0, 0, 0]);
    const report = validateCreatureDocument(f.doc);
    expect(report.problems).toContain("Idle/Limb/rotation: invalid key times");
    expect(report.problems).toContain("Idle/Limb/rotation: nonunit rotation key");
  });

  it.each([0, 20])("rejects catastrophic animated scale %s and restores the authored transforms", scale => {
    const f = creature();
    addChannel(f.doc, f.clip("Attack"), f.root, "scale", [0, .5, 1], [1, 1, 1, scale, scale, scale, 1, 1, 1]);
    const report = validateCreatureDocument(f.doc);
    expect(report.passed).toBe(false);
    expect(report.problems.some(problem => /collapses|exceeds four/.test(problem))).toBe(true);
    expect(f.root.getScale()).toEqual([1, 1, 1]);
  });

  it("samples the final STEP key instead of hiding a broken loop endpoint", () => {
    const f = creature(), sampler = f.clip("Walk").listSamplers()[0]!;
    sampler.setInterpolation("STEP");
    sampler.getOutput()!.setElement(2, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.5).toArray());
    expect(validateCreatureDocument(f.doc).problems).toContain("Walk: loop endpoint jumps more than 15% of the body span");
  });

  it("samples brief malformed poses between the uniform audit phases", () => {
    const f = creature();
    addChannel(f.doc, f.clip("Attack"), f.root, "scale", [0, .136, .137, .138, 1],
      [1, 1, 1, 1, 1, 1, 20, 20, 20, 1, 1, 1, 1, 1, 1]);
    expect(validateCreatureDocument(f.doc).problems).toContain("Attack: deformed span exceeds four times the default");
  });

  it("rejects connected vertices pulled apart by unrelated joints despite normalized weights and modest bounds", () => {
    const f = creature(), positions = f.primitive.getAttribute("POSITION")!, indices = f.primitive.getAttribute("JOINTS_0")!;
    // The top front edge is only .02 long, but one endpoint is attached to the lower body.
    positions.setElement(4, [-.01, 1, -.2]); positions.setElement(5, [.01, 1, -.2]);
    indices.setElement(4, [0, 0, 0, 0]); indices.setElement(5, [1, 0, 0, 0]);
    addChannel(f.doc, f.clip("Attack"), f.limb, "translation", [0, .5, 1], [0, .5, 0, .3, .5, 0, 0, .5, 0]);
    const report = validateCreatureDocument(f.doc), attack = report.states.find(state => state.name === "Attack")!;
    expect(attack.maximumSpanRatio).toBeLessThan(1.5);
    expect(attack.edgeStretchP99).toBeGreaterThan(10);
    expect(report.problems).toContain("Attack: connected skin edges stretch over 3x across at least 1% of the mesh");
  });

  it("bounds dense-bake sampling and still checks brief channel extrema", () => {
    const f = creature(), times = Array.from({ length: 1001 }, (_, i) => i / 1000);
    addChannel(f.doc, f.clip("Attack"), f.root, "scale", times,
      times.flatMap((_, i) => i === 137 ? [20, 20, 20] : [1, 1, 1]));
    const report = validateCreatureDocument(f.doc), attack = report.states.find(state => state.name === "Attack")!;
    expect(attack.samples).toBeLessThanOrEqual(121);
    expect(attack.samples).toBeGreaterThanOrEqual(9);
    expect(report.problems).toContain("Attack: deformed span exceeds four times the default");
  });

  it.each([false, true])("rejects a dense cubic scale spike with constant keys, balanced tangents=%s", balanced => {
    const f = creature(), times = Array.from({ length: 1001 }, (_, i) => i / 1000);
    addChannel(f.doc, f.clip("Attack"), f.root, "scale", times, times.flatMap(() => [1, 1, 1]));
    const sampler = f.clip("Attack").listSamplers().at(-1)!;
    sampler.setInterpolation("CUBICSPLINE");
    const values = new Float32Array(times.flatMap(() => [0, 0, 0, 1, 1, 1, 0, 0, 0]));
    values.set([2e6, 2e6, 2e6], 137 * 9 + 6);
    // Equal incoming/outgoing tangents cancel at the interval midpoint. Its analytic
    // extrema still reach almost 200x scale despite every authored key staying at 1.
    if (balanced) values.set([2e6, 2e6, 2e6], 138 * 9);
    sampler.getOutput()!.setArray(values);
    const report = validateCreatureDocument(f.doc), attack = report.states.find(state => state.name === "Attack")!;
    expect(attack.samples).toBeLessThanOrEqual(121);
    expect(attack.maximumSpanRatio).toBeGreaterThan(balanced ? 150 : 250);
    expect(report.problems).toContain("Attack: deformed span exceeds four times the default");
    expect(f.root.getScale()).toEqual([1, 1, 1]);
  });

  it("evaluates cubic translation tangents", () => {
    const f = creature();
    addChannel(f.doc, f.clip("Idle"), f.limb, "translation", [0, 1], [0, .5, 0, 0, .5, 0]);
    const sampler = f.clip("Idle").listSamplers().at(-1)!;
    sampler.setInterpolation("CUBICSPLINE");
    sampler.getOutput()!.setArray(new Float32Array([0, 0, 0, 0, .5, 0, .2, 0, 0, -.2, 0, 0, 0, .5, 0, 0, 0, 0]));
    expect(validateCreatureDocument(f.doc).problems).toEqual([]);
    expect(f.limb.getTranslation()).toEqual([0, .5, 0]);
  });

  it("does not reject a shared low root influence as collapsed limb weights", () => {
    const f = creature(), indices = f.primitive.getAttribute("JOINTS_0")!, weights = f.primitive.getAttribute("WEIGHTS_0")!;
    for (let vertex = 0; vertex < 8; vertex++) {
      indices.setElement(vertex, [0, 1, 0, 0]); weights.setElement(vertex, [.06, .94, 0, 0]);
    }
    expect(validateCreatureDocument(f.doc)).toMatchObject({ passed: true, warnings: [] });
  });
});
