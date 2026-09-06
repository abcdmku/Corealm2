/**
 * Authored-world Agility shortcut check. One obstacle and direction per invocation.
 *   npx tsx tools/traversal-world-check.ts --id sunder_ledge [--reverse] [--case traverse|interrupt|gate|oneway]
 *     [--url http://127.0.0.1:4189] [--out test-results/traversal-world]
 * Debug relocation to a dry nav point near the entrance is setup only; every traversal starts
 * through the production route planner (corealm_move_to to the far location) or the real
 * interaction dispatcher (corealm_interact). Screenshots still need human inspection.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { agilityXp } from "../game/src/content/index.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const args = process.argv.slice(2);
const id = argValue(args, "--id") ?? "sunder_ledge";
const reverse = args.includes("--reverse");
const scenario = argValue(args, "--case") ?? "traverse";
const url = argValue(args, "--url") ?? `http://127.0.0.1:${process.env.PORT ?? "4189"}`;
const out = path.resolve(argValue(args, "--out") ?? "test-results/traversal-world", `${id}${reverse ? "-reverse" : ""}-${scenario}`);
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline(`World traversal ${id} ${scenario}`, scenario === "stance" ? 60_000 : 150_000);
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
type Xyz = { x: number; y: number; z: number };
const report: Record<string, unknown> = { passed: false, id, reverse, scenario, url, shots: [], findings: [] };
const findings = report.findings as string[];
const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
const xyz = (p: Xyz): Vec3 => [p.x, p.y, p.z];
const locations = new Map(REGIONS.flatMap((region) => [...region.locations, ...(region.dungeon?.locations ?? [])]
  .map((location) => [location.id, location] as const)));

try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
  await driver.open(50_000, "/index.html");
  await page.waitForFunction(() => (window as any).__gameDebug.getNavigationState().status === "ready", undefined, { timeout: 20_000 });
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
  assert(typeof report.renderer === "string" && /D3D11|Direct3D11/i.test(report.renderer) && !/SwiftShader|llvmpipe|software/i.test(report.renderer),
    `Hardware D3D11 required: ${report.renderer}`);

  const entity = await driver.callDebug("getEntity", [id]) as SemanticEntity | null;
  assert(entity?.obstacle, `No authored obstacle ${id}`);
  report.entity = entity;
  const oneWay = entity.meta?.oneWay === true;
  const forwardEntry = entity.interactionPosition ?? entity.position;
  const forwardExit = entity.obstacle.exitPosition;
  const entry = reverse ? forwardExit : forwardEntry;
  const exit = reverse ? forwardEntry : forwardExit;
  const fromLocationId = String(reverse ? entity.meta?.toLocationId : entity.meta?.fromLocationId);
  const toLocationId = String(reverse ? entity.meta?.fromLocationId : entity.meta?.toLocationId);
  const from = locations.get(fromLocationId);
  assert(from, `Unknown route location ${fromLocationId}`);
  const interaction = entity.interactions.find((verb) => verb === "climb" || verb === "vault" || verb === "enter")!;
  const expectedXp = agilityXp(entity.tier);
  report.route = { fromLocationId, toLocationId, entry, exit, expectedXp, oneWay, interaction };

  // Setup: stand on the authored route node the shortcut is planned from, so the approach walk,
  // the planner's choice and the traversal all run through production movement.
  //
  // Take that node from the route plan, not from the region rectangle's authored coordinate. A
  // fishery location's authored point is the middle of the water and its route node is the solved
  // dry landing, and a dungeon chamber's node is 28 m below the surface height at the same XZ.
  report.plan = await driver.callDebug("planRoute", [fromLocationId, toLocationId, 20]);
  const planned = (report.plan as { legs?: { from?: Vec3 }[] } | null)?.legs?.[0]?.from;
  const nodePoint: Vec3 = planned && planned.every(Number.isFinite)
    ? [planned[0], planned[1], planned[2]]
    : [from.position[0], await driver.callDebug("groundHeight", [from.position[0], from.position[1]]) as number, from.position[1]];
  const fromNode = await driver.callDebug("getNavPoint", [nodePoint]) as Xyz | null;
  assert(fromNode, `Route node ${fromLocationId} is off the navmesh at ${JSON.stringify(nodePoint)}`);
  let stand: Xyz | null = fromNode;
  if (scenario === "interrupt") {
    stand = null;
    const towardFrom = [from.position[0] - entry[0], from.position[1] - entry[2]];
    const length = Math.hypot(towardFrom[0]!, towardFrom[1]!) || 1;
    for (const back of [6, 4, 8, 3, 10]) {
      const x = entry[0] + towardFrom[0]! / length * back;
      const z = entry[2] + towardFrom[1]! / length * back;
      const candidate = await driver.callDebug("getNavPoint", [[x, entry[1], z]]) as Xyz | null;
      if (candidate && Math.hypot(candidate.x - x, candidate.z - z) < 1.5) { stand = candidate; break; }
    }
  }
  assert(stand, "No navigable approach point near the entrance");
  const yaw = Math.atan2(entry[0] - stand.x, entry[2] - stand.z);
  await driver.callDebug("teleport", [xyz(stand)]);
  await driver.callDebug("inspectPose", [{ ...stand, yaw, pitch: 0.42, distance: 9, detached: false }]);
  // Success chance clamps to 1.00 at reqLevel + 20, so the crossing itself is deterministic and a
  // rerun is not a coin flip. `--agility <n>` reproduces the failure path on demand.
  const agilityLevel = Number(argValue(args, "--agility")
    ?? (scenario === "gate" ? entity.obstacle.reqLevel - 1 : Math.min(99, entity.obstacle.reqLevel + 20)));
  report.agilityLevel = agilityLevel;
  await driver.callDebug("setSkillLevel", ["agility", agilityLevel]);
  await driver.wait(400);
  report.setup = { stand, yaw, player: await driver.callDebug("getPlayer") };

  await page.evaluate(() => {
    const w = window as any;
    w.__traversalProof = { running: true, rows: [] };
    const sample = () => {
      if (!w.__traversalProof.running) return;
      const curtain = document.querySelector(".traversal-transition");
      w.__traversalProof.rows.push({ at: performance.now(), player: w.__gameDebug.getPlayer(),
        activity: w.__gameDebug.getCurrentActivity(), motion: w.__gameDebug.getPlayerMotion(),
        camera: w.__gameDebug.getCamera(),
        opacity: curtain ? Number(getComputedStyle(curtain).opacity) : 0 });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const stopRows = async () => page.evaluate(() => { const w = window as any; w.__traversalProof.running = false; return w.__traversalProof.rows as any[]; });
  const progress = async () => page.evaluate(() => (window as any).__gameDebug.getCurrentActivity()?.progress ?? null) as Promise<number | null>;
  const shot = async (name: string) => (report.shots as unknown[]).push({ name, progress: await progress(), file: await driver.screenshot(out, name) });
  const events = async (since: number) => driver.callDebug("callTool", ["corealm_events", { sinceSeq: since, timeoutMs: 0 }]) as Promise<{ nextSeq: number; events: any[] }>;
  const before = await driver.callDebug("getState") as any;
  const cursor = (await events(0)).nextSeq;
  report.before = { xp: before.skills.agility.xp, level: before.skills.agility.level, health: before.health, cursor, assets: before.assets };

  if (scenario === "stance") {
    // No movement. Just: is there standable ground at each authored endpoint, how far is it from
    // the authored y, and does the navmesh connect the landing to the leg the route walks next?
    const probe = async (label: string, point: Vec3) => {
      const ground = await driver.callDebug("groundHeight", [point[0], point[2]]) as number;
      const atAuthored = await driver.callDebug("getNavPoint", [point]) as Xyz | null;
      const atGround = await driver.callDebug("getNavPoint", [[point[0], ground, point[2]]]) as Xyz | null;
      return { label, point, ground, authoredRise: ground - point[1], atAuthored, atGround,
        clearance: await driver.callDebug("probeWorldClearance", [{ x: point[0], z: point[2], y: ground, radius: 0.35 }]).catch(() => null) };
    };
    const legs = (report.plan as { legs?: { kind: string; from: Vec3; to: Vec3; toId?: string }[] } | null)?.legs ?? [];
    const tail = legs.filter((leg) => leg.kind === "walk").at(-1) ?? null;
    report.stance = {
      entry: await probe("entry", entry as Vec3),
      exit: await probe("exit", exit as Vec3),
      crossing: await driver.callDebug("getNavPath", [entry, exit]),
      ...(tail ? { resumeLeg: tail, resumePath: await driver.callDebug("getNavPath", [tail.from, tail.to]) } : {}),
    };
    for (const side of ["entry", "exit"] as const) {
      const measured = (report.stance as any)[side];
      if (!measured.atGround) findings.push(`${side} has no navigable ground at ${measured.point[0].toFixed(1)},${measured.point[2].toFixed(1)}`);
      if (Math.abs(measured.authoredRise) > 2.5) findings.push(`${side} sits ${measured.authoredRise.toFixed(2)} m from the drawn ground`);
    }
    if (tail && !(report.stance as any).resumePath) findings.push(`No navmesh path for the walk the route resumes with: ${JSON.stringify(tail.from)} -> ${JSON.stringify(tail.to)}`);
    await stopRows();
    await shot("stance");
  } else if (scenario === "gate") {
    // `GameApi.interact` walks into range before it runs the verb, so an out-of-range click on a
    // gated shortcut answers "walking to ..." and only refuses on arrival. Stand at the entrance
    // first, so the refusal under test is the requirement check and not the approach.
    const approach = await driver.callDebug("callTool", ["corealm_move_to", { position: entry }]) as any;
    report.gateApproach = approach;
    if (!approach.error) await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 45_000 }).catch(() => {});
    const direct = await driver.callDebug("callTool", ["corealm_interact", { entityId: id, interaction }]) as any;
    report.directRefusal = direct;
    assert.equal(direct.error, "REQUIREMENTS_NOT_MET", `Level gate did not refuse the direct interaction: ${JSON.stringify(direct)}`);
    const gated = await driver.callDebug("callTool", ["corealm_move_to", { locationId: toLocationId }]) as any;
    report.gatedRoute = gated;
    await driver.wait(3_500);
    const walked = await driver.callDebug("getPlayer") as any;
    const activity = await driver.callDebug("getCurrentActivity");
    assert(!activity || (activity as any).kind !== "traversing", "Gated route still started the traversal");
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    await driver.callDebug("teleport", [xyz(stand)]);
    await driver.callDebug("setSkillLevel", ["agility", Math.min(99, entity.obstacle.reqLevel + 20)]);
    const allowed = await driver.callDebug("callTool", ["corealm_move_to", { locationId: toLocationId }]) as any;
    report.allowedRoute = allowed;
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    if (!gated.error && !allowed.error) assert(allowed.etaMs < gated.etaMs, `Shortcut route is not faster: gated ${gated.etaMs} vs allowed ${allowed.etaMs}`);
    report.gateWalk = walked;
    const after = await driver.callDebug("getState") as any;
    assert.equal(after.skills.agility.xp, before.skills.agility.xp, "Gated attempt awarded XP");
    await stopRows();
    await shot("gate-refused");
  } else if (scenario === "oneway") {
    assert(oneWay, `${id} is not one-way`);
    // The constraint lives in the route graph and in `resolveShortcutEndpoints`, not in the click:
    // clicking a distant obstacle from its far end just walks you round to its entrance.
    const reversePlan = await driver.callDebug("planRoute", [String(entity.meta?.toLocationId), String(entity.meta?.fromLocationId), 20]) as any;
    report.reversePlan = reversePlan;
    const reverseEdges = (reversePlan?.edges ?? []).filter((edge: any) => edge.obstacleId === id);
    assert.deepEqual(reverseEdges, [], `The one-way graph offers ${id} in reverse`);
    const stance = await driver.callDebug("getNavPoint", [forwardExit]) as Xyz;
    await driver.callDebug("teleport", [xyz(stance)]);
    const routed = await driver.callDebug("callTool", ["corealm_move_to", { locationId: String(entity.meta?.fromLocationId) }]) as any;
    report.reverseRoute = routed;
    await driver.wait(3_000);
    const activity = await driver.callDebug("getCurrentActivity");
    assert(!activity || (activity as any).kind !== "traversing", "Reverse route used the one-way slide");
    await driver.callDebug("callTool", ["corealm_stop", {}]);
    const after = await driver.callDebug("getState") as any;
    assert.equal(after.skills.agility.xp, before.skills.agility.xp, "Reverse attempt awarded XP");
    await stopRows();
    await shot("oneway-refused");
  } else {
    const started = scenario === "interrupt"
      ? await driver.callDebug("callTool", ["corealm_move_to", { position: entry }])
      : await driver.callDebug("callTool", ["corealm_move_to", { locationId: toLocationId }]);
    report.started = started;
    assert(!(started as any).error, `Route refused: ${JSON.stringify(started)}`);
    if (scenario === "interrupt") {
      await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 12_000 });
      const direct = await driver.callDebug("callTool", ["corealm_interact", { entityId: id, interaction }]) as any;
      report.directStart = direct;
      assert(!direct.error, `Direct traversal refused: ${JSON.stringify(direct)}`);
    }
    // The planner compares real prepared paths, so it may correctly decline a shortcut whose
    // authored road saving does not survive Detour. Record that and then prove the crossing
    // itself through a direct click, rather than reporting the shortcut as broken.
    const arrival = await page.waitForFunction(() => {
      const w = window as any;
      if (w.__gameDebug.getCurrentActivity()?.kind === "traversing") return "traversing";
      return w.__gameDebug.getPlayer().moving ? false : "idle";
    }, undefined, { timeout: 60_000, polling: 100 }).then((handle) => handle.jsonValue() as Promise<string>);
    let routed = arrival === "traversing";
    if (!routed) {
      report.routedDeclinedShortcut = { started, planCostSeconds: (report.plan as any)?.cost ?? null,
        arrivedAt: await driver.callDebug("getPlayer") };
      findings.push(`Routed travel walked instead of using ${id}: direct path ${(started as any).pathLength} m / ${(started as any).etaMs} ms beats the ${(report.plan as any)?.cost}s graph route`);
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      const approach = await driver.callDebug("callTool", ["corealm_move_to", { position: entry }]) as any;
      report.directApproach = approach;
      assert(!approach.error, `Walk to the entrance refused: ${JSON.stringify(approach)}`);
      await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 45_000 });
      const direct = await driver.callDebug("callTool", ["corealm_interact", { entityId: id, interaction }]) as any;
      report.directStart = direct;
      assert(!direct.error, `Direct traversal refused: ${JSON.stringify(direct)}`);
      await page.waitForFunction(() => (window as any).__gameDebug.getCurrentActivity()?.kind === "traversing", undefined, { timeout: 20_000 });
    }
    report.routedTravelUsedShortcut = routed;
    const atEntry = await driver.callDebug("getPlayer") as any;
    report.atEntry = atEntry;
    report.entryClearance = await driver.callDebug("probeWorldClearance", [{ ...atEntry.position, radius: 0.35 }]).catch(() => null);
    report.entryBounds = await driver.callDebug("getDrawnBounds", [id]).catch(() => null);
    await shot("01-entry");
    const waitProgress = async (target: number) => page.waitForFunction((target) => {
      const activity = (window as any).__gameDebug.getCurrentActivity();
      return !activity || activity.kind !== "traversing" || activity.progress >= target;
    }, target, { timeout: 12_000 });
    await waitProgress(0.17);
    await shot("02-contact");
    if (scenario === "interrupt") {
      await waitProgress(0.4);
      const stopped = await driver.callDebug("callTool", ["corealm_stop", {}]);
      report.stopped = stopped;
      await driver.wait(1_500);
      const player = await driver.callDebug("getPlayer") as any;
      const after = await driver.callDebug("getState") as any;
      const all = await stopRows();
      report.afterInterrupt = { player, xp: after.skills.agility.xp, health: after.health, curtain: await page.locator(".traversal-transition").count() };
      assert.equal(after.activity, null, "Interrupted traversal still running");
      assert(gap(xyz(atEntry.position), xyz(player.position)) < 0.05, "Interruption moved the semantic player");
      assert.equal(after.skills.agility.xp, before.skills.agility.xp, "Interrupted traversal awarded XP");
      assert.equal(report.afterInterrupt && (report.afterInterrupt as any).curtain, 0, "Curtain remained after interruption");
      await shot("03-interrupted");
      // Back away, not forward: the setup camera faces the obstacle, so "w" walks into its face.
      await driver.press("s", 800);
      const walked = await driver.callDebug("getPlayer") as any;
      assert(gap(xyz(player.position), xyz(walked.position)) > 0.8, "Player cannot walk after interruption");
      report.walkedAfterInterrupt = walked;
      report.rowCount = all.length;
    } else {
      await waitProgress(0.5);
      await shot("03-travel");
      await waitProgress(0.9);
      await shot("04-recovery");
      await page.waitForFunction(() => (window as any).__gameDebug.getCurrentActivity() === null, undefined, { timeout: 12_000 });
      await shot("05-landed");
      await driver.wait(700);
      await shot("06-after");
      await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 45_000 });
      const all = await stopRows();
      const landingRow = all.find((row, i) => i > 0 && all[i - 1].activity?.kind === "traversing" && !row.activity);
      const landed = landingRow?.player ?? await driver.callDebug("getPlayer") as any;
      report.landed = landed;
      const landedNav = await driver.callDebug("getNavPoint", [xyz(landed.position)]) as Xyz | null;
      report.landedNav = landedNav;
      const after = await driver.callDebug("getState") as any;
      const log = await events(cursor);
      report.after = { xp: after.skills.agility.xp, health: after.health, player: await driver.callDebug("getPlayer") };
      const stops = log.events.filter((event) => event.type === "activity.stopped" && event.data?.kind === "traversing");
      const failures = log.events.filter((event) => event.type === "navigation.failed");
      const completed = log.events.filter((event) => event.type === "navigation.completed");
      report.events = { stops, failures, completed: completed.length, total: log.events.length };
      const xpDelta = after.skills.agility.xp - before.skills.agility.xp;
      const succeeded = stops.some((event) => event.data?.reason === "completed");
      report.outcome = { succeeded, xpDelta, stops: stops.length };
      assert.equal(stops.length, 1, `Expected exactly one traversal stop, saw ${stops.length}`);
      if (succeeded) {
        assert.equal(xpDelta, expectedXp, `XP delta ${xpDelta} != ${expectedXp}`);
        // `AgilitySystem.validLanding` accepts a snap of up to 2 m onto the navmesh; anything
        // beyond that is a landing the production rule would already have refused.
        const landingSnap = gap(xyz(landed.position), exit);
        report.landingSnap = landingSnap;
        if (landingSnap > 0.6) findings.push(`Landed ${landingSnap.toFixed(2)} m from the authored exit`);
        assert(landingSnap <= 2, `Landed ${landingSnap.toFixed(2)} m from the authored exit`);
        assert(landedNav && Math.hypot(landedNav.x - landed.position.x, landedNav.z - landed.position.z) < 0.15, "Landing is off the navmesh");
        if (routed) {
          assert.equal(failures.length, 0, `Route failed after landing: ${JSON.stringify(failures)}`);
          assert(completed.length >= 1, "Routed travel did not complete after the shortcut");
        } else {
          // A direct crossing still has to leave the player able to walk away from the landing.
          await driver.press("w", 600);
          const walked = await driver.callDebug("getPlayer") as any;
          report.walkedAfterLanding = walked;
          assert(gap(xyz(landed.position), xyz(walked.position)) > 0.5, "Player cannot walk away from the landing");
        }
      } else {
        assert.equal(xpDelta, 0, "Failed traversal awarded XP");
        assert(after.health < before.health, "Failed traversal dealt no damage");
        findings.push("Seeded roll failed this run: rerun for the success path.");
      }
      // Motion analysis: visible jumps, stationary time, poses per phase.
      const during = all.filter((row) => row.activity?.kind === "traversing");
      let visibleJump = 0, stationaryMs = 0, opaqueMs = 0;
      for (let i = 1; i < during.length; i++) {
        const a = during[i - 1], b = during[i];
        const moved = Math.hypot(...([0, 1, 2] as const).map((k) => b.motion.drawnPosition[k] - a.motion.drawnPosition[k]));
        if (moved > 1.5 && b.opacity < 0.999) visibleJump = Math.max(visibleJump, moved);
        if (moved < 0.002 && b.opacity < 0.999) stationaryMs += b.at - a.at;
        if (b.opacity >= 0.999) opaqueMs += b.at - a.at;
      }
      const landing = all.find((row, i) => i > 0 && all[i - 1].activity?.kind === "traversing" && !row.activity);
      const landingCovered = !landing || landing.opacity >= 0.999 || gap(xyz(landing.player.position), landing.motion.drawnPosition) < 0.6;
      // The activity summary carries no presentation phase, so the observable signal is the pose
      // the rig actually played while the crossing was in plain view.
      const poses = [...new Set(during.map((row) => row.motion.pose))];
      const visiblePoseFrames = Object.fromEntries([...new Set(during.filter((row) => row.opacity < 0.999)
        .map((row) => row.motion.pose))].map((pose) => [pose,
          during.filter((row) => row.opacity < 0.999 && row.motion.pose === pose).length]));
      report.motion = { frames: during.length, visibleJump, stationaryMs: Math.round(stationaryMs), opaqueMs: Math.round(opaqueMs),
        visibleMs: Math.round((during.at(-1)?.at ?? 0) - (during[0]?.at ?? 0) - opaqueMs), poses, visiblePoseFrames, landingCovered,
        drawnStart: during[0]?.motion.drawnPosition, drawnEnd: during.at(-1)?.motion.drawnPosition, cameraStart: during[0]?.camera, cameraEnd: during.at(-1)?.camera };
      if (visibleJump > 0) findings.push(`Visible rendered jump of ${visibleJump.toFixed(2)} m during traversal`);
      if (!landingCovered) findings.push("Landing displacement was rendered without an opaque cover");
      if (stationaryMs > 800) findings.push(`Rendered actor stationary and visible for ${Math.round(stationaryMs)} ms during traversal`);
      report.rowSample = during.filter((_, i) => i % 6 === 0).map((row) => ({ at: Math.round(row.at), progress: row.activity.progress,
        pose: row.motion.pose, clip: row.motion.clip, drawn: row.motion.drawnPosition.map((v: number) => Math.round(v * 100) / 100), opacity: row.opacity }));
    }
  }
  report.errors = await driver.callDebug("getErrors");
  report.console = driver.consoleErrors; report.pageErrors = driver.pageErrors; report.requestErrors = driver.requestErrors;
  assert.deepEqual(report.errors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.exitCode = 1;
  if (driver.page) {
    await driver.screenshot(out, "failure").catch(() => {});
    report.failureRows = await driver.page.evaluate(() => ((window as any).__traversalProof?.rows ?? []).filter((_: unknown, i: number) => i % 20 === 0)
      .map((row: any) => ({ at: Math.round(row.at), player: row.player.position, moving: row.player.moving, activity: row.activity?.kind ?? null, progress: row.activity?.progress ?? null, pose: row.motion.pose, camera: row.camera.position }))).catch(() => null);
    report.failureNavigation = await driver.callDebug("getNavigationState").catch(() => null);
  }
} finally {
  await driver.close();
  clearDeadline();
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, id, reverse, scenario, findings, motion: report.motion, outcome: report.outcome, failure: report.failure, out })}\n`);
}
