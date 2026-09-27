import { describe, expect, it } from "vitest";
import { IDENTITY_RECOLOR, recolorPixels } from "../devdocs/src/workspaces/art/creatures/recolor.js";

const pixels = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());
const list = (data: Uint8ClampedArray) => [...data];

describe("recolorPixels", () => {
  it("leaves pixels alone with the identity shift", () => {
    const source = pixels([200, 40, 10, 255], [12, 130, 220, 128], [90, 90, 90, 0]);
    expect(list(recolorPixels(source, IDENTITY_RECOLOR))).toEqual([200, 40, 10, 255, 12, 130, 220, 128, 90, 90, 90, 0]);
  });

  it("turns red green with a 120 degree hue shift and keeps alpha", () => {
    expect(list(recolorPixels(pixels([255, 0, 0, 77]), { hue: 120, saturation: 1, value: 1 }))).toEqual([0, 255, 0, 77]);
  });

  it("wraps negative hue shifts", () => {
    expect(list(recolorPixels(pixels([255, 0, 0, 255]), { hue: -120, saturation: 1, value: 1 }))).toEqual([0, 0, 255, 255]);
  });

  it("greys out at zero saturation and halves brightness at value 0.5", () => {
    expect(list(recolorPixels(pixels([255, 0, 0, 255]), { hue: 0, saturation: 0, value: 1 }))).toEqual([255, 255, 255, 255]);
    expect(list(recolorPixels(pixels([200, 100, 50, 255]), { hue: 0, saturation: 1, value: 0.5 }))).toEqual([100, 50, 25, 255]);
  });

  it("clamps saturation and value at full", () => {
    expect(list(recolorPixels(pixels([255, 128, 128, 255]), { hue: 0, saturation: 3, value: 2 }))).toEqual([255, 0, 0, 255]);
  });

  it("shifts only hues near the mask and never greys", () => {
    const source = pixels([255, 0, 0, 255], [0, 0, 255, 255], [128, 128, 128, 255]);
    const shifted = recolorPixels(source, { hue: 120, saturation: 1, value: 1, near: { hue: 0, width: 40 } });
    expect(list(shifted)).toEqual([0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]);
  });

  it("fades the shift across the mask's width", () => {
    // Orange (hue 30.1) is about half of 60 degrees from red: about half the value change.
    const [r, g, b] = recolorPixels(pixels([255, 128, 0, 255]), { hue: 0, saturation: 1, value: 0.5, near: { hue: 0, width: 60 } });
    expect([r, g, b]).toEqual([192, 96, 0]);
  });
});
