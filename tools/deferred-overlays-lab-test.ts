/** Real companion controls, item hover, combat death, and cache looting with deferred UI imports. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { GameEvent, ItemStack, Result } from "../game/src/contracts.js";
import type { GameState } from "../game/src/state/store.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

interface OverlayDebug {
  getState(): { health: number; clock: { timeScale: number } };
  getSaveBlob(): string;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  setHealth(health: number): void;
}

async function main(): Promise<void> {
  const started = Date.now();
  const clearDeadline = installTestDeadline("Deferred overlays lab gate", 45_000);
  const args = process.argv.slice(2);
  const externalUrl = argValue(args, "--url");
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const output = path.join(repoRoot, "test-results", "deferred-overlays-lab");
  const report: Record<string, unknown> = {
    passed: false, url: server.url, route: "/index.html?mode=combat",
    setup: "One Air Essence stack. All equipment removed, Melee and Magic level 1. Each death follows a production Reaver attack with player health set to 1 after spawning the aggressive actor at 2 m. Simulation remains at timeScale 1.",
    inputProof: "Real companion expansion/collapse; inventory keyboard focus and pointer hover; Escape and pause-menu input; death report Dismiss; production interact opens the recovery cache and its Take button transfers the stack.",
    screenshots: [] as string[],
  };
  const screenshots = report.screenshots as string[];
  const requests: Record<string, number> = { agentPanelBody: 0, tooltips: 0, deathScreen: 0, lootReveal: 0, mapPanel: 0 };
  const releases = new Map<string, () => void>();
  let stage = "boot";
  const remaining = (limit: number): number => {
    const budget = 41_000 - (Date.now() - started);
    assert(budget > 0, "Deferred overlay acceptance exceeded its 41-second operation budget");
    return Math.max(1, Math.min(limit, budget));
  };
  const count = (slots: readonly (ItemStack | null)[], id: string): number =>
    slots.reduce((total, stack) => total + (stack?.itemId === id ? stack.quantity : 0), 0);

  try {
    await mkdir(output, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3_000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    for (const name of ["agentPanelBody", "tooltips", "deathScreen", "lootReveal"] as const) {
      const held = new Promise<void>((resolve) => { releases.set(name, resolve); });
      await page.route(`**/ui/${name}.ts*`, async (route) => {
        requests[name]!++;
        await held;
        await route.continue();
      });
    }
    await page.route("**/ui/mapPanel.ts*", async (route) => {
      requests.mapPanel!++;
      await route.continue();
    });
    await driver.open(remaining(18_000), report.route as string);
    const documentOrigin = await page.evaluate(() => performance.timeOrigin);
    assert.deepEqual(requests, { agentPanelBody: 0, tooltips: 0, deathScreen: 0, lootReveal: 0, mapPanel: 0 }, "Optional controls, overlays, or full map loaded at boot");
    report.absentAtBoot = { ...requests };
    assert.equal((await page.evaluate(() => (window.__gameDebug as unknown as OverlayDebug).getState())).clock.timeScale, 1);
    const labPanel = page.locator("#panel-feature-lab");
    await labPanel.waitFor({ state: "visible", timeout: remaining(3_000) });
    await labPanel.locator(".panel__close").click();

    stage = "companion expansion and collapse during loading";
    const companion = page.getByRole("region", { name: "AI agent", exact: true });
    assert(await companion.isVisible(), "The offline companion header must be visible before its controls load");
    assert.equal((await companion.locator(".agent-panel__name").textContent())?.trim(), "Agent companion");
    assert.equal((await companion.locator(".agent-panel__mode").textContent())?.trim(), "Offline");
    const companionBody = companion.locator(".agent-panel__body");
    assert(await companionBody.isHidden());
    await Promise.all([
      page.waitForRequest("**/ui/agentPanelBody.ts*", { timeout: remaining(3_000) }),
      companion.getByRole("button", { name: "Expand agent companion", exact: true }).click(),
    ]);
    assert.equal(await companionBody.getAttribute("aria-busy"), "true");
    await companion.getByRole("button", { name: "Collapse agent companion", exact: true }).click();
    assert(await companionBody.isHidden());
    releases.get("agentPanelBody")!();
    await companionBody.locator(".agent-panel__foot").waitFor({ state: "attached", timeout: remaining(3_000) });
    assert(await companionBody.isHidden(), "The completed controls import reopened a collapsed companion");
    const expandCompanion = companion.getByRole("button", { name: "Expand agent companion", exact: true });
    assert.equal(await expandCompanion.getAttribute("aria-expanded"), "false");
    await expandCompanion.click();
    assert(await companionBody.isVisible());
    assert(await companionBody.getByText("Waiting for an agent", { exact: true }).isVisible());
    assert(await companionBody.getByText("You", { exact: true }).isVisible());
    assert.match(await companionBody.locator(".agent-panel__foot").innerText(), /WebMCP/);
    assert(await companionBody.getByRole("button", { name: "Let agent play", exact: true, includeHidden: true }).isHidden());
    assert.equal(requests.agentPanelBody, 1, "Reopening the companion fetched its controls again");
    screenshots.push(await driver.screenshot(output, "00-offline-companion-controls"));
    report.companion = { offlineHeaderAtBoot: true, collapsedDuringLoad: true, stayedCollapsedAfterLoad: true, reopenedOfflineControls: true };
    await companion.getByRole("button", { name: "Collapse agent companion", exact: true }).click();

    await driver.callDebug("clearInventory");
    const grant = await driver.callDebug("giveItem", ["air_essence", 3, "inventory"]) as Result<number>;
    assert(grant.ok && grant.value === 3);

    stage = "tooltip cancellation and live quantity";
    await Promise.all([
      page.waitForRequest("**/ui/tooltips.ts*", { timeout: remaining(4_000) }),
      driver.press("i"),
    ]);
    const inventory = page.locator("#panel-inventory");
    const essenceSlot = inventory.locator('[data-item="air_essence"]');
    await essenceSlot.waitFor({ state: "visible", timeout: remaining(3_000) });
    await essenceSlot.hover();
    assert.equal(await page.locator(".tooltip:visible").count(), 0);
    await page.mouse.move(20, 20);
    releases.get("tooltips")!();
    await page.locator(".tooltip").waitFor({ state: "attached", timeout: remaining(3_000) });
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.equal(await page.locator(".tooltip:visible").count(), 0, "A canceled hover produced an orphan tooltip");
    await essenceSlot.hover();
    await page.locator(".tooltip").waitFor({ state: "visible", timeout: remaining(2_000) });
    assert.match(await page.locator(".tooltip__title").innerText(), /Air Essence/);
    assert.match(await page.locator(".tooltip__count").innerText(), /3/);
    const increment = await driver.callDebug("giveItem", ["air_essence", 2, "inventory"]) as Result<number>;
    assert(increment.ok && increment.value === 2);
    await page.waitForFunction(() => document.querySelector(".tooltip__count")?.textContent?.trim() === "×5", undefined, {
      timeout: remaining(2_000), polling: 50,
    });
    screenshots.push(await driver.screenshot(output, "01-live-item-tooltip"));
    report.tooltip = { canceledBeforeLoad: true, itemId: "air_essence", quantities: [3, 5] };
    await page.mouse.move(20, 20);
    await inventory.locator(".panel__close").click();

    stage = "combat fixture";
    const combatSetup = await page.evaluate(async () => {
      const lab = window.__featureLab!;
      for (const { slot } of lab.getCatalog().equipment) await lab.equipPlayer(slot, null);
      lab.setLevel("melee", 1);
      lab.setLevel("magic", 1);
      lab.setWalkingEnabled(true);
      lab.setPlayerVisible(true);
      return lab.getState();
    });
    assert.equal(combatSetup.errors.length, 0);
    assert.equal(combatSetup.levels.melee, 1);
    assert.equal(combatSetup.levels.magic, 1);
    assert(Object.values(combatSetup.equipment).every((item) => item === null));

    async function receiveLethalAttack(): Promise<{ died: GameEvent; combat: GameEvent; state: GameState }> {
      const setup = await page.evaluate(async () => {
        const debug = window.__gameDebug as unknown as OverlayDebug;
        const since = debug.getEvents(0).nextSeq;
        const lab = await window.__featureLab!.spawnTarget("creature", "kilnroad_reavers", { distance: 2 });
        // spawnTarget restores health. Lower it only after the real actor has finished loading.
        debug.setHealth(1);
        return { since, target: lab.target, errors: lab.errors, health: debug.getState().health };
      });
      assert.equal(setup.errors.length, 0);
      assert(setup.target && setup.target.entityId);
      assert.equal(setup.health, 1);
      await page.waitForFunction((since) => {
        const receipts = (window.__gameDebug as unknown as OverlayDebug).getEvents(since);
        return receipts.dropped || receipts.events.some((event) => event.type === "player.died");
      }, setup.since, { timeout: remaining(7_000), polling: 40 });
      const receipts = await driver.callDebug("getEvents", [setup.since]) as { events: GameEvent[]; dropped?: boolean };
      assert(!receipts.dropped, "Death evidence fell out of the event ring");
      const deaths = receipts.events.filter((event) => event.type === "player.died");
      assert.equal(deaths.length, 1, "Exactly one production death must resolve per hostile fixture");
      const combat = receipts.events.find((event) => event.type === "combat.started" && event.data.initiator === "enemy" && event.data.by === setup.target!.entityId);
      assert(combat, "The spawned enemy did not initiate the combat that killed the player");
      const died = deaths[0]!;
      assert(receipts.events.indexOf(combat) < receipts.events.indexOf(died));
      const state = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
      assert(state.player.health > 0, "Death did not respawn the player");
      assert(state.world.recoveryCache && state.world.recoveryCache.id === died.data.cacheId, "Death did not create the reported cache");
      assert.equal(count(state.inventory.slots, "air_essence"), 0);
      return { died, combat, state };
    }

    stage = "delayed death dismissal";
    const [firstDeath] = await Promise.all([
      receiveLethalAttack(),
      page.waitForRequest("**/ui/deathScreen.ts*", { timeout: remaining(10_000) }),
    ]);
    assert.equal(await page.locator(".death:visible").count(), 0);
    await driver.press("Escape");
    assert.equal(await page.locator(".title:visible").count(), 0, "Escape did not consume the pending death report");
    await driver.press("Escape");
    const resume = page.getByRole("button", { name: "Return to game", exact: true });
    await resume.waitFor({ state: "visible", timeout: remaining(2_000) });
    releases.get("deathScreen")!();
    await page.locator(".death").waitFor({ state: "attached", timeout: remaining(3_000) });
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.equal(await page.locator(".death:visible").count(), 0, "Canceled import reopened the death report");
    assert(await resume.isVisible(), "Canceled death import replaced the pause menu");
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest(".title"))), "Canceled death import stole pause-menu focus");
    report.deathCancellation = { combat: firstDeath.combat, died: firstDeath.died, cache: firstDeath.state.world.recoveryCache };
    await resume.click();

    stage = "second natural death and real dismissal";
    const secondGrant = await driver.callDebug("giveItem", ["air_essence", 5, "inventory"]) as Result<number>;
    assert(secondGrant.ok && secondGrant.value === 5);
    const secondDeath = await receiveLethalAttack();
    const death = page.getByRole("dialog", { name: "You died", exact: true });
    await death.waitFor({ state: "visible", timeout: remaining(2_000) });
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest(".death"))), "The loaded death report did not receive focus");
    assert.match(await death.innerText(), /recovery cache/);
    screenshots.push(await driver.screenshot(output, "02-natural-death-report"));
    await death.getByRole("button", { name: "Dismiss", exact: true }).click();
    assert.equal(await page.locator(".death:visible").count(), 0);
    report.secondDeath = { combat: secondDeath.combat, died: secondDeath.died };

    stage = "deferred cache contents and actual stack transfer";
    // Keep the recovery interaction isolated from another hostile attack. This replaces only the
    // lab actor, using its cached model, and leaves the production death cache untouched.
    const safeFixture = await page.evaluate(() => window.__featureLab!.spawnTarget("creature", "kilnroad_reavers", { distance: 30 }));
    assert.equal(safeFixture.errors.length, 0);
    const before = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    const cache = before.world.recoveryCache;
    assert(cache && count(cache.items, "air_essence") === 5);
    assert.equal(await driver.callDebug("inspectPose", [{
      x: cache.position[0], y: cache.position[1], z: cache.position[2] - 1.5,
      yaw: 0, pitch: 0.6, distance: 12,
    }]), true);
    await Promise.all([
      page.waitForRequest("**/ui/lootReveal.ts*", { timeout: remaining(3_000) }),
      driver.callDebug("callTool", ["corealm_interact", { entityId: cache.id, interaction: "loot" }]),
    ]);
    assert.equal(await page.locator(".loot-reveal:visible").count(), 0);
    await driver.press("Escape");
    releases.get("lootReveal")!();
    await page.locator(".loot-reveal").waitFor({ state: "attached", timeout: remaining(3_000) });
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.equal(await page.locator(".loot-reveal:visible").count(), 0, "Canceled import reopened cache contents");
    await driver.callDebug("callTool", ["corealm_interact", { entityId: cache.id, interaction: "loot" }]);
    const loot = page.getByRole("dialog", { name: "Recovery Cache contents", exact: true });
    await loot.waitFor({ state: "visible", timeout: remaining(3_000) });
    screenshots.push(await driver.screenshot(output, "03-recovery-cache-contents"));
    const cursor = (await driver.callDebug("getEvents", [0]) as { nextSeq: number }).nextSeq;
    report.lootAttempt = { cursor, cacheId: cache.id, before };
    await loot.getByRole("button", { name: "Take Air Essence x 5", exact: true }).click();
    let completionError: unknown;
    try {
      // Taking is synchronous, but the event bus publishes its queued receipt at the next tick.
      await page.waitForFunction(({ since, cacheId }) => {
        const debug = window.__gameDebug as unknown as OverlayDebug;
        const state = JSON.parse(debug.getSaveBlob()) as GameState;
        const batch = debug.getEvents(since);
        const carried = state.inventory.slots.reduce((sum, stack) => sum + (stack?.itemId === "air_essence" ? stack.quantity : 0), 0);
        return batch.dropped || (carried === 5 && state.world.recoveryCache === null
          && batch.events.some((event) => event.type === "item.received" && event.data.source === "loot"
            && event.data.from === cacheId && event.data.itemId === "air_essence"));
      }, { since: cursor, cacheId: cache.id }, { timeout: remaining(3_000), polling: 40 });
    } catch (error) {
      completionError = error;
    }
    const { after, receipts } = await page.evaluate((since) => {
      const debug = window.__gameDebug as unknown as OverlayDebug;
      return { after: JSON.parse(debug.getSaveBlob()) as GameState, receipts: debug.getEvents(since) };
    }, cursor);
    report.lootAttempt = {
      cursor, cacheId: cache.id, before, after, receipts,
      ...(completionError ? { waitError: completionError instanceof Error ? completionError.message : String(completionError) } : {}),
    };
    if (completionError) throw completionError;
    assert(!receipts.dropped);
    const received = receipts.events.filter((event) => event.type === "item.received" && event.data.source === "loot" && event.data.from === cache.id && event.data.itemId === "air_essence");
    assert.equal(received.length, 1);
    assert.equal(received[0]!.data.quantity, 5);
    assert.equal(count(after.inventory.slots, "air_essence") - count(before.inventory.slots, "air_essence"), 5);
    assert.equal(count(after.inventory.slots, "air_essence") + count(after.world.recoveryCache?.items ?? [], "air_essence"), count(before.inventory.slots, "air_essence") + count(cache.items, "air_essence"));
    assert.equal(after.world.recoveryCache, null, "Taking the final stack did not remove its cache");
    assert.equal(await page.locator(".loot-reveal:visible").count(), 0);
    report.loot = { canceledBeforeLoad: true, received: received[0], inventoryDelta: 5, cacheRemoved: true };
    assert.deepEqual(requests, { agentPanelBody: 1, tooltips: 1, deathScreen: 1, lootReveal: 1, mapPanel: 0 });
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, "The page reloaded during acceptance");
    assert.deepEqual(await driver.callDebug("getErrors"), []);
    assert.equal(driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Runtime or request errors occurred");
    report.passed = true;
  } catch (error) {
    report.stage = stage;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page && Date.now() - started < 35_000) {
      try { screenshots.push(await driver.screenshot(output, "failure")); } catch { /* Retain the original failure. */ }
    }
  } finally {
    for (const release of releases.values()) release();
    report.elapsedMs = Date.now() - started;
    report.chunkRequests = requests;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    try {
      await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ passed: report.passed, elapsedMs: report.elapsedMs, error: report.error, report: path.join(output, "report.json") }));
    } finally {
      await driver.close();
      await server.close();
      clearDeadline();
    }
  }
}

await main();
