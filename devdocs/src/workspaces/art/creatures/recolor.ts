/*
  A hue, saturation and value shift of an albedo map that keeps every pixel's detail: each RGBA
  pixel goes to HSV, shifts, and comes back. Alpha is untouched. With `near`, only hues close to
  `near.hue` move (a soft falloff over `near.width` degrees), so a fur colour can change while the
  eyes and horns keep theirs. Pure: the canvas work lives in `skinApi.ts`.
*/

export interface RecolorParams {
  /** Degrees, -180 to 180. */
  hue: number;
  /** Multiplier on saturation; 1 keeps it. */
  saturation: number;
  /** Multiplier on value (brightness); 1 keeps it. */
  value: number;
  /** Only shift hues within `width` degrees of `hue` (0 to 360). Absent: every pixel. */
  near?: { hue: number; width: number };
}

export const IDENTITY_RECOLOR: RecolorParams = { hue: 0, saturation: 1, value: 1 };

/** Pixels greyer than this have no meaningful hue, so a hue mask leaves them alone. */
const GREY = 0.08;

export const isIdentityRecolor = (params: RecolorParams): boolean => params.hue === 0 && params.saturation === 1 && params.value === 1;

/** Recolor RGBA pixels into a new array of the same length. */
export function recolorPixels(pixels: Uint8ClampedArray, params: RecolorParams): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  const near = params.near && params.near.width > 0 ? params.near : undefined;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index]! / 255, g = pixels[index + 1]! / 255, b = pixels[index + 2]! / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta > 0) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;
    let s = max === 0 ? 0 : delta / max;
    let v = max;

    let weight = 1;
    if (near) {
      const distance = Math.abs(((h - near.hue) % 360 + 540) % 360 - 180);
      weight = s < GREY ? 0 : Math.max(0, 1 - distance / near.width);
    }
    if (weight > 0) {
      h = ((h + params.hue * weight) % 360 + 360) % 360;
      s = Math.min(1, s * (1 + (params.saturation - 1) * weight));
      v = Math.min(1, v * (1 + (params.value - 1) * weight));
    }

    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const sector = Math.floor(h / 60) % 6;
    const [rr, gg, bb] = sector === 0 ? [c, x, 0] : sector === 1 ? [x, c, 0] : sector === 2 ? [0, c, x] : sector === 3 ? [0, x, c] : sector === 4 ? [x, 0, c] : [c, 0, x];
    out[index] = Math.round((rr + m) * 255);
    out[index + 1] = Math.round((gg + m) * 255);
    out[index + 2] = Math.round((bb + m) * 255);
    out[index + 3] = pixels[index + 3]!;
  }
  return out;
}
