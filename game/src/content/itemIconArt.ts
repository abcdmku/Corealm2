/**
 * Item icon art, as pixels: how a generated original becomes the 256px master and the outlined 48px
 * inventory icon (docs/item-icons.md). Plain TypeScript over straight-alpha RGBA, so the browser
 * (devdocs upload preview), a live server's icon jobs and the repository tools derive the same icon.
 *
 * The repository tools run the same steps through `sharp` (`tools/lib/item-icon-art.ts`), whose bytes
 * the published icons are; this module follows libvips closely enough that the two differ by a few
 * levels at most (`tests/item-icon-art-parity.test.ts`).
 *
 *   original -> trim transparent edges -> fit 240x240, centred -> 8px transparent frame = 256 master
 *   master   -> trim -> fit inside 44x44 -> black 1px outline, centred on 48x48         = 48 icon
 */

export const ITEM_ICON_MASTER_SIZE = 256;
export const ITEM_ICON_GAME_SIZE = 48;
/** Transparent frame around the master's artwork. */
export const ITEM_ICON_MASTER_MARGIN = 8;
/** The 48px icon's artwork box; the rest is outline and air. */
export const ITEM_ICON_CONTENT_SIZE = 44;
export const ITEM_ICON_OUTLINE_RADIUS = 1;
/** Alpha at or below this is background, for trimming and the transparency check. */
export const ITEM_ICON_ALPHA_THRESHOLD = 8;

/** Where players load an item's icons, by path under the game's public tree (the server asset store's paths). */
export function itemIconPublicPaths(itemId: string): { master: string; game: string } {
  return { master: `assets/icons/items/${ITEM_ICON_MASTER_SIZE}/${itemId}.png`, game: `assets/icons/items/${ITEM_ICON_GAME_SIZE}/${itemId}.png` };
}

/** Straight (not premultiplied) 8-bit RGBA, row-major. */
export interface RgbaImage { readonly width: number; readonly height: number; readonly data: Uint8Array | Uint8ClampedArray }
/** What this module makes. */
export interface IconPixels extends RgbaImage { readonly data: Uint8Array }

export interface IconBounds { left: number; top: number; width: number; height: number }

/**
 * Why an original cannot become an icon, or undefined. It must keep real transparency around visible
 * artwork: at least 5% clear and 1% visible pixels.
 */
export function itemIconOriginalProblem(image: RgbaImage): string | undefined {
  let clear = 0, visible = 0;
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset]! <= ITEM_ICON_ALPHA_THRESHOLD) clear += 1; else visible += 1;
  }
  const pixels = image.width * image.height;
  if (clear < pixels * 0.05 || visible < pixels * 0.01) return "An icon original needs real transparency and visible artwork";
  return undefined;
}

/**
 * The artwork's bounds: pixels whose 3x3 median alpha is above the threshold, edges extended. This is
 * libvips' `find_trim` against a transparent background, which ignores single stray pixels.
 */
export function itemIconTrimBounds(image: RgbaImage): IconBounds | undefined {
  const { width, height, data } = image;
  const alpha = (x: number, y: number) => data[((y < 0 ? 0 : y >= height ? height - 1 : y) * width + (x < 0 ? 0 : x >= width ? width - 1 : x)) * 4 + 3]!;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // The 3x3 median is above the threshold exactly when five or more of the nine are.
      let above = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (alpha(x + dx, y + dy) > ITEM_ICON_ALPHA_THRESHOLD) above += 1;
      }
      if (above < 5) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? undefined : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function cropRgba(image: RgbaImage, bounds: IconBounds): IconPixels {
  const data = new Uint8Array(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const from = ((bounds.top + y) * image.width + bounds.left) * 4;
    data.set(image.data.subarray(from, from + bounds.width * 4), y * bounds.width * 4);
  }
  return { width: bounds.width, height: bounds.height, data };
}

/** The size `width` x `height` scales to inside a `box` square, keeping its aspect (sharp's `contain`/`inside`). */
export function itemIconFitSize(width: number, height: number, box: number): { width: number; height: number } {
  const shrink = Math.max(width / box, height / box);
  return { width: Math.max(1, Math.min(box, Math.round(width / shrink))), height: Math.max(1, Math.min(box, Math.round(height / shrink))) };
}

/* ---------- Resampling: libvips' resize with the lanczos3 kernel and its default gap of 2 ---------- */

type Plane = Float64Array;

function lanczos3(x: number): number {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/** Premultiplied float RGBA. */
function premultiply(image: RgbaImage): Plane {
  const out = new Float64Array(image.width * image.height * 4);
  for (let offset = 0; offset < out.length; offset += 4) {
    const a = image.data[offset + 3]!, f = a / 255;
    out[offset] = image.data[offset]! * f;
    out[offset + 1] = image.data[offset + 1]! * f;
    out[offset + 2] = image.data[offset + 2]! * f;
    out[offset + 3] = a;
  }
  return out;
}

function unpremultiply(plane: Plane, width: number, height: number): IconPixels {
  const data = new Uint8Array(width * height * 4);
  const clamp = (value: number) => value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
  for (let offset = 0; offset < data.length; offset += 4) {
    const a = plane[offset + 3]!;
    const f = a > 0 ? 255 / a : 0;
    data[offset] = clamp(plane[offset]! * f);
    data[offset + 1] = clamp(plane[offset + 1]! * f);
    data[offset + 2] = clamp(plane[offset + 2]! * f);
    data[offset + 3] = clamp(a);
  }
  return { width, height, data };
}

/** Block average along one axis by an integer factor, a partial last block averaging what it has. */
function shrinkAxis(plane: Plane, width: number, height: number, factor: number, horizontal: boolean): { plane: Plane; width: number; height: number } {
  if (factor <= 1) return { plane, width, height };
  const outWidth = horizontal ? Math.ceil(width / factor) : width;
  const outHeight = horizontal ? height : Math.ceil(height / factor);
  const out = new Float64Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < factor; k += 1) {
        // A partial last block repeats the edge pixel, as libvips' `ceil` shrink does.
        const sx = horizontal ? Math.min(width - 1, x * factor + k) : x;
        const sy = horizontal ? y : Math.min(height - 1, y * factor + k);
        const offset = (sy * width + sx) * 4;
        r += plane[offset]!; g += plane[offset + 1]!; b += plane[offset + 2]!; a += plane[offset + 3]!;
      }
      const offset = (y * outWidth + x) * 4;
      out[offset] = r / factor; out[offset + 1] = g / factor; out[offset + 2] = b / factor; out[offset + 3] = a / factor;
    }
  }
  return { plane: out, width: outWidth, height: outHeight };
}

/** Lanczos3 along one axis to `to` samples, centre-aligned and shifted by `offset` source samples, the kernel widened by the shrink. */
function reduceAxis(plane: Plane, width: number, height: number, to: number, shrink: number, offset: number, horizontal: boolean): { plane: Plane; width: number; height: number } {
  const from = horizontal ? width : height;
  if (to === from && shrink === 1 && offset === 0) return { plane, width, height };
  const scale = Math.max(1, shrink);
  const points = Math.round(2 * 3 * scale) + 1;
  const taps = new Int32Array(to * points);
  const weights = new Float64Array(to * points);
  for (let o = 0; o < to; o += 1) {
    const centre = (o + 0.5) * shrink - 0.5 + offset;
    const first = Math.floor(centre) - Math.floor((points - 1) / 2);
    let total = 0;
    for (let k = 0; k < points; k += 1) {
      const source = first + k;
      const weight = lanczos3((source - centre) / scale);
      taps[o * points + k] = source < 0 ? 0 : source >= from ? from - 1 : source;
      weights[o * points + k] = weight;
      total += weight;
    }
    for (let k = 0; k < points; k += 1) weights[o * points + k]! /= total;
  }
  const outWidth = horizontal ? to : width, outHeight = horizontal ? height : to;
  const out = new Float64Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const o = horizontal ? x : y;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < points; k += 1) {
        const weight = weights[o * points + k]!;
        if (weight === 0) continue;
        const source = taps[o * points + k]!;
        const at = horizontal ? (y * width + source) * 4 : (source * width + x) * 4;
        r += plane[at]! * weight; g += plane[at + 1]! * weight; b += plane[at + 2]! * weight; a += plane[at + 3]! * weight;
      }
      const target = (y * outWidth + x) * 4;
      out[target] = r; out[target + 1] = g; out[target + 2] = b; out[target + 3] = a;
    }
  }
  return { plane: out, width: outWidth, height: outHeight };
}

/**
 * Scales to fit inside a `box` square with one factor for both axes, as sharp's `inside` and `contain`
 * do (the rounded side is sampled at that factor, not stretched to its own), in
 * premultiplied alpha: an integer block shrink for all but the last factor of two or more, then lanczos3.
 */
export function fitItemIconRgba(image: RgbaImage, box: number): IconPixels {
  const size = itemIconFitSize(image.width, image.height, box);
  const shrink = Math.max(image.width / box, image.height / box);
  const blocks = Math.max(1, Math.floor(shrink / 2));
  let current = { plane: premultiply(image), width: image.width, height: image.height };
  current = shrinkAxis(current.plane, current.width, current.height, blocks, true);
  current = shrinkAxis(current.plane, current.width, current.height, blocks, false);
  // The rounded side is sampled at the uniform factor and centred on the original's span.
  current = reduceAxis(current.plane, current.width, current.height, size.width, shrink / blocks, (image.width - size.width * shrink) / 2 / blocks, true);
  current = reduceAxis(current.plane, current.width, current.height, size.height, shrink / blocks, (image.height - size.height * shrink) / 2 / blocks, false);
  return unpremultiply(current.plane, current.width, current.height);
}

/* ---------- The two sizes ---------- */

/** Straight-alpha `over`, in place: `top` placed at (`left`, `topY`) on `base`. */
function compositeOver(base: Uint8Array, baseWidth: number, baseHeight: number, top: RgbaImage, left: number, topY: number): void {
  for (let y = 0; y < top.height; y += 1) {
    const by = topY + y;
    if (by < 0 || by >= baseHeight) continue;
    for (let x = 0; x < top.width; x += 1) {
      const bx = left + x;
      if (bx < 0 || bx >= baseWidth) continue;
      const s = (y * top.width + x) * 4, d = (by * baseWidth + bx) * 4;
      const sa = top.data[s + 3]! / 255;
      if (sa === 0) continue;
      const da = base[d + 3]! / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c += 1) base[d + c] = Math.round((top.data[s + c]! * sa + base[d + c]! * da * (1 - sa)) / oa);
      base[d + 3] = Math.round(oa * 255);
    }
  }
}

/** The 256 master: the original's artwork trimmed, fitted to 240x240 and framed by 8 transparent pixels. */
export function itemIconMaster(original: RgbaImage): IconPixels {
  const problem = itemIconOriginalProblem(original);
  if (problem) throw new Error(problem);
  const bounds = itemIconTrimBounds(original)!;
  const box = ITEM_ICON_MASTER_SIZE - ITEM_ICON_MASTER_MARGIN * 2;
  const art = fitItemIconRgba(cropRgba(original, bounds), box);
  const size = { width: art.width, height: art.height };
  const data = new Uint8Array(ITEM_ICON_MASTER_SIZE * ITEM_ICON_MASTER_SIZE * 4);
  const left = ITEM_ICON_MASTER_MARGIN + Math.floor((box - size.width) / 2);
  const top = ITEM_ICON_MASTER_MARGIN + Math.floor((box - size.height) / 2);
  for (let y = 0; y < size.height; y += 1) data.set(art.data.subarray(y * size.width * 4, (y + 1) * size.width * 4), ((top + y) * ITEM_ICON_MASTER_SIZE + left) * 4);
  return { width: ITEM_ICON_MASTER_SIZE, height: ITEM_ICON_MASTER_SIZE, data };
}

/** The 48 inventory icon: the master's artwork fitted inside 44x44 with a 1px black outline, centred. */
export function itemIconGame(master: RgbaImage): IconPixels {
  const bounds = itemIconTrimBounds(master);
  if (!bounds) throw new Error("The master has no visible artwork");
  const art = fitItemIconRgba(cropRgba(master, bounds), ITEM_ICON_CONTENT_SIZE);
  const silhouette = new Uint8Array(art.data.length);
  for (let offset = 3; offset < art.data.length; offset += 4) silhouette[offset] = art.data[offset]!;
  const shadow: RgbaImage = { width: art.width, height: art.height, data: silhouette };
  const data = new Uint8Array(ITEM_ICON_GAME_SIZE * ITEM_ICON_GAME_SIZE * 4);
  const left = Math.floor((ITEM_ICON_GAME_SIZE - art.width) / 2);
  const top = Math.floor((ITEM_ICON_GAME_SIZE - art.height) / 2);
  for (let y = -ITEM_ICON_OUTLINE_RADIUS; y <= ITEM_ICON_OUTLINE_RADIUS; y += 1) {
    for (let x = -ITEM_ICON_OUTLINE_RADIUS; x <= ITEM_ICON_OUTLINE_RADIUS; x += 1) {
      if (x !== 0 || y !== 0) compositeOver(data, ITEM_ICON_GAME_SIZE, ITEM_ICON_GAME_SIZE, shadow, left + x, top + y);
    }
  }
  compositeOver(data, ITEM_ICON_GAME_SIZE, ITEM_ICON_GAME_SIZE, art, left, top);
  return { width: ITEM_ICON_GAME_SIZE, height: ITEM_ICON_GAME_SIZE, data };
}

/** Both sizes from an original. Throws when the original lacks transparency or artwork. */
export function deriveItemIconArt(original: RgbaImage): { master: IconPixels; game: IconPixels } {
  const master = itemIconMaster(original);
  return { master, game: itemIconGame(master) };
}

/** Lowercase hex SHA-256, through Web Crypto (browsers and Node alike). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
