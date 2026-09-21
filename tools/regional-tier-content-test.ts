/**
 * Production recipe, equipment and gathering acceptance for one regional tier.
 *
 * The run is intentionally a small browser shard. The fixture may grant stations and Crownward
 * fish, but every mutation after setup goes through the production API exposed by the real agent
 * commands. It is safe to point this at a persistent Vite server:
 *
 *   npx tsx tools/regional-tier-content-test.ts --tier 30 --url http://127.0.0.1:4174
 *
 * Repeat the command for T40 and T60. Reports and screenshots belong under test-results/, which
 * is disposable acceptance output.
 */
import "./lib/repoContent.js";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { EquipmentBonuses, EquipSlot, ItemDef, SkillId } from "../game/src/contracts.js";
import type { RecipeDef } from "../game/src/content/index.js";
import { REGIONAL_CRAFTING_TIERS, REGIONAL_TIER_ITEMS, REGIONAL_TIER_RECIPES } from "../game/src/content/regionalTierEquipment.js";
import { toolBonus } from "../game/src/content/index.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

type JsonRecord = Record<string, any>;
type Point = { x: number; y: number; z: number };
type ItemStackView = { itemId: string; quantity: number };
type SaveView = {
  inventory: { slots: (ItemStackView | null)[] };
  equipment: Record<string, ItemStackView | null>;
  skills: Record<string, { level: number; xp: number }>;
};
type EntitySummary = {
  id: string;
  archetype: string;
  name?: string;
  tier?: number;
  interactions?: string[];
  position?: number[];
};
type StationEntity = EntitySummary & {
  station: { kind: string; skill: SkillId; recipeIds: string[] };
  position: number[];
  interactionPosition?: number[];
};
type ResourceEntity = EntitySummary & {
  resource?: { itemId: string; remaining: number };
  position: number[];
  interactionPosition?: number[];
};
type MotionView = {
  pose?: string;
  attachments?: Record<string, string>;
  activityMainHandKey?: string | null;
  fishing?: { visible?: boolean; visibleTackle?: number };
};

const EQUIPMENT_SLOTS: readonly EquipSlot[] = [
  "head", "body", "legs", "feet", "hands", "mainHand", "offHand",
  "accessory1", "accessory2", "ring2", "earring2",
];
const BONUS_KEYS: readonly (keyof EquipmentBonuses)[] = [
  "meleeAccuracy", "meleePower", "defence", "magicAccuracy", "magicPower", "health", "vitality",
];
/** The first production shard stays bounded around one smithing station. Extend this list when
 * the fixture grows the other station kinds; the static checks still cover every authored recipe. */
const RUNTIME_STATION_KINDS = ["anvil"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function asSave(value: unknown): SaveView {
  assert.equal(typeof value, "string", "getSaveBlob must return JSON");
  return JSON.parse(value as string) as SaveView;
}

function countItem(save: SaveView, itemId: string): number {
  return (save.inventory?.slots ?? []).reduce(
    (total, stack) => total + (stack?.itemId === itemId ? stack.quantity : 0), 0,
  );
}

function resultError(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.error === "string") return value.error;
  if (value.ok === false && isRecord(value.error) && typeof value.error.code === "string") return value.error.code;
  return undefined;
}

function requireSuccess(value: unknown, label: string): JsonRecord | unknown {
  const error = resultError(value);
  assert.equal(error, undefined, `${label} failed: ${error ?? "unknown error"} ${isRecord(value) ? String(value.message ?? "") : ""}`);
  if (isRecord(value) && value.ok === false) throw new Error(`${label} failed`);
  return value;
}

function point(value: unknown, label: string): number[] {
  assert(Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number"), `${label} must be a Vec3`);
  return value as number[];
}

function xzDistance(a: Point, b: number[]): number {
  return Math.hypot(a.x - b[0]!, a.z - b[2]!);
}

function equipmentProjection(save: SaveView, skill: string): unknown {
  return {
    equipment: save.equipment,
    inventory: save.inventory,
    skill: save.skills?.[skill],
  };
}

function parseTier(args: string[]): 30 | 40 | 60 {
  const raw = argValue(args, "--tier") ?? "30";
  assert(raw === "30" || raw === "40" || raw === "60", "Use --tier 30, --tier 40 or --tier 60");
  return Number(raw) as 30 | 40 | 60;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tier = parseTier(args);
  const startedAt = Date.now();
  const clearDeadline = installTestDeadline(`Regional tier content T${tier}`, 60_000);
  const externalUrl = argValue(args, "--url");
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer({ hmr: false });
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"),
    viewport: { width: 1440, height: 900 },
    browserArgs: [
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
      "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
    ],
  });
  const output = path.join(repoRoot, argValue(args, "--out") ?? `test-results/regional-tier-content/tier${tier}`);
  const route = `/index.html?mode=combat&regionalTier=${tier}&fishing=crownward&startup-cache=0`;
  const report: Record<string, unknown> = {
    passed: false,
    tier,
    route,
    url: server.url,
    setup: "A production feature-lab fixture may add stations and Crownward fish. The harness only seeds skills and inventory; production actions use corealm_produce, corealm_equip and corealm_interact.",
    fixture: null,
    runtimeScope: "One real smithing recipe plus the real rod activity; static checks cover every regional recipe and tool.",
    stationKinds: {},
    gateProbes: [],
    recipes: [],
    equipment: [],
    tools: [],
    screenshots: [],
  };
  const screenshots = report.screenshots as string[];
  let stage = "boot";
  const remaining = (limit = 4_000): number => {
    const budget = 56_000 - (Date.now() - startedAt);
    assert(budget > 0, `Regional tier T${tier} exceeded its 56-second operation budget during ${stage}`);
    return Math.max(1, Math.min(limit, budget));
  };

  const tierDef = REGIONAL_CRAFTING_TIERS.find((candidate) => candidate.tier === tier);
  assert(tierDef, `Missing regional tier definition ${tier}`);
  const items = REGIONAL_TIER_ITEMS.filter((item) => item.tier === tier);
  const recipes = REGIONAL_TIER_RECIPES.filter((recipe) => recipe.tier === tier);
  assert.equal(items.length, 22, `T${tier} should expose 22 regional items`);
  assert.equal(recipes.length, 20, `T${tier} should expose 20 regional recipes`);

  try {
    await mkdir(output, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3_000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    await driver.open(remaining(20_000), route);
    const documentId = await page.evaluate(() => performance.timeOrigin);

    stage = "fixture setup";
    const fixture = await page.evaluate(async () => {
      const globals = globalThis as typeof globalThis & Record<string, any>;
      const candidate = globals.__regionalTierFixture;
      if (!candidate || typeof candidate.prepare !== "function") return { hook: null, state: null };
      return { hook: "__regionalTierFixture", state: await candidate.prepare() };
    });
    report.fixture = fixture;

    stage = "content contract";
    const expectedIds = [
      `${tierDef.metal}_sword`, `${tierDef.wood}_shield`, `${tierDef.wood}_wand`, `${tierDef.wood}_staff`,
      `${tierDef.metal}_helm`, `${tierDef.metal}_plate`, `${tierDef.metal}_greaves`, `${tierDef.metal}_boots`, `${tierDef.metal}_gauntlets`,
      `${tierDef.hide}_hood`, `${tierDef.hide}_robe`, `${tierDef.hide}_leggings`, `${tierDef.hide}_boots`, `${tierDef.hide}_wraps`,
      `${tierDef.metal}_pickaxe`, `${tierDef.metal}_hatchet`, `${tierDef.wood}_rod`,
      tierDef.ore, `${tierDef.metal}_bar`, tierDef.hide, tierDef.thread, `${tierDef.wood}_handle`,
    ];
    const itemById = new Map(items.map((item) => [item.id, item]));
    for (const id of expectedIds) assert(itemById.has(id), `T${tier} is missing item ${id}`);
    for (const item of items) {
      if (item.equip) {
        const requirement = Object.values(item.equip.requires)[0];
        assert.equal(requirement, tier, `${item.id} must require regional skill ${tier}`);
      }
      if (item.tool) assert.equal(item.tool.gatherBonus, toolBonus(tier), `${item.id} has the wrong gather bonus`);
    }
    for (const recipe of recipes) {
      assert.equal(recipe.reqLevel, tier, `${recipe.id} has the wrong production gate`);
      assert((recipe.stations?.length ?? 0) > 0, `${recipe.id} must name a production station`);
      assert(recipe.inputs.length > 0, `${recipe.id} must consume an input`);
      assert(recipe.inputs.every((input) => input.quantity > 0), `${recipe.id} has a non-positive input`);
      assert(itemById.has(recipe.output.itemId), `${recipe.id} outputs an unregistered regional item`);
    }

    stage = "station discovery";
    const summaries = await driver.callDebug("getEntities") as EntitySummary[];
    const stationSummaries = summaries.filter((entity) => entity.archetype === "station");
    const stations: StationEntity[] = [];
    for (const summary of stationSummaries) {
      const full = await driver.callDebug("getEntity", [summary.id]) as StationEntity | null;
      if (full?.station?.kind && Array.isArray(full.position)) stations.push(full);
    }
    const stationByKind = new Map<string, StationEntity>();
    for (const station of stations) if (!stationByKind.has(station.station.kind)) stationByKind.set(station.station.kind, station);
    report.stationKinds = Object.fromEntries([...stationByKind].map(([kind, station]) => [kind, {
      id: station.id, name: station.name, recipeCount: station.station.recipeIds.length,
    }]));
    const missingStations = RUNTIME_STATION_KINDS.filter((kind) => !stationByKind.has(kind));
    assert.equal(missingStations.length, 0,
      `Regional production fixture is missing station kind(s): ${missingStations.join(", ")}; available: ${[...stationByKind.keys()].join(", ") || "none"}`);
    for (const recipe of recipes) assert(recipe.stations?.[0], `${recipe.id} must name a station kind`);

    const give = async (itemId: string, quantity: number): Promise<void> => {
      const result = await driver.callDebug("giveItem", [itemId, quantity, "inventory"]);
      const error = resultError(result);
      assert.equal(error, undefined, `Could not seed ${quantity} ${itemId}: ${error ?? "unknown error"}`);
      if (isRecord(result) && result.ok === true && typeof result.value === "number") {
        assert.equal(result.value, quantity, `Could not seed the full ${itemId} quantity`);
      }
    };
    const setLevel = async (skill: string, level: number): Promise<void> => {
      const actual = await driver.callDebug("setSkillLevel", [skill, level]);
      assert.equal(actual, level, `Could not set ${skill} to ${level}`);
    };
    const clearInventory = async (): Promise<void> => { await driver.callDebug("clearInventory"); };
    const moveToStation = async (station: StationEntity): Promise<void> => {
      const target = point(station.interactionPosition ?? station.position, `${station.id} working position`);
      assert.equal(await driver.callDebug("teleport", [target]), true, `Could not teleport to ${station.id}`);
      await driver.wait(50);
      const player = await driver.callDebug("getPlayerPosition") as Point;
      assert(xzDistance(player, target) <= 2.5, `Player is not within production range of ${station.id}`);
    };
    const seedRecipe = async (recipe: RecipeDef): Promise<void> => {
      await clearInventory();
      for (const input of recipe.inputs) await give(input.itemId, input.quantity);
    };
    const readEvents = async (since = 0): Promise<{ events: JsonRecord[]; nextSeq: number }> =>
      await driver.callDebug("getEvents", [since]) as { events: JsonRecord[]; nextSeq: number };
    const readSave = async (): Promise<SaveView> => asSave(await driver.callDebug("getSaveBlob"));
    const readEquipment = async (): Promise<JsonRecord> => {
      const result = await driver.callDebug("callTool", ["corealm_inventory", {}]);
      requireSuccess(result, "corealm_inventory");
      assert(isRecord(result) && isRecord(result.equipment), "corealm_inventory did not return equipment");
      return result.equipment as JsonRecord;
    };
    const waitForProduction = async (since: number, recipe: RecipeDef, stationId: string): Promise<JsonRecord> => {
      await page.waitForFunction(({ cursor, recipeId, station }) => {
        const debug = window.__gameDebug as any;
        const batch = debug.getEvents(cursor);
        return Boolean(batch.dropped) || batch.events.some((event: any) =>
          event.type === "production.completed" && event.entityId === station && event.data?.recipeId === recipeId);
      }, { cursor: since, recipeId: recipe.id, station: stationId }, { timeout: remaining(4_000), polling: 25 });
      const batch = await readEvents(since);
      assert.equal((batch as any).dropped, false, `Event ring dropped ${recipe.id} completion evidence`);
      const completions = batch.events.filter((event) =>
        event.type === "production.completed" && event.entityId === stationId && event.data?.recipeId === recipe.id);
      assert.equal(completions.length, 1, `${recipe.id} should complete exactly once`);
      return completions[0]!;
    };

    stage = "recipe requirement gates";
    const runtimeRecipes = [
      recipes.find((recipe) => recipe.id === `smith_${tierDef.metal}_sword`)
        ?? recipes.find((recipe) => recipe.kind === "smith"),
    ].filter((recipe): recipe is RecipeDef => Boolean(recipe));
    assert.equal(runtimeRecipes.length, 1, `T${tier} needs one smithing recipe for the production shard`);
    const gateRecipes = RUNTIME_STATION_KINDS.map((kind) => runtimeRecipes.find((recipe) => recipe.stations?.includes(kind))!);
    assert(gateRecipes.every(Boolean), "The bounded runtime recipe must use the configured station kind");
    for (const recipe of gateRecipes) {
      const station = stationByKind.get(recipe.stations![0]!)!;
      await moveToStation(station);
      await setLevel(recipe.skill, tier - 1);
      await seedRecipe(recipe);
      const before = await readSave();
      const cursor = (await readEvents()).nextSeq;
      const failed = await driver.callDebug("callTool", ["corealm_produce", {
        recipeId: recipe.id, quantity: 1, stationId: station.id,
      }]);
      assert.equal(resultError(failed), "REQUIREMENTS_NOT_MET", `${recipe.id} must reject skill ${tier - 1}`);
      const after = await readSave();
      assert.deepEqual(equipmentProjection(after, recipe.skill), equipmentProjection(before, recipe.skill), `${recipe.id} changed state while below its gate`);
      const events = await readEvents(cursor);
      assert(!events.events.some((event) => event.type === "production.completed" && event.data?.recipeId === recipe.id), `${recipe.id} completed below its gate`);
      (report.gateProbes as unknown[]).push({ recipeId: recipe.id, stationId: station.id, required: tier, attempted: tier - 1, error: resultError(failed) });
    }

    stage = "recipe production";
    await driver.callDebug("setTimeScale", [100]);
    for (const recipe of runtimeRecipes) {
      const station = stationByKind.get(recipe.stations![0]!)!;
      await moveToStation(station);
      await setLevel(recipe.skill, tier);
      await seedRecipe(recipe);
      const before = await readSave();
      const cursor = (await readEvents()).nextSeq;
      const started = await driver.callDebug("callTool", ["corealm_produce", {
        recipeId: recipe.id, quantity: 1, stationId: station.id,
      }]);
      requireSuccess(started, `corealm_produce ${recipe.id}`);
      const completion = await waitForProduction(cursor, recipe, station.id);
      const after = await readSave();
      for (const input of recipe.inputs) {
        assert.equal(countItem(before, input.itemId) - countItem(after, input.itemId), input.quantity,
          `${recipe.id} did not remove its ${input.itemId} input`);
      }
      assert.equal(countItem(after, recipe.output.itemId) - countItem(before, recipe.output.itemId), recipe.output.quantity,
        `${recipe.id} did not add its output`);
      assert.equal(after.skills[recipe.skill]!.xp - before.skills[recipe.skill]!.xp, recipe.xp,
        `${recipe.id} awarded the wrong XP`);
      (report.recipes as unknown[]).push({
        recipeId: recipe.id, stationId: station.id, inputs: recipe.inputs, output: recipe.output,
        xp: recipe.xp, completion,
      });
    }

    stage = "equipment gates and bonuses";
    const equipItems = [items.find((item) => item.id === `${tierDef.metal}_sword`)]
      .filter((item): item is ItemDef & { equip: NonNullable<ItemDef["equip"]> } => Boolean(item?.equip));
    assert.equal(equipItems.length, 1, `T${tier} needs its melee sword for the bounded equip probe`);
    const clearWorn = async (): Promise<void> => {
      const save = await readSave();
      for (const slot of EQUIPMENT_SLOTS) {
        if (!save.equipment?.[slot]) continue;
        const result = await driver.callDebug("callTool", ["corealm_equip", { unequipSlot: slot }]);
        requireSuccess(result, `unequip ${slot}`);
      }
    };
    const equipCases: unknown[] = report.equipment as unknown[];
    for (const item of equipItems) {
      const requirement = Object.entries(item.equip.requires)[0];
      assert(requirement, `${item.id} has no skill requirement`);
      const [skill, required] = requirement as [SkillId, number];
      await clearWorn();
      await clearInventory();
      await setLevel(skill, required - 1);
      await give(item.id, 1);
      const beforeGate = await readSave();
      const failed = await driver.callDebug("callTool", ["corealm_equip", { itemId: item.id }]);
      assert.equal(resultError(failed), "REQUIREMENTS_NOT_MET", `${item.id} must reject skill ${required - 1}`);
      const afterGate = await readSave();
      assert.deepEqual(equipmentProjection(afterGate, skill), equipmentProjection(beforeGate, skill), `${item.id} changed state below its equip gate`);

      await clearInventory();
      await setLevel(skill, required);
      await give(item.id, 1);
      const beforeEquipment = await readEquipment();
      const beforeTotals = (beforeEquipment.totals ?? {}) as EquipmentBonuses;
      const equipped = await driver.callDebug("callTool", ["corealm_equip", { itemId: item.id }]);
      requireSuccess(equipped, `equip ${item.id}`);
      await driver.wait(80);
      const afterEquipment = await readEquipment();
      const slot = item.equip.slot;
      const worn = (afterEquipment.slots as Record<string, ItemStackView | null>)[slot];
      assert.equal(worn?.itemId, item.id, `${item.id} did not land in ${slot}`);
      if (item.magicWeapon?.hands === 2) {
        assert.equal((afterEquipment.slots as Record<string, ItemStackView | null>).offHand, null,
          `${item.id} must leave the off hand empty`);
      }
      const afterTotals = (afterEquipment.totals ?? {}) as EquipmentBonuses;
      for (const key of BONUS_KEYS) {
        assert.equal((afterTotals[key] ?? 0) - (beforeTotals[key] ?? 0), item.equip.bonuses[key] ?? 0,
          `${item.id} changed ${key} by the wrong amount`);
      }
      equipCases.push({
        itemId: item.id, required: { skill, level: required }, rejected: resultError(failed), slot,
        bonuses: item.equip.bonuses, totalsBefore: beforeTotals, totalsAfter: afterTotals,
      });
    }
    await clearWorn();
    await clearInventory();
    const camera = await driver.callDebug("getCamera") as JsonRecord;
    assert.equal(camera.freeMove, false, "Equipment evidence must use the normal gameplay camera");
    screenshots.push(await driver.screenshot(output, `tier${tier}-equipment`));

    stage = "tool registration and rod activity";
    const expectedTools: { id: string; skill: SkillId }[] = [
      { id: `${tierDef.metal}_pickaxe`, skill: "mining" },
      { id: `${tierDef.metal}_hatchet`, skill: "woodcutting" },
      { id: `${tierDef.wood}_rod`, skill: "fishing" },
    ];
    for (const expected of expectedTools) {
      const item = itemById.get(expected.id);
      assert(item?.tool, `${expected.id} is not registered as a gathering tool`);
      assert.equal(item.tool.skill, expected.skill, `${expected.id} exposes the wrong gathering skill`);
      assert.equal(item.tool.gatherBonus, toolBonus(tier), `${expected.id} exposes the wrong gather bonus`);
    }
    const fishRows = summaries.filter((entity) => entity.tier === tier
      && entity.interactions?.includes("fish") && (entity.archetype === "fishing_spot" || entity.archetype === "resource"));
    assert(fishRows.length > 0, `Crownward fixture has no tier-${tier} fishing node`);
    const fish = await driver.callDebug("getEntity", [fishRows[0]!.id]) as ResourceEntity;
    assert(fish?.resource?.itemId, `Fishing node ${fishRows[0]!.id} has no resource item`);
    await setLevel("fishing", tier);
    await clearInventory();
    await give(`${tierDef.wood}_rod`, 1);
    const fishPosition = point(fish.interactionPosition ?? fish.position, `${fish.id} fishing position`);
    assert.equal(await driver.callDebug("teleport", [fishPosition]), true, `Could not teleport to ${fish.id}`);
    await driver.callDebug("setTimeScale", [1]);
    const startedFishing = await driver.callDebug("callTool", ["corealm_interact", { entityId: fish.id, interaction: "fish" }]);
    requireSuccess(startedFishing, `fish ${fish.id}`);
    await page.waitForFunction((rodId) => {
      const debug = window.__gameDebug as any;
      const activity = debug.getCurrentActivity();
      const motion = debug.getPlayerMotion() ?? {};
      return activity?.kind === "gathering" && activity?.skill === "fishing"
        && String(motion.activityMainHandKey ?? "").startsWith(`${rodId}:`)
        && (String(motion.attachments?.mainHand ?? "").includes(`proc_rod_${rodId.replace(/_rod$/, "")}`)
          || String(motion.attachments?.mainHand ?? "").endsWith(`corealm_item_${rodId}`));
    }, `${tierDef.wood}_rod`, { timeout: remaining(2_500), polling: 40 });
    const rodMotion = await driver.callDebug("getPlayerMotion") as MotionView;
    assert.equal(rodMotion.activityMainHandKey?.startsWith(`${tierDef.wood}_rod:`), true);
    const rodBefore = await readSave();
    screenshots.push(await driver.screenshot(output, `tier${tier}-rod`));
    const fishCursor = (await readEvents()).nextSeq;
    await driver.callDebug("setTimeScale", [100]);
    await page.waitForFunction(({ cursor, fishId }) => {
      const debug = window.__gameDebug as any;
      const batch = debug.getEvents(cursor);
      return Boolean(batch.dropped) || batch.events.some((event: any) =>
        event.type === "item.received" && event.data?.itemId === fishId);
    }, { cursor: fishCursor, fishId: fish.resource.itemId }, { timeout: remaining(3_000), polling: 25 });
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    const rodAfter = await readSave();
    const caught = countItem(rodAfter, fish.resource.itemId) - countItem(rodBefore, fish.resource.itemId);
    assert(caught >= 1,
      `Fishing with ${tierDef.wood}_rod did not add ${fish.resource.itemId}`);
    const depletedFish = await driver.callDebug('getEntity', [fish.id]) as ResourceEntity;
    assert(depletedFish.resource!.remaining < fish.resource.remaining, 'Successful fishing must deplete the school');
    (report.tools as unknown[]).push({
      static: expectedTools.map((entry) => ({ ...entry, gatherBonus: toolBonus(tier) })),
      fishing: { nodeId: fish.id, itemId: fish.resource.itemId, rodId: `${tierDef.wood}_rod`, motion: rodMotion },
    });

    assert.equal(await page.evaluate(() => performance.timeOrigin), documentId, "The document reloaded during acceptance");
    assert.deepEqual(await driver.callDebug("getErrors"), [], "The game recorded runtime errors");
    assert.deepEqual(driver.consoleErrors, [], "The page logged console errors");
    assert.deepEqual(driver.pageErrors, [], "The page raised errors");
    assert.deepEqual(driver.requestErrors, [], "The page had failed requests");
    report.passed = true;
  } catch (error) {
    report.stage = stage;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page && Date.now() - startedAt < 54_000) {
      try { screenshots.push(await driver.screenshot(output, "failure")); } catch { /* Preserve the original failure. */ }
    }
  } finally {
    report.stage = stage;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    report.elapsedMs = Date.now() - startedAt;
    try {
      await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ passed: report.passed, tier, elapsedMs: report.elapsedMs, report: path.join(output, "report.json"), error: report.error }));
    } finally {
      await driver.close();
      await server.close();
      clearDeadline();
    }
  }
}

await main();
