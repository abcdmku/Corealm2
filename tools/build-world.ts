import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { gameRoot } from './lib/paths.js';
import { startGameServer } from './lib/server.js';
import { generationRevision } from './lib/generation-revision.js';
import type { WorldDataManifest } from '../game/src/world/worldDataFormat.js';

export async function bakeWorldData(options: { lab?: boolean; out?: string } = {}): Promise<WorldDataManifest> {
  const out = path.resolve(options.out ?? path.join(gameRoot, 'public/generated/world'));
  await mkdir(out, { recursive: true });
  const revision = generationRevision(gameRoot);
  const records: WorldDataManifest['records'] = {};
  const server = await startGameServer({ hmr: false });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.exposeFunction('__corealmWriteWorldData', async (key: string, base64: string) => {
      if (records[key]) throw new Error(`Duplicate world record ${key}`);
      const bytes = Buffer.from(base64, 'base64');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      // An opaque suffix prevents static hosts from decoding gzip before the integrity check.
      const file = `${sha256}.world`;
      await writeFile(path.join(out, file), bytes);
      records[key] = { file, sha256, bytes: bytes.length };
      if (Object.keys(records).length % 20 === 0) console.log(`World bake: ${Object.keys(records).length} records`);
    });
    const route = options.lab ? '/?mode=combat&spawnSpacing=1&world-bake=1' : '/?world-bake=1';
    await page.goto(new URL(route, server.url).href, { waitUntil: 'domcontentloaded' });
    // Offline island generation runs here during development/build, never on a released first visit.
    await page.waitForFunction(() => window.__corealmWorldBake || document.querySelector('.boot-error'), undefined, { timeout: 900_000, polling: 1000 });
    const result = await page.evaluate(() => window.__corealmWorldBake);
    if (!result || errors.length) throw new Error(`World bake failed: ${errors.join('\n')}`);
    if (result.revision !== revision || generationRevision(gameRoot) !== revision) throw new Error('Sources changed during world bake; rerun it');
    if (!records['terrain/world'] || !records['spawns/world']
      || result.tiles.some(tile => !records[`scatter/${tile}`])
      || result.records.length !== Object.keys(records).length) throw new Error('World bake is incomplete');
    const manifest: WorldDataManifest = { format: 'corealm-world', version: 1, revision, scope: result.scope, tiles: result.tiles, records };
    const temporary = path.join(out, 'manifest.next.json');
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n');
    await rename(temporary, path.join(out, 'manifest.json'));
    const retained = new Set(Object.values(records).map(record => record.file));
    for (const name of await readdir(out)) {
      if (!/^[a-f0-9]{64}\.world(?:\.gz)?$/.test(name) || retained.has(name)) continue;
      const target = path.resolve(out, name);
      if (path.dirname(target) !== out) throw new Error('World cleanup escaped its output directory');
      await unlink(target);
    }
    console.log(`Baked ${result.tiles.length} world tiles; ${(Object.values(records).reduce((sum, record) => sum + record.bytes, 0) / 1e6).toFixed(2)} MB compressed`);
    return manifest;
  } finally { await browser?.close(); await server.close(); }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  const lab = process.argv.includes('--lab');
  await bakeWorldData({ lab, out: lab ? path.join(gameRoot, 'public/generated/world-lab') : undefined });
}
