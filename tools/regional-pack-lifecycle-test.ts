/**
 * One natural regional pack lifecycle per invocation, through the production
 * `?mode=combat&rpg=1&pack=<id>` fixture. Root schedules these serially on the GPU.
 *
 * Proves, in order: idle patrol inside the habitat with body separation, aggro and pursuit,
 * enemy damage at the attack clip's contact marker, a flinch on the resident the player hits,
 * death with kill XP and the natural loot roll (a dropped pile is picked up through the real
 * interaction), post-combat return to the habitat with resumed ranging order, and respawn at full
 * health on the normal clock. Screenshots are review material; semantic state is the evidence.
 *
 *   npx tsx tools/regional-pack-lifecycle-test.ts --url http://127.0.0.1:4183 --pack pack_fallowmarch_kiln_track_west_patrol
 *
 * Retained goblin/skeleton/zombie/wraith/golem bodies are not public. When the pack's asset is
 * missing from `game/public/assets/manifest.json`, the pinned retained catalogue is served into
 * this browser context only, and only that pack's model route is installed.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import type { GameEvent, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { enemyCombatLevel } from "../game/src/content/index.js";
import { RPG_BESTIARY_BY_ID } from "../game/src/content/rpgBestiary.js";
import { REGIONAL_PACK_LAYOUT } from "../game/src/content/regionalPackLayout.js";
import { REGIONAL_PACKS } from "../game/src/content/regionalPacks.js";
import { createRpgRegionalPackCatalogue, RPG_REGIONAL_PACK_PLAN } from "../game/src/content/rpgRegionalPacks.js";
import { CREATURE_MOTION_TIMING } from "../game/src/content/creatureMotionTiming.js";
import { ENEMY_RESPAWN_MS } from "../game/src/systems/combat.js";
import { installAssetCandidates } from "./lib/assetCandidates.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

interface PackDebug {
  getState(): { health: number; maxHealth: number; currency: number; skills: { melee: { xp: number } }; clock: { timeScale: number }; inventory?: unknown };
  getEntity(id: string): SemanticEntity | null;
  getEvents(since?: number): { events: GameEvent[]; nextSeq: number };
  getErrors(): unknown[];
  setHealth(value: number): void;
  getEntityMotion(id: string): MotionSnapshot | null;
  getPlayerPosition(): { x: number; y: number; z: number };
  groundHeight(x: number, z: number): number;
  inspectPose(pose: Record<string, unknown>): boolean;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
interface MotionSnapshot {
  motion: string | null; clip: string | null; time: number | null; duration: number | null; liveRig: boolean; path: string | null;
  hitOverlay: { clip: string; time: number; weight: number; active: true } | null;
}
interface PackFixture { packId: string; ids: string[]; habitat: { centre: [number, number]; radius: number; anchors: [number, number][]; activity: string; dressing: unknown[] }; spawn: Vec3 }
type DebugState = ReturnType<PackDebug["getState"]>;
interface Sample { fixture: PackFixture; entities: SemanticEntity[]; state: DebugState; player: { x: number; y: number; z: number }; events: GameEvent[]; motions: (MotionSnapshot | null)[] }

/** Historical case aliases from the three-case version of this helper. */
const CASES: Record<string, string> = {
  melee: "pack_fallowmarch_kiln_track_west_patrol",
  ranged: "pack_fallowmarch_palewood_northwest_watch",
  magic: "pack_fallowmarch_kiln_track_east_watch",
};
/** Held species never enter the browser through this helper. */
const HELD_SPECIES: Readonly<Record<string, string>> = {
  iron_golem: "Iron Golem material is unresolved (reads as brown rock); FINISH-INTEGRATION.md",
};
const RETAINED_CATALOGUE = "art/rebuild/candidates/finish-bestiary/retained-unhorned15/catalog.json";
const RETAINED_SHA256 = "3272d559169c9072ae3b8f3a592dcc3d92162fc9069b7b2926bc13a12bb5de63";
const ATTACK_CLIP = /attack|bite|sting|slam|punch|strike|shoot|cast|swing|smash/i;
const ARRIVAL_METRES = 0.8;

type Measured = { id: string; file: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } };

type Point = Vec3 | { x: number; z: number };
function xz(point: Point): [number, number] {
  if (Array.isArray(point)) return [point[0], point[2]];
  const record = point as { x: number; z: number };
  return [record.x, record.z];
}
function distance(a: Point, b: Point): number {
  const [ax, az] = xz(a), [bx, bz] = xz(b);
  return Math.hypot(ax - bx, az - bz);
}
function separation(entities: SemanticEntity[]): number {
  let gap = Infinity;
  for (let a = 0; a < entities.length; a++) for (let b = a + 1; b < entities.length; b++) {
    const first = entities[a]!, second = entities[b]!;
    if (first.state === "dead" || second.state === "dead") continue;
    gap = Math.min(gap, distance(first.position, second.position) - first.combat!.bodyRadius! - second.combat!.bodyRadius!);
  }
  return gap;
}
function round(value: number, digits = 3): number { const f = 10 ** digits; return Math.round(value * f) / f; }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const caseId = argValue(args, "--case");
  const packId = argValue(args, "--pack") ?? (caseId ? CASES[caseId] : undefined);
  if (!packId) throw new Error("--pack <regional pack id> is required (or a historical --case melee|ranged|magic)");
  const plan = RPG_REGIONAL_PACK_PLAN.find((row) => row.packId === packId);
  const original = REGIONAL_PACKS.find((row) => row.id === packId);
  if (!plan || !original) throw new Error(`Unknown regional pack: ${packId}`);
  if (plan.speciesId && HELD_SPECIES[plan.speciesId]) throw new Error(`Pack ${packId} is held: ${HELD_SPECIES[plan.speciesId]}`);
  const budgetMs = Number(argValue(args, "--budget-ms") ?? 200_000);
  const clearDeadline = installTestDeadline(`Regional pack lifecycle ${packId}`, budgetMs);

  // Resolve the pack exactly as the fixture will, from real measurements, before any browser starts.
  const publicManifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8")) as { assets: Measured[] };
  const cataloguePath = path.resolve(repoRoot, argValue(args, "--catalogue") ?? RETAINED_CATALOGUE);
  const catalogueText = await readFile(cataloguePath, "utf8");
  // The pin is the committed LF blob. An autocrlf checkout rewrites only line endings; the GLB
  // and texture bytes are hashed separately by the installer.
  const catalogueSha256 = createHash("sha256").update(catalogueText.split("\r\n").join("\n")).digest("hex");
  if (path.resolve(repoRoot, RETAINED_CATALOGUE) === cataloguePath && catalogueSha256 !== RETAINED_SHA256)
    throw new Error("Retained catalogue changed; root must review the new bytes before this helper serves them");
  const staged = JSON.parse(catalogueText) as { assets: Measured[] };
  const measurements = new Map([...publicManifest.assets, ...staged.assets].map((row) => [row.id, row]));
  const catalogue = createRpgRegionalPackCatalogue((id) => measurements.get(id) ?? null, [packId]);
  const pack = catalogue.packs[0]!;
  const variants = new Map(catalogue.variants.map((row) => [row.id, row]));
  const baseStats = variants.get(pack.members[0]!.variantId)!.stats;
  const species = plan.speciesId ? RPG_BESTIARY_BY_ID.get(plan.speciesId) : undefined;
  const assetPublic = publicManifest.assets.some((row) => row.id === pack.assetId);
  const stagedAsset = staged.assets.find((row) => row.id === pack.assetId);
  if (!assetPublic && !stagedAsset) throw new Error(`No public or pinned model for ${pack.assetId}`);
  const expectedLevels = new Map(pack.members.map((member) => [member.id, enemyCombatLevel(variants.get(member.variantId)!.stats)]));
  const dressing = REGIONAL_PACK_LAYOUT[packId]!.dressing;
  const settingKind = !dressing.length ? "undressed"
    : dressing.some((piece) => piece.id === "ration-cache") ? "supply-camp"
    : dressing.some((piece) => piece.id === "offering-table") ? "burial-shrine"
    : dressing.some((piece) => piece.id === "split-block") ? "stone-working"
    : dressing.some((piece) => piece.id === "stone-perch") ? "roost"
    : dressing.some((piece) => piece.id === "ritual-altar") ? "ritual-court" : "unknown";
  const ranging = pack.activity === "patrol" || pack.activity === "prowl";
  const aggressive = baseStats.behaviour === "aggressive";
  const contactNormalized = CREATURE_MOTION_TIMING[pack.assetId]?.contactNormalized ?? 0.45;

  const url = argValue(args, "--url");
  const server = url ? { url, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const directory = path.join(repoRoot, "test-results", "regional-pack-lifecycle", packId);
  await mkdir(directory, { recursive: true });
  const report: Record<string, unknown> = {
    passed: false, packId, speciesId: plan.speciesId, family: species?.bodyFamily ?? "wildlife", assetId: pack.assetId,
    assetSource: assetPublic ? "public manifest" : `pinned catalogue ${path.relative(repoRoot, cataloguePath)} sha256 ${catalogueSha256}`,
    settingKind, activity: pack.activity, behaviour: baseStats.behaviour, attackStyle: baseStats.attackStyle ?? "melee",
    residents: pack.members.length, habitatRadius: pack.radius, levelRange: pack.levelRange,
    naturalTime: true, budgetMs, hardware: "ANGLE D3D11", visualAcceptance: "Root must inspect screenshots.",
    proof: "Production fixture, production AI/combat/loot/respawn; semantic state before and after every action.",
  };
  const checks: Record<string, boolean> = {};
  const check = (name: string, condition: boolean, detail: string) => {
    checks[name] = condition;
    assert(condition, `${name}: ${detail}`);
  };
  try {
    await driver.launch();
    const page = driver.page!;
    if (!assetPublic) {
      // Install only this pack's model route. The catalogue's other bodies (including the rejected
      // Fire model) contribute manifest metadata only and are never requested.
      const selected = `**/assets/${stagedAsset!.file}*`;
      const adapter = { route: async (pattern: string, handler: Parameters<Page["route"]>[1]) => {
        if (pattern.includes("/models/") && pattern !== selected) return;
        await page.route(pattern, handler);
      } };
      await installAssetCandidates(adapter as unknown as Page, cataloguePath);
    }
    await driver.open(30000, `/index.html?mode=combat&rpg=1&pack=${packId}`);
    const read = (): Promise<Sample> => page.evaluate(() => {
      const w = window as unknown as { __packLab: PackFixture; __gameDebug: PackDebug };
      return { fixture: w.__packLab, entities: w.__packLab.ids.map((id) => w.__gameDebug.getEntity(id)!),
        state: w.__gameDebug.getState(), player: w.__gameDebug.getPlayerPosition(), events: w.__gameDebug.getEvents(0).events,
        motions: w.__packLab.ids.map((id) => w.__gameDebug.getEntityMotion(id)) } as unknown as Sample;
    });
    // The player is deliberately weak (level 1) while residents attack, so a whole pack would kill
    // them in seconds. A debug top-up keeps the proof alive; it changes nothing about the residents,
    // and samples that follow a top-up are excluded from damage accounting by the caller.
    let topUps = 0;
    let toppedUp = false;
    const topUp = async (value: Sample): Promise<void> => {
      toppedUp = false;
      if (value.state.health > value.state.maxHealth * 0.5) return;
      await page.evaluate(() => {
        const w = window as unknown as { __gameDebug: PackDebug };
        w.__gameDebug.setHealth(w.__gameDebug.getState().maxHealth);
      });
      topUps += 1;
      toppedUp = true;
    };
    const poll = async (label: string, predicate: (value: Sample) => boolean, ms: number, intervalMs = 100, onSample?: (value: Sample) => void, keepAlive = false) => {
      const until = Date.now() + ms;
      let current = await read();
      onSample?.(current);
      while (!predicate(current)) {
        if (Date.now() > until) throw new Error(`${label} timed out after ${ms} ms: ${JSON.stringify({
          states: current.entities.map((entity) => [entity.id, entity.state, entity.combat?.health]), player: current.player, health: current.state.health })}`);
        if (keepAlive) await topUp(current);
        await page.waitForTimeout(intervalMs);
        current = await read();
        onSample?.(current);
      }
      return current;
    };
    const invoke = (name: string, toolArgs: Record<string, unknown>) => page.evaluate(async ({ name, toolArgs }) => {
      const result = await (window as unknown as { __gameDebug: PackDebug }).__gameDebug.callTool(name, toolArgs);
      if (result && typeof result === "object" && "error" in result) throw new Error(JSON.stringify(result));
      return result;
    }, { name, toolArgs });
    const frame = async (file: string, pose: { x: number; z: number; yaw: number; pitch: number; distance: number }) => {
      await page.evaluate((pose) => {
        const w = window as unknown as { __gameDebug: PackDebug };
        w.__gameDebug.inspectPose({ ...pose, y: w.__gameDebug.groundHeight(pose.x, pose.z), detached: true });
      }, pose);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(directory, file) });
      await page.evaluate(() => window.__featureLab!.setFreeCameraEnabled(false));
    };
    const [cx, cz] = pack.centre;
    const habitatCentre: [number, number] = [-72, 30];

    // ------------------------------------------------------------ 1. residents as registered
    const initial = await read();
    check("fixtureIsRequestedPack", initial.fixture.packId === packId && initial.entities.length === pack.members.length
      && initial.entities.length >= 5 && initial.entities.length <= 10, `fixture ${initial.fixture.packId} with ${initial.entities.length} residents`);
    check("normalClock", initial.state.clock.timeScale === 1, `timeScale ${initial.state.clock.timeScale}`);
    for (const entity of initial.entities) {
      check("residentAliveAtBoot", entity.state === "alive", `${entity.id} ${entity.state}`);
      check("plainName", entity.name === baseStats.name && !/\bT\d+\b|_t\d+\b/.test(entity.name), `${entity.id} named ${entity.name}`);
      check("computedLevelLabel", (entity.combat?.level ?? 0) > 0 && entity.combat?.level === expectedLevels.get(entity.id), `${entity.id} level ${entity.combat?.level} expected ${expectedLevels.get(entity.id)}`);
      check("renderedExpectedBody", entity.view?.assetId === pack.assetId, `${entity.id} drawn with ${entity.view?.assetId}`);
      check("fullHealthAtBoot", entity.combat?.health === entity.combat?.maxHealth, `${entity.id} ${entity.combat?.health}/${entity.combat?.maxHealth}`);
    }
    const spawns = new Map(initial.entities.map((entity) => [entity.id, [...entity.position] as Vec3]));
    report.levels = initial.entities.map((entity) => ({ id: entity.id, name: entity.name, level: entity.combat!.level }));
    report.spawnMinimumGap = round(separation(initial.entities));
    check("spawnBodiesSeparated", separation(initial.entities) > 0, `spawn gap ${report.spawnMinimumGap}`);

    // ------------------------------------------------------------ 2. idle patrol and formation
    const anchors = initial.fixture.habitat.anchors;
    const arrivals = new Map<string, number[]>();
    const noteArrivals = (sample: Sample) => {
      for (const entity of sample.entities) {
        if (entity.state !== "alive") continue;
        const nearest = anchors.map((anchor, index) => ({ index, d: Math.hypot(anchor[0] - entity.position[0], anchor[1] - entity.position[2]) }))
          .sort((a, b) => a.d - b.d)[0]!;
        if (nearest.d > ARRIVAL_METRES) continue;
        const list = arrivals.get(entity.id) ?? [];
        if (list.at(-1) !== nearest.index) list.push(nearest.index);
        arrivals.set(entity.id, list);
      }
    };
    const rangingOrderRespected = () => {
      const count = anchors.length;
      const sequences = [...arrivals.values()].filter((list) => list.length >= 2);
      const ordered = sequences.every((list) => list.every((index, position) => position === 0 || index === (list[position - 1]! + 1) % count));
      return { observedSequences: sequences.length, ordered };
    };
    let minimumGap = Infinity, maximumExcursion = 0, worstContainment = -Infinity;
    const travelled = new Map(initial.entities.map((entity) => [entity.id, 0]));
    const previous = new Map(initial.entities.map((entity) => [entity.id, [...entity.position] as Vec3]));
    const observe = (sample: Sample) => {
      minimumGap = Math.min(minimumGap, separation(sample.entities));
      for (const entity of sample.entities) {
        if (entity.state === "dead") continue;
        const radius = entity.combat?.bodyRadius ?? 0;
        worstContainment = Math.max(worstContainment, distance(entity.position, { x: habitatCentre[0], z: habitatCentre[1] }) + radius - initial.fixture.habitat.radius);
        maximumExcursion = Math.max(maximumExcursion, distance(entity.position, spawns.get(entity.id)!));
        travelled.set(entity.id, travelled.get(entity.id)! + distance(entity.position, previous.get(entity.id)!));
        previous.set(entity.id, [...entity.position] as Vec3);
      }
      noteArrivals(sample);
    };
    const patrolWindowMs = ranging ? 26_000 : 30_000;
    const patrolStarted = Date.now();
    const patrol = await poll("natural idle movement", (value) => Date.now() - patrolStarted >= patrolWindowMs
      && value.entities.some((entity) => distance(entity.position, spawns.get(entity.id)!) > 0.5), patrolWindowMs + 14_000, 250, observe);
    const movers = [...travelled.entries()].filter(([, metres]) => metres > 0.5).map(([id]) => id);
    report.patrol = { windowMs: Date.now() - patrolStarted, movers: movers.length, travelledMetres: Object.fromEntries([...travelled].map(([id, m]) => [id, round(m, 2)])),
      minimumBodyGap: round(minimumGap), worstContainmentOverrun: round(worstContainment), arrivals: Object.fromEntries(arrivals) };
    check("idleMovementInsideHabitat", movers.length >= (ranging ? Math.ceil(patrol.entities.length / 2) : 1), `${movers.length} of ${patrol.entities.length} residents moved`);
    check("patrolBodiesNeverOverlap", minimumGap >= -0.15, `minimum body gap ${round(minimumGap)} m`);
    check("patrolStaysInsideHabitat", worstContainment <= 0.35, `bodies overran the habitat by ${round(worstContainment)} m`);
    await frame("patrol.png", { x: habitatCentre[0], z: habitatCentre[1], yaw: 0, pitch: 0.75, distance: Math.max(18, pack.radius * 2.2) });

    // ------------------------------------------------------------ 3. aggro, pursuit and contact
    await page.evaluate(() => {
      window.__featureLab!.setLevel("melee", 1);
      window.__featureLab!.setLevel("magic", 1);
    });
    // Max health follows the combat level; let the health system re-derive the cap before filling it.
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const w = window as unknown as { __gameDebug: PackDebug };
      w.__gameDebug.setHealth(w.__gameDebug.getState().maxHealth);
    });
    const targetId = initial.fixture.ids[0]!;
    const beforeAggro = await read();
    const approach: Vec3 = [habitatCentre[0], initial.fixture.spawn[1], habitatCentre[1] + Math.max(2.5, initial.fixture.habitat.radius * 0.35)];
    await invoke("corealm_move_to", { position: approach });
    if (!aggressive) {
      // Territorial and passive residents only answer provocation; the punch is the natural trigger.
      await poll("player reaches the approach point", (value) => distance(value.player, approach) < 1.5, 15_000);
      await invoke("corealm_attack", { entityId: targetId });
      // A level-1 player still kills a small territorial or passive resident if the attack command
      // is left running, which would end the lifecycle before its own flinch and kill steps. Break
      // off the moment the pack answers; the provoked residents keep fighting on their own.
      await poll("provoked resident answers", (value) => value.entities.some((entity) => entity.state === "aggro"), 20_000, 40);
      await invoke("corealm_stop", {});
    }
    interface HitSample { damage: number; playerHealth: number; maxHealth: number; attackers: { id: string; clip: string | null; phase: number | null; distance: number }[] }
    const hits: HitSample[] = [];
    let flinchSeen: { id: string; clip: string; weight: number } | null = null;
    let pursuitSeen = false;
    let lastHealth = beforeAggro.state.health;
    let firstHitAt: number | null = null;
    // Provoked passive and territorial residents answer, trade blows and disengage inside this
    // window, so the closing snapshot alone understates the engagement. Keep the peak.
    let peakAggro = 0;
    const aggro = await poll("normal aggro and enemy damage", (value) => {
      const started = value.events.some((event) => event.type === "combat.started" && event.data.initiator === "enemy"
        && initial.fixture.ids.includes(String(event.data.by)));
      peakAggro = Math.max(peakAggro, value.entities.filter((entity) => entity.state === "aggro").length);
      if (value.entities.some((entity) => entity.state === "aggro" && distance(entity.position, spawns.get(entity.id)!) > 0.5)) pursuitSeen = true;
      for (const [index, motion] of value.motions.entries()) {
        if (motion?.hitOverlay?.active && !flinchSeen) flinchSeen = { id: value.entities[index]!.id, clip: motion.hitOverlay.clip, weight: motion.hitOverlay.weight };
      }
      if (toppedUp) lastHealth = value.state.health;
      else if (value.state.health < lastHealth) {
        // Attribute the drop to whichever aggro residents are mid-attack right now. The sim ticks
        // every 100 ms and this poll every 40 ms, so the sampled phase trails the true contact.
        const attackers = value.entities.flatMap((entity, index) => {
          const motion = value.motions[index];
          if (entity.state !== "aggro" || motion?.motion !== "attack") return [];
          return [{ id: entity.id, clip: motion.clip, phase: motion.time !== null && motion.duration ? round(motion.time / motion.duration) : null,
            distance: round(distance(entity.position, value.player), 2) }];
        });
        hits.push({ damage: lastHealth - value.state.health, playerHealth: value.state.health, maxHealth: value.state.maxHealth, attackers });
        firstHitAt ??= Date.now();
      }
      lastHealth = value.state.health;
      // Two hits or six seconds after the first: enough to attribute contact without a long stand.
      return started && hits.length > 0 && (hits.length >= 2 || Date.now() - firstHitAt! > 6_000);
    }, 40_000, 40, undefined, true);
    const aggroAtClose = aggro.entities.filter((entity) => entity.state === "aggro").length;
    const aggroCount = Math.max(peakAggro, aggroAtClose);
    const maxHit = Math.max(...pack.members.map((member) => variants.get(member.variantId)!.stats.maxHit));
    const attributed = hits.filter((hit) => hit.attackers.some((attacker) => attacker.phase !== null && Math.abs(attacker.phase - contactNormalized) <= 0.3 && ATTACK_CLIP.test(attacker.clip ?? "")));
    report.aggro = { residentsAggro: aggroCount, residentsAggroAtClose: aggroAtClose, pursuitSeen, playerHealthBefore: beforeAggro.state.health, playerMaxHealth: beforeAggro.state.maxHealth, hits, debugHealthTopUps: topUps, flinchSeenDuringAggro: flinchSeen };
    check("residentsInitiateOrAnswer", aggroCount >= 1, `${aggroCount} residents aggro`);
    check("residentsPursuePlayer", pursuitSeen || (baseStats.attackStyle !== undefined && baseStats.attackStyle !== "melee"), "no resident left its spawn while aggro");
    check("enemyDamageLands", hits.length > 0 && hits.every((hit) => hit.damage >= 1), "player health did not fall");
    check("enemyDamageWithinAuthoredMaxHit", hits.every((hit) => hit.damage <= maxHit * Math.max(1, hit.attackers.length)), `hits ${JSON.stringify(hits.map((hit) => hit.damage))} exceed maxHit ${maxHit}`);
    report.contact = { expectedContactNormalized: contactNormalized, attributedHits: attributed.length, sampledHits: hits.length,
      samples: hits.map((hit) => hit.attackers) };
    check("damageAtAttackContactMarker", attributed.length >= 1, `no health drop coincided with an attack clip near phase ${contactNormalized}: ${JSON.stringify(hits)}`);
    if (baseStats.attackStyle && baseStats.attackStyle !== "melee") {
      const standoff = attributed.flatMap((hit) => hit.attackers.map((attacker) => attacker.distance));
      check("rangedDamageFromStandoff", standoff.some((metres) => metres > 3), `${baseStats.attackStyle} attackers damaged from ${JSON.stringify(standoff)} m`);
    }
    await page.screenshot({ path: path.join(directory, "attack.png") });

    // ------------------------------------------------------------ 4. flinch on the resident the player hits
    if (aggressive) await invoke("corealm_attack", { entityId: targetId });
    const beforeFlinch = await read();
    const flinch = await poll("resident flinches from a non-lethal hit", (value) => {
      for (const [index, motion] of value.motions.entries()) {
        if (motion?.hitOverlay?.active && !flinchSeen) flinchSeen = { id: value.entities[index]!.id, clip: motion.hitOverlay.clip, weight: motion.hitOverlay.weight };
      }
      return flinchSeen !== null;
    }, 20_000, 40, undefined, true);
    const target = flinch.entities.find((entity) => entity.id === targetId)!;
    report.hitReaction = { ...flinchSeen!, targetHealthAfterPunch: target.combat?.health, targetMaxHealth: target.combat?.maxHealth,
      playerHitsLanded: flinch.events.filter((event) => event.type === "combat.started" && event.data.initiator === "player").length - beforeFlinch.events.filter((event) => event.type === "combat.started" && event.data.initiator === "player").length };
    check("residentFlinchesWhenHit", flinchSeen !== null && (target.combat?.health ?? 0) > 0, `no masked hit overlay observed on a surviving resident`);

    // ------------------------------------------------------------ 5. kill, XP and loot
    await page.evaluate(async () => {
      const lab = window.__featureLab!;
      lab.setLevel("melee", 90);
      lab.setLevel("magic", 90);
      const weapon = lab.getCatalog().equipment.find((row) => row.slot === "mainHand")?.items
        .find((item) => /kaldite_sword|corven_sword|grithe_sword/.test(item.id));
      if (!weapon) throw new Error("No production melee weapon in lab catalogue");
      await lab.equipPlayer("mainHand", weapon.id);
    });
    const beforeKill = await read();
    await invoke("corealm_attack", { entityId: targetId });
    const killedAt = Date.now();
    const dead = await poll("attack command kills the resident", (value) => {
      const entity = value.entities.find((row) => row.id === targetId)!;
      return entity.state === "dead" && entity.combat!.health === 0;
    }, 30_000);
    const deadAt = Date.now();
    const corpse = dead.entities.find((row) => row.id === targetId)!;
    const kills = dead.events.filter((event) => event.type === "combat.ended" && event.data.enemyId === targetId);
    const coin = dead.events.find((event) => event.type === "item.received" && event.data.from === targetId && Number(event.data.currency) > 0);
    const pile = dead.events.find((event) => event.type === "item.received" && typeof event.data.pileId === "string" && String(event.data.pileId).startsWith(`loot_${targetId}_`));
    report.kill = { id: targetId, xp: dead.state.skills.melee.xp - beforeKill.state.skills.melee.xp, currency: dead.state.currency - beforeKill.state.currency,
      combatEnded: kills.length, dropTable: baseStats.drops, marks: baseStats.marks, lootRoll: pile ? pile.data.items : "no item dropped in this natural roll" };
    check("killAwardsXp", dead.state.skills.melee.xp > beforeKill.state.skills.melee.xp, "melee XP did not rise");
    check("killRollsNormalCoinLoot", Boolean(coin) && dead.state.currency > beforeKill.state.currency, "no currency drop event");
    await page.waitForTimeout(1200);
    await frame("corpse.png", { x: corpse.position[0], z: corpse.position[2], yaw: 0.7, pitch: 0.45, distance: Math.max(6, corpse.combat!.bodyRadius! * 6) });
    if (pile) {
      const pileId = String(pile.data.pileId);
      const beforeLoot = await read();
      await invoke("corealm_interact", { entityId: pileId, interaction: "loot" });
      await poll("loot pile opens", (value) => value.events.some((event) => event.type === "activity.started" && event.data.entityId === pileId) || distance(value.player, corpse.position) < 3, 15_000);
      await invoke("corealm_take_loot", { entityId: pileId });
      const looted = await poll("loot pile picked up", (value) => value.events.some((event) => event.type === "item.received"
        && event.seq > (beforeLoot.events.at(-1)?.seq ?? 0) && typeof event.data.itemId === "string"), 10_000);
      const received = looted.events.filter((event) => event.type === "item.received" && event.seq > (beforeLoot.events.at(-1)?.seq ?? 0) && typeof event.data.itemId === "string")
        .map((event) => ({ itemId: event.data.itemId, quantity: event.data.quantity, name: event.data.name }));
      const pileEntity = await page.evaluate((id) => (window as unknown as { __gameDebug: PackDebug }).__gameDebug.getEntity(id), pileId);
      report.lootPickup = { pileId, received, pileRemoved: pileEntity === null || pileEntity === undefined };
      check("lootPilePickedUp", received.length > 0, "no item entered the inventory from the pile");
      // The pile take and the inventory add each emit item.received; only the take carries the display name.
      check("lootPileNamesArePlain", received.every((row) => !/_t\d+\b/.test(String(row.itemId)))
        && received.some((row) => typeof row.name === "string" && /^[A-Z][A-Za-z' -]+$/.test(String(row.name))), JSON.stringify(received));
    } else {
      report.lootPickup = "not exercised: the natural roll produced no pile (see kill.dropTable)";
    }

    // ------------------------------------------------------------ 6. disengage, return and resume ranging
    // The kill command keeps the player swinging at the rest of the pack, so it stands and fights
    // instead of walking off. Break off first, then leave; the leash is what is under test here.
    await invoke("corealm_stop", {});
    await invoke("corealm_move_to", { position: initial.fixture.spawn });
    arrivals.clear();
    const returnStarted = Date.now();
    // Keep the deliberately weak lab player alive while it walks off. A death here teleports it to
    // the region respawn point, which reads as "never arrived" and hides the actual leash result.
    let playerDowned = false;
    const returned = await poll("survivors leash and settle back in the habitat", (value) => {
      noteArrivals(value);
      if (value.state.health <= 0) playerDowned = true;
      const survivors = value.entities.filter((entity) => entity.id !== targetId);
      return distance(value.player, initial.fixture.spawn) < 2 && survivors.every((entity) => entity.state === "alive"
        && entity.combat!.health === entity.combat!.maxHealth
        && distance(entity.position, { x: habitatCentre[0], z: habitatCentre[1] }) + entity.combat!.bodyRadius! <= initial.fixture.habitat.radius + 0.35);
      // Slower residents walk the full disengagement leg home and then regenerate; 60 s covers the
      // slowest proven pack without relaxing what "settled" means.
    }, 60_000, 250, undefined, true);
    const returnLeashed = returned.events.some((event) => event.type === "combat.ended" && initial.fixture.ids.includes(String(event.data.enemyId)) && event.data.enemyId !== targetId);
    const survivors = returned.entities.filter((entity) => entity.id !== targetId);
    report.return = { settledAfterMs: Date.now() - returnStarted, leashEvents: returnLeashed, playerDowned,
      survivorStates: survivors.map((entity) => [entity.id, entity.state, entity.combat!.health]) };
    check("survivorsReturnToHabitat", !playerDowned && survivors.length === pack.members.length - 1
      && survivors.every((entity) => entity.state === "alive" && entity.combat!.health === entity.combat!.maxHealth
        && distance(entity.position, { x: habitatCentre[0], z: habitatCentre[1] }) + entity.combat!.bodyRadius! <= initial.fixture.habitat.radius + 0.35),
      JSON.stringify(report.return));

    // ------------------------------------------------------------ 7. respawn on the normal clock
    const respawnDeadline = ENEMY_RESPAWN_MS + 8_000 - (Date.now() - deadAt);
    let resumedMovers = 0;
    const respawnObserve = (value: Sample) => {
      noteArrivals(value);
      resumedMovers = Math.max(resumedMovers, value.entities.filter((entity) => entity.id !== targetId && entity.state === "alive"
        && distance(entity.position, previous.get(entity.id)!) > 0.05).length);
      for (const entity of value.entities) previous.set(entity.id, [...entity.position] as Vec3);
    };
    const revived = await poll("natural respawn at full health", (value) => {
      const entity = value.entities.find((row) => row.id === targetId)!;
      return entity.state === "alive" && entity.combat!.health === entity.combat!.maxHealth;
    }, Math.max(5_000, respawnDeadline), 250, respawnObserve);
    const respawned = revived.entities.find((row) => row.id === targetId)!;
    const respawnAfterMs = Date.now() - deadAt;
    report.respawn = { afterMs: respawnAfterMs, killToDeathMs: deadAt - killedAt, expectedMs: ENEMY_RESPAWN_MS, health: respawned.combat!.health, maxHealth: respawned.combat!.maxHealth,
      distanceFromSpawn: round(distance(respawned.position, spawns.get(targetId)!), 2), timeScale: revived.state.clock.timeScale };
    check("respawnOnNormalClock", revived.state.clock.timeScale === 1 && respawnAfterMs >= ENEMY_RESPAWN_MS * 0.9 && respawnAfterMs <= ENEMY_RESPAWN_MS + 6_000, `respawned ${respawnAfterMs} ms after death was observed`);
    check("respawnAtSpawnFullHealth", distance(respawned.position, spawns.get(targetId)!) < 0.6 && respawned.combat!.health === respawned.combat!.maxHealth, JSON.stringify(report.respawn));

    // Ranging order: after disengaging, patrol packs continue their authored circuit in order.
    const resumeStarted = Date.now();
    await poll("survivors resume ranging", (value) => {
      respawnObserve(value);
      const { observedSequences } = rangingOrderRespected();
      return ranging ? observedSequences >= 1 && resumedMovers >= 1 : resumedMovers >= 1;
    }, 30_000, 250);
    const order = rangingOrderRespected();
    report.resume = { afterMs: Date.now() - resumeStarted, resumedMovers, ranging, ...order, arrivals: Object.fromEntries(arrivals) };
    check("survivorsResumeRanging", resumedMovers >= 1 && (!ranging || (order.observedSequences >= 1 && order.ordered)), JSON.stringify(report.resume));
    await frame("respawn.png", { x: habitatCentre[0], z: habitatCentre[1], yaw: 0, pitch: 0.75, distance: Math.max(18, pack.radius * 2.2) });

    // A resident respawning onto its own circuit anchor can land on a survivor that is currently
    // passing through it, because production enemy AI has no lateral body avoidance. One instant
    // sampled at a random point in the circuit is noise; require the pack to clear that overlap.
    let worstFinalGap = Infinity, finalSeparatedAtMs: number | null = null;
    const separateStarted = Date.now();
    let final = await read();
    for (;;) {
      const gap = separation(final.entities);
      worstFinalGap = Math.min(worstFinalGap, gap);
      if (gap >= -0.15) { finalSeparatedAtMs = Date.now() - separateStarted; break; }
      if (Date.now() - separateStarted > 12_000) break;
      await page.waitForTimeout(250);
      final = await read();
    }
    report.finalMinimumGap = round(separation(final.entities));
    report.finalSeparation = { worstGap: round(worstFinalGap), separatedAfterMs: finalSeparatedAtMs, windowMs: Date.now() - separateStarted };
    check("finalBodiesSeparated", finalSeparatedAtMs !== null, `pack never cleared its bodies; worst gap ${round(worstFinalGap)} m over ${Date.now() - separateStarted} ms`);
    const errors = await page.evaluate(() => (window as unknown as { __gameDebug: PackDebug }).__gameDebug.getErrors());
    report.gameErrors = errors;
    report.consoleErrors = driver.consoleErrors;
    report.pageErrors = driver.pageErrors;
    report.requestErrors = driver.requestErrors;
    check("noGameErrors", errors.length === 0, JSON.stringify(errors));
    check("noPageErrors", driver.pageErrors.length === 0, JSON.stringify(driver.pageErrors));
    check("noConsoleErrors", driver.consoleErrors.length === 0, JSON.stringify(driver.consoleErrors));
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    report.consoleErrors ??= driver.consoleErrors;
    report.pageErrors ??= driver.pageErrors;
    throw error;
  } finally {
    report.checks = checks;
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    await driver.close();
    await server.close();
    clearDeadline();
  }
  console.log(JSON.stringify({ passed: report.passed, packId, checks }, null, 2));
}
await main();
