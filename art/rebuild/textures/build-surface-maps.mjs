/** Rebuild registered PBR maps from the checked-in imagegen albedo sources. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.join(root, "game/public/assets/textures/corealm");
const sourceDirectory = path.join(root, "art/rebuild/surface-sources");
const specifications = [
  { name: "bark", source: "oak-bark-albedo-v1.png", size: 1024, tileMetres: 1, reliefMetres: 0.020, roughness: 0.86, periodic: true },
  { name: "stone", source: "quarry-stone-albedo-v1.png", size: 1024, tileMetres: 2.4, reliefMetres: 0.026, roughness: 0.90, periodic: true },
  { name: "leaf", source: "broadleaf-albedo-v1.png", size: 512, tileMetres: 0.16, reliefMetres: 0.00065, roughness: 0.79, periodic: false },
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

// Match opposite boundary texels over a narrow cosine feather. This repairs sampling seams;
// it does not repaint the source's interior or invent a second surface pattern.
function matchTileEdges(data, size, channels, strip = 24) {
  for (const horizontal of [true, false]) {
    for (let line = 0; line < size; line++) {
      for (let distance = 0; distance < strip; distance++) {
        const weight = 0.5 * (1 + Math.cos(Math.PI * distance / strip));
        const a = horizontal ? line * size + distance : distance * size + line;
        const b = horizontal ? line * size + size - 1 - distance : (size - 1 - distance) * size + line;
        for (let channel = 0; channel < channels; channel++) {
          const ia = a * channels + channel, ib = b * channels + channel;
          const mean = (data[ia] + data[ib]) * 0.5;
          data[ia] = Math.round(data[ia] + (mean - data[ia]) * weight);
          data[ib] = Math.round(data[ib] + (mean - data[ib]) * weight);
        }
      }
    }
  }
}

await mkdir(output, { recursive: true });
const report = { version: 2, surfaces: {} };
for (const spec of specifications) {
  const sourcePath = path.join(sourceDirectory, spec.source);
  const source = await readFile(sourcePath);
  let image = sharp(source).removeAlpha().resize(spec.size, spec.size);
  // Generated leaf artwork places the petiole at image-bottom; native blade UV V=0 is the base.
  // GLB maps are uploaded without flipY, so orient the pixels once before deriving every map.
  if (!spec.periodic) image = image.flip();
  const albedo = await image.raw().toBuffer();
  if (spec.periodic) matchTileEdges(albedo, spec.size, 3);
  const imageOptions = { raw: { width: spec.size, height: spec.size, channels: 3 } };
  await sharp(albedo, imageOptions).png({ compressionLevel: 9, palette: true, quality: 100, colours: 256, dither: 1 }).toFile(path.join(output, `corealm-${spec.name}.png`));

  const mean = [0, 0, 0];
  for (let pixel = 0; pixel < spec.size * spec.size; pixel++) {
    for (let channel = 0; channel < 3; channel++) mean[channel] += linear(albedo[pixel * 3 + channel] / 255);
  }
  for (let channel = 0; channel < 3; channel++) mean[channel] /= spec.size * spec.size;

  // Surface relief is inferred from the authored grooves and veins, not recovered physical scan
  // data. A small low-pass removes pigment grain before calculating the registered slope field.
  const mapSize = 512;
  const reliefRgb = await sharp(albedo, imageOptions).resize(mapSize, mapSize).blur(spec.name === "leaf" ? 0.8 : 0.65).raw().toBuffer();
  const heights = new Float32Array(mapSize * mapSize);
  let low = Infinity, high = -Infinity;
  for (let pixel = 0; pixel < heights.length; pixel++) {
    const index = pixel * 3;
    const value = 0.2126 * linear(reliefRgb[index] / 255) + 0.7152 * linear(reliefRgb[index + 1] / 255) + 0.0722 * linear(reliefRgb[index + 2] / 255);
    heights[pixel] = value;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const span = Math.max(0.001, high - low);
  for (let pixel = 0; pixel < heights.length; pixel++) heights[pixel] = (heights[pixel] - low) / span;
  const indexAt = (x, y) => {
    if (spec.periodic) return ((y + mapSize) % mapSize) * mapSize + ((x + mapSize) % mapSize);
    return clamp(y, 0, mapSize - 1) * mapSize + clamp(x, 0, mapSize - 1);
  };
  const normals = Buffer.alloc(mapSize * mapSize * 3);
  const roughness = Buffer.alloc(mapSize * mapSize);
  const heightPreview = Buffer.alloc(mapSize * mapSize);
  const slopeScale = spec.reliefMetres * mapSize / (2 * spec.tileMetres);
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const pixel = y * mapSize + x;
      const dx = (heights[indexAt(x + 1, y)] - heights[indexAt(x - 1, y)]) * slopeScale;
      const dy = (heights[indexAt(x, y + 1)] - heights[indexAt(x, y - 1)]) * slopeScale;
      const length = Math.hypot(dx, dy, 1);
      normals[pixel * 3] = Math.round((-dx / length * 0.5 + 0.5) * 255);
      normals[pixel * 3 + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
      normals[pixel * 3 + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      // Worn ridges reflect a little more narrowly; recessed grain and leaf tissue remain matte.
      roughness[pixel] = Math.round(clamp(spec.roughness + (0.5 - heights[pixel]) * 0.30, 0.56, 0.99) * 255);
      heightPreview[pixel] = Math.round(heights[pixel] * 255);
    }
  }
  if (spec.periodic) {
    matchTileEdges(normals, mapSize, 3, 4);
    matchTileEdges(roughness, mapSize, 1, 4);
  }
  await sharp(normals, { raw: { width: mapSize, height: mapSize, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(output, `corealm-${spec.name}-normal.png`));
  await sharp(roughness, { raw: { width: mapSize, height: mapSize, channels: 1 } }).png({ compressionLevel: 9 }).toFile(path.join(output, `corealm-${spec.name}-roughness.png`));
  await sharp(heightPreview, { raw: { width: mapSize, height: mapSize, channels: 1 } }).png({ compressionLevel: 9 }).toFile(path.join(root, `art/rebuild/textures/corealm-${spec.name}-height.png`));
  report.surfaces[spec.name] = {
    source: `art/rebuild/surface-sources/${spec.source}`,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    meanLinearRgb: mean,
    tileMetres: spec.tileMetres,
    reliefMetres: spec.reliefMetres,
    albedoSize: spec.size,
    pbrMapSize: mapSize,
    periodic: spec.periodic,
  };
}
await writeFile(path.join(output, "corealm-surfaces.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
