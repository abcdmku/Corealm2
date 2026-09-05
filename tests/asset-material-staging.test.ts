import path from "node:path";
import { Document, NodeIO, type JSONDocument } from "@gltf-transform/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { materialStagingOptions, restorationGeometrySnapshot, writeRestoredMaterialGlb } from "../tools/build-assets.js";
import { repoRoot } from "../tools/lib/paths.js";
import { externalizeGlbMaterialTextures } from "../tools/lib/shared-material-textures.js";

describe("material staging boundaries", () => {
  it("requires explicit asset IDs and confines output to the owned staging directory", () => {
    expect(materialStagingOptions([
      "--stage-materials", "--only", "sword,wall_brick_straight", "--out", "test-results/material-restoration/representatives",
    ])).toEqual({
      ids: ["sword", "wall_brick_straight"],
      outputRoot: path.join(repoRoot, "test-results/material-restoration/representatives"),
    });
    for (const output of ["game/public/assets", "test-results/material-restoration/../../game/public/assets", "test-results/material-restoration-other"]) {
      expect(() => materialStagingOptions(["--stage-materials", "--only", "sword", "--out", output])).toThrow(/must stay inside/);
    }
    expect(() => materialStagingOptions(["--stage-materials", "--out", "test-results/material-restoration"])).toThrow(/exact asset IDs/);
    expect(() => materialStagingOptions(["--stage-materials", "--only", "sword,sword", "--out", "test-results/material-restoration"])).toThrow(/distinct exact/);
    expect(() => materialStagingOptions(["--stage-materials", "--only", "sword", "--out", "test-results/material-restoration", "--force"])).toThrow(/Unknown material staging option/);
    expect(materialStagingOptions([
      "--stage-materials", "--shared-textures", "--only-pack", "medieval-village-megakit", "--out", "test-results/material-restoration/library",
    ])).toMatchObject({ ids: [], packIds: ["medieval-village-megakit"], sharedTextures: true });
    expect(() => materialStagingOptions([
      "--stage-materials", "--only-pack", "unrelated-pack", "--out", "test-results/material-restoration/library",
    ])).toThrow(/supported pack IDs/);
  });

  it("detects UV, pivot and skin changes independently of materials", () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const positions = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const uv = document.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer);
    const material = document.createMaterial("timber");
    const mesh = document.createMesh("mesh").addPrimitive(document.createPrimitive().setAttribute("POSITION", positions).setAttribute("TEXCOORD_0", uv).setMaterial(material));
    const joint = document.createNode("joint");
    const skin = document.createSkin("rig").addJoint(joint);
    const node = document.createNode("piece").setMesh(mesh).setSkin(skin);
    document.createScene("scene").addChild(node).addChild(joint);
    const initial = restorationGeometrySnapshot(document);
    material.setRoughnessFactor(0.4);
    expect(restorationGeometrySnapshot(document)).toEqual(initial);
    uv.setArray(new Float32Array([0, 0, 0.5, 0, 0, 1]));
    expect(restorationGeometrySnapshot(document)).not.toEqual(initial);
    uv.setArray(new Float32Array([0, 0, 1, 0, 0, 1]));
    node.setTranslation([0, 0.2, 0]);
    expect(restorationGeometrySnapshot(document)).not.toEqual(initial);
    node.setTranslation([0, 0, 0]);
    skin.removeJoint(joint);
    expect(restorationGeometrySnapshot(document)).not.toEqual(initial);
  });

  it("retains authored joint scales that the GLB writer normally rounds to identity", async () => {
    const document = new Document();
    const joint = document.createNode("joint").setScale([0.9999997019767761, 1.0000001192092896, 1]);
    document.createScene("scene").addChild(joint);
    const before = restorationGeometrySnapshot(document);
    const output = await writeRestoredMaterialGlb(document);
    const restored = await new NodeIO().readBinary(output);
    expect(restorationGeometrySnapshot(restored)).toEqual(before);
  });

  it("externalizes exact shared image bytes and preserves model/material data after binary compaction", async () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 50, g: 130, b: 250, alpha: 0.7 } } }).png().toBuffer();
    const albedo = document.createTexture("albedo").setImage(image).setMimeType("image/png");
    const normal = document.createTexture("normal").setImage(image).setMimeType("image/png");
    const material = document.createMaterial("stone").setBaseColorTexture(albedo).setNormalTexture(normal).setMetallicFactor(0.7).setRoughnessFactor(0.3);
    const positions = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const uv = document.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer);
    const mesh = document.createMesh().addPrimitive(document.createPrimitive().setAttribute("POSITION", positions).setAttribute("TEXCOORD_0", uv).setMaterial(material));
    document.createScene("scene").addChild(document.createNode("piece").setMesh(mesh));
    const standalone = await writeRestoredMaterialGlb(document);
    const output = externalizeGlbMaterialTextures(standalone, "models/building/example.glb");
    expect(output.textures).toHaveLength(1);
    expect(Buffer.from(output.textures[0]!.bytes)).toEqual(image);
    const encoded = Buffer.from(output.glb);
    const jsonLength = encoded.readUInt32LE(12);
    const json = JSON.parse(encoded.subarray(20, 20 + jsonLength).toString("utf8")) as JSONDocument["json"];
    expect(json.images?.every(entry => entry.bufferView === undefined && entry.uri?.startsWith("../../textures/imported/"))).toBe(true);
    json.buffers![0]!.uri = "binary.bin";
    const resources: JSONDocument["resources"] = { "binary.bin": new Uint8Array(encoded.subarray(28 + jsonLength)) };
    for (const entry of json.images!) resources[entry.uri!] = new Uint8Array(output.textures[0]!.bytes);
    const restored = await new NodeIO().readJSON({ json, resources });
    expect(restorationGeometrySnapshot(restored)).toEqual(restorationGeometrySnapshot(document));
    const restoredMaterial = restored.getRoot().listMaterials()[0]!;
    expect(restoredMaterial.getMetallicFactor()).toBe(0.7);
    expect(restoredMaterial.getRoughnessFactor()).toBe(0.3);
    expect(Buffer.from(restoredMaterial.getNormalTexture()!.getImage()!)).toEqual(image);
    const another = externalizeGlbMaterialTextures(standalone, "models/weapon/example.glb");
    expect(another.textures[0]!.file).toBe(output.textures[0]!.file);
  });
});
