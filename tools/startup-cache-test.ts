/** Cold boot versus a new browser process using the same persistent generated-data cache. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { startGameServer } from "./lib/server.js";
import type {} from "./lib/debug-api.js";
import { preview } from 'vite';
import { gameRoot } from './lib/paths.js';

const lab = process.argv.includes("--lab");
const production = process.argv.includes('--production');
const shipped = production || process.argv.includes('--shipped');
const output = path.resolve("test-results/startup-cache", production ? 'release' : lab ? "lab" : "world");
await mkdir(output, { recursive: true });
const profile = path.join(output, `browser-${Date.now()}`);
const server = production ? await (async () => {
  const running = await preview({ root: gameRoot, preview: { host: '127.0.0.1', port: 0 } });
  const address = running.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No preview port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) =>
    running.httpServer.close(error => error ? reject(error) : resolve())) };
})() : await startGameServer({ hmr: false });
const route = lab ? "/?mode=combat&spawnSpacing=1&performance=1&startup-cache=1"
  + (shipped ? '&world-data=/generated/world-lab/manifest.json' : '') : "/";
let context: BrowserContext | undefined;
let save: string | undefined;
const reports: Record<string, any> = {};

async function boot(name: string, storageUnavailable = false) {
  context = await chromium.launchPersistentContext(profile, { headless: true,
    viewport: { width: 1440, height: 900 }, args: process.platform === "win32"
      ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"]
      : ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
  const page = context.pages()[0] ?? await context.newPage();
  const errors: string[] = [];
  await page.addInitScript({ content: `(() => {
    const frames = []; window.__startupFrames = frames;
    function frame(now) { frames.push(now); if (frames.length > 3000) frames.shift(); requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  })();` });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  if (save) await page.addInitScript(blob => localStorage.setItem("corealm.save.v1", blob), save);
  if (storageUnavailable) await page.addInitScript(() => Object.defineProperty(window, "indexedDB", {
    get() { throw new DOMException("Storage disabled for acceptance", "SecurityError"); },
  }));
  await page.goto(new URL(route, server.url).href, { waitUntil: "domcontentloaded" });
  await page.locator("#boot-screen").waitFor({ state: "detached", timeout: 60_000 });
  // Keep the first second free of this harness's large semantic-state serialization and screenshots.
  await page.waitForTimeout(1100);
  const state = await page.evaluate(() => {
    const debug = window.__gameDebug as any, globals = window as any;
    return { ready: debug.getState().ready, player: debug.getPlayer(), views: debug.getEntityViewStats(),
      scatter: debug.getScatterResidency(), scatterStats: debug.getScatterStats(), errors: debug.getErrors(),
      terrain: [[0, 0], [-160, -118], [140, -90], [400, 0]].map(([x, z]) => debug.sampleWorld(x, z)),
      cache: globals.__corealmGenerationCache?.snapshot(), boot: globals.__corealmBootTelemetry.snapshot(),
      playerAssets: globals.__corealmPlayerAssets?.snapshot(),
      modelTextureBytes: performance.getEntriesByType('resource').filter(entry => /\.(glb|png|jpe?g)(?:\?|$)/.test(entry.name))
        .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).encodedBodySize, 0),
      spawns: debug.getEntities().filter((e: any) => e.archetype === 'enemy' || e.archetype === 'boss')
        .map((e: any) => { const entity = debug.getEntity(e.id); return { id: entity.id,
          x: entity.meta?.spawnX, z: entity.meta?.spawnZ, radius: entity.combat?.bodyRadius ?? .5,
          boss: entity.archetype === 'boss', cave: entity.regionId === 'gravelmaw' }; }),
      save: debug.getSaveBlob() };
  });
  assert.equal(state.ready, true);
  assert.equal(state.views.residency.pending, 0);
  assert.equal(state.views.residency.failed, 0);
  assert.equal(state.views.residency.missing, 0);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.playerAssets.sites.pending, [], 'The complete starting setting must be ready');
  if (shipped) assert.deepEqual(state.cache.generated, [], 'Shipped world must not run generation');
  if (!lab) assert.equal(state.boot.marks.find((mark: any) => mark.name === 'boot.navigation.ready')?.detail?.artifact, 'imported');
  for (let i = 0; i < state.spawns.length; i++) for (const b of state.spawns.slice(i + 1)) {
    const a = state.spawns[i];
    if (a.cave !== b.cave || a.boss && b.boss) continue;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= Math.max(a.cave ? 5 : 10,
      a.radius + b.radius + (a.cave ? 1.5 : 4)) - 1e-5, `spawn clearance: ${a.id}/${b.id}`);
  }
  save ??= state.save;
  // Measure the revealed game before screenshot readback can stall the graphics driver.
  await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 5000 });
  if (lab) await page.locator("#viewport").click({ position: { x: 720, y: 450 } });
  const before = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  await page.keyboard.down("w"); await page.waitForTimeout(650); await page.keyboard.up("w");
  const after = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  assert.notDeepEqual(after, before);
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => (window.__gameDebug as any).getScatterResidency()), state.scatter);
  assert.deepEqual(errors, []);
  const frames = await page.evaluate(() => (window as any).__startupFrames as number[]);
  const frameGaps = frames.slice(1).flatMap((at, i) => frames[i]! >= state.boot.firstPlayableMs
    && at <= state.boot.firstPlayableMs + 1000 ? [at - frames[i]!] : []).sort((a, b) => a - b);
  const firstGameplayFrames = { samples: frameGaps.length, maxMs: frameGaps.at(-1) ?? 0,
    p95Ms: frameGaps[Math.floor(frameGaps.length * .95)] ?? 0 };
  assert.ok(firstGameplayFrames.samples > 0);
  assert.ok(firstGameplayFrames.maxMs < 500, 'Startup work must not freeze newly revealed gameplay');
  const { save: _save, ...report } = state;
  reports[name] = { ...report, before, after, firstGameplayFrames, errors };
  await writeFile(path.join(output, `${name}.json`), JSON.stringify(reports[name], null, 2));
  console.log(JSON.stringify({ name, playableMs: state.boot.firstPlayableMs, firstGameplayFrames,
    modelTextureBytes: state.modelTextureBytes, assets: state.playerAssets.assets,
    sites: state.playerAssets.sites, cache: state.cache }));
  return page;
}

try {
  await boot("cold");
  assert.equal(reports.cold.cache.hits, 0);
  if (shipped) {
    assert.ok(reports.cold.cache.shipped.includes('terrain/world'));
    if (!lab) assert.equal(reports.cold.cache.shipped.filter((key: string) => key.startsWith('scatter/')).length, reports.cold.scatter.resident.length);
    if (production) {
      const manifest = JSON.parse(await readFile(path.join(gameRoot, 'dist/generated/world/manifest.json'), 'utf8'));
      const firstViewBytes = reports.cold.cache.shipped.reduce((sum: number, key: string) => sum + manifest.records[key].bytes, 0);
      assert.ok(firstViewBytes < 40 * 1024 * 1024, 'Starting world data must fit its 40 MiB download budget');
      console.log(JSON.stringify({ shippedTiles: manifest.tiles.length, firstViewBytes }));
    }
  }
  assert.ok(reports.cold.cache.writes > 0);
  await context!.close();
  const warmPage = await boot("returning");
  assert.ok(reports.returning.cache.hitsByKind.terrain > 0);
  assert.ok(reports.returning.cache.hitsByKind.spawns > 0);
  if (!lab) assert.ok(reports.returning.cache.hitsByKind.scatter > 0);
  assert.equal(reports.returning.cache.writes, 0);
  assert.deepEqual(reports.returning.scatter, reports.cold.scatter);
  assert.deepEqual(reports.returning.scatterStats, reports.cold.scatterStats);
  assert.deepEqual(reports.returning.terrain, reports.cold.terrain);
  assert.deepEqual(reports.returning.spawns, reports.cold.spawns);
  if (!lab && process.argv.includes('--resume')) {
    for (const cave of [false, true]) {
      const page = context!.pages()[0]!;
      const fixture = await page.evaluate(inCave => {
        const debug = window.__gameDebug as any;
        const floor = inCave ? debug.getEntity('gravelmaw_exit_portal').position[1] : 10;
        const point = debug.getNavPoint(inCave ? [40, floor, -40] : [140, floor, -90]);
        if (!point) throw new Error('Resume requires reachable ground');
        const blob = JSON.parse(debug.getSaveBlob());
        blob.player.position = [point.x, inCave ? point.y : debug.groundHeight(point.x, point.z), point.z];
        blob.player.regionId = inCave ? 'gravelmaw' : debug.sampleWorld(point.x, point.z).semanticRegion;
        blob.player.movement.path = [];
        return { blob: JSON.stringify(blob), region: blob.player.regionId, x: point.x };
      }, cave);
      save = fixture.blob;
      await context!.close();
      const name = cave ? 'resumed-cave' : 'resumed-surface';
      await boot(name);
      assert.equal(reports[name].player.regionId, fixture.region);
      assert.ok(Math.abs(reports[name].player.position.x - fixture.x) < .1);
      assert.ok(reports[name].cache.hitsByKind.terrain > 0);
      assert.ok(reports[name].cache.hitsByKind.spawns > 0);
      assert.deepEqual(reports[name].terrain, reports.cold.terrain);
      assert.deepEqual(reports[name].spawns, reports.cold.spawns);
      if (cave) assert.deepEqual(reports[name].scatter.resident, []);
    }
  }
  if (lab) {
    // A mismatched revision must regenerate, even though the stored payload is otherwise valid.
    await warmPage.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("corealm-generated-world");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction("artifacts", "readwrite");
        const cursor = tx.objectStore("artifacts").openCursor();
        cursor.onsuccess = () => { const row = cursor.result; if (row) { row.update({ ...row.value, revision: "obsolete" }); row.continue(); } };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    }));
    await context!.close();
    await boot("invalidated");
    assert.equal(reports.invalidated.cache.hits, 0);
    assert.ok(reports.invalidated.cache.writes > 0);
    assert.deepEqual(reports.invalidated.terrain, reports.cold.terrain);
    await context!.close();
    await boot("storage-unavailable", true);
    assert.ok(reports["storage-unavailable"].cache.failures > 0);
    assert.deepEqual(reports["storage-unavailable"].terrain, reports.cold.terrain);
  }
} finally {
  await context?.close();
  await server.close();
}
