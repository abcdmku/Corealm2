/** Root-scheduled Chromium gate. Debug only arranges the compact scene; production attacks
 * cause every credited kill, and production save serialization/load restores the results. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import type { GameState } from "../../../game/src/state/store.js";
import type { HuntContractsState } from "../../../game/src/systems/huntContracts.js";
import type { Result, SemanticEntity, Vec3 } from "../../../game/src/contracts.js";

type Debug = NonNullable<Window["__gameDebug"]> & {
  getSaveBlob(): string; loadSaveBlob(json: string): void; teleport(position: Vec3): void;
  getEntities(): (Omit<SemanticEntity, "position"> & { position: {x:number;y:number;z:number} })[];
};
type HuntWindow = Window & { __huntLab: {
  snapshot(): HuntContractsState; refreshOffers(): Result<unknown>; attack(id: string): Result<unknown>;
  claim(): Result<number>; spawn: Vec3;
} };
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", "test-results/finish-hunts");
mkdirSync(out, { recursive: true });
const report: Record<string, unknown> = { passed: false, url,
  setup: "Production combat lab, eight real bandits; level 50 melee/magic and a production sword. Debug teleports arrange each encounter within reach. No health, kill events, hunt progress or reward writes.",
  persistence: "Production getSaveBlob/loadSaveBlob serialize, validate, migrate and replace world state. Browser autosave is disabled in the lab; browser-storage reload is a separate final-world integration check.",
  visualEvidence: "Reduced rendering settings for semantic/UI evidence, not creature art acceptance." };
const trace: unknown[] = [];
report.trace = trace;
const started = Date.now();
const deadline = setTimeout(() => {
  report.error = "Hunt lifecycle gate exceeded 119 seconds including cleanup";
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); process.exit(1);
}, 119_000);
const driver = new GameDriver({ url, close: async () => {} }, { headless: true, settings: FAST_TEST_SETTINGS });
try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(5_000);
  await driver.open(30_000, "/index.html?mode=combat&hunt=1");
  await page.waitForFunction(() => !!(window as HuntWindow).__huntLab && !!window.__featureLab);
  const read = () => page.evaluate(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState);
  const hunts = () => page.evaluate(() => (window as HuntWindow).__huntLab.snapshot());
  await page.evaluate(async () => {
    const lab = window.__featureLab!;
    lab.setLevel("melee", 50); lab.setLevel("magic", 50);
    const weapon = lab.getCatalog().equipment.find((row) => row.slot === "mainHand")?.items
      .find((item) => /kaldite_sword|corven_sword|grithe_sword/.test(item.id));
    if (!weapon) throw new Error("Hunt fixture requires a production sword");
    await lab.equipPlayer("mainHand", weapon.id);
    (window.__gameDebug as Debug).teleport((window as HuntWindow).__huntLab.spawn);
    const rolled = (window as HuntWindow).__huntLab.refreshOffers();
    if (!rolled.ok) throw new Error("Could not generate hunt offers");
  });
  await page.getByRole("button", { name: "Quests, key J", exact: true }).click();
  const board = page.getByRole("region", { name: "Hunt contracts" });
  await board.getByRole("button", { name: "Accept hunt", exact: true }).first().click();
  const initial = await hunts();
  assert(initial.active && initial.active.status === "active");
  assert.equal(initial.active.kills, 0);
  trace.push({ stage: "accepted", hunt: initial });
  const acceptedBlob = await page.evaluate(() => (window.__gameDebug as Debug).getSaveBlob());
  await page.evaluate((blob) => (window.__gameDebug as Debug).loadSaveBlob(blob), acceptedBlob);
  assert.deepEqual(await hunts(), initial, "Accepted identity and offer remain stable through production reload");
  await page.getByRole("button", { name: "Quests, key J", exact: true }).click();
  const ids = await page.evaluate(() => (window.__gameDebug as Debug).getEntities()
    .filter((entity) => entity.id.startsWith("lab_hunt_bandits_"))
    .map((entity) => entity.id));
  assert(ids.length >= initial.active.offer.requiredKills);
  for (const id of ids.slice(0, initial.active.offer.requiredKills)) {
    const before = (await hunts()).active!.kills;
    const attack = await page.evaluate((id) => {
      const debug = window.__gameDebug as Debug;
      const entity = debug.getEntities().find((entry) => entry.id === id);
      if (!entity) throw new Error(`Missing fixture enemy ${id}`);
      debug.teleport([entity.position.x + 1.8, entity.position.y, entity.position.z]);
      return (window as HuntWindow).__huntLab.attack(id);
    }, id);
    assert(attack.ok, JSON.stringify(attack));
    await page.waitForFunction(({ id, before }) => {
      const dead = (window.__gameDebug as Debug).getEntities().find((entity) => entity.id === id)?.state === "dead";
      return dead && (window as HuntWindow).__huntLab.snapshot().active!.kills === before + 1;
    }, { id, before }, { timeout: 10_000 });
    const state = await read();
    trace.push({ stage: "real kill", id, kills: state.huntContracts.active!.kills,
      killSerial: state.huntContracts.killSerial, meleeXp: state.skills.melee.xp,
      enemy: state.world.enemies[id] });
    if (before === 0) {
      const blob = await page.evaluate(() => (window.__gameDebug as Debug).getSaveBlob());
      const progress = await hunts();
      await page.evaluate((blob) => (window.__gameDebug as Debug).loadSaveBlob(blob), blob);
      assert.deepEqual(await hunts(), progress, "One credited kill survives production reload");
    }
  }
  const ready = await read();
  assert.equal(ready.huntContracts.active!.status, "ready");
  await page.getByRole("button", { name: "Quests, key J", exact: true }).click();
  await board.getByRole("button", { name: "Claim XP", exact: true }).waitFor();
  await driver.screenshot(out, "01-ready");
  await board.getByRole("button", { name: "Claim XP", exact: true }).click();
  const claimed = await read();
  assert.equal(claimed.skills.melee.xp - ready.skills.melee.xp, initial.active.offer.rewardXp);
  assert.equal(claimed.huntContracts.active!.status, "claimed");
  assert.equal(claimed.huntContracts.completedCount, 1);
  assert(claimed.huntContracts.offers.length > 0);
  trace.push({ stage: "claimed", hunt: claimed.huntContracts, beforeXp: ready.skills.melee.xp, afterXp: claimed.skills.melee.xp });
  await driver.screenshot(out, "02-claimed");
  const claimedBlob = await page.evaluate(() => (window.__gameDebug as Debug).getSaveBlob());
  await page.evaluate((blob) => (window.__gameDebug as Debug).loadSaveBlob(blob), claimedBlob);
  const duplicate = await page.evaluate(() => (window as HuntWindow).__huntLab.claim());
  assert.equal(duplicate.ok, false);
  const restored = await read();
  assert.deepEqual(restored.huntContracts, claimed.huntContracts);
  assert.equal(restored.skills.melee.xp, claimed.skills.melee.xp);
  trace.push({ stage: "reload rejects duplicate claim", hunt: restored.huntContracts, meleeXp: restored.skills.melee.xp });
  const errors = await driver.callDebug("getErrors");
  assert.deepEqual(errors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  try { await driver.screenshot(out, "failure"); } catch {}
  process.exitCode = 1;
} finally {
  await driver.close(); clearTimeout(deadline);
  report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}




