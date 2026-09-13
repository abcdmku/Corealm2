import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const sourceDir = 'art/equipment-retexture/regional';
const out = 'game/public/assets/textures/regional-equipment';
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const sources = JSON.parse(await readFile(`${sourceDir}/sources.json`, 'utf8')) as { sources: { file: string; sha256: string }[] };
const selections = [
  ['t30-metal', 't30-dewglass', 1, 1, 0, 0],
  ['t30-wood', 't30-organic', 3, 1, 0, 0],
  ['t30-cloth', 't30-organic', 3, 1, 1, 0],
  ['t30-leather', 't30-organic', 3, 1, 2, 0],
  ['t30-lining', 't30-pale-mistweave', 1, 1, 0, 0],
  ['t40-metal', 't40-material', 3, 2, 0, 0],
  ['t40-wood', 't40-material', 3, 2, 1, 1],
  ['t40-cloth', 't40-material', 3, 2, 0, 1],
  ['t40-leather', 't40-material', 3, 2, 2, 1],
  ['t40-lining', 't40-material', 3, 2, 2, 0],
  ['t60-metal', 't60-material', 2, 2, 0, 0],
  ['t60-wood', 't60-material', 2, 2, 1, 1],
  ['t60-cloth', 't60-fabric', 2, 2, 0, 0],
  ['t60-leather', 't60-fabric', 2, 2, 0, 1],
  ['t60-lining', 't60-fabric', 2, 2, 1, 0],
] as const;
await mkdir(out, { recursive: true });
const outputs = [];
for (const [name, source, columns, rows, column, row] of selections) {
  const file = `${sourceDir}/${source}.png`, bytes = await readFile(file);
  if (sources.sources.find(record => record.file === file)?.sha256 !== sha256(bytes)) throw new Error(`Changed prompted material source ${file}`);
  const info = await sharp(bytes).metadata();
  if (!info.width || !info.height) throw new Error(`Unreadable material source ${file}`);
  const cellWidth = Math.floor(info.width / columns), cellHeight = Math.floor(info.height / rows);
  const inset = columns === 1 && rows === 1 ? 0 : 3;
  const crop = { left: column * cellWidth + inset, top: row * cellHeight + inset, width: cellWidth - 2 * inset, height: cellHeight - 2 * inset };
  // Cropping and resampling prompted artwork only. No painted/procedural substitute layers.
  const png = await sharp(bytes).extract(crop).resize(512, 512, { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();
  const target = `${out}/${name}.png`; await writeFile(target, png);
  outputs.push({ file: target, sha256: sha256(png), bytes: png.length, source: file, sourceSha256: sha256(bytes), crop, resize: [512, 512], kernel: 'lanczos3', colorSpace: 'sRGB' });
}
await writeFile(`${sourceDir}/derivatives.json`, JSON.stringify({ version: 1, generator: 'tools/build-regional-equipment-textures.ts', status: 'pending production lab acceptance', outputs }, null, 2) + '\n');
console.log(`Derived ${outputs.length} regional equipment textures from recorded prompted originals.`);
