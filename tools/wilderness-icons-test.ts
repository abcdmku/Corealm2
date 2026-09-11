import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import type { ItemDef } from '../game/src/contracts.js';
import { WILDERNESS_LOOT_ITEMS } from '../game/src/content/wildernessLoot.js';
import { itemIconAppearance } from '../game/src/render/itemIconAppearances.js';
import { generateItemIcons, itemIconFiles, itemIconOutputPaths } from './generate-item-icons.js';
import { installTestDeadline } from './lib/deadline.js';
import { repoRoot } from './lib/paths.js';
import { startGameServer } from './lib/server.js';

const OUT = path.join(repoRoot, 'test-results', 'wilderness-icon-review');
const PATHS = itemIconOutputPaths(OUT);
const REWARDS = new Set(['ashseal_guard', 'regent_staff', 'chainbound_sword', 'nightmarshal_plate', 'hollowstar_staff']);
const BATCHES = {
  materials: WILDERNESS_LOOT_ITEMS.filter(item => !item.equip && !item.tool),
  tier50: WILDERNESS_LOOT_ITEMS.filter(item => (item.equip || item.tool) && item.tier === 50 && !REWARDS.has(item.id)),
  tier70: WILDERNESS_LOOT_ITEMS.filter(item => (item.equip || item.tool) && item.tier === 70 && !REWARDS.has(item.id)),
  rewards: WILDERNESS_LOOT_ITEMS.filter(item => REWARDS.has(item.id)),
};
const DETAIL_IDS = [
  'cindervein_ore', 'nightglass_ore', 'molten_heart', 'astral_core', 'furnace_crown',
  'chainbound_link', 'grave_thread', 'void_thread', 'nightforge_seal', 'hollow_star_fragment',
];
const ids = Object.values(BATCHES).flat().map(item => item.id);
assert.equal(ids.length, 62);
assert.equal(new Set(ids).size, 62);

interface ImageEvidence {
  itemId: string;
  appearanceHash: string;
  masterHash: string;
  gameHash: string;
  bounds48: { minX: number; minY: number; maxX: number; maxY: number; visible: number };
}
interface BatchReport {
  status: 'rendered-pending-visual-review';
  batch: string;
  elapsedMs: number;
  renderer: 'production-item-icon-renderer';
  images: ImageEvidence[];
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function appearanceHash(itemId: string): string {
  return hash(JSON.stringify(itemIconAppearance(itemId)));
}

async function imageEvidence(itemId: string): Promise<ImageEvidence> {
  const files = itemIconFiles(itemId, PATHS);
  const [master, game] = await Promise.all([readFile(files.master), readFile(files.game)]);
  const masterInfo = await sharp(master).metadata();
  assert.equal(masterInfo.width, 256, `${itemId}: master width`);
  assert.equal(masterInfo.height, 256, `${itemId}: master height`);
  assert(masterInfo.hasAlpha, `${itemId}: master alpha`);
  const { data, info } = await sharp(game).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [48, 48, 4], `${itemId}: gameplay dimensions/alpha`);
  const bounds = { minX: 48, minY: 48, maxX: -1, maxY: -1, visible: 0 };
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    if (data[(y * 48 + x) * 4 + 3]! <= 8) continue;
    bounds.visible++;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  }
  assert(bounds.visible > 23 && bounds.visible < 48 * 48, `${itemId}: transparent visible content`);
  assert(bounds.minX >= 1 && bounds.minY >= 1 && bounds.maxX < 47 && bounds.maxY < 47, `${itemId}: safe margins`);
  assert(Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1) >= 44, `${itemId}: fills gameplay canvas`);
  return { itemId, appearanceHash: appearanceHash(itemId), masterHash: hash(master), gameHash: hash(game), bounds48: bounds };
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Compose existing pixels at native size. This review step never opens Chromium or renders art. */
async function contactSheet(items: readonly ItemDef[], size: 48 | 256, file: string): Promise<void> {
  const columns = size === 48 ? 6 : 4;
  const cellWidth = size === 48 ? 220 : 288;
  const cellHeight = size === 48 ? 76 : 304;
  const width = columns * cellWidth, height = Math.ceil(items.length / columns) * cellHeight;
  const labels: string[] = [];
  const layers: OverlayOptions[] = [];
  for (const [index, item] of items.entries()) {
    const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
    labels.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${index % 2 ? '#241f1a' : '#1d1916'}" stroke="#3d352d"/>`);
    const textX = x + (size === 48 ? 64 : 16), nameY = y + (size === 48 ? 31 : 276);
    labels.push(`<text x="${textX}" y="${nameY}" fill="#eee7da" font-family="Segoe UI, sans-serif" font-size="12">${xml(item.name)}</text>`);
    labels.push(`<text x="${textX}" y="${nameY + 16}" fill="#a69a8b" font-family="Consolas, monospace" font-size="9">${xml(item.id)}</text>`);
    const files = itemIconFiles(item.id, PATHS);
    layers.push({ input: await readFile(size === 48 ? files.game : files.master), left: x + (size === 48 ? 8 : 16), top: y + (size === 48 ? 14 : 8) });
  }
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#171411"/>${labels.join('')}</svg>`);
  await sharp(background).composite(layers).png().toFile(file);
}

async function review(): Promise<void> {
  const recorded = new Map<string, ImageEvidence>();
  for (const batch of Object.keys(BATCHES)) {
    const report = JSON.parse(await readFile(path.join(OUT, `${batch}.json`), 'utf8')) as BatchReport;
    assert.equal(report.status, 'rendered-pending-visual-review');
    for (const image of report.images) recorded.set(image.itemId, image);
  }
  assert.equal(recorded.size, 62, 'Every batch must complete before composing the review');
  const images: ImageEvidence[] = [];
  for (const item of WILDERNESS_LOOT_ITEMS) {
    const evidence = await imageEvidence(item.id);
    assert.deepEqual(evidence, recorded.get(item.id), `${item.id}: stale appearance or changed generated image; rerun its batch`);
    images.push(evidence);
  }
  await contactSheet(WILDERNESS_LOOT_ITEMS, 48, PATHS.contactSheet);
  await contactSheet(DETAIL_IDS.map(id => WILDERNESS_LOOT_ITEMS.find(item => item.id === id)!), 256, path.join(OUT, 'details-256.png'));
  await writeFile(path.join(OUT, 'review.json'), JSON.stringify({
    status: 'awaiting-root-visual-acceptance', count: images.length,
    sheet48: PATHS.contactSheet, details256: path.join(OUT, 'details-256.png'), images,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ count: images.length, sheet48: PATHS.contactSheet, details256: path.join(OUT, 'details-256.png') }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--plan') {
    console.log(JSON.stringify({ out: OUT, budgetMs: 60_000, batches: Object.fromEntries(Object.entries(BATCHES).map(([name, items]) => [name, items.map(item => item.id)])), details: DETAIL_IDS }, null, 2));
    return;
  }
  if (args.length === 1 && args[0] === '--review') {
    const clear = installTestDeadline('Wilderness icon CPU review', 60_000);
    try { await review(); } finally { clear(); }
    return;
  }
  assert(args.length === 2 && args[0] === '--batch' && args[1]! in BATCHES,
    'Use --plan, --review, or --batch materials|tier50|tier70|rewards');
  const batch = args[1] as keyof typeof BATCHES;
  const start = performance.now();
  const clear = installTestDeadline(`Wilderness icon batch ${batch}`, 60_000);
  const server = await startGameServer({ hmr: false, logLevel: 'error' });
  try {
    await mkdir(OUT, { recursive: true });
    const result = await generateItemIcons({ all: true, only: BATCHES[batch].map(item => item.id), out: OUT, url: server.url });
    assert.equal(result.rendered, BATCHES[batch].length);
    assert.equal(result.derived, BATCHES[batch].length);
    const images: ImageEvidence[] = [];
    for (const item of BATCHES[batch]) images.push(await imageEvidence(item.id));
    const report: BatchReport = {
      status: 'rendered-pending-visual-review', batch, elapsedMs: performance.now() - start,
      renderer: 'production-item-icon-renderer', images,
    };
    await writeFile(path.join(OUT, `${batch}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ batch, rendered: result.rendered, elapsedMs: report.elapsedMs, out: OUT }));
  } finally {
    await server.close();
    clear();
  }
}

await main();
