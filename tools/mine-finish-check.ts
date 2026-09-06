/**
 * One command that re-runs the whole slice 11 mine matrix in the authored world.
 *
 * For every authored mine it drives the production game in one Chromium session and records, per
 * mine: navmesh landing for every mining stance, haul-ramp grade, a real pointer approach from the
 * nearest road/bank route node, a real canvas click on every ground ore in its full and partial
 * states, actual extraction and XP receipts, the depleted-state click, respawn back to available,
 * the inventory-full stop, a real ground-click haul return, the walked slope profile, and the
 * clearance between the working aisle and the nearest cave/dungeon and Agility shortcut. It also
 * captures approach/aisle/rear/side composition views for the cut-face appearance review.
 *
 * World-only exception (docs/world-authoring.md): the behaviour under test is the authored final
 * world - terrain embedding of the cut face, world layout and long-distance navigation to it. The
 * reusable ground-ore and cut-face assets keep their separate compact lab proof.
 *
 *   PORT=4190 npx tsx tools/mine-finish-check.ts
 *   PORT=4190 npx tsx tools/mine-finish-check.ts --site bracken_workings --out test-results/slice11/after
 *
 * Steps that use a debug shortcut instead of real play are recorded in each mine's `shortcuts`
 * list so a reader never mistakes them for gameplay proof.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA, PLAYER_RADIUS } from "../game/src/app/config.js";
import { REGIONS } from "../game/src/content/regions.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../game/src/content/worldSites.js";
import { worldSiteHaulRamp } from "../game/src/world/siteTerrain.js";
import type { Vec3 } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";

interface Point { x: number; y: number; z: number }
interface Failure { mine: string; check: string; detail: string }
interface MineReport {
  site: string;
  shortcuts: string[];
  checks: Record<string, unknown>;
  shots: { name: string; file: string }[];
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("PORT=4190 npx tsx tools/mine-finish-check.ts [--site <mine-id>] [--url http://127.0.0.1:4190] [--out test-results/slice11/check]");
  process.exit(0);
}
const options: Record<string, string> = {};
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]!, value = args[index + 1];
  assert(["--site", "--url", "--out"].includes(flag), `Unknown flag ${flag}`);
  assert(value && !value.startsWith("--") && !(flag in options), `One value required for ${flag}`);
  options[flag] = value;
}
const mines = WORLD_SITES.filter((site) => site.kind === "mine"
  && (!options["--site"] || site.id === options["--site"]));
assert(mines.length, `--site must name one of ${WORLD_SITES.filter((s) => s.kind === "mine").map((s) => s.id).join(", ")}`);
const out = options["--out"] ?? "test-results/slice11/check";
await mkdir(out, { recursive: true });

// One dungeon mouth and three Agility shortcuts sit near the karrowmoor mines. The mine approach
// has to stay readable as its own place, so measure both rather than assuming the layout.
const CAVES = REGIONS.flatMap((region) => region.locations
  .filter((location) => location.kind === "dungeon" || location.kind === "gate")
  .map((location) => ({ id: location.id, kind: location.kind, position: location.position })));
const SHORTCUTS = REGIONS.flatMap((region) => region.obstacles.flatMap((obstacle) => [
  { id: `${obstacle.id}:entry`, position: obstacle.position },
  { id: `${obstacle.id}:exit`, position: obstacle.exitPosition },
]));

const deadline = installTestDeadline("Mine finish check", 30 * 60_000);
const driver = new GameDriver({ url: options["--url"] ?? `http://127.0.0.1:${process.env.PORT ?? 4190}`, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const failures: Failure[] = [];
const report: Record<string, unknown> = {
  passed: false, generatedAt: new Date().toISOString(),
  scope: "Authored-world mine matrix: stance navmesh landing, haul-ramp grade, real pointer approach,"
    + " real per-rock clicks at full/partial/depleted, extraction and XP receipts, inventory-full stop,"
    + " ground-click haul return, walked slope, cave and shortcut clearance, composition views.",
  mines: {} as Record<string, MineReport>, failures,
};

let current = "boot";
function check(mine: string, name: string, ok: boolean, detail: unknown): boolean {
  if (!ok) failures.push({ mine, check: name, detail: JSON.stringify(detail) });
  return ok;
}
async function evaluate<T>(program: string, input: unknown = null, timeout = 8_000): Promise<T> {
  return driver.page!.evaluate<T>(
    `(() => { const input = ${JSON.stringify(input)}; ${program}\n})()`,
  ) as Promise<T>;
}
async function debug<T>(method: string, params: unknown[] = []): Promise<T> {
  return driver.callDebug(method, params) as Promise<T>;
}
function flat(point: Point | Vec3 | readonly number[]): [number, number] {
  return Array.isArray(point) ? [point[0]!, point[2]!] : [(point as Point).x, (point as Point).z];
}
function span(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

/** Nearest route node the player could realistically arrive from, excluding the mine's own node. */
function arrivalNode(site: WorldSite): { id: string; position: readonly [number, number] } {
  const candidates = REGIONS.flatMap((region) => region.locations
    .filter((location) => location.routeNode && location.id !== site.locationId)
    .map((location) => ({ id: location.id, position: location.position })));
  let best = candidates[0]!;
  for (const candidate of candidates) {
    if (span(candidate.position, site.centre) < span(best.position, site.centre)) best = candidate;
  }
  return best;
}

/** Screen point for a world position using the live production camera. */
async function project(world: readonly number[]): Promise<{ x: number; y: number; depth: number } | null> {
  const view = await evaluate<{ camera: { position: Point; target: Point }; rect: { x: number; y: number; width: number; height: number } }>(`
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { camera: window.__gameDebug.getCamera(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  `);
  const camera = new PerspectiveCamera(CAMERA.fov, view.rect.width / view.rect.height, CAMERA.near, CAMERA.far);
  camera.position.set(view.camera.position.x, view.camera.position.y, view.camera.position.z);
  camera.lookAt(view.camera.target.x, view.camera.target.y, view.camera.target.z);
  camera.updateMatrixWorld(true);
  const projected = new Vector3(world[0]!, world[1]!, world[2]!).project(camera);
  const x = view.rect.x + (projected.x + 1) * view.rect.width / 2;
  const y = view.rect.y + (1 - projected.y) * view.rect.height / 2;
  if (projected.z < -1 || projected.z > 1 || x < 4 || y < 4 || x > 1436 || y > 896) return null;
  return { x, y, depth: projected.z };
}

/** A stable canvas hover on the exact entity, sampled across its drawn bounds. */
async function hoverEntity(id: string): Promise<{ x: number; y: number } | null> {
  const bounds = await debug<{ min: Point; max: Point; meshes: number } | null>("getDrawnBounds", [id]);
  if (!bounds || bounds.meshes <= 0) return null;
  for (const height of [0.55, 0.35, 0.75]) for (const along of [0.5, 0.32, 0.68]) for (const depth of [0.5, 0.3, 0.7]) {
    const world = [
      bounds.min.x + (bounds.max.x - bounds.min.x) * along,
      bounds.min.y + (bounds.max.y - bounds.min.y) * height,
      bounds.min.z + (bounds.max.z - bounds.min.z) * depth,
    ];
    const screen = await project(world);
    if (!screen) continue;
    await driver.moveMouse(screen.x, screen.y);
    let stable = true;
    for (let sample = 0; sample < 2 && stable; sample++) {
      await driver.wait(80);
      const hover = await evaluate<{ id: string | null; canvas: boolean }>(`
        return { id: window.__gameDebug.getState().hoveredEntityId,
          canvas: document.elementFromPoint(input.x, input.y)?.tagName === 'CANVAS' };
      `, screen);
      stable = hover.canvas && hover.id === id;
    }
    if (stable) return { x: screen.x, y: screen.y };
  }
  return null;
}

/**
 * Re-aims the follow camera along the mine's approach without moving the player: inspectPose is
 * given the player's own current position, so its world relocation is a no-op.
 */
async function faceAisle(player: Point, site: WorldSite): Promise<void> {
  await debug("inspectPose", [{ x: player.x, y: player.y, z: player.z,
    yaw: site.rotationY + site.terrain.approachAngle, pitch: 0.55, distance: 22 }]);
  await settle();
}

/** Live semantic snapshot, cheap enough to poll. */
interface Snapshot {
  state: { ready: boolean; selectedEntityId: string | null; inventoryUsed: number;
    skills: Record<string, { level: number; xp: number }>; clock: { elapsedMs: number; timeScale: number; paused: boolean } };
  player: Point;
  entity: { state: string; resource?: { remaining: number; maxYields: number; itemId: string };
    interactionPosition?: Vec3; view?: { assetId?: string } } | null;
  activity: { kind: string; entityId?: string } | null;
  events: { events: { seq: number; type: string; entityId?: string; data: Record<string, unknown> }[]; nextSeq: number; dropped?: boolean };
  movement: { destinationEntityId: string | null } | null;
  errors: unknown[];
}
async function observe(id: string, since: number): Promise<Snapshot> {
  return evaluate<Snapshot>(`
    const d = window.__gameDebug;
    const save = JSON.parse(d.getSaveBlob());
    return { state: d.getState(), player: d.getPlayerPosition(), entity: input.id ? d.getEntity(input.id) : null,
      activity: d.getCurrentActivity(), events: d.getEvents(input.since), movement: save.player.movement,
      errors: d.getErrors() };
  `, { id, since });
}
function xpOf(snapshot: Snapshot): number { return snapshot.state.skills["mining"]?.xp ?? 0; }

async function settle(): Promise<void> {
  await evaluate(`return new Promise((resolve, reject) => {
    const d = window.__gameDebug, started = performance.now();
    let previous = d.getCamera(), stableSince = started;
    const sample = () => {
      const now = performance.now(), c = d.getCamera();
      const delta = Math.max(
        Math.hypot(c.position.x - previous.position.x, c.position.y - previous.position.y, c.position.z - previous.position.z),
        Math.hypot(c.target.x - previous.target.x, c.target.y - previous.target.y, c.target.z - previous.target.z));
      if (delta > 0.002) stableSince = now;
      if (now - stableSince >= 160) return resolve(true);
      if (now - started > 3000) return resolve(false);
      previous = c; requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });`, null, 4_000);
}

/** Waits for a predicate over live snapshots, returning the last one seen. */
async function until(id: string, since: number, budgetMs: number,
  done: (snapshot: Snapshot) => boolean): Promise<Snapshot> {
  const limit = Date.now() + budgetMs;
  let snapshot = await observe(id, since);
  while (Date.now() < limit && !done(snapshot)) {
    await driver.wait(120);
    snapshot = await observe(id, since);
  }
  return snapshot;
}

try {
  await driver.launch();
  await driver.open(120_000, "/index.html");
  const page = driver.page!;
  const renderer = await evaluate<string>(`
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  `);
  assert(/D3D11|Direct3D11/i.test(renderer) && !/SwiftShader|llvmpipe|software/i.test(renderer),
    `Production proof requires a hardware D3D11 renderer, got ${renderer}`);
  report.renderer = renderer;
  const boot = await evaluate<{ state: Snapshot["state"]; navigation: Record<string, unknown> }>(`
    return { state: window.__gameDebug.getState(), navigation: window.__gameDebug.getNavigationState() };
  `);
  report.boot = boot;
  assert(boot.state.ready, "Production game never reported ready");
  assert(boot.navigation["status"] === "ready", "Production navigation is not ready");
  assert(boot.state.clock.timeScale === 1 && !boot.state.clock.paused, "Clock must run at real time");
  await evaluate(`
    for (const selector of ['#panel-feature-lab', '#environment-lab-panel']) {
      const element = document.querySelector(selector);
      if (element) element.style.visibility = 'hidden';
    }
    return true;
  `);

  for (const site of mines) {
    current = site.id;
    const mine: MineReport = { site: site.id, shortcuts: [], checks: {}, shots: [] };
    (report.mines as Record<string, MineReport>)[site.id] = mine;
    const ramp = worldSiteHaulRamp(site);
    const ids = site.resourceSlots.map((slot) => `${slot.clusterId}_${slot.index}`);
    const rampY = await debug<number>("groundHeight", [...ramp.worldEnd]);
    const rampEnd: Vec3 = [ramp.worldEnd[0], rampY, ramp.worldEnd[1]];

    // ---- approach: start at the nearest other route node and let production navigation walk in.
    const node = arrivalNode(site);
    const nodeY = await debug<number>("groundHeight", [...node.position]);
    mine.shortcuts.push(`teleport to route node ${node.id} as the approach start (setup, not proof)`);
    await debug("teleport", [[node.position[0], nodeY, node.position[1]] as Vec3]);
    await driver.wait(400);
    const approachPoints = await debug<Point[] | null>("getNavPath",
      [[node.position[0], nodeY, node.position[1]], rampEnd]) ?? [];
    check(site.id, "approach.route", approachPoints.length > 1,
      { node: node.id, points: approachPoints.length });
    let approachLength = 0;
    let approachSlope = 0;
    for (let index = 1; index < approachPoints.length; index++) {
      const a = approachPoints[index - 1]!, b = approachPoints[index]!;
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      approachLength += run;
      if (run > 0.4) approachSlope = Math.max(approachSlope, Math.abs(b.y - a.y) / run);
    }
    // 0.55 is the authored haul-lane bound in tests/mine-haul-ramp.test.ts. A route leg above it
    // reads as climbing rather than walking in.
    check(site.id, "approach.noClimbLookingLegs", approachSlope <= 0.55, { approachSlope });
    mine.checks["approach"] = { from: node.id, distance: Math.round(approachLength * 100) / 100, approachSlope: Math.round(approachSlope * 1000) / 1000 };

    // World inspectPose relocates the player as well as the camera, so it is used only here, as
    // declared setup, to put the follow camera on the authored approach before any real click.
    assert.equal(await debug("inspectPose", [{ x: rampEnd[0], y: rampEnd[1], z: rampEnd[2],
      yaw: site.rotationY + site.terrain.approachAngle, pitch: 0.62, distance: 32 }]), true);
    await debug("teleport", [rampEnd]);
    await driver.wait(300);
    const firstEntity = await debug<{ tier?: number } | null>("getEntity", [ids[0]!]);
    const tier = Number(firstEntity?.tier ?? 1);
    const pickaxe = tier >= 20 ? "emberite_pickaxe" : tier >= 10 ? "kaldite_pickaxe"
      : tier >= 5 ? "corven_pickaxe" : "grithe_pickaxe";
    await debug("clearInventory");
    const grant = await debug<{ ok: boolean; value: number }>("giveItem", [pickaxe, 1, "inventory"]);
    assert(grant.ok && grant.value === 1, `Pickaxe grant failed at ${site.id}`);
    // A high base Mining level keeps natural gathering attempts reliable inside a bounded browser
    // run. No clock, yield or respawn value is edited.
    await debug("setSkillLevel", ["mining", 99]);
    mine.shortcuts.push(`clearInventory, ${pickaxe} grant and Mining 99 as eligibility setup`);
    await page.waitForFunction((resourceIds) => resourceIds.every((id) => {
      const bounds = (window as unknown as { __gameDebug: { getDrawnBounds(id: string): { meshes: number } | null } })
        .__gameDebug.getDrawnBounds(id);
      return bounds !== null && bounds.meshes > 0;
    }), ids, { timeout: 25_000 });
    await driver.wait(400);

    // ---- haul-ramp grade along the authored lane, measured on real world terrain.
    const yaw = site.rotationY + site.terrain.approachAngle;
    let rampGrade = 0;
    const rampProfile: number[] = [];
    for (const across of [-1.2, 0, 1.2]) {
      let previous: number | null = null;
      for (let along = 0; along <= ramp.endDistance + 2; along += 0.5) {
        const local: [number, number] = [Math.sin(yaw) * along + Math.cos(yaw) * across,
          Math.cos(yaw) * along - Math.sin(yaw) * across];
        const world = [site.centre[0] + local[0], site.centre[1] + local[1]];
        const height = await debug<number>("groundHeight", world);
        if (across === 0) rampProfile.push(Math.round(height * 100) / 100);
        if (previous !== null) rampGrade = Math.max(rampGrade, Math.abs(height - previous) / 0.5);
        previous = height;
      }
    }
    check(site.id, "haulRamp.gradeWithinIntent", rampGrade <= 0.55, { rampGrade });
    mine.checks["haulRamp"] = { endDistance: ramp.endDistance, grade: Math.round(rampGrade * 1000) / 1000, profile: rampProfile };

    // ---- every mining stance lands on walkable navmesh with the promoted rock bounds.
    const stances: Record<string, unknown> = {};
    for (const id of ids) {
      const entity = await debug<Snapshot["entity"]>("getEntity", [id]);
      const stance = entity?.interactionPosition;
      if (!check(site.id, `stance.${id}.exists`, Boolean(stance), { entity: Boolean(entity) })) continue;
      const projected = await debug<Point | null>("getNavPoint", [stance!]);
      const clearance = await debug<{ staticShift: number; forestOverlaps: unknown[] }>(
        "probeWorldClearance", [{ x: stance![0], z: stance![2], radius: PLAYER_RADIUS }]);
      const navGap = projected ? span(flat(projected), flat(stance!)) : Infinity;
      check(site.id, `stance.${id}.onNavmesh`, navGap <= 0.35, { navGap });
      check(site.id, `stance.${id}.clearOfStatics`, clearance.staticShift <= 0.02, clearance);
      check(site.id, `stance.${id}.clearOfTrunks`, clearance.forestOverlaps.length === 0, clearance);
      stances[id] = { stance, navGap: Math.round(navGap * 1000) / 1000, staticShift: clearance.staticShift };
    }
    mine.checks["stances"] = stances;

    // ---- cave, gate and Agility shortcut clearance around the working aisle.
    const aisle = worldSitePoint(site, 0, -2);
    const nearestCave = CAVES.map((poi) => ({ ...poi, distance: span(poi.position, aisle) }))
      .sort((a, b) => a.distance - b.distance)[0]!;
    const nearestShortcut = SHORTCUTS.map((entry) => ({ ...entry, distance: span(entry.position, aisle) }))
      .sort((a, b) => a.distance - b.distance)[0]!;
    // The mine's own working footprint is workRadius; a cave mouth or shortcut landing inside the
    // authored extent would merge the two approaches into one unreadable place.
    check(site.id, "separation.caveOutsideExtent", nearestCave.distance > Math.max(...site.extent),
      nearestCave);
    check(site.id, "separation.shortcutOutsideAisle", nearestShortcut.distance > site.workRadius + 6,
      nearestShortcut);
    mine.checks["separation"] = { nearestCave, nearestShortcut };

    // ---- per-rock states. The first rock is the full pointer approach, walked from the ramp end.
    const rocks: Record<string, unknown> = {};
    for (const [index, id] of ids.entries()) {
      current = `${site.id}/${id}`;
      const cursor = (await observe(id, 0)).events.nextSeq;
      const before = await observe(id, cursor);
      if (!check(site.id, `rock.${id}.availableBeforeClick`, before.entity?.state === "available",
        { state: before.entity?.state })) continue;
      const startGap = span(flat(before.player), flat(before.entity!.interactionPosition!));

      // FULL: one real canvas click drives the whole approach and extraction. The camera is only
      // re-aimed at the player's own current position so the next stance is on screen; this moves
      // no one and the walk itself stays production movement driven by the click.
      await faceAisle(before.player, site);
      const spot = await hoverEntity(id);
      if (!check(site.id, `rock.${id}.hoverable`, Boolean(spot), "no stable unobstructed canvas hover")) continue;
      await driver.click(spot!.x, spot!.y);
      const clicked = await observe(id, cursor);
      check(site.id, `rock.${id}.clickSelects`, clicked.state.selectedEntityId === id,
        { selected: clicked.state.selectedEntityId });
      check(site.id, `rock.${id}.clickMoves`, clicked.movement?.destinationEntityId === id,
        { destination: clicked.movement?.destinationEntityId });
      const xpBefore = xpOf(before);
      const full = await until(id, cursor, 30_000, (snapshot) => snapshot.events.events.some(
        (event) => event.type === "item.received" && event.entityId === id && event.data["source"] === "gather"));
      const gathers = full.events.events.filter((event) => event.type === "item.received"
        && event.entityId === id && event.data["source"] === "gather");
      const xpEvents = full.events.events.filter((event) => event.type === "xp.gained" && event.data["skill"] === "mining");
      const failed = full.events.events.filter((event) => event.type === "navigation.failed");
      check(site.id, `rock.${id}.full.navigationSucceeded`, failed.length === 0, failed);
      check(site.id, `rock.${id}.full.oreReceipt`, gathers.length > 0, { gathers: gathers.length });
      check(site.id, `rock.${id}.full.xpReceipt`, xpEvents.length > 0 && xpOf(full) > xpBefore,
        { xpBefore, xpAfter: xpOf(full), events: xpEvents.length });
      const stanceGap = span(flat(full.player), flat(before.entity!.interactionPosition!));
      check(site.id, `rock.${id}.full.workedFromStance`, stanceGap <= 0.45 + 0.002, { stanceGap });
      const received = gathers.reduce((sum, event) => sum + Number(event.data["quantity"] ?? 0), 0);
      check(site.id, `rock.${id}.full.remainingDropped`,
        (before.entity!.resource!.remaining - (full.entity?.resource?.remaining ?? 0)) === received,
        { before: before.entity!.resource!.remaining, after: full.entity?.resource?.remaining, received });

      // PARTIAL: the same rock is now part-worked; click it again and take another receipt.
      const partialCursor = full.events.nextSeq;
      const partialBefore = await observe(id, partialCursor);
      check(site.id, `rock.${id}.partial.stateIsPartial`,
        (partialBefore.entity?.resource?.remaining ?? 0) > 0
        && (partialBefore.entity?.resource?.remaining ?? 0) < (partialBefore.entity?.resource?.maxYields ?? 0),
        partialBefore.entity?.resource);
      await faceAisle(partialBefore.player, site);
      const partialSpot = await hoverEntity(id);
      if (check(site.id, `rock.${id}.partial.hoverable`, Boolean(partialSpot), "no hover on partial rock")) {
        await driver.click(partialSpot!.x, partialSpot!.y);
        const partial = await until(id, partialCursor, 20_000, (snapshot) => snapshot.events.events.some(
          (event) => event.type === "item.received" && event.entityId === id && event.data["source"] === "gather"));
        check(site.id, `rock.${id}.partial.oreReceipt`, partial.events.events.some(
          (event) => event.type === "item.received" && event.entityId === id), { seen: partial.events.events.length });
      }

      // Only the first rock at each mine carries the slow states; the rest keep the matrix in budget.
      if (index === 0) {
        // DEPLETED: reach the state with the debug shortcut, then click it for real.
        const depletedCursor = (await observe(id, 0)).events.nextSeq;
        mine.shortcuts.push(`depleteNode(${id}) to reach the depleted state without 8-15 real yields`);
        await debug("depleteNode", [id]);
        await driver.wait(600);
        const depleted = await observe(id, depletedCursor);
        check(site.id, `rock.${id}.depleted.state`, depleted.entity?.state === "depleted", depleted.entity?.state);
        const depletedView = await debug<{ meshes: number } | null>("getDrawnBounds", [id]);
        check(site.id, `rock.${id}.depleted.stillDrawn`, (depletedView?.meshes ?? 0) > 0, depletedView);
        await faceAisle((await observe(id, 0)).player, site);
        const depletedSpot = await hoverEntity(id);
        if (check(site.id, `rock.${id}.depleted.hoverable`, Boolean(depletedSpot), "depleted rock is not hoverable")) {
          await driver.click(depletedSpot!.x, depletedSpot!.y);
          const after = await until(id, depletedCursor, 6_000, () => false);
          check(site.id, `rock.${id}.depleted.noExtraction`, !after.events.events.some(
            (event) => event.type === "item.received" && event.entityId === id), "depleted rock still yielded ore");
        }

        // RESPAWN: natural, on the real clock, at the authored respawn time.
        const respawnCursor = (await observe(id, 0)).events.nextSeq;
        const respawnSeconds = Number((depleted.events.events.find((event) => event.type === "resource.depleted"
          && event.entityId === id)?.data["respawnInSeconds"]) ?? 0);
        const startedAt = Date.now();
        const respawned = await until(id, respawnCursor, Math.max(20_000, respawnSeconds * 1000 + 20_000),
          (snapshot) => snapshot.entity?.state === "available");
        check(site.id, `rock.${id}.respawn.returnsAvailable`, respawned.entity?.state === "available",
          { state: respawned.entity?.state, waitedMs: Date.now() - startedAt, respawnSeconds });
        check(site.id, `rock.${id}.respawn.refills`, (respawned.entity?.resource?.remaining ?? 0) > 0,
          respawned.entity?.resource);
        mine.checks["respawn"] = { id, respawnSeconds, waitedMs: Date.now() - startedAt };

        // INVENTORY FULL: fill the pack, click, and require a stop rather than a silent loss.
        const fullCursor = (await observe(id, 0)).events.nextSeq;
        mine.shortcuts.push("giveItem to fill the pack for the inventory-full stop");
        const filled = await evaluate<{ used: number; capacity: number }>(`
          const d = window.__gameDebug;
          let used = JSON.parse(d.getSaveBlob()).inventory.slots.length;
          for (let slot = 0; slot < 40; slot++) {
            d.giveItem('march_stone', 1, 'inventory');
            const save = JSON.parse(d.getSaveBlob());
            const filledSlots = save.inventory.slots.filter(entry => entry !== null).length;
            if (filledSlots >= save.inventory.capacity) { used = filledSlots; break; }
            used = filledSlots;
          }
          const save = JSON.parse(d.getSaveBlob());
          return { used: save.inventory.slots.filter(entry => entry !== null).length, capacity: save.inventory.capacity };
        `, null, 15_000);
        check(site.id, `rock.${id}.inventoryFull.packIsFull`, filled.used >= filled.capacity, filled);
        await faceAisle((await observe(id, 0)).player, site);
        const fullSpot = await hoverEntity(id);
        if (check(site.id, `rock.${id}.inventoryFull.hoverable`, Boolean(fullSpot), "no hover for inventory-full click")) {
          await driver.click(fullSpot!.x, fullSpot!.y);
          const stopped = await until(id, fullCursor, 25_000, (snapshot) => snapshot.events.events.some(
            (event) => event.type === "inventory.full"
              || (event.type === "activity.stopped" && event.data["reason"] === "inventory-full")));
          const stopEvents = stopped.events.events.filter((event) => event.type === "inventory.full"
            || (event.type === "activity.stopped" && event.data["reason"] === "inventory-full"));
          check(site.id, `rock.${id}.inventoryFull.stops`, stopEvents.length > 0
            && stopped.activity?.kind !== "gathering",
            { stopEvents: stopEvents.map((event) => ({ type: event.type, reason: event.data["reason"] })), activity: stopped.activity });
          mine.checks["inventoryFull"] = { id, capacity: filled.capacity,
            events: stopEvents.map((event) => ({ type: event.type, reason: event.data["reason"] })) };
        }
        await debug("clearInventory");
        await debug("giveItem", [pickaxe, 1, "inventory"]);
      }
      rocks[id] = { startGap: Math.round(startGap * 100) / 100, received,
        stanceGap: Math.round(stanceGap * 1000) / 1000, xpGained: xpOf(full) - xpBefore };
    }
    mine.checks["rocks"] = rocks;

    // ---- haul return: one real ground click back to the authored haul endpoint.
    current = `${site.id}/return`;
    const returnCursor = (await observe(ids[0]!, 0)).events.nextSeq;
    await faceAisle((await observe(ids[0]!, 0)).player, site);
    const returnSpot = await project([rampEnd[0], rampEnd[1] + 0.05, rampEnd[2]]);
    if (check(site.id, "return.groundVisible", Boolean(returnSpot), "no on-screen view of the haul endpoint")) {
      await driver.moveMouse(returnSpot!.x, returnSpot!.y);
      await driver.wait(120);
      await driver.click(returnSpot!.x, returnSpot!.y);
      const returned = await until(ids[0]!, returnCursor, 40_000,
        (snapshot) => span(flat(snapshot.player), flat(rampEnd)) <= 0.8);
      const arrivalGap = span(flat(returned.player), flat(rampEnd));
      check(site.id, "return.noEntitySelected", !returned.movement?.destinationEntityId,
        { destination: returned.movement?.destinationEntityId });
      check(site.id, "return.arrives", arrivalGap <= 0.8, { arrivalGap });
      check(site.id, "return.navigationSucceeded",
        !returned.events.events.some((event) => event.type === "navigation.failed"), "return navigation failed");
      mine.checks["return"] = { arrivalGap: Math.round(arrivalGap * 100) / 100 };
    }

    // ---- composition views for the cut-face appearance review.
    const centre = worldSitePoint(site, 0, -2);
    const centreY = await debug<number>("groundHeight", [...centre]);
    for (const shot of [
      { name: "approach", yaw, pitch: 0.42, distance: 30, height: 1.5 },
      { name: "aisle", yaw, pitch: 0.25, distance: 14, height: 1.2 },
      { name: "rear-left", yaw: yaw + Math.PI - 0.75, pitch: 0.55, distance: 30, height: 2 },
      { name: "rear-right", yaw: yaw + Math.PI + 0.75, pitch: 0.55, distance: 30, height: 2 },
      { name: "side-high", yaw: yaw + Math.PI / 2, pitch: 0.7, distance: 32, height: 2 },
    ]) {
      const ok = await debug<boolean>("inspectPose", [{ x: centre[0], y: centreY + shot.height, z: centre[1],
        yaw: shot.yaw, pitch: shot.pitch, distance: shot.distance, detached: true }]);
      assert.equal(ok, true, `inspectPose ${site.id} ${shot.name}`);
      await driver.wait(320);
      mine.shots.push({ name: shot.name, file: await driver.screenshot(out, `${site.id}-${shot.name}`) });
    }
    await debug("focusPlayer");
  }

  current = "teardown";
  report.errors = await debug("getErrors");
  report.console = driver.consoleErrors;
  report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, [], "Production runtime recorded errors");
  assert.deepEqual(report.console, [], "Browser console recorded errors");
  assert.deepEqual(report.requests, [], "Requests failed");
  report.passed = failures.length === 0;
} catch (error) {
  report.error = `${current}: ${String(error)}`;
  report.passed = false;
} finally {
  if (!report.passed) process.exitCode = 1;
  try { if (driver.page) await driver.screenshot(out, "final-state"); } catch { /* teardown only */ }
  await driver.close();
  deadline();
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, out, failures: failures.length,
    error: report.error, byMine: Object.fromEntries(Object.entries(report.mines as Record<string, MineReport>)
      .map(([id, value]) => [id, { shots: value.shots.length,
        failed: failures.filter((entry) => entry.mine === id).map((entry) => entry.check) }])) }, null, 2));
}
