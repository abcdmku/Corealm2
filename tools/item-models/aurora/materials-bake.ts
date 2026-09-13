import * as THREE from 'three';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const SIZE = 2048;
const ROOT = 'art/aurora/textures';
const SOURCE = `${ROOT}/imagegen-r1/aurora-embroidered-source.png`;
const PROMPT = `${ROOT}/imagegen-r1/aurora-embroidered-prompt.txt`;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const linear = (byte: number) => byte / 255 <= .04045 ? byte / 255 / 12.92 : ((byte / 255 + .055) / 1.055) ** 2.4;
const encoded = (value: number) => {
  const channel = clamp(value, 0, 1);
  return 255 * (channel <= .0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - .055);
};
const smooth = THREE.MathUtils.smoothstep;

/** Close values and derivatives at the UV boundary without mirroring the design. */
function periodic(field: Float64Array, maxSlope = Infinity): void {
  const band = 10;
  const join = (indices: number[]) => {
    const values = indices.map(index => field[index]!);
    const end = SIZE - 1;
    const value = (values[0]! + values[end]!) / 2;
    const slope = clamp(((values[2]! - values[0]!) + (values[end]! - values[end - 2]!)) / 4, -maxSlope, maxSlope);
    const hermite = (a: number, b: number, da: number, db: number, t: number) =>
      (2 * t ** 3 - 3 * t * t + 1) * a + (t ** 3 - 2 * t * t + t) * da
      + (-2 * t ** 3 + 3 * t * t) * b + (t ** 3 - t * t) * db;
    const leftSlope = clamp((values[band + 1]! - values[band - 1]!) / 2, -maxSlope, maxSlope);
    const rightSlope = clamp((values[end - band + 1]! - values[end - band - 1]!) / 2, -maxSlope, maxSlope);
    for (let index = 0; index <= band; index++) {
      field[indices[index]!] = hermite(value, values[band]!, slope * band, leftSlope * band, index / band);
      field[indices[end - band + index]!] = hermite(values[end - band]!, value, rightSlope * band, slope * band, index / band);
    }
  };
  for (let y = 0; y < SIZE; y++) join(Array.from({ length: SIZE }, (_, x) => y * SIZE + x));
  for (let x = 0; x < SIZE; x++) join(Array.from({ length: SIZE }, (_, y) => y * SIZE + x));
}

/** Bake inferred relief from the original generated scan. This is authored PBR,
 * not a measured scan. Embroidery has a separate chroma mask so pale base yarns
 * never inherit the gold thread's metalness or polished reflection response. */
export async function bakeAuroraTextures(): Promise<Record<string, unknown>> {
  await mkdir(ROOT, { recursive: true });
  const [source, prompt] = await Promise.all([readFile(SOURCE), readFile(PROMPT)]);
  const sourceMetadata = await sharp(source).metadata();
  const data = await sharp(source).resize(SIZE, SIZE, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  assert.equal(data.length, SIZE * SIZE * 3);
  const count = SIZE * SIZE;
  const mask = new Float64Array(count);
  const gray = new Uint8Array(count);
  const channelMeans = [0, 0, 0];
  let clothWeight = 0, grayMean = 0, stitchPixels = 0, maskSum = 0;
  for (let p = 0; p < count; p++) {
    const r = data[p * 3]! / 255, g = data[p * 3 + 1]! / 255, b = data[p * 3 + 2]! / 255;
    // Neutral ivory has low chroma even in shadow. Only genuinely amber yarns
    // pass both the red-blue and green-blue tests; hue alone stains ivory gold.
    mask[p] = smooth((r - b) / Math.max(r, .01), .16, .36)
      * smooth((g - b) / Math.max(g, .01), .11, .28)
      * smooth(g / Math.max(r, .01), .36, .61);
    const weight = (1 - mask[p]!) ** 4;
    const luminance = (r * .2126 + g * .7152 + b * .0722) * 255;
    gray[p] = Math.round(luminance);
    clothWeight += weight; grayMean += luminance * weight;
    maskSum += mask[p]!; if (mask[p]! > .5) stitchPixels++;
    for (let c = 0; c < 3; c++) channelMeans[c]! += linear(data[p * 3 + c]!) * weight;
  }
  grayMean /= clothWeight;
  for (let c = 0; c < 3; c++) channelMeans[c]! /= clothWeight;
  const dyeMeanSRGB = '#c8c5bd';
  const target = new THREE.Color(dyeMeanSRGB).toArray();
  const colors = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
  for (let p = 0; p < count; p++) {
    for (let c = 0; c < 3; c++) {
      const original = linear(data[p * 3 + c]!);
      const relative = original / channelMeans[c]!;
      // Half-strength reflectance variance leaves individual yarns readable
      // without baking the source scan's highlights into a white game material.
      const cloth = target[c]! * Math.pow(relative, .48);
      colors[c]![p] = encoded(THREE.MathUtils.lerp(cloth, original * .85, mask[p]!));
    }
    gray[p] = Math.round(THREE.MathUtils.lerp(gray[p]!, grayMean, mask[p]!));
  }
  for (const field of colors) periodic(field, .09);
  const blurred = async (sigma: number) => sharp(gray, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .blur(sigma).grayscale().raw().toBuffer();
  const [medium, broad] = await Promise.all([blurred(1.6), blurred(15)]);
  assert.equal(medium.length, count); assert.equal(broad.length, count);
  let mean = 0; for (const value of broad) mean += value / count;
  const height = new Float64Array(count), rough = new Float64Array(count), metal = new Float64Array(count);
  for (let p = 0; p < count; p++) {
    const macro = (broad[p]! - mean) / 255;
    const mid = (medium[p]! - broad[p]!) / 255;
    const fine = (gray[p]! - medium[p]!) / 255;
    height[p] = macro * .0014 + mid * .00060 + fine * .00016 + mask[p]! * .00058;
    rough[p] = THREE.MathUtils.lerp(clamp(.88 + Math.abs(fine) * .16 - mid * .10, .84, .94), .42, mask[p]!);
    metal[p] = mask[p]! * .68;
  }
  periodic(height, .000005); periodic(rough, .0003); periodic(metal, .0003);
  // Hermite interpolation may overshoot by a fraction at a seam. Keep the
  // authored material limits exact after closure, before packing channels.
  for (let p = 0; p < count; p++) {
    rough[p] = clamp(rough[p]!, .42, .94);
    metal[p] = clamp(metal[p]!, 0, .68);
  }
  const albedo = new Uint8Array(count * 4), normal = new Uint8Array(count * 4);
  const packed = new Uint8Array(count * 4), maskBytes = new Uint8Array(count);
  const sample = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + (x + SIZE) % SIZE]!;
  let minRough = 1, maxRough = 0, maxMetal = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = y * SIZE + x, i = p * 4;
    const dx = clamp((sample(x + 1, y) - sample(x - 1, y)) * SIZE / (2 * .35), -.75, .75);
    const dy = clamp((sample(x, y + 1) - sample(x, y - 1)) * SIZE / (2 * .35), -.75, .75);
    const length = Math.hypot(dx, dy, 1);
    albedo.set([Math.round(colors[0]![p]!), Math.round(colors[1]![p]!), Math.round(colors[2]![p]!), 255], i);
    normal.set([Math.round((.5 - .5 * dx / length) * 255), Math.round((.5 - .5 * dy / length) * 255), Math.round((.5 + .5 / length) * 255), 255], i);
    packed.set([255, Math.round(clamp(rough[p]!, 0, 1) * 255), Math.round(clamp(metal[p]!, 0, 1) * 255), 255], i);
    maskBytes[p] = Math.round(clamp(metal[p]! / .68, 0, 1) * 255);
    minRough = Math.min(minRough, rough[p]!); maxRough = Math.max(maxRough, rough[p]!); maxMetal = Math.max(maxMetal, metal[p]!);
  }
  const outputs: Record<string, { path: string; sha256: string }> = {};
  for (const [name, bytes, channels] of [
    ['cloth-color', albedo, 4], ['cloth-normal', normal, 4], ['cloth-roughness', packed, 4], ['cloth-gold-mask', maskBytes, 1],
  ] as const) {
    const png = await sharp(bytes, { raw: { width: SIZE, height: SIZE, channels } }).png().toBuffer();
    const filename = `${ROOT}/${name}.png`; await writeFile(filename, png);
    outputs[name] = { path: filename, sha256: digest(png) };
  }
  const provenance = {
    mode: 'built-in image_gen', intent: 'new image', round: 'aurora-r1',
    sourceImage: SOURCE, sourceSha256: digest(source), promptFile: PROMPT, promptSha256: digest(prompt),
    originalGeneratedPath: 'C:/Users/Borg/.codex/generated_images/01a09709-b31a-71b0-b946-1019c46c84be/exec-68ce3cda-ee50-46c6-ab1d-a24917eb59d7.png',
    sourceResolution: [sourceMetadata.width, sourceMetadata.height], resolution: [SIZE, SIZE], nominalTileMeters: .35,
    dyeMeanSRGB, baker: 'tools/item-models/aurora/materials-bake.ts',
    albedoEncoding: 'sRGB. Base yarns normalized in linear light to pearl ivory mean, source value ratios to power .48. Gold source retained at 85 percent linear reflectance.',
    heightMethod: 'Inferred source yarn relief and separately raised amber embroidery, not measured material data. No procedural motifs or painted fold shadows.',
    heightGainsMeters: { broad: .0014, medium: .00060, yarn: .00016, goldStitch: .00058 },
    packedMaterial: { channels: { R: 'unused white', G: 'roughness', B: 'metallic' }, baseCloth: { metallic: 0, roughness: [.84, .94] }, embroidery: { maxMetallic: .68, roughness: .42 }, mask: 'Dual red-blue and green-blue chroma plus amber hue ratio; neutral ivory excluded.' },
    boundary: '10-pixel Hermite closure of albedo, height, roughness and metallic planes; clamp packed response to authored limits after closure',
    stats: { strongGoldFraction: stitchPixels / count, meanGoldMask: maskSum / count, roughnessRange: [minRough, maxRough], maxMetallic: maxMetal },
    outputs,
  };
  await writeFile(`${ROOT}/provenance.json`, JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await bakeAuroraTextures(), null, 2));
}
