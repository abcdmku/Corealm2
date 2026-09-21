import path from "node:path";
import { GameDriver } from "./lib/driver.js";
import { prepareRun } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

interface EntityView {
  id: string;
  state: string;
  position: [number, number, number];
  resource?: { remaining: number; maxYields?: number; respawnSeconds?: number };
  combat?: { health: number; maxHealth: number };
  view?: { assetId?: string };
}

interface SpellbookView {
  spells?: Array<{ id: string; maxHit: number; castMs: number }>;
  equippedWeapon?: { itemId: string; charges: number; capacity: number } | null;
}

interface ItemStackView {
  itemId: string;
  quantity: number;
}

interface InventoryView {
  slots?: Array<ItemStackView | null>;
  equipment?: { slots?: Record<string, ItemStackView | null> };
}

interface EventView {
  type: string;
  atMs: number;
  entityId?: string;
  data: Record<string, unknown>;
}

interface EventBatch {
  events: EventView[];
  nextSeq: number;
}

interface ClockView {
  elapsedMs: number;
  tick: number;
  paused: boolean;
  timeScale: number;
}

interface StateView {
  seed?: number;
  clock: ClockView;
}

const BOSS_ORB_CASES = [
  { bossId: "tempest_roc", bossName: "Tempest Roc", orbId: "air_orb", orbName: "Air Orb" },
  { bossId: "rootheart", bossName: "The Rootheart", orbId: "earth_orb", orbName: "Earth Orb" },
  { bossId: "ordrun", bossName: "Ordrun", orbId: "water_orb", orbName: "Water Orb" },
] as const;

const runDir = await prepareRun("runs/corealm");
const screenshotDir = path.join(runDir, "screenshots");
const server = await startGameServer();
const hardware = process.argv.includes("--hardware");
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: hardware
    ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio"]
    : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
  settings: {
    renderScale: 0.7,
    shadowQuality: "off",
    drawDistance: "near",
    damageNumbers: true,
    invertCameraY: false,
    uiScale: "normal",
    music: 0,
    ambient: 0,
    sfx: 0,
  },
});

const failures: string[] = [];
const evidence: string[] = [];
const capture = !process.argv.includes("--semantic-only");
const call = (method: string, args: unknown[] = []): Promise<unknown> => driver.callDebug(method, args);
const tool = (name: string, args: unknown): Promise<unknown> => call("callTool", [name, args]);

function itemCount(view: InventoryView, itemId: string): number {
  return (view.slots ?? []).filter(
    (slot): slot is ItemStackView => slot?.itemId === itemId,
  ).reduce((sum, slot) => sum + slot.quantity, 0);
}

function physicalItemCount(view: InventoryView, itemId: string): number {
  const carried = itemCount(view, itemId);
  const equipped = Object.values(view.equipment?.slots ?? {})
    .filter((slot): slot is ItemStackView => slot?.itemId === itemId)
    .reduce((sum, slot) => sum + slot.quantity, 0);
  return carried + equipped;
}

function toolError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as Record<string, unknown>)["error"];
  return typeof error === "string" ? error : null;
}

function itemsFromEvent(event: EventView | undefined): ItemStackView[] {
  const rows = event?.data["items"];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    return typeof record["itemId"] === "string" && typeof record["quantity"] === "number"
      ? [{ itemId: record["itemId"], quantity: record["quantity"] }]
      : [];
  });
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function getEvents(sinceSeq = 0): Promise<EventBatch> {
  return call("getEvents", [sinceSeq]) as Promise<EventBatch>;
}

async function getState(): Promise<StateView> {
  return call("getState") as Promise<StateView>;
}

async function waitForEntity(
  entityId: string,
  mode: "available" | "depleted" | "dead" | "not-dead",
  pauseOnMatch = true,
  timeoutMs = 45_000,
): Promise<{ entity: EntityView | null; clock: ClockView }> {
  return driver.page!.evaluate(async ({ id, wanted, pause, timeout }) => {
    const debug = window.__gameDebug as unknown as {
      getEntity(entityId: string): EntityView | null;
      getState(): StateView;
      setPaused(paused: boolean): void;
    };
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const entity = await debug.getEntity(id);
      const matched = wanted === "not-dead" ? entity !== null && entity.state !== "dead" : entity?.state === wanted;
      if (matched) {
        if (pause) await debug.setPaused(true);
        return { entity, clock: debug.getState().clock };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (pause) await debug.setPaused(true);
    return { entity: await debug.getEntity(id), clock: debug.getState().clock };
  }, { id: entityId, wanted: mode, pause: pauseOnMatch, timeout: timeoutMs });
}

async function waitForBossKill(
  bossId: string,
  sinceSeq: number,
  timeoutMs = 60_000,
): Promise<{ event: EventView | null; entity: EntityView | null; clock: ClockView }> {
  return driver.page!.evaluate(async ({ id, cursor, timeout }) => {
    const debug = window.__gameDebug as unknown as {
      getEntity(entityId: string): EntityView | null;
      getEvents(sinceSeq?: number): EventBatch;
      getState(): StateView;
      setPaused(paused: boolean): void;
    };
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const event = debug.getEvents(cursor).events.find((candidate) => candidate.type === "combat.ended"
        && candidate.entityId === id && candidate.data["reason"] === "killed");
      if (event) {
        await debug.setPaused(true);
        return { event, entity: await debug.getEntity(id), clock: debug.getState().clock };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await debug.setPaused(true);
    return { event: null, entity: await debug.getEntity(id), clock: debug.getState().clock };
  }, { id: bossId, cursor: sinceSeq, timeout: timeoutMs });
}

async function closePlayerShot(name: string): Promise<void> {
  await call("focusCamera", ["spawn"]);
  await driver.wait(500);
  await driver.page?.mouse.wheel(0, -2_400);
  await driver.wait(1_000);
  await driver.screenshot(screenshotDir, name);
}

async function killBoss(bossId: string): Promise<{
  attack: unknown;
  killed: boolean;
  clock: ClockView;
  pileId: string | null;
  drops: ItemStackView[];
}> {
  await call("setPaused", [true]);
  await call("teleport", [{ entityId: bossId }]);
  const cursor = (await getEvents()).nextSeq;
  const attack = await tool("corealm_attack", { entityId: bossId });
  // SwiftShader can render below one frame per second. Wait on the durable combat event instead of
  // a one-frame dead-state snapshot, and give the deliberately long Ordrun fight enough wall time.
  // Raising the scale above 25 makes each software-rendered frame process too many world ticks and
  // is slower in practice.
  await call("setTimeScale", [25]);
  await call("setPaused", [false]);
  const observed = await waitForBossKill(bossId, cursor, bossId === "ordrun" ? 180_000 : 60_000);
  await call("setTimeScale", [1]);

  const batch = await getEvents(cursor);
  const ended = observed.event ?? batch.events.find((event) => event.type === "combat.ended"
    && event.entityId === bossId && event.data["reason"] === "killed");
  const loot = batch.events.find((event) => event.type === "item.received"
    && Array.isArray(event.data["items"])
    && (String(event.data["pileId"] ?? "").includes(bossId) || event.entityId?.includes(bossId)));
  const pileId = typeof loot?.data["pileId"] === "string"
    ? loot.data["pileId"]
    : loot?.entityId ?? null;
  return {
    attack,
    killed: ended !== undefined,
    clock: observed.clock,
    pileId,
    drops: itemsFromEvent(loot),
  };
}

try {
  await driver.launch();
  await driver.open(240_000);

  if (capture) await closePlayerShot("magic-01-starter-wand");

  // ------------------------------------------------------------- cache structure

  const oreNodes = await call("listEntities", [{ archetype: "ore" }]) as EntityView[];
  for (const [prefix, element, heroAsset] of [
    ["fallowmarch_air_essence_cache", "wind", "rocks_free_essence_cache"],
    ["vellenwood_earth_essence_cache", "earth", "rocks_free_essence_cache"],
    ["karrowmoor_water_essence_cache", "water", "rocks_free_essence_cache"],
  ] as const) {
    const cache = oreNodes.filter((node) => node.id.startsWith(prefix));
    if (cache.length !== 5) failures.push(`${prefix}: ${cache.length} nodes, expected 5`);
    for (const node of cache) {
      const remaining = node.resource?.remaining ?? -1;
      if (remaining < 40 || remaining > 90) failures.push(`${node.id}: capacity ${remaining}, expected 40-90`);
    }
    const hero = cache.find((node) => node.id === `${prefix}_1`);
    if (hero?.view?.assetId !== heroAsset) failures.push(`${prefix}: centre does not use ${heroAsset}`);
    if (cache.filter((node) => node.view?.assetId === "rocks_free_essence_node").length !== 4) {
      failures.push(`${prefix}: expected four DEXSOFT satellite nodes`);
    }
    evidence.push(`${element}: five nodes, capacities ${cache.map((node) => node.resource?.remaining).join("/")}`);
  }

  if (capture) {
    await call("focusLocation", ["fallowmarch_air_cache"]);
    await driver.wait(1_500);
    await driver.screenshot(screenshotDir, "magic-04-air-cache-five-nodes");
    await call("focusEntity", ["fallowmarch_air_essence_cache_1"]);
    await driver.wait(1_000);
    await driver.screenshot(screenshotDir, "magic-05-air-cache-glowing-veins");
  }

  // ------------------------------------------- mine every authored yield and time exact respawn

  const nodeId = "fallowmarch_air_essence_cache_1";
  const initialNode = await call("getEntity", [nodeId]) as EntityView;
  const initialCapacity = initialNode.resource?.remaining ?? 0;
  const inventoryBeforeMining = await tool("corealm_inventory", {}) as InventoryView;
  const essenceBeforeMining = itemCount(inventoryBeforeMining, "air_essence");
  await call("setSkillLevel", ["mining", 99]);
  await call("teleport", [{ entityId: nodeId }]);
  const miningCursor = (await getEvents()).nextSeq;
  const miningStart = await tool("corealm_interact", { entityId: nodeId, interaction: "mine" });
  if (toolError(miningStart)) failures.push(`real mining command rejected: ${JSON.stringify(miningStart)}`);

  // Gathering catches up every due 1.8 s roll in the real activity driver. At Mining 99 the
  // success chance is 95%; 600 deterministic sim seconds comfortably exhausts the largest cache.
  await call("advanceGameTime", [600]);
  const mined = await waitForEntity(nodeId, "depleted", true, 45_000);
  const inventoryAfterMining = await tool("corealm_inventory", {}) as InventoryView;
  const miningEvents = await getEvents(miningCursor);
  const successfulRolls = miningEvents.events.filter((event) => event.type === "item.received"
    && event.entityId === nodeId && event.data["source"] === "gather");
  const eventYield = successfulRolls.reduce((sum, event) => sum + (numberField(event.data, "quantity") ?? 0), 0);
  const inventoryYield = itemCount(inventoryAfterMining, "air_essence") - essenceBeforeMining;
  const depletion = miningEvents.events.find((event) => event.type === "resource.depleted" && event.entityId === nodeId);
  const respawnAtMs = numberField(depletion?.data, "respawnAtMs");

  if (initialCapacity < 40 || initialCapacity > 90) failures.push(`mined capacity ${initialCapacity}, expected 40-90`);
  if (mined.entity?.state !== "depleted" || mined.entity.resource?.remaining !== 0) {
    failures.push(`node did not deplete through mining: ${JSON.stringify(mined.entity)}`);
  }
  if (eventYield !== initialCapacity || inventoryYield !== initialCapacity || successfulRolls.length !== initialCapacity) {
    failures.push(`mining yield mismatch: capacity=${initialCapacity}, successful events=${successfulRolls.length}, event quantity=${eventYield}, inventory delta=${inventoryYield}`);
  }
  if (!successfulRolls.every((event) => event.data["quantity"] === 1)) {
    failures.push("an essence mining success yielded something other than exactly one essence");
  }
  if (!depletion || respawnAtMs === null || respawnAtMs - depletion.atMs !== 30_000
    || depletion.data["respawnSeconds"] !== 30) {
    failures.push(`depletion timer was not exactly 30 seconds: ${JSON.stringify(depletion)}`);
  }

  if (capture) await driver.screenshot(screenshotDir, "magic-06-air-cache-depleted");

  let preBoundaryClock = mined.clock.elapsedMs;
  let respawnClock = mined.clock.elapsedMs;
  let respawned = mined.entity;
  if (respawnAtMs !== null) {
    const targetBeforeBoundary = respawnAtMs - 100;
    const remainingToTarget = targetBeforeBoundary - mined.clock.elapsedMs;
    if (remainingToTarget < 0) {
      failures.push(`missed the respawn pre-boundary sample by ${-remainingToTarget} ms`);
    } else if (remainingToTarget > 0) {
      await call("advanceGameTime", [remainingToTarget / 1000]);
    }
    const preBoundary = await call("getEntity", [nodeId]) as EntityView;
    preBoundaryClock = (await getState()).clock.elapsedMs;
    if (preBoundary.state !== "depleted" || preBoundary.resource?.remaining !== 0
      || preBoundaryClock >= respawnAtMs || respawnAtMs - preBoundaryClock > 101) {
      failures.push(`node respawned before the 30-second boundary: ${JSON.stringify({ preBoundaryClock, respawnAtMs, preBoundary })}`);
    }

    await call("setTimeScale", [0.1]);
    await call("setPaused", [false]);
    const returned = await waitForEntity(nodeId, "available", true, 30_000);
    respawned = returned.entity;
    respawnClock = returned.clock.elapsedMs;
    if (respawned?.state !== "available" || (respawned.resource?.remaining ?? 0) < 40
      || (respawned.resource?.remaining ?? 0) > 90
      || respawnClock < respawnAtMs || respawnClock > respawnAtMs + 800) {
      failures.push(`node did not return on the 30-second boundary: ${JSON.stringify({ respawnClock, respawnAtMs, respawned })}`);
    }
  }
  evidence.push(`air centre: ${initialCapacity} successful one-essence rolls; depleted at ${depletion?.atMs}, still empty at ${preBoundaryClock}, available at ${respawnClock} with ${respawned?.resource?.remaining}`);
  console.log("accept-magic-world: caches and depletion passed");

  // ---------------------------------------------------- real boss acquisition and suppression

  await call("setTimeScale", [1]);
  await call("setPaused", [false]);
  await call("setSkillLevel", ["melee", 99]);
  // Raising the real skill once lets the same run use every released wood and elemental weapon.
  await call("setSkillLevel", ["magic", 99]);
  const bossKit = [
    "kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves",
    "kaldite_boots", "kaldite_gauntlets", "kaldite_ring", "kaldite_pendant",
  ] as const;
  for (const itemId of bossKit) {
    await call("giveItem", [itemId, 1, "inventory"]);
    const equipped = await tool("corealm_equip", { itemId });
    if (toolError(equipped)) failures.push(`${itemId} boss-kit setup failed: ${JSON.stringify(equipped)}`);
  }
  await driver.wait(250);
  const preparedPlayer = await tool("corealm_player", {}) as { maxHealth?: number };
  await call("setHealth", [preparedPlayer.maxHealth ?? 999]);

  const acquiredOrbs = new Set<string>();
  for (const boss of BOSS_ORB_CASES) {
    await call("setHealth", [preparedPlayer.maxHealth ?? 999]);
    const inventoryBeforeBoss = await tool("corealm_inventory", {}) as InventoryView;
    if (physicalItemCount(inventoryBeforeBoss, boss.orbId) !== 0) {
      failures.push(`${boss.orbName} existed before the first ${boss.bossName} kill`);
    }

    const firstBoss = await killBoss(boss.bossId);
    console.log(`accept-magic-world: ${boss.bossName} first kill ${firstBoss.killed ? "passed" : "timed out"}`);
    const firstOrbDrop = firstBoss.drops.filter((drop) => drop.itemId === boss.orbId);
    const firstBossPassed = !toolError(firstBoss.attack) && firstBoss.killed && firstOrbDrop.length === 1
      && firstOrbDrop[0]?.quantity === 1 && Boolean(firstBoss.pileId);
    if (!firstBossPassed) {
      failures.push(`first ${boss.bossName} kill/drop mismatch: ${JSON.stringify(firstBoss)}`);
      // Never let a timed-out auto-attack continue through the 181-second respawn jump below. That
      // would finish the first fight off-screen and contaminate the repeat-drop assertion.
      await tool("corealm_stop", {});
      continue;
    }

    if (firstBoss.pileId) {
      if (capture && boss.bossId === "tempest_roc") {
        await call("focusEntity", [firstBoss.pileId]);
        await driver.wait(750);
        await driver.screenshot(screenshotDir, "magic-08-air-orb-boss-drop");
      }
      await call("teleport", [{ entityId: firstBoss.pileId }]);
      const openResult = await tool("corealm_interact", { entityId: firstBoss.pileId, interaction: "loot" });
      if (toolError(openResult)) failures.push(`${boss.bossName} loot open rejected: ${JSON.stringify(openResult)}`);
      const lootResult = await tool("corealm_take_loot", { entityId: firstBoss.pileId });
      if (toolError(lootResult)) failures.push(`${boss.bossName} loot take rejected: ${JSON.stringify(lootResult)}`);
      const afterLoot = await tool("corealm_inventory", {}) as InventoryView;
      if (itemCount(afterLoot, boss.orbId) !== 1) {
        failures.push(`first ${boss.bossName} loot did not put exactly one ${boss.orbName} in inventory`);
      }
      const acquired = itemCount(afterLoot, boss.orbId) === 1;
      if (acquired) acquiredOrbs.add(boss.orbId);
      else failures.push(`${boss.bossName} reward did not remain as one altar key`);
    }

    // Use the boss's real 180-second AI respawn timer. No force-respawn debug path participates.
    await call("advanceGameTime", [181]);
    await call("setTimeScale", [0.1]);
    await call("setPaused", [false]);
    const bossReturned = await waitForEntity(boss.bossId, "not-dead", true, 30_000);
    if (!bossReturned.entity || bossReturned.entity.state === "dead") {
      failures.push(`${boss.bossName} did not naturally respawn for the repeat-kill check`);
    }
    await call("setHealth", [preparedPlayer.maxHealth ?? 999]);
    const secondBoss = await killBoss(boss.bossId);
    console.log(`accept-magic-world: ${boss.bossName} repeat kill ${secondBoss.killed ? "passed" : "timed out"}`);
    const duplicateDrops = secondBoss.drops.filter((drop) => drop.itemId === boss.orbId);
    const afterSecondKill = await tool("corealm_inventory", {}) as InventoryView;
    const physicalOrbs = physicalItemCount(afterSecondKill, boss.orbId);
    if (!secondBoss.killed || duplicateDrops.length !== 0 || physicalOrbs !== 1) {
      failures.push(`repeat ${boss.bossName} kill did not suppress duplicate ${boss.orbName}: ${JSON.stringify({ secondBoss, physicalOrbs })}`);
      if (!secondBoss.killed) await tool("corealm_stop", {});
    }
    evidence.push(`${boss.bossName}: first drop ${firstOrbDrop.map((row) => `${row.quantity} ${row.itemId}`).join(", ")}; repeat drop omitted ${boss.orbName} while one altar key remained`);
  }

  // ---------------------------------------- real crafting, launch spend, save, and browser reload

  let bossPathReady = BOSS_ORB_CASES.every((boss) => acquiredOrbs.has(boss.orbId));

  if (bossPathReady) {
    // Six boss kills can legitimately fill all 28 slots. Bank the loot through the public tool,
    // then withdraw only what the remaining acceptance path needs. This also leaves enough room
    // to unequip the shield for a two-handed staff, awaken the altar, and craft there.
    await call("teleport", [{ entityId: "coldbrace_bank" }]);
    const bankLoot = await tool("corealm_bank", { op: "depositAll" });
    const withdrawWand = await tool("corealm_bank", {
      op: "withdraw", itemId: "basic_wooden_wand", quantity: 1,
    });
    const withdrawMinedAir = await tool("corealm_bank", {
      op: "withdraw", itemId: "air_essence", quantity: initialCapacity,
    });
    const withdrawAirOrb = await tool("corealm_bank", {
      op: "withdraw", itemId: "air_orb", quantity: 1,
    });
    if (toolError(bankLoot) || toolError(withdrawWand) || toolError(withdrawMinedAir)
      || toolError(withdrawAirOrb)) {
      failures.push(`boss-loot banking setup failed: ${JSON.stringify({
        bankLoot, withdrawWand, withdrawMinedAir, withdrawAirOrb,
      })}`);
    }

    let beforeWand = await tool("corealm_inventory", {}) as InventoryView;
    if (itemCount(beforeWand, "basic_wooden_wand") < 1) {
      await call("giveItem", ["basic_wooden_wand", 1, "inventory"]);
      beforeWand = await tool("corealm_inventory", {}) as InventoryView;
    }
    const wandEquip = await tool("corealm_equip", { itemId: "basic_wooden_wand" });
    if (toolError(wandEquip) || itemCount(beforeWand, "basic_wooden_wand") < 1) {
      failures.push(`wand setup for real cast failed: ${JSON.stringify(wandEquip)}`);
    }

    const wandBook = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
    const wandVoltrend = wandBook.spells?.find((spell) => spell.id === "voltrend");
    let beforeStaff = await tool("corealm_inventory", {}) as InventoryView;
    if (itemCount(beforeStaff, "basic_wooden_staff") < 1) {
      await call("giveItem", ["basic_wooden_staff", 1, "inventory"]);
      beforeStaff = await tool("corealm_inventory", {}) as InventoryView;
    }
    const unequipShield = await tool("corealm_equip", { unequipSlot: "offHand" });
    const staffEquip = await tool("corealm_equip", { itemId: "basic_wooden_staff" });
    const staffBook = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
    const staffVoltrend = staffBook.spells?.find((spell) => spell.id === "voltrend");
    if (toolError(unequipShield) || toolError(staffEquip) || itemCount(beforeStaff, "basic_wooden_staff") < 1
      || !wandVoltrend || !staffVoltrend || wandVoltrend.castMs !== 2_200
      || staffVoltrend.castMs !== 3_000 || wandVoltrend.maxHit >= staffVoltrend.maxHit) {
      failures.push(`wand/staff live power-cadence mismatch: ${JSON.stringify({
        unequipShield, staffEquip, wandVoltrend, staffVoltrend,
      })}`);
    } else {
      evidence.push(`Basic Wand vs Staff: live Voltrend max hit ${wandVoltrend.maxHit} < ${staffVoltrend.maxHit}, cadence ${wandVoltrend.castMs} ms < ${staffVoltrend.castMs} ms`);
    }
    const restoreWand = await tool("corealm_equip", { itemId: "basic_wooden_wand" });
    if (toolError(restoreWand)) failures.push(`could not restore wand after the staff comparison: ${JSON.stringify(restoreWand)}`);

    await call("teleport", [{ entityId: "fallowmarch_air_altar" }]);
    const awakenCursor = (await getEvents()).nextSeq;
    const awaken = await tool("corealm_interact", {
      entityId: "fallowmarch_air_altar",
      interaction: "awaken",
    });
    await driver.wait(150);
    const afterAwakenInventory = await tool("corealm_inventory", {}) as InventoryView;
    const awakenedEntities = await call("listEntities", [{ archetype: "station", regionId: "fallowmarch" }]) as EntityView[];
    const awakenEvents = await getEvents(awakenCursor);
    const awakenEvent = awakenEvents.events.find((event) => event.type === "essence.altarAwakened");
    const awakenedAltar = awakenedEntities.find((entity) => entity.id === "fallowmarch_air_altar");
    if (toolError(awaken) || itemCount(afterAwakenInventory, "air_orb") !== 0
      || awakenEvent?.data["orbItemId"] !== "air_orb" || awakenedAltar?.state !== "awakened") {
      failures.push(`Air Altar awakening did not consume one Air Orb and persist semantic state: ${JSON.stringify({
        awaken, awakenEvent, awakenedAltar,
      })}`);
    } else {
      evidence.push("Air Orb: consumed once to awaken the Air Essence Altar at its cache");
    }

    await call("giveItem", ["palewood_wand", 1, "inventory"]);
    const craft = await tool("corealm_produce", { recipeId: "craft_air_wand", quantity: 1 });
    await call("setTimeScale", [10]);
    await call("setPaused", [false]);
    await driver.wait(1_500);
    await call("setPaused", [true]);
    await call("setTimeScale", [1]);
    const afterCraft = await tool("corealm_inventory", {}) as InventoryView;
    if (toolError(craft) || itemCount(afterCraft, "air_wand") !== 1
      || itemCount(afterCraft, "air_orb") !== 0 || itemCount(afterCraft, "palewood_wand") !== 0) {
      failures.push(`Awakened Air Altar did not turn one Palewood Wand into one Air Wand: ${JSON.stringify({ craft, afterCraft })}`);
    }
    const equipAirWand = await tool("corealm_equip", { itemId: "air_wand" });
    const craftedBook = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
    if (toolError(equipAirWand) || craftedBook.equippedWeapon?.itemId !== "air_wand"
      || craftedBook.equippedWeapon.charges !== 1_000 || craftedBook.equippedWeapon.capacity !== 1_000) {
      failures.push(`crafted Air Wand did not equip at 1000/1000: ${JSON.stringify({ equipAirWand, weapon: craftedBook.equippedWeapon })}`);
    } else {
      evidence.push("Awakened Air Altar + Palewood Wand: crafted and equipped Air Wand at 1000/1000");
    }

    const enemies = await call("listEntities", [{ archetype: "enemy", regionId: "fallowmarch" }]) as EntityView[];
    const victim = enemies.find((entity) => entity.state !== "dead");
    if (!victim) {
      failures.push("no live Fallowmarch enemy was available for the spell launch proof");
    } else {
      await call("teleport", [[victim.position[0] - 4, victim.position[1], victim.position[2]]]);
      await call("setPaused", [true]);
      const beforeCast = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
      const castCursor = (await getEvents()).nextSeq;
      const cast = await tool("corealm_attack", { entityId: victim.id, spellId: "voltrend" });
      await call("setTimeScale", [1]);
      await call("setPaused", [false]);
      const launch = await driver.page!.evaluate(async ({ cursor, targetId }) => {
        const debug = window.__gameDebug as unknown as {
          getEvents(sinceSeq: number): EventBatch;
          callTool(name: string, args: unknown): Promise<unknown>;
          setPaused(paused: boolean): void;
        };
        let next = cursor;
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const batch = debug.getEvents(next);
          next = batch.nextSeq;
          const found = batch.events.find((event) => event.type === "spell.launched"
            && event.entityId === targetId && event.data["spellId"] === "voltrend");
          if (found) {
            await debug.callTool("corealm_stop", {});
            await debug.setPaused(true);
            return found;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await debug.setPaused(true);
        return null;
      }, { cursor: castCursor, targetId: victim.id }) as EventView | null;
      const afterCast = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
      if (toolError(cast) || !launch || beforeCast.equippedWeapon?.charges !== 1000
        || launch.data["fuelSource"] !== "weapon" || launch.data["weaponItemId"] !== "air_wand"
        || launch.data["remainingCharges"] !== 999 || afterCast.equippedWeapon?.charges !== 999) {
        failures.push(`real cast charge mismatch: ${JSON.stringify({ cast, launch, before: beforeCast.equippedWeapon, after: afterCast.equippedWeapon })}`);
      }

      await call("saveNow");
      const savedBlob = JSON.parse(await call("getSaveBlob") as string) as {
        magic?: { weaponCharges?: Record<string, number> };
      };
      if (savedBlob.magic?.weaponCharges?.["air_wand"] !== 999) {
        failures.push(`saved blob lost Air Wand charge: ${JSON.stringify(savedBlob.magic)}`);
      }

      await driver.page!.reload({ waitUntil: "load", timeout: 120_000 });
      await driver.page!.waitForFunction(
        () => window.__gameDebug?.getState().ready === true,
        undefined,
        { timeout: 120_000 },
      );
      await driver.wait(150);
      const afterReload = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
      if (afterReload.equippedWeapon?.itemId !== "air_wand" || afterReload.equippedWeapon.charges !== 999) {
        failures.push(`Air Wand charge did not survive save/reload: ${JSON.stringify(afterReload.equippedWeapon)}`);
      }
      evidence.push(`Air Wand: 1000 -> ${launch?.data["remainingCharges"]} on spell.launched; save blob and full page reload both retained ${afterReload.equippedWeapon?.charges}`);

      // --------------------------- altar rejections, exact payment, immediate save, full refusal

      await call("teleport", [{ entityId: "fallowmarch_air_altar" }]);
      const inventoryWithMinedAir = await tool("corealm_inventory", {}) as InventoryView;
      const minedAir = itemCount(inventoryWithMinedAir, "air_essence");
      const insufficient = await tool("corealm_interact", {
        entityId: "fallowmarch_air_altar",
        interaction: "recharge",
      });
      const afterInsufficient = await tool("corealm_inventory", {}) as InventoryView;
      const afterInsufficientBook = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
      if (minedAir >= 100 || toolError(insufficient) !== "NOT_ENOUGH_ITEMS"
        || itemCount(afterInsufficient, "air_essence") !== minedAir
        || afterInsufficientBook.equippedWeapon?.charges !== 999) {
        failures.push(`insufficient-essence altar rejection was not atomic: ${JSON.stringify({
          minedAir, insufficient, weapon: afterInsufficientBook.equippedWeapon,
        })}`);
      }

      await call("giveItem", ["earth_essence", 100, "inventory"]);
      const beforeWrongEssence = await tool("corealm_inventory", {}) as InventoryView;
      const wrongEssence = await tool("corealm_interact", {
        entityId: "fallowmarch_air_altar",
        interaction: "recharge",
      });
      const afterWrongEssence = await tool("corealm_inventory", {}) as InventoryView;
      if (toolError(wrongEssence) !== "NOT_ENOUGH_ITEMS"
        || itemCount(afterWrongEssence, "air_essence") !== minedAir
        || itemCount(afterWrongEssence, "earth_essence") !== itemCount(beforeWrongEssence, "earth_essence")) {
        failures.push(`wrong-element essence changed altar state: ${JSON.stringify(wrongEssence)}`);
      }

      const equipPlainWand = await tool("corealm_equip", { itemId: "basic_wooden_wand" });
      const plainWeapon = await tool("corealm_interact", {
        entityId: "fallowmarch_air_altar",
        interaction: "recharge",
      });
      const restoreAirWand = await tool("corealm_equip", { itemId: "air_wand" });
      if (toolError(equipPlainWand) || toolError(plainWeapon) !== "REQUIREMENTS_NOT_MET"
        || toolError(restoreAirWand)) {
        failures.push(`plain-weapon altar rejection or charged-weapon restore failed: ${JSON.stringify({ equipPlainWand, plainWeapon, restoreAirWand })}`);
      }

      if (minedAir < 100) await call("giveItem", ["air_essence", 100 - minedAir, "inventory"]);
      const rechargeCursor = (await getEvents()).nextSeq;
      const beforeRechargeInventory = await tool("corealm_inventory", {}) as InventoryView;
      const recharge = await tool("corealm_interact", {
        entityId: "fallowmarch_air_altar",
        interaction: "recharge",
      });
      await driver.wait(150);
      const afterRecharge = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
      const afterRechargeInventory = await tool("corealm_inventory", {}) as InventoryView;
      const essenceBefore = itemCount(beforeRechargeInventory, "air_essence");
      const essenceAfter = itemCount(afterRechargeInventory, "air_essence");
      const rechargeEvents = await getEvents(rechargeCursor);
      const rechargeEvent = rechargeEvents.events.find((event) => event.type === "essence.recharged");
      if (toolError(recharge) || afterRecharge.equippedWeapon?.charges !== 1000
        || essenceBefore - essenceAfter !== 100 || rechargeEvent?.data["essenceSpent"] !== 100
        || rechargeEvent.data["before"] !== 999 || rechargeEvent.data["after"] !== 1000) {
        failures.push(`recharge mismatch: ${JSON.stringify({ recharge, essenceBefore, essenceAfter, weapon: afterRecharge.equippedWeapon, rechargeEvent })}`);
      }

      const immediatelySaved = JSON.parse(await call("getSaveBlob") as string) as {
        magic?: { weaponCharges?: Record<string, number> };
      };
      if (immediatelySaved.magic?.weaponCharges?.["air_wand"] !== 1000) {
        failures.push(`altar event did not immediately persist the refill: ${JSON.stringify(immediatelySaved.magic)}`);
      }

      await driver.page!.reload({ waitUntil: "load", timeout: 120_000 });
      await driver.page!.waitForFunction(
        () => window.__gameDebug?.getState().ready === true,
        undefined,
        { timeout: 120_000 },
      );
      const afterRechargeReload = await tool("corealm_spellbook", { op: "read" }) as SpellbookView;
      const inventoryAfterRechargeReload = await tool("corealm_inventory", {}) as InventoryView;
      if (afterRechargeReload.equippedWeapon?.itemId !== "air_wand"
        || afterRechargeReload.equippedWeapon.charges !== 1000
        || itemCount(inventoryAfterRechargeReload, "air_essence") !== essenceAfter) {
        failures.push(`recharge payment did not survive immediate reload: ${JSON.stringify({
          weapon: afterRechargeReload.equippedWeapon,
          expectedEssence: essenceAfter,
          actualEssence: itemCount(inventoryAfterRechargeReload, "air_essence"),
        })}`);
      }

      const fullRetry = await tool("corealm_interact", {
        entityId: "fallowmarch_air_altar",
        interaction: "recharge",
      });
      const afterRetryInventory = await tool("corealm_inventory", {}) as InventoryView;
      if (toolError(fullRetry) !== "UNAVAILABLE" || itemCount(afterRetryInventory, "air_essence") !== essenceAfter) {
        failures.push(`full-weapon retry was not atomic: ${JSON.stringify(fullRetry)}`);
      }
      evidence.push(`Essence Altar: plain weapon, wrong Essence, and ${minedAir}/100 Essence rejected atomically; Air Wand 999 -> 1000 cost exactly ${essenceBefore - essenceAfter} Air Essence; immediate reload retained both sides; full retry spent 0`);
    }
  } else {
    failures.push("spell, persistence, and altar checks skipped because all three boss orbs were not acquired");
  }

  // The exact imported ruin mesh is part of Recast. A route aimed through the central monument
  // must bend around it at all three sites, while the surrounding court remains ordinary navmesh.
  for (const altarId of [
    "fallowmarch_air_altar",
    "vellenwood_earth_altar",
    "karrowmoor_water_altar",
  ]) {
    const altar = await call("getEntity", [altarId]) as EntityView | null;
    if (!altar) {
      failures.push(`${altarId}: missing while checking ruin collision`);
      continue;
    }
    const [x, y, z] = altar.position;
    const path = await call("getNavPath", [
      [x + 0.2, y, z - 7],
      [x + 0.2, y, z + 2],
    ]) as Array<{ x: number; y: number; z: number }> | null;
    const pathLength = path?.slice(1).reduce((sum, point, index) => {
      const previous = path[index]!;
      return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
    }, 0) ?? 0;
    if (!path || path.length < 3 || pathLength <= 9.4) {
      failures.push(`${altarId}: navigation did not route around the imported central stone (${pathLength.toFixed(2)} m)`);
    } else {
      evidence.push(`${altarId}: imported ruin collision bends a 9.00 m crossing into ${pathLength.toFixed(2)} m over ${path.length} path points`);
    }
  }

  if (capture) {
    for (const site of [
      { id: "fallowmarch_air_altar", shot: "magic-07-air-altar-court" },
      { id: "vellenwood_earth_altar", shot: "magic-08-earth-altar-court" },
      { id: "karrowmoor_water_altar", shot: "magic-09-water-altar-court" },
    ]) {
      const altar = await call("getEntity", [site.id]) as EntityView | null;
      if (altar?.state === "dormant") {
        await call("teleport", [{ entityId: site.id }]);
        await tool("corealm_interact", { entityId: site.id, interaction: "awaken" });
      }
      await call("focusEntity", [site.id]);
      await driver.wait(1_000);
      await driver.screenshot(screenshotDir, site.shot);
    }
    await call("seedMagic", [10, 150]);
    await closePlayerShot("magic-02-water-staff-charged");
    await driver.press("b");
    await driver.wait(500);
    await driver.screenshot(screenshotDir, "magic-03-spellbook-compact");
    await driver.press("Escape");
  }

  if (driver.consoleErrors.length || driver.pageErrors.length || driver.requestErrors.length) {
    failures.push(`browser errors: ${JSON.stringify({
      console: driver.consoleErrors,
      page: driver.pageErrors,
      request: driver.requestErrors,
    })}`);
  }
} catch (error) {
  failures.push(`acceptance crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  if (driver.consoleErrors.length || driver.pageErrors.length || driver.requestErrors.length) {
    failures.push(`browser diagnostics at crash: ${JSON.stringify({
      console: driver.consoleErrors,
      page: driver.pageErrors,
      request: driver.requestErrors,
    })}`);
  }
} finally {
  await driver.close();
  await server.close();
}

for (const row of evidence) console.log(`  ${row}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} acceptance problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("magic world acceptance passed");
}
