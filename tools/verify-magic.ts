/**
 * Legacy full-world wiring check for the magic ladder in a real Chromium.
 *
 * The persistent feature lab owns detailed presentation proof. This script remains useful for the
 * three integration claims that an isolated scene cannot make about the shipped world:
 *
 * AGENTS.md rule 7: "Source review is not gameplay proof." A spell effect is exactly the kind of
 * thing that reads correct in a diff and draws nothing on screen — a mis-flipped atlas UV, a
 * material that never compiled, an InstancedMesh whose `count` is never written. So this drives the
 * shipped Vite game through the same `__gameDebug` surface the harness uses, and reports:
 *
 *  1. THE LADDER RESOLVES. All sixteen rows reach the real API, the three released elements cast,
 *     and Fire stays visible but blocked until its region ships.
 *  2. THE EFFECT DRAWS. Casting moves `drawCalls` by exactly one and puts particles on screen, and
 *     the count returns to its idle value once the effect ends. One draw call is the budget in
 *     `runs/corealm/magic-ladder-spec.md` section 8; Highcairn measures 397 against 400.
 *  3. NOTHING COMPILES MID-FIGHT. `programs` is sampled before the first cast and after the last.
 *     A rise means `Renderer.warmup` missed the spell material and the player pays a stall — the
 *     same class of fault that measured 1130 ms frames before warm-up existed.
 *
 * NO SCREENSHOTS, and that is a measured decision rather than an omission. `page.screenshot` forces
 * a FRESH paint, and a paint of this world under SwiftShader was timed at 53-60 s here while a spell
 * effect lives about 1.3 s on the render clock — so the effect is always over by the time the
 * capture completes, and five consecutive attempts caught nothing. `spellParticles` does not have
 * that problem: `SpellVfx.liveParticles()` returns the count written by the last `update()`, which
 * runs inside `renderFrame`, so a non-zero reading is a statement about a frame that WAS drawn.
 * Screenshots of the spellbook panel, which is DOM and paints instantly, are taken separately.
 *
 *   npx tsx tools/verify-magic.ts --run runs/corealm
 */
import "./lib/repoContent.js";
import { pathToFileURL } from "node:url";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";
import { SPELLS } from "../game/src/content/spells.js";
import type { GameEvent, SpellElement } from "../game/src/contracts.js";
import { MELEE_RANGE, PLAYER_SPEED, SPELL_RANGE } from "../game/src/app/config.js";

interface Metrics { drawCalls: number; programs: number; triangles: number; fps: number; spellParticles: number }
interface ObservedEnemy { id: string; name: string; distance: number; state: string }
interface SpellbookAudit {
  spells?: {
    id: string;
    element: SpellElement;
    reqLevel: number;
    unlocked: boolean;
    castable: boolean;
    maxHit: number;
    castMs: number;
    requiredElement: SpellElement;
    fuelCost: number;
    blockedBy: string | null;
  }[];
  magicLevel?: number;
  activeSpellId?: string | null;
  equippedWeapon?: { itemId: string; element: SpellElement; charges: number; capacity: number } | null;
  essence?: Record<SpellElement, number>;
  releasedElements?: SpellElement[];
}

/** Magic level granted before casting. Above the top of the ladder, so all sixteen are unlocked. */
const TEST_MAGIC_LEVEL = 75;
/** Keep the caster safely inside spell reach while still outside melee reach. */
const TARGET_DISTANCE_M = 4;
/** Frozen in magic-ladder-spec.md section 8. Keep the verifier and runtime budget aligned. */
export const SPELL_PARTICLE_CAP = 640;
const RELEASED_ELEMENTS = ["wind", "earth", "water"] as const satisfies readonly SpellElement[];
const WEAPON_BY_ELEMENT: Readonly<Record<(typeof RELEASED_ELEMENTS)[number], string>> = {
  wind: "air_staff",
  earth: "earth_staff",
  water: "water_staff",
};

export function shaderProgramGrowthFailure(
  element: SpellElement,
  spellId: string,
  before: number,
  after: number,
): string | null {
  if (after <= before) return null;
  return `${element}: shader program count rose from ${before} to ${after} during ${spellId}; `
    + "SpellVfx.primeShader() did not stabilize the cast";
}

export function particleCapFailure(peakParticles: number): string | null {
  if (peakParticles <= SPELL_PARTICLE_CAP) return null;
  return `${peakParticles} live particles; the cap is ${SPELL_PARTICLE_CAP}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runDir = await prepareRun(argValue(args, "--run") ?? "runs/corealm");
  const server = await startGameServer();
  const driver = new GameDriver(server, {
    viewport: { width: 1280, height: 800 },
    // The driver's default flags leave this page rendering at 0 fps: traced across four casts and
    // 56 s, `getMetrics().fps` read 0.0 and `drawCalls` never moved off 193, so nothing was being
    // drawn and `spellParticles` — which is written by `SpellVfx.update` inside `renderFrame` —
    // could only ever read 0. The same casts under an explicitly selected ANGLE/SwiftShader backend
    // draw immediately. Every other harness tool asserts on SIM state, which advances without a
    // frame, so this is the first tool that needed the renderer to actually run.
    browserArgs: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
    // The lowest graphics preset the settings panel offers. This tool measures the SPELL layer, not
    // the world's fidelity, and at default settings the frame cost is high enough that a 1.3 s
    // effect can fall entirely between two samples — a full sweep at 527 draw calls reported zero
    // particles on every released element, and the same sweep at 193 saw them immediately. Audio is
    // silenced for the same reason it is not asserted here: `AudioEngine` needs a gesture to unlock
    // and this session never makes one.
    settings: {
      renderScale: 0.7, shadowQuality: "off", drawDistance: "near",
      damageNumbers: true, invertCameraY: false, uiScale: "normal",
      music: 0, ambient: 0, sfx: 0,
    },
  });
  const failures: string[] = [];
  const notes: string[] = [];

  try {
    await driver.launch();
    // 120 s, not the driver's 20 s default. Boot measured 16.7 s on this machine under SwiftShader
    // — 524 draw calls and 18.2 M triangles a frame — so the default sits close enough to the real
    // time that it trips intermittently, and a flaky harness reads as a broken game.
    await driver.open(120_000);

    // ---------------------------------------------------------------- setup
    await driver.callDebug("setSkillLevel", ["magic", TEST_MAGIC_LEVEL]);
    await driver.callDebug("setSkillLevel", ["melee", TEST_MAGIC_LEVEL]);
    await driver.callDebug("giveItem", ["basic_wooden_wand", 1, "inventory"]);
    await driver.callDebug("giveItem", ["cairnpine_staff", 1, "inventory"]);
    for (const weaponItemId of Object.values(WEAPON_BY_ELEMENT)) {
      await driver.callDebug("giveItem", [weaponItemId, 1, "inventory"]);
    }
    const wandEquip = await driver.callDebug(
      "callTool", ["corealm_equip", { itemId: "basic_wooden_wand" }],
    ) as { error?: string; message?: string };
    if (wandEquip.error) failures.push(`basic wand equip rejected: ${wandEquip.error} ${wandEquip.message ?? ""}`);
    // The sim only advances on rendered frames and `app/loop.ts` clamps a frame to 250 ms, so on a
    // software rasteriser pushing 18 M triangles the world runs at a small fraction of wall clock —
    // a 600 ms combat tick can take many seconds to arrive, and a respawn longer still. Time scale
    // buys the sim back without touching the render path, which is the half being measured.
    await driver.callDebug("setTimeScale", [6]);

    // ------------------------------------------------- 1. the ladder resolves
    const wandBook = await spellbook(driver);
    for (const row of wandBook.spells ?? []) {
      if (row.castMs !== 2200) failures.push(`${row.id}: wand cadence is ${row.castMs} ms, expected 2200`);
    }
    const staffEquip = await driver.callDebug(
      "callTool", ["corealm_equip", { itemId: "cairnpine_staff" }],
    ) as { error?: string; message?: string };
    if (staffEquip.error) failures.push(`Cairnpine Staff equip rejected: ${staffEquip.error} ${staffEquip.message ?? ""}`);

    const book = await spellbook(driver);
    const rows = book.spells ?? [];
    if (rows.length !== SPELLS.length) {
      failures.push(`spellbook returned ${rows.length} rows, content has ${SPELLS.length}`);
    }
    for (const spell of SPELLS) {
      const row = rows.find((candidate) => candidate.id === spell.id);
      if (!row) { failures.push(`spellbook is missing ${spell.id}`); continue; }
      if (row.element !== spell.element) {
        failures.push(`${spell.id}: spellbook says ${row.element}, content says ${spell.element}`);
      }
      if (!row.unlocked) failures.push(`${spell.id} still locked at Magic ${TEST_MAGIC_LEVEL}`);
      if (row.maxHit <= 0) failures.push(`${spell.id} reports maxHit ${row.maxHit}`);
      if (row.castMs !== 3000) failures.push(`${spell.id}: staff cadence is ${row.castMs} ms, expected 3000`);
      if (row.requiredElement !== spell.cost.element) {
        failures.push(`${spell.id}: needs ${row.requiredElement}, content costs ${spell.cost.element}`);
      }
      if (row.fuelCost !== 1) failures.push(`${spell.id}: fuel cost is ${row.fuelCost}, expected 1`);
    }
    const released = book.releasedElements ?? [];
    if (JSON.stringify(released) !== JSON.stringify(RELEASED_ELEMENTS)) {
      failures.push(`released elements are [${released.join(", ")}], expected [${RELEASED_ELEMENTS.join(", ")}]`);
    }
    const fireRows = rows.filter((row) => row.element === "fire");
    if (fireRows.some((row) => row.castable)) {
      failures.push("Fire spells became castable before Fire entered releasedElements");
    }
    notes.push(
      `spellbook: ${rows.length} rows, active = ${String(book.activeSpellId)}, `
      + "wand 2.2 s / staff 3.0 s",
    );

    // ------------------------------------------------------ find something to hit
    const enemy = await nearestEnemy(driver);
    if (!enemy) {
      // Not a silent pass. Without a target nothing below can run, and reporting "all good" from a
      // sweep that never cast anything is the exact failure this script exists to prevent.
      failures.push("no living enemy within reach of spawn; the cast sweep did not run");
    } else {
      notes.push(`target: ${enemy.name} (${enemy.id}) at ${enemy.distance.toFixed(1)} m`);

      // One living enemy per element, so no cast has to wait on a revive.
      const victims = (await allEnemies(driver)).filter((row) => row.state !== "dead").slice(0, RELEASED_ELEMENTS.length);
      if (victims.length < RELEASED_ELEMENTS.length) {
        failures.push(`only ${victims.length} living enemies in reach; the sweep needs ${RELEASED_ELEMENTS.length}`);
      }

      // TELEPORTED, not walked, and that is a statement about the harness rather than about the
      // game. The nearest enemy to spawn is 79.5 m out — 19 s of walking at the production speed,
      // except the sim only advances with rendered frames (`app/loop.ts` clamps a frame to 250 ms),
      // and SwiftShader here renders 18.2 M triangles a frame at well under 1 fps. Walking took
      // roughly 9 m per real minute, making even the walk into the current 15 m spell range take
      // more than seven real minutes.
      // Casting is what this script tests; pathfinding has `tools/scenarios/movement.json`.
      const target = await driver.callDebug("callTool", ["corealm_inspect", { entityId: enemy.id }]) as
        { position?: [number, number, number] };
      if (!target.position) {
        failures.push(`could not inspect ${enemy.id} for a position`);
      } else {
        const [tx, ty, tz] = target.position;
        // Four metres short of the target: outside melee's 1.6 m and well inside a spell's 15 m,
        // so a stray step cannot take the caster out of range mid-sweep.
        const bearing = Math.atan2(tz, tx);
        await driver.callDebug("teleport", [[
          tx - Math.cos(bearing) * TARGET_DISTANCE_M,
          ty,
          tz - Math.sin(bearing) * TARGET_DISTANCE_M,
        ]]);
        await driver.wait(1200);
      }

      const arrived = await nearestEnemy(driver);
      if (!arrived || arrived.distance > SPELL_RANGE) {
        failures.push(`did not reach a target: nearest is ${arrived?.distance.toFixed(1) ?? "none"} m`);
      }

      // Baselined HERE, after the walk, and deliberately not at boot. Crossing 80 m of world streams
      // scenery in and out and compiles whatever that scenery needs, so a boot-time baseline would
      // charge the spell layer for every draw call and every program the walk paid for.
      await driver.wait(1500);
      const idle = await metrics(driver);
      notes.push(`idle at the target: ${idle.drawCalls} draw calls, ${idle.programs} programs`);

      // A renderer that is not advancing cannot fail this script honestly: `spellParticles` is
      // written inside `renderFrame`, so a frozen page reports 0 for every cast and reads exactly
      // like a spell layer that draws nothing. Establish that frames are moving BEFORE blaming the
      // spells — this is the check that would have saved four sweeps.
      const simBefore = await simClockMs(driver);
      await driver.wait(3000);
      const simAfter = await simClockMs(driver);
      const live = await metrics(driver);
      // The SIM clock, not a frame counter: `app/loop.ts` advances it from inside the rAF callback,
      // so it moves if and only if frames are being produced. `fps` is reported alongside because
      // it is the number a reader will look at, but it can legitimately read 0 on a very slow
      // rasteriser between samples, and the clock cannot.
      if (simAfter <= simBefore) {
        failures.push(
          `the renderer is not advancing: sim clock stuck at ${simAfter} ms over 3 s `
          + `(fps ${live.fps.toFixed(1)}, ${live.drawCalls} draw calls). Nothing below can be trusted.`,
        );
      } else {
        notes.push(`renderer live: sim advanced ${simAfter - simBefore} ms in 3 s, fps ${live.fps.toFixed(1)}`);
      }

      // ------------------------------------------- 2 and 3. the effect draws
      let peakDrawCalls = 0;
      let peakParticles = 0;
      for (const [index, element] of RELEASED_ELEMENTS.entries()) {
        // The TOP spell of each element, so the sweep also exercises the surge rung — the widest,
        // most expensive effect and the one most likely to breach a budget.
        const spell = [...SPELLS].reverse().find((row) => row.element === element);
        if (!spell) { failures.push(`no ${element} spell in the table`); continue; }

        const weaponItemId = WEAPON_BY_ELEMENT[element];
        const equipped = await driver.callDebug(
          "callTool", ["corealm_equip", { itemId: weaponItemId }],
        ) as { error?: string; message?: string };
        if (equipped.error) {
          failures.push(`${weaponItemId} equip rejected: ${equipped.error} ${equipped.message ?? ""}`);
          continue;
        }
        const beforeCast = await spellbook(driver);
        if (beforeCast.equippedWeapon?.itemId !== weaponItemId) {
          failures.push(`${element}: spellbook equipped ${beforeCast.equippedWeapon?.itemId ?? "no charged weapon"}`);
          continue;
        }
        if (beforeCast.equippedWeapon.charges !== 1000 || beforeCast.equippedWeapon.capacity !== 1000) {
          failures.push(
            `${weaponItemId}: starts ${beforeCast.equippedWeapon.charges}/${beforeCast.equippedWeapon.capacity}, expected 1000/1000`,
          );
        }

        // A FRESH TARGET per element, rather than reviving one.
        //
        // Full health before every cast. Teleporting next to four aggressive enemies in a row costs
        // real hit points at 23 starting health, and a dead caster casts nothing — an earlier run
        // lost casts that way and reported them as "no particles".
        await driver.callDebug("setHealth", [9999]);

        // A Magic 75 caster one-shots a tier 1 skitterling, so the first cast always kills and every
        // later cast at the same entity returns INVALID_ARGUMENT. `forceRespawn` plus a poll was the
        // obvious answer and it does not hold up here: the revive lands on a 100 ms sim tick that
        // only runs on a rendered frame, and at the 3 fps this browser manages the poll timed out
        // more often than it succeeded. Four separate enemies need no revive at all.
        const victim = victims[index];
        if (!victim) { failures.push(`no living target left for ${spell.id}`); continue; }
        if (!await teleportBeside(driver, victim.id)) {
          failures.push(`could not place the caster next to ${victim.id} for ${spell.id}`);
          continue;
        }

        // A LOCAL baseline, taken here rather than once for the whole sweep.
        //
        // Each element is cast beside a different enemy, and moving between them streams a new
        // neighbourhood in: measured against a single sweep-wide baseline the "spell layer" appeared
        // to cost 15 draw calls, all of which were scenery. Settle, then read the floor at THIS
        // spot, and the delta afterwards is the effect and nothing else.
        await driver.wait(8000);
        const floor = await metrics(driver);
        const eventFloor = await spellLaunchEvents(driver, 0, 0);

        const cast = await driver.callDebug("callTool", [
          "corealm_attack", { entityId: victim.id, spellId: spell.id },
        ]) as { error?: string; message?: string };
        if (cast.error) {
          failures.push(`${spell.id} rejected: ${cast.error} ${cast.message ?? ""}`);
          continue;
        }

        const launched = await spellLaunchEvents(driver, eventFloor.nextSeq, 30_000);
        await driver.callDebug("callTool", ["corealm_stop", {}]);
        const launch = launched.events.find((event) => event.data.spellId === spell.id);
        if (!launch) {
          failures.push(`${spell.id}: no spell.launched event arrived`);
        } else {
          const remaining = Number(launch.data.remainingCharges);
          if (launch.data.weaponItemId !== weaponItemId || launch.data.fuelSource !== "weapon" || remaining !== 999) {
            failures.push(
              `${spell.id}: launch used ${String(launch.data.weaponItemId)} at ${remaining} charges, `
              + `expected ${weaponItemId} at 999`,
            );
          }
          const afterCast = await spellbook(driver);
          if (afterCast.equippedWeapon?.charges !== 999) {
            failures.push(`${spell.id}: one launch left ${afterCast.equippedWeapon?.charges ?? "no"} charges, expected 999`);
          }
        }

        // Polled on `spellParticles`, not on draw calls, and polled for a long time.
        //
        // Long, because a cast does not resolve on the call: `systems/combat.ts` rolls it on the
        // next 600 ms combat tick and the tick only advances on a rendered frame — and this browser
        // is a software rasteriser pushing 18 M triangles, so a second of wall clock can be a
        // fraction of a sim second. On `spellParticles`, because `drawCalls` also moves when a
        // building fades or a chunk streams, and the first version of this check called that a
        // spell.
        let peakThisCast = 0;
        let peakDrawsThisCast = floor.drawCalls;
        // 150 samples at 200 ms is 30 s of wall clock per cast. Generous on purpose: at the 3 fps
        // this browser manages, a cast has to wait for a 600 ms combat tick that only advances on a
        // rendered frame, and a 14 s window caught only part of the released sweep per run.
        for (let sample = 0; sample < 150; sample += 1) {
          await driver.wait(200);
          const now = await metrics(driver);
          peakDrawsThisCast = Math.max(peakDrawsThisCast, now.drawCalls);
          peakThisCast = Math.max(peakThisCast, now.spellParticles);
          if (process.env["VERIFY_MAGIC_TRACE"] && sample % 5 === 0) {
            console.log(`    [trace] ${element} t+${(sample * 0.2).toFixed(1)}s `
              + `particles=${now.spellParticles} draws=${now.drawCalls} fps=${now.fps.toFixed(1)}`);
          }
          if (peakThisCast > 0) break;
        }
        peakParticles = Math.max(peakParticles, peakThisCast);
        const extraHere = peakDrawsThisCast - floor.drawCalls;
        peakDrawCalls = Math.max(peakDrawCalls, extraHere);
        if (peakThisCast === 0) {
          failures.push(`${element} (${spell.id}): cast produced no particles`);
        } else {
          notes.push(`${element} (${spell.id}): peak ${peakThisCast} particles, +${extraHere} draw calls`);
          if (extraHere > 1) {
            failures.push(`${element}: spell layer cost ${extraHere} draw calls; the budget is 1`);
          }
        }
        // Let the effect finish before reading either of the two tail properties: the longest tail
        // in the envelope is a surge's 950 ms, and both of these were previously read while the last
        // cast was still running.
        await driver.wait(4000);
        const settled = await metrics(driver);
        const shaderFailure = shaderProgramGrowthFailure(element, spell.id, floor.programs, settled.programs);
        if (shaderFailure) failures.push(shaderFailure);
        if (settled.spellParticles !== 0) {
          failures.push(`${element}: ${settled.spellParticles} particles still alive 4 s after the cast`);
        }
      }

      const after = await metrics(driver);
      notes.push(`worst case: +${peakDrawCalls} draw calls over the local floor, ${peakParticles} particles`);
      // Spec section 8: a hard cap of 640 live particles. The draw-call budget is asserted per cast
      // above, against that cast's own floor.
      const particleFailure = particleCapFailure(peakParticles);
      if (particleFailure) failures.push(particleFailure);
      if (after.spellParticles !== 0) {
        failures.push(`${after.spellParticles} particles still alive after the sweep; casts do not reap`);
      }
      if (peakParticles === 0) {
        failures.push("no element drew anything; the spell layer is not reaching the screen at all");
      }
    }

    // Console errors are a failure in their own right — a texture that 404s or a shader that fails
    // to link reports here and nowhere else.
    const errors = await driver.callDebug("getErrors") as { message?: string }[];
    for (const error of errors) failures.push(`runtime error: ${error.message ?? "unknown"}`);

  } finally {
    await driver.close();
    await server.close();
  }

  for (const note of notes) console.log(`  ${note}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nmagic ladder verified in the browser");
}

async function spellbook(driver: GameDriver): Promise<SpellbookAudit> {
  return await driver.callDebug("callTool", ["corealm_spellbook", { op: "read" }]) as SpellbookAudit;
}

async function spellLaunchEvents(
  driver: GameDriver,
  sinceSeq: number,
  timeoutMs: number,
): Promise<{ events: GameEvent[]; nextSeq: number }> {
  return await driver.callDebug("callTool", [
    "corealm_events", { sinceSeq, types: ["spell.launched"], timeoutMs },
  ]) as { events: GameEvent[]; nextSeq: number };
}

/** Sim milliseconds. Advances only inside the render loop, so it doubles as a frame heartbeat. */
async function simClockMs(driver: GameDriver): Promise<number> {
  const state = await driver.callDebug("getState") as { clock?: { elapsedMs?: number } };
  return state.clock?.elapsedMs ?? 0;
}

async function metrics(driver: GameDriver): Promise<Metrics> {
  return await driver.callDebug("getMetrics") as Metrics;
}

/** Waits for the player to stop moving, or gives up so a stuck path cannot hang the run. */
async function settle(driver: GameDriver, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await driver.wait(200);
    if (await driver.callDebug("isIdle") === true) return;
  }
}

/** Drops the caster four metres from an entity: inside spell reach, outside melee reach. */
async function teleportBeside(driver: GameDriver, entityId: string): Promise<boolean> {
  const entity = await driver.callDebug("callTool", ["corealm_inspect", { entityId }]) as
    { position?: [number, number, number] };
  const at = entity.position;
  if (!at) return false;
  const [x, y, z] = at;
  const bearing = Math.atan2(z, x);
  if (TARGET_DISTANCE_M <= MELEE_RANGE || TARGET_DISTANCE_M >= SPELL_RANGE) return false;
  await driver.callDebug("teleport", [[
    x - Math.cos(bearing) * TARGET_DISTANCE_M,
    y,
    z - Math.sin(bearing) * TARGET_DISTANCE_M,
  ]]);
  await driver.wait(1200);
  return true;
}

async function allEnemies(driver: GameDriver): Promise<ObservedEnemy[]> {
  const observed = await driver.callDebug("callTool", [
    "corealm_observe", { archetypes: ["enemy"], radius: 140, limit: 25 },
  ]) as ObservedEnemy[] | { error?: string };
  return Array.isArray(observed) ? observed : [];
}

async function nearestEnemy(driver: GameDriver): Promise<ObservedEnemy | null> {
  const observed = await driver.callDebug("callTool", [
    "corealm_observe", { archetypes: ["enemy"], radius: 120, limit: 25 },
  ]) as ObservedEnemy[] | { error?: string };
  if (!Array.isArray(observed)) return null;
  const alive = observed.filter((row) => row.state !== "dead").sort((a, b) => a.distance - b.distance);
  return alive[0] ?? null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("magic verification");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
