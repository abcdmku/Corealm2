/**
 * Root-run final-world integration, one settlement per invocation, 60 seconds maximum.
 * npx tsx test-results/settlement-walk-browser.ts --region fallowmarch
 * Repeat with vellenwood, karrowmoor and kilnhalt against the existing server on 4175.
 * Production graphics, hardware D3D11, normal simulation clock. No server ownership.
 * One setup relocation, then real navigation and canvas interactions. Screenshots need review.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA, INTERACT_RANGE, PLAYER_RADIUS } from "../../../game/src/app/config.js";
import type { GameEvent, InteractionId, SemanticEntity, Vec3 } from "../../../game/src/contracts.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import { GameDriver } from "../../../tools/lib/driver.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}
const regionId = argument("--region", "fallowmarch");
const traceMovement = process.argv.includes("--trace-movement");
const region = REGIONS.find((row) => row.id === regionId);
assert(region?.settlement, `Use --region ${REGIONS.map((row) => row.id).join("|")}`);
const settlement = region.settlement;
const shop = settlement.shops.find((row) => row.shopKind === "general");
const station = settlement.stations.find((row) => row.kind === "crafting_table")
  ?? settlement.stations.find((row) => row.kind === "anvil");
assert(shop && station, "Settlement needs an authored general shop and crafting station");
const stops = [
  { role: "bank", source: settlement.bank, verb: "Bank", panel: "bank", interaction: "bank" },
  { role: "shop", source: shop, verb: "Trade with", panel: "shop", interaction: "trade" },
  { role: "craft", source: station, verb: "Use", panel: "production", interaction: "produce" },
];
const origin = argument("--url", process.env.COREALM_URL ?? "http://127.0.0.1:4175");
const output = path.resolve("test-results/settlement-walk-browser", regionId);
const started = Date.now(), deadline = started + 57_000;
const driver = new GameDriver({ url: origin, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
type Xyz = { x: number; y: number; z: number };
interface Clearance {
  position: Vec3; resolved: Vec3; radius: number; staticShift: number;
  forestOverlaps: string[]; forestCoverage: "resident-only"; residentTrunks: number;
}
interface Debug {
  getState(): {
    ready: boolean; hoveredEntityId: string | null;
    clock: { paused: boolean; timeScale: number; elapsedMs: number };
    assets: { queued: number; inflight: number; failed: number };
  };
  getPlayer(): { position: Xyz; regionId: string; moving: boolean; dead: boolean; inCombat: boolean; health: number };
  getEntity(id: string): SemanticEntity | null;
  listEntities(filter?: { regionId?: string }): SemanticEntity[];
  getNavigationState(): unknown;
  getMovementDetourDiagnostics(): unknown;
  getCamera(): { position: Xyz; target: Xyz; yaw: number; pitch: number; distance: number; freeMove: boolean };
  getDrawnBounds(id: string): { min: Xyz; max: Xyz; meshes: number } | null;
  getEvents(since?: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  groundHeight(x: number, z: number): number;
  getNavPoint(point: Vec3): Xyz | null;
  probeWorldClearance(options: { x: number; y: number; z: number; radius: number }): Clearance;
  inspectPose(pose: { x: number; y: number; z: number; yaw: number; pitch: number; distance: number }): boolean;
  getErrors(): unknown[];
}
type GameWindow = { __gameDebug: Debug };
const report: Record<string, unknown> = {
  passed: false, status: "failed", regionId, settlementId: settlement.id, origin, budgetMs: 60_000,
  scope: "One bank, general shop and covered crafting station in each of four authored settlements. All four invocations are required. This does not certify every building or station variant.",
  integration: "Final-world placement and wiring after the separate production structure lab acceptance, per docs/feature-lab.md.",
  visualAcceptance: "Root must inspect the before/after screenshots for readable service models, canopy openings, player footing and UI. A semantic pass does not accept art.",
  clearanceCoverage: "Actual player positions sampled during navigation using canonical static solids and resident forest colliders at PLAYER_RADIUS. Unsampled frames and unloaded forest are not certified.",
  setup: null, stops: [], screenshots: [],
  authoredStops: stops.map((stop) => ({ role: stop.role, service: stop.source,
    host: settlement.buildings.find((building) => building.id === stop.source.attachedTo) ?? null })),
};
let stage = "launch", documentId: number | undefined, totalWalked = 0;
const watchdog = setTimeout(() => {
  report.status = "failed"; report.passed = false; report.failure = `Hard 60-second deadline at ${stage}`;
  void writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2)).finally(() => process.exit(124));
}, 60_000);
function budget(maximum = 3_000): number {
  assert(Date.now() < deadline, `Scenario deadline at ${stage}`);
  return Math.max(1, Math.min(maximum, deadline - Date.now()));
}
async function bounded<T>(label: string, operation: () => Promise<T>, maximum = 3_000): Promise<T> {
  stage = label;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), budget(maximum));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function gap(a: Xyz, b: Xyz): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function clear(probe: Clearance): void {
  assert(probe && Number.isFinite(probe.staticShift), "Canonical clearance probe is unavailable");
  assert.equal(probe.radius, PLAYER_RADIUS);
  assert(probe.staticShift <= 0.01, `Player intersects static geometry by ${probe.staticShift.toFixed(4)} m`);
  assert.deepEqual(probe.forestOverlaps, [], "Player overlaps a resident tree trunk");
}
async function sample(since?: number) {
  const result = await bounded("sample movement and body clearance", () => driver.page!.evaluate(({ radius, cursor, npcIds }) => {
    const d = (window as unknown as GameWindow).__gameDebug;
    const player = d.getPlayer();
    const clearance = d.probeWorldClearance({ ...player.position, radius });
    const nearbyNpcs = npcIds.map((id) => d.getEntity(id))
      .filter((entity) => entity && Math.hypot(entity.position[0] - player.position.x, entity.position[2] - player.position.z) < 3)
      .map((entity) => ({ id: entity!.id, state: entity!.state, position: entity!.position }));
    return { documentId: performance.timeOrigin, wallMs: performance.now(), player, state: d.getState(),
      clearance, nearbyNpcs, events: d.getEvents(cursor) };
  }, { radius: PLAYER_RADIUS, cursor: since, npcIds: settlement.npcs.map((npc) => npc.id) }));
  // Preserve the rejected position too. The walk loop only receives samples that pass these checks.
  report.lastSample = result;
  documentId ??= result.documentId;
  assert.equal(result.documentId, documentId, "Document reloaded during the walk");
  assert(result.state.ready && !result.player.dead && !result.player.inCombat);
  assert.equal(result.player.regionId, regionId);
  assert.equal(result.state.clock.timeScale, 1, "Normal simulation speed is required");
  assert.equal(result.state.clock.paused, false);
  if (since !== undefined) assert.equal(result.events.dropped ?? false, false, "Movement event history was dropped");
  clear(result.clearance);
  return result;
}
async function capture(name: string): Promise<void> {
  (report.screenshots as string[]).push(await bounded(`capture ${name}`, () => driver.screenshot(output, name), 4_500));
}
async function settleCamera(): Promise<void> {
  await bounded("wait for the production follow camera", () => driver.page!.evaluate(async () => {
    const d = (window as unknown as GameWindow).__gameDebug;
    const start = performance.now();
    let stable = start, previous = d.getCamera();
    while (performance.now() - start < 2_000) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = d.getCamera();
      if (Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y,
        current.position.z - previous.position.z) > 0.003) stable = performance.now();
      if (performance.now() - stable >= 120) return;
      previous = current;
    }
    throw new Error("Follow camera did not settle");
  }));
}
async function canvasInteraction(stop: typeof stops[number], entity: SemanticEntity) {
  const page = driver.page!;
  // Two ordinary orbit drags can expose a service behind a canopy post. They never move the player.
  const attempts: unknown[] = [];
  for (let orbit = 0; orbit < 3; orbit++) {
    await settleCamera();
    const projection = await bounded("project the drawn service", () => page.evaluate((id) => {
      const d = (window as unknown as GameWindow).__gameDebug;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return { camera: d.getCamera(), bounds: d.getDrawnBounds(id),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, entity.id));
    assert(projection.bounds && projection.bounds.meshes > 0, `${entity.id} has no drawn geometry`);
    const camera = new PerspectiveCamera(CAMERA.fov, projection.rect.width / projection.rect.height, CAMERA.near, CAMERA.far);
    camera.position.set(projection.camera.position.x, projection.camera.position.y, projection.camera.position.z);
    camera.lookAt(projection.camera.target.x, projection.camera.target.y, projection.camera.target.z);
    camera.updateMatrixWorld(true);
    const bounds = projection.bounds;
    for (const v of [0.65, 0.35, 0.85]) for (const u of [0.5, 0.2, 0.8]) {
      budget();
      const point = new Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * u,
        bounds.min.y + (bounds.max.y - bounds.min.y) * v, (bounds.min.z + bounds.max.z) / 2).project(camera);
      const x = projection.rect.x + (point.x + 1) * projection.rect.width / 2;
      const y = projection.rect.y + (1 - point.y) * projection.rect.height / 2;
      if (Math.abs(point.z) > 1 || x < 0 || x >= 1440 || y < 0 || y >= 900) continue;
      await bounded("hover the actual service mesh", () => driver.moveMouse(x, y));
      await driver.wait(80);
      const hit = await bounded("verify production hover", () => page.evaluate(({ x, y }) => ({
        hovered: (window as unknown as GameWindow).__gameDebug.getState().hoveredEntityId,
        surface: document.elementFromPoint(x, y)?.tagName,
      }), { x, y }));
      attempts.push({ orbit, x, y, ...hit });
      if (hit.hovered !== entity.id || hit.surface !== "CANVAS") continue;
      await capture(`${stop.role}-arrived`);
      await bounded("open world context menu", () => driver.click(x, y, "right"));
      const item = page.getByRole("menuitem", { name: `${stop.verb} ${entity.name}`, exact: true });
      await item.waitFor({ state: "visible", timeout: budget(1_500) });
      assert.notEqual(await item.getAttribute("aria-disabled"), "true", `${entity.id} interaction is disabled`);
      await item.click({ timeout: budget(1_500) });
      return { point: { x, y }, attempts, projection };
    }
    if (orbit < 2) {
      const before = await sample();
      await bounded("orbit around the canopy through mouse input", () => driver.drag(720, 420, 920, 420, "middle"));
      const after = await sample();
      assert(gap(before.player.position, after.player.position) < 0.005, "Camera input moved the player");
    }
  }
  throw new Error(`No canvas hover reached ${entity.id}: ${JSON.stringify(attempts)}`);
}

try {
  await mkdir(output, { recursive: true });
  await bounded("launch Chromium", () => driver.launch(), 5_000);
  const page = driver.page!;
  page.setDefaultTimeout(2_000);
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
  await bounded("boot the actual authored world", () => driver.open(budget(20_000), "/index.html"), 22_000);
  report.renderer = await bounded("verify hardware graphics", () => page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return extension && gl ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  }));
  assert(typeof report.renderer === "string" && /D3D11|Direct3D11/i.test(report.renderer)
    && !/SwiftShader|llvmpipe|Microsoft Basic|software/i.test(report.renderer), "Hardware D3D11 is required");
  report.setup = await bounded("one setup relocation near the authored settlement centre", () => page.evaluate(({ centre, yaw, radius }) => {
    const d = (window as unknown as GameWindow).__gameDebug;
    // Source centre plus small setup offsets, projected and checked by production navigation/solids.
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const x = centre[0] + dx!, z = centre[1] + dz!;
      const stand = d.getNavPoint([x, d.groundHeight(x, z), z]);
      if (!stand || Math.hypot(stand.x - x, stand.z - z) > 2) continue;
      const clearance = d.probeWorldClearance({ ...stand, radius });
      if (clearance.staticShift > 0.01 || clearance.forestOverlaps.length) continue;
      if (!d.inspectPose({ ...stand, yaw, pitch: 0.58, distance: 12 })) continue;
      return { method: "inspectPose", setupOnly: true, stand, clearance, player: d.getPlayer() };
    }
    throw new Error("No clear setup point near the authored settlement centre");
  }, { centre: settlement.centre, yaw: settlement.bank.rotationY, radius: PLAYER_RADIUS }));
  await settleCamera();
  await sample();
  if (traceMovement) await bounded("enable local movement evidence", () => driver.callDebug("setMovementDetourDiagnostics", [true]));
  await capture("before-settlement-walk");

  for (const stop of stops) {
    const entity = await bounded(`read ${stop.role} from the live registry`, () => driver.callDebug("getEntity", [stop.source.id])) as SemanticEntity | null;
    assert(entity && entity.regionId === regionId && entity.interactions.includes(stop.interaction as InteractionId));
    assert.equal(entity.meta?.settlementId, settlement.id);
    assert(Math.hypot(entity.position[0] - stop.source.position[0], entity.position[2] - stop.source.position[1]) < 0.01,
      `${entity.id} does not use its authored settlement location`);
    const host = settlement.buildings.find((building) => building.id === stop.source.attachedTo);
    assert(host, `${stop.source.id} has no authored host building`);
    const before = await sample();
    const cursor = before.events.nextSeq;
    const row: Record<string, unknown> = { role: stop.role, entity, host, before, samples: [] };
    (report.stops as unknown[]).push(row);
    row.move = await bounded(`walk to ${entity.id}`, () => driver.callDebug("callTool", ["corealm_move_to", { entityId: entity.id }]));
    row.navigation = await bounded("record the actual movement path", () => driver.callDebug("getNavigationState"));
    const move = row.move as { error?: unknown; pathLength?: number; etaMs?: number };
    assert(!move.error && Number.isFinite(move.pathLength), `Navigation rejected ${entity.id}: ${JSON.stringify(move)}`);
    const walkEnd = Math.min(deadline, Date.now() + 14_000);
    let previous = before.player.position, walked = 0, completed = false;
    while (Date.now() < walkEnd) {
      const current = await sample(cursor);
      (row.samples as unknown[]).push(current);
      walked += gap(previous, current.player.position); previous = current.player.position;
      const failures = current.events.events.filter((event) => event.type === "navigation.failed");
      assert.equal(failures.length, 0, `Navigation failed: ${JSON.stringify(failures)}`);
      completed = current.events.events.some((event) => event.type === "navigation.completed" && event.entityId === entity.id);
      if (completed && !current.player.moving) { row.arrival = current; break; }
      await driver.wait(100);
    }
    assert(completed && row.arrival, `${entity.id} never produced a completed, idle arrival`);
    row.walkedMetres = walked; totalWalked += walked;
    const arrival = row.arrival as Awaited<ReturnType<typeof sample>>;
    const target = entity.interactionPosition ?? entity.position;
    row.arrivalGap = gap(arrival.player.position, { x: target[0], y: target[1], z: target[2] });
    assert((row.arrivalGap as number) <= INTERACT_RANGE + 0.01, `${entity.id} arrived outside interaction range`);
    row.canvas = await canvasInteraction(stop, entity);
    const panel = page.locator(`#panel-${stop.panel}`);
    await panel.waitFor({ state: "visible", timeout: budget(2_000) });
    const subtitle = await panel.locator(".panel__subtitle").innerText();
    if (stop.role === "craft") assert.equal(subtitle, entity.name);
    if (stop.role === "bank") assert.match(subtitle, /^\d+ of \d+ slots$/);
    const count = stop.role === "craft" ? await panel.locator(".production-row").count()
      : stop.role === "shop" ? await panel.locator(".shop-list").first().locator(".shop-row").count()
        : await panel.locator(".bank-grid").count();
    assert(count > 0, `${stop.panel} opened without its production content`);
    // An empty recipeIds list means all compatible skill recipes, not an empty station.
    if (stop.role === "craft" && entity.station!.recipeIds.length > 0) assert.equal(count, entity.station!.recipeIds.length);
    const after = await sample(cursor);
    assert(!after.player.moving && gap(arrival.player.position, after.player.position) < 0.01,
      "Opening the reached service must not relocate the player or start another walk");
    if (stop.role !== "craft") assert(after.events.events.some((event) =>
      event.type === "activity.started" && event.entityId === entity.id), `${entity.id} did not emit its real interaction`);
    row.ui = { selector: `#panel-${stop.panel}`, subtitle, contentRows: count, after };
    await capture(`${stop.role}-interaction-ui`);
    await panel.locator(".panel__close").click({ timeout: budget(1_500) });
    await panel.waitFor({ state: "hidden", timeout: budget(1_000) });
  }
  assert(totalWalked > 10, "The settlement scenario did not establish a meaningful actual walk");
  report.totalWalkedMetres = totalWalked;
  const final = await sample();
  report.final = final;
  if (traceMovement) report.movementEvidence = await bounded("read completed detour evidence", () => driver.callDebug("getMovementDetourDiagnostics"));
  assert.equal(final.state.assets.failed, 0, "A production asset failed to load");
  report.gameErrors = await bounded("read game errors", () => driver.callDebug("getErrors"));
  assert.deepEqual(report.gameErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.requestErrors, []);
  report.passed = true; report.status = "semantic-pass-awaiting-screenshot-review";
} catch (error) {
  report.failure = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  report.failedStage = stage;
  if (traceMovement && driver.page && Date.now() < deadline - 2_000) {
    report.movementEvidence = await bounded("read actual detour rejection evidence", () => driver.page!.evaluate(() => {
      const d = (window as unknown as GameWindow).__gameDebug;
      const player = d.getPlayer();
      return { diagnostics: d.getMovementDetourDiagnostics(), navigation: d.getNavigationState(),
        actors: d.listEntities({ regionId: player.regionId }).filter((entity) =>
          ["npc", "enemy", "boss"].includes(entity.archetype)
          && Math.hypot(entity.position[0] - player.position.x, entity.position[2] - player.position.z) < 6)
          .map((entity) => ({ id: entity.id, state: entity.state, position: entity.position, archetype: entity.archetype })) };
    })).catch((diagnosticError: unknown) => ({ error: String(diagnosticError) }));
  }
  if (driver.page && Date.now() < deadline - 2_000) await capture("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  report.elapsedMs = Date.now() - started;
  report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors; report.requestErrors = driver.requestErrors;
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const closed = await Promise.race([driver.close().then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_500))]);
  clearTimeout(watchdog);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, regionId, elapsedMs: report.elapsedMs, report: path.join(output, "report.json"), failure: report.failure })}\n`);
  if (!closed) process.exit(process.exitCode ?? 1);
}
