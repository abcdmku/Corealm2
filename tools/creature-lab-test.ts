/**
 * Real-Chromium acceptance gate for what a player can DO to a creature, and what it does back.
 *
 * Four interactions, one production boot: aggro, attack, disengage by running, kill, and respawn.
 * `tools/feature-lab-test.ts` proves the lab boots, renders and lands one hit; this proves the
 * creature loop. It is a separate shard because that file is already at its 60-second ceiling and
 * these tests spend most of their time waiting on a 100 ms sim tick rather than on the browser.
 *
 * Nothing here simulates anything. Every actor is a production `SemanticEntity`, every swing goes
 * through `CorealmGameApi`, and `systems/enemyAI.ts` and `systems/combat.ts` own every transition
 * asserted below. The lab only chooses which creature stands where.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type { FeatureLabCatalog, FeatureLabState } from "../game/src/contracts.js";
import { LEASH_METRES } from "../game/src/systems/enemyAI.js";
import { ENEMY_RESPAWN_MS } from "../game/src/systems/combat.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

const TOTAL_BUDGET_MS = Number(process.env["CREATURE_LAB_BUDGET_MS"] ?? 120_000);
const READY_BUDGET_MS = 20_000;
const ACTION_BUDGET_MS = 12_000;
const POLL_MS = 40;

/**
 * The three behaviours in `content/enemies.ts`, one representative each, chosen for what they prove
 * rather than for flavour:
 *
 *  - the hen is the smallest aggro radius in the game (3 m), so a spawn at 8 m is unambiguously
 *    outside it and "it did not move" means passive rather than "it had not noticed yet";
 *  - the billy goat is aggressive at 8 m, so the SAME 6 m spawn that leaves a hen idle must make
 *    the goat charge, and the pair is the actual test;
 *  - the cow is territorial with 16 health, the largest tier 1 pool that is not a boss, which
 *    leaves room to provoke it and still run before it dies.
 */
const CREATURES = {
  passive: { presetId: "marchfield_hens", label: "Marchfield Hen", aggroRadius: 3 },
  aggressive: { presetId: "open_march_goats", label: "Open March Billy", aggroRadius: 8 },
  territorial: { presetId: "redsill_cattle", label: "Marchfield Cow", aggroRadius: 5 },
  /** 12 health, the largest passive pool in the game. It survives long enough to be seen reacting. */
  tough: { presetId: "blackwater_frogs", label: "Blackwater Frog", aggroRadius: 4 },
} as const;

/**
 * The three elemental orb bosses, which share one rig in three colours.
 *
 * Worth their own pass because they are the only entities in the game whose look is carried by an
 * emissive map rather than by a texture and a tier tint, and because a boss that fails to load is
 * a quest that cannot be finished — each of these drops the Orb its element's magic ladder is
 * gated on. `entityViews.prepare` throws on a missing asset, so spawning one at all is the proof.
 */
const BOSSES = [
  { presetId: "tempest_roc", label: "Tempest Roc", assetId: "boss_rhino_air" },
  { presetId: "rootheart", label: "The Rootheart", assetId: "boss_rhino_earth" },
  { presetId: "gravelmaw:ordrun", label: "Ordrun the Quarrykeeper", assetId: "boss_rhino_water" },
] as const;

/**
 * The four regional minibosses: one Monster02 rig in four texture variants, built by named-take
 * selection from a single all-animation FBX. Spawning each one proves the take selector shipped
 * exactly the canonical clip set the renderer keys on, and the drawn-size band proves the 1.3x
 * miniboss scale landed between the ordinary roster and the 1.6x Orb bosses.
 */
const MINIBOSSES = [
  { presetId: "galeskin", label: "Galeskin", assetId: "miniboss_galeskin" },
  { presetId: "mossbound", label: "Mossbound", assetId: "miniboss_mossbound" },
  { presetId: "tideworn", label: "Tideworn", assetId: "miniboss_tideworn" },
  { presetId: "cinderwake", label: "Cinderwake", assetId: "miniboss_cinderwake" },
] as const;

/** Inside the goat's 8 m radius and well outside the hen's 3 m. One distance, opposite outcomes. */
const AGGRO_PROBE_DISTANCE = 6;

/** A blade, any tier. At the combat level below it kills a tier 1 animal in a swing or two. */
const KILL_WEAPON = /kaldite_sword|corven_sword|grithe_sword/;

/**
 * Combat level for the damage tests, deliberately NOT the lab's default 99.
 *
 * Two reasons, both discovered by this gate failing at 99. `state/store.ts: addSkillXp` clamps xp
 * to `totalXpAt(99)`, so a character already at the cap gains literally nothing from a kill and
 * "did that pay XP?" is unanswerable — the lab sets every skill to 99 during setup. And a level 99 swing one-shots every tier 1 animal, which
 * leaves no tick in which to watch a passive creature decide to fight back.
 */
const COMBAT_TEST_LEVEL = 20;

interface AggroEvidence {
  label: string;
  behaviour: string | undefined;
  aggroRadius: number | undefined;
  spawnedAtMetres: number | undefined;
  observedStates: string[];
  closedDistance: boolean;
  engaged: boolean;
}

interface AttackEvidence {
  label: string;
  weaponId: string | null;
  startedAtFullHealth: boolean;
  health: [number | null | undefined, number | null | undefined];
  combatStarted: [number, number];
  becameAggro: boolean;
  motionAdvanced: boolean;
}

interface FleeEvidence {
  label: string;
  provokedToAggro: boolean;
  maxDistanceFromSpawn: number;
  leashMetres: number;
  chasedPastLeash: boolean;
  observedStates: string[];
  returned: boolean;
  cameHome: boolean;
  finalDistanceFromSpawn: number;
  /** First sample, last sample, and how many distinct distances the walk home produced. */
  returnTrace: [number | null, number | null, number];
}

interface KillEvidence {
  label: string;
  entityId: string;
  attackCommands: number;
  healthTrace: number[];
  entityState: string | undefined;
  aiState: string | undefined;
  health: number | null | undefined;
  respawnScheduledMs: number | null;
  expectedRespawnMs: number;
  xpGained: number;
}

interface BossEvidence {
  label: string;
  presetId: string;
  expectedAssetId: string;
  spawned: boolean;
  archetype: string | undefined;
  maxHealth: number | null;
  aggroRadius: number;
  level: number;
  behaviour: string | undefined;
  /** Longest ground axis at the size it is drawn, from the entity's own body radius. */
  drawnMetres: number;
}

interface CorpsePickEvidence {
  label: string;
  entityId: string;
  fadedOut: boolean;
  fade: number | null;
  clickedAt: readonly [number, number] | null;
  selectedBeforeDeath: string | null;
  selectedAfterFade: string | null;
  stillSelectable: boolean;
}

interface RespawnEvidence {
  label: string;
  skippedSeconds: number;
  aiState: string | undefined;
  entityState: string | undefined;
  health: number | null | undefined;
  maxHealth: number | null | undefined;
  backAtSpawn: boolean;
  distanceFromSpawn: number;
  respawnCleared: boolean;
}

const started = performance.now();
const clearDeadline = installTestDeadline("creature interaction lab gate", TOTAL_BUDGET_MS);
const screenshotDir = path.join(repoRoot, "test-results", "creature-lab");
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const screenshots: string[] = [];
let server: RunningGameServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let stage = "startup";

try {
  await mkdir(screenshotDir, { recursive: true });
  const externalUrl = argValue(process.argv.slice(2), "--url");
  server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`[${stage}] ${message.text()}`);
  });
  page.on("pageerror", (error) => pageErrors.push(`[${stage}] ${error.stack ?? error.message}`));

  stage = "boot";
  const url = new URL("/index.html?mode=combat", ensureUrl(server.url));
  const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: READY_BUDGET_MS });
  if (!response?.ok()) {
    throw new Error(`combat lab returned HTTP ${response?.status() ?? "no response"}: ${url.href}`);
  }
  const ready = await waitForState(page, "combat lab readiness", (state) => (
    state.ready
    && state.engine === "corealm-production"
    && state.mode === "combat"
    && state.target !== null
    && state.playerMotion?.liveRig === true
  ), READY_BUDGET_MS);

  const catalog = await readCatalog(page);
  const presetChecks = Object.fromEntries(
    Object.entries(CREATURES).map(([behaviour, creature]) => [
      behaviour,
      catalog.targets.creature.some((preset) => preset.id === creature.presetId),
    ]),
  );
  const missingPresets = Object.entries(presetChecks)
    .filter(([, present]) => !present)
    .map(([behaviour]) => `${behaviour}:${CREATURES[behaviour as keyof typeof CREATURES].presetId}`);
  if (missingPresets.length > 0) {
    throw new Error(`Feature lab catalog is missing creature presets: ${missingPresets.join(", ")}`);
  }

  const weapon = catalog.equipment
    .find((row) => row.slot === "mainHand")?.items
    .find((item) => KILL_WEAPON.test(item.id))?.id ?? null;
  if (!weapon) throw new Error("Feature lab has no melee weapon to kill with");

  // ---------------------------------------------------------------- 1. aggro
  //
  // Same spawn distance for both, opposite expected outcomes. Running them as a pair is the point:
  // a lone "the goat charged" could be any creature charging, and a lone "the hen did not" could be
  // an AI that never ticked.
  stage = "aggro";
  const aggressiveAggro = await observeAggro(page, CREATURES.aggressive, AGGRO_PROBE_DISTANCE);
  await capture(page, path.join(screenshotDir, "aggro-aggressive.png"));
  const passiveAggro = await observeAggro(page, CREATURES.passive, AGGRO_PROBE_DISTANCE);

  // --------------------------------------------------------------- 2. attack
  //
  // Bare-handed and at a modest level on purpose: a passive creature only reveals itself by what it
  // does AFTER the first hit, and a one-shot kill skips that entirely.
  stage = "attack";
  await setCombatLevels(page, COMBAT_TEST_LEVEL);
  await equipMainHand(page, null);
  const attack = await observeAttack(page, CREATURES.tough);
  await capture(page, path.join(screenshotDir, "attack-melee.png"));

  // ----------------------------------------------------------------- 3. flee
  stage = "flee";
  await equipMainHand(page, weapon);
  const flee = await observeFlee(page, CREATURES.territorial);
  await capture(page, path.join(screenshotDir, "flee-leash.png"));

  // ------------------------------------------------------- 4. kill and respawn
  stage = "kill";
  await equipMainHand(page, weapon);
  const canvasBox = await page.locator("#viewport").boundingBox();
  if (!canvasBox) throw new Error("Production canvas has no visible bounds");
  const kill = await observeKill(page, CREATURES.passive);
  await capture(page, path.join(screenshotDir, "kill-corpse.png"));

  stage = "corpse-pick";
  const corpsePick = await observeCorpsePick(page, canvasBox);
  await capture(page, path.join(screenshotDir, "corpse-faded.png"));

  stage = "respawn";
  const respawn = await observeRespawn(page, CREATURES.passive);
  await capture(page, path.join(screenshotDir, "respawn.png"));

  // --------------------------------------------------------------- 5. bosses
  stage = "bosses";
  const bosses: BossEvidence[] = [];
  for (const boss of BOSSES) {
    bosses.push(await observeBoss(page, boss));
    await capture(page, path.join(screenshotDir, `boss-${boss.assetId}.png`));
  }

  stage = "minibosses";
  const minibosses: BossEvidence[] = [];
  for (const boss of MINIBOSSES) {
    minibosses.push(await observeBoss(page, boss));
    await capture(page, path.join(screenshotDir, `miniboss-${boss.assetId}.png`));
  }

  const final = await readState(page);
  const bossCatalog = Object.fromEntries([...BOSSES, ...MINIBOSSES].map((boss) => [
    boss.presetId,
    catalog.targets.creature.some((preset) => preset.id === boss.presetId),
  ]));

  const checks = {
    labBootedProductionCombat: ready.engine === "corealm-production" && ready.mode === "combat",
    everyBehaviourHasAPreset: Object.values(presetChecks).every(Boolean),

    aggressiveChargesUnprovoked: aggressiveAggro.engaged && aggressiveAggro.closedDistance,
    aggressiveReportsItsAuthoredRadius:
      aggressiveAggro.aggroRadius === CREATURES.aggressive.aggroRadius
      && aggressiveAggro.behaviour === "aggressive",
    passiveIgnoresThePlayerAtTheSameDistance: !passiveAggro.engaged,
    passiveReportsItsAuthoredRadius:
      passiveAggro.aggroRadius === CREATURES.passive.aggroRadius
      && passiveAggro.behaviour === "passive",

    attackDamagesTheCreature:
      attack.startedAtFullHealth && numericFell(attack.health)
      && attack.combatStarted[1] > attack.combatStarted[0],
    attackMakesAPassiveFightBack: attack.becameAggro,
    attackPlaysTheSwingAnimation: attack.motionAdvanced,

    fleeIsPrecededByARealChase: flee.provokedToAggro && flee.chasedPastLeash,
    fleeMakesTheCreatureGiveUp: flee.returned,
    fleeSendsItHomeToItsSpawn: flee.cameHome,

    killLeavesACorpse: kill.entityState === "dead" && kill.aiState === "dead" && kill.health === 0,
    killPaysCombatXp: kill.xpGained > 0,
    corpseStopsBeingClickableOnceItHasGone: corpsePick.fadedOut && !corpsePick.stillSelectable,

    killSchedulesTheAuthoredRespawn: kill.respawnScheduledMs !== null
      && kill.respawnScheduledMs > kill.expectedRespawnMs * 0.9
      && kill.respawnScheduledMs <= kill.expectedRespawnMs,

    respawnBringsItBackAlive: respawn.aiState === "idle" && respawn.entityState === "alive",
    respawnRestoresFullHealth: respawn.health !== null && respawn.health === respawn.maxHealth,
    respawnPutsItBackAtItsSpawn: respawn.backAtSpawn && respawn.respawnCleared,

    everyOrbBossHasAPreset: Object.values(bossCatalog).every(Boolean),
    everyOrbBossSpawnsWithItsRig: bosses.every((boss) => boss.spawned && boss.archetype === "boss"),
    everyOrbBossCarriesItsStatBlock: bosses.every((boss) => (
      boss.maxHealth !== null && boss.maxHealth > 0 && boss.aggroRadius > 0 && boss.level > 0
    )),
    orbBossesAreVisiblyBigger: bosses.every((boss) => boss.drawnMetres > 3),

    everyMinibossSpawnsWithItsRig:
      minibosses.every((boss) => boss.spawned && boss.archetype === "boss"),
    everyMinibossCarriesItsStatBlock: minibosses.every((boss) => (
      boss.maxHealth !== null && boss.maxHealth > 0 && boss.aggroRadius > 0 && boss.level > 0
    )),
    // The Monster02 rig is 0.93 x 0.65 m on the ground; at 1.3x and the tier silhouette the
    // widest axis lands between ~1.1 m (tier 1) and ~1.5 m (tier 20) - clearly not the 3 m+
    // Orb-boss read, and clearly bigger than a hen.
    minibossesDrawBetweenRosterAndBosses:
      minibosses.every((boss) => boss.drawnMetres > 0.9 && boss.drawnMetres < 3),

    screenshotsCaptured: screenshots.length >= 9,
    noRuntimeErrors: final.errors.length === 0
      && consoleErrors.length === 0 && pageErrors.length === 0,
    withinBudget: performance.now() - started < TOTAL_BUDGET_MS,
  };
  const passed = Object.values(checks).every(Boolean);

  const report = {
    passed,
    elapsedMs: Math.round(performance.now() - started),
    url: server.url,
    checks,
    evidence: {
      aggro: { aggressive: aggressiveAggro, passive: passiveAggro },
      attack,
      flee,
      kill,
      corpsePick,
      respawn,
      bosses,
      minibosses,
      bossCatalog,
    },
    screenshots,
    errors: { runtime: final.errors, console: consoleErrors, page: pageErrors },
  };
  const reportJson = JSON.stringify(report, null, 2);
  await writeFile(path.join(screenshotDir, "report.json"), reportJson + "\n");
  console.log(reportJson);
  process.exitCode = passed ? 0 : 1;
} catch (cause) {
  const failureState = await page?.evaluate(() => {
    const state = window.__featureLab?.getState();
    const debug = (window as unknown as {
      __gameDebug?: { getEvents?: () => { events: unknown[] } };
    }).__gameDebug;
    return {
      player: state?.player,
      target: state?.target,
      movement: state?.movement,
      counters: state?.counters,
      errors: state?.errors,
      events: debug?.getEvents?.().events.slice(-64),
    };
  }).catch((error: unknown) => ({ readError: String(error) })) ?? null;
  const report = {
    passed: false,
    stage,
    elapsedMs: Math.round(performance.now() - started),
    error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    errors: { console: consoleErrors, page: pageErrors },
    failureState,
    screenshots,
  };
  const reportJson = JSON.stringify(report, null, 2);
  await writeFile(path.join(screenshotDir, "report.json"), reportJson + "\n");
  console.error(reportJson);
  process.exitCode = 1;
} finally {
  clearDeadline();
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
}

// ------------------------------------------------------------------- the four interactions

/**
 * Spawns one creature at a fixed distance and watches it for a beat WITHOUT touching it.
 *
 * The whole assertion is what happens when the player does nothing, so this deliberately samples
 * over a window rather than reading once: an aggressive creature needs a tick to notice and a few
 * more to cover ground, and reading immediately after the spawn would call every creature idle.
 */
async function observeAggro(
  targetPage: Page,
  creature: { presetId: string; label: string; aggroRadius: number },
  distance: number,
): Promise<AggroEvidence> {
  const spawned = await spawn(targetPage, creature.presetId, distance);
  const spawnedAtMetres = spawned.target?.ai?.distanceFromPlayer;
  const observedStates: string[] = [];
  let closest = spawnedAtMetres ?? Number.POSITIVE_INFINITY;
  let engaged = false;
  const settled = await sample(targetPage, 3_000, (state) => {
    const ai = state.target?.ai;
    if (!ai) return;
    if (observedStates.at(-1) !== ai.state) observedStates.push(ai.state);
    if (ai.state === "aggro") engaged = true;
    closest = Math.min(closest, ai.distanceFromPlayer);
  });
  return {
    label: creature.label,
    behaviour: settled.target?.ai?.behaviour,
    aggroRadius: settled.target?.ai?.aggroRadius,
    spawnedAtMetres,
    observedStates,
    // Half a metre, not zero: an idle creature still drifts a few centimetres as separation and
    // ground snapping settle it, and calling that "closed the distance" would pass on noise.
    closedDistance: spawnedAtMetres !== undefined && closest < spawnedAtMetres - 0.5,
    engaged,
  };
}

/** One swing at a creature that would never have started the fight, and what it costs it. */
async function observeAttack(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<AttackEvidence> {
  const before = await spawn(targetPage, creature.presetId, 6);
  const weaponId = before.equipment.mainHand;
  await perform(targetPage, "attack");
  let motionAdvanced = false;
  let becameAggro = false;
  const after = await waitForState(targetPage, "melee damage on a passive creature", (state) => {
    motionAdvanced ||= motionMoved(before.playerMotion, state.playerMotion)
      && /attack|melee/i.test(state.playerMotion?.clip ?? "");
    becameAggro ||= state.target?.ai?.state === "aggro";
    return state.counters.combatStarted > before.counters.combatStarted
      && healthFell(before, state)
      && motionAdvanced;
  });
  return {
    label: creature.label,
    weaponId,
    startedAtFullHealth: before.target?.health !== null
      && before.target?.health === before.target?.maxHealth,
    health: [before.target?.health, after.target?.health],
    combatStarted: [before.counters.combatStarted, after.counters.combatStarted],
    becameAggro,
    motionAdvanced,
  };
}

/**
 * Provokes a territorial creature, then runs, and follows it all the way home.
 *
 * This is the interaction with the most moving parts and the one most worth having: `enemyAI.ts`
 * claims a player outruns a pursuer (4.2 m/s against about 3.1) and that everything leashes 28 m
 * from its own spawn. Both halves are asserted here from the AI's own runtime rather than inferred
 * from positions, and the creature is followed past "gave up" to "standing where it started".
 */
async function observeFlee(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<FleeEvidence> {
  await spawn(targetPage, creature.presetId, 5);
  await perform(targetPage, "attack");
  const provoked = await waitForState(targetPage, "provoking a territorial creature", (state) => (
    state.target?.ai?.state === "aggro"
  ));

  await perform(targetPage, "flee");
  const observedStates: string[] = [];
  let maxDistanceFromSpawn = provoked.target?.ai?.distanceFromSpawn ?? 0;
  let chasedPastLeash = false;
  let returned = false;
  const chased = await waitForState(targetPage, "creature chases then leashes", (state) => {
    const ai = state.target?.ai;
    if (!ai) return false;
    if (observedStates.at(-1) !== ai.state) observedStates.push(ai.state);
    maxDistanceFromSpawn = Math.max(maxDistanceFromSpawn, ai.distanceFromSpawn);
    // Half a metre of slack. `enemyAI` flips to `returning` on the same tick it passes the leash,
    // so the sample that would read exactly 28 m is the one the AI has already replaced. What is
    // being asserted is "it chased the full leash", not "a poll caught the crossing frame".
    chasedPastLeash ||= ai.distanceFromSpawn >= LEASH_METRES - 0.5;
    returned ||= ai.state === "returning";
    return returned;
  }, ACTION_BUDGET_MS * 2);

  // Walking home is a fixed 3.6 m/s from wherever it gave up, so ~8 s from the leash. Trace the
  // distance rather than only the outcome: "it never arrived" and "it never moved" are different
  // bugs, and the trace is what tells them apart.
  const returnTrace: number[] = [];
  const home = await waitForState(targetPage, "creature walks home and settles", (state) => {
    const ai = state.target?.ai;
    if (!ai) return false;
    if (observedStates.at(-1) !== ai.state) observedStates.push(ai.state);
    if (returnTrace.at(-1) !== ai.distanceFromSpawn) returnTrace.push(ai.distanceFromSpawn);
    return ai.state === "idle" && ai.distanceFromSpawn < 1.5;
  }, ACTION_BUDGET_MS * 3).catch(() => readState(targetPage));

  const finalDistanceFromSpawn = home.target?.ai?.distanceFromSpawn ?? Number.POSITIVE_INFINITY;
  return {
    label: creature.label,
    provokedToAggro: provoked.target?.ai?.state === "aggro",
    maxDistanceFromSpawn: Math.round(maxDistanceFromSpawn * 100) / 100,
    leashMetres: LEASH_METRES,
    chasedPastLeash,
    observedStates,
    returned,
    cameHome: home.target?.ai?.state === "idle" && finalDistanceFromSpawn < 1.5,
    finalDistanceFromSpawn,
    returnTrace: [returnTrace.at(0) ?? null, returnTrace.at(-1) ?? null, returnTrace.length],
  };
}

/** One attack command must carry the fight through death without help from the test. */
async function observeKill(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<KillEvidence> {
  const before = await spawn(targetPage, creature.presetId, 5);
  const target = before.target;
  if (!target || target.state !== "alive" || target.ai?.state === "dead"
    || target.health === null || target.health <= 0 || target.health !== target.maxHealth) {
    throw new Error(`Kill requires a living full-health target: ${JSON.stringify(target)}`);
  }
  const xpBefore = await readCombatXp(targetPage);
  const healthTrace = [target.health];
  // The production attack owns pursuit and cadence. Reissuing from a stale snapshot can race a
  // lethal contact, and would also conceal a fight that incorrectly stopped pursuing its target.
  await perform(targetPage, "attack");
  const dead = await waitForState(targetPage, "one attack command commits the creature's death", (next) => {
    const current = next.target;
    if (current?.entityId !== target.entityId) return false;
    if (current.health !== null && healthTrace.at(-1) !== current.health) {
      healthTrace.push(current.health);
    }
    return current.state === "dead" && current.health === 0
      && current.ai?.state === "dead" && current.ai.respawnInMs !== null
      && next.counters.combatStarted > before.counters.combatStarted;
  }, ACTION_BUDGET_MS * 2);
  return {
    label: creature.label,
    entityId: target.entityId,
    attackCommands: 1,
    healthTrace,
    entityState: dead.target?.state,
    aiState: dead.target?.ai?.state,
    health: dead.target?.health,
    respawnScheduledMs: dead.target?.ai?.respawnInMs ?? null,
    expectedRespawnMs: ENEMY_RESPAWN_MS,
    xpGained: (await readCombatXp(targetPage)) - xpBefore,
  };
}

/**
 * Skips the sim clock past the corpse timer and waits for the creature to stand back up.
 *
 * `__gameDebug.advanceGameTime` jumps `SimClock.elapsedMs` without simulating the frames between,
 * which is exactly right here: `enemyAI.respawnDead` compares the deadline against the clock on its
 * next ordinary tick, so the respawn that follows is the production one and not a forced reset.
 */
async function observeRespawn(
  targetPage: Page,
  creature: { presetId: string; label: string },
): Promise<RespawnEvidence> {
  const skippedSeconds = Math.ceil(ENEMY_RESPAWN_MS / 1_000) + 1;
  await targetPage.evaluate((seconds) => {
    const debug = (window as unknown as {
      __gameDebug?: { advanceGameTime?: (value: number) => void };
    }).__gameDebug;
    if (!debug?.advanceGameTime) throw new Error("__gameDebug.advanceGameTime is unavailable");
    debug.advanceGameTime(seconds);
  }, skippedSeconds);

  const alive = await waitForState(targetPage, "creature respawns", (state) => (
    state.target?.ai?.state === "idle" && state.target?.state === "alive"
  ), ACTION_BUDGET_MS);
  const ai = alive.target?.ai;
  return {
    label: creature.label,
    skippedSeconds,
    aiState: ai?.state,
    entityState: alive.target?.state,
    health: alive.target?.health,
    maxHealth: alive.target?.maxHealth,
    backAtSpawn: (ai?.distanceFromSpawn ?? Number.POSITIVE_INFINITY) < 0.5,
    distanceFromSpawn: ai?.distanceFromSpawn ?? Number.POSITIVE_INFINITY,
    respawnCleared: ai?.respawnInMs === null,
  };
}

/**
 * Spawns one orb boss and reads back what the world gave it.
 *
 * The spawn itself is most of the assertion: `featureLab/runtime.ts` runs `entityViews.prepare`
 * before it will accept a target and throws on a missing asset, so a boss whose rig failed to
 * build or was dropped from the manifest cannot reach this point at all.
 */
async function observeBoss(
  targetPage: Page,
  boss: { presetId: string; label: string; assetId: string },
): Promise<BossEvidence> {
  // Well outside the widest authored aggro radius (22 m, the Rootheart) so the boss is measured
  // standing still rather than mid-charge, and the screenshot frames the whole animal.
  const state = await spawn(targetPage, boss.presetId, 30);
  const ai = state.target?.ai;
  const archetype = await targetPage.evaluate((entityId) => {
    const debug = (window as unknown as {
      __gameDebug?: { getEntities?: () => { id: string; archetype?: string }[] };
    }).__gameDebug;
    return debug?.getEntities?.().find((entity) => entity.id === entityId)?.archetype;
  }, state.target?.entityId ?? "");
  return {
    label: boss.label,
    presetId: boss.presetId,
    expectedAssetId: boss.assetId,
    spawned: state.target?.presetId === boss.presetId,
    archetype,
    maxHealth: state.target?.maxHealth ?? null,
    aggroRadius: ai?.aggroRadius ?? 0,
    level: ai?.level ?? 0,
    behaviour: ai?.behaviour,
    // `bodyRadius` is half the widest ground axis at drawn scale, so doubling it is the creature's
    // footprint in metres. A boss under 3 m across is not reading as a boss.
    drawnMetres: Math.round((ai?.bodyRadius ?? 0) * 200) / 100,
  };
}

/**
 * Waits for the corpse to dissolve, then clicks exactly where it was.
 *
 * A dead creature is drawn for a couple of seconds and then gone, and "gone" has to mean gone from
 * the pointer too. It did not: the expanded capsule in `render/entityViews.ts: expandedCharacterPicks`
 * is invisible by design, so it kept answering the raycast for the whole 30 second respawn after
 * both draw paths had switched the body off — clicking bare grass selected an animal that was not
 * there. Reported from play, which is the only place it shows.
 */
async function observeCorpsePick(
  targetPage: Page,
  canvas: { x: number; y: number; width: number; height: number },
): Promise<CorpsePickEvidence> {
  const dead = await readState(targetPage);
  const entityId = dead.target?.entityId ?? "";
  const label = dead.target?.name ?? "";
  const selectedBeforeDeath = dead.selectedEntityId;

  // Poll the renderer's own fade rather than guessing a duration: `corpseLinger` is derived from
  // the creature's death clip, so every animal dissolves on its own schedule.
  const faded = await waitFor(targetPage, "corpse dissolves", async () => (
    (await readDrawnFade(targetPage, entityId)) >= 1
  ), ACTION_BUDGET_MS);
  const fade = await readDrawnFade(targetPage, entityId);

  // Where the body was, in screen space. `projectEntity` still resolves it: the entity is in the
  // store with a position, it just is not drawn any more, which is precisely the trap.
  const point = dead.target?.screen ?? null;
  if (point) {
    await targetPage.mouse.click(
      Math.min(Math.max(point[0], canvas.x + 1), canvas.x + canvas.width - 1),
      Math.min(Math.max(point[1], canvas.y + 1), canvas.y + canvas.height - 1),
    );
    // A click that selects something updates state on the next frame; give it several.
    await targetPage.waitForTimeout(400);
  }
  const after = await readState(targetPage);

  return {
    label,
    entityId,
    fadedOut: faded,
    fade,
    clickedAt: point,
    selectedBeforeDeath,
    selectedAfterFade: after.selectedEntityId,
    stillSelectable: after.selectedEntityId === entityId,
  };
}

async function readDrawnFade(targetPage: Page, entityId: string): Promise<number> {
  return targetPage.evaluate((id) => {
    const debug = (window as unknown as {
      __gameDebug?: { getDrawnBounds?: (value: string) => { fade?: number } | null };
    }).__gameDebug;
    return debug?.getDrawnBounds?.(id)?.fade ?? 0;
  }, entityId);
}

/** Polls an async predicate. Returns whether it became true rather than throwing. */
async function waitFor(
  targetPage: Page,
  _label: string,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return true;
    await targetPage.waitForTimeout(POLL_MS);
  }
  return false;
}

// ------------------------------------------------------------------------------ browser helpers

async function spawn(targetPage: Page, presetId: string, distance: number): Promise<FeatureLabState> {
  await targetPage.evaluate(async ({ id, metres }) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.spawnTarget("creature", id, { distance: metres });
  }, { id: presetId, metres: distance });
  // The AI registers the creature on its next tick, so its runtime is not readable the instant the
  // spawn resolves. Waiting for it here keeps every caller from re-deriving that.
  return waitForState(targetPage, `creature ${presetId} enters the simulation`, (state) => (
    state.target?.presetId === presetId && state.target?.ai !== null
  ));
}

async function perform(targetPage: Page, action: "attack" | "cast" | "flee" | "reset-player"): Promise<void> {
  await targetPage.evaluate(async (value) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform(value as never);
  }, action);
}

/** Drops the two combat skills off the lab's default 99 so damage and XP are both observable. */
async function setCombatLevels(targetPage: Page, level: number): Promise<void> {
  await targetPage.evaluate((value) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    for (const skill of ["melee", "magic"] as const) api.setLevel(skill, value);
  }, level);
}

async function equipMainHand(targetPage: Page, itemId: string | null): Promise<void> {
  await targetPage.evaluate(async (value) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.equipPlayer("mainHand", value as never);
  }, itemId);
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
      lastReadError = cause instanceof Error ? cause.message : String(cause);
    }
    await targetPage.waitForTimeout(POLL_MS);
  }
  throw new Error(
    `${label} did not complete in ${timeoutMs}ms; last target: ${JSON.stringify(state?.target ?? null)}; `
    + `last read error: ${lastReadError ?? "none"}`,
  );
}

/** Polls for a fixed window and returns the final state. Used when NOT happening is the assertion. */
async function sample(
  targetPage: Page,
  windowMs: number,
  observe: (state: FeatureLabState) => void,
): Promise<FeatureLabState> {
  const deadline = performance.now() + windowMs;
  let state = await readState(targetPage);
  observe(state);
  while (performance.now() < deadline) {
    await targetPage.waitForTimeout(POLL_MS);
    state = await readState(targetPage);
    observe(state);
  }
  return state;
}

async function capture(targetPage: Page, filePath: string): Promise<void> {
  await targetPage.screenshot({ path: filePath, animations: "disabled", timeout: 5_000 });
  screenshots.push(path.relative(repoRoot, filePath));
}

/**
 * Combat XP straight out of the store, via `__gameDebug`.
 *
 * `FeatureLabState.levels` cannot answer this: the lab sets every skill to 99 during setup, so a
 * kill that pays XP moves no level and the lab's own view of skills does not change at all.
 */
async function readCombatXp(targetPage: Page): Promise<number> {
  return targetPage.evaluate(() => {
    const debug = (window as unknown as {
      __gameDebug?: { getState?: () => { skills?: Record<string, { xp?: number }> } };
    }).__gameDebug;
    const skills = debug?.getState?.().skills;
    if (!skills) throw new Error("__gameDebug.getState().skills is unavailable");
    return ["melee", "magic"].reduce((total, id) => total + (skills[id]?.xp ?? 0), 0);
  });
}

function healthFell(before: FeatureLabState, after: FeatureLabState): boolean {
  return numericFell([before.target?.health, after.target?.health]);
}

function numericFell(pair: [number | null | undefined, number | null | undefined]): boolean {
  const [before, after] = pair;
  return typeof before === "number" && typeof after === "number" && after < before;
}

function motionMoved(
  before: FeatureLabState["playerMotion"],
  after: FeatureLabState["playerMotion"],
): boolean {
  if (!before || !after) return false;
  if (after.clip !== before.clip) return true;
  return typeof before.time === "number" && typeof after.time === "number"
    && Math.abs(after.time - before.time) > 1e-3;
}

function ensureUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
