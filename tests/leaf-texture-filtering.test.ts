import * as THREE from "three";
import { SRGBToLinear } from "three/src/math/ColorManagement.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { associateLeafColour, prepareLeafTexture } from "../game/src/render/leafTexture.js";

afterEach(() => vi.unstubAllGlobals());

describe("foliage colour filtering", () => {
  it("preserves every alpha and opaque colour byte", () => {
    const source = Uint8Array.from({ length: 256 * 4 }, (_, i) => i % 4 === 3 ? i / 4 : 47 + i % 3 * 45);
    const result = associateLeafColour(source);
    for (let i = 3; i < source.length; i += 4) expect(result[i]).toBe(source[i]);
    expect(result.slice(0, 4)).toEqual(new Uint8Array(4));
    expect(result.slice(-4)).toEqual(source.slice(-4));
  });

  it("keeps green colour stable as its filtered coverage shrinks beside empty texels", () => {
    const colour = [65, 143, 38];
    const pixels = new Uint8Array([...colour, 255, 250, 20, 240, 0, ...colour, 85, 0, 0, 0, 0]);
    const associated = associateLeafColour(pixels);
    for (const footprint of [[0], [0, 1], [0, 1, 2, 3]]) {
      const coverage = footprint.reduce((sum, p) => sum + associated[p * 4 + 3]! / 255, 0);
      for (let c = 0; c < 3; c++) {
        const filtered = footprint.reduce((sum, p) => sum + SRGBToLinear(associated[p * 4 + c]! / 255), 0) / coverage;
        expect(Math.abs(filtered - SRGBToLinear(colour[c]! / 255))).toBeLessThan(.0015);
      }
    }
  });

  it("shares prepared pixels across tree variants, preserves UV transforms and recreates disposed uploads", () => {
    const pixels = new Uint8ClampedArray([65, 143, 38, 255, 0, 0, 0, 0]);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({
      drawImage: vi.fn(), getImageData: () => ({ data: pixels }),
    }) }) });
    const source = new THREE.Texture({ width: 2, height: 1 });
    source.colorSpace = THREE.SRGBColorSpace;
    source.flipY = false; source.offset.set(.25, .125); source.repeat.set(.5, .75);
    const prepared = prepareLeafTexture(source);
    const variant = source.clone();
    expect(prepareLeafTexture(variant)).toBe(prepared);
    expect(prepareLeafTexture(source)).toBe(prepared);
    const data = (prepared as THREE.DataTexture).image.data as Uint8Array;
    expect(data.filter((_, i) => i % 4 === 3)).toEqual(new Uint8Array([255, 0]));
    expect(prepared.offset).toEqual(source.offset); expect(prepared.repeat).toEqual(source.repeat);
    expect(prepared.flipY).toBe(false);
    expect(prepared.premultiplyAlpha).toBe(false);
    expect(prepared.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(prepared.generateMipmaps).toBe(true);
    expect(source.image).toEqual({ width: 2, height: 1 });
    prepared.dispose();
    const replacement = prepareLeafTexture(source);
    expect(replacement).not.toBe(prepared);
    expect(replacement.userData.leafDisposed).not.toBe(true);
    replacement.dispose(); source.dispose(); variant.dispose();
  });
});
