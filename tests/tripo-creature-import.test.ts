import { Document } from "@gltf-transform/core";
import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { repairHumanoidWeights, restoreGeometryBasis } from "../tools/tripo-creatures/retarget.js";

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
