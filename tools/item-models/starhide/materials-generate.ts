import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

/** Rebuild authored PBR source tiles. No garment lighting, folds, edges, or stars are baked in. */
const output = 'art/starhide/textures';
const TAU = Math.PI * 2;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mod = (a: number, b: number) => ((a % b) + b) % b;
function noise(x: number, y: number, seed = 0): number {
  let h = Math.imul(x + 1319, 374761393) + Math.imul(y + 7381, 668265263) + Math.imul(seed + 17, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
type Tile = { size: number; color: Uint8Array; height: Float32Array; roughness: Uint8Array };
function tile(size: number): Tile {
  return { size, color: new Uint8Array(size * size * 4), height: new Float32Array(size * size), roughness: new Uint8Array(size * size * 4) };
}
function pixel(t: Tile, x: number, y: number, rgb: number[], h: number, rough: number) {
  const p = y * t.size + x, i = p * 4;
  t.color.set([Math.round(clamp(rgb[0]!, 0, 255)), Math.round(clamp(rgb[1]!, 0, 255)), Math.round(clamp(rgb[2]!, 0, 255)), 255], i);
  t.height[p] = h;
  const r = Math.round(clamp(rough) * 255);
  t.roughness.set([r, r, r, 255], i);
}
function cloth(kind: 'cloth' | 'lining' | 'sole' | 'silver'): Tile {
  const n = kind === 'cloth' ? 1024 : 256, t = tile(n);
  // The references are lit illustrations. Use pigment values above their shaded
  // midtones so the indigo remains legible under the production outdoor fill.
  const colors = { cloth: [52, 66, 112], lining: [11, 16, 29], sole: [18, 20, 25], silver: [218, 216, 207] };
  const base = colors[kind];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const grain = noise(x, y, 91), grain2 = noise(x >> 1, y >> 1, 53);
    // A four-over-one satin weave: closely spaced threads with a restrained diagonal float.
    const warp = Math.cos(TAU * x / 4), weft = Math.cos(TAU * y / 4);
    const float = mod(Math.floor(x / 4) - Math.floor(y / 4), 5) === 0;
    const weave = (float ? warp : weft) * .5 + (float ? weft : warp) * .14;
    const pebble = Math.sin(TAU * x / 16 + Math.sin(TAU * y / 32)) * Math.sin(TAU * y / 16 + Math.sin(TAU * x / 32));
    const brushed = Math.sin(TAU * y / 4 + noise(0, y, 11));
    const variance = kind === 'silver' ? (grain - .5) * 2.7 + brushed * .8 : weave * 1.8 + (grain - .5) * 2.0 + pebble * (kind === 'cloth' ? 1.2 : .5);
    // The medium yarn relief survives normal gameplay minification. It is surface
    // weave/slub, not baked garment folds or directional lighting.
    const h = kind === 'silver' ? .5 + brushed * .006 + (grain - .5) * .005 : .5 + weave * .06 + (grain - .5) * .025 + pebble * (kind === 'cloth' ? .065 : .008);
    const r = kind === 'silver' ? .28 + grain2 * .08 : kind === 'sole' ? .88 + grain2 * .06 : kind === 'lining' ? .82 + grain2 * .08 : .61 + .07 * grain2 - .025 * weave;
    pixel(t, x, y, base.map(c => c + variance), h, r);
  }
  return t;
}
function scales(): Tile {
  const n = 1024, cols = 8, rows = 12, w = n / cols, r = n / rows, t = tile(n);
  const palette = [[40, 104, 132], [40, 139, 159], [42, 91, 145], [68, 74, 141], [95, 76, 157], [45, 147, 164]];
  for (let py = 0; py < n; py++) for (let x = 0; x < n; x++) {
    // DataTexture pixel rows increase with V. Tips face decreasing V on garment UVs.
    const y = n - py - .5, row = Math.floor(y / r);
    let rgb = [13, 27, 43], height = .05, rough = .61;
    let found = false;
    // Upper scales cover the roots of the row below them.
    for (let rr = row - 2; rr <= row && !found; rr++) {
      const down = (y - rr * r) / (r * 1.84);
      if (down <= 0 || down >= 1) continue;
      const stagger = mod(rr, 2) * .5;
      const cc = Math.round(x / w - stagger);
      const dx = (x - (cc + stagger) * w) / w;
      // Full-width upper roots close every gap; only the lower teardrop is visible
      // after the previous staggered row overlaps it.
      const tip = clamp((down - .54) / .46);
      const width = .515 * Math.sqrt(1 - tip * tip);
      if (Math.abs(dx) >= width) continue;
      found = true;
      const a = noise(mod(cc, cols), mod(rr, rows), 6), b = noise(mod(cc, cols), mod(rr, rows), 19);
      const idx = Math.floor(a * palette.length) % palette.length;
      const other = palette[idx < 3 || idx === 5 ? 4 : 5]!;
      const base = palette[idx]!;
      const xn = dx / width, edge = width - Math.abs(dx);
      const marbling = Math.sin(down * 11 + xn * 1.6 + a * TAU) * Math.sin(xn * 8 + down * 3 + b * 8) * .18;
      const hue = clamp(.34 + Math.sin(down * 5 + a * TAU) * .22 + xn * .10 + marbling, .03, .78);
      const micro = noise(x, py, 88) - .5;
      const lengthGrain = Math.sin(xn * 76 + Math.sin(down * 24 + a * 8) * .9) * .6;
      const fineVeins = Math.sin((Math.abs(dx) * 2.2 + down) * 188 + Math.sin(down * 39 + a * 17) * .5);
      const etched = Math.pow(Math.max(0, fineVeins), 14) * clamp((down - .30) * 4) * .016;
      const vein = Math.exp(-Math.abs(dx - Math.sin(down * 7 + a) * .01) * 210) * Math.sin(Math.PI * down);
      const rib = Math.sin((down + Math.abs(dx) * 1.8) * 115 + a * 2) * .0018;
      const dome = Math.sqrt(Math.max(0, 1 - xn * xn)) * Math.sin(Math.PI * down) ** .42;
      const rim = Math.exp(-(((edge - .014) / .009) ** 2)) * clamp(down * 6);
      const seam = clamp(edge / .020);
      // Color variation represents pigment, with only a narrow occluded overlap line.
      rgb = base.map((c, ch) => mix(c, other[ch]!, hue) * mix(.50, 1, seam) + rim * [54, 67, 60][ch]! + vein * 3.5 + micro * 3 + lengthGrain - etched * 250);
      height = .14 + dome * .58 + down * .11 + rim * .045 + vein * .009 + micro * .008 + rib - etched;
      rough = .36 + .07 * b + micro * .022 - rim * .025 + (1 - seam) * .13;
    }
    pixel(t, x, py, rgb, height, rough);
  }
  return t;
}
async function save(name: string, t: Tile, normalStrength: number) {
  const n = t.size, normal = new Uint8Array(n * n * 4), relief = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const p = y * n + x;
    const dx = (t.height[y * n + mod(x + 1, n)]! - t.height[y * n + mod(x - 1, n)]!) * normalStrength;
    const dy = (t.height[mod(y + 1, n) * n + x]! - t.height[mod(y - 1, n) * n + x]!) * normalStrength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    normal.set([Math.round((-dx * inv * .5 + .5) * 255), Math.round((-dy * inv * .5 + .5) * 255), Math.round((inv * .5 + .5) * 255), 255], p * 4);
    relief[p] = Math.round(clamp(t.height[p]!) * 255);
  }
  await Promise.all([
    sharp(t.color, { raw: { width: n, height: n, channels: 4 } }).png().toFile(path.join(output, `${name}-color.png`)),
    sharp(normal, { raw: { width: n, height: n, channels: 4 } }).png().toFile(path.join(output, `${name}-normal.png`)),
    sharp(t.roughness, { raw: { width: n, height: n, channels: 4 } }).png().toFile(path.join(output, `${name}-roughness.png`)),
    sharp(relief, { raw: { width: n, height: n, channels: 1 } }).png().toFile(path.join(output, `${name}-height.png`)),
  ]);
}
await mkdir(output, { recursive: true });
await save('scales', scales(), 5.8);
for (const kind of ['cloth', 'lining', 'sole', 'silver'] as const) await save(kind, cloth(kind), kind === 'silver' ? .75 : .9);
const references = await Promise.all(['hood', 'robe', 'leggings', 'boots', 'wraps'].map(async name => {
  const file = `art/item-icons/generated/starhide_${name}.png`;
  return { file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
}));
await writeFile(path.join(output, 'provenance.json'), JSON.stringify({
  generator: 'tools/item-models/starhide/materials-generate.ts',
  command: 'npx tsx tools/item-models/starhide/materials-generate.ts',
  source: 'Original deterministic PBR tiles authored against the five approved item PNGs. No generated images or external textures.',
  references,
  scaleLayout: { columns: 8, staggeredRows: 12, tipDirection: 'decreasing V', resolution: 1024 },
  colorSpace: { color: 'sRGB', normal: 'linear tangent-space OpenGL', roughness: 'linear', height: 'linear authoring source, unused at runtime' },
  notes: 'Shallow overlapping organic hide leaves. Fine satin weave. Restrained pigment variation. No broad highlights, garment shadows, folds, borders, or emission baked into maps.',
}, null, 2) + '\n');
console.log(`Starhide material sources written to ${output}`);
// The selected generated albedo is a committed source. Its matched derivatives are
// reproducible, and the procedural round-2 scale tiles remain a separate backup.
await import('./materials-reference.js');
