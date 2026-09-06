/** Root-only compact production journeys. --case altar|storm-rhino|gate|drops; --url / --out.
 * --case gate --full-boss uses the 120-second creature-lifecycle budget for a complete Ordrun fight.
 * Prerequisites/loadout/spawn are fixture setup. Combat, loot, awakening, crafting and equipment
 * flow through the same game API as player input. No damage, kill or quest event is synthesized.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { assertGameplayHardware, GAMEPLAY_HARDWARE_ARGS } from "./finish-gameplay-renderer.js";
import type { GameplayAcceptanceFixtureApi } from "../../../game/src/featureLab/gameplayAcceptance.js";
import type { CreatureLootFixtureApi } from "../../../game/src/featureLab/creatureLootFixture.js";
import type { GameState } from "../../../game/src/state/store.js";
import type { GameEvent, Vec3 } from "../../../game/src/contracts.js";
type Debug = NonNullable<Window["__gameDebug"]> & { getSaveBlob(): string; loadSaveBlob(json: string): void;
  teleport(position: Vec3): boolean; clearInventory(): void; giveItem(id: string, quantity: number, to: string): unknown;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped: boolean }; };
type FixtureWindow = Window & { __gameplayAcceptance: GameplayAcceptanceFixtureApi; __creatureLootFixture: CreatureLootFixtureApi };
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] ?? fallback; };
const scenario = arg("--case", "altar");
assert(["altar", "storm-rhino", "gate", "drops"].includes(scenario));
const fullBoss = process.argv.includes("--full-boss");
assert(!fullBoss || scenario === "gate", "--full-boss requires --case gate");
const budgetMs = fullBoss ? 119_000 : 59_000;
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", `test-results/finish-gameplay-progression/${fullBoss ? "ordrun-full" : scenario}`);
const trace: unknown[] = [];
const report: Record<string, unknown> = { passed: false, scenario, fullBoss, budgetMs, trace,
  setup: "Compact production actors/station; prerequisite quest stage/items and high-level melee loadout are diagnostic setup. Outcomes must come from ordinary systems.",
  persistenceScope: "Production save serialization/import roundtrip; compact labs intentionally do not persist browser storage.",
  visualEvidence: "Reduced graphics semantic captures, pending screenshot inspection." };
mkdirSync(out, { recursive: true });
const started = Date.now();
const timer = setTimeout(() => { report.error = `${budgetMs / 1000}-second deadline`; writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); process.exit(1); }, budgetMs);
const driver = new GameDriver({ url, close: async () => {} }, { settings: FAST_TEST_SETTINGS, browserArgs: GAMEPLAY_HARDWARE_ARGS });
try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(4_000);
  await driver.open(20_000, `/index.html?mode=combat&gameplay=1&doors=${scenario === "gate" ? "1" : "0"}&creatureLoot=1`);
  report.renderer = await assertGameplayHardware(page);
  const read = () => page.evaluate(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState);
  const events = () => page.evaluate(() => (window.__gameDebug as Debug).getEvents(0));
  const snapshot = async (label: string) => {
    const state = await read();
    const clock = await page.evaluate(() => window.__gameDebug!.getState().clock) as { paused: boolean; timeScale: number };
    assert.equal(clock.paused, false); assert.equal(clock.timeScale, 1);
    trace.push({ label, inventory: state.inventory, equipment: state.equipment, quests: state.quests, magic: state.magic,
      currency: state.currency, skills: state.skills, combat: state.combat });
    return state;
  };
  const count = (state: GameState, id: string) => state.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === id ? slot.quantity : 0), 0);
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await driver.callDebug("callTool", [name, args]);
    trace.push({ name, args, result });
    assert(!(result && typeof result === "object" && "error" in result), JSON.stringify(result));
    return result;
  };
  await page.evaluate(async (fullBoss) => {
    window.__featureLab!.setLevel("melee", 99);
    window.__featureLab!.setLevel("magic", 1);
    await window.__featureLab!.equipPlayer("mainHand", fullBoss ? "emberite_sword" : "kaldite_sword");
  }, fullBoss);
  if (fullBoss) report.combatSetup = "Melee99 and authored Titanium Sword are setup for a bounded lifecycle proof, not a progression-level balance claim. Both bears and full200HP boss retain production stats.";
  await page.locator("#panel-feature-lab .panel__close").click();
  if (scenario !== "drops") await page.evaluate((scenario) => (window as unknown as FixtureWindow).__gameplayAcceptance.prepare(scenario), scenario as "altar" | "storm-rhino" | "gate");
  const initial = await snapshot("prepared prerequisites before accepted actions");
  const kill = async (entityId: string, timeout = 12_000) => {
    const before = (await events()).nextSeq;
    await tool("corealm_attack", { entityId });
    await page.waitForFunction(({ entityId, before }) => (window.__gameDebug as Debug).getEvents(before).events.some((e) => e.type === "combat.ended" && e.data.reason === "killed" && e.data.enemyId === entityId), { entityId, before }, { timeout });
    const result = await events();
    assert.equal(result.dropped, false);
    assert.equal(result.events.filter((e) => e.seq > before && e.type === "combat.ended" && e.data.reason === "killed" && e.data.enemyId === entityId).length, 1);
  };
  const takeLoot = async () => {
    const piles = Object.keys((await read()).world.lootPiles);
    for (const entityId of piles) {
      const before = await read();
      await tool("corealm_interact", { entityId, interaction: "loot" });
      assert.deepEqual((await read()).inventory, before.inventory, "Opening cannot transfer items");
      await tool("corealm_take_loot", { entityId });
    }
  };
  if (scenario === "altar") {
    assert.equal(initial.magic.awakenedAltars.fallowmarch_air_altar, undefined);
    assert.equal(count(initial, "air_orb"), 1);
    assert.equal(await driver.callDebug("teleport", [[-3, 0, -2]]), true);
    await tool("corealm_interact", { entityId: "fallowmarch_air_altar", interaction: "awaken" });
    const awakened = await snapshot("real awakening consumes one orb");
    assert.equal(count(awakened, "air_orb"), 0);
    assert.equal(awakened.magic.awakenedAltars.fallowmarch_air_altar, true);
    assert.equal(awakened.magic.consumedOrbs.air_orb, true);
    await tool("corealm_produce", { recipeId: "craft_air_staff", quantity: 1, stationId: "fallowmarch_air_altar" });
    await page.waitForFunction(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).inventory.slots.some((s: { itemId: string } | null) => s?.itemId === "air_staff"), undefined, { timeout: 8_000 });
    await tool("corealm_equip", { itemId: "air_staff" });
    const equipped = await snapshot("normal production and equip advances Vess quest");
    assert.equal(count(equipped, "palewood_staff"), 0);
    assert.equal(equipped.equipment.mainHand?.itemId, "air_staff");
    assert.equal(equipped.magic.weaponCharges.air_staff, 1000);
    await page.waitForFunction(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).quests.sparking_stone.stage === 3);
  } else if (scenario === "storm-rhino") {
    await kill("tempest_roc");
    await page.waitForFunction(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).quests.sparking_stone.stage === 1);
    assert.equal(count(await read(), "air_orb"), 0, "Kill alone must not pick up the orb");
    await takeLoot();
    await page.waitForFunction(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).quests.sparking_stone.stage === 2);
    assert.equal(count(await read(), "air_orb"), 1);
  } else if (scenario === "gate") {
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).__gameplayAcceptance.getState().gate), "sealed");
    assert.equal(await driver.callDebug("teleport", [[36, 0, -10]]), true);
    await kill("gravelmaw_ch3_bears_0");
    assert.equal(await page.evaluate(() => (window as unknown as FixtureWindow).__gameplayAcceptance.getState().gate), "sealed", "One bear cannot unlock the boss");
    await kill("gravelmaw_ch3_bears_1");
    await page.waitForFunction(() => (window as unknown as FixtureWindow).__gameplayAcceptance.getState().gate === "open");
    const unlocked = await snapshot("two real bear kills unlock the gate");
    assert.equal(unlocked.quests.long_cairn?.status, "complete");
    assert.equal(count(unlocked, "cairn_garnet"), 0);
    const receipts = (await events()).events;
    const combatMarks = receipts.filter((event) => event.type === "item.received"
      && ["gravelmaw_ch3_bears_0", "gravelmaw_ch3_bears_1"].includes(String(event.data.from)))
      .reduce((sum, event) => sum + Number(event.data.currency ?? 0), 0);
    const questMoney = receipts.filter((event) => event.type === "item.received"
      && event.data.name === "marks" && event.data.quantity === 2400);
    assert.equal(questMoney.length, 1, "Exactly one 2400-mark quest payment");
    assert.equal(unlocked.currency, initial.currency + 2400 + combatMarks);
    trace.push({ label: "separate quest payment and natural kill currency", combatMarks, questMoney });
    if (fullBoss) {
      const beforeBoss = await snapshot("earned gate open before full-health Armored Rhino fight");
      const actor = await page.evaluate(() => (window as unknown as FixtureWindow).__gameplayAcceptance.getState().actors.find((actor) => actor.id === "ordrun"));
      assert.equal(actor?.health, 200); assert.equal(actor?.maxHealth, 200);
      const beforeBossSeq = (await events()).nextSeq;
      await kill("ordrun", Math.min(85_000, budgetMs - (Date.now() - started) - 12_000));
      const dead = await snapshot("natural boss death before opening loot");
      assert.equal(dead.world.enemies.ordrun?.state, "dead");
      assert.equal(dead.world.enemies.ordrun?.health, 0);
      assert(dead.player.health > 0, "Player survives the complete fight");
      assert.equal(count(dead, "water_orb"), 0, "Boss death alone cannot pick up the Water Orb");
      const bossEvents = (await events()).events.filter((event) => event.seq > beforeBossSeq);
      const marks = bossEvents.filter((event) => event.type === "item.received" && event.data.from === "ordrun")
        .reduce((sum, event) => sum + Number(event.data.currency ?? 0), 0);
      assert(marks >= 900 && marks <= 1400);
      assert.equal(dead.currency, beforeBoss.currency + marks);
      assert.equal(bossEvents.filter((event) => event.type === "player.died").length, 0);
      const killReceipt = bossEvents.filter((event) => event.type === "combat.ended" && event.data.reason === "killed" && event.data.enemyId === "ordrun");
      assert.equal(killReceipt.length, 1);
      assert.equal(killReceipt[0]!.data.creditedPlayerId, "player");
      const pileIds = Object.keys(dead.world.lootPiles).filter((id) => id.startsWith("loot_ordrun_"));
      assert.equal(pileIds.length, 1);
      const pileId = pileIds[0]!;
      const loot = dead.world.lootPiles[pileId]!.items;
      assert(loot.some((item) => item.itemId === "water_orb" && item.quantity === 1));
      assert(loot.some((item) => item.itemId === "kaldite_sword" && item.quantity === 1));
      await tool("corealm_interact", { entityId: pileId, interaction: "loot" });
      assert.deepEqual((await read()).inventory, dead.inventory, "Opening the boss pile cannot transfer loot");
      const cells = page.locator(".loot-reveal:not([hidden]) .loot-reveal__slot");
      await cells.first().waitFor({ state: "visible" });
      for (let index = 0; index < loot.length; index++) await cells.first().click();
      const looted = await snapshot("real loot-grid clicks take each boss stack once");
      for (const item of loot) assert.equal(count(looted, item.itemId), count(dead, item.itemId) + item.quantity);
      assert.equal(count(looted, "water_orb"), 1);
      assert.equal(looted.world.lootPiles[pileId], undefined);
      assert.equal(looted.currency, dead.currency);
      assert.deepEqual(looted.quests, beforeBoss.quests, "Boss loot cannot repeat the completed gate quest");
      trace.push({ label: "full boss credited kill and natural loot", killReceipt, marks, loot });
      report.bossScope = "Earned gate unlock, natural full200HP Ordrun death, credited player kill, explicit loot-grid clicks and saved outcome.";
    } else {
    // Full Armored Rhino combat exceeds this combined shard's budget. Prove the newly opened
    // physical gate permits real pursuit into the boss bay and a natural damaging hit.
    await tool("corealm_attack", { entityId: "ordrun" });
    await page.waitForFunction(() => {
      const fixture = (window as unknown as FixtureWindow).__gameplayAcceptance.getState();
      const boss = fixture.actors.find((actor) => actor.id === "ordrun");
      const state = JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState;
      return boss?.health !== null && boss?.health !== undefined && boss.health < 200 && state.player.position[2] < -18;
    }, undefined, { timeout: 15_000 });
    report.bossScope = "Gate crossing and natural damaging hit; full Armored Rhino kill is a separate combat journey.";
    await tool("corealm_stop", {});
    }
  } else {
    await page.evaluate(async () => {
      const debug = window.__gameDebug as Debug;
      debug.clearInventory();
      debug.giveItem("grithe_bar", 1, "inventory");
      debug.giveItem("pale_quartz", 1, "inventory");
      await (window as unknown as FixtureWindow).__creatureLootFixture.prepare();
    });
    await snapshot("non-creature recipe ingredients are explicit setup");
    for (let attempt = 0; attempt < 8 && count(await read(), "fox_guardhair") < 3; attempt++) {
      const spawned = await page.evaluate(() => window.__featureLab!.spawnTarget("creature", "species:redbrush_fox", { distance: 2 }));
      assert(spawned.target);
      await kill(spawned.target.entityId);
      await takeLoot();
    }
    const drops = await snapshot("natural fox loot collected");
    assert(count(drops, "fox_guardhair") >= 3, "Bounded natural loot run did not collect recipe material");
    assert.equal(await driver.callDebug("teleport", [[-3.5, 0, -2]]), true);
    await tool("corealm_produce", { recipeId: "creature_fox_guardhair", quantity: 1, stationId: "feature-lab:creature-loot:crafting-table" });
    await page.waitForFunction(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).inventory.slots.some((s: { itemId: string } | null) => s?.itemId === "foxhair_ring"));
    const crafted = await snapshot("real creature recipe consumes exact ingredients");
    assert.equal(count(crafted, "fox_guardhair"), count(drops, "fox_guardhair") - 3);
    assert.equal(count(crafted, "grithe_bar"), 0); assert.equal(count(crafted, "pale_quartz"), 0);
    await tool("corealm_equip", { itemId: "foxhair_ring" });
    assert.equal((await read()).equipment.accessory1?.itemId, "foxhair_ring");
  }
  const final = await snapshot("before production serialization roundtrip");
  await driver.screenshot(out, "accepted-action-state");
  await page.evaluate(() => { const debug = window.__gameDebug as Debug; debug.loadSaveBlob(debug.getSaveBlob()); });
  const restored = await snapshot("production deserialize restores accepted outcomes");
  assert.deepEqual(restored.inventory, final.inventory); assert.deepEqual(restored.equipment, final.equipment);
  assert.deepEqual(restored.magic, final.magic); assert.deepEqual(restored.quests, final.quests);
  assert.equal(restored.currency, final.currency);
  if (fullBoss) {
    assert.equal(restored.world.enemies.ordrun?.state, "dead");
    assert.equal(restored.world.enemies.ordrun?.health, 0);
    assert.equal(count(restored, "water_orb"), 1);
    assert(!Object.keys(restored.world.lootPiles).some((id) => id.startsWith("loot_ordrun_")));
  }
  assert.deepEqual(await driver.callDebug("getErrors"), []);
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (driver.page && Date.now() - started < budgetMs - 6_000) {
    report.failureState = await driver.page.evaluate(() => ({
      state: JSON.parse((window.__gameDebug as Debug).getSaveBlob()),
      fixture: (window as unknown as FixtureWindow).__gameplayAcceptance?.getState(),
      events: (window.__gameDebug as Debug).getEvents(0),
    })).catch(() => null);
    await driver.screenshot(out, "failure").catch(() => undefined);
  }
} finally {
  report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  await driver.close(); clearTimeout(timer); report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, scenario, error: report.error, elapsedMs: report.elapsedMs }));
}

