import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatureSkin } from "../game/src/content/schema/creatureSkins.js";
import { CREATURE_LOOK_CHANNEL_KEY, CreatureLooks, encodeCreatureLook } from "../game/src/render/creatureSkins.js";

const skinRow = (maps: Record<string, string>, assetId = "animal_frog"): CreatureSkin => ({
  id: "frog_moss", assetId, name: "Moss", kind: "recolor", maps, createdAt: "2026-09-27T00:00:00Z",
});

function looksWith(skins: CreatureSkin[], fail = false) {
  const loaded: string[] = [];
  const looks = new CreatureLooks({
    baseUrl: () => "https://assets.test/assets/",
    skin: id => skins.find(skin => skin.id === id),
    loadImage: async url => {
      loaded.push(url);
      if (fail) throw new Error("404");
      return { width: 4, height: 4 } as unknown as HTMLCanvasElement;
    },
  });
  return { looks, loaded };
}

function frogMaterial(): MeshStandardNodeMaterial {
  const map = new THREE.Texture();
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.wrapS = THREE.MirroredRepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 8;
  map.channel = 1;
  return new MeshStandardNodeMaterial({ name: "animal_frog_mat", map, color: 0xffffff });
}

afterEach(() => vi.restoreAllMocks());

describe("creature skins", () => {
  it("swaps the albedo map by source material name, sharing one clone per (material, skin)", async () => {
    const skin = skinRow({ animal_frog_mat: "skins/animal_frog/frog_moss/animal_frog_mat.png" });
    const { looks, loaded } = looksWith([skin]);
    expect(looks.resolve("animal_frog", "frog_moss")).toBe(skin);
    expect(looks.ready(skin)).toBe(false);
    await looks.whenLoaded(skin);
    expect(loaded).toEqual(["https://assets.test/assets/skins/animal_frog/frog_moss/animal_frog_mat.png"]);
    expect(looks.ready(skin)).toBe(true);

    const source = frogMaterial();
    // A renderer variant carries an `@` suffix; the skin still keys on the imported name.
    source.name = "animal_frog_mat@organic:hide";
    const skinned = looks.skin(source, skin) as MeshStandardNodeMaterial;
    expect(skinned).not.toBe(source);
    expect(looks.skin(source, skin)).toBe(skinned);
    expect(skinned.map).not.toBe(source.map);
    for (const key of ["colorSpace", "flipY", "wrapS", "wrapT", "anisotropy", "channel"] as const) {
      expect(skinned.map![key], key).toBe(source.map![key]);
    }
    expect(skinned.color.equals(source.color)).toBe(true);
    expect(skinned.name).toBe(source.name);
    // A second material under the same original map shares the uploaded replacement.
    const sibling = source.clone() as MeshStandardNodeMaterial;
    expect((looks.skin(sibling, skin) as MeshStandardNodeMaterial).map).toBe(skinned.map);
    expect(looks.stats()).toEqual({ skinnedMaterials: 2, lookMaterials: 0, maps: 1 });
    // Materials the skin does not cover keep their own maps.
    const eyes = new MeshStandardNodeMaterial({ name: "animal_frog_eyes" });
    expect(looks.skin(eyes, skin)).toBe(eyes);
    looks.dispose();
  });

  it("draws the model's own maps for an unknown skin, another model's skin or a failed map, warning once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const skin = skinRow({ animal_frog_mat: "skins/animal_frog/frog_moss/animal_frog_mat.png" });
    const { looks } = looksWith([skin]);
    expect(looks.resolve("animal_frog", "nope")).toBeNull();
    expect(looks.resolve("animal_frog", "nope")).toBeNull();
    expect(looks.resolve("animal_stag", "frog_moss")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);

    const failing = looksWith([skin], true).looks;
    expect(failing.resolve("animal_frog", "frog_moss")).toBe(skin);
    await failing.whenLoaded(skin);
    expect(failing.resolve("animal_frog", "frog_moss")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("makes one colour-shifting material per (material, channel), never per individual", () => {
    const { looks } = looksWith([]);
    const source = frogMaterial();
    const batch = looks.look(source, "batch");
    const instance = looks.look(source, "instance");
    const object = looks.look(source, "object");
    expect(new Set([source, batch, instance, object]).size).toBe(4);
    expect(looks.look(source, "batch")).toBe(batch);
    expect(looks.look(batch, "batch")).toBe(batch);
    expect(batch.name).toBe("animal_frog_mat@look");
    expect(batch.userData[CREATURE_LOOK_CHANNEL_KEY]).toBe("batch");
    expect((batch as MeshStandardNodeMaterial).colorNode).not.toBeNull();
    expect((batch as MeshStandardNodeMaterial).map).toBe(source.map);
    expect(looks.stats().lookMaterials).toBe(3);
  });

  it("encodes a shift as a positive colour whose identity is white", () => {
    expect(encodeCreatureLook({ hue: 0, saturation: 1, value: 1 }).toArray()).toEqual([1, 1, 1]);
    expect(encodeCreatureLook({ hue: -180, saturation: .5, value: 1.2 }).toArray()).toEqual([.5, .5, 1.2]);
    expect(encodeCreatureLook({ hue: 90, saturation: 1, value: 1 }).r).toBe(1.25);
  });
});
