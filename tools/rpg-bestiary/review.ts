/** Scheduled production hardware review. Run bounded batches only with the root's GPU slot. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GameDriver } from "../lib/driver.js";
import { installAssetCandidates } from "../lib/assetCandidates.js";
import { installTestDeadline } from "../lib/deadline.js";
import { RPG_BESTIARY, RPG_BESTIARY_STAGED } from "../../game/src/content/rpgBestiary.js";
import { tierSilhouetteScale } from "../../game/src/core/math.js";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1]! : fallback;
const mode = args.includes("--combat") ? "combat" : "gallery";
const batch = Number(arg("--batch", "0"));
assert(Number.isInteger(batch) && batch >= 0 && batch < 3, "--batch must be 0, 1 or 2");
const representatives = RPG_BESTIARY.filter((row, i, all) => all.findIndex(other => other.bodyFamily === row.bodyFamily) === i)
  .map(row => RPG_BESTIARY.find(candidate => candidate.id === ({ goblin: 'goblin_shaman', skeleton: 'skeleton_archer' } as Record<string, string>)[row.bodyFamily]) ?? row);
const selectedIds = args.includes("--ids") ? arg("--ids", "").split(",") : null;
const rows = selectedIds ? selectedIds.map(id => { const row = [...RPG_BESTIARY,...RPG_BESTIARY_STAGED].find(r => r.id === id); assert(row, `Unknown species ${id}`); return row; }) : mode === "combat" ? representatives.slice(batch * 4, batch * 4 + 4) : RPG_BESTIARY.filter((_, i) => i % 3 === batch);
const out = arg("--out", `test-results/bestiary-${mode}-${batch}`);
const url = arg("--url", "http://127.0.0.1:4175");
const catalogPath = arg("--catalog", "art/rebuild/candidates/finish-bestiary/catalog.json");
const catalogBytes = await readFile(catalogPath);
const assetCatalog = JSON.parse(catalogBytes.toString("utf8"));
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const report: any = { mode, batch, catalogPath, catalogueSha256: createHash("sha256").update(catalogBytes).digest("hex"), ids: rows.map(r => r.id), captures: [], combat: [], visualAccepted: false, passed: false };
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline(`RPG ${mode} batch ${batch}`, mode === "gallery" ? 150000 : 120000);
try {
  await driver.launch();
  const page = driver.page!;
  await installAssetCandidates(page, catalogPath);
  await driver.open(25000, `/index.html?mode=combat${mode === "gallery" ? "&creatures=1" : ""}`);
  report.renderer = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return extension ? gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
  });
  assert(report.renderer && !/swiftshader|llvmpipe/i.test(report.renderer), `Hardware renderer unavailable: ${report.renderer}`);
  for (const row of rows) {
    const presetId = `${RPG_BESTIARY_STAGED.some(candidate=>candidate.id===row.id)?'candidate':'species'}:${row.id}`;
    if (mode === "gallery") {
      await page.evaluate(async id => { await (window as any).__creatureGallery.show(id, 1); }, presetId);
      await page.waitForFunction(id => {
        const state = (window as any).__creatureGallery?.getState();
        return state?.ready === true && state.presetId === id && state.entityIds.length === 1
          && (id.startsWith('candidate:') || document.querySelector<HTMLSelectElement>("#creature-gallery-preset")?.value === id);
      }, presetId, { timeout: 10000 });
      const state: any = await page.evaluate(() => (window as any).__creatureGallery.getState());
      const bounds: any = await page.evaluate(() => (window as any).__creatureGallery.getBounds());
      const entity: any = await page.evaluate(id => (window as any).__gameDebug.getEntities().find((e: any) => e.id === id), state.entityIds[0]);
      const asset = assetCatalog.assets.find((entry: any) => entry.id === row.assetId);
      assert(asset && entity, "Missing measured asset or gallery actor for framing");
      const scale = row.scale * tierSilhouetteScale(row.stats.tier);
      const framedBounds = { min: [entity.position.x + asset.base.x * scale, entity.position.y + asset.base.y * scale, entity.position.z + asset.base.z * scale], max: [entity.position.x + (asset.base.x + asset.size.x) * scale, entity.position.y + (asset.base.y + asset.size.y) * scale, entity.position.z + (asset.base.z + asset.size.z) * scale] };
      // Flight changes the visible wing span and altitude beyond the export's Idle instant.
      if(row.bodyFamily==='wasp'){
        const until=Date.now()+1600;
        while(Date.now()<until){
          const drawn:any=await driver.callDebug('getDrawnBounds',[entity.id]);
          if(drawn)for(const [i,axis]of ['x','y','z'].entries()){framedBounds.min[i]=Math.min(framedBounds.min[i]!,drawn.min[axis]);framedBounds.max[i]=Math.max(framedBounds.max[i]!,drawn.max[axis]);}
          await driver.wait(80);
        }
      }
      assert.equal(state.presetId, presetId); assert.equal(state.assetId, row.assetId); assert(bounds);
      await page.evaluate(() => {
        for (const id of ["panel-feature-lab", "creature-gallery-panel"]) { const el = document.getElementById(id); if (el) el.style.visibility = "hidden"; }
      });
      for (const [name, yaw, distanceFactor] of [["front", 0, 1.5], ["side", Math.PI / 2, 1.5], ["rear-play", Math.PI, 2.8]] as const) {
        const h = framedBounds.max[1]! - framedBounds.min[1]!, w = Math.max(framedBounds.max[0]! - framedBounds.min[0]!, framedBounds.max[2]! - framedBounds.min[2]!);
        const pose = { x: (framedBounds.min[0]! + framedBounds.max[0]!) / 2, y: (framedBounds.min[1]! + framedBounds.max[1]!) / 2, z: (framedBounds.min[2]! + framedBounds.max[2]!) / 2, yaw, pitch: .22, distance: Math.max(1.8, h * distanceFactor, w * distanceFactor), detached: true };
        await driver.callDebug("inspectPose", [pose]); await driver.wait(120);
        const capture = `${row.id}-${name}`; await driver.screenshot(out, capture);
        const runtime = await page.evaluate(() => { const s = (window as any).__gameDebug.getState(); return { renderer: s.renderer, assets: s.assets, clock: s.clock }; });
        report.captures.push({ capture, id: row.id, view: name, state, bounds, framedBounds, framing: "Measured asset Idle geometry plus actual actor position and production tier scale", pose, runtime });
      }
    } else {
      await page.evaluate(async id => {
        const lab = (window as any).__featureLab;
        await lab.spawnTarget("creature", id, { distance: 7 });
        lab.setLevel("melee", 35); lab.setLevel("magic", 35);
        await lab.equipPlayer("mainHand", "kaldite_sword");
      }, presetId);
      await page.waitForFunction(id => {
        const s = (window as any).__featureLab?.getState();
        return s?.ready && s.target?.presetId === id && s.target?.ai && s.target.health === s.target.maxHealth;
      }, presetId, { timeout: 10000 });
      const before: any = await page.evaluate(() => ({ lab: (window as any).__featureLab.getState(), game: (window as any).__gameDebug.getState() }));
      assert.equal(before.lab.target.presetId, presetId);
      if (!await page.locator("#lab-attack").isVisible()) await page.keyboard.press("l");
      await page.locator("#lab-attack").click();
      const trace: any[] = [];
      const capturedMotions = new Set<string>();
      const deadline = Date.now() + 40000;
      let dead: any;
      while (Date.now() < deadline) {
        const state: any = await page.evaluate(() => (window as any).__featureLab.getState());
        assert.equal(state.target?.presetId, presetId, "Target changed during accepted action");
        trace.push({ at: Date.now(), health: state.target.health, ai: state.target.ai, position: state.target.position, motion: state.target.motion, player: state.player });
        const motionName = String(state.target.motion?.clip ?? state.target.motion?.state ?? 'unknown');
        if (!capturedMotions.has(motionName) && capturedMotions.size < 8) {
          capturedMotions.add(motionName);
          await driver.screenshot(out, `${row.id}-natural-${motionName.replace(/[^a-z0-9_-]/gi, '_')}`);
        }
        if (trace.length === 3) await driver.screenshot(out, `${row.id}-combat`);
        if (state.target.state === "dead" && state.target.health === 0) { dead = state; break; }
        await driver.wait(200);
      }
      assert(dead, `${row.id} did not die through one attack command`);
      assert.equal(dead.target.ai.state, "dead");
      assert(dead.target.ai.respawnInMs > 0, "Natural death did not schedule respawn");
      const after: any = await page.evaluate(() => (window as any).__gameDebug.getState());
      const loot: any[] = await page.evaluate(id => (window as any).__gameDebug.getEntities().filter((entity: any) => entity.archetype === "loot" && entity.id.startsWith(`loot_${id}_`)), before.lab.target.entityId);

      report.currentCombat = { before, after, dead, trace, loot };
      const xp = (game: any) => ["melee", "magic"].reduce((sum, id) => sum + (game.skills?.[id]?.xp ?? 0), 0);
      assert(xp(after) > xp(before.game), "Credited kill did not award combat XP");
      assert(after.currency > before.game.currency, "Credited kill did not award marks");
      await driver.screenshot(out, `${row.id}-death`);
      let reward: any = null, inventoryAfter: any = null;
      if (loot.length) {
      reward = await page.evaluate(async lootId => {
        const debug = (window as any).__gameDebug;
        const inventory = await debug.callTool("corealm_inventory", {});
        const event = debug.getEvents(0).events.find((event: any) => event.data?.pileId === lootId);
        const expected = event?.data?.items?.[0];
        const opened = await debug.callTool("corealm_interact", { entityId: lootId, interaction: "loot" });
        const afterOpen = await debug.callTool("corealm_inventory", {});
        return { inventory, expected, opened, afterOpen };
      }, loot[0].id);
      assert(reward.expected, "Loot spawn event omitted expected stack");
      assert.deepEqual(reward.afterOpen.slots, reward.inventory.slots, "Opening loot transferred inventory before pointer pickup");
      await page.locator(".loot-reveal:not([hidden]) .loot-reveal__slot").first().click();
      inventoryAfter = await page.evaluate(async () => (window as any).__gameDebug.callTool("corealm_inventory", {}));
      const quantity = (inventory: any, id: string) => (inventory.slots ?? []).reduce((sum: number, slot: any) => sum + (slot?.itemId === id ? slot.quantity : 0), 0);
      assert.equal(quantity(inventoryAfter, reward.expected.itemId) - quantity(reward.inventory, reward.expected.itemId), reward.expected.quantity, "Pointer loot pickup did not transfer exact stack");
      }
      let respawn: any = null;
      if (row.id === rows.at(-1)?.id) {
        const respawnDeadline = Date.now() + 35000;
        while (Date.now() < respawnDeadline) {
          const s: any = await page.evaluate(() => (window as any).__featureLab.getState());
          report.currentCombat.lastRespawnState = s;
          if (s.target?.presetId === presetId && s.target.state !== "dead" && s.target.health === s.target.maxHealth && s.target.ai?.respawnInMs === null) { respawn = s; break; }
          await driver.wait(400);
        }
        assert(respawn, "Target did not respawn within35real seconds; last state recorded");
        respawn = await page.evaluate(() => (window as any).__featureLab.getState());
        assert.equal(respawn.target.entityId, before.lab.target.entityId);
        await driver.screenshot(out, `${row.id}-respawn`);
      }
      report.combat.push({ id: row.id, setup: "Debug fixture spawn, combat levels35, Cobalt sword. One visible Attack button click; clock unmodified. When a normal item roll succeeds, loot opens through the production interaction dispatcher and one exact stack is taken by pointer click. Empty rolls are recorded. Final fight waits for the real respawn deadline.", before, after, dead, trace, respawn, loot, reward, inventoryAfter, dropTable: row.stats.drops, noItemDrop: loot.length === 0 });
    }
  }
  report.errors = await driver.callDebug("getErrors");
  report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors; report.requestErrors = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.requestErrors, []);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { await driver.close(); clearDeadline(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, captures: report.captures.length, fights: report.combat.length, out })); }


