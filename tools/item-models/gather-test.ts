import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";
import { installAssetCandidates } from "../lib/assetCandidates.js";
import { installTestDeadline } from "../lib/deadline.js";
import { CAMERA } from "../../game/src/app/config.js";

const author = process.argv[2];
assert(author === "pickaxes" || author === "hatchets");
const verb = author === "pickaxes" ? "mine" : "chop";
const site = author === "pickaxes" ? "bracken_workings" : "palewood_landing";
const catalogPath = path.resolve(`art/item-models/candidates/${author}/catalogue.json`);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const out = path.resolve(`test-results/item-models/gather-${author}-r1`);
await mkdir(out, { recursive: true });
const deadline = installTestDeadline("Authored gathering tools", 60000);
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 1000 }, browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const report: any = { passed: false, assets: catalog.assets, tools: [] };
try {
  await driver.launch();
  const page = driver.page!;
  await installAssetCandidates(page, catalogPath);
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', {value:name, configurable:true});");
  await driver.open(22000, "/index.html?mode=combat&environment=1");
  await page.evaluate(async ({ site }) => {
    window.__featureLab!.setLevel("mining", 99); window.__featureLab!.setLevel("woodcutting", 99);
    await (window as any).__environmentLab.showSite(site);
  }, { site });
  const panel = page.locator("#panel-feature-lab");
  if (await panel.isVisible()) await panel.locator(".panel__close").click();
  for (const entry of catalog.assets) {
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    await driver.callDebug("clearInventory");
    const node = await page.evaluate(verb => {
      const global = window as any;
      return global.__environmentLab.getState().entityIds.map((id: string) => global.__gameDebug.getEntity(id))
        .find((entity: any) => entity?.interactions.includes(verb) && entity.resource?.remaining > 0);
    }, verb);
    assert(node, "No live gatherable fixture");
    assert((await driver.callDebug("giveItem", [entry.itemId, 1, "inventory"]) as any).ok);
    const anchor = node.interactionPosition ?? node.position;
    await driver.callDebug("teleport", [[anchor[0] + 1, anchor[1], anchor[2] + 1]]);
    await page.mouse.move(720, 500);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -100);
    const cursor = (await driver.callDebug("getEvents", [0]) as any).nextSeq;
    const result = await driver.callDebug("callTool", ["corealm_interact", { entityId: node.id, interaction: verb }]) as any;
    assert(result.ok !== false, JSON.stringify(result));
    await page.waitForFunction(id => {
      const motion = (window.__gameDebug as any).getPlayerMotion();
      return motion.attachments?.mainHand === `equip-mainHand-corealm_item_${id}` && /mine|chop/i.test(`${motion.pose} ${motion.clip}`);
    }, entry.itemId, { timeout: 5000 });
    for (let attempt = 0; attempt < 3; attempt++) {
      const bearing = await page.evaluate(() => ({ motion: (window.__gameDebug as any).getPlayerMotion(), camera: (window.__gameDebug as any).getCamera() }));
      const delta = Math.atan2(Math.sin(bearing.motion.drawnRotationY + Math.PI / 2 - bearing.camera.yaw), Math.cos(bearing.motion.drawnRotationY + Math.PI / 2 - bearing.camera.yaw));
      const dx = Math.max(-280, Math.min(280, -delta / .006));
      const dy = Math.max(-150, Math.min(150, (.5 - bearing.camera.pitch) / .004));
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
      await page.mouse.move(720, 500); await page.mouse.down({ button: "right" });
      await page.mouse.move(720 + dx, 500 + dy, { steps: 6 }); await page.mouse.up({ button: "right" });
    }
    await page.mouse.move(20, 500);
    await page.waitForTimeout(220);
    const state = await page.evaluate(() => {
      const debug = window.__gameDebug as any;
      return { motion: debug.getPlayerMotion(), camera: debug.getCamera(), player: debug.getPlayerPosition() };
    });
    assert(!state.camera.freeMove && state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
    assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .5);
    assert.deepEqual(state.motion.attachmentErrors ?? {}, {});
    const file = path.join(out, `${entry.itemId}.png`);
    await page.screenshot({ path: file });
    await page.waitForFunction(({ id, cursor }) => (window.__gameDebug as any).getEvents(cursor).events.some((event: any) => event.type === "item.received" && event.entityId === id && event.data.source === "gather"), { id: node.id, cursor }, { timeout: 5000 });
    report.tools.push({ itemId: entry.itemId, sha256: entry.sha256, file, state, events: await driver.callDebug("getEvents", [cursor]) });
  }
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  report.failureState = await driver.page?.evaluate(() => ({ motion: (window.__gameDebug as any)?.getPlayerMotion(), activity: (window.__gameDebug as any)?.getCurrentActivity() })).catch(() => null);
  await driver.page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
} finally {
  await driver.close(); await server.close(); deadline();
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, out }));
}
