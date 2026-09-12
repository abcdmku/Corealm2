import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const source = 'art/fab-armor/textures';
const output = 'game/public/assets/textures/fab-armor';
await mkdir(output, { recursive: true });
const metadata = await sharp(`${source}/fabric-tiers-generated.png`).metadata();
const width = metadata.width!, height = metadata.height!;
for (const [index, tier] of [1, 5, 10, 20, 50, 70].entries()) {
  const col = index % 3, row = Math.floor(index / 3);
  const left = Math.round(col * width / 3), top = Math.round(row * height / 2);
  // Exclude the neighbouring swatch at cell edges before resampling for runtime use.
  await sharp(`${source}/fabric-tiers-generated.png`).extract({
    left: left + 3, top: top + 3,
    width: Math.round((col + 1) * width / 3) - left - 6,
    height: Math.round((row + 1) * height / 2) - top - 6,
  }).resize(512, 512).png().toFile(`${output}/fabric-${tier}.png`);
}
await sharp(`${source}/leather-generated.png`).resize(512, 512).png().toFile(`${output}/leather.png`);
await sharp(`${source}/silk-70-generated.png`).resize(512, 512).png().toFile(`${output}/fabric-70.png`);
await sharp(`${source}/scales-generated.png`).resize(512, 512).png().toFile(`${output}/scales.png`);
await writeFile(`${source}/provenance.json`, JSON.stringify({
  created: '2026-09-11', method: 'OpenAI built-in image generation; original fabric atlas and leather tile',
  referenceImagesUsed: false,
  processing: 'Extract six fabric swatches and resize runtime textures to 512 square.',
  tiers: [1, 5, 10, 20, 50, 70],
}, null, 2) + '\n');
