/**
 * Browser acceptance for the level 1, 5 and 10 gathering and production loops.
 *
 * Setup uses the debug API for levels, inventory grants, travel and time scale. Every action being
 * accepted goes through an agent tool, then this script reads the live semantic state, events and
 * scene evidence. It never calls depleteNode, forceRespawn, loadSaveBlob or an internal system.
 *
 * Campfire expiry is the one intentionally slow section. advanceGameTime moves elapsed simulation
 * time but not meta.playSeconds, since it must not age played-time saves. The verifier therefore
 * runs real fixed ticks at a staged time scale until the fire is close to expiry.
 *
 *   npx tsx tools/verify-gathering-production.ts --run runs/corealm
 */
import path from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { gatherSuccessChance, toolBonus } from "../game/src/content/index.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { gearAppearance, weaponAttachment } from "../game/src/render/equipmentVisuals.js";
import { fishingRodAssetId } from "../game/src/render/proceduralGear.js";
import { campfirePlacementCandidates } from "../game/src/systems/campfire.js";
import type { Vec3 } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";

type TierDef = (typeof GATHERING_PRODUCTION_TIERS)[number];

interface CheckResult {
  id: string;
  passed: boolean;
  detail: string;
  evidence?: unknown;
}

interface GatheringObservation {
  resourceId: string;
  entityId: string;
  tier: number;
  archetype: string;
  itemId: string;
  active: BrowserEntity;
  depleted: BrowserEntity;
  respawned: BrowserEntity;
  activeBounds: DrawnBounds | null;
  depletedBounds: DrawnBounds | null;
  respawnedBounds: DrawnBounds | null;
}

interface AcceptanceReport {
  passed: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checks: CheckResult[];
  gathering: GatheringObservation[];
  screenshots: string[];
  seams: string[];
  failures: string[];
  errors: { console: string[]; page: string[]; requests: string[]; runtime: string[] };
}

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
  equipment?: { slots?: Record<string, ItemStack | null> };
}

interface BrowserEntity {
  id: string;
  name: string;
  archetype: string;
  tier: number;
  state: string;
  position: [number, number, number];
  interactions?: string[];
  resource?: {
    itemId: string;
    remaining: number;
    maxYields?: number;
    respawnSeconds?: number;
  };
  station?: { kind: string; skill: string; recipeIds?: string[] };
  meta?: Record<string, unknown>;
}

interface DrawnBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  height: number;
  width: number;
  meshes: number;
  path: string;
}

interface EventRecord {
  seq: number;
  type: string;
  data?: Record<string, unknown>;
  entityId?: string;
}

interface EventRead {
  events: EventRecord[];
  nextSeq: number;
}

interface SaveShape {
  meta?: { playSeconds?: number };
  world?: {
    campfire?: null | {
      id: string;
      position: [number, number, number];
      regionId: string;
      logItemId: string;
      tier: number;
      expiresAtPlaySeconds: number;
    };
  };
}

interface DebugPlayer {
  position: { x: number; y: number; z: number };
  regionId: string;
  facingRad: number;
  inCombat: boolean;
}

interface WorldSample {
  playable: boolean;
  height: number;
  slope: number | null;
  semanticRegion: string;
  waterBodyId: string | null;
}

interface WaterBodyView {
  id: string;
  centre: [number, number];
  level: number;
  floorY: number;
  contour: [number, number][];
  closed: boolean;
}

interface InvalidTerrainCandidate {
  position: Vec3;
  rejectedBy: string | null;
}

interface InvalidWaterSiteEvidence {
  bodyId: string;
  player: DebugPlayer;
  playerSample: WorldSample;
  candidates: InvalidTerrainCandidate[];
}

const FISH_GROUND_TOLERANCE_METRES = 0.05;
const FISH_SURFACE_TOLERANCE_METRES = 0.05;

const SCREENSHOT_RESOURCES = new Set([
  "ore_grithe", "ore_corven", "ore_kaldite",
  "tree_palewood", "tree_duskoak", "tree_cairnpine",
  "fish_silt_minnow", "fish_bramble_trout", "fish_cragfin",
]);
const RESOURCE_INTERACTION: Readonly<Record<string, string>> = {
  ore: "mine",
  tree: "chop",
  fishing_spot: "fish",
};
const TOOL_FOR_ARCHETYPE: Readonly<Record<string, string>> = {
  ore: "kaldite_pickaxe",
  tree: "kaldite_hatchet",
  fishing_spot: "cairnpine_rod",
};
const ARCHETYPE_FOR_RESOURCE = {
  mining: "ore",
  woodcutting: "tree",
  fishing: "fishing_spot",
} as const;

async function main(): Promise<void> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const args = process.argv.slice(2);
  const reuseScreenshots = args.includes("--reuse-screenshots");
  const runDir = await prepareRun(argValue(args, "--run") ?? "runs/corealm");
  const screenshotDir = path.join(runDir, "screenshots");
  const resultFile = path.join(runDir, "test-results", "gathering-production.json");
  const server = await startGameServer();
  const driver = new GameDriver(server, {
    viewport: { width: 1280, height: 800 },
    browserArgs: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
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
  const report: AcceptanceReport = {
    passed: false,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    checks: [],
    gathering: [],
    screenshots: [],
    seams: [],
    failures: [],
    errors: {
      console: driver.consoleErrors,
      page: driver.pageErrors,
      requests: driver.requestErrors,
      runtime: [],
    },
  };

  const check = (id: string, passed: boolean, detail: string, evidence?: unknown): boolean => {
    const row: CheckResult = evidence === undefined
      ? { id, passed, detail }
      : { id, passed, detail, evidence };
    report.checks.push(row);
    if (!passed) report.failures.push(`${id}: ${detail}`);
    return passed;
  };

  const capture = async (name: string, forceFresh = false): Promise<void> => {
    try {
      const file = path.join(screenshotDir, `${name}.png`);
      if (reuseScreenshots && !forceFresh) await stat(file);
      else await driver.screenshot(screenshotDir, name);
      report.screenshots.push(path.relative(runDir, file).replaceAll("\\", "/"));
    } catch (cause) {
      check(`screenshot.${name}`, false, describe(cause));
    }
  };

  const phase = async (name: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (cause) {
      const message = describe(cause);
      report.errors.runtime.push(`${name}: ${message}`);
      check(`phase.${name}`, false, message);
      await driver.callDebug("setPaused", [false]).catch(() => undefined);
      await driver.callDebug("setTimeScale", [1]).catch(() => undefined);
      await callTool(driver, "corealm_stop", {}).catch(() => undefined);
    }
  };

  try {
    await driver.launch();
    await driver.open(120_000);
    const requiredDebugMethods = [
      "advanceGameTime", "callTool", "clearInventory", "focusEntity", "focusLocation",
      "focusPlayer", "getDrawnBounds", "getErrors", "getMetrics", "getPlayer", "getSaveBlob",
      "getSceneStats", "getWaterBodies", "giveItem", "groundHeight", "listEntities", "sampleWorld",
      "saveNow", "setPaused", "setSkillLevel", "setTimeScale", "teleport",
    ];
    const missingDebugMethods = await driver.page!.evaluate((names) => {
      const api = window.__gameDebug as unknown as Record<string, unknown> | undefined;
      return names.filter((name) => typeof api?.[name] !== "function");
    }, requiredDebugMethods);
    if (missingDebugMethods.length > 0) {
      report.seams.push(`Missing browser debug evidence: ${missingDebugMethods.join(", ")}`);
    }
    check(
      "harness.required-debug-evidence",
      missingDebugMethods.length === 0,
      missingDebugMethods.length === 0
        ? "all setup and read-only evidence methods are present"
        : `missing ${missingDebugMethods.join(", ")}`,
    );
    if (missingDebugMethods.length > 0) throw new Error(report.seams[report.seams.length - 1]);
    await driver.callDebug("setTimeScale", [1]);

    await phase("gathering", async () => {
      for (const skill of ["mining", "woodcutting", "fishing"] as const) {
        await driver.callDebug("setSkillLevel", [skill, 99]);
      }

      const resources = gatheringResources();
      for (const resource of resources) {
        await phase(`gathering.${resource.resourceId}`, async () => {
          const observation = await verifyGatheringResource(
            driver,
            resource.resourceId,
            resource.archetype,
            resource.tier,
            check,
            SCREENSHOT_RESOURCES.has(resource.resourceId) ? capture : undefined,
          );
          report.gathering.push(observation);
        });
      }
    });

    await phase("production-matrix", async () => {
      for (const skill of ["smithing", "fletching", "crafting", "magic"] as const) {
        await driver.callDebug("setSkillLevel", [skill, 99]);
      }

      for (const tier of GATHERING_PRODUCTION_TIERS) {
        await verifyTierProduction(driver, tier, check);
      }

      const tier = GATHERING_PRODUCTION_TIERS[GATHERING_PRODUCTION_TIERS.length - 1];
      if (!tier) throw new Error("The gathering catalog has no tier rows");
      await verifyCraftedEquipmentAndTool(driver, tier, check);
      const equipped = await mustTool(driver, "corealm_equip", { itemId: tier.items.wand });
      const inventory = await inventoryView(driver);
      const mainHand = inventory.equipment?.slots?.mainHand?.itemId ?? null;
      check(
        "held-wand.equipped",
        mainHand === tier.items.wand,
        `main hand is ${String(mainHand)}`,
        equipped,
      );
      // Production ends beside the forge wall. Move to an authored open square before the close
      // equipment frame so camera occlusion cannot turn the wand proof into a wall screenshot.
      const openSquare = await driver.callDebug("focusLocation", ["town_center"]);
      if (openSquare !== true) throw new Error("Could not move the held-wand capture to town_center");
      await driver.callDebug("focusPlayer");
      await driver.wait(250);
      const wandAppearance = gearAppearance(tier.items.wand);
      const wandSocket = wandAppearance && weaponAttachment(wandAppearance);
      if (wandAppearance?.slot !== "mainHand" || wandAppearance.attach !== "bone" || !wandSocket) {
        throw new Error(`${tier.items.wand} has no production main-hand appearance and socket`);
      }
      const attachmentName = `equip-${wandAppearance.slot}-${wandAppearance.assetId}`;
      const wandVisible = await waitUntil(async () => {
        const stats = await driver.callDebug("getSceneStats") as { counts?: Record<string, number> };
        return Object.entries(stats.counts ?? {}).some(([name, count]) =>
          name.includes(attachmentName) && count > 0);
      }, 10_000, 150);
      check(
        "held-wand.scene",
        wandVisible,
        wandVisible ? `${attachmentName} is in the live character scene` : `${attachmentName} did not appear`,
        { appearance: wandAppearance, socket: wandSocket },
      );
      // The close player framing is part of this acceptance revision. Refresh this one shot even
      // when the expensive resource contact-sheet captures are being reused.
      await capture("gathering-production-held-cairnpine-wand", true);
      await driver.callDebug("focusLocation", ["highcairn_outpost"]);
      await driver.wait(250);
      const metrics = await driver.callDebug("getMetrics") as { drawCalls?: number };
      check(
        "render.highcairn-draw-budget",
        typeof metrics.drawCalls === "number" && metrics.drawCalls <= 400,
        `Highcairn rendered at ${String(metrics.drawCalls)} draw calls against the 400 ceiling`,
        metrics,
      );
    });

    await phase("range-cooking-and-healing", async () => {
      await verifyRangeCookingAndHealing(driver, check);
    });

    await phase("portable-campfire", async () => {
      await verifyCampfire(driver, check, capture);
    });

    const runtimeErrors = await driver.callDebug("getErrors") as { source?: string; message?: string }[];
    for (const error of runtimeErrors) {
      report.errors.runtime.push(`${error.source ?? "runtime"}: ${error.message ?? "unknown error"}`);
    }
    check(
      "browser.no-errors",
      driver.consoleErrors.length === 0
        && driver.pageErrors.length === 0
        && driver.requestErrors.length === 0
        && runtimeErrors.length === 0,
      `${driver.consoleErrors.length} console, ${driver.pageErrors.length} page, `
        + `${driver.requestErrors.length} request and ${runtimeErrors.length} recorded runtime errors`,
    );
  } catch (cause) {
    report.errors.runtime.push(describe(cause));
    report.failures.push(`fatal: ${describe(cause)}`);
  } finally {
    await driver.close();
    await server.close();
  }

  report.durationMs = Date.now() - started;
  report.finishedAt = new Date().toISOString();
  report.passed = report.failures.length === 0
    && report.seams.length === 0
    && report.checks.every((row) => row.passed);
  await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    passed: report.passed,
    checks: report.checks.length,
    failures: report.failures,
    seams: report.seams,
    screenshots: report.screenshots,
    result: path.relative(process.cwd(), resultFile),
    durationMs: report.durationMs,
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

function gatheringResources(): { resourceId: string; tier: number; archetype: string }[] {
  const rows: { resourceId: string; tier: number; archetype: string }[] = [];
  for (const tier of GATHERING_PRODUCTION_TIERS) {
    for (const resourceId of tier.resources.mining) {
      rows.push({ resourceId, tier: tier.tier, archetype: ARCHETYPE_FOR_RESOURCE.mining });
    }
    rows.push({
      resourceId: tier.resources.woodcutting,
      tier: tier.tier,
      archetype: ARCHETYPE_FOR_RESOURCE.woodcutting,
    });
    rows.push({
      resourceId: tier.resources.fishing,
      tier: tier.tier,
      archetype: ARCHETYPE_FOR_RESOURCE.fishing,
    });
  }
  return rows;
}

async function verifyGatheringResource(
  driver: GameDriver,
  resourceId: string,
  archetype: string,
  tier: number,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
  capture?: (name: string) => Promise<void>,
): Promise<GatheringObservation> {
  await callTool(driver, "corealm_stop", {});
  await driver.callDebug("clearInventory");
  const toolItemId = TOOL_FOR_ARCHETYPE[archetype];
  if (!toolItemId) throw new Error(`No gathering tool is configured for ${archetype}`);
  await driver.callDebug("giveItem", [toolItemId, 1, "inventory"]);

  const candidates = await driver.callDebug("listEntities", [{ archetype, tier }]) as BrowserEntity[];
  const node = candidates
    .filter((entity) => entity.meta?.resourceId === resourceId)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!node) throw new Error(`No ${resourceId} entity exists at tier ${tier}`);

  if (capture) {
    const focused = await driver.callDebug("focusEntity", [node.id]);
    if (focused !== true) throw new Error(`Could not focus ${node.id}`);
  } else {
    await teleportToEntity(driver, node.id);
  }

  const live = await inspect(driver, node.id);
  const activeBounds = await drawnBounds(driver, node.id);
  const itemId = live.resource?.itemId;
  if (!itemId) throw new Error(`${node.id} has no resource item`);
  const beforeItems = await itemCount(driver, itemId);
  check(
    `gather.${resourceId}.active`,
    live.state === "available" && (live.resource?.remaining ?? 0) > 0 && activeBounds !== null,
    `${node.id} starts ${live.state} with ${live.resource?.remaining ?? 0} yields`,
    { entity: live, bounds: activeBounds },
  );

  // Capture the resource before walk-to-interact puts the player directly over its origin. This
  // is especially important for fishing schools, which live below the solved water surface.
  if (capture) {
    await driver.callDebug("setPaused", [true]);
    await driver.wait(250);
    await capture(`gathering-${resourceId}-active`);
    await driver.callDebug("setPaused", [false]);
  }

  const verb = RESOURCE_INTERACTION[archetype];
  if (!verb) throw new Error(`No gathering interaction is configured for ${archetype}`);
  const started = await mustTool(driver, "corealm_interact", { entityId: node.id, interaction: verb });
  const gatheringStarted = await waitUntil(async () => {
    const activity = await driver.callDebug("getCurrentActivity") as { kind?: string; entityId?: string } | null;
    return activity?.kind === "gathering" && activity.entityId === node.id;
  }, 15_000, 100);
  check(
    `gather.${resourceId}.started`,
    gatheringStarted,
    gatheringStarted ? `${verb} entered the gathering activity` : `${verb} never entered the gathering activity`,
    started,
  );
  if (!gatheringStarted) throw new Error(`${node.id} did not start gathering`);

  if (resourceId === "fish_cragfin") {
    const expectedAttachment = `equip-mainHand-${fishingRodAssetId(toolItemId)}`;
    const rodVisible = await waitUntil(async () => {
      const stats = await driver.callDebug("getSceneStats") as { counts?: Record<string, number> };
      return Object.entries(stats.counts ?? {}).some(([name, count]) =>
        name.includes(expectedAttachment) && count > 0);
    }, 10_000, 150);
    check(
      "held-rod.scene",
      rodVisible,
      rodVisible ? "cairnpine rod, line and bobber attachment is live" : "no cairnpine rod attachment appeared",
    );
    if (capture) {
      await driver.callDebug("setPaused", [true]);
      await driver.wait(250);
      await capture("gathering-production-held-cairnpine-rod");
      await driver.callDebug("setPaused", [false]);
    }
  }

  await driver.callDebug("advanceGameTime", [120]);
  const depleted = await waitUntil(async () => (await inspect(driver, node.id)).state === "depleted", 10_000, 75);
  // Freeze the played-time respawn clock before waiting on the separately throttled render layer.
  // Otherwise a 21-second tier-one node can return during a slow software-rendered view wait.
  if (capture) await driver.wait(900);
  await driver.callDebug("setPaused", [true]);
  const depletedViewReady = await waitUntil(async () => {
    const bounds = await drawnBounds(driver, node.id);
    return bounds?.path.includes("spent") === true;
  }, 60_000, 75);
  const spent = await inspect(driver, node.id);
  const depletedBounds = await drawnBounds(driver, node.id);
  const afterItems = await itemCount(driver, itemId);
  check(
    `gather.${resourceId}.depleted`,
    depleted && depletedViewReady && spent.state === "depleted" && spent.resource?.remaining === 0 && afterItems > beforeItems,
    `${node.id} is ${spent.state}; ${itemId} ${beforeItems} -> ${afterItems}`,
    { entity: spent, bounds: depletedBounds },
  );
  checkResourcePresentation(resourceId, archetype, activeBounds, depletedBounds, check);
  if (archetype === "fishing_spot") {
    await checkFishingWaterGrounding(
      driver,
      resourceId,
      live,
      spent,
      activeBounds,
      depletedBounds,
      check,
    );
  }
  if (capture) await capture(`gathering-${resourceId}-depleted`);

  const respawnSeconds = live.resource?.respawnSeconds;
  if (!Number.isFinite(respawnSeconds) || (respawnSeconds ?? 0) <= 0) {
    throw new Error(`${node.id} has no valid respawn time`);
  }
  await driver.callDebug("setPaused", [false]);
  await driver.callDebug("advanceGameTime", [(respawnSeconds ?? 0) + 1]);
  const cameBack = await waitUntil(async () => (await inspect(driver, node.id)).state === "available", 10_000, 75);
  const availableViewReady = await waitUntil(async () => {
    const bounds = await drawnBounds(driver, node.id);
    return bounds !== null && !bounds.path.includes("spent");
  }, 60_000, 75);
  await driver.callDebug("setPaused", [true]);
  const respawned = await inspect(driver, node.id);
  const respawnedBounds = await drawnBounds(driver, node.id);
  check(
    `gather.${resourceId}.respawned`,
    cameBack
      && availableViewReady
      && respawned.state === "available"
      && (respawned.resource?.remaining ?? 0) > 0
      && similarBounds(activeBounds, respawnedBounds),
    `${node.id} returned with ${respawned.resource?.remaining ?? 0} yields after ${respawnSeconds} seconds`,
    { entity: respawned, bounds: respawnedBounds },
  );
  await driver.callDebug("setPaused", [false]);

  return {
    resourceId,
    entityId: node.id,
    tier,
    archetype,
    itemId,
    active: live,
    depleted: spent,
    respawned,
    activeBounds,
    depletedBounds,
    respawnedBounds,
  };
}

function checkResourcePresentation(
  resourceId: string,
  archetype: string,
  active: DrawnBounds | null,
  depleted: DrawnBounds | null,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
): void {
  let readable = active !== null
    && depleted !== null
    && depleted.width > 0.1
    && (archetype === "fishing_spot" || depleted.height > 0.01);
  let expectation = "a visible depleted marker remains";
  if (active && depleted && archetype === "ore") {
    const ratio = depleted.width / Math.max(0.001, active.width);
    readable = readable
      && ratio >= 0.55
      && ratio <= 1.45
      && active.path !== depleted.path;
    expectation = `worked rock keeps its silhouette and swaps render state, width ratio ${ratio.toFixed(2)}, ${active.path} -> ${depleted.path}`;
  } else if (active && depleted && archetype === "tree") {
    const ratio = depleted.height / Math.max(0.001, active.height);
    readable = readable && ratio < 0.6;
    expectation = `stump is shorter than its tree, height ratio ${ratio.toFixed(2)}`;
  } else if (active && depleted && archetype === "fishing_spot") {
    readable = readable && active.meshes > depleted.meshes;
    expectation = `fish school becomes a smaller recovery marker, meshes ${active.meshes} -> ${depleted.meshes}`;
  }
  check(`gather.${resourceId}.presentation`, readable, expectation, { active, depleted });
}

async function checkFishingWaterGrounding(
  driver: GameDriver,
  resourceId: string,
  activeEntity: BrowserEntity,
  depletedEntity: BrowserEntity,
  activeBounds: DrawnBounds | null,
  depletedBounds: DrawnBounds | null,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
): Promise<void> {
  const clusterId = typeof activeEntity.meta?.clusterId === "string"
    ? activeEntity.meta.clusterId
    : null;
  const bodies = await driver.callDebug("getWaterBodies") as WaterBodyView[];
  const body = clusterId ? bodies.find((candidate) => candidate.id === clusterId) : undefined;
  const [x, proxyY, z] = activeEntity.position;
  const groundY = Number(await driver.callDebug("groundHeight", [x, z]));
  const sample = await driver.callDebug("sampleWorld", [x, z]) as WorldSample;

  const proxyAtSurface = body !== undefined
    && body.closed
    && sample.waterBodyId === body.id
    && Math.abs(proxyY - body.level) <= FISH_SURFACE_TOLERANCE_METRES
    && Math.abs(depletedEntity.position[1] - body.level) <= FISH_SURFACE_TOLERANCE_METRES
    && Math.abs(groundY - body.floorY) <= FISH_GROUND_TOLERANCE_METRES;
  check(
    `gather.${resourceId}.water-proxy`,
    proxyAtSurface,
    body
      ? `proxy ${proxyY.toFixed(3)}, surface ${body.level.toFixed(3)}, ground ${groundY.toFixed(3)}, floor ${body.floorY.toFixed(3)}`
      : `no solved water body for cluster ${String(clusterId)}`,
    { clusterId, body, sample, activePosition: activeEntity.position, depletedPosition: depletedEntity.position },
  );

  const floorY = body ? Math.max(body.floorY, groundY) : Number.POSITIVE_INFINITY;
  const activeAboveFloor = activeBounds !== null
    && activeBounds.min.y >= floorY - FISH_GROUND_TOLERANCE_METRES;
  const depletedAboveFloor = depletedBounds !== null
    && depletedBounds.min.y >= floorY - FISH_GROUND_TOLERANCE_METRES;
  const activeHasSurfaceMarker = body !== undefined
    && activeBounds !== null
    && Math.abs(activeBounds.max.y - body.level) <= 0.15;
  const depletedAtSurface = body !== undefined
    && depletedBounds !== null
    && Math.abs(depletedBounds.min.y - body.level) <= 0.10
    && Math.abs(depletedBounds.max.y - body.level) <= 0.10;
  const fishSchoolPartsPresent = body !== undefined
    && activeBounds !== null
    && depletedBounds !== null
    && activeBounds.meshes >= depletedBounds.meshes + 3
    && activeBounds.min.y <= body.level - 0.12;
  check(
    `gather.${resourceId}.water-grounding`,
    activeAboveFloor
      && depletedAboveFloor
      && activeHasSurfaceMarker
      && depletedAtSurface
      && fishSchoolPartsPresent,
    body && activeBounds && depletedBounds
      ? `active y ${activeBounds.min.y.toFixed(3)}..${activeBounds.max.y.toFixed(3)} across ${activeBounds.meshes} meshes, depleted y ${depletedBounds.min.y.toFixed(3)}..${depletedBounds.max.y.toFixed(3)} across ${depletedBounds.meshes}, floor ${floorY.toFixed(3)}, surface ${body.level.toFixed(3)}`
      : "active or depleted fish bounds are missing",
    { body, groundY, activeBounds, depletedBounds },
  );
}

async function verifyTierProduction(
  driver: GameDriver,
  tier: TierDef,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
): Promise<void> {
  const m = tier.items;
  await callTool(driver, "corealm_stop", {});
  await driver.callDebug("clearInventory");
  await give(driver, m.log, 6);
  await give(driver, m.gem, 3);
  await give(driver, m.hide, 1);
  await give(driver, m.bar, 1);

  await teleportToEntity(driver, "coldbrace_fletching");
  await produceAndCheck(driver, `fletch_${m.shaft}`, 2, check);
  await produceAndCheck(driver, `fletch_${m.handle}`, 1, check);
  await produceAndCheck(driver, `fletch_${m.staff}`, 1, check);
  await produceAndCheck(driver, `fletch_${m.wand}`, 1, check);
  await produceAndCheck(driver, `fletch_${m.rod}`, 1, check);
  await produceAndCheck(driver, `fletch_${m.shield}`, 1, check);

  await give(driver, m.ore, tier.smelting.orePerBar * 5);
  await give(driver, m.flux, tier.smelting.fluxPerBar * 5);
  await teleportToEntity(driver, "coldbrace_furnace");
  await produceAndCheck(driver, `smelt_${m.bar}`, 5, check);
  await teleportToEntity(driver, "coldbrace_anvil");
  await produceAndCheck(driver, `smith_${m.dagger}`, 1, check);
  await produceAndCheck(driver, `smith_${m.helm}`, 1, check);
  await produceAndCheck(driver, `smith_${m.pickaxe}`, 1, check);

  const inventory = await inventoryView(driver);
  const expected = [
    m.shaft, m.staff, m.wand, m.rod, m.shield, m.dagger, m.helm, m.pickaxe,
  ];
  const missing = expected.filter((itemId) => countSlots(inventory.slots ?? [], itemId) < 1);
  check(
    `production.tier-${tier.tier}.end-to-end`,
    missing.length === 0,
    missing.length === 0
      ? "wooden products, handled weapon, armour and upgraded pickaxe are carried"
      : `missing ${missing.join(", ")}`,
    { expected, inventory },
  );
}

async function verifyCraftedEquipmentAndTool(
  driver: GameDriver,
  tier: TierDef,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
): Promise<void> {
  const m = tier.items;
  await driver.callDebug("setSkillLevel", ["melee", Math.max(10, tier.tier)]);
  await driver.callDebug("setSkillLevel", ["mining", tier.tier]);

  const previouslyWorn = await inventoryView(driver);
  const previousMainHand = previouslyWorn.equipment?.slots?.mainHand?.itemId ?? null;
  const previousHead = previouslyWorn.equipment?.slots?.head?.itemId ?? null;
  const swordBeforeClear = await sceneCountMatching(driver, "equip-mainHand-sword");
  const hoodBeforeClear = await sceneCountMatching(driver, "_ranger_hood");
  if (previouslyWorn.equipment?.slots?.mainHand) {
    await mustTool(driver, "corealm_equip", { unequipSlot: "mainHand" });
  }
  if (previouslyWorn.equipment?.slots?.head) {
    await mustTool(driver, "corealm_equip", { unequipSlot: "head" });
  }
  if (
    swordBeforeClear > 0
    && previousMainHand
    && (previousMainHand.includes("sword") || previousMainHand.includes("dagger"))
  ) {
    await waitUntil(
      async () => await sceneCountMatching(driver, "equip-mainHand-sword") < swordBeforeClear,
      10_000,
      150,
    );
  }
  if (hoodBeforeClear > 0 && previousHead) {
    await waitUntil(
      async () => await sceneCountMatching(driver, "_ranger_hood") < hoodBeforeClear,
      10_000,
      150,
    );
  }
  await driver.wait(150);
  const swordBaseline = await sceneCountMatching(driver, "equip-mainHand-sword");
  const hoodBaseline = await sceneCountMatching(driver, "_ranger_hood");
  const equipCursor = await events(driver, 0);
  const weaponEquip = await mustTool(driver, "corealm_equip", { itemId: m.dagger });
  const armourEquip = await mustTool(driver, "corealm_equip", { itemId: m.helm });
  const worn = await inventoryView(driver);
  const daggerVisible = await waitUntil(async () => {
    return await sceneCountMatching(driver, "equip-mainHand-sword") > swordBaseline;
  }, 10_000, 150);
  const helmVisible = await waitUntil(async () => {
    return await sceneCountMatching(driver, "_ranger_hood") > hoodBaseline;
  }, 10_000, 150);
  const equipEvents = await events(driver, equipCursor.nextSeq, ["item.equipped"]);
  const daggerEvent = equipEvents.events.some((event) =>
    event.type === "item.equipped"
      && event.data?.itemId === m.dagger
      && event.data?.slot === "mainHand");
  const helmEvent = equipEvents.events.some((event) =>
    event.type === "item.equipped"
      && event.data?.itemId === m.helm
      && event.data?.slot === "head");
  const wornMainHand = worn.equipment?.slots?.mainHand?.itemId ?? null;
  const wornHead = worn.equipment?.slots?.head?.itemId ?? null;
  check(
    "smithing.crafted-weapon-and-armour-equipped",
    wornMainHand === m.dagger
      && wornHead === m.helm
      && daggerEvent
      && helmEvent
      && daggerVisible
      && helmVisible,
    `main hand ${String(wornMainHand)}, head ${String(wornHead)}, held dagger ${daggerVisible ? "visible" : "missing"}, helm ${helmVisible ? "visible" : "missing"}`,
    { weaponEquip, armourEquip, equipEvents: equipEvents.events, equipment: worn.equipment },
  );

  const toolEquip = await callTool(driver, "corealm_equip", { itemId: m.pickaxe });
  const afterToolEquip = await inventoryView(driver);
  const carriedToolCount = countSlots(afterToolEquip.slots ?? [], m.pickaxe);
  check(
    "smithing.crafted-tool-pack-only",
    isToolError(toolEquip)
      && toolEquip.error === "INVALID_ARGUMENT"
      && carriedToolCount === 1
      && afterToolEquip.equipment?.slots?.mainHand?.itemId === m.dagger
      && afterToolEquip.equipment?.slots?.head?.itemId === m.helm,
    isToolError(toolEquip)
      ? `${m.pickaxe} stayed in the pack after equip returned ${toolEquip.error}`
      : `${m.pickaxe} was incorrectly accepted as wearable equipment`,
    { toolEquip, inventory: afterToolEquip },
  );

  const resourceId = tier.resources.mining[0];
  if (!resourceId) throw new Error(`Tier ${tier.tier} has no primary mining resource`);
  const nodes = await driver.callDebug("listEntities", [{ archetype: "ore", tier: tier.tier }]) as BrowserEntity[];
  const node = nodes
    .filter((candidate) => candidate.meta?.resourceId === resourceId && candidate.state === "available")
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!node) throw new Error(`No available ${resourceId} node can prove the carried tool selection`);

  await teleportToEntity(driver, node.id);
  const activityCursor = await events(driver, 0);
  const started = await mustTool(driver, "corealm_interact", { entityId: node.id, interaction: "mine" });
  const gatheringStarted = await waitUntil(async () => {
    const activity = await driver.callDebug("getCurrentActivity") as { kind?: string; entityId?: string } | null;
    return activity?.kind === "gathering" && activity.entityId === node.id;
  }, 10_000, 75);
  const activityEvents = await events(
    driver,
    activityCursor.nextSeq,
    ["activity.started"],
    10_000,
  );
  const activityStart = activityEvents.events.find((event) =>
    event.type === "activity.started"
      && event.entityId === node.id
      && event.data?.skill === "mining");
  const expectedChance = gatherSuccessChance(tier.tier + toolBonus(tier.tier), tier.tier);
  const actualChance = Number(activityStart?.data?.successChance);
  const pickaxeVisible = await waitUntil(async () => {
    const stats = await driver.callDebug("getSceneStats") as { counts?: Record<string, number> };
    return (stats.counts?.["equip-mainHand-pickaxe"] ?? 0) > 0;
  }, 10_000, 150);
  const duringGathering = await inventoryView(driver);
  check(
    "smithing.crafted-tool-selected-from-pack",
    gatheringStarted
      && activityStart?.data?.itemId === m.ore
      && Math.abs(actualChance - expectedChance) < 0.000_5
      && pickaxeVisible
      && countSlots(duringGathering.slots ?? [], m.pickaxe) === 1
      && duringGathering.equipment?.slots?.mainHand?.itemId === m.dagger,
    `carried ${m.pickaxe} gave ${(actualChance * 100).toFixed(1)}% against ${(expectedChance * 100).toFixed(1)}%, held tool ${pickaxeVisible ? "visible" : "missing"}`,
    { started, activityStart, inventory: duringGathering },
  );
  await callTool(driver, "corealm_stop", {});
}

async function produceAndCheck(
  driver: GameDriver,
  recipeId: string,
  quantity: number,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
): Promise<void> {
  const recipe = RECIPES.find((candidate) => candidate.id === recipeId);
  if (!recipe) throw new Error(`Recipe ${recipeId} is missing from the canonical table`);
  const before = await itemCount(driver, recipe.output.itemId);
  const started = await mustTool(driver, "corealm_produce", { recipeId, quantity });
  await driver.callDebug("advanceGameTime", [(recipe.durationMs * quantity + 500) / 1000]);
  const completed = await waitUntil(async () => await driver.callDebug("getCurrentActivity") === null, 10_000, 75);
  const after = await itemCount(driver, recipe.output.itemId);
  const expectedDelta = recipe.output.quantity * quantity;
  check(
    `produce.${recipeId}`,
    completed && after - before === expectedDelta,
    `${recipe.output.itemId} ${before} -> ${after}, expected +${expectedDelta}`,
    started,
  );
  if (!completed || after - before !== expectedDelta) {
    throw new Error(`${recipeId} did not complete through the production activity`);
  }
}

async function verifyRangeCookingAndHealing(
  driver: GameDriver,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
): Promise<void> {
  const tier = GATHERING_PRODUCTION_TIERS[0];
  if (!tier) throw new Error("The gathering catalog has no tier 1 row");
  const m = tier.items;
  const recipe = RECIPES.find((candidate) => candidate.id === `cook_${m.cookedFish}`);
  if (!recipe) throw new Error(`Cooking recipe for ${m.cookedFish} is missing`);

  await callTool(driver, "corealm_stop", {});
  await driver.callDebug("clearInventory");
  await driver.callDebug("setSkillLevel", ["cooking", 1]);
  await give(driver, m.rawFish, 24);
  const rawUse = await callTool(driver, "corealm_use_item", { itemId: m.rawFish });
  check(
    "cooking.raw-inedible",
    isToolError(rawUse) && await itemCount(driver, m.rawFish) === 24,
    isToolError(rawUse) ? `${m.rawFish} was refused` : `${m.rawFish} was accepted as food`,
    rawUse,
  );

  await teleportToEntity(driver, "coldbrace_range");
  const started = await mustTool(driver, "corealm_produce", { recipeId: recipe.id, quantity: 24 });
  await driver.callDebug("advanceGameTime", [(recipe.durationMs * 24 + 750) / 1000]);
  const stopped = await waitUntil(async () => await driver.callDebug("getCurrentActivity") === null, 10_000, 75);
  const cooked = await itemCount(driver, m.cookedFish);
  const burnt = await itemCount(driver, m.burntFish);
  check(
    "cooking.range-burn-and-success",
    stopped && cooked > 0 && burnt > 0 && cooked + burnt === 24,
    `${cooked} cooked and ${burnt} burnt from 24 at Cooking 1`,
    started,
  );

  const burntUse = await callTool(driver, "corealm_use_item", { itemId: m.burntFish });
  check(
    "cooking.burnt-inedible",
    isToolError(burntUse) && await itemCount(driver, m.burntFish) === burnt,
    isToolError(burntUse) ? `${m.burntFish} was refused` : `${m.burntFish} was accepted as food`,
    burntUse,
  );

  if (cooked < 2) throw new Error("The deterministic range batch produced fewer than two cooked fish");
  const state = await driver.callDebug("getState") as { health: number; maxHealth: number };
  await driver.callDebug("setHealth", [state.maxHealth - 10]);
  const eaten = await mustTool(driver, "corealm_use_item", { itemId: m.cookedFish });
  await driver.callDebug("advanceGameTime", [2]);
  await waitUntil(async () => await driver.callDebug("getCurrentActivity") === null, 5_000, 75);
  const healed = await driver.callDebug("getState") as { health: number; maxHealth: number };
  check(
    "cooking.healing",
    healed.health === state.maxHealth - 7,
    `health ${state.maxHealth - 10} -> ${healed.health}, expected +3`,
    eaten,
  );
  await driver.callDebug("setHealth", [state.maxHealth - 1]);
  const clampedEat = await mustTool(driver, "corealm_use_item", { itemId: m.cookedFish });
  await driver.callDebug("advanceGameTime", [2]);
  await waitUntil(async () => await driver.callDebug("getCurrentActivity") === null, 5_000, 75);
  const clamped = await driver.callDebug("getState") as { health: number; maxHealth: number };
  check(
    "cooking.max-health-clamp",
    clamped.health === clamped.maxHealth,
    `health stopped at ${clamped.health}/${clamped.maxHealth}`,
    clampedEat,
  );
}

async function verifyCampfire(
  driver: GameDriver,
  check: (id: string, passed: boolean, detail: string, evidence?: unknown) => boolean,
  capture: (name: string) => Promise<void>,
): Promise<void> {
  const tier1 = GATHERING_PRODUCTION_TIERS[0];
  const tier5 = GATHERING_PRODUCTION_TIERS[1];
  const tier10 = GATHERING_PRODUCTION_TIERS[2];
  if (!tier1 || !tier5 || !tier10) throw new Error("Campfire acceptance needs tiers 1, 5 and 10");

  await callTool(driver, "corealm_stop", {});
  await driver.callDebug("clearInventory");
  await driver.callDebug("setSkillLevel", ["fletching", 10]);
  await driver.callDebug("setSkillLevel", ["crafting", 10]);
  await driver.callDebug("setSkillLevel", ["cooking", 99]);
  await give(driver, tier1.items.log, 1);
  await give(driver, tier5.items.log, 1);
  await give(driver, tier10.items.log, 1);
  await give(driver, tier10.items.rawFish, 8);

  const invalidSite = await moveToInvalidWaterCampfireSite(driver);
  const invalidLogBefore = await itemCount(driver, tier1.items.log);
  const invalidXpBefore = await buildXp(driver);
  const invalidSaveBefore = saveState(await driver.callDebug("getSaveBlob"));
  const invalidEntityBefore = await callTool(driver, "corealm_inspect", { entityId: "player_campfire" });
  const invalidEventCursor = await events(driver, 0);
  const invalidBuild = await callTool(driver, "corealm_build_campfire", { logItemId: tier1.items.log });
  const invalidActivity = await driver.callDebug("getCurrentActivity");
  const invalidLogAfter = await itemCount(driver, tier1.items.log);
  const invalidXpAfter = await buildXp(driver);
  const invalidSaveAfter = saveState(await driver.callDebug("getSaveBlob"));
  const invalidEntityAfter = await callTool(driver, "corealm_inspect", { entityId: "player_campfire" });
  const invalidEvents = await events(
    driver,
    invalidEventCursor.nextSeq,
    ["campfire.built", "campfire.replaced"],
  );
  check(
    "campfire.invalid-water-placement-rejected",
    isToolError(invalidBuild)
      && invalidBuild.error === "NOT_REACHABLE"
      && invalidActivity === null
      && invalidSite.candidates.length > 0
      && invalidSite.candidates.every((candidate) => candidate.rejectedBy?.includes(invalidSite.bodyId)),
    isToolError(invalidBuild)
      ? `${invalidBuild.error} at ${invalidSite.bodyId}; all ${invalidSite.candidates.length} placement samples were blocked by the solved water body`
      : `water-edge placement started unexpectedly: ${JSON.stringify(invalidBuild)}`,
    { site: invalidSite, result: invalidBuild, activity: invalidActivity },
  );
  check(
    "campfire.invalid-placement-atomic",
    invalidLogAfter === invalidLogBefore
      && invalidXpAfter.fletching === invalidXpBefore.fletching
      && invalidXpAfter.crafting === invalidXpBefore.crafting
      && sameJson(invalidSaveAfter.world?.campfire ?? null, invalidSaveBefore.world?.campfire ?? null)
      && sameJson(campfireIdentity(invalidEntityAfter), campfireIdentity(invalidEntityBefore))
      && invalidEvents.events.length === 0,
    `log ${invalidLogBefore} -> ${invalidLogAfter}, Fletching ${invalidXpBefore.fletching} -> ${invalidXpAfter.fletching}, Crafting ${invalidXpBefore.crafting} -> ${invalidXpAfter.crafting}, lifecycle events ${invalidEvents.events.length}`,
    {
      before: { save: invalidSaveBefore.world?.campfire, entity: invalidEntityBefore },
      after: { save: invalidSaveAfter.world?.campfire, entity: invalidEntityAfter },
      events: invalidEvents.events,
    },
  );

  const initialEvents = await events(driver, 0);
  const xpBeforeFirst = await buildXp(driver);
  const first = await startCampfireAtDrySite(driver, tier1.items.log);
  const firstFire = await inspect(driver, "player_campfire");
  const firstRemaining = Number(firstFire.meta?.remainingSeconds ?? 0);
  const xpAfterFirst = await buildXp(driver);
  check(
    "campfire.built",
    firstFire.station?.kind === "campfire"
      && firstFire.meta?.logItemId === tier1.items.log
      && firstRemaining >= 70
      && firstRemaining <= 72,
    `${String(firstFire.meta?.logItemId)} fire has ${firstRemaining} seconds remaining`,
    { start: first, entity: firstFire },
  );
  check(
    "campfire.tier-1-build-xp",
    xpAfterFirst.fletching - xpBeforeFirst.fletching === 2
      && xpAfterFirst.crafting - xpBeforeFirst.crafting === 2,
    `Fletching +${xpAfterFirst.fletching - xpBeforeFirst.fletching}, Crafting +${xpAfterFirst.crafting - xpBeforeFirst.crafting}`,
  );
  const firstBuildEvents = await events(driver, initialEvents.nextSeq, ["campfire.built"]);
  check(
    "campfire.lifecycle-built-event",
    firstBuildEvents.events.length > 0,
    `${firstBuildEvents.events.length} campfire.built event(s) observed through the agent event tool`,
  );
  await driver.callDebug("focusEntity", ["player_campfire"]);
  await driver.callDebug("setPaused", [true]);
  await capture("gathering-production-campfire-built");

  await driver.callDebug("saveNow");
  const saved = saveState(await driver.callDebug("getSaveBlob"));
  const savedFire = saved.world?.campfire;
  await driver.wait(2_000);
  await reloadGame(driver);
  const loaded = saveState(await driver.callDebug("getSaveBlob"));
  const loadedFire = loaded.world?.campfire;
  const reconstructed = await inspect(driver, "player_campfire");
  check(
    "campfire.save-reload",
    savedFire !== null
      && savedFire !== undefined
      && loadedFire !== null
      && loadedFire !== undefined
      && loadedFire.logItemId === savedFire.logItemId
      && loadedFire.expiresAtPlaySeconds === savedFire.expiresAtPlaySeconds
      && reconstructed.station?.kind === "campfire",
    "reload reconstructed the same played-time expiry and semantic station",
    { before: savedFire, after: loadedFire, entity: reconstructed },
  );
  const offlineDelta = savedFire && loadedFire
    ? (loaded.meta?.playSeconds ?? 0) - (saved.meta?.playSeconds ?? 0)
    : Number.POSITIVE_INFINITY;
  check(
    "campfire.no-offline-decay",
    Number.isFinite(offlineDelta) && offlineDelta < 1,
    `played time moved ${Number.isFinite(offlineDelta) ? offlineDelta.toFixed(3) : "unknown"} seconds across a 2 second wall wait and reload`,
  );

  await driver.callDebug("setPaused", [false]);
  const afterReloadEvents = await events(driver, 0);
  const xpBeforeSecond = await buildXp(driver);
  const second = await buildCampfire(driver, tier5.items.log);
  const replaced = await inspect(driver, "player_campfire");
  const secondRemaining = Number(replaced.meta?.remainingSeconds ?? 0);
  const xpAfterSecond = await buildXp(driver);
  const replacementEvents = await events(driver, afterReloadEvents.nextSeq, ["campfire.replaced", "campfire.built"]);
  check(
    "campfire.replaced",
    replaced.meta?.logItemId === tier5.items.log
      && secondRemaining >= 118
      && secondRemaining <= 120
      && replacementEvents.events.some((event) => event.type === "campfire.replaced")
      && replacementEvents.events.some((event) => event.type === "campfire.built"),
    `replacement uses ${String(replaced.meta?.logItemId)}, has ${secondRemaining} seconds and emitted ${replacementEvents.events.map((event) => event.type).join(", ")}`,
    { start: second, entity: replaced, events: replacementEvents.events },
  );
  check(
    "campfire.tier-5-build-xp",
    xpAfterSecond.fletching - xpBeforeSecond.fletching === 5
      && xpAfterSecond.crafting - xpBeforeSecond.crafting === 5,
    `Fletching +${xpAfterSecond.fletching - xpBeforeSecond.fletching}, Crafting +${xpAfterSecond.crafting - xpBeforeSecond.crafting}`,
  );

  const thirdCursor = await events(driver, 0);
  const xpBeforeThird = await buildXp(driver);
  const third = await buildCampfire(driver, tier10.items.log);
  const finalFire = await inspect(driver, "player_campfire");
  const thirdRemaining = Number(finalFire.meta?.remainingSeconds ?? 0);
  const xpAfterThird = await buildXp(driver);
  const thirdEvents = await events(driver, thirdCursor.nextSeq, ["campfire.replaced", "campfire.built"]);
  check(
    "campfire.tier-10-replacement",
    finalFire.meta?.logItemId === tier10.items.log
      && thirdRemaining >= 178
      && thirdRemaining <= 180
      && thirdEvents.events.some((event) => event.type === "campfire.replaced")
      && thirdEvents.events.some((event) => event.type === "campfire.built"),
    `replacement uses ${String(finalFire.meta?.logItemId)}, has ${thirdRemaining} seconds and emitted ${thirdEvents.events.map((event) => event.type).join(", ")}`,
    { start: third, entity: finalFire, events: thirdEvents.events },
  );
  check(
    "campfire.tier-10-build-xp",
    xpAfterThird.fletching - xpBeforeThird.fletching === 7
      && xpAfterThird.crafting - xpBeforeThird.crafting === 7,
    `Fletching +${xpAfterThird.fletching - xpBeforeThird.fletching}, Crafting +${xpAfterThird.crafting - xpBeforeThird.crafting}`,
  );

  const cookRecipe = RECIPES.find((candidate) => candidate.id === `cook_${tier10.items.cookedFish}`);
  if (!cookRecipe) throw new Error(`Cooking recipe for ${tier10.items.cookedFish} is missing`);
  const cookedBefore = await itemCount(driver, tier10.items.cookedFish);
  const cookedStart = await mustTool(driver, "corealm_produce", { recipeId: cookRecipe.id, quantity: 1 });
  await driver.callDebug("advanceGameTime", [(cookRecipe.durationMs + 500) / 1000]);
  await waitUntil(async () => await driver.callDebug("getCurrentActivity") === null, 10_000, 75);
  const cookedAfter = await itemCount(driver, tier10.items.cookedFish);
  check(
    "cooking.portable-campfire",
    cookedAfter === cookedBefore + 1,
    `${tier10.items.cookedFish} ${cookedBefore} -> ${cookedAfter}`,
    cookedStart,
  );
  await driver.callDebug("focusEntity", ["player_campfire"]);
  await driver.callDebug("setPaused", [true]);
  await capture("gathering-production-campfire-replaced");
  await driver.callDebug("setPaused", [false]);

  const nearExpiry = await approachCampfireExpiry(driver, 6);
  check(
    "campfire.expiry-approach",
    nearExpiry > 2.4 && nearExpiry <= 6.5,
    `batch began with ${nearExpiry.toFixed(2)} played seconds remaining`,
  );
  const expiryCursor = await events(driver, 0);
  const rawBefore = await itemCount(driver, tier10.items.rawFish);
  const batchCookedBefore = await itemCount(driver, tier10.items.cookedFish);
  const batch = await mustTool(driver, "corealm_produce", { recipeId: cookRecipe.id, quantity: 3 });
  await driver.callDebug("setTimeScale", [4]);
  const expired = await waitUntil(async () => {
    const entity = await callTool(driver, "corealm_inspect", { entityId: "player_campfire" });
    return isToolError(entity);
  }, 30_000, 100);
  await driver.callDebug("setTimeScale", [1]);
  await waitUntil(async () => await driver.callDebug("getCurrentActivity") === null, 10_000, 75);
  const rawAfter = await itemCount(driver, tier10.items.rawFish);
  const batchCookedAfter = await itemCount(driver, tier10.items.cookedFish);
  const used = rawBefore - rawAfter;
  const made = batchCookedAfter - batchCookedBefore;
  const expiryEvents = await events(
    driver,
    expiryCursor.nextSeq,
    ["campfire.expired", "activity.stopped", "production.completed"],
  );
  const stationExpired = expiryEvents.events.some((event) =>
    event.type === "activity.stopped" && event.data?.reason === "station-expired");
  check(
    "campfire.expired",
    expired && expiryEvents.events.some((event) => event.type === "campfire.expired"),
    expired ? "campfire entity disappeared at played-time expiry" : "campfire did not expire",
    expiryEvents.events,
  );
  check(
    "campfire.expiry-stops-batch-safely",
    stationExpired && made >= 1 && made < 3 && used === made,
    `batch made ${made}/3, consumed ${used}/3 and reported ${stationExpired ? "station-expired" : "another reason"}`,
    batch,
  );
  await driver.callDebug("setPaused", [true]);
  await capture("gathering-production-campfire-expired-site");
  await driver.callDebug("setPaused", [false]);
}

async function moveToInvalidWaterCampfireSite(driver: GameDriver): Promise<InvalidWaterSiteEvidence> {
  await callTool(driver, "corealm_stop", {});
  const focused = await driver.callDebug("focusLocation", ["town_center"]);
  if (focused !== true) throw new Error("Could not establish a deterministic campfire test facing");
  const faced = await driver.callDebug("getPlayer") as DebugPlayer;
  const forwardX = Math.sin(faced.facingRad);
  const forwardZ = Math.cos(faced.facingRad);
  const bodies = await driver.callDebug("getWaterBodies") as WaterBodyView[];
  const usable = bodies
    .filter((body) => body.closed && body.contour.length >= 8)
    .sort((a, b) => {
      if (a.id === "redsill_spots") return -1;
      if (b.id === "redsill_spots") return 1;
      return a.id.localeCompare(b.id);
    });

  for (const body of usable) {
    const shore = body.contour
      .map((point, index) => {
        const inwardX = body.centre[0] - point[0];
        const inwardZ = body.centre[1] - point[1];
        const length = Math.max(0.001, Math.hypot(inwardX, inwardZ));
        return {
          point,
          index,
          score: (inwardX / length) * forwardX + (inwardZ / length) * forwardZ,
        };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 24);

    for (const entry of shore) {
      for (const outsideOffset of [0.15, 0.35, 0.6, 0.85, 1.1] as const) {
        const x = entry.point[0] - forwardX * outsideOffset;
        const z = entry.point[1] - forwardZ * outsideOffset;
        const y = Number(await driver.callDebug("groundHeight", [x, z]));
        const teleported = await driver.callDebug("teleport", [{ x, y, z }]);
        if (teleported !== true) continue;

        const player = await driver.callDebug("getPlayer") as DebugPlayer;
        const playerSample = await driver.callDebug(
          "sampleWorld",
          [player.position.x, player.position.z],
        ) as WorldSample;
        const shoreDistance = Math.hypot(
          player.position.x - entry.point[0],
          player.position.z - entry.point[1],
        );
        if (
          !playerSample.playable
          || playerSample.waterBodyId !== null
          || playerSample.semanticRegion !== player.regionId
          || shoreDistance > 3.5
        ) {
          continue;
        }

        const origin: Vec3 = [player.position.x, player.position.y, player.position.z];
        const candidates = campfirePlacementCandidates(origin, player.facingRad);
        const evidence = await invalidTerrainCandidateEvidence(driver, candidates, player.regionId);
        const allRejectedBySolvedBody = evidence.length === candidates.length
          && evidence.every((candidate) => candidate.rejectedBy?.includes(body.id));
        if (allRejectedBySolvedBody) {
          return { bodyId: body.id, player, playerSample, candidates: evidence };
        }
      }
    }
  }

  throw new Error("Could not find a dry shoreline position whose full campfire fan is water-blocked");
}

async function invalidTerrainCandidateEvidence(
  driver: GameDriver,
  candidates: readonly Vec3[],
  regionId: string,
): Promise<InvalidTerrainCandidate[]> {
  const page = driver.page;
  if (!page) throw new Error("The browser page is not open");
  return await page.evaluate(
    ({ positions, expectedRegion }) => {
      const api = window.__gameDebug as unknown as {
        sampleWorld?: (x: number, z: number) => WorldSample;
      } | undefined;
      if (typeof api?.sampleWorld !== "function") {
        throw new Error("window.__gameDebug.sampleWorld is not installed");
      }
      const sampleWorld = api.sampleWorld;
      const probeRadii = [0, 0.2, 0.4, 0.6, 0.8] as const;

      return positions.map((position): InvalidTerrainCandidate => {
        const direct = sampleWorld(position[0], position[2]);
        if (!direct.playable) return { position, rejectedBy: "outside-playable-bounds" };
        if (direct.semanticRegion !== expectedRegion) {
          return { position, rejectedBy: `wrong-region:${direct.semanticRegion}` };
        }
        if (direct.waterBodyId) return { position, rejectedBy: `water:${direct.waterBodyId}` };

        for (const radius of probeRadii) {
          const samples = radius === 0 ? 1 : 32;
          for (let index = 0; index < samples; index += 1) {
            const angle = (index / samples) * Math.PI * 2;
            const nearby = sampleWorld(
              position[0] + Math.sin(angle) * radius,
              position[2] + Math.cos(angle) * radius,
            );
            if (!nearby.playable) {
              return { position, rejectedBy: `water-clearance:bounds@${radius.toFixed(1)}` };
            }
            if (nearby.waterBodyId) {
              return {
                position,
                rejectedBy: `water-clearance:${nearby.waterBodyId}@${radius.toFixed(1)}`,
              };
            }
          }
        }
        return { position, rejectedBy: null };
      });
    },
    { positions: candidates, expectedRegion: regionId },
  );
}

async function startCampfireAtDrySite(driver: GameDriver, logItemId: string): Promise<unknown> {
  const locations = ["west_track", "town_entrance", "fallowmarch_north_gate", "open_march_camp"];
  const failures: string[] = [];
  for (const locationId of locations) {
    await callTool(driver, "corealm_stop", {});
    const teleported = await driver.callDebug("teleport", [{ locationId }]);
    if (teleported !== true) {
      failures.push(`${locationId}: teleport failed`);
      continue;
    }
    await driver.wait(250);
    const player = await driver.callDebug("getPlayer") as DebugPlayer;
    if (player.inCombat) {
      // The invalid-water setup can briefly draw an aggressive shoreline enemy. Moving away is
      // enough to break pursuit, but EnemyAI deliberately remembers provocation for 12 seconds.
      await driver.callDebug("advanceGameTime", [13]);
      const disengaged = await waitUntil(async () => {
        const current = await driver.callDebug("getPlayer") as DebugPlayer;
        return current.inCombat === false;
      }, 10_000, 75);
      if (!disengaged) {
        failures.push(`${locationId}: combat did not clear after leaving the shoreline`);
        continue;
      }
    }
    const result = await callTool(driver, "corealm_build_campfire", { logItemId });
    if (isToolError(result)) {
      failures.push(`${locationId}: ${result.error} ${result.message ?? ""}`.trim());
      continue;
    }
    await driver.callDebug("advanceGameTime", [3.5]);
    const built = await waitUntil(async () => {
      const entity = await callTool(driver, "corealm_inspect", { entityId: "player_campfire" });
      return !isToolError(entity) && entity.meta?.logItemId === logItemId;
    }, 10_000, 75);
    if (!built) throw new Error(`Campfire build started at ${locationId} but did not finish`);
    return result;
  }
  throw new Error(`No dry campfire site accepted the build. ${failures.join(" | ")}`);
}

async function buildCampfire(driver: GameDriver, logItemId: string): Promise<unknown> {
  await callTool(driver, "corealm_stop", {});
  let result = await callTool(driver, "corealm_build_campfire", { logItemId });
  if (isToolError(result)) return startCampfireAtDrySite(driver, logItemId);
  await driver.callDebug("advanceGameTime", [3.5]);
  const built = await waitUntil(async () => {
    const entity = await callTool(driver, "corealm_inspect", { entityId: "player_campfire" });
    return !isToolError(entity) && entity.meta?.logItemId === logItemId;
  }, 10_000, 75);
  if (!built) throw new Error(`Replacement fire from ${logItemId} did not finish`);
  return result;
}

async function approachCampfireExpiry(driver: GameDriver, targetSeconds: number): Promise<number> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = saveState(await driver.callDebug("getSaveBlob"));
    const fire = state.world?.campfire;
    const playSeconds = state.meta?.playSeconds;
    if (!fire || typeof playSeconds !== "number") return 0;
    const remaining = fire.expiresAtPlaySeconds - playSeconds;
    if (remaining <= targetSeconds) {
      await driver.callDebug("setTimeScale", [1]);
      return remaining;
    }
    const scale = remaining > 40 ? 60 : remaining > 15 ? 20 : remaining > 8 ? 5 : 2;
    await driver.callDebug("setTimeScale", [scale]);
    await driver.wait(100);
  }
  await driver.callDebug("setTimeScale", [1]);
  throw new Error("Campfire played-time countdown did not approach expiry within 90 seconds");
}

async function reloadGame(driver: GameDriver): Promise<void> {
  const page = driver.page;
  if (!page) throw new Error("The browser page is not open");
  await page.reload({ waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(
    () => window.__gameDebug?.getState().ready === true,
    undefined,
    { timeout: 120_000 },
  );
  await driver.wait(250);
}

async function events(
  driver: GameDriver,
  sinceSeq: number,
  types?: string[],
  timeoutMs?: number,
): Promise<EventRead> {
  const args: Record<string, unknown> = { sinceSeq };
  if (types) args.types = types;
  if (timeoutMs !== undefined) args.timeoutMs = timeoutMs;
  const result = await mustTool(driver, "corealm_events", args);
  return result as unknown as EventRead;
}

async function inventoryView(driver: GameDriver): Promise<InventoryView> {
  return await mustTool(driver, "corealm_inventory", {}) as unknown as InventoryView;
}

async function itemCount(driver: GameDriver, itemId: string): Promise<number> {
  const inventory = await inventoryView(driver);
  return countSlots(inventory.slots ?? [], itemId);
}

function countSlots(slots: readonly (ItemStack | null)[], itemId: string): number {
  return slots.reduce((sum, stack) => sum + (stack?.itemId === itemId ? stack.quantity : 0), 0);
}

async function give(driver: GameDriver, itemId: string, quantity: number): Promise<void> {
  const before = await itemCount(driver, itemId);
  const result = await driver.callDebug("giveItem", [itemId, quantity, "inventory"]);
  const after = await itemCount(driver, itemId);
  if (after - before !== quantity) {
    throw new Error(`Debug setup could not grant ${quantity} ${itemId}: ${JSON.stringify(result)}`);
  }
}

async function inspect(driver: GameDriver, entityId: string): Promise<BrowserEntity> {
  return await mustTool(driver, "corealm_inspect", { entityId }) as unknown as BrowserEntity;
}

async function drawnBounds(driver: GameDriver, entityId: string): Promise<DrawnBounds | null> {
  return await driver.callDebug("getDrawnBounds", [entityId]) as DrawnBounds | null;
}

async function sceneCountMatching(driver: GameDriver, fragment: string): Promise<number> {
  const stats = await driver.callDebug("getSceneStats") as { counts?: Record<string, number> };
  return Object.entries(stats.counts ?? {}).reduce(
    (sum, [name, count]) => sum + (name.includes(fragment) ? count : 0),
    0,
  );
}

async function teleportToEntity(driver: GameDriver, entityId: string): Promise<void> {
  await callTool(driver, "corealm_stop", {});
  const teleported = await driver.callDebug("teleport", [{ entityId }]);
  if (teleported !== true) throw new Error(`Could not teleport near ${entityId}`);
  await driver.wait(250);
}

async function callTool(driver: GameDriver, name: string, args: Record<string, unknown>): Promise<any> {
  return await driver.callDebug("callTool", [name, args]);
}

async function mustTool(
  driver: GameDriver,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, any>> {
  const result = await callTool(driver, name, args);
  if (isToolError(result)) {
    throw new Error(`${name}: ${result.error}${result.message ? ` ${result.message}` : ""}`);
  }
  if (!result || typeof result !== "object") {
    throw new Error(`${name} returned ${JSON.stringify(result)}`);
  }
  return result as Record<string, any>;
}

function isToolError(value: unknown): value is ToolError {
  return Boolean(value && typeof value === "object" && typeof (value as ToolError).error === "string");
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  budgetMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function similarBounds(before: DrawnBounds | null, after: DrawnBounds | null): boolean {
  if (!before || !after) return false;
  const widthRatio = after.width / Math.max(0.001, before.width);
  const heightRatio = after.height / Math.max(0.001, before.height);
  return widthRatio >= 0.6 && widthRatio <= 1.4 && heightRatio >= 0.6 && heightRatio <= 1.4;
}

async function buildXp(driver: GameDriver): Promise<{ fletching: number; crafting: number }> {
  const state = await driver.callDebug("getState") as {
    skills?: { fletching?: { xp?: number }; crafting?: { xp?: number } };
  };
  return {
    fletching: state.skills?.fletching?.xp ?? 0,
    crafting: state.skills?.crafting?.xp ?? 0,
  };
}

function saveState(value: unknown): SaveShape {
  if (typeof value !== "string") throw new Error("getSaveBlob did not return JSON text");
  return JSON.parse(value) as SaveShape;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function campfireIdentity(value: unknown): unknown {
  if (isToolError(value) || !value || typeof value !== "object") return null;
  const entity = value as BrowserEntity;
  return {
    id: entity.id,
    position: entity.position,
    tier: entity.tier,
    logItemId: entity.meta?.logItemId ?? null,
    stationKind: entity.station?.kind ?? null,
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.stack ?? cause.message : String(cause);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
