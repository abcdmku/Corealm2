import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Matched PBR data from the selected reference-based tile. Keep the original image intact. */
const folder = 'art/starhide/textures';
const source = `${folder}/scales-reference-v2.png`;
const n = 1024;
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const mod = (v: number, by: number) => ((v % by) + by) % by;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const original = await readFile(source);
const raw = new Uint8Array(await sharp(original).resize(n, n).ensureAlpha().raw().toBuffer());
const albedo = new Uint8Array(raw.length);
const value = new Uint8Array(n * n);
for (let p = 0; p < n * n; p++) {
  const i = p * 4, peak = Math.max(raw[i]!, raw[i + 1]!, raw[i + 2]!);
  const face = clamp((peak - 35) / 90);
  const neutral = raw[i]! * .2126 + raw[i + 1]! * .7152 + raw[i + 2]! * .0722;
  for (let c = 0; c < 3; c++) albedo[i + c] = Math.round(clamp(lerp(neutral, raw[i + c]!, .96) * (1 + .04 * face) + [7, 7, 3][c]! * face, 0, 255));
  albedo[i + 3] = 255;
  // Maximum RGB is less sensitive to cyan/violet hue than luminance.
  value[p] = peak;
}
// Close minor generated border discrepancies over twelve pixels. This only affects
// the repeating tile boundary, never the material's internal scale pattern.
function periodic(bytes: Uint8Array, channels: number) {
  const band = 12;
  for (let k = 0; k < band; k++) {
    const blend = .5 * (1 - k / band) ** 2;
    for (let t = 0; t < n; t++) for (let c = 0; c < channels; c++) {
      const left = (t * n + k) * channels + c, right = (t * n + n - 1 - k) * channels + c;
      const a = bytes[left]!, b = bytes[right]!;
      bytes[left] = Math.round(lerp(a, b, blend)); bytes[right] = Math.round(lerp(b, a, blend));
      const top = (k * n + t) * channels + c, bottom = ((n - 1 - k) * n + t) * channels + c;
      const d = bytes[top]!, e = bytes[bottom]!;
      bytes[top] = Math.round(lerp(d, e, blend)); bytes[bottom] = Math.round(lerp(e, d, blend));
    }
  }
}
periodic(albedo, 4); periodic(value, 1);
const blur = async (sigma: number) => {
  const { data, info } = await sharp(value, { raw: { width: n, height: n, channels: 1 } }).blur(sigma).greyscale().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || data.length !== n * n) throw new Error('Starhide relief filter must return exactly one scalar per pixel');
  return new Uint8Array(data);
};
const [soft, broad] = await Promise.all([blur(1.1), blur(11)]);
const height = new Float32Array(n * n), roughness = new Uint8Array(raw.length), normal = new Uint8Array(raw.length), heightBytes = new Uint8Array(n * n);
for (let p = 0; p < n * n; p++) {
  const ratio = soft[p]! / Math.max(24, broad[p]!);
  const seam = clamp((.82 - ratio) / .28);
  const grain = (value[p]! - soft[p]!) / 255;
  // Color already contains broad convex shading. Add only shallow creases and grain,
  // rather than interpreting the cyan/violet pigment as another inflated dome.
  height[p] = .5 - seam * .040 + grain * .065;
  const rough = Math.round(255 * clamp(.40 + seam * .16 - grain * .07, .35, .58));
  roughness.set([rough, rough, rough, 255], p * 4);
  heightBytes[p] = Math.round(height[p]! * 255);
}
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const p = y * n + x;
  const dx = (height[y * n + mod(x + 1, n)]! - height[y * n + mod(x - 1, n)]!) * 4.5;
  const dy = (height[mod(y + 1, n) * n + x]! - height[mod(y - 1, n) * n + x]!) * 4.5;
  const inv = 1 / Math.hypot(dx, dy, 1);
  normal.set([Math.round((-dx * inv * .5 + .5) * 255), Math.round((-dy * inv * .5 + .5) * 255), Math.round((inv * .5 + .5) * 255), 255], p * 4);
}
await mkdir(`${folder}/procedural-r2`, { recursive: true });
for (const kind of ['color', 'normal', 'roughness', 'height']) await copyFile(`${folder}/scales-${kind}.png`, `${folder}/procedural-r2/scales-${kind}.png`);
await Promise.all([
  sharp(albedo, { raw: { width: n, height: n, channels: 4 } }).png().toFile(`${folder}/scales-reference-color.png`),
  sharp(normal, { raw: { width: n, height: n, channels: 4 } }).png().toFile(`${folder}/scales-reference-normal.png`),
  sharp(roughness, { raw: { width: n, height: n, channels: 4 } }).png().toFile(`${folder}/scales-reference-roughness.png`),
  sharp(heightBytes, { raw: { width: n, height: n, channels: 1 } }).png().toFile(`${folder}/scales-reference-height.png`),
]);
const provenance = JSON.parse(await readFile(`${folder}/provenance.json`, 'utf8'));
provenance.source = 'Deterministic satin/lining/silver/sole maps plus reference-based generated scale albedo with reproducible matched normal/roughness extraction.';
provenance.activeScaleSource = {
  original: source, sha256: createHash('sha256').update(original).digest('hex'),
  generation: `${folder}/scales-reference-v2.provenance.json`,
  derivativeGenerator: 'tools/item-models/starhide/materials-reference.ts',
  activePrefix: 'scales-reference', proceduralBackup: `${folder}/procedural-r2`,
  operations: 'Resample to 1024px; pigment-only 4% albedo gain plus restrained neutral lift and 4% saturation reduction; 12px boundary periodicization; local normalized-value crease and grain extraction; modest tangent normals; roughness 0.40 on faces to 0.56 in overlaps before material multiplier 0.9. Broad cell shading is not converted to additional dome relief.',
};
provenance.notes = 'Scale source includes local per-cell convex tonal modeling. Derived normals deliberately avoid duplicating that broad illumination. Original and rejected generated alternatives remain unchanged. No emissive material.';
await writeFile(`${folder}/provenance.json`, JSON.stringify(provenance, null, 2) + '\n');
const generation = JSON.parse(await readFile(`${folder}/scales-reference-v2.provenance.json`, 'utf8'));
generation.status = 'selected for production lab A/B round 3; active derivative prefix scales-reference';
await writeFile(`${folder}/scales-reference-v2.provenance.json`, JSON.stringify(generation, null, 2) + '\n');
console.log('Starhide reference-v2 matched PBR maps ready; procedural-r2 backup preserved.');
