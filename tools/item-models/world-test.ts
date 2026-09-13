import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_ITEMS } from "../../game/src/content/items.js";
import { CAMERA } from "../../game/src/app/config.js";
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";
import { installTestDeadline } from "../lib/deadline.js";

// Final-world wiring proof only. Run after root acceptance and promotion of the lab candidates.
const armorTiers = process.argv.includes('--armor-tiers');
const auroraArmor = process.argv.includes('--aurora-armor');
const authoredArmor = armorTiers || auroraArmor;
// Both crafted sets share one cold world boot, within the documented two-minute
// full-world smoke budget. Detailed views and motion phases stay in the lab.
const budget = authoredArmor ? 120000 : 60000;
const started = Date.now(), clearDeadline = installTestDeadline("Promoted item world integration", budget);
const outFlag = process.argv.indexOf("--out");
const label = outFlag < 0 ? "world-promoted" : process.argv[outFlag + 1];
assert(label && /^[a-z0-9-]+$/.test(label), "Use --out <lowercase-label>");
const out = path.resolve("test-results/item-models", label);
await mkdir(out, { recursive: true });
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const remaining = (maximum: number) => {
  const available = budget - 4000 - (Date.now() - started);
  assert(available > 0, "World proof exhausted its work budget");
  return Math.min(maximum, available);
};
const itemsIndex = process.argv.indexOf("--items");
const requestedItems = itemsIndex >= 0 ? process.argv[itemsIndex + 1]?.split(",") : undefined;
assert(itemsIndex < 0 || requestedItems?.length && requestedItems.every(id => /^[a-z0-9_]+$/.test(id)), "Use --items id,id");
assert(!armorTiers || !requestedItems, '--armor-tiers and --items are separate selections');
assert(!auroraArmor || !armorTiers && !requestedItems, '--aurora-armor is a separate selection');
const kits = auroraArmor ? [{ name: 'aurora', ids: ['hood', 'robe', 'leggings', 'boots', 'wraps'].map(piece => `frostweave_${piece}`) }] : armorTiers ? ['dragonhide', 'starhide'].map(theme => ({ name: theme,
  ids: ['hood', 'robe', 'leggings', 'boots', 'wraps'].map(piece => `${theme}_${piece}`) })) : requestedItems ? [{ name: "selected", ids: requestedItems }] : [
  { name: "metal", ids: ["grithe_helm", "grithe_cuirass", "grithe_greaves", "grithe_boots", "grithe_gloves", "grithe_sword", "palewood_shield"] },
  { name: "cloth", ids: ["marchhide_hood", "marchhide_robe", "marchhide_leggings", "marchhide_boots", "marchhide_wraps", "earth_wand"] },
];
const report: any = { passed: false, route: "/index.html", candidateOverride: false,
  purpose: "Final-world integration after isolated lab acceptance; production equipment operations, keyboard movement, player-focused camera.",
  kits: [], captures: [] };
let server: Awaited<ReturnType<typeof startGameServer>> | undefined;
let driver: GameDriver | undefined;
try {
  const manifestBytes = await readFile("game/public/assets/manifest.json");
  const manifest = JSON.parse(manifestBytes.toString());
  report.manifestSha256 = hash(manifestBytes);
  report.assets = [];
  for (const itemId of [...new Set(kits.flatMap(kit => kit.ids))]) {
    const entry = manifest.assets.find((asset: any) => asset.id === `corealm_item_${itemId}`);
    assert(entry?.itemModel?.itemId === itemId, `${itemId} has not been promoted to the production manifest`);
    const bytes = await readFile(path.resolve("game/public/assets", entry.file));
    report.assets.push({ itemId, assetId: entry.id, file: entry.file, sha256: hash(bytes), bytes: bytes.length });
  }
  server = await startGameServer();
  driver = new GameDriver(server, { viewport: { width: 1440, height: 1000 },
    browserArgs: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--mute-audio"] });
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', {value:name, configurable:true});");
  const served = new Map<string, string>();
  // Large authored GLBs can exceed Chromium's response-inspector cache. Hash the
  // real server bytes in transit and forward them unchanged to the normal loader.
  await page.route(url => report.assets.some((asset: any) => url.pathname === `/assets/${asset.file}`), async route => {
    const response = await route.fetch(), bytes = await response.body();
    served.set(new URL(route.request().url()).pathname, hash(bytes));
    await route.fulfill({ response, body: bytes });
  });
  report.downloadVerification = 'Actual production HTTP response bytes hashed and forwarded unchanged; no candidate replacement.';
  await driver.open(remaining(authoredArmor ? 60000 : 40000), "/index.html");
  report.readyAtMs = Date.now() - started;
  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  const servedManifest = await page.request.get(new URL("/assets/manifest.json", server.url).href, { timeout: remaining(3000) });
  assert.equal(hash(await servedManifest.body()), report.manifestSha256, "Server manifest differs from the promoted manifest");
  const read = () => page.evaluate(() => {
    const debug = window.__gameDebug as any;
    const save = JSON.parse(debug.getSaveBlob());
    return { timeOrigin: performance.timeOrigin, world: debug.getState(), player: debug.getPlayerPosition(),
      actor: debug.getPlayer(), equipment: save.equipment, motion: debug.getPlayerMotion(), camera: debug.getCamera(), errors: debug.getErrors() };
  });
  report.beforeSetup = await read();
  await driver.callDebug("setSkillLevel", ["melee", 99]);
  await driver.callDebug("setSkillLevel", ["magic", 99]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(720, 500);
  for (let index = 0; index < 25; index++) await page.mouse.wheel(0, -100);

  async function orbit(offset: number) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await page.locator(".ctx-menu").isVisible()) await page.keyboard.press("Escape");
      const state = await read();
      const delta = Math.atan2(Math.sin(state.motion.drawnRotationY + offset - state.camera.yaw), Math.cos(state.motion.drawnRotationY + offset - state.camera.yaw));
      const dx = Math.max(-280, Math.min(280, -delta / .006));
      const dy = Math.max(-160, Math.min(160, (.4 - state.camera.pitch) / .004));
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      await page.mouse.move(720, 500); await page.mouse.down({ button: "right" });
      try { await page.mouse.move(720 + dx, 500 + dy, { steps: 6 }); }
      finally { await page.mouse.up({ button: "right" }); }
    }
    const state = await read();
    const delta = Math.atan2(Math.sin(state.motion.drawnRotationY + offset - state.camera.yaw), Math.cos(state.motion.drawnRotationY + offset - state.camera.yaw));
    assert(Math.abs(delta) < .03 && Math.abs(state.camera.pitch - .4) < .03, "Normal camera controls did not reach the requested bearing");
  }
  async function capture(name: string) {
    await page.mouse.move(20, 600);
    const state = await read();
    assert.equal(state.timeOrigin, documentOrigin, "World document reloaded during proof");
    assert(!state.camera.freeMove, "Camera detached from gameplay focus");
    assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
    assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
    assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .15, "Camera target left normal player head height");
    assert.deepEqual(state.motion.attachmentErrors ?? {}, {});
    assert.equal(state.errors.length, 0);
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: remaining(3500) });
    report.captures.push({ name, file, state });
  }
  for (const kit of kits) {
    const equipment = Object.fromEntries(kit.ids.map(id => {
      const item = ALL_ITEMS.find(candidate => candidate.id === id);
      assert(item?.equip, `${id} is not equipment`);
      return [item.equip.slot, id];
    }));
    const before = await read(), operations: unknown[] = [];
    // Clear the shield when switching to the magic kit through the same public equipment tool.
    if (!equipment.offHand && before.equipment.offHand) {
      const result: any = await driver.callDebug("callTool", ["corealm_equip", { unequipSlot: "offHand" }]);
      assert(!result?.error && result?.ok !== false, "Could not unequip shield"); operations.push(result);
    }
    for (const id of kit.ids) {
      const grant: any = await driver.callDebug("giveItem", [id, 1, "inventory"]);
      assert(grant.ok, `Grant failed for ${id}`);
      const result: any = await driver.callDebug("callTool", ["corealm_equip", { itemId: id }]);
      assert(!result?.error && result?.ok !== false, `Equipment operation failed for ${id}`);
      operations.push({ itemId: id, result });
    }
    report.lastEquipmentOperations = { kit: kit.name, operations, atMs: Date.now() - started };
    await page.waitForFunction(equipment => {
      const debug = window.__gameDebug as any, motion = debug.getPlayerMotion(), save = JSON.parse(debug.getSaveBlob());
      return !motion.layerLoadPending && !Object.keys(motion.attachmentLoading ?? {}).length
        && Object.entries(equipment).every(([slot, id]) => save.equipment[slot]?.itemId === id
          && (["mainHand", "offHand"].includes(slot) ? motion.attachments?.[slot] === `equip-${slot}-corealm_item_${id}`
            : motion.layerAssets?.includes(`corealm_item_${id}`)));
    }, equipment, { timeout: remaining(authoredArmor ? 15000 : 7000) });
    const equipped = await read();
    if (!equipment.offHand) assert.equal(equipped.equipment.offHand, null);
    await orbit(.25); await capture(`${kit.name}-front`);
    await orbit(Math.PI + .25); await capture(`${kit.name}-back`);
    const movementBefore = await read();
    await page.keyboard.down("w");
    let moving: any;
    try {
      await page.waitForFunction(origin => {
        const debug = window.__gameDebug as any, p = debug.getPlayerPosition(), motion = debug.getPlayerMotion();
        return Math.hypot(p.x - origin.x, p.z - origin.z) > 1.2 && motion.actionWeight > .98
          && /walk|run|jog/i.test(`${motion.pose} ${motion.clip}`);
      }, movementBefore.player, { timeout: remaining(2500) });
      moving = await read();
      assert.deepEqual(moving.equipment, equipped.equipment);
      assert.deepEqual(moving.motion.attachments, equipped.motion.attachments);
      await capture(`${kit.name}-walking`);
    } finally { await page.keyboard.up("w"); }
    await page.waitForFunction(() => {
      const motion = (window.__gameDebug as any).getPlayerMotion();
      return /idle/i.test(`${motion.pose} ${motion.clip}`) && motion.actionWeight > .98;
    }, undefined, { timeout: remaining(2500) });
    await capture(`${kit.name}-settled`);
    report.kits.push({ name: kit.name, equipment, operations, before, equipped,
      movement: { before: movementBefore, during: moving, settled: await read() } });
    if (armorTiers && kit !== kits.at(-1)) {
      // Return along the same short path with normal input. Otherwise the next
      // set's front view can start inside the nearby gatehouse camera occluder.
      await page.keyboard.down('s');
      try {
        await page.waitForFunction(origin => {
          const p = (window.__gameDebug as any).getPlayerPosition();
          return Math.hypot(p.x - origin.x, p.z - origin.z) < .8;
        }, movementBefore.player, { timeout: remaining(6000) });
      } finally { await page.keyboard.up('s'); }
      await page.waitForFunction(() => {
        const motion = (window.__gameDebug as any).getPlayerMotion();
        return /idle/i.test(`${motion.pose} ${motion.clip}`) && motion.actionWeight > .98;
      }, undefined, { timeout: remaining(2500) });
    }
  }
  for (const asset of report.assets) assert.equal(served.get(`/assets/${asset.file}`), asset.sha256, `Served GLB mismatch/missing request: ${asset.assetId}`);
  report.servedAssetHashes = Object.fromEntries(served);
  assert.equal(hash(await readFile("game/public/assets/manifest.json")), report.manifestSha256, "Manifest changed during proof");
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  if (driver?.page && Date.now() - started < budget - 2500) {
    await driver.page.screenshot({ path: path.join(out, "failure.png"), timeout: 2000 }).catch(() => {});
  }
} finally {
  report.elapsedMs = Date.now() - started;
  report.errors = { page: driver?.pageErrors ?? [], console: driver?.consoleErrors ?? [], requests: driver?.requestErrors ?? [] };
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await driver?.close(); await server?.close(); clearDeadline();
  console.log(JSON.stringify({ passed: report.passed, error: report.error, out }));
}
