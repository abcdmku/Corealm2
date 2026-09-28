import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { measureModel } from "../game/src/render/measureModel.js";
import { CONTENT_ASSET_PATH } from "../game/src/multiplayer/contentAssetsContract.js";
import { bundleModelFiles, ModelFileProblem, writeGlb } from "../devdocs/src/workspaces/assets/modelFiles.js";
import { uploadEntry } from "../devdocs/src/workspaces/assets/modelStore.js";

const DEER = new Uint8Array(readFileSync("game/public/assets/models/animal/animal_deer.glb"));
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

/** The deer as a text glTF: its binary chunk split into two .bin files, and a texture named by URI. */
function deerAsGltf(): { gltf: Uint8Array; bins: [Uint8Array, Uint8Array] } {
  const view = new DataView(DEER.buffer, DEER.byteOffset, DEER.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(DEER.subarray(20, 20 + jsonLength)));
  const bin = DEER.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + json.buffers[0].byteLength);
  // Two buffers: views before the split read the first file, the rest the second.
  const split = json.bufferViews[Math.floor(json.bufferViews.length / 2)].byteOffset ?? 0;
  const first = bin.slice(0, split), second = bin.slice(split);
  for (const bufferView of json.bufferViews) if ((bufferView.byteOffset ?? 0) >= split) { bufferView.buffer = 1; bufferView.byteOffset = (bufferView.byteOffset ?? 0) - split; }
  json.buffers = [{ uri: "deer_a.bin", byteLength: first.length }, { uri: "deer_b.bin", byteLength: second.length }];
  json.images = [...json.images ?? [], { uri: "./textures/fur.png" }];
  return { gltf: new TextEncoder().encode(JSON.stringify(json)), bins: [first, second] };
}

describe("multi-file model uploads", () => {
  it("packs a glTF with its buffers into one GLB that measures as the original, keeping its texture beside it", async () => {
    const { gltf, bins } = deerAsGltf();
    const model = bundleModelFiles([{ name: "moonhart.gltf", bytes: gltf }, { name: "deer_a.bin", bytes: bins[0] }, { name: "deer_b.bin", bytes: bins[1] },
      { name: "fur.png", bytes: PNG }, { name: "notes.txt", bytes: new Uint8Array([1]) }]);
    expect(Object.keys(model.resources)).toEqual(["textures/fur.png"]);
    expect(model.unused).toEqual(["notes.txt"]);
    const original = await measureModel(buffer(DEER)), packed = await measureModel(buffer(model.glb));
    expect({ ...packed, bytes: 0 }).toEqual({ ...original, bytes: 0 });
    // The stored GLB names the texture by the clean relative URI; the preview carries it inside.
    const json = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true))));
    expect(json(model.glb).images.at(-1)).toEqual({ uri: "textures/fur.png" });
    expect(json(model.glb).buffers).toEqual([{ byteLength: expect.any(Number) }]);
    const embedded = json(model.preview).images.at(-1);
    expect(embedded.uri).toBeUndefined();
    expect(embedded.mimeType).toBe("image/png");
    expect(json(model.preview).bufferViews[embedded.bufferView].byteLength).toBe(PNG.length);
    expect(await measureModel(buffer(model.preview))).toMatchObject({ size: original.size, animations: original.animations });
  });

  it("stores a model with textures in its own folder and times its attack", async () => {
    const withTexture = bundleModelFiles([{ name: "animal_moonhart.glb", bytes: rewriteImages(DEER, [{ uri: "fur.png" }]) }, { name: "fur.png", bytes: PNG }]);
    const { entry, files } = await uploadEntry(withTexture, { id: "animal_moonhart", category: "character", pack: "p", is: "animal", tags: [] });
    expect(entry.file).toBe("models/character/animal_moonhart/animal_moonhart.glb");
    expect(Object.keys(files)).toEqual(["assets/models/character/animal_moonhart/animal_moonhart.glb", "assets/models/character/animal_moonhart/fur.png"]);
    for (const path of Object.keys(files)) expect(path).toMatch(CONTENT_ASSET_PATH);
    expect([entry.attackSeconds, entry.contactNormalized]).toEqual([1.08, 0.43]);
    // A lone GLB keeps the build's layout.
    const lone = await uploadEntry(bundleModelFiles([{ name: "a.glb", bytes: DEER }]), { id: "animal_lone", category: "character", pack: "p", is: "animal", tags: [] });
    expect(Object.keys(lone.files)).toEqual(["assets/models/character/animal_lone.glb"]);
  });

  it("keeps a meshopt model's compressed views and its fallback buffer", async () => {
    const fox = new Uint8Array(readFileSync("game/public/assets/models/creature/creature_gloam_fox.glb"));
    const model = bundleModelFiles([{ name: "fox.glb", bytes: fox }]);
    expect(await measureModel(buffer(model.glb))).toEqual(await measureModel(buffer(fox)).then(measured => ({ ...measured, bytes: model.glb.length })));
  });

  it("says which file is missing or unusable", () => {
    const glb = (images: { uri: string }[]) => ({ name: "m.glb", bytes: rewriteImages(DEER, images) });
    expect(() => bundleModelFiles([glb([{ uri: "fur.png" }])])).toThrow(/names fur\.png\. Choose that file too/);
    expect(() => bundleModelFiles([glb([{ uri: "../fur.png" }]), { name: "fur.png", bytes: PNG }])).toThrow(ModelFileProblem);
    expect(() => bundleModelFiles([glb([{ uri: "https://x.test/fur.png" }])])).toThrow(/only files beside it/);
    expect(() => bundleModelFiles([glb([{ uri: "fur.ktx2" }]), { name: "fur.ktx2", bytes: PNG }])).toThrow(/\.png, \.jpg or \.webp/);
    expect(() => bundleModelFiles([{ name: "fur.png", bytes: PNG }])).toThrow(/Choose a \.glb/);
    expect(() => bundleModelFiles([{ name: "a.glb", bytes: DEER }, { name: "b.glb", bytes: DEER }])).toThrow(/one model/);
  });
});

/** The deer GLB with extra images named by URI. */
function rewriteImages(glb: Uint8Array, images: { uri: string }[]): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  json.images = [...json.images ?? [], ...images];
  return writeGlb(json, glb.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + json.buffers[0].byteLength));
}
