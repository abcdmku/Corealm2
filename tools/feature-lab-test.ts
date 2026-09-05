/**
 * Self-contained real-Chromium acceptance gate for both production-engine feature-lab modes.
 *
 * The setup API selects reproducible content. Gameplay proof still uses the production canvas,
 * keyboard controller, equipment panel, renderer, navigation, combat, rigs, and effects.
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import {
  EQUIP_SLOTS,
  SKILL_IDS,
  type EquipSlot,
  type FeatureLabCatalog,
  type FeatureLabMode,
  type FeatureLabMotionView,
  type FeatureLabState,
  type FeatureLabStructureSelection,
  type FeatureLabStructureView,
  type ItemId,
} from "../game/src/contracts.js";
import { SPELLS } from "../game/src/content/spells.js";
import { UNREACHABLE_DESTINATION_MESSAGE } from "../game/src/api/gameApi.js";
import { RELEASED_MAGIC_ELEMENTS } from "../game/src/systems/essence.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

/**
 * The gate's hard wall-clock ceiling. 60 s is the contract: two production boots plus every proof
 * below has to fit, and blowing it means the file has grown a shard that belongs in its own test.
 *
 * `FEATURE_LAB_BUDGET_MS` raises it for diagnosis ONLY — when the gate overruns, the useful next
 * question is which stage got slower, and that answer needs the run to finish. It is not a way to
 * make a slow gate pass; CI runs without it.
 */
const TOTAL_BUDGET_MS = Number(process.env["FEATURE_LAB_BUDGET_MS"] ?? 60_000);
const READY_BUDGET_MS = 18_000;
const ACTION_BUDGET_MS = 8_000;
const REBUILD_BUDGET_MS = 8_000;
const POLL_MS = 40;
const SCREENSHOT_TIMEOUT_MS = 5_000;
// Exercise the same player-facing quality controls as production. Low shadows keep ground contact
// readable while the reduced render scale leaves CI CPU for input, animation, and PNG capture.
const LAB_TEST_SETTINGS = {
  renderScale: 0.7,
  shadowQuality: "low",
  drawDistance: "near",
  damageNumbers: true,
  invertCameraY: false,
  uiScale: "normal",
  music: 0,
  ambient: 0,
  sfx: 0,
} as const;
type FeatureLabShard = "all" | "building" | "navigation" | "combat";
const args = process.argv.slice(2);
const TEST_SHARD = readTestShard(args);

const PREFAB_SELECTION = {
  kind: "prefab",
  id: "gatehouse",
  kit: "stone",
  width: 8,
  depth: 4,
  seed: 3,
} as const satisfies FeatureLabStructureSelection;

const MELEE_ARMOUR_SET = [
  ["head", "grithe_helm"],
  ["body", "grithe_cuirass"],
  ["legs", "grithe_greaves"],
  ["feet", "grithe_boots"],
  ["hands", "grithe_gloves"],
] as const satisfies readonly (readonly [EquipSlot, ItemId])[];

const MAGIC_ARMOUR_SET = [
  ["head", "marchhide_hood"],
  ["body", "marchhide_robe"],
  ["legs", "marchhide_leggings"],
  ["feet", "marchhide_boots"],
  ["hands", "marchhide_wraps"],
] as const satisfies readonly (readonly [EquipSlot, ItemId])[];

interface Point {
  x: number;
  y: number;
}

interface CanvasBox extends Point {
  width: number;
  height: number;
}

interface EquipmentProof {
  slot: EquipSlot;
  itemId: ItemId;
}

interface RuntimeProbe {
  ready: boolean;
  regionId: string | null;
  version: unknown;
  renderer: { drawCalls: number; triangles: number } | null;
  navigationStatus: string | null;
  groundSamples: number[];
  canvas: { id: string; width: number; height: number; webgl: boolean };
}

interface CameraProbe {
  position: Point3;
  yaw: number;
  pitch: number;
  distance: number;
  requestedDistance: number;
  freeMove: boolean;
  target: Point3;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface BrowserDiagnostics {
  console: string[];
  page: string[];
}

interface DocumentProbe {
  id: string;
  timeOrigin: number;
  url: string;
  oldRuntimeMarkerPresent: boolean;
}

interface ModeNavigationEvidence {
  from: FeatureLabMode;
  to: FeatureLabMode;
  before: DocumentProbe;
  after: DocumentProbe;
  fresh: FeatureLabState;
  probe: RuntimeProbe;
  queryPreserved: boolean;
  hashPreserved: boolean;
}

interface CombatEvidence {
  ready: FeatureLabState;
  final: FeatureLabState;
  probe: RuntimeProbe;
  catalogChecks: Record<string, boolean>;
  levelChecks: Record<string, boolean>;
  equipment: EquipmentProof[];
  bank: {
    panelOpened: boolean;
    quantityModes: string[];
    filteredItems: string[];
    gritheOre: readonly [number, number, number];
    carriedGritheOre: readonly [number, number, number];
    depositAllClearedFixtureItems: boolean;
  };
  routeFailureNotices: {
    results: Array<{ error?: string; message?: string }>;
    lines: Array<{ text: string; message: string | null; count: string | null }>;
  };
  targetPointer: {
    entityId: string | undefined;
    click: Point;
    selectedEntityId: string | null;
    navigationStarted: readonly [number, number];
  };
  melee: {
    entityId: string | undefined;
    weaponId: string;
    weaponEquipped: boolean;
    startedAtFullHealth: boolean;
    health: readonly [number | null | undefined, number | null | undefined];
    combatStarted: readonly [number, number];
    spellLaunched: readonly [number, number];
    motionAdvanced: boolean;
  };
  cast: {
    entityId: string | undefined;
    spellId: string;
    health: readonly [number | null | undefined, number | null | undefined];
    spellLaunched: readonly [number, number];
    sawParticles: boolean;
    motionAdvanced: boolean;
  };
}

interface BuildingEvidence {
  ready: FeatureLabState;
  final: FeatureLabState;
  probe: RuntimeProbe;
  structures: {
    prefab: FeatureLabStructureView;
    wallRun: FeatureLabStructureView;
  };
  rebuildMs: number[];
  walking: {
    before: FeatureLabState["playerPosition"];
    after: FeatureLabState["playerPosition"];
    motionAdvanced: boolean;
    visuallyActive: boolean;
    structureStable: boolean;
  };
  disabled: {
    before: FeatureLabState["playerPosition"];
    after: FeatureLabState["playerPosition"];
    structureStable: boolean;
    keyboardStable: boolean;
    navigationStarted: readonly [number, number];
    routeStayedIdle: boolean;
  };
  freeCamera: {
    enabled: boolean;
    playerBefore: FeatureLabState["playerPosition"];
    playerAfter: FeatureLabState["playerPosition"];
    orbitBefore: CameraProbe;
    orbitAfter: CameraProbe;
    fitAfter: CameraProbe;
  };
}

interface LegacyRedirectEvidence {
  state: FeatureLabState;
  probe: RuntimeProbe;
  finalUrl: string;
  redirected: boolean;
  queryPreserved: boolean;
  hashPreserved: boolean;
  bodyProfile: string | null;
  legacyApiPresent: boolean;
}

const started = performance.now();
const clearDeadline = installTestDeadline(`${TEST_SHARD} feature lab browser gate`, TOTAL_BUDGET_MS);
const screenshotDir = path.join(repoRoot, "test-results", "feature-labs");
const diagnostics: BrowserDiagnostics = { console: [], page: [] };
const screenshots: string[] = [];
let server: RunningGameServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let activeMode = "startup";
let lastState: FeatureLabState | null = null;

function logProgress(label: string): void {
  console.error(`[feature-lab] ${label} (${Math.round(performance.now() - started)} ms)`);
}

try {
  await mkdir(screenshotDir, { recursive: true });
  const url = argValue(args, "--url");
  server = url ? { url, close: async () => {} } : await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 0.75 });
  await page.addInitScript((settings) => {
    globalThis.localStorage?.setItem("corealm.settings.v1", JSON.stringify(settings));
    Reflect.set(
      window,
      "__featureLabGateDocumentId",
      `${performance.timeOrigin}:${Math.random().toString(36).slice(2)}`,
    );
  }, LAB_TEST_SETTINGS);
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.console.push(`[${activeMode}] ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.page.push(`[${activeMode}] ${error.stack ?? error.message}`));

  const stageMs: Record<string, number> = {};
  let stageStarted = performance.now();
  const stage = (name: string): void => {
    stageMs[name] = Math.round(performance.now() - stageStarted);
    stageStarted = performance.now();
  };
  let legacy: LegacyRedirectEvidence | null = null;
  if (TEST_SHARD !== "combat") {
    activeMode = "legacy-redirect/building";
    legacy = await testLegacyRedirect(page, server.url, (state) => {
      lastState = state;
    });
    logProgress("legacy redirect ready");
    lastState = legacy.state;
  }
  stage("legacyRedirect");
  const building = TEST_SHARD === "all" || TEST_SHARD === "building"
    ? await testBuilding(page, server.url, screenshotDir, screenshots, (state) => {
        lastState = state;
      }, false)
    : null;
  if (building) {
    logProgress("building proof complete");
    lastState = building.final;
  }
  stage("building");

  let combat: CombatEvidence | null = null;
  let modeNavigation: ModeNavigationEvidence | null = null;
  if (TEST_SHARD === "all" || TEST_SHARD === "navigation") {
    activeMode = "building-to-combat-navigation";
    const navigationSource = building?.final ?? legacy?.state;
    if (!navigationSource) throw new Error("Mode navigation has no building source state");
    modeNavigation = await selectModeWithReload(page, "combat", navigationSource, (state) => {
      lastState = state;
    });
    logProgress("combat navigation ready");
    lastState = modeNavigation.fresh;
    stage("modeNavigation");
  }

  if (TEST_SHARD === "all" || TEST_SHARD === "combat") {
    activeMode = "combat";
    combat = await testCombat(page, server.url, screenshotDir, screenshots, (state) => {
      lastState = state;
    }, TEST_SHARD === "combat");
    logProgress("combat proof complete");
    lastState = combat.final;
    stage("combat");
  }

  const comparisonProbe = building?.probe ?? combat?.probe ?? modeNavigation?.probe;
  if (!comparisonProbe) throw new Error("Feature-lab shard produced no runtime probe");
  const expectedScreenshots = TEST_SHARD === "all" ? 4
    : TEST_SHARD === "building" ? 1
      : TEST_SHARD === "combat" ? 3
        : 0;
  const checks: Record<string, boolean> = {
    ...(legacy ? legacyChecks(legacy, comparisonProbe) : {}),
    ...(building ? buildingChecks(building) : {}),
    ...(combat ? combatChecks(combat) : {}),
    ...(modeNavigation ? navigationChecks(modeNavigation, building?.final.structure.revision) : {}),
    ...(building && combat ? {
      bothUseProductionYard: combat.ready.engine === "corealm-production"
        && building.ready.engine === "corealm-production"
        && combat.ready.world === "fallowmarch-yard"
        && building.ready.world === "fallowmarch-yard",
      bothUseSharedRendererAndNavigation: probesShareWorld(combat.probe, building.probe)
        && combat.ready.engine === building.ready.engine
        && combat.ready.world === building.ready.world,
    } : {}),
    screenshotsCaptured: screenshots.length >= expectedScreenshots,
    noRuntimeErrors: (building?.final.errors.length ?? 0) === 0
      && (combat?.final.errors.length ?? 0) === 0
      && (legacy?.state.errors.length ?? 0) === 0
      && diagnostics.console.length === 0
      && diagnostics.page.length === 0,
    under60Seconds: performance.now() - started < TOTAL_BUDGET_MS,
  };
  const passed = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    passed,
    shard: TEST_SHARD,
    elapsedMs: Math.round(performance.now() - started),
    stageMs,
    url: server.url,
    checks,
    ...(combat ? { combat: {
      catalogChecks: combat.catalogChecks,
      levelChecks: combat.levelChecks,
      targetPointer: combat.targetPointer,
      bank: combat.bank,
      melee: combat.melee,
      cast: combat.cast,
      equipment: combat.equipment,
      routeFailureNotices: combat.routeFailureNotices,
    } } : {}),
    ...(building ? { building: {
      structures: building.structures,
      rebuildMs: building.rebuildMs.map(Math.round),
      walking: building.walking,
      disabled: building.disabled,
      freeCamera: building.freeCamera,
    } } : {}),
    ...(modeNavigation ? { modeNavigation } : {}),
    ...(legacy ? { legacy } : {}),
    screenshots,
    errors: {
      combat: combat?.final.errors ?? [],
      building: building?.final.errors ?? [],
      legacy: legacy?.state.errors ?? [],
      console: diagnostics.console,
      page: diagnostics.page,
    },
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (cause) {
  if (page) lastState = await readState(page).catch(() => lastState);
  console.error(JSON.stringify({
    passed: false,
    elapsedMs: Math.round(performance.now() - started),
    mode: activeMode,
    failure: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
    lastState,
    screenshots,
    errors: diagnostics,
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  clearDeadline();
}

function readTestShard(args: string[]): FeatureLabShard {
  const inline = args.find((arg) => arg.startsWith("--shard="))?.slice("--shard=".length);
  const flagIndex = args.indexOf("--shard");
  const value = inline ?? (flagIndex >= 0 ? args[flagIndex + 1] : undefined) ?? "all";
  if (value === "all" || value === "building" || value === "navigation" || value === "combat") return value;
  throw new Error(
    `Unknown feature-lab shard ${JSON.stringify(value)}; expected all, building, navigation, or combat`,
  );
}

function legacyChecks(legacy: LegacyRedirectEvidence, comparisonProbe: RuntimeProbe): Record<string, boolean> {
  return {
    legacyRoutePreservesQueryAndHash: legacy.redirected && legacy.queryPreserved && legacy.hashPreserved,
    legacyRouteBootsProductionBuildingLab: legacy.state.ready
      && legacy.state.engine === "corealm-production"
      && legacy.state.world === "fallowmarch-yard"
      && legacy.state.mode === "building"
      && !legacy.state.walkingEnabled
      && selectionMatches(legacy.state.structure.selection, PREFAB_SELECTION)
      && legacy.state.structure.collisionCount > 0
      && structureIsValid(legacy.state.structure)
      && legacy.bodyProfile === "feature-lab"
      && !legacy.legacyApiPresent
      && probesShareWorld(comparisonProbe, legacy.probe),
  };
}

function buildingChecks(building: BuildingEvidence): Record<string, boolean> {
  return {
    buildingRouteStartsInAuthoringMode: building.ready.mode === "building" && !building.ready.walkingEnabled,
    buildingProductionStructuresValid: [
      building.structures.prefab,
      building.structures.wallRun,
    ].every(structureIsValid),
    buildingCollisionCoverage: building.structures.prefab.collisionCount > 0
      && building.structures.wallRun.collisionCount > 0,
    buildingAuthoringControlRebuildsStructure: selectionMatches(
      building.structures.prefab.selection,
      PREFAB_SELECTION,
    ) && building.structures.wallRun.selection.kind === "wall-run"
      && building.structures.wallRun.selection.id === "wall_run",
    buildingWallDimensionsSupported: wallDimensionsSupported(building.structures.wallRun.selection),
    buildingRevisionsAdvance: building.structures.wallRun.revision > building.structures.prefab.revision,
    buildingRebuildsMeetBudget: building.rebuildMs.every((duration) => duration <= REBUILD_BUDGET_MS),
    buildingWalkingMovesPlayerAndKeepsStructure: distanceXZ(
      building.walking.before,
      building.walking.after,
    ) >= 0.15
      && building.walking.motionAdvanced
      && building.walking.visuallyActive
      && building.walking.structureStable,
    buildingWalkingDisablesAndKeepsStructure: !building.final.walkingEnabled
      && distanceXZ(building.disabled.before, building.disabled.after) < 0.08
      && building.disabled.structureStable
      && building.disabled.keyboardStable
      && building.disabled.navigationStarted[1] === building.disabled.navigationStarted[0]
      && building.disabled.routeStayedIdle,
    buildingFreeCameraOrbitsWithoutMovingPlayer: building.freeCamera.enabled
      && distanceXZ(building.freeCamera.playerBefore, building.freeCamera.playerAfter) < 0.08
      && (Math.abs(building.freeCamera.orbitAfter.yaw - building.freeCamera.orbitBefore.yaw) >= 0.01
        || Math.abs(building.freeCamera.orbitAfter.pitch - building.freeCamera.orbitBefore.pitch) >= 0.01)
      && building.freeCamera.fitAfter.freeMove,
  };
}

function combatChecks(combat: CombatEvidence): Record<string, boolean> {
  return {
    combatRouteSelected: combat.ready.mode === "combat" && combat.ready.walkingEnabled,
    combatProductionStructurePresent: structureIsValid(combat.ready.structure),
    combatCatalogsComplete: Object.values(combat.catalogChecks).every(Boolean),
    combatEveryLevelCanBeSet: Object.values(combat.levelChecks).every(Boolean),
    combatBankTransfersThroughProductionPanel: combat.bank.panelOpened
      && ["1", "5", "10", "All", "X"].every((label) => combat.bank.quantityModes.includes(label))
      && combat.bank.gritheOre[1] === combat.bank.gritheOre[0] + 5
      && combat.bank.gritheOre[2] === combat.bank.gritheOre[0]
      && combat.bank.carriedGritheOre[1] === combat.bank.carriedGritheOre[0] - 5
      && combat.bank.carriedGritheOre[2] === combat.bank.carriedGritheOre[0]
      && combat.bank.filteredItems.length === 1
      && combat.bank.filteredItems[0] === "grithe_ore"
      && combat.bank.depositAllClearedFixtureItems,
    combatRepresentativeEquipmentEquips: [
      ...MELEE_ARMOUR_SET,
      ...MAGIC_ARMOUR_SET,
    ].every(([slot, itemId]) => combat.equipment.some((row) => row.slot === slot && row.itemId === itemId))
      && combat.equipment.some((row) => row.slot === "mainHand"),
    combatRouteFailureSpeaksOnce: combat.routeFailureNotices.results.length === 3
      && combat.routeFailureNotices.results.every((result) => (
        result.error === "NOT_REACHABLE"
        && result.message === UNREACHABLE_DESTINATION_MESSAGE
      ))
      && combat.routeFailureNotices.lines.length === 1
      && combat.routeFailureNotices.lines[0]?.text === UNREACHABLE_DESTINATION_MESSAGE
      && combat.routeFailureNotices.lines[0]?.message === UNREACHABLE_DESTINATION_MESSAGE
      && combat.routeFailureNotices.lines[0]?.count === null,
    combatTargetPointerSelects: combat.targetPointer.selectedEntityId === combat.targetPointer.entityId,
    combatMeleeDamagesWithLiveMotion: combat.melee.combatStarted[1] > combat.melee.combatStarted[0]
      && numericFell(combat.melee.health)
      && combat.melee.motionAdvanced,
    combatMeleeIsSeparateFromSpellProof: combat.melee.entityId !== undefined
      && combat.cast.entityId !== undefined
      && combat.melee.entityId !== combat.cast.entityId
      && combat.melee.weaponEquipped
      && combat.melee.startedAtFullHealth
      && combat.melee.spellLaunched[1] === combat.melee.spellLaunched[0],
    combatSpellDrawsAndDamagesWithLiveMotion: combat.cast.spellLaunched[1] > combat.cast.spellLaunched[0]
      && combat.cast.sawParticles
      && numericFell(combat.cast.health)
      && combat.cast.motionAdvanced,
  };
}

function navigationChecks(
  modeNavigation: ModeNavigationEvidence,
  priorStructureRevision?: number,
): Record<string, boolean> {
  return {
    modeSelectionReloadsFreshRuntime: modeNavigation.from === "building"
      && modeNavigation.to === "combat"
      && modeNavigation.before.id !== modeNavigation.after.id
      && modeNavigation.before.timeOrigin !== modeNavigation.after.timeOrigin
      && !modeNavigation.after.oldRuntimeMarkerPresent
      && new URL(modeNavigation.after.url).searchParams.get("mode") === "combat"
      && modeNavigation.queryPreserved
      && modeNavigation.hashPreserved
      && modeNavigation.fresh.ready
      && modeNavigation.fresh.mode === "combat"
      && modeNavigation.fresh.walkingEnabled
      && Object.values(modeNavigation.fresh.counters).every((value) => value === 0)
      && (priorStructureRevision === undefined
        || modeNavigation.fresh.structure.revision < priorStructureRevision),
  };
}

async function testCombat(
  targetPage: Page,
  baseUrl: string,
  captures: string,
  captured: string[],
  remember: (state: FeatureLabState) => void,
  openRoute = true,
): Promise<CombatEvidence> {
  if (openRoute) await openLab(targetPage, baseUrl, "combat");
  const ready = await waitForState(targetPage, "combat lab readiness", (state) => (
    state.ready
    && state.engine === "corealm-production"
    && state.world === "fallowmarch-yard"
    && state.mode === "combat"
    && state.walkingEnabled
    && state.structure.ready
    && state.bank !== null
    && state.target !== null
    && state.target.screen !== null
    && state.playerMotion?.liveRig === true
    && state.target.motion?.liveRig === true
  ), READY_BUDGET_MS);
  remember(ready);
  const probe = await readRuntimeProbe(targetPage);
  const catalog = await readCatalog(targetPage);
  const catalogChecks = validateCatalog(catalog);

  const bankBefore = ready.bank;
  if (!bankBefore) throw new Error("Feature lab has no bank fixture");
  const openBank = targetPage.getByRole("button", { name: "Open bank" });
  await openBank.waitFor({ state: "visible", timeout: READY_BUDGET_MS });
  await openBank.click();
  const bankPanel = targetPage.locator("#panel-bank");
  await bankPanel.waitFor({ state: "visible", timeout: ACTION_BUDGET_MS });
  const panelOpened = await bankPanel.isVisible();
  const quantityModes = (await bankPanel.locator(".qty__btn").allTextContents()).map((label) => label.trim());
  await bankPanel.getByRole("radio", { name: "5", exact: true }).click();
  await bankPanel.locator('.bank-column--inventory .slot[data-item="grithe_ore"]').first().click();
  const bankDeposited = await waitForState(targetPage, "bank five-item deposit", (state) => (
    stackQuantity(state.bank?.contents.slots, "grithe_ore") === 30
    && stackQuantity(state.bank?.inventory, "grithe_ore") === 3
  ));
  remember(bankDeposited);
  await bankPanel.locator('.bank-column--bank .slot[data-item="grithe_ore"]').click();
  const bankWithdrawn = await waitForState(targetPage, "bank five-item withdrawal", (state) => (
    stackQuantity(state.bank?.contents.slots, "grithe_ore") === 25
    && stackQuantity(state.bank?.inventory, "grithe_ore") === 8
  ));
  remember(bankWithdrawn);
  await bankPanel.getByRole("searchbox", { name: "Filter bank by name" }).fill("grithe");
  const filteredItems = await bankPanel.locator(".bank-grid .slot:not(.is-empty)").evaluateAll((cells) => (
    cells.map((cell) => (cell as HTMLElement).dataset["item"] ?? "")
  ));
  const bankShot = path.join(captures, "bank-transfer.png");
  await capture(targetPage, bankShot, captured);
  await bankPanel.getByRole("button", { name: "Deposit all", exact: true }).click();
  const bankDepositedAll = await waitForState(targetPage, "bank deposit-all", (state) => (
    stackQuantity(state.bank?.inventory, "grithe_ore") === 0
    && stackQuantity(state.bank?.inventory, "palewood_log") === 0
    && stackQuantity(state.bank?.contents.slots, "palewood_log") === 6
  ));
  remember(bankDepositedAll);
  await targetPage.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("reset-bank");
  });
  await bankPanel.getByRole("button", { name: "Close Bank" }).click();
  const bankReset = await waitForState(targetPage, "bank fixture reset", (state) => (
    stackQuantity(state.bank?.contents.slots, "grithe_ore") === 25
    && stackQuantity(state.bank?.inventory, "grithe_ore") === 8
  ));
  remember(bankReset);

  const levels = await targetPage.evaluate((skillIds) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    for (const skillId of skillIds) api.setLevel(skillId, 99);
    return api.getState();
  }, [...SKILL_IDS]);
  remember(levels);
  const levelChecks = Object.fromEntries(
    SKILL_IDS.map((skillId) => [skillId, levels.levels[skillId] === 99]),
  );

  // Focused tests cover every item. The browser gate dresses one complete melee set and one
  // complete magic set so both production silhouettes reach the live rig and the two combat
  // screenshots carry useful armour evidence.
  const equipment: EquipmentProof[] = [];
  const setupWeapon = findItem(catalog, "mainHand", /sword|blade|axe|mace/i)
    ?? catalog.equipment.find((group) => group.slot === "mainHand")?.items[0]?.id;
  if (!setupWeapon) throw new Error("Feature lab has no main-hand equipment");
  const equipped = await targetPage.evaluate(async (itemId) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.equipPlayer("mainHand", itemId);
  }, setupWeapon);
  remember(equipped);
  if (equipped.equipment.mainHand === setupWeapon) {
    equipment.push({ slot: "mainHand", itemId: setupWeapon });
  }
  const meleeArmour = await equipArmourSet(targetPage, MELEE_ARMOUR_SET);
  remember(meleeArmour);
  equipment.push(...MELEE_ARMOUR_SET.map(([slot, itemId]) => ({ slot, itemId })));
  await waitForPlayerPart(targetPage, "outfit_male_knight_chest");

  // An unresolved assistance target must fail before the renderer can park a marker at Three.js's
  // default world origin. A valid fixed-position marker still uses the same production overlay
  // path, then clears cleanly so the rest of the combat screenshots stay unchanged.
  await targetPage.evaluate(async () => {
    const debug = Reflect.get(window, "__gameDebug") as {
      callTool?: (name: string, args: unknown) => Promise<unknown>;
    } | undefined;
    if (!debug?.callTool) throw new Error("Production window.__gameDebug.callTool is unavailable");
    await debug.callTool("corealm_overlay", { op: "clear" });
    const rejected = await debug.callTool("corealm_overlay", {
      op: "set",
      id: "lab-missing-target",
      kind: "marker",
      entityId: "lab_entity_that_does_not_exist",
    }) as Record<string, unknown>;
    if (rejected["error"] !== "NOT_FOUND") {
      throw new Error(`Unknown overlay target did not return NOT_FOUND: ${JSON.stringify(rejected)}`);
    }
    const placed = await debug.callTool("corealm_overlay", {
      op: "set",
      id: "lab-position-target",
      kind: "marker",
      position: [6, 0, 6],
    }) as Record<string, unknown>;
    if (placed["activeCount"] !== 1) {
      throw new Error(`Valid overlay target was not drawn: ${JSON.stringify(placed)}`);
    }
    const cleared = await debug.callTool("corealm_overlay", { op: "clear" }) as Record<string, unknown>;
    if (cleared["activeCount"] !== 0) {
      throw new Error(`Overlay cleanup failed: ${JSON.stringify(cleared)}`);
    }
  });

  // A failed human walk has two reporting paths: the immediate Result and navigation.failed.
  // The wording contract is covered in a focused test; here three real failures exercise the
  // event side and prove the persistent HUD keeps one unchanged line instead of counting spam.
  await clearMessageLog(targetPage);
  const routeFailureNotices = await targetPage.evaluate(async ({ expectedMessage }) => {
    const debug = Reflect.get(window, "__gameDebug") as {
      callTool?: (name: string, args: unknown) => Promise<unknown>;
    } | undefined;
    if (!debug?.callTool) throw new Error("Production window.__gameDebug.callTool is unavailable");
    const results: Array<{ error?: string; message?: string }> = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await debug.callTool("corealm_move_to", { position: [1_000_000, 0, 1_000_000] });
      if (typeof result !== "object" || result === null) throw new Error("Move failure was not structured");
      const row = result as Record<string, unknown>;
      results.push({
        ...(typeof row["error"] === "string" ? { error: row["error"] } : {}),
        ...(typeof row["message"] === "string" ? { message: row["message"] } : {}),
      });
    }
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    const lines = [...document.querySelectorAll<HTMLElement>(".msglog__line")]
      .filter((line) => line.dataset["message"] === expectedMessage)
      .map((line) => ({
        text: line.textContent ?? "",
        message: line.dataset["message"] ?? null,
        count: line.dataset["count"] ?? null,
      }));
    return { results, lines };
  }, { expectedMessage: UNREACHABLE_DESTINATION_MESSAGE });

  // Reuse the already prepared boot-target asset for the action proofs. Loading another full rig
  // here adds no production-path coverage and can push the two-boot gate beyond its hard deadline.
  const creaturePreset = catalog.targets.creature.find((preset) => preset.id === ready.target?.presetId)
    ?? catalog.targets.creature[0];
  if (!creaturePreset) throw new Error("Feature lab has no creature presets");
  // The boot target is already a production creature with a live screen projection. Reusing it
  // for pointer proof avoids an unnecessary entity-view rebuild before the dedicated melee target.
  const targetBase = ready;
  remember(targetBase);
  const canvas = targetPage.locator("#viewport");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Production canvas has no visible bounds in combat mode");
  const targetPoint = screenPoint(targetBase, canvasBox);
  await targetPage.mouse.click(targetPoint.x, targetPoint.y);
  const targetClicked = await waitForState(targetPage, "combat pointer target selection", (state) => (
    state.selectedEntityId === targetBase.target?.entityId
  ));
  remember(targetClicked);

  await clearMessageLog(targetPage);

  const meleeWeapon = findItem(catalog, "mainHand", /sword|blade|axe|mace/i);
  if (!meleeWeapon) throw new Error("Feature lab has no canonical melee weapon");
  const meleeEquipped = await targetPage.evaluate(async (itemId) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.equipPlayer("mainHand", itemId);
  }, meleeWeapon);
  const meleeBefore = await targetPage.evaluate(async ({ id }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("reset-player");
    return api.spawnTarget("creature", id);
  }, { id: creaturePreset.id });
  remember(meleeBefore);
  await targetPage.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("attack");
  });
  let meleeMotionAdvanced = false;
  const meleeAfter = await waitForState(targetPage, "production melee hit and motion", (state) => {
    meleeMotionAdvanced ||= motionAdvanced(meleeBefore.playerMotion, state.playerMotion)
      && motionMatches(state.playerMotion, /attack|melee/i);
    return state.counters.combatStarted > meleeBefore.counters.combatStarted
      && healthFell(meleeBefore, state)
      && meleeMotionAdvanced;
  });
  remember(meleeAfter);

  await focusPlayerForArmourProof(targetPage);
  const meleeShot = path.join(captures, "combat-melee.png");
  await capture(targetPage, meleeShot, captured);

  const magicWeapon = findItem(catalog, "mainHand", /staff|wand|focus/i);
  if (magicWeapon) {
    await targetPage.evaluate(async (itemId) => {
      const api = window.__featureLab;
      if (!api) throw new Error("window.__featureLab is unavailable");
      await api.equipPlayer("mainHand", itemId);
    }, magicWeapon);
  }
  const magicArmour = await equipArmourSet(targetPage, MAGIC_ARMOUR_SET);
  remember(magicArmour);
  equipment.push(...MAGIC_ARMOUR_SET.map(([slot, itemId]) => ({ slot, itemId })));
  await waitForPlayerPart(targetPage, "outfit_male_ranger_chest");
  const spell = [...catalog.spells].reverse().find((preset) => {
    const definition = SPELLS.find((candidate) => candidate.id === preset.id);
    return definition !== undefined && RELEASED_MAGIC_ELEMENTS.includes(definition.cost.element);
  });
  if (!spell) throw new Error("Feature lab has no released spell presets");
  const castBefore = await targetPage.evaluate(async ({ targetId, spellId }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("reset-player");
    await api.spawnTarget("creature", targetId);
    api.setSpell(spellId);
    return api.getState();
  }, { targetId: creaturePreset.id, spellId: spell.id });
  remember(castBefore);
  await clearMessageLog(targetPage);
  await targetPage.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("cast");
  });
  let castMotionAdvanced = false;
  const castParticles = await waitForState(targetPage, "production spell particles and motion", (state) => {
    castMotionAdvanced ||= motionAdvanced(castBefore.playerMotion, state.playerMotion)
      && motionMatches(state.playerMotion, /cast|spell|magic/i);
    return state.counters.spellLaunched > castBefore.counters.spellLaunched
      && state.liveSpellParticles > 0
      && castMotionAdvanced;
  });
  remember(castParticles);
  await focusPlayerForArmourProof(targetPage);
  const spellShot = path.join(captures, "combat-spell.png");
  await capture(targetPage, spellShot, captured);
  const castAfter = await waitForState(targetPage, "production spell damage", (state) => (
    state.counters.spellLaunched > castBefore.counters.spellLaunched
    && healthFell(castBefore, state)
  ));
  remember(castAfter);

  const final = castAfter;
  remember(final);

  return {
    ready,
    final,
    probe,
    catalogChecks,
    levelChecks,
    equipment,
    bank: {
      panelOpened,
      quantityModes,
      filteredItems,
      gritheOre: [
        stackQuantity(bankBefore.contents.slots, "grithe_ore"),
        stackQuantity(bankDeposited.bank?.contents.slots, "grithe_ore"),
        stackQuantity(bankWithdrawn.bank?.contents.slots, "grithe_ore"),
      ],
      carriedGritheOre: [
        stackQuantity(bankBefore.inventory, "grithe_ore"),
        stackQuantity(bankDeposited.bank?.inventory, "grithe_ore"),
        stackQuantity(bankWithdrawn.bank?.inventory, "grithe_ore"),
      ],
      depositAllClearedFixtureItems: stackQuantity(bankDepositedAll.bank?.inventory, "grithe_ore") === 0
        && stackQuantity(bankDepositedAll.bank?.inventory, "palewood_log") === 0,
    },
    routeFailureNotices,
    targetPointer: {
      entityId: targetBase.target?.entityId,
      click: targetPoint,
      selectedEntityId: targetClicked.selectedEntityId,
      navigationStarted: [targetBase.counters.navigationStarted, targetClicked.counters.navigationStarted],
    },
    melee: {
      entityId: meleeBefore.target?.entityId,
      weaponId: meleeWeapon,
      weaponEquipped: meleeEquipped.equipment.mainHand === meleeWeapon,
      startedAtFullHealth: typeof meleeBefore.target?.health === "number"
        && meleeBefore.target?.health === meleeBefore.target?.maxHealth,
      health: [meleeBefore.target?.health, meleeAfter.target?.health],
      combatStarted: [meleeBefore.counters.combatStarted, meleeAfter.counters.combatStarted],
      spellLaunched: [meleeBefore.counters.spellLaunched, meleeAfter.counters.spellLaunched],
      motionAdvanced: meleeMotionAdvanced,
    },
    cast: {
      entityId: castBefore.target?.entityId,
      spellId: spell.id,
      health: [castBefore.target?.health, castAfter.target?.health],
      spellLaunched: [castBefore.counters.spellLaunched, castAfter.counters.spellLaunched],
      sawParticles: castParticles.liveSpellParticles > 0,
      motionAdvanced: castMotionAdvanced,
    },
  };
}

async function testBuilding(
  targetPage: Page,
  baseUrl: string,
  captures: string,
  captured: string[],
  remember: (state: FeatureLabState) => void,
  openRoute = true,
): Promise<BuildingEvidence> {
  if (openRoute) await openLab(targetPage, baseUrl, "building");
  const ready = await waitForState(targetPage, "building lab readiness", (state) => (
    state.ready
    && state.engine === "corealm-production"
    && state.world === "fallowmarch-yard"
    && state.mode === "building"
    && !state.walkingEnabled
    && state.playerVisible
    && !state.freeCameraEnabled
    && structureIsValid(state.structure)
  ), READY_BUDGET_MS);
  remember(ready);
  const probe = await readRuntimeProbe(targetPage);
  const sourceKind = targetPage.locator("#lab-source-kind");
  // The lab panel is a deferred UI chunk. Runtime readiness can arrive before that chunk mounts.
  await sourceKind.waitFor({ state: "visible", timeout: READY_BUDGET_MS });
  logProgress("building controls ready");
  const rebuildStarted = performance.now();
  await sourceKind.selectOption("wall-run");
  const wallRun = await waitForState(targetPage, "building control structure rebuild", (state) => (
    state.structure.ready
    && state.structure.revision > ready.structure.revision
    && state.structure.selection.kind === "wall-run"
    && state.structure.selection.id === "wall_run"
  ), REBUILD_BUDGET_MS);
  remember(wallRun);
  const rebuildMs = performance.now() - rebuildStarted;
  logProgress("building rebuild complete");

  await targetPage.evaluate(() => window.__featureLab?.fitStructure());
  await targetPage.waitForTimeout(80);
  // Leave a little air around the structure so the disposable evidence shows the full silhouette.
  // Real wheel input is proven below; these events only frame the screenshot and are dispatched in
  // one page call to avoid three software-renderer protocol round trips.
  await targetPage.locator("#viewport").evaluate((canvas) => {
    for (let step = 0; step < 3; step += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 240 }));
    }
  });
  await targetPage.waitForTimeout(50);
  const authoringShot = path.join(captures, "building-authoring.png");
  await capture(targetPage, authoringShot, captured);
  logProgress("building screenshot captured");

  const toggle = targetPage.locator("#lab-walk-enabled");
  await toggle.waitFor({ state: "visible", timeout: 2_000 });
  await setToggle(toggle, true);
  const walkingReady = await waitForState(targetPage, "enable building walking", (state) => (
    state.mode === "building" && state.walkingEnabled && state.movement.mode === "idle"
  ), 2_000);
  remember(walkingReady);
  const stableStructure = walkingReady.structure;
  await targetPage.keyboard.down("w");
  let buildingMotionAdvanced = false;
  let visuallyActive = false;
  let walked: FeatureLabState;
  try {
    walked = await waitForState(targetPage, "building real-input walking", (state) => {
      buildingMotionAdvanced ||= motionAdvanced(walkingReady.playerMotion, state.playerMotion);
      visuallyActive ||= motionMatches(state.playerMotion, /walk|run|locomotion/i);
      return state.movement.mode === "direct"
        && distanceXZ(walkingReady.playerPosition, state.playerPosition) >= 0.15
        && buildingMotionAdvanced
        && visuallyActive;
    });
  } finally {
    await targetPage.keyboard.up("w");
  }
  remember(walked);
  const walkingStructureStable = sameStructure(stableStructure, walked.structure);
  logProgress("building walking complete");

  await setToggle(toggle, false);
  const disabledBefore = await waitForState(targetPage, "disable building walking", (state) => (
    state.mode === "building" && !state.walkingEnabled && state.movement.mode === "idle"
  ), 2_000);
  remember(disabledBefore);
  await targetPage.keyboard.down("w");
  await targetPage.waitForTimeout(150);
  await targetPage.keyboard.up("w");
  await targetPage.waitForTimeout(50);
  const keyboardDisabled = await readState(targetPage);
  const keyboardStable = distanceXZ(disabledBefore.playerPosition, keyboardDisabled.playerPosition) < 0.08;
  logProgress("building disabled-input proof complete");
  const canvas = targetPage.locator("#viewport");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Production canvas has no visible bounds in building mode");
  const authoringPoint = {
    x: canvasBox.x + canvasBox.width * 0.4,
    y: canvasBox.y + canvasBox.height * 0.68,
  };

  const freeCameraToggle = targetPage.locator("#lab-free-move");
  await freeCameraToggle.waitFor({ state: "visible", timeout: 2_000 });
  await setToggle(freeCameraToggle, true);
  const freeCameraReady = await waitForState(targetPage, "enable building free camera", (state) => (
    state.mode === "building"
    && !state.walkingEnabled
    && state.freeCameraEnabled
    && state.movement.mode === "idle"
  ), 2_000);
  remember(freeCameraReady);
  const freeOrbitBefore = await readCameraProbe(targetPage);
  await targetPage.mouse.move(authoringPoint.x, authoringPoint.y);
  await targetPage.mouse.down({ button: "right" });
  await targetPage.mouse.move(authoringPoint.x - 56, authoringPoint.y + 24);
  await targetPage.mouse.up({ button: "right" });
  await targetPage.waitForTimeout(60);
  const freeOrbitAfter = await readCameraProbe(targetPage);
  await targetPage.getByRole("button", { name: "Fit structure" }).click();
  await targetPage.waitForTimeout(60);
  const freeFitAfter = await readCameraProbe(targetPage);
  const freeCameraPlayerAfter = await readState(targetPage);
  remember(freeCameraPlayerAfter);
  logProgress("building camera proof complete");

  const buildingWorkbench = targetPage.locator("#lab-building-workbench");
  if (!(await buildingWorkbench.isVisible())) {
    throw new Error("Building workbench disappeared before the mode navigation proof");
  }
  const final = await readState(targetPage);
  remember(final);

  return {
    ready,
    final,
    probe,
    structures: {
      prefab: ready.structure,
      wallRun: wallRun.structure,
    },
    rebuildMs: [rebuildMs],
    walking: {
      before: walkingReady.playerPosition,
      after: walked.playerPosition,
      motionAdvanced: buildingMotionAdvanced,
      visuallyActive,
      structureStable: walkingStructureStable,
    },
    disabled: {
      before: disabledBefore.playerPosition,
      after: final.playerPosition,
      structureStable: sameStructure(stableStructure, final.structure),
      keyboardStable,
      navigationStarted: [disabledBefore.counters.navigationStarted, keyboardDisabled.counters.navigationStarted],
      routeStayedIdle: keyboardDisabled.movement.mode === "idle",
    },
    freeCamera: {
      enabled: freeCameraReady.freeCameraEnabled && freeOrbitBefore.freeMove,
      playerBefore: freeCameraReady.playerPosition,
      playerAfter: freeCameraPlayerAfter.playerPosition,
      orbitBefore: freeOrbitBefore,
      orbitAfter: freeOrbitAfter,
      fitAfter: freeFitAfter,
    },
  };
}

async function selectModeWithReload(
  targetPage: Page,
  mode: FeatureLabMode,
  beforeState: FeatureLabState,
  remember: (state: FeatureLabState) => void,
): Promise<ModeNavigationEvidence> {
  const before = await readDocumentProbe(targetPage);
  await targetPage.evaluate(() => Reflect.set(window, "__featureLabGateOldRuntime", true));
  await Promise.all([
    targetPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: READY_BUDGET_MS }),
    targetPage.locator("#lab-mode").selectOption(mode),
  ]);
  const fresh = await waitForState(targetPage, `${mode} runtime after mode navigation`, (state) => (
    state.ready
    && state.engine === "corealm-production"
    && state.world === "fallowmarch-yard"
    && state.mode === mode
    && state.structure.ready
  ), READY_BUDGET_MS);
  remember(fresh);
  const after = await readDocumentProbe(targetPage);
  const beforeUrl = new URL(before.url);
  const afterUrl = new URL(after.url);
  const expectedSearch = new URLSearchParams(beforeUrl.searchParams);
  expectedSearch.set("mode", mode);
  return {
    from: beforeState.mode,
    to: mode,
    before,
    after,
    fresh,
    probe: await readRuntimeProbe(targetPage),
    queryPreserved: expectedSearch.toString() === afterUrl.searchParams.toString(),
    hashPreserved: beforeUrl.hash === afterUrl.hash,
  };
}

async function testLegacyRedirect(
  targetPage: Page,
  baseUrl: string,
  remember: (state: FeatureLabState) => void,
): Promise<LegacyRedirectEvidence> {
  const legacyUrl = new URL("/structure-preview.html", ensureUrl(baseUrl));
  legacyUrl.search = new URLSearchParams({
    mode: "structures",
    kind: PREFAB_SELECTION.kind,
    id: PREFAB_SELECTION.id,
    kit: PREFAB_SELECTION.kit,
    width: String(PREFAB_SELECTION.width),
    depth: String(PREFAB_SELECTION.depth),
    seed: String(PREFAB_SELECTION.seed),
    legacyProbe: "preserved",
  }).toString();
  legacyUrl.hash = "legacy-yard";

  await targetPage.goto(legacyUrl.href, {
    waitUntil: "domcontentloaded",
    timeout: READY_BUDGET_MS,
  });
  await targetPage.waitForURL((url) => (
    url.pathname.endsWith("/index.html")
    && url.searchParams.get("mode") === "building"
    && url.hash === "#legacy-yard"
  ), { timeout: READY_BUDGET_MS });
  const state = await waitForState(targetPage, "legacy building redirect readiness", (candidate) => (
    candidate.ready
    && candidate.engine === "corealm-production"
    && candidate.world === "fallowmarch-yard"
    && candidate.mode === "building"
    && !candidate.walkingEnabled
    && candidate.playerVisible
    && !candidate.freeCameraEnabled
    && structureIsValid(candidate.structure)
    && candidate.structure.collisionCount > 0
    && selectionMatches(candidate.structure.selection, PREFAB_SELECTION)
  ), READY_BUDGET_MS);
  remember(state);

  const finalUrl = new URL(targetPage.url());
  const queryPreserved = Object.entries(PREFAB_SELECTION).every(([key, value]) => (
    finalUrl.searchParams.get(key) === String(value)
  )) && finalUrl.searchParams.get("legacyProbe") === "preserved";
  const pageEvidence = await targetPage.evaluate(() => ({
    bodyProfile: document.body.dataset["bootProfile"] ?? null,
    legacyApiPresent: Reflect.has(window, "__structurePreview"),
  }));
  return {
    state,
    probe: await readRuntimeProbe(targetPage),
    finalUrl: finalUrl.href,
    redirected: finalUrl.pathname.endsWith("/index.html")
      && finalUrl.searchParams.get("mode") === "building",
    queryPreserved,
    hashPreserved: finalUrl.hash === "#legacy-yard",
    bodyProfile: pageEvidence.bodyProfile,
    legacyApiPresent: pageEvidence.legacyApiPresent,
  };
}

async function openLab(targetPage: Page, baseUrl: string, mode: "combat" | "building"): Promise<void> {
  const url = new URL(`/index.html?mode=${mode}`, ensureUrl(baseUrl));
  const response = await targetPage.goto(url.href, {
    waitUntil: "domcontentloaded",
    timeout: READY_BUDGET_MS,
  });
  if (!response?.ok()) {
    throw new Error(`${mode} feature lab returned HTTP ${response?.status() ?? "no response"}: ${url.href}`);
  }
}

async function readState(targetPage: Page): Promise<FeatureLabState> {
  return targetPage.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.getState();
  });
}

async function readCatalog(targetPage: Page): Promise<FeatureLabCatalog> {
  return targetPage.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.getCatalog();
  });
}

async function equipArmourSet(
  targetPage: Page,
  set: readonly (readonly [EquipSlot, ItemId])[],
): Promise<FeatureLabState> {
  return targetPage.evaluate(async (entries) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    for (const [slot, itemId] of entries) await api.equipPlayer(slot, itemId);
    return api.getState();
  }, set);
}

async function waitForPlayerPart(targetPage: Page, assetId: string): Promise<void> {
  await targetPage.waitForFunction((needle) => {
    const debug = Reflect.get(window, "__gameDebug") as {
      getSceneStats?: () => { counts?: Record<string, number> };
    } | undefined;
    const counts = debug?.getSceneStats?.().counts;
    return counts !== undefined && Object.keys(counts).some((name) => name.includes(needle));
  }, assetId, { polling: POLL_MS, timeout: ACTION_BUDGET_MS });
}

async function focusPlayerForArmourProof(targetPage: Page): Promise<void> {
  await targetPage.evaluate(() => {
    const debug = Reflect.get(window, "__gameDebug") as { focusPlayer?: () => boolean } | undefined;
    if (debug?.focusPlayer?.() !== true) {
      throw new Error("Production window.__gameDebug.focusPlayer is unavailable");
    }
  });
  const canvas = targetPage.locator("#viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Production #viewport has no bounds for armour proof");
  // Stay left of the feature-lab panel. Pointer events landing on that overlay never reach the
  // production canvas, even though the canvas fills the same screen-space rectangle beneath it.
  const startX = box.x + box.width * 0.45;
  const y = box.y + box.height * 0.5;
  // focusPlayer deliberately frames the avatar from behind. Two real right-drag gestures orbit
  // roughly PI radians so the material proof sees the lit front and retains normal input coverage.
  for (let gesture = 0; gesture < 2; gesture += 1) {
    await targetPage.mouse.move(startX, y);
    await targetPage.mouse.down({ button: "right" });
    await targetPage.mouse.move(startX - 262, y, { steps: 8 });
    await targetPage.mouse.up({ button: "right" });
  }
  await targetPage.waitForTimeout(200);
}

async function readRuntimeProbe(targetPage: Page): Promise<RuntimeProbe> {
  return targetPage.evaluate(() => {
    const debug = Reflect.get(window, "__gameDebug") as {
      getState?: () => Record<string, unknown>;
      getNavigationState?: () => Record<string, unknown>;
      groundHeight?: (x: number, z: number) => number;
    } | undefined;
    if (!debug?.getState || !debug.getNavigationState || !debug.groundHeight) {
      throw new Error("Production window.__gameDebug contract is unavailable");
    }
    const state = debug.getState();
    const navigation = debug.getNavigationState();
    const renderer = state["renderer"] as Record<string, unknown> | undefined;
    const canvas = document.getElementById("viewport");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Production #viewport is unavailable");
    return {
      ready: state["ready"] === true,
      regionId: typeof state["regionId"] === "string" ? state["regionId"] : null,
      version: state["version"] ?? null,
      renderer: renderer
        ? {
            drawCalls: Number(renderer["drawCalls"] ?? 0),
            triangles: Number(renderer["triangles"] ?? 0),
          }
        : null,
      navigationStatus: typeof navigation["status"] === "string" ? navigation["status"] : null,
      groundSamples: [
        debug.groundHeight(-12, -8),
        debug.groundHeight(0, 0),
        debug.groundHeight(12, 8),
      ].map((value) => Math.round(value * 1_000) / 1_000),
      canvas: {
        id: canvas.id,
        width: canvas.width,
        height: canvas.height,
        webgl: Boolean(canvas.getContext("webgl2")),
      },
    };
  });
}

async function readCameraProbe(targetPage: Page): Promise<CameraProbe> {
  return targetPage.evaluate(() => {
    const debug = Reflect.get(window, "__gameDebug") as { getCamera?: () => Record<string, unknown> } | undefined;
    const camera = debug?.getCamera?.();
    const position = camera?.["position"];
    const yaw = camera?.["yaw"];
    const pitch = camera?.["pitch"];
    const distance = camera?.["distance"];
    const requestedDistance = camera?.["requestedDistance"];
    const freeMove = camera?.["freeMove"];
    const target = camera?.["target"];
    if (typeof position !== "object" || position === null
      || typeof (position as Record<string, unknown>)["x"] !== "number"
      || typeof (position as Record<string, unknown>)["y"] !== "number"
      || typeof (position as Record<string, unknown>)["z"] !== "number"
      || typeof yaw !== "number"
      || typeof pitch !== "number"
      || typeof distance !== "number"
      || typeof requestedDistance !== "number"
      || typeof freeMove !== "boolean"
      || typeof target !== "object" || target === null
      || typeof (target as Record<string, unknown>)["x"] !== "number"
      || typeof (target as Record<string, unknown>)["y"] !== "number"
      || typeof (target as Record<string, unknown>)["z"] !== "number") {
      throw new Error("Production camera orbit/zoom state is unavailable");
    }
    const positionPoint = position as { x: number; y: number; z: number };
    const targetPoint = target as { x: number; y: number; z: number };
    return {
      position: { x: positionPoint.x, y: positionPoint.y, z: positionPoint.z },
      yaw,
      pitch,
      distance,
      requestedDistance,
      freeMove,
      target: { x: targetPoint.x, y: targetPoint.y, z: targetPoint.z },
    };
  });
}

async function readDocumentProbe(targetPage: Page): Promise<DocumentProbe> {
  return targetPage.evaluate(() => {
    const id = Reflect.get(window, "__featureLabGateDocumentId");
    if (typeof id !== "string") throw new Error("Feature-lab document marker is unavailable");
    return {
      id,
      timeOrigin: performance.timeOrigin,
      url: window.location.href,
      oldRuntimeMarkerPresent: Reflect.has(window, "__featureLabGateOldRuntime"),
    };
  });
}

async function waitForState(
  targetPage: Page,
  label: string,
  predicate: (state: FeatureLabState) => boolean,
  timeoutMs = ACTION_BUDGET_MS,
): Promise<FeatureLabState> {
  const deadline = performance.now() + timeoutMs;
  let state: FeatureLabState | null = null;
  let lastReadError: string | null = null;
  while (performance.now() < deadline) {
    try {
      state = await readState(targetPage);
      lastReadError = null;
      if (predicate(state)) return state;
    } catch (cause) {
      // `domcontentloaded` deliberately returns before the asynchronous production boot has
      // installed the lab API. Treat that short startup window as pending readiness.
      lastReadError = cause instanceof Error ? cause.message : String(cause);
    }
    await targetPage.waitForTimeout(POLL_MS);
  }
  throw new Error(
    `${label} did not complete in ${timeoutMs}ms; last state: ${JSON.stringify(state)}; `
    + `last read error: ${lastReadError ?? "none"}`,
  );
}

async function capture(targetPage: Page, filePath: string, captured: string[]): Promise<void> {
  await targetPage.screenshot({
    path: filePath,
    animations: "allow",
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
  captured.push(path.relative(repoRoot, filePath).replaceAll("\\", "/"));
}

async function clearMessageLog(targetPage: Page): Promise<void> {
  // Pointer-path proof can intentionally supersede an in-flight route. Clear those old notices
  // before visual evidence so later melee/spell errors would still remain visible if they occur.
  await targetPage.locator(".msglog").evaluate((root) => root.replaceChildren());
}

async function setToggle(locator: Locator, enabled: boolean): Promise<void> {
  const type = await locator.getAttribute("type");
  if (type === "checkbox") {
    if (enabled) await locator.check();
    else await locator.uncheck();
    return;
  }
  await locator.click();
}

function validateCatalog(catalog: FeatureLabCatalog): Record<string, boolean> {
  const equipmentSlots = catalog.equipment.map((group) => group.slot);
  const skillIds = catalog.skills.map((skill) => skill.id);
  return {
    creatures: catalog.targets.creature.length > 0,
    npcs: catalog.targets.npc.length > 0,
    spells: catalog.spells.length > 0,
    prefabs: catalog.structures.prefabs.length > 0,
    compositions: catalog.structures.compositions.length > 0,
    kits: catalog.structures.kits.length > 0,
    everyEquipmentSlot: sameMembers(equipmentSlots, [...EQUIP_SLOTS]),
    everyEquipmentSlotHasItems: catalog.equipment.every((group) => group.items.length > 0),
    equipmentItemsUniquePerSlot: catalog.equipment.every((group) => (
      new Set(group.items.map((item) => item.id)).size === group.items.length
    )),
    everySkill: sameMembers(skillIds, [...SKILL_IDS]),
  };
}

function structureIsValid(structure: FeatureLabStructureView): boolean {
  const bounds = structure.bounds;
  return structure.ready
    && structure.revision >= 1
    && structure.partCount > 0
    && structure.assetCount > 0
    && structure.collisionCount >= 0
    && Number.isFinite(structure.buildMs)
    && structure.buildMs >= 0
    && bounds !== null
    && [...bounds.min, ...bounds.max].every(Number.isFinite)
    && bounds.max[0] > bounds.min[0]
    && bounds.max[1] > bounds.min[1]
    && bounds.max[2] > bounds.min[2];
}

function sameStructure(before: FeatureLabStructureView, after: FeatureLabStructureView): boolean {
  return before.revision === after.revision
    && before.partCount === after.partCount
    && before.assetCount === after.assetCount
    && before.collisionCount === after.collisionCount
    && JSON.stringify(before.selection) === JSON.stringify(after.selection)
    && JSON.stringify(before.bounds) === JSON.stringify(after.bounds);
}

function selectionMatches(
  actual: FeatureLabStructureSelection,
  expected: FeatureLabStructureSelection,
): boolean {
  return actual.kind === expected.kind
    && actual.id === expected.id
    && actual.kit === expected.kit
    && actual.width === expected.width
    && actual.depth === expected.depth
    && actual.seed === expected.seed;
}

function wallDimensionsSupported(selection: FeatureLabStructureSelection): boolean {
  return selection.kind === "wall-run"
    && selection.id === "wall_run"
    && selection.width >= 6
    && selection.width % 2 === 0
    && selection.depth >= 2
    && selection.depth % 2 === 0
    && selection.depth <= selection.width - 4;
}

function probesShareWorld(combat: RuntimeProbe, building: RuntimeProbe): boolean {
  return combat.ready
    && building.ready
    && combat.regionId === "fallowmarch"
    && building.regionId === combat.regionId
    && combat.navigationStatus === "ready"
    && building.navigationStatus === combat.navigationStatus
    && combat.canvas.id === "viewport"
    && building.canvas.id === combat.canvas.id
    && combat.canvas.webgl
    && building.canvas.webgl
    && combat.canvas.width > 0
    && combat.canvas.height > 0
    && building.canvas.width > 0
    && building.canvas.height > 0
    && (combat.renderer?.drawCalls ?? 0) > 0
    && (combat.renderer?.triangles ?? 0) > 0
    && (building.renderer?.drawCalls ?? 0) > 0
    && (building.renderer?.triangles ?? 0) > 0
    && JSON.stringify(combat.version) === JSON.stringify(building.version)
    && JSON.stringify(combat.groundSamples) === JSON.stringify(building.groundSamples);
}

function screenPoint(state: FeatureLabState, canvas: CanvasBox): Point {
  const screen = state.target?.screen;
  if (!screen) throw new Error("Spawned target has no renderer screen coordinate");
  const [rawX, rawY] = screen;
  const isAbsolute = rawX >= canvas.x
    && rawX <= canvas.x + canvas.width
    && rawY >= canvas.y
    && rawY <= canvas.y + canvas.height;
  const point = isAbsolute
    ? { x: rawX, y: rawY }
    : { x: canvas.x + rawX, y: canvas.y + rawY };
  if (point.x < canvas.x || point.x > canvas.x + canvas.width
    || point.y < canvas.y || point.y > canvas.y + canvas.height) {
    throw new Error(`Target screen point ${screen.join(",")} is outside the production canvas`);
  }
  return point;
}

function chooseGroundPoint(canvas: CanvasBox, target: Point): Point {
  const candidates = [
    { x: canvas.x + canvas.width * 0.4, y: canvas.y + canvas.height * 0.68 },
    { x: canvas.x + canvas.width * 0.32, y: canvas.y + canvas.height * 0.62 },
  ];
  return candidates.sort((a, b) => distance2d(b, target) - distance2d(a, target))[0]
    ?? { x: canvas.x + canvas.width * 0.2, y: canvas.y + canvas.height * 0.72 };
}

function findItem(
  catalog: FeatureLabCatalog,
  slot: EquipSlot,
  pattern: RegExp,
): ItemId | null {
  const group = catalog.equipment.find((candidate) => candidate.slot === slot);
  return group?.items.find((item) => pattern.test(item.label))?.id ?? null;
}

function stackQuantity(
  stacks: readonly { itemId: ItemId; quantity: number }[] | undefined,
  itemId: ItemId,
): number {
  return stacks?.find((stack) => stack.itemId === itemId)?.quantity ?? 0;
}

function healthFell(before: FeatureLabState, after: FeatureLabState): boolean {
  const prior = before.target?.health;
  const current = after.target?.health;
  return typeof prior === "number" && typeof current === "number" && current < prior;
}

function numericFell(values: readonly [number | null | undefined, number | null | undefined]): boolean {
  return typeof values[0] === "number" && typeof values[1] === "number" && values[1] < values[0];
}

function motionAdvanced(before: FeatureLabMotionView | null, after: FeatureLabMotionView | null): boolean {
  return before?.liveRig === true
    && after?.liveRig === true
    && typeof before.time === "number"
    && typeof after.time === "number"
    && Math.abs(after.time - before.time) >= 0.005;
}

function motionMatches(motion: FeatureLabMotionView | null, pattern: RegExp): boolean {
  return pattern.test(`${motion?.pose ?? ""} ${motion?.motion ?? ""} ${motion?.clip ?? ""}`);
}

function distanceXZ(
  before: readonly [number, number, number],
  after: readonly [number, number, number],
): number {
  return Math.hypot(after[0] - before[0], after[2] - before[2]);
}

function distance2d(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameMembers<T>(actual: readonly T[], expected: readonly T[]): boolean {
  if (actual.length !== expected.length) return false;
  const values = new Set(actual);
  return values.size === actual.length && expected.every((value) => values.has(value));
}

function ensureUrl(value: string): URL {
  try {
    return new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new Error(`Game server returned an invalid absolute URL: ${value}`);
  }
}
