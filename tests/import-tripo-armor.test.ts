import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { Matrix4 } from "three";
import sharp from "sharp";
import { buildTripoArmor, retuneTripoMetalRoughness, type TripoArmorConfig } from "../tools/item-models/import-tripo.js";

function sourceAndConfig() {
  const document = new Document(), buffer = document.createBuffer(), scene = document.createScene();
  document.getRoot().setDefaultScene(scene);
  const material = document.createMaterial("copper").setMetallicFactor(.7).setRoughnessFactor(.3);
  const texture = document.createTexture("source-albedo").setMimeType("image/png").setImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  material.setBaseColorTexture(texture);
  const slots = ["head", "body", "hands", "legs", "feet"] as const;
  slots.forEach((slot, index) => {
    const positions = document.createAccessor().setType("VEC3").setArray(new Float32Array([-.1, 1.2, .1, .1, 1.2, .1, 0, 1.4, .1])).setBuffer(buffer);
    const normal = Math.SQRT1_2;
    const normals = document.createAccessor().setType("VEC3").setArray(new Float32Array(Array.from({ length: 3 }, () => [normal, normal, 0]).flat())).setBuffer(buffer);
    const uv = document.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, .5, 1])).setBuffer(buffer);
    const primitive = document.createPrimitive().setAttribute("POSITION", positions).setAttribute("NORMAL", normals).setAttribute("TEXCOORD_0", uv).setMaterial(material);
    scene.addChild(document.createNode(slot).setTranslation([.1, 0, 0]).setMesh(document.createMesh(`part-${index}`).addPrimitive(primitive)));
  });
  const config: TripoArmorConfig = {
    source: "source.glb", setId: "grithe", alignment: { space: "native-male-t-pose", reviewedBy: "test numeric fit", matrix: new Matrix4().makeScale(2, 1, 1).elements },
    slots: { head: { itemId: "grithe_helm" }, body: { itemId: "grithe_cuirass" }, hands: { itemId: "grithe_gloves" }, legs: { itemId: "grithe_greaves" }, feet: { itemId: "grithe_boots" } },
    parts: slots.map((slot, node) => ({ node, slot })),
  };
  return { document, config, texture };
}

function weightedSourceAndConfig() {
  const fixture = sourceAndConfig(), { document, config } = fixture;
  const scene = document.getRoot().getDefaultScene()!, buffer = document.getRoot().listBuffers()[0]!;
  const body = document.getRoot().listNodes()[1]!;
  body.setTranslation([0, 0, 0]);
  const torso = document.createNode("source:Torso"), arm = document.createNode("source:Arm");
  // Tripo leaves node TRS at identity. Recover the rest pose from inverse binds.
  scene.addChild(torso); torso.addChild(arm);
  const bind = [new Matrix4(), new Matrix4().makeTranslation(0, 1, 0)];
  const inverse = document.createAccessor().setType("MAT4").setArray(new Float32Array(bind.flatMap(matrix => matrix.clone().invert().elements))).setBuffer(buffer);
  const skin = document.createSkin("exported-skin").addJoint(torso).addJoint(arm).setInverseBindMatrices(inverse).setSkeleton(torso);
  body.setSkin(skin);
  const primitive = body.getMesh()!.listPrimitives()[0]!;
  primitive.setAttribute("JOINTS_0", document.createAccessor().setType("VEC4").setArray(new Uint16Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])).setBuffer(buffer));
  primitive.setAttribute("WEIGHTS_0", document.createAccessor().setType("VEC4").setArray(new Float32Array([.5, .5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).setBuffer(buffer));
  config.alignment.matrix = new Matrix4().elements;
  config.sourceSkin = { jointWorldMatrices: Object.fromEntries(skin.listJoints().map((joint, i) => [joint.getName(), new Matrix4().fromArray(inverse.getElement(i, [])).invert().elements])) };
  return fixture;
}

describe("Tripo armor import", () => {
  it("restores plate metal response without turning adjacent leather into metal", async () => {
    const base = await sharp(Buffer.from([180, 105, 75, 70, 50, 35]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
    const packed = await sharp(Buffer.from([3, 210, 5, 4, 215, 6]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
    const result = await retuneTripoMetalRoughness(base, packed, "copper");
    const pixels = await sharp(result).raw().toBuffer();
    expect(pixels[0]).toBe(3); // packed red channel is untouched
    expect(pixels[1]).toBeLessThan(150); // plate roughness
    expect(pixels[2]).toBeGreaterThan(100); // plate metalness
    expect(pixels[4]).toBeGreaterThan(190); // leather remains rough
    expect(pixels[5]).toBeLessThan(25); // leather remains nonmetallic
  });
  it("widens iron plate response while keeping warm cloth and leather rough", async () => {
    const base = await sharp(Buffer.from([
      135, 125, 122, // neutral steel
      210, 198, 177, // warm linen
      70, 50, 35, // leather
    ]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const packed = await sharp(Buffer.from([
      3, 210, 5,
      4, 215, 6,
      5, 220, 7,
    ]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const result = await retuneTripoMetalRoughness(base, packed, "iron");
    const pixels = await sharp(result).raw().toBuffer();
    expect(pixels[2]).toBeGreaterThan(160); // steel becomes metallic
    expect(pixels[1]).toBeLessThan(130); // steel becomes smoother
    expect(pixels[5]).toBeLessThan(80); // linen stays mostly nonmetallic
    expect(pixels[4]).toBeGreaterThan(160); // linen stays rough
    expect(pixels[8]).toBeLessThan(25); // leather stays nonmetallic
    expect(pixels[7]).toBeGreaterThan(200); // leather stays rough
  });
  it("keeps hanging bell-sleeve vertices on the arm instead of pinning them to the waist", async () => {
    const { document, config } = sourceAndConfig();
    const part = config.parts[1]!;
    if (!("slot" in part)) throw new Error("Expected body assignment");
    part.deform = "sleeved-body";
    const body = (await buildTripoArmor(document, config)).find(row => row.slot === "body")!.document;
    const mesh = body.getRoot().listNodes().find(node => node.getMesh())!;
    const primitive = mesh.getMesh()!.listPrimitives()[0]!;
    const indices = primitive.getAttribute("JOINTS_0")!.getElement(1, []);
    const weights = primitive.getAttribute("WEIGHTS_0")!.getElement(1, []);
    const joints = mesh.getSkin()!.listJoints();
    expect(weights.reduce((sum, weight, i) => sum + (/arm_l/.test(joints[indices[i]!]!.getName()) ? weight : 0), 0)).toBeGreaterThan(.99);
  });
  it("bakes source/global/vertex/part transforms before native skinning while retaining UV and PBR data", async () => {
    const { document, config, texture } = sourceAndConfig();
    config.parts[1] = { node: 1, slot: "body", matrix: new Matrix4().makeTranslation(0, 0, .05).elements,
      vertexTransforms: [{ vertices: [0], matrix: new Matrix4().makeTranslation(.2, 0, 0).elements, weights: [.5] }] };
    config.parts[2] = { node: 2, slot: "hands", rigidBone: "hand_l" };
    const candidates = await buildTripoArmor(document, config);
    expect(candidates).toHaveLength(5);
    const body = candidates.find(row => row.slot === "body")!.document;
    const meshNode = body.getRoot().listNodes().find(node => node.getMesh())!;
    expect(meshNode.getWorldMatrix()).toEqual(new Matrix4().elements);
    const primitive = meshNode.getMesh()!.listPrimitives()[0]!;
    const point = primitive.getAttribute("POSITION")!.getElement(0, []);
    expect(point[0]).toBeCloseTo(.1); expect(point[1]).toBeCloseTo(1.2); expect(point[2]).toBeCloseTo(.15);
    const normal = primitive.getAttribute("NORMAL")!.getElement(0, []);
    expect(normal[0]).toBeCloseTo(1 / Math.sqrt(5)); expect(normal[1]).toBeCloseTo(2 / Math.sqrt(5));
    expect(Array.from(primitive.getAttribute("TEXCOORD_0")!.getArray()!)).toEqual([0, 0, 1, 0, .5, 1]);
    expect(primitive.getMaterial()!.getMetallicFactor()).toBe(.7);
    expect(primitive.getMaterial()!.getRoughnessFactor()).toBe(.3);
    expect(primitive.getMaterial()!.getBaseColorTexture()!.getImage()).toEqual(texture.getImage());
    expect(body.getRoot().listSkins()[0]!.listJoints()).toHaveLength(65);
    const hands = candidates.find(row => row.slot === "hands")!.document;
    expect(hands.getRoot().listNodes().find(node => node.getMesh())!.getExtras().itemModelBone).toBe("hand_l");
    const roundtrip = await new NodeIO().readBinary(await new NodeIO().writeBinary(body));
    expect(roundtrip.getRoot().listSkins()[0]!.listJoints()).toHaveLength(65);
    expect(document.getRoot().listNodes()[1]!.getTranslation()).toEqual([.1, 0, 0]);
    expect(document.getRoot().listSkins()).toHaveLength(0);
  });

  it("rejects missing and overlapping triangle assignments before generating candidates", async () => {
    const { document, config } = sourceAndConfig();
    config.parts.pop();
    await expect(buildTripoArmor(document, config)).rejects.toThrow("missing assignment or omission");
    config.parts.push({ node: 4, slot: "feet" }, { node: 4, slot: "feet" });
    await expect(buildTripoArmor(document, config)).rejects.toThrow("duplicate assignment");
  });

  it("rejects unsafe pose corrections and mismatched equipment IDs", async () => {
    const { document, config } = sourceAndConfig();
    config.parts[1] = { node: 1, slot: "body", vertexTransforms: [
      { vertices: [0], matrix: new Matrix4().elements }, { vertices: [0], matrix: new Matrix4().elements },
    ] };
    await expect(buildTripoArmor(document, config)).rejects.toThrow("overlapping corrections");
    config.parts[1] = { node: 1, slot: "body", matrix: new Matrix4().makeScale(0, 1, 1).elements };
    await expect(buildTripoArmor(document, config)).rejects.toThrow("degenerate matrix");
    config.parts[1] = { node: 1, slot: "body" };
    config.slots.head.itemId = "grithe_sword";
    await expect(buildTripoArmor(document, config)).rejects.toThrow("wrong equipment slot");
  });

  it("recovers an exported bind pose from inverse binds and bakes a weighted arm pose before rebinding", async () => {
    const { document, config } = weightedSourceAndConfig();
    const sourcePositions = document.getRoot().listNodes()[1]!.getMesh()!.listPrimitives()[0]!.getAttribute("POSITION")!;
    const neutral = (await buildTripoArmor(document, config)).find(candidate => candidate.slot === "body")!.document;
    const neutralRoundtrip = await new NodeIO().readBinary(await new NodeIO().writeBinary(neutral));
    const neutralPositions = neutralRoundtrip.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute("POSITION")!;
    for (let vertex = 0; vertex < sourcePositions.getCount(); vertex++) {
      neutralPositions.getElement(vertex, []).forEach((value, axis) => expect(value).toBeCloseTo(sourcePositions.getElement(vertex, [])[axis]!, 6));
    }
    config.sourceSkin!.jointWorldMatrices["source:Arm"] = new Matrix4().makeTranslation(0, 1, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2)).elements;
    const posed = (await buildTripoArmor(document, config)).find(candidate => candidate.slot === "body")!.document;
    const posedPositions = posed.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute("POSITION")!;
    const expected = [[-.15, 1.05, .1], [-.2, 1.1, .1], [0, 1.4, .1]];
    expected.forEach((point, vertex) => posedPositions.getElement(vertex, []).forEach((value, axis) => expect(value).toBeCloseTo(point[axis]!, 6)));
    expect(posed.getRoot().listSkins()).toHaveLength(1);
    expect(posed.getRoot().listSkins()[0]!.listJoints()).toHaveLength(65);
    expect(posed.getRoot().listNodes().some(node => node.getName().startsWith("source:"))).toBe(false);
  });

  it("requires complete source joint targets and applies a fitted vertex correction after the source pose", async () => {
    const { document, config } = weightedSourceAndConfig();
    delete config.sourceSkin!.jointWorldMatrices["source:Arm"];
    await expect(buildTripoArmor(document, config)).rejects.toThrow("missing used joint target source:Arm");
    config.sourceSkin!.jointWorldMatrices["source:Arm"] = new Matrix4().makeTranslation(0, 1, 0).elements;
    config.parts[1] = { node: 1, slot: "body", vertexTransforms: [{ vertices: [0], matrix: new Matrix4().makeTranslation(.2, 0, 0).elements, weights: [.5] }] };
    const body = (await buildTripoArmor(document, config)).find(candidate => candidate.slot === "body")!.document;
    const positions = body.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute("POSITION")!;
    expect(positions.getElement(0, [])[0]).toBeCloseTo(0, 6);
    expect(positions.getElement(1, [])[0]).toBeCloseTo(.1, 6);
  });
});
