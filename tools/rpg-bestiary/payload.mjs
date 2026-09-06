/** Encoded catalogue payload and conservative texture storage estimate; not a GPU benchmark. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
const directory = process.argv[2] ?? 'art/rebuild/candidates/finish-bestiary/source-round6';
const bytes = await readFile(path.join(directory, 'catalog.json'));
const catalog = JSON.parse(bytes);
const images = [];
for (const texture of catalog.sharedTextures ?? []) {
  const metadata = await sharp(path.join(directory, texture.file)).metadata();
  images.push({ ...texture, width: metadata.width, height: metadata.height,
    rgba8WithMipsBytes: Math.ceil(metadata.width * metadata.height * 4 * 4 / 3) });
}
const report = {
  catalogueSha256: createHash('sha256').update(bytes).digest('hex'),
  modelCount: catalog.assets.length,
  modelBytes: catalog.assets.reduce((sum, asset) => sum + asset.bytes, 0),
  sharedImageBytes: images.reduce((sum, image) => sum + image.bytes, 0),
  uniqueImages: images.length,
  estimatedAllImagesRgba8MipBytes: images.reduce((sum, image) => sum + image.rgba8WithMipsBytes, 0),
  maxImageDimension: Math.max(...images.flatMap(image => [image.width, image.height])),
  totalCatalogueTriangles: catalog.assets.reduce((sum, asset) => sum + asset.triangles, 0),
  maxModelTriangles: Math.max(...catalog.assets.map(asset => asset.triangles)),
  note: 'Encoded storage and RGBA8+mip estimates across the complete catalogue. Actual GPU memory and performance require production browser measurement.', images,
};
await writeFile(path.join(directory, 'payload-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, images: undefined }));
