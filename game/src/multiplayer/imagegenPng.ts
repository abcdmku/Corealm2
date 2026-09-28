import { deflateSync, inflateSync } from "node:zlib";

/**
 * PNG reading, writing and resampling in plain Node, for image jobs on a packaged server: `sharp` is a
 * native addon and a single executable cannot carry one. Reads every non-interlaced PNG (grey, grey
 * with alpha, RGB, RGBA, palette; 1 to 16 bits), which covers what image models and browser canvases
 * write. Writes 8-bit RGBA.
 */

export interface RgbaImage { width: number; height: number; /** Row-major RGBA, 4 bytes a pixel. */ data: Uint8Array }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export class PngFailure extends Error {
  constructor(message: string) { super(message); this.name = "PngFailure"; }
}

/** Width and height from the IHDR chunk, or undefined for bytes that are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE) || buffer.toString("latin1", 12, 16) !== "IHDR") return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!pngSize(buffer)) throw new PngFailure("Not a PNG");
  let width = 0, height = 0, depth = 0, type = 0, palette: Buffer | undefined, alpha: Buffer | undefined;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at), name = buffer.toString("latin1", at + 4, at + 8), body = buffer.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; type = body[9]!;
      if (body[12] !== 0) throw new PngFailure("Interlaced PNGs are not supported");
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") alpha = body;
    else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    at += 12 + length;
  }
  const channels = CHANNELS[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || !width || !height) throw new PngFailure(`Unsupported PNG (colour type ${type}, ${depth} bits)`);
  if (type === 3 && !palette) throw new PngFailure("A palette PNG without a palette");
  const bitsPerPixel = channels * depth, stride = Math.ceil(width * bitsPerPixel / 8), step = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new PngFailure("Truncated PNG data");

  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride), row = new Uint8Array(stride);
  const sample = (line: Uint8Array, index: number): number => {
    if (depth === 8) return line[index]!;
    if (depth === 16) return line[index * 2]!;
    const bit = index * depth, value = (line[bit >> 3]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? value : Math.round(value * 255 / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[offset + 1 + x]!, left = x >= step ? row[x - step]! : 0, up = previous[x]!, corner = x >= step ? previous[x - step]! : 0;
      row[x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1)
        : filter === 4 ? value + paeth(left, up, corner) : failFilter(filter)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4, base = x * channels;
      if (type === 3) {
        const index = sample(row, x);
        out[target] = palette![index * 3] ?? 0; out[target + 1] = palette![index * 3 + 1] ?? 0; out[target + 2] = palette![index * 3 + 2] ?? 0;
        out[target + 3] = alpha?.[index] ?? 255;
      } else if (channels <= 2) {
        const grey = sample(row, base);
        out[target] = out[target + 1] = out[target + 2] = grey;
        out[target + 3] = channels === 2 ? sample(row, base + 1) : alpha && depth === 8 && alpha.readUInt16BE(0) === grey ? 0 : 255;
      } else {
        out[target] = sample(row, base); out[target + 1] = sample(row, base + 1); out[target + 2] = sample(row, base + 2);
        out[target + 3] = channels === 4 ? sample(row, base + 3) : 255;
      }
    }
    [previous, row] = [row, previous];
  }
  return { width, height, data: out };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function failFilter(filter: number): never { throw new PngFailure(`Unknown PNG row filter ${filter}`); }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function chunk(name: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0); head.write(name, 4, "latin1");
  let crc = 0xffffffff;
  for (const byte of head.subarray(4)) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

/** 8-bit RGBA, Paeth-filtered, deflated at level 9. */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image, stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), line = y * stride;
    raw[offset] = 4;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? data[line + x - 4]! : 0, up = y ? data[line - stride + x]! : 0, corner = y && x >= 4 ? data[line - stride + x - 4]! : 0;
      raw[offset + 1 + x] = (data[line + x]! - paeth(left, up, corner)) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Per output index along one axis: the source indices and weights of a tent filter as wide as the scale. */
function taps(from: number, to: number): { index: Int32Array; weight: Float32Array; count: number } {
  const scale = from / to, radius = Math.max(1, scale), count = Math.ceil(radius) * 2 + 1;
  const index = new Int32Array(to * count), weight = new Float32Array(to * count);
  for (let o = 0; o < to; o++) {
    const centre = (o + 0.5) * scale - 0.5, first = Math.floor(centre - radius) + 1;
    let total = 0;
    for (let k = 0; k < count; k++) {
      const source = first + k, w = Math.max(0, 1 - Math.abs(source - centre) / radius);
      index[o * count + k] = Math.min(from - 1, Math.max(0, source)); weight[o * count + k] = w; total += w;
    }
    for (let k = 0; k < count; k++) weight[o * count + k]! /= total || 1;
  }
  return { index, weight, count };
}

/** Stretches to exactly `width` x `height` (no crop, no letterbox), filtering in premultiplied alpha. */
export function resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;
  const source = new Float32Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const a = image.data[i + 3]! / 255;
    source[i] = image.data[i]! * a; source[i + 1] = image.data[i + 1]! * a; source[i + 2] = image.data[i + 2]! * a; source[i + 3] = image.data[i + 3]!;
  }
  const across = taps(image.width, width), down = taps(image.height, height);
  const middle = new Float32Array(width * image.height * 4);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < width; x++) {
    const target = (y * width + x) * 4;
    for (let k = 0; k < across.count; k++) {
      const w = across.weight[x * across.count + k]!;
      if (!w) continue;
      const from = (y * image.width + across.index[x * across.count + k]!) * 4;
      for (let c = 0; c < 4; c++) middle[target + c]! += source[from + c]! * w;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < down.count; k++) {
      const w = down.weight[y * down.count + k]!;
      if (!w) continue;
      const from = (down.index[y * down.count + k]! * width + x) * 4;
      r += middle[from]! * w; g += middle[from + 1]! * w; b += middle[from + 2]! * w; a += middle[from + 3]! * w;
    }
    const target = (y * width + x) * 4, unpremultiply = a > 0 ? 255 / a : 0;
    data[target] = clamp(r * unpremultiply); data[target + 1] = clamp(g * unpremultiply); data[target + 2] = clamp(b * unpremultiply); data[target + 3] = clamp(a);
  }
  return { width, height, data };
}
const clamp = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
