import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../sources/beetle+golem.glb', import.meta.url));
const output = fileURLToPath(new URL('./beetle-shell-optics-rg.png', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(source);
if (hash(sourceBytes) !== 'fb03cd921a5ffed201d577cf4102a182d9826f12664e14d11db38b7a60db5193') {
  throw new Error('Beetle Golem source GLB changed; inspect the atlas before rebuilding its mask.');
}
const document = await new NodeIO().readBinary(sourceBytes);
const base = document.getRoot().listMaterials()[0]?.getBaseColorTexture()?.getImage();
if (!base || hash(base) !== 'f1310548ccdf3978deb4ef38c68455f95587f43f65a56f5dc8420533f6f7f2a6') {
  throw new Error('Authored base-color image changed; inspect its UV islands before rebuilding the mask.');
}
const { data, info: { width, height, channels } } = await sharp(base).removeAlpha().raw().toBuffer({ resolveWithObject: true });
if (width !== 2048 || height !== 2048 || channels !== 3) throw new Error('Unexpected beetle atlas format.');

const smooth = (lo, hi, value) => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const count = width * height;
const coverage = Buffer.alloc(count);
const thickness = new Float32Array(count);
for (let i = 0; i < count; i++) {
  const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta + 6) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
  }
  const saturation = max > 0 ? delta / max : 0;
  // Authored teal/green/blue/purple shell islands; gold, claws and dark joints fade out.
  const shell = smooth(.25, .37, hue) * (1 - smooth(.91, .98, hue))
    * smooth(.045, .23, saturation) * smooth(.065, .18, max);
  coverage[i] = Math.round(Math.max(0, Math.min(1, shell)) * 255);
  thickness[i] = Math.max(.12, Math.min(.90, .48 + .20 * Math.sin(17 * hue) + .18 * (max - .4)));
}
const feathered = await sharp(coverage, { raw: { width, height, channels: 1 } })
  .blur(.7).extractChannel(0).raw().toBuffer();
const packed = Buffer.alloc(count * 3);
for (let i = 0; i < count; i++) {
  const red = Math.min(224, Math.round(feathered[i] * .90));
  packed[i * 3] = red;
  packed[i * 3 + 1] = red > 2 ? Math.round(thickness[i] * 255) : 0;
}
const png = await sharp(packed, { raw: { width, height, channels: 3 } })
  .png({ compressionLevel: 9, effort: 8 }).toBuffer();
await writeFile(output, png);
console.log(`${output}: ${width}x${height}, ${png.length} bytes, sha256 ${hash(png)}`);
