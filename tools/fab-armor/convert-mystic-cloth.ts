import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
// @ts-expect-error plain server helper
import { startServer } from '../animals/serve.mjs';

const outputDirectory = path.resolve('.asset-cache/fab-armor/mystic-cloth');
const reportDirectory = path.resolve('test-results/fab-armor/mystic-cloth-build');
const sourceCatalogPath = path.resolve('.asset-cache/fab-armor/candidates.json');
const sourceCatalog = JSON.parse(await readFile(sourceCatalogPath, 'utf8'));
const names: Record<number, string> = { 50: 'tideweave', 70: 'nightweave', 90: 'frostweave' };
const requestedTier = Number(process.argv[2]);
const tiers = requestedTier ? [requestedTier] : [50, 70, 90];
const requestedBody = process.argv[3];
const genders = requestedBody ? [requestedBody] : ['male', 'female'];
if (tiers.some(tier => !names[tier]) || genders.some(body => !['male', 'female'].includes(body))) throw new Error('Usage: convert-mystic-cloth.ts [50|70|90] [male|female]');
await mkdir(outputDirectory, { recursive: true });
await mkdir(reportDirectory, { recursive: true });
let existing: any = null;
try { existing = JSON.parse(await readFile(path.join(outputDirectory, 'candidates.json'), 'utf8')); } catch { /* First candidate pass. */ }
const assets = sourceCatalog.assets.map((entry: any) => existing?.assets.find((a: any) => a.id === entry.id) ?? entry);
const files = Object.fromEntries(assets.map((entry: any) => [entry.id,
  existing?.files[entry.id] ?? path.relative(outputDirectory, path.resolve(path.dirname(sourceCatalogPath), sourceCatalog.files[entry.id])).replaceAll('\\', '/')]));
const server = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.goto(server.url + '/tools/animals/convert.html');
  for (const tier of tiers) for (const gender of genders) {
    const result = await page.evaluate(async ({ tier, gender }) => {
      // @ts-expect-error browser authoring module
      const converter = await import('/tools/fab-armor/mystic-cloth-convert.js');
      return converter.convertMysticCloth(tier, gender);
    }, { tier, gender });
    for (const [slot, data] of Object.entries(result.output) as [string, any][]) {
      const id = `fab_${gender}_${names[tier]}_${slot}`;
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      const doc = await io.readBinary(Buffer.from(data.bytes, 'base64'));
      await doc.transform(weld(), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88 }));
      const bytes = Buffer.from(await io.writeBinary(doc));
      const oldIndex = assets.findIndex((entry: any) => entry.id === id);
      if (oldIndex < 0) throw new Error(`No production asset ${id}`);
      assets[oldIndex] = {
        ...assets[oldIndex], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
        size: { x: data.bounds.max[0] - data.bounds.min[0], y: data.bounds.max[1] - data.bounds.min[1], z: data.bounds.max[2] - data.bounds.min[2] },
        base: { x: data.bounds.min[0], y: data.bounds.min[1], z: data.bounds.min[2] },
        materials: data.materials,
      };
      files[id] = id + '.glb';
      await writeFile(path.join(outputDirectory, id + '.glb'), bytes);
      console.log(id, bytes.length);
    }
    await writeFile(path.join(reportDirectory, `${tier}-${gender}.json`), JSON.stringify(result.report, null, 2) + '\n');
    // Write an overlay after each body so the root can review staged outfits.
    await writeFile(path.join(outputDirectory, 'candidates.json'), JSON.stringify({ assets, files, packs: sourceCatalog.packs }, null, 2) + '\n');
  }
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify({ candidateCatalog: path.join(outputDirectory, 'candidates.json'), assets: assets.length, tiers, genders }));
