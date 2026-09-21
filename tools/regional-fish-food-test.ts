/**
 * Crownward fish cooking acceptance in the production combat lab.
 *
 * One invocation covers one Crownward fish tier. The three shards are intentionally independent:
 * each boots the real combat lab, prepares the authored regional-tier production fixture, cooks
 * the selected raw fish through the production activity, and uses the resulting food through the
 * agent API.
 *
 *   npx tsx tools/regional-fish-food-test.ts --tier 30 --url http://127.0.0.1:4174
 *   npx tsx tools/regional-fish-food-test.ts --tier 40 --url http://127.0.0.1:4174
 *   npx tsx tools/regional-fish-food-test.ts --tier 60 --url http://127.0.0.1:4174
 */
import "./lib/repoContent.js";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { CROWNWARD_FISH, CROWNWARD_FISH_RECIPES } from "../game/src/content/crownwardFishing.js";
import { healAmount } from "../game/src/content/index.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

type Tier = 30 | 40 | 60;

interface ToolError {
  error: string;
  message?: string;
}

interface ItemStack {
  itemId: string;
  quantity: number;
}

interface InventoryView {
  slots?: (ItemStack | null)[];
  freeSlots?: number;
}

interface EventRecord {
  type: string;
  data?: Record<string, unknown>;
  entityId?: string;
}

interface EventRead {
  events: EventRecord[];
  nextSeq: number;
}

interface DebugState {
  ready?: boolean;
  health: number;
  maxHealth: number;
  activity: string | null;
  skills: Record<string, { level: number; xp: number }>;
}

interface StationView {
  id: string;
  archetype: string;
  state: string;
  position: [number, number, number];
  interactionPosition?: [number, number, number];
  station?: { kind: string; skill: string; recipeIds?: string[] };
  meta?: Record<string, unknown>;
}

interface EntitySummary {
  id: string;
  archetype: string;
}

interface RegionalFixtureView {
  ready?: boolean;
  stationIds?: { range?: string };
  stations?: unknown[];
}

const FISH_TIERS: readonly Tier[] = [30, 40, 60];
const COOKING_BATCH = 24;
const ROUTE_SUFFIX = "&regionalTier={tier}&fishing=crownward&startup-cache=0";
const REQUIRED_DEBUG_CONTROLS = [
  "callTool", "clearInventory", "getCurrentActivity", "getEntity", "getErrors", "getEvents",
  "getDrawnBounds", "getEntities", "getCamera", "getPlayerPosition", "getState", "giveItem", "setHealth",
  "setSkillLevel", "advanceGameTime",
] as const;

function isToolError(value: unknown): value is ToolError {
  return Boolean(value && typeof value === "object" && typeof (value as ToolError).error === "string");
}

function countItem(inventory: InventoryView, itemId: string): number {
  return (inventory.slots ?? []).reduce(
    (total, slot) => total + (slot?.itemId === itemId ? slot.quantity : 0),
    0,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tierValue = Number(argValue(args, "--tier"));
  assert(FISH_TIERS.includes(tierValue as Tier), "Usage: --tier must be 30, 40, or 60");
  const tier = tierValue as Tier;
  const externalUrl = argValue(args, "--url");
  const startedAt = Date.now();
  const clearDeadline = installTestDeadline(`Regional fish food tier ${tier}`, 60_000);
  let ownedServer: RunningGameServer | null = null;
  const server: RunningGameServer = externalUrl
    ? { url: externalUrl, close: async () => {} }
    : (ownedServer = await startGameServer({ hmr: false }));
  const out = path.join(repoRoot, "test-results", "regional-fish-food", `tier-${tier}`);
  const command = `npx tsx tools/regional-fish-food-test.ts --tier ${tier}${externalUrl ? ` --url ${externalUrl}` : ""}`;
  const fish = CROWNWARD_FISH.find((candidate) => candidate.tier === tier);
  assert(fish, `No CROWNWARD_FISH species is authored at tier ${tier}`);
  const recipe = CROWNWARD_FISH_RECIPES.find((candidate) => candidate.inputs[0]?.itemId === fish.id);
  assert(recipe, `No Crownward cooking recipe is authored for ${fish.id}`);
  const burntItemId = recipe.burntItemId;
  assert(burntItemId, `${recipe.id} has no burnt output`);
  const route = `/index.html?mode=combat${ROUTE_SUFFIX.replace("{tier}", String(tier))}`;
  const report: Record<string, unknown> = {
    passed: false,
    tier,
    fish,
    recipe,
    route,
    url: server.url,
    command,
    out,
    requiredFixtureControls: [...REQUIRED_DEBUG_CONTROLS, "__regionalTierFixture.prepare"],
    setup: "Debug only seeds the raw fish, cooking level, and player health. The regional-tier fixture prepares the production range; production and eating use the live agent API and activity spine.",
    checks: [] as unknown[],
    screenshots: [] as string[],
  };
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"),
    viewport: { width: 1440, height: 900 },
    browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const remaining = (limit = 4_000): number => {
    const budget = 57_000 - (Date.now() - startedAt);
    assert(budget > 0, `Tier ${tier} exceeded its 60-second action budget`);
    return Math.max(1, Math.min(limit, budget));
  };
  const check = (id: string, passed: boolean, detail: string, evidence?: unknown): void => {
    (report.checks as unknown[]).push({ id, passed, detail, evidence });
    assert(passed, `${id}: ${detail}`);
  };
  const callTool = async (name: string, argsForTool: Record<string, unknown>): Promise<unknown> =>
    driver.callDebug("callTool", [name, argsForTool]);
  const mustTool = async (name: string, argsForTool: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const value = await callTool(name, argsForTool);
    if (isToolError(value)) throw new Error(`${name}: ${value.error}${value.message ? ` ${value.message}` : ""}`);
    if (!value || typeof value !== "object") throw new Error(`${name} returned ${JSON.stringify(value)}`);
    return value as Record<string, unknown>;
  };
  const state = async (): Promise<DebugState> => await driver.callDebug("getState") as DebugState;
  const inventory = async (): Promise<InventoryView> =>
    await mustTool("corealm_inventory", {}) as InventoryView;
  const events = async (sinceSeq: number): Promise<EventRead> =>
    await driver.callDebug("getEvents", [sinceSeq]) as EventRead;
  const currentActivity = async (): Promise<unknown> => driver.callDebug("getCurrentActivity");
  const waitForIdle = async (label: string): Promise<void> => {
    await driver.page!.waitForFunction(
      () => (window.__gameDebug as unknown as { getCurrentActivity(): unknown }).getCurrentActivity() === null,
      undefined,
      { timeout: remaining(7_000), polling: 60 },
    );
    check(`activity.${label}.idle`, await currentActivity() === null, "production/eating activity completed");
  };
  const eventCursor = async (): Promise<number> => (await events(0)).nextSeq;
  const waitForPlayerFollow = async (): Promise<void> => {
    await driver.page!.waitForFunction(
      () => {
        const debug = window.__gameDebug as unknown as {
          getCamera(): { freeMove?: boolean; target?: { x: number; y: number; z: number } };
          getPlayerPosition(): { x: number; y: number; z: number };
        };
        const camera = debug.getCamera();
        const player = debug.getPlayerPosition();
        const target = camera.target;
        return camera.freeMove === false && target !== undefined
          && Math.hypot(target.x - player.x, target.z - player.z) < 0.2
          && Math.abs(target.y - player.y - 1.1) < 0.2;
      },
      undefined,
      { timeout: remaining(3_000), polling: 60 },
    );
  };
  const capture = async (name: string): Promise<void> => {
    await waitForPlayerFollow();
    const camera = await driver.callDebug("getCamera") as {
      freeMove?: boolean;
      requestedDistance?: number;
      target?: { x: number; y: number; z: number };
    };
    const player = await driver.callDebug("getPlayerPosition") as { x: number; y: number; z: number };
    assert.equal(camera.freeMove, false, "Evidence must use the normal player-follow camera");
    assert(camera.requestedDistance === undefined
      || (camera.requestedDistance >= 6 && camera.requestedDistance <= 11),
    "Evidence must stay inside interactive camera zoom limits");
    if (camera.target) {
      assert(Math.hypot(camera.target.x - player.x, camera.target.z - player.z) < 0.2,
        "Evidence camera must remain focused on the player");
      assert(Math.abs(camera.target.y - player.y - 1.1) < 0.2,
        "Evidence camera must use the normal player target height");
    }
    const file = await driver.screenshot(out, `${tier}-${name}`);
    (report.screenshots as string[]).push(file);
  };

  try {
    await mkdir(out, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(remaining(4_000));
    await driver.open(remaining(25_000), route);

    const missingControls = await page.evaluate((names) => {
      const debug = window.__gameDebug as unknown as Record<string, unknown> | undefined;
      return names.filter((name) => typeof debug?.[name] !== "function");
    }, REQUIRED_DEBUG_CONTROLS);
    const fixtureHookAvailable = await page.evaluate(() => {
      const candidate = (globalThis as typeof globalThis & {
        __regionalTierFixture?: { prepare?: unknown };
      }).__regionalTierFixture;
      return typeof candidate?.prepare === "function";
    });
    const missingFixtureControls = [
      ...missingControls,
      ...(fixtureHookAvailable ? [] : ["__regionalTierFixture.prepare"]),
    ];
    report.missingFixtureControls = missingFixtureControls;
    check(
      "fixture.controls",
      missingFixtureControls.length === 0,
      missingFixtureControls.length === 0
        ? "combat lab exposes semantic setup and observation controls"
        : `missing ${missingFixtureControls.join(", ")}`,
      { required: [...REQUIRED_DEBUG_CONTROLS, "__regionalTierFixture.prepare"], missing: missingFixtureControls },
    );

    const fixture = await page.evaluate(async () => {
      const candidate = (globalThis as typeof globalThis & {
        __regionalTierFixture?: { prepare?: () => Promise<unknown> };
      }).__regionalTierFixture;
      if (!candidate || typeof candidate.prepare !== "function") {
        throw new Error("__regionalTierFixture.prepare() is not exposed by the regional-tier lab boot");
      }
      return await candidate.prepare();
    });
    report.fixture = fixture;
    const fixtureView = fixture as RegionalFixtureView;
    check(
      "fixture.ready",
      fixtureView.ready === true && typeof fixtureView.stationIds?.range === "string",
      "__regionalTierFixture.prepare() prepared the authored station row",
      fixture,
    );

    const featurePanel = page.locator("#panel-feature-lab");
    if (await featurePanel.isVisible().catch(() => false)) {
      const close = featurePanel.locator(".panel__close");
      if (await close.count()) await close.click();
    }

    const initial = await state();
    const initialMaxHealth = initial.maxHealth;
    await driver.callDebug("clearInventory");
    await driver.callDebug("setSkillLevel", ["cooking", tier - 1]);
    await driver.callDebug("setHealth", [initialMaxHealth]);
    const rawGrant = await driver.callDebug("giveItem", [fish.id, COOKING_BATCH, "inventory"]);
    const seeded = await inventory();
    check("setup.raw-fish", countItem(seeded, fish.id) === COOKING_BATCH, `seeded ${COOKING_BATCH} ${fish.id}`, { rawGrant, seeded });
    check("setup.cooking-level", (await state()).skills.cooking?.level === tier - 1, `Cooking starts one level below ${tier}`);

    const summaries = await driver.callDebug("getEntities") as EntitySummary[];
    const stationEntities: StationView[] = [];
    for (const summary of summaries.filter((entity) => entity.archetype === "station")) {
      const full = await driver.callDebug("getEntity", [summary.id]) as StationView | null;
      if (full?.station?.kind && Array.isArray(full.position)) stationEntities.push(full);
    }
    const range = stationEntities.find((station) => station.id === fixtureView.stationIds?.range)
      ?? stationEntities.find((station) => station.station?.kind === "range"
      && (station.meta?.regionalTierFixture === true || station.meta?.featureLab === true))
      ?? stationEntities.find((station) => station.station?.kind === "range");
    assert(range, `Regional-tier fixture did not expose a cooking range; stations: ${JSON.stringify(stationEntities)}`);
    const stationId = range.id;
    const rangeInspect = await mustTool("corealm_inspect", { entityId: stationId }) as unknown as StationView;
    check(
      "setup.range-station",
      rangeInspect.archetype === "station" && rangeInspect.station?.kind === "range" && rangeInspect.station.skill === "cooking",
      "regional-tier fixture exposes a live cooking range",
      { fixture, stationId, range: rangeInspect, stations: stationEntities },
    );
    const navigationResult = await mustTool("corealm_navigate", { entityId: stationId, timeoutMs: 12_000 });
    const playerPosition = await driver.callDebug("getPlayerPosition") as { x: number; y: number; z: number };
    const workingPosition = rangeInspect.interactionPosition ?? rangeInspect.position;
    const workingDistance = Math.hypot(
      playerPosition.x - workingPosition[0], playerPosition.z - workingPosition[2],
    );
    check(
      "setup.range-reached",
      workingDistance <= 2.5,
      `real navigation reached the range working position (${workingDistance.toFixed(2)} m)`,
      { navigationResult, playerPosition, workingPosition, workingDistance },
    );
    // Keep the semantic station id in scope for the drawn-bounds wait and every production call.
    await page.waitForFunction(
      (id) => {
        const bounds = (window.__gameDebug as unknown as {
          getDrawnBounds(entityId: string): { meshes?: number } | null;
        }).getDrawnBounds(id);
        return bounds !== null && (bounds.meshes ?? 0) > 0;
      },
      stationId,
      { timeout: remaining(5_000), polling: 60 },
    );
    await capture("range");

    const gateBefore = await inventory();
    const gateCursor = await eventCursor();
    const gateResult = await callTool("corealm_produce", {
      recipeId: recipe.id,
      quantity: 1,
      stationId,
    });
    const gateAfter = await inventory();
    const gateActivity = await currentActivity();
    const gateEvents = (await events(gateCursor)).events;
    check(
      "recipe.cooking-level-gate",
      isToolError(gateResult)
        && gateResult.error === "REQUIREMENTS_NOT_MET"
        && countItem(gateAfter, fish.id) === countItem(gateBefore, fish.id)
        && gateActivity === null
        && gateEvents.every((event) => event.type !== "production.completed"),
      "Cooking below the fish tier refuses production without consuming the raw fish",
      { level: tier - 1, result: gateResult, before: gateBefore, after: gateAfter, activity: gateActivity, events: gateEvents },
    );

    await driver.callDebug("setSkillLevel", ["cooking", tier]);
    const productionBefore = await inventory();
    const xpBefore = (await state()).skills.cooking?.xp ?? 0;
    const productionCursor = await eventCursor();
    const productionStart = await mustTool("corealm_produce", {
      recipeId: recipe.id,
      quantity: COOKING_BATCH,
      stationId,
    });
    await page.waitForFunction(
      () => (window.__gameDebug as unknown as { getCurrentActivity(): { kind?: string } | null }).getCurrentActivity()?.kind === "production",
      undefined,
      { timeout: remaining(4_000), polling: 50 },
    );
    await driver.callDebug("advanceGameTime", [(recipe.durationMs * COOKING_BATCH + 800) / 1_000]);
    await waitForIdle("cooking");
    const productionAfter = await inventory();
    const productionAfterState = await state();
    const productionEvents = (await events(productionCursor)).events
      .filter((event) => event.type === "production.completed" && event.data?.recipeId === recipe.id);
    const cookedCount = countItem(productionAfter, recipe.output.itemId);
    const burntCount = countItem(productionAfter, burntItemId);
    const cookedEvents = productionEvents.filter((event) => event.data?.itemId === recipe.output.itemId);
    const burntEvents = productionEvents.filter((event) => event.data?.itemId === burntItemId && event.data?.burnt === true);
    check(
      "recipe.raw-to-cooked",
      countItem(productionBefore, fish.id) - countItem(productionAfter, fish.id) === COOKING_BATCH
        && cookedCount + burntCount === COOKING_BATCH
        && cookedCount > 0
        && burntCount > 0
        && productionEvents.length === COOKING_BATCH
        && cookedEvents.length === cookedCount
        && burntEvents.length === burntCount,
      `${COOKING_BATCH} raw ${fish.name} became ${cookedCount} cooked and ${burntCount} burnt outputs`,
      { productionStart, before: productionBefore, after: productionAfter, events: productionEvents },
    );
    check(
      "recipe.cooking-xp",
      (productionAfterState.skills.cooking?.xp ?? 0) - xpBefore === cookedCount * recipe.xp,
      `cooking XP awarded only for ${cookedCount} successful outputs`,
      { xpBefore, xpAfter: productionAfterState.skills.cooking?.xp ?? 0, recipeXp: recipe.xp, cookedCount, burntCount },
    );

    await driver.callDebug("setHealth", [1]);
    const beforeBurntUse = await state();
    const burntInventoryBefore = await inventory();
    const burntUse = await callTool("corealm_use_item", { itemId: burntItemId });
    const afterBurntUse = await state();
    const burntInventoryAfter = await inventory();
    check(
      "food.burnt-inedible",
      isToolError(burntUse)
        && burntUse.error === "INVALID_ARGUMENT"
        && countItem(burntInventoryAfter, burntItemId) === countItem(burntInventoryBefore, burntItemId)
        && beforeBurntUse.health < beforeBurntUse.maxHealth
        && afterBurntUse.health === beforeBurntUse.health
        && afterBurntUse.activity === null,
      `burnt ${fish.name} is refused and leaves health unchanged`,
      { result: burntUse, before: beforeBurntUse, after: afterBurntUse, inventoryBefore: burntInventoryBefore, inventoryAfter: burntInventoryAfter },
    );

    await driver.callDebug("setHealth", [1]);
    const beforeEat = await state();
    const cookedInventoryBefore = await inventory();
    const eatResult = await mustTool("corealm_use_item", { itemId: recipe.output.itemId });
    await page.waitForFunction(
      () => (window.__gameDebug as unknown as { getCurrentActivity(): { kind?: string } | null }).getCurrentActivity()?.kind === "eating",
      undefined,
      { timeout: remaining(3_000), polling: 50 },
    );
    await driver.callDebug("advanceGameTime", [2.2]);
    await waitForIdle("eating");
    const afterEat = await state();
    const cookedInventoryAfter = await inventory();
    const expectedHealth = Math.min(beforeEat.maxHealth, beforeEat.health + healAmount(tier));
    check(
      "food.cooked-healing",
      afterEat.health === expectedHealth
        && afterEat.health > beforeEat.health
        && countItem(cookedInventoryBefore, recipe.output.itemId) - countItem(cookedInventoryAfter, recipe.output.itemId) === 1,
      `cooked ${fish.name} raised health ${beforeEat.health} -> ${afterEat.health}`,
      { eatResult, before: beforeEat, after: afterEat, expectedHealth, inventoryBefore: cookedInventoryBefore, inventoryAfter: cookedInventoryAfter },
    );
    await capture("cooked-food");

    const runtimeErrors = await driver.callDebug("getErrors") as unknown[];
    report.errors = {
      console: driver.consoleErrors,
      page: driver.pageErrors,
      requests: driver.requestErrors,
      runtime: runtimeErrors,
    };
    check(
      "browser.errors",
      driver.consoleErrors.length === 0 && driver.pageErrors.length === 0 && driver.requestErrors.length === 0 && runtimeErrors.length === 0,
      "no browser, request, or production runtime errors",
      report.errors,
    );
    report.passed = true;
  } catch (error) {
    report.error = describe(error);
    process.exitCode = 1;
    if (driver.page) await driver.screenshot(out, `${tier}-failure`).catch(() => undefined);
  } finally {
    report.elapsedMs = Date.now() - startedAt;
    await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    await driver.close();
    await ownedServer?.close();
    clearDeadline();
    console.log(JSON.stringify({ passed: report.passed, tier, out, elapsedMs: report.elapsedMs, error: report.error }));
  }
}

await main();
