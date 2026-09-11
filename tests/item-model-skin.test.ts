import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { Matrix4, Vector3 } from "three";
import { attachItemSkin } from "../tools/item-models/skin.js";

function fixture(points: number[]) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array(points)).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute("POSITION", position);
  scene.addChild(doc.createNode("authored-armor").setMesh(doc.createMesh("authored-armor").addPrimitive(primitive)));
  return { doc, primitive, position };
}

describe("authored item native skin", () => {
  it("preserves authored vertices in bind pose, keeps only new meshes, and routes sleeves and hem to distinct chains", async () => {
    const { doc, primitive, position } = fixture([0, 1.45, 0.15, 0, 0.98, 0.12, 0.55, 1.4555, 0, -0.55, 1.4555, 0]);
    await attachItemSkin(doc, "grithe_cuirass");
    const skin = doc.getRoot().listSkins()[0]!;
    expect(skin.listJoints()).toHaveLength(65);
    expect(doc.getRoot().listMeshes().map(mesh => mesh.getName())).toEqual(["authored-armor"]);
    const weights = primitive.getAttribute("WEIGHTS_0")!, joints = primitive.getAttribute("JOINTS_0")!;
    const names: string[][] = [];
    for (let vertex = 0; vertex < position.getCount(); vertex++) {
      const p: number[] = [], w: number[] = [], j: number[] = [];
      position.getElement(vertex, p); weights.getElement(vertex, w); joints.getElement(vertex, j);
      expect(w.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(j.every(value => Number.isInteger(value) && value >= 0 && value < 65)).toBe(true);
      names.push(j.filter((_, i) => w[i]! > 0).map(index => skin.listJoints()[index]!.getName()));
      const result = new Vector3();
      for (let influence = 0; influence < 4; influence++) {
        const inverse: number[] = [];
        skin.getInverseBindMatrices()!.getElement(j[influence]!, inverse);
        const matrix = new Matrix4().fromArray(skin.listJoints()[j[influence]!]!.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse));
        result.addScaledVector(new Vector3().fromArray(p).applyMatrix4(matrix), w[influence]!);
      }
      expect(result.distanceTo(new Vector3().fromArray(p))).toBeLessThan(0.000002);
    }
    expect(names[0]).toEqual(["spine_03"]);
    expect(names[1]).toContain("pelvis");
    expect(names[1]).toContain("spine_01");
    expect(names[2]).toEqual(["lowerarm_l"]);
    expect(names[3]).toEqual(["lowerarm_r"]);
    // Roundtrip verifies all skeleton references and new accessors serialize together.
    const io = new NodeIO(), roundtrip = await io.readBinary(await io.writeBinary(doc));
    expect(roundtrip.getRoot().listSkins()[0]!.listJoints()).toHaveLength(65);
    expect(roundtrip.getRoot().listNodes().find(node => node.getMesh())!.getSkin()).toBeTruthy();
  });

  it("assigns head and low feet rigidly, without mixing left and right limbs", async () => {
    for (const [id, points, expected] of [
      ["grithe_helm", [0, 1.7, 0], ["Head"]],
      ["grithe_boots", [0.12, 0.03, 0, -0.12, 0.03, 0], ["foot_l", "foot_r"]],
      ["grithe_greaves", [0.12, 0.7, 0, -0.12, 0.4, 0], ["thigh_l", "calf_r"]],
    ] as const) {
      const { doc, primitive } = fixture([...points]);
      await attachItemSkin(doc, id);
      const skin = doc.getRoot().listSkins()[0]!;
      expected.forEach((name, index) => {
        const joints: number[] = [], weights: number[] = [];
        primitive.getAttribute("JOINTS_0")!.getElement(index, joints);
        primitive.getAttribute("WEIGHTS_0")!.getElement(index, weights);
        expect(skin.listJoints()[joints[0]!]!.getName()).toBe(name);
        expect(weights).toEqual([1, 0, 0, 0]);
      });
    }
  });

  it("keeps flexible ankle joints on their own foot/calf chain", async () => {
    const { doc, primitive } = fixture([.12, .1, 0, -.12, .1, 0]);
    await attachItemSkin(doc, "grithe_boots");
    const skin = doc.getRoot().listSkins()[0]!;
    for (const [vertex, side] of [[0, "l"], [1, "r"]] as const) {
      const weights: number[] = [], joints: number[] = [];
      primitive.getAttribute("WEIGHTS_0")!.getElement(vertex, weights);
      primitive.getAttribute("JOINTS_0")!.getElement(vertex, joints);
      expect(joints.filter((_, i) => weights[i]! > 0).map(j => skin.listJoints()[j]!.getName()).sort()).toEqual([`calf_${side}`, `foot_${side}`]);
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
    }
  });

  it("leaves handheld items rigid and rejects unbaked armor transforms", async () => {
    const { doc } = fixture([0, 0, 0]);
    await attachItemSkin(doc, "grithe_sword");
    expect(doc.getRoot().listSkins()).toHaveLength(0);
    doc.getRoot().listNodes()[0]!.setTranslation([0, 1, 0]);
    await expect(attachItemSkin(doc, "grithe_cuirass")).rejects.toThrow("bake mesh transforms");
  });
});
