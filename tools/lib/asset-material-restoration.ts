import { createHash } from "node:crypto";
import { ImageUtils, type Document, type Texture } from "@gltf-transform/core";
import sharp from "sharp";

export const MATERIAL_RESTORATION_VERSION = "source-material-textures-1.0.0";

export interface MaterialTexturePolicy {
  colorLimit: number;
  dataLimit: number;
}

export interface RestoredTextureRecord {
  name: string;
  slots: string[];
  sourceBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  mimeType: string;
  sourceSha256: string;
  outputSha256: string;
}

type Role = "color" | "data" | "normal" | "preserve";
interface Conversion {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
  hash: string;
}

// Village assets reuse the same trim sheets. Bound the cache by encoded bytes so a larger
// catalog cannot retain every decoded image or grow memory without limit.
const conversionCache = new Map<string, Conversion>();
const CACHE_LIMIT = 96 * 1024 * 1024;
let cachedBytes = 0;
const COLOR_SLOTS = new Set(["baseColorTexture", "emissiveTexture"]);
const DATA_SLOTS = new Set(["normalTexture", "metallicRoughnessTexture", "occlusionTexture"]);
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function textureUse(document: Document, texture: Texture): { slots: string[]; role: Role } {
  const slots = new Set<string>();
  let preserve = texture.listExtensions().length > 0 || !["image/png", "image/jpeg"].includes(texture.getMimeType());
  for (const edge of document.getGraph().listParentEdges(texture)) {
    const parent = edge.getParent();
    if (parent === document.getRoot()) continue;
    const slot = edge.getName();
    if (parent.propertyType === "Material" && (COLOR_SLOTS.has(slot) || DATA_SLOTS.has(slot))) {
      // A standard slot remains classified when its TextureInfo has KHR_texture_transform.
      // Its UV transform and sampler are retained; changing image resolution does not alter them.
      slots.add(slot);
    } else {
      // Unknown extension maps can hold LUTs or other data with nonstandard sampling rules.
      slots.add(`${parent.propertyType}.${slot}`);
      preserve = true;
    }
  }
  const color = [...slots].some(slot => COLOR_SLOTS.has(slot));
  const data = [...slots].some(slot => DATA_SLOTS.has(slot));
  if (color && data) {
    throw new Error(`Texture "${texture.getName()}" is shared by color and numeric slots (${[...slots].join(", ")}). Split it into separate source textures before restoration.`);
  }
  const normal = slots.has("normalTexture");
  if (normal && (slots.has("metallicRoughnessTexture") || slots.has("occlusionTexture"))) {
    throw new Error(`Texture "${texture.getName()}" is shared by normal and scalar-data slots (${[...slots].join(", ")}). Split it before restoration so normal renormalization cannot alter scalar channels.`);
  }
  return { slots: [...slots].sort(), role: preserve || (!color && !data) ? "preserve" : color ? "color" : normal ? "normal" : "data" };
}

function dimensions(width: number, height: number, limit: number): [number, number] {
  const scale = Math.min(1, limit / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

interface Contribution { index: number; weight: number }
function contributions(source: number, target: number): Contribution[][] {
  const scale = source / target;
  return Array.from({ length: target }, (_, position) => {
    const start = position * scale;
    const end = (position + 1) * scale;
    const result: Contribution[] = [];
    for (let index = Math.floor(start); index < Math.ceil(end); index += 1) {
      if (index < source) result.push({ index, weight: (Math.min(end, index + 1) - Math.max(start, index)) / scale });
    }
    return result;
  });
}

/** Area-average the stored channel values directly. Alpha is another numeric channel here,
 * not a premultiplication weight. No ICC transform, gamma operation, or image resize runs. */
function resizeNumeric(
  source: Uint8Array, width: number, height: number, channels: 3 | 4,
  outputWidth: number, outputHeight: number, normal: boolean,
): Uint8Array {
  const xs = contributions(width, outputWidth);
  const ys = contributions(height, outputHeight);
  const output = new Uint8Array(outputWidth * outputHeight * channels);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (const row of ys[y]!) for (const column of xs[x]!) {
        const index = (row.index * width + column.index) * channels;
        const weight = row.weight * column.weight;
        r += source[index]! * weight;
        g += source[index + 1]! * weight;
        b += source[index + 2]! * weight;
        if (channels === 4) a += source[index + 3]! * weight;
      }
      if (normal) {
        r = r / 127.5 - 1; g = g / 127.5 - 1; b = b / 127.5 - 1;
        const length = Math.hypot(r, g, b);
        if (length > 1e-8) { r /= length; g /= length; b /= length; }
        else { r = 0; g = 0; b = 1; }
        r = (r + 1) * 127.5; g = (g + 1) * 127.5; b = (b + 1) * 127.5;
      }
      const index = (y * outputWidth + x) * channels;
      output[index] = Math.round(r); output[index + 1] = Math.round(g); output[index + 2] = Math.round(b);
      if (channels === 4) output[index + 3] = Math.round(a);
    }
  }
  return output;
}

async function convert(source: Uint8Array, sourceMime: string, role: Role, limit: number): Promise<Conversion> {
  if (role === "preserve") {
    // Registered codec extensions supply header readers even when sharp cannot decode their
    // payloads, such as KTX2. Preserve those bytes without passing them to an image codec.
    const size = ImageUtils.getSize(source, sourceMime);
    if (size?.[0] && size[1]) {
      return { bytes: new Uint8Array(source), width: size[0], height: size[1], mimeType: sourceMime, hash: sha256(source) };
    }
  }
  const input = Buffer.from(source);
  const metadata = await sharp(input, { ignoreIcc: role !== "color" }).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error("Material restoration requires a single image with known dimensions.");
  }
  const [width, height] = role === "preserve"
    ? [metadata.width, metadata.height]
    : dimensions(metadata.width, metadata.height, limit);
  const resized = width !== metadata.width || height !== metadata.height;
  let bytes: Uint8Array = source;
  let mimeType = sourceMime;
  if (role === "color" && resized) {
    const encoder = sharp(input).resize(width, height, { fit: "fill", kernel: "lanczos3" });
    if (metadata.hasAlpha) {
      bytes = await encoder.png({ palette: false, compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      mimeType = "image/png";
    } else {
      bytes = await encoder.jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
      mimeType = "image/jpeg";
    }
  } else if (role === "data" || role === "normal") {
    // Fail instead of silently truncating a high-bit-depth source through sharp's default
    // 8-bit raw output. Current architectural source data maps are all unsigned 8-bit.
    if (metadata.depth !== "uchar") {
      throw new Error(`Numeric texture uses ${metadata.depth ?? "unknown"} samples; restoration supports unsigned 8-bit data. Add an explicit higher-bit-depth conversion before rebuilding this asset.`);
    }
    if (!["srgb", "b-w"].includes(metadata.space ?? "")) {
      throw new Error(`Numeric texture uses ${metadata.space ?? "unknown"} color space; provide RGB or grayscale data without a color-space conversion.`);
    }
    const decoded = await sharp(input, { ignoreIcc: true }).raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 3 && decoded.info.channels !== 4) {
      throw new Error(`Numeric texture decoded to ${decoded.info.channels} channels; RGB or RGBA data is required.`);
    }
    const channels = decoded.info.channels;
    const pixels = resized
      ? resizeNumeric(decoded.data, metadata.width, metadata.height, channels, width, height, role === "normal")
      : decoded.data;
    bytes = await sharp(pixels, { raw: { width, height, channels } })
      .png({ palette: false, compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    mimeType = "image/png";
  }
  return { bytes: new Uint8Array(bytes), width, height, mimeType, hash: sha256(bytes) };
}

/** Restores texture payload quality for embedded GLB output without modifying graph references or model data.
 * All conversions finish before any document mutation, so a bad slot or image leaves it intact. */
export async function restoreSourceMaterialTextures(
  document: Document, policy: MaterialTexturePolicy,
): Promise<RestoredTextureRecord[]> {
  for (const [name, limit] of [["colorLimit", policy.colorLimit], ["dataLimit", policy.dataLimit]] as const) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`${name} must be a positive integer texture limit.`);
  }
  const plans = document.getRoot().listTextures().map(texture => {
    const source = texture.getImage();
    if (!source) throw new Error(`Texture "${texture.getName()}" has no image payload; resolve source images before restoration.`);
    return { texture, source, ...textureUse(document, texture) };
  });
  const staged: Array<{ texture: Texture; conversion: Conversion; record: RestoredTextureRecord }> = [];
  for (const { texture, source, slots, role } of plans) {
    const sourceHash = sha256(source);
    const limit = role === "color" ? policy.colorLimit : policy.dataLimit;
    const key = `${MATERIAL_RESTORATION_VERSION}:${sourceHash}:${texture.getMimeType()}:${role}:${limit}`;
    let conversion = conversionCache.get(key);
    if (!conversion) {
      try { conversion = await convert(source, texture.getMimeType(), role, limit); }
      catch (error) { throw new Error(`Texture "${texture.getName()}" (${slots.join(", ")}): ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
      if (conversion.bytes.byteLength <= CACHE_LIMIT) {
        // Concurrent callers can finish the same source conversion between cache lookup and
        // insertion. Remove the previous accounting before replacing that entry.
        const previous = conversionCache.get(key);
        if (previous) { cachedBytes -= previous.bytes.byteLength; conversionCache.delete(key); }
        while (cachedBytes + conversion.bytes.byteLength > CACHE_LIMIT && conversionCache.size) {
          const oldestKey = conversionCache.keys().next().value!;
          cachedBytes -= conversionCache.get(oldestKey)!.bytes.byteLength;
          conversionCache.delete(oldestKey);
        }
        conversionCache.set(key, conversion);
        cachedBytes += conversion.bytes.byteLength;
      }
    }
    staged.push({ texture, conversion, record: {
      name: texture.getName(), slots, sourceBytes: source.byteLength, outputBytes: conversion.bytes.byteLength,
      width: conversion.width, height: conversion.height, mimeType: conversion.mimeType,
      sourceSha256: sourceHash, outputSha256: conversion.hash,
    } });
  }
  for (const { texture, conversion } of staged) {
    texture.setImage(new Uint8Array(conversion.bytes)).setMimeType(conversion.mimeType);
  }
  return staged.map(({ record }) => record);
}
