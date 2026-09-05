import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createGrassSpriteTexture, disposeGeneratedTextures } from "../game/src/render/proceduralTextures.js";

afterEach(() => disposeGeneratedTextures());

describe("procedural grass presentation", () => {
  it("caches the cutout and recreates identical texels after disposal", () => {
    const first = createGrassSpriteTexture();
    const bytes = new Uint8Array(first.image.data as Uint8Array);
    let disposed = false;
    first.addEventListener("dispose", () => { disposed = true; });
    expect(createGrassSpriteTexture()).toBe(first);

    disposeGeneratedTextures();
    const recreated = createGrassSpriteTexture();
    expect(disposed).toBe(true);
    expect(recreated).not.toBe(first);
    expect(recreated.image.data).toEqual(bytes);
  });

  it("keeps colour in transparent texels for filtered cutout edges", () => {
    const texture = createGrassSpriteTexture();
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    const { data } = texture.image;
    if (!data) throw new Error("Grass cutout has no texel data");
    let transparentPixels = 0;
    let darkestBorder = 255;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] !== 0) continue;
      transparentPixels += 1;
      darkestBorder = Math.min(darkestBorder, data[index]!, data[index + 1]!, data[index + 2]!);
    }
    expect(transparentPixels).toBeGreaterThan(data.length / 8);
    expect(darkestBorder).toBeGreaterThan(64);
  });
});
