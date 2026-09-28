import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { measureModel, modelEntry } from "../game/src/render/measureModel.js";
import type { AssetManifest } from "../game/src/render/assets.js";

const manifest = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) as AssetManifest;
const entry = (id: string) => manifest.assets.find(asset => asset.id === id)!;
async function measure(id: string) {
  const bytes = await readFile(`game/public/assets/${entry(id).file}`);
  return measureModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

describe("model measurement", () => {
  it.each(["animal_deer", "base_male", "enemy_bee", "bridge_small", "creature_gloam_fox", "fab_male_duskguard_body", "boss_rhino_air"])("measures %s as the build recorded it", async id => {
    const built = entry(id), measured = await measure(id);
    expect(measured.bytes).toBe(built.bytes);
    expect(measured.animations).toEqual(built.animations);
    expect(measured.materials).toEqual(built.materials);
    for (const axis of ["x", "y", "z"] as const) {
      expect(measured.size[axis]).toBeCloseTo(built.size[axis], 2);
      expect(measured.base[axis]).toBeCloseTo(built.base![axis], 2);
    }
    for (const clip of ["walkClipSeconds", "runClipSeconds"] as const) {
      if (built[clip] === undefined) expect(measured[clip]).toBeUndefined();
      else expect(measured[clip]).toBeCloseTo(built[clip], 2);
    }
  });

  it("turns a measurement and the author's choices into a manifest entry", async () => {
    const measured = await measure("animal_deer");
    const made = modelEntry(measured, { id: "animal_moonhart", category: "character", pack: "server-uploads", is: "animal", tags: ["deer", "fairy"] });
    expect(made).toMatchObject({ id: "animal_moonhart", file: "models/character/animal_moonhart.glb", pack: "server-uploads", category: "character", is: "animal", tags: ["deer", "fairy"], size: measured.size, base: measured.base });
  });
});
