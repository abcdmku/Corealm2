import { Document, Format, NodeIO } from "@gltf-transform/core";
import { KHRMaterialsClearcoat, KHRTextureTransform } from "@gltf-transform/extensions";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { restoreSourceMaterialTextures } from "../tools/lib/asset-material-restoration.js";

async function png(pixels: number[], width: number, height: number, channels: 3 | 4 = 3): Promise<Buffer> {
  return sharp(Uint8Array.from(pixels), { raw: { width, height, channels } })
    .png({ palette: false }).toBuffer();
}

function texture(document: Document, name: string, image: Uint8Array) {
  return document.createTexture(name).setImage(image).setMimeType("image/png");
}

async function pixels(image: Uint8Array) {
  return sharp(Buffer.from(image), { ignoreIcc: true }).raw().toBuffer({ resolveWithObject: true });
}

describe("source material texture restoration", () => {
  it("preserves every numeric channel exactly without resizing and writes truecolor PNG", async () => {
    const document = new Document();
    const stored = [3, 67, 199, 0, 251, 13, 78, 255, 104, 190, 6, 17, 255, 0, 128, 92];
    const image = await png(stored, 2, 2, 4);
    const orm = texture(document, "ORM", image);
    const normal = texture(document, "Normal", image);
    document.createMaterial("numeric").setMetallicRoughnessTexture(orm).setOcclusionTexture(orm).setNormalTexture(normal);

    const records = await restoreSourceMaterialTextures(document, { colorLimit: 8, dataLimit: 8 });
    for (const map of [orm, normal]) {
      expect([...(await pixels(map.getImage()!)).data]).toEqual(stored);
      const metadata = await sharp(Buffer.from(map.getImage()!)).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.isPalette).toBe(false);
      expect(metadata.channels).toBe(4);
    }
    expect(records.find(row => row.name === "ORM")?.slots).toEqual(["metallicRoughnessTexture", "occlusionTexture"]);
    expect(records.every(row => row.width === 2 && row.height === 2 && row.mimeType === "image/png")).toBe(true);
  });

  it("averages numeric channels without gamma or alpha weighting and renormalizes resized normals", async () => {
    const document = new Document();
    const scalar = texture(document, "scalar", await png([
      0, 20, 60, 0, 100, 40, 80, 255,
      200, 60, 100, 0, 240, 80, 120, 255,
    ], 2, 2, 4));
    const normal = texture(document, "normal", await png([
      255, 128, 128, 0, 128, 128, 255, 255,
      255, 128, 128, 0, 128, 128, 255, 255,
    ], 2, 2, 4));
    const material = document.createMaterial().setMetallicRoughnessTexture(scalar).setNormalTexture(normal).setNormalScale(0.38);
    await restoreSourceMaterialTextures(document, { colorLimit: 2, dataLimit: 1 });

    expect([...(await pixels(scalar.getImage()!)).data]).toEqual([135, 50, 90, 128]);
    const actual = (await pixels(normal.getImage()!)).data;
    const vector = [...actual.subarray(0, 3)].map(value => value / 127.5 - 1);
    expect(Math.hypot(...vector)).toBeCloseTo(1, 2);
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 2);
    expect(vector[2]).toBeCloseTo(Math.SQRT1_2, 2);
    expect(actual[3]).toBe(128);
    expect(material.getNormalScale()).toBe(0.38);
  });

  it("retains material bindings, texture infos, geometry, skin, node transforms, and animation", async () => {
    const document = new Document();
    const buffer = document.createBuffer("geometry");
    const image = await png([
      50, 100, 150, 20, 50, 100, 150, 80,
      50, 100, 150, 160, 50, 100, 150, 240,
    ], 2, 2, 4);
    const color = texture(document, "color", image);
    const normal = texture(document, "normal", image);
    const orm = texture(document, "orm", image);
    const emissive = texture(document, "emissive", image);
    const material = document.createMaterial("authored")
      .setBaseColorTexture(color).setEmissiveTexture(emissive).setNormalTexture(normal)
      .setMetallicRoughnessTexture(orm).setOcclusionTexture(orm)
      .setBaseColorFactor([0.3, 0.5, 0.7, 0.4]).setEmissiveFactor([0.1, 0.2, 0.3])
      .setMetallicFactor(0.63).setRoughnessFactor(0.29).setNormalScale(0.42)
      .setOcclusionStrength(0.72).setAlphaMode("MASK").setAlphaCutoff(0.31).setDoubleSided(true)
      .setExtras({ authored: "retain" });
    material.getBaseColorTextureInfo()!.setTexCoord(1).setWrapS(33071).setMagFilter(9728);
    material.getOcclusionTextureInfo()!.setTexCoord(1).setWrapT(33648).setMinFilter(9984);
    const transform = document.createExtension(KHRTextureTransform).createTransform()
      .setOffset([0.2, 0.4]).setScale([0.75, 0.5]).setRotation(0.3);
    material.getBaseColorTextureInfo()!.setExtension("KHR_texture_transform", transform);
    const position = document.createAccessor("positions").setBuffer(buffer).setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    const uv = document.createAccessor("uv").setBuffer(buffer).setType("VEC2")
      .setArray(new Float32Array([0, 0, 1, 0, 0, 1]));
    const joints = document.createAccessor("joints").setBuffer(buffer).setType("VEC4")
      .setArray(new Uint16Array(12));
    const weights = document.createAccessor("weights").setBuffer(buffer).setType("VEC4")
      .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
    const primitive = document.createPrimitive().setMaterial(material).setAttribute("POSITION", position)
      .setAttribute("TEXCOORD_0", uv).setAttribute("TEXCOORD_1", uv)
      .setAttribute("JOINTS_0", joints).setAttribute("WEIGHTS_0", weights);
    const mesh = document.createMesh("mesh").addPrimitive(primitive);
    const joint = document.createNode("joint").setTranslation([0, 0.2, 0]);
    const matrices = document.createAccessor("inverse-bind").setBuffer(buffer).setType("MAT4")
      .setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.2, 0, 1]));
    const skin = document.createSkin("skin").addJoint(joint).setSkeleton(joint).setInverseBindMatrices(matrices);
    const node = document.createNode("actor").setMesh(mesh).setSkin(skin)
      .setTranslation([2, 3, 4]).setScale([0.9, 1.1, 0.8]).setRotation([0, 0, 0.6, 0.8]);
    document.createScene("scene").addChild(node).addChild(joint);
    const times = document.createAccessor("times").setBuffer(buffer).setType("SCALAR").setArray(new Float32Array([0, 1]));
    const motion = document.createAccessor("motion").setBuffer(buffer).setType("VEC3").setArray(new Float32Array([0, 0.2, 0, 0, 0.4, 0]));
    const sampler = document.createAnimationSampler().setInput(times).setOutput(motion).setInterpolation("LINEAR");
    document.createAnimation("idle").addSampler(sampler).addChannel(document.createAnimationChannel()
      .setSampler(sampler).setTargetNode(joint).setTargetPath("translation"));
    const io = new NodeIO().registerExtensions([KHRTextureTransform]);
    const before = await io.writeJSON(document, { format: Format.GLTF });
    const records = await restoreSourceMaterialTextures(document, { colorLimit: 1, dataLimit: 1 });
    const after = await io.writeJSON(document, { format: Format.GLTF });

    expect(after.json).toEqual(before.json);
    const bufferUris = before.json.buffers!.map(entry => entry.uri!);
    for (const uri of bufferUris) expect(after.resources[uri]).toEqual(before.resources[uri]);
    const reloaded = await io.readJSON(after);
    const reread = await io.writeJSON(reloaded, { format: Format.GLTF });
    expect(reread.json).toEqual(after.json);
    for (const uri of bufferUris) expect(reread.resources[uri]).toEqual(after.resources[uri]);
    expect(material.getBaseColorTexture()).toBe(color);
    expect(material.getMetallicRoughnessTexture()).toBe(orm);
    expect(material.getOcclusionTexture()).toBe(orm);
    expect(records.every(record => record.sourceSha256 !== record.outputSha256)).toBe(true);
    expect(new Set(records.flatMap(record => record.slots))).toEqual(new Set([
      "baseColorTexture", "emissiveTexture", "normalTexture", "metallicRoughnessTexture", "occlusionTexture",
    ]));
  });

  it("retains alpha in resized albedo and emissive maps and keeps extension textures byte-for-byte", async () => {
    const document = new Document();
    const image = await png(Array.from({ length: 16 }, () => [80, 120, 200, 61]).flat(), 4, 4, 4);
    const color = texture(document, "color", image);
    const emissive = texture(document, "emissive", image);
    const extensionMap = texture(document, "extension-map", image);
    const clearcoat = document.createExtension(KHRMaterialsClearcoat).createClearcoat().setClearcoatTexture(extensionMap);
    document.createMaterial().setBaseColorTexture(color).setEmissiveTexture(emissive)
      .setExtension("KHR_materials_clearcoat", clearcoat);
    const records = await restoreSourceMaterialTextures(document, { colorLimit: 2, dataLimit: 2 });
    for (const map of [color, emissive]) {
      const decoded = await pixels(map.getImage()!);
      expect(decoded.info).toMatchObject({ width: 2, height: 2, channels: 4 });
      expect([decoded.data[3], decoded.data[7], decoded.data[11], decoded.data[15]]).toEqual([61, 61, 61, 61]);
    }
    expect([...extensionMap.getImage()!]).toEqual([...image]);
    const record = records.find(row => row.name === "extension-map")!;
    expect(record.width).toBe(4);
    expect(record.sourceSha256).toBe(record.outputSha256);
    expect(record.slots).toEqual(["Clearcoat.clearcoatTexture"]);
  });

  it("rejects conflicting texture slots before changing any payload", async () => {
    const document = new Document();
    const image = await png([20, 40, 80, 60, 80, 100], 2, 1);
    const safe = texture(document, "safe", image);
    const shared = texture(document, "shared", image);
    document.createMaterial().setBaseColorTexture(safe);
    document.createMaterial().setBaseColorTexture(shared).setNormalTexture(shared);
    await expect(restoreSourceMaterialTextures(document, { colorLimit: 1, dataLimit: 1 }))
      .rejects.toThrow(/shared.*color and numeric slots.*Split/);
    expect(safe.getImage()).toBe(image);
    expect(shared.getImage()).toBe(image);
  });

  it("leaves prior images untouched when a later texture cannot be decoded", async () => {
    const document = new Document();
    const image = await png([20, 40, 80, 60, 80, 100], 2, 1);
    const safe = texture(document, "safe", image);
    const broken = texture(document, "broken", Uint8Array.from([0, 1, 2]));
    document.createMaterial().setBaseColorTexture(safe).setNormalTexture(broken);
    await expect(restoreSourceMaterialTextures(document, { colorLimit: 1, dataLimit: 1 }))
      .rejects.toThrow(/Texture "broken"/);
    expect(safe.getImage()).toBe(image);
  });
});
