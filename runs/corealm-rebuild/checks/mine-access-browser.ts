/** Root-owned browser proof. Authoring this file does not run a browser.
 * npx tsx test-results/mine-access-browser.ts --site bracken_workings --mode lab
 * npx tsx test-results/mine-access-browser.ts --site bracken_workings --mode world
 * Optional --cut-face isolates the two-seam Bracken fixture in lab mode.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PerspectiveCamera, Vector3 } from "three";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installAssetCandidates } from "../../../tools/lib/assetCandidates.js";
import { CAMERA, PLAYER_RADIUS } from "../../../game/src/app/config.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../../../game/src/content/worldSites.js";
import { worldSiteHaulRamp } from "../../../game/src/world/siteTerrain.js";
import type { GameEvent, GameState, SemanticEntity, Vec3 } from "../../../game/src/contracts.js";

type Point = { x: number; y: number; z: number };
type Bounds = { min: Point; max: Point; height: number; width: number; meshes: number };
type Camera = { position: Point; target: Point; yaw: number; pitch: number; requestedDistance: number };
type Clearance = { position: Vec3; resolved: Vec3; radius: number; staticShift: number; forestOverlaps: unknown[]; forestCoverage: string };
type EventBatch = { events: GameEvent[]; nextSeq: number; dropped?: boolean };
type State = { ready: boolean; selectedEntityId: string | null; hoveredEntityId: string | null; clock: { elapsedMs: number; timeScale: number; paused: boolean } };
type RouteProof = {
  label: string; from: Vec3; to: Vec3; path: Point[] | null; departureGap: number | null; arrivalGap: number | null;
  length: number; maxStaticShift: number; forestOverlapSamples: number;
  samples: { position: Vec3; clearance: Clearance }[]; failures: string[];
};
type AccessProof = {
  start: { authored: Vec3; projected: Point | null; gap: number | null };
  apron: Vec3;
  stances: { id: string; entity: SemanticEntity | null; bounds: Bounds | null; stance: Vec3 | null; projected: Point | null; projectionGap: number | null; clearance: Clearance | null; failures: string[] }[];
  routes: RouteProof[]; failures: string[];
};
type LiveTrace = {
  stopped: boolean; error: string | null; travelled: number; maxStaticShift: number; forestOverlapSamples: number;
  positions: { atMs: number; position: Point; clearance: Clearance; activity: unknown }[];
  firstActive: { position: Point; stanceGap: number; atMs: number; activity: unknown; playerMotion: unknown } | null;
  maxActiveStanceGap: number; clockViolations: number;
};
type Observation = {
  state: State; entity: SemanticEntity; player: Point; camera: Camera; bounds: Bounds | null;
  events: EventBatch; activity: unknown; movement: GameState["player"]["movement"];
  inventory: GameState["inventory"]; trace: LiveTrace | null; errors: unknown[]; playerMotion: unknown;
};

const args = process.argv.slice(2);
const options: Record<string, string> = {};
let cutFace = false;
for (let i = 0; i < args.length; i++) {
  const name = args[i]!;
  if (name === "--cut-face") { cutFace = true; continue; }
  assert(["--site", "--mode", "--url", "--out", "--entity", "--catalog"].includes(name), `Unknown argument ${name}`);
  const value = args[++i];
  assert(value && !value.startsWith("--"), `${name} requires a value`);
  assert(!(name in options), `${name} was specified twice`);
  options[name] = value;
}
const source = WORLD_SITES.find((site) => site.kind === "mine" && site.id === options["--site"]);
assert(source, `--site must be one exact mine ID: ${WORLD_SITES.filter((site) => site.kind === "mine").map((site) => site.id).join(", ")}`);
const mode = options["--mode"] ?? "lab";
assert(mode === "lab" || mode === "world", "--mode must be lab or world");
assert(!cutFace || (mode === "lab" && source.id === "bracken_workings"), "--cut-face requires --mode lab --site bracken_workings");
const site: WorldSite = mode === "world" ? source : {
  ...source, centre: cutFace ? [70, 25] : [0, 25], rotationY: 0,
  ...(cutFace ? {
    resourceSlots: source.resourceSlots.slice(0, 2).map((slot, index) => ({
      ...slot, x: index ? 2.6 : -2.6, z: index ? -0.8 : 0,
      yaw: index ? 0.18 : -0.12, scale: index ? 1.1 : 0.95,
    })),
  } : {}),
};
const ids = site.resourceSlots.map((slot) => `${slot.clusterId}_${slot.index}`);
const targetId = options["--entity"] ?? ids[Math.floor(ids.length / 2)]!;
assert(ids.includes(targetId), `--entity ${targetId} is not in ${source.id}`);
const route = mode === "lab" ? "/index.html?mode=combat&environment=1" : "/index.html";
const out = path.resolve(options["--out"] ?? `test-results/mine-access-browser/${mode}-${source.id}${cutFace ? "-cut-face" : ""}`);
mkdirSync(out, { recursive: true });
const started = Date.now();
const deadline = started + 59_500;
const actionDeadline = deadline - 2_500;
const actions: { label: string; elapsedMs: number; value: unknown }[] = [];
const screenshots: string[] = [];
const report: Record<string, unknown> = {
  passed: false, status: "running", site: source.id, mode, cutFace, targetId, route, budgetMs: 59_500,
  startedAt: new Date(started).toISOString(),
  viewport: { width: 1440, height: 900 }, actions, screenshots,
  visualAcceptance: "Pending root inspection of mine-wide and working-close screenshots. Semantic success does not accept the artwork.",
  scope: mode === "world"
    ? "Authored world placement and haul-ramp integration. The reusable mine fixture must already have lab acceptance."
    : "Production environment fixture, ore entities, dressing, cut face, navigation, body clearance and pointer mining.",
  setupPolicy: "Fresh browser context; debug inventory and skill grants; one initial placement at the authored haul-ramp end. Normal simulation clock throughout.",
};
const driver = new GameDriver({ url: options["--url"] ?? "http://127.0.0.1:4175", close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
let cursor = 0;
let stage = "boot";
const watchdog = setTimeout(() => {
  report.passed = false;
  report.status = "failed";
  report.error = `Hard deadline reached at ${stage}`;
  report.elapsedMs = Date.now() - started;
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  process.exit(1);
}, deadline - Date.now());

function record(label: string, value: unknown): void {
  actions.push({ label, elapsedMs: Date.now() - started, value });
}
function remaining(limit = 5_000): number {
  const left = actionDeadline - Date.now();
  assert(left > 0, `Action budget exhausted at ${stage}`);
  return Math.max(1, Math.min(left, limit));
}
async function bounded<T>(label: string, action: () => Promise<T>, limit = 5_000): Promise<T> {
  const timeout = remaining(limit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
// Literal browser programs keep nested helpers/RAF callbacks out of tsx's __name transform.
async function evaluate<T>(program: string, input: unknown = null, limit = 5_000): Promise<T> {
  return bounded("browser evaluation", () => driver.page!.evaluate<T>(`(() => { const input = ${JSON.stringify(input)}; ${program}\n})()`), limit);
}
async function debug<T>(method: string, params: unknown[] = []): Promise<T> {
  return bounded(method, () => driver.callDebug(method, params)) as Promise<T>;
}
async function capture(name: string): Promise<void> {
  const filename = await bounded(`capture ${name}`, () => driver.screenshot(out, name));
  screenshots.push(filename);
  record("screenshot", { name, filename, observation: await evaluate(`
    const d = window.__gameDebug;
    return { camera: d.getCamera(), player: d.getPlayerPosition(), activity: d.getCurrentActivity(),
      entity: d.getEntity(input), clock: d.getState().clock, playerMotion: d.getPlayerMotion() };
  `, targetId) });
}
function gap(point: Point, target: Vec3): number { return Math.hypot(point.x - target[0], point.z - target[2]); }
function tuple(point: Point): Vec3 { return [point.x, point.y, point.z]; }
async function observe(): Promise<Observation> {
  return evaluate<Observation>(`
    const d = window.__gameDebug;
    const save = JSON.parse(d.getSaveBlob());
    return { state: d.getState(), entity: d.getEntity(input.id), player: d.getPlayerPosition(),
      camera: d.getCamera(), bounds: d.getDrawnBounds(input.id), events: d.getEvents(input.since),
      activity: d.getCurrentActivity(), movement: save.player.movement, inventory: save.inventory, playerMotion: d.getPlayerMotion(),
      trace: window.__mineAccessTrace || null, errors: d.getErrors() };
  `, { id: targetId, since: cursor });
}
async function settleCamera(): Promise<void> {
  await evaluate(`return new Promise((resolve, reject) => {
    const d = window.__gameDebug, started = performance.now();
    let previous = d.getCamera(), stableSince = started;
    const sample = () => {
      const current = d.getCamera(), now = performance.now();
      const delta = Math.max(Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y, current.position.z - previous.position.z),
        Math.hypot(current.target.x - previous.target.x, current.target.y - previous.target.y, current.target.z - previous.target.z));
      if (delta > 0.002) stableSince = now;
      if (now - stableSince >= 180) return resolve(true);
      if (now - started > 2500) return reject(new Error('Camera did not settle'));
      previous = current; requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });`, null, 3_000);
}

try {
  await bounded("launch Chromium", () => driver.launch(), 10_000);
  if (options["--catalog"]) await bounded("serve staged assets", () => installAssetCandidates(driver.page!, options["--catalog"]!), 5_000);
  driver.page!.setDefaultTimeout(remaining());
  await bounded("open production game", () => driver.open(remaining(24_000), route), 26_000);
  const renderer = await evaluate<{ vendor: string; renderer: string; settings: string | null }>(`
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      settings: localStorage.getItem('corealm.settings.v1') };
  `);
  report.renderer = renderer;
  assert(/D3D11|Direct3D11/i.test(renderer.renderer) && !/SwiftShader|llvmpipe|software/i.test(renderer.renderer), "Production visual proof requires hardware D3D11");
  const boot = await evaluate<{ state: State; navigation: { status: string }; lab: { engine: string } | null }>(`
    return { state: window.__gameDebug.getState(), navigation: window.__gameDebug.getNavigationState(),
      lab: window.__featureLab ? window.__featureLab.getState() : null };
  `);
  report.boot = boot;
  assert(boot.state.ready && boot.navigation.status === "ready", "Production game and navigation must both be ready");
  assert.equal(boot.state.clock.timeScale, 1);
  assert.equal(boot.state.clock.paused, false);
  if (mode === "lab") assert.equal(boot.lab?.engine, "corealm-production");
  if (mode === "lab") {
    stage = "environment fixture";
    await evaluate(`return window.__environmentLab.${cutFace ? "showCutFace()" : "showSite(input)"};`, source.id, 12_000);
    const fixture = await evaluate<{ ready: boolean; selection: string; entityIds: string[] }>("return window.__environmentLab.getState();");
    report.fixture = fixture;
    assert(fixture.ready && fixture.selection === (cutFace ? "two-seam-slope" : source.id));
    assert.deepEqual([...fixture.entityIds].sort(), [...ids].sort(), "Fixture omitted authored resource slots");
  }
  stage = "haul-ramp setup";
  const ramp = worldSiteHaulRamp(site);
  const startY = await debug<number>("groundHeight", [...ramp.worldEnd]);
  const start: Vec3 = [ramp.worldEnd[0], startY, ramp.worldEnd[1]];
  const startNav = await debug<Point | null>("getNavPoint", [start]);
  report.haulRamp = { authored: ramp, requestedStart: start, projectedStart: startNav };
  assert(startNav && gap(startNav, start) <= 0.2, "Authored haul-ramp end does not project to a nearby navigation point");
  // World inspectPose moves the player. It is allowed only here, before interaction proof.
  assert.equal(await debug("inspectPose", [{ x: start[0], y: start[1], z: start[2],
    yaw: site.rotationY + site.terrain.approachAngle, pitch: 0.65, distance: 34 }]), true);
  assert.equal(await debug("teleport", [tuple(startNav)]), true);
  const placed = await debug<Point>("getPlayerPosition");
  record("debug setup: place at authored haul-ramp end", { requested: start, projected: startNav, placed });
  assert(gap(placed, start) <= 0.2, "Setup drifted away from the authored ramp end");
  await debug("clearInventory");
  const target = await debug<SemanticEntity>("getEntity", [targetId]);
  assert(target?.resource && target.archetype === "ore" && target.interactionPosition, "Representative ore has no precise production stance");
  const pickaxe = target.tier >= 20 ? "emberite_pickaxe" : target.tier >= 10 ? "kaldite_pickaxe" : target.tier >= 5 ? "corven_pickaxe" : "grithe_pickaxe";
  const grant = await debug<{ ok: boolean; value: number }>("giveItem", [pickaxe, 1, "inventory"]);
  assert(grant.ok && grant.value === 1, "Pickaxe grant failed");
  const level = await debug<number>("setSkillLevel", ["mining", 99]);
  assert.equal(level, 99);
  record("debug setup: inventory and eligibility", { clearedInventory: true, pickaxe, grant, level, required: target.requirements?.mining,
    reason: "High base Mining level makes natural gathering attempts reliable within the bounded browser run; no clock or yield edits." });
  for (const selector of ["#panel-feature-lab"]) {
    const panel = driver.page!.locator(selector);
    if (await bounded("panel visibility", () => panel.isVisible())) await bounded("close fixture panel", () => panel.locator(".panel__close").click());
  }
  if (mode === "lab") record("hide environment authoring overlay for pointer and screenshots", await evaluate(`
    const panel = document.getElementById('environment-lab-panel');
    if (!panel) throw new Error('Environment authoring panel is missing');
    panel.hidden = true; return { id: panel.id, hidden: panel.hidden };
  `));

  stage = "await resident ore views after haul-ramp placement";
  await bounded("resident ore views", () => driver.page!.waitForFunction(resourceIds => resourceIds.every(id => {
    const bounds = (window as any).__gameDebug.getDrawnBounds(id);
    return bounds && bounds.meshes > 0;
  }), ids, { timeout: remaining(8_000) }), 8_500);
  stage = "all ore stances and aisles";
  const apronXZ = worldSitePoint(site, Math.sin(site.terrain.approachAngle) * 2, Math.cos(site.terrain.approachAngle) * 2);
  const proof = await evaluate<AccessProof>(`
    const d = window.__gameDebug, failures = [], stances = [], routes = [];
    const apron = [input.apron[0], d.groundHeight(...input.apron), input.apron[1]];
    const distance = (p, q) => Math.hypot(p.x - q[0], p.z - q[2]);
    const apronProjection = d.getNavPoint(apron);
    const apronClearance = d.probeWorldClearance({ x: apron[0], y: apron[1], z: apron[2], radius: input.radius });
    if (!apronProjection || distance(apronProjection, apron) > 0.2) failures.push('Apron is displaced by navigation projection');
    if (!apronClearance || apronClearance.staticShift > 0.02 || apronClearance.forestOverlaps.length) failures.push('Player body overlaps live collision on the apron');
    const projectedStart = d.getNavPoint(input.start);
    const start = { authored: input.start, projected: projectedStart, gap: projectedStart ? distance(projectedStart, input.start) : null };
    for (const id of input.ids) {
      const entity = d.getEntity(id), stance = entity && entity.interactionPosition || null;
      const projected = stance ? d.getNavPoint(stance) : null;
      const clearance = stance ? d.probeWorldClearance({ x: stance[0], y: stance[1], z: stance[2], radius: input.radius }) : null;
      const row = { id, entity, bounds: d.getDrawnBounds(id), stance, projected,
        projectionGap: projected && stance ? distance(projected, stance) : null, clearance, failures: [] };
      if (!entity || entity.archetype !== 'ore' || !entity.resource || !stance) row.failures.push('Missing production ore or precise stance');
      if (!row.bounds || row.bounds.meshes <= 0) row.failures.push('Resource has no drawn bounds');
      if (!projected || row.projectionGap > 0.2) row.failures.push('Stance is displaced by navigation projection');
      if (!clearance || clearance.staticShift > 0.02 || clearance.forestOverlaps.length) row.failures.push('Player body overlaps live collision at stance');
      stances.push(row);
    }
    const checkRoute = (label, from, to) => {
      const path = d.getNavPath(from, to);
      const row = { label, from, to, path, departureGap: path && path.length ? distance(path[0], from) : null,
        arrivalGap: path && path.length ? distance(path[path.length - 1], to) : null,
        length: 0, maxStaticShift: 0, forestOverlapSamples: 0, samples: [], failures: [] };
      if (!path || path.length < 2) row.failures.push('No complete navigation path');
      if (row.departureGap === null || row.departureGap > 0.2) row.failures.push('Path starts away from its authored departure');
      if (row.arrivalGap === null || row.arrivalGap > 0.45) row.failures.push('Path misses precise destination');
      if (path) for (let index = 1; index < path.length; index++) {
        const a = path[index - 1], b = path[index], length = Math.hypot(b.x - a.x, b.z - a.z);
        row.length += length;
        const steps = Math.max(1, Math.ceil(length / 0.2));
        for (let step = 0; step <= steps; step++) {
          const t = step / steps, position = [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t];
          const clearance = d.probeWorldClearance({ x: position[0], y: position[1], z: position[2], radius: input.radius });
          if (!clearance) throw new Error('Production body-clearance probe is unavailable');
          row.maxStaticShift = Math.max(row.maxStaticShift, clearance.staticShift);
          row.forestOverlapSamples += clearance.forestOverlaps.length ? 1 : 0;
          row.samples.push({ position, clearance });
        }
      }
      if (row.maxStaticShift > 0.02) row.failures.push('Navigation path intersects production static collision');
      if (row.forestOverlapSamples) row.failures.push('Navigation path intersects resident forest trunks');
      routes.push(row);
    };
    checkRoute('haul ramp to apron', input.start, apron);
    for (const row of stances) if (row.stance) {
      checkRoute('apron to ' + row.id, apron, row.stance);
      checkRoute(row.id + ' return to apron', row.stance, apron);
    }
    checkRoute('apron return to haul ramp', apron, input.start);
    for (let index = 1; index < stances.length; index++) {
      const a = stances[index - 1], b = stances[index];
      if (a.stance && b.stance) checkRoute('adjacent aisle ' + a.id + ' to ' + b.id, a.stance, b.stance);
    }
    const target = stances.find(row => row.id === input.target);
    if (target && target.stance) checkRoute('clicked haul-ramp approach', input.start, target.stance);
    for (const row of stances) for (const failure of row.failures) failures.push(row.id + ': ' + failure);
    for (const row of routes) for (const failure of row.failures) failures.push(row.label + ': ' + failure);
    return { start, apron, apronProjection, apronClearance, stances, routes, failures };
  `, { ids, start, apron: apronXZ, target: targetId, radius: PLAYER_RADIUS }, 8_000);
  report.access = proof;
  record("all stance and route probes", { stances: proof.stances.length, routes: proof.routes.length, radius: PLAYER_RADIUS, failures: proof.failures });
  if (mode === "lab") {
    const bounds = await evaluate<{ min: Vec3; max: Vec3 }>("return window.__environmentLab.getBounds();");
    assert(bounds, "Fixture has no visual bounds");
    await debug("inspectPose", [{ x: (bounds.min[0] + bounds.max[0]) / 2, y: (bounds.min[1] + bounds.max[1]) / 2,
      z: (bounds.min[2] + bounds.max[2]) / 2, yaw: 0.1, pitch: 0.6, distance: 34, detached: true }]);
  }
  await settleCamera();
  await capture("01-mine-wide");
  report.wideProfile = await debug("getRenderProfile");
  assert.equal(proof.failures.length, 0, proof.failures.join("; "));

  stage = "real canvas mining click";
  cursor = (await debug<EventBatch>("getEvents", [0])).nextSeq;
  const before = await observe();
  report.before = before;
  assert.equal(before.state.clock.timeScale, 1);
  assert.equal(before.state.clock.paused, false);
  assert(gap(before.player, target.interactionPosition) > 3, "The pointer proof must start outside mining range");
  assert(gap(before.player, start) <= 0.2, "Camera setup moved the player off the haul-ramp end");
  await evaluate(`
    const d = window.__gameDebug, trace = { stopped: false, error: null, travelled: 0, maxStaticShift: 0,
      forestOverlapSamples: 0, positions: [], firstActive: null, maxActiveStanceGap: 0, clockViolations: 0 };
    window.__mineAccessTrace = trace;
    let previous = null;
    const sample = () => {
      if (trace.stopped) return;
      try {
        const position = d.getPlayerPosition(), state = d.getState(), activity = d.getCurrentActivity();
        if (state.clock.timeScale !== 1 || state.clock.paused) trace.clockViolations++;
        if (activity && activity.kind === 'gathering' && activity.entityId === input.id) {
          const stanceGap = Math.hypot(position.x - input.stance[0], position.z - input.stance[2]);
          if (!trace.firstActive) trace.firstActive = { position, stanceGap, atMs: state.clock.elapsedMs, activity, playerMotion: d.getPlayerMotion() };
          trace.maxActiveStanceGap = Math.max(trace.maxActiveStanceGap, stanceGap);
        }
        if (!previous || Math.hypot(position.x - previous.x, position.z - previous.z) > 0.001) {
          const from = previous || position, length = Math.hypot(position.x - from.x, position.z - from.z);
          trace.travelled += length;
          const steps = Math.max(1, Math.ceil(length / 0.2));
          for (let step = 1; step <= steps; step++) {
            const t = step / steps, p = { x: from.x + (position.x - from.x) * t,
              y: from.y + (position.y - from.y) * t, z: from.z + (position.z - from.z) * t };
            const clearance = d.probeWorldClearance({ ...p, radius: input.radius });
            trace.maxStaticShift = Math.max(trace.maxStaticShift, clearance.staticShift);
            trace.forestOverlapSamples += clearance.forestOverlaps.length ? 1 : 0;
            trace.positions.push({ atMs: state.clock.elapsedMs, position: p, clearance, activity });
          }
          previous = position;
        }
        if (trace.positions.length > 2000) throw new Error('Movement trace exceeded 2000 samples');
      } catch (error) { trace.error = String(error); trace.stopped = true; }
      if (!trace.stopped) requestAnimationFrame(sample);
    }; sample();
  `, { id: targetId, stance: target.interactionPosition, radius: PLAYER_RADIUS });
  const screen = await evaluate<{ camera: Camera; bounds: Bounds; rect: { x: number; y: number; width: number; height: number } }>(`
    const d = window.__gameDebug, r = document.querySelector('canvas').getBoundingClientRect();
    return { camera: d.getCamera(), bounds: d.getDrawnBounds(input), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  `, targetId);
  const camera = new PerspectiveCamera(CAMERA.fov, screen.rect.width / screen.rect.height, CAMERA.near, CAMERA.far);
  camera.position.set(screen.camera.position.x, screen.camera.position.y, screen.camera.position.z);
  camera.lookAt(screen.camera.target.x, screen.camera.target.y, screen.camera.target.z);
  camera.updateMatrixWorld(true);
  const candidates: { x: number; y: number; depth: number }[] = [];
  for (const height of [0.5, 0.3, 0.7]) for (const along of [0.5, 0.3, 0.7]) for (const depth of [0.5, 0.25, 0.75]) {
    const b = screen.bounds;
    const p = new Vector3(b.min.x + (b.max.x - b.min.x) * along, b.min.y + (b.max.y - b.min.y) * height,
      b.min.z + (b.max.z - b.min.z) * depth).project(camera);
    candidates.push({ x: screen.rect.x + (p.x + 1) * screen.rect.width / 2, y: screen.rect.y + (1 - p.y) * screen.rect.height / 2, depth: p.z });
  }
  let clicked: { x: number; y: number; depth: number } | null = null;
  const hoverAttempts: unknown[] = [];
  report.pointer = { screen, hoverAttempts };
  for (const candidate of candidates) {
    remaining();
    if (candidate.depth < -1 || candidate.depth > 1 || candidate.x < 0 || candidate.y < 0 || candidate.x >= 1440 || candidate.y >= 900) continue;
    await bounded("hover ore", () => driver.moveMouse(candidate.x, candidate.y));
    let stable = true;
    for (let sample = 0; sample < 2; sample++) {
      await bounded("stable hover interval", () => driver.wait(90));
      const hover = await evaluate<{ id: string | null; canvas: boolean }>(`
        return { id: window.__gameDebug.getState().hoveredEntityId,
          canvas: document.elementFromPoint(input.x, input.y)?.tagName === 'CANVAS' };
      `, candidate);
      hoverAttempts.push({ candidate, sample, ...hover });
      if (!hover.canvas || hover.id !== targetId) { stable = false; break; }
    }
    if (stable) { clicked = candidate; break; }
  }
  assert(clicked, `No stable, unobstructed canvas hover for ${targetId}`);
  await bounded("one real ore click", () => driver.click(clicked.x, clicked.y));
  record("real canvas click", { targetId, clicked });
  const click = await observe();
  report.click = click;
  assert.equal(click.state.selectedEntityId, targetId, "Canvas click selected a different entity");
  assert.equal(click.movement.destinationEntityId, targetId, "Canvas click did not begin production movement toward the ore");
  const interactUntil = Math.min(actionDeadline, Date.now() + (mode === "lab" ? 10_000 : 18_000));
  let working: Observation | null = null;
  while (Date.now() < interactUntil) {
    const value = await observe();
    if (value.trace?.error) throw new Error(value.trace.error);
    assert(!value.events.events.some((event) => event.type === "navigation.failed"), "The clicked production route failed");
    if (value.trace?.firstActive) { working = value; break; }
    await bounded("wait for mining activity", () => driver.wait(80));
  }
  assert(working?.trace?.firstActive, "Real clicked walk never began mining within the interaction budget");
  report.working = working;
  assert(working.trace.firstActive.stanceGap <= 0.45 + 0.002, "Mining began outside its 0.45 m working stance");
  if (mode === "lab") {
    const stance = target.interactionPosition;
    await debug("inspectPose", [{ x: stance[0], y: stance[1] + 1.1, z: stance[2],
      yaw: Number(target.view?.rotationY ?? 0) + 0.3, pitch: 0.44, distance: 8, detached: true }]);
  } else {
    // Mouse zoom retains real movement/activity and cannot relocate the player like inspectPose.
    await bounded("camera-only working zoom", () => driver.page!.mouse.wheel(0, -100));
  }
  await settleCamera();
  await bounded("active mining attachment", () => driver.page!.waitForFunction(() => {
    const d = (window as any).__gameDebug;
    const motion = d.getPlayerMotion();
    return d.getCurrentActivity()?.kind === "gathering"
      && motion?.attachments?.mainHand === "equip-mainHand-pickaxe"
      && !motion?.attachmentLoading?.mainHand;
  }, undefined, { timeout: 2000 }), 2200);
  const miningMotion = await debug<any>("getPlayerMotion");
  record("active mining attachment", miningMotion);
  assert.equal(miningMotion.attachments?.mainHand, "equip-mainHand-pickaxe");
  assert(!miningMotion.attachmentErrors?.mainHand, "Mining pick attachment failed");
  await capture("02-working-close");
  const toolStance = target.interactionPosition!;
  await debug("inspectPose", [{ x: toolStance[0], y: toolStance[1] + 1.1, z: toolStance[2],
    yaw: Number(target.view?.rotationY ?? 0) + 1.05, pitch: 0.44, distance: 7, detached: true }]);
  await settleCamera();
  await capture("02b-mining-tool-side");
  report.workingProfile = await debug("getRenderProfile");
  let after = await observe();
  while (Date.now() < interactUntil && !after.events.events.some((event) => event.type === "item.received" && event.entityId === targetId && event.data.source === "gather")) {
    await bounded("wait for natural ore yield", () => driver.wait(90));
    after = await observe();
  }
  await evaluate("if (window.__mineAccessTrace) window.__mineAccessTrace.stopped = true;");
  after = await observe();
  report.after = after;
  assert(after.trace && !after.trace.error);
  assert(after.trace.travelled > 3, "The real clicked approach travelled less than three metres");
  assert(after.trace.maxStaticShift <= 0.02, "Actual player body intersects production static collision");
  assert.equal(after.trace.forestOverlapSamples, 0, "Actual player body intersects a resident trunk");
  assert(after.trace.maxActiveStanceGap <= 0.45 + 0.002, "Active mining drifted outside its precise working stance");
  assert.equal(after.trace.clockViolations, 0);
  assert.equal(after.state.clock.timeScale, 1);
  assert.equal(after.state.clock.paused, false);
  assert(!after.events.dropped, "Event history dropped the mining proof");
  const events = after.events.events;
  assert(!events.some((event) => event.type === "navigation.failed"), "Production navigation failed");
  const navigation = events.find((event) => event.type === "navigation.started");
  const arrived = events.find((event) => event.type === "navigation.completed");
  const activity = events.find((event) => event.type === "activity.started" && (event.entityId === targetId || event.data.entityId === targetId));
  const receipts = events.filter((event) => event.type === "item.received" && event.entityId === targetId
    && event.data.source === "gather" && event.data.itemId === target.resource!.itemId);
  assert(navigation && arrived && activity && receipts.length, "Missing ordered navigation, arrival, mining and natural receipt evidence");
  assert(navigation.seq < arrived.seq && arrived.seq < activity.seq && activity.seq < receipts[0]!.seq);
  const received = receipts.reduce((sum, event) => sum + Number(event.data.quantity ?? 0), 0);
  const quantity = (value: Observation) => value.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === target.resource!.itemId ? slot.quantity : 0), 0);
  assert(received > 0, "Mining produced no natural item receipt");
  assert.equal(quantity(after) - quantity(before), received, "Natural receipts disagree with inventory gain");
  assert.equal(before.entity.resource!.remaining - after.entity.resource!.remaining, received, "Natural receipts disagree with ore decrease");
  report.receiptProof = { received, inventoryBefore: quantity(before), inventoryAfter: quantity(after),
    remainingBefore: before.entity.resource!.remaining, remainingAfter: after.entity.resource!.remaining,
    firstActivityStanceGap: after.trace.firstActive?.stanceGap, maxActiveStanceGap: after.trace.maxActiveStanceGap,
    clickedEntity: targetId, actualTravelled: after.trace.travelled };
  if (mode === "world") {
    stage = "real canvas return to haul ramp";
    // The detached inspection port now guarantees camera-only placement in the
    // authored world. Frame the whole return and verify the player stayed put.
    // The initial overview yaw can otherwise leave the haul endpoint behind the camera.
    const returnDeparture = await debug<Point>("getPlayerPosition");
    const returnDistance = gap(returnDeparture, start);
    let pointer: { x: number; y: number } | null = null;
    const views = [
      { yaw: site.rotationY + site.terrain.approachAngle, pitch: 0.70 },
      { yaw: site.rotationY + site.terrain.approachAngle + Math.PI, pitch: 0.30 },
      { yaw: site.rotationY + site.terrain.approachAngle + Math.PI, pitch: 0.12 },
      { yaw: site.rotationY + site.terrain.approachAngle + Math.PI - 0.45, pitch: 0.18 },
      { yaw: site.rotationY + site.terrain.approachAngle + Math.PI + 0.45, pitch: 0.18 },
    ];
    for (const view of views) {
      await debug("inspectPose", [{ x: (returnDeparture.x + start[0]) / 2,
        y: (returnDeparture.y + start[1]) / 2 + 0.6, z: (returnDeparture.z + start[2]) / 2,
        ...view, distance: Math.max(26, returnDistance * 2), detached: true }]);
      const afterReturnCamera = await debug<Point>("getPlayerPosition");
      assert(gap(afterReturnCamera, tuple(returnDeparture)) <= 0.001,
        "Detached return camera moved the player");
      await settleCamera();
      const returnScreen = await evaluate<{ camera: Camera; rect: { x: number; y: number; width: number; height: number } }>(`
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { camera: window.__gameDebug.getCamera(), rect: { x:r.x, y:r.y, width:r.width, height:r.height } };
      `);
      const returnCamera = new PerspectiveCamera(CAMERA.fov, returnScreen.rect.width / returnScreen.rect.height, CAMERA.near, CAMERA.far);
      returnCamera.position.set(returnScreen.camera.position.x, returnScreen.camera.position.y, returnScreen.camera.position.z);
      returnCamera.lookAt(returnScreen.camera.target.x, returnScreen.camera.target.y, returnScreen.camera.target.z);
      returnCamera.updateMatrixWorld(true);
      const projected = new Vector3(...start).project(returnCamera);
      if (Math.abs(projected.x) >= 0.92 || Math.abs(projected.y) >= 0.88 || projected.z >= 1) continue;
      const candidate = { x: returnScreen.rect.x + (projected.x + 1) * returnScreen.rect.width / 2,
        y: returnScreen.rect.y + (1 - projected.y) * returnScreen.rect.height / 2 };
      await bounded("hover exact haul endpoint", () => driver.page!.mouse.move(candidate.x, candidate.y));
      let clear = true;
      for (let sample = 0; sample < 2; sample++) {
        await bounded("stable ground hover", () => driver.wait(90));
        const hit = await evaluate<{ hovered: string | null; canvas: boolean; terrainObstructed: boolean }>(`
          const d = window.__gameDebug, camera = d.getCamera().position;
          let terrainObstructed = false;
          for (let i=1;i<24;i++) {
            const t=i/24, x=camera.x+(input.target[0]-camera.x)*t, z=camera.z+(input.target[2]-camera.z)*t;
            const y=camera.y+(input.target[1]-camera.y)*t;
            if(d.sampleWorld(x,z).height>y+0.05) terrainObstructed=true;
          }
          return { hovered:d.getState().hoveredEntityId, terrainObstructed,
            canvas:document.elementFromPoint(input.pointer.x,input.pointer.y)?.tagName==='CANVAS' };
        `, { target: start, pointer: candidate });
        record("return endpoint ray visibility", { view, candidate, sample, ...hit });
        if (hit.hovered !== null || !hit.canvas || hit.terrainObstructed) { clear = false; break; }
      }
      if (clear) { pointer = candidate; break; }
    }
    assert(pointer, "No unobstructed ground view of the exact authored haul endpoint");
    await capture("02c-return-ground-target");
    await evaluate(`
      const d = window.__gameDebug;
      const trace = { stopped:false, error:null, travelled:0, maxStaticShift:0, forestOverlapSamples:0, clockViolations:0, positions:[] };
      window.__mineReturnTrace = trace;
      let previous = d.getPlayerPosition();
      const sample = () => {
        if (trace.stopped) return;
        try {
          const p = d.getPlayerPosition(), clock = d.getState().clock;
          if (clock.timeScale !== 1 || clock.paused) trace.clockViolations++;
          const length = Math.hypot(p.x-previous.x,p.z-previous.z);
          trace.travelled += length;
          const steps = Math.max(1, Math.ceil(length / 0.2));
          for (let step=1;step<=steps;step++) {
            const t=step/steps, position={x:previous.x+(p.x-previous.x)*t,y:previous.y+(p.y-previous.y)*t,z:previous.z+(p.z-previous.z)*t};
            const clearance=d.probeWorldClearance({...position,radius:input.radius});
            trace.maxStaticShift=Math.max(trace.maxStaticShift,clearance.staticShift);
            trace.forestOverlapSamples+=clearance.forestOverlaps.length?1:0;
            if (length > .001) trace.positions.push({position,clearance});
          }
          previous=p;
          if(trace.positions.length>2000) throw new Error('Return exceeded sample budget');
        } catch(error) { trace.error=String(error);trace.stopped=true; }
        if(!trace.stopped) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    `, { radius: PLAYER_RADIUS });
    const returnCursor = (await debug<EventBatch>("getEvents", [0])).nextSeq;
    await bounded("ground pointer return", () => driver.page!.mouse.click(pointer.x, pointer.y));
    let returned = await observe();
    report.returnClick = returned;
    assert(!returned.movement.destinationEntityId, "Return ground click selected a structure or resource");
    // A planned route exposes only its current walk-leg destination here. The exact final
    // ground goal is established by the unchanged physical-arrival assertion below.
    const returnNavigation = [...returned.events.events].reverse().find((event) => event.seq >= returnCursor && event.type === "navigation.started");
    const firstLegGap = returned.movement.destination ? Math.hypot(returned.movement.destination[0] - start[0],
      returned.movement.destination[2] - start[2]) : Infinity;
    assert(firstLegGap <= 0.55 || returnNavigation?.data.route === true,
      "Return click neither targeted the haul ground nor began a planned route");
    const returnUntil = Math.min(actionDeadline - 1_000, Date.now() + 12_000);
    while (Date.now() < returnUntil && gap(returned.player, start) > 0.55) {
      await bounded("normal return walk", () => driver.wait(80));
      returned = await observe();
    }
    const returnTrace = await evaluate<{ error: string | null; travelled: number; maxStaticShift: number; forestOverlapSamples: number; clockViolations: number }>(
      "window.__mineReturnTrace.stopped=true; return window.__mineReturnTrace;");
    const returnEvents = await debug<EventBatch>("getEvents", [returnCursor]);
    report.returnProof = { pointer, target: start, finalPosition: returned.player, arrivalGap: gap(returned.player, start), trace: returnTrace, events: returnEvents };
    assert(!returnTrace.error, returnTrace.error ?? "Return trace failed");
    assert(gap(returned.player, start) <= 0.55, "Ground click did not return to the authored haul endpoint");
    assert(returnTrace.travelled > 3, "Return must contain actual movement");
    assert(returnTrace.maxStaticShift <= 0.02 && returnTrace.forestOverlapSamples === 0, "Actual return intersects collision");
    assert.equal(returnTrace.clockViolations, 0);
    assert(!returnEvents.dropped && !returnEvents.events.some(event => event.type === "navigation.failed"), "Return navigation failed or evidence was dropped");
    await capture("03-returned-to-haul-ramp");
  }
  stage = "errors and final profile";
  const finalErrors = await debug<unknown[]>("getErrors");
  report.errors = { game: finalErrors, console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors };
  assert.equal(finalErrors.length + driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Browser or game errors invalidate this run");
  report.passed = true;
  report.status = "passed";
} catch (error) {
  report.passed = false;
  report.status = "failed";
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
  if (driver.page && Date.now() < actionDeadline) {
    try { report.failureState = await observe(); } catch (failure) { report.failureStateError = String(failure); }
    try { await capture("failure"); } catch (failure) { report.failureCaptureError = String(failure); }
  }
} finally {
  report.stage = stage;
  report.elapsedMs = Date.now() - started;
  report.browserErrors = { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, stage, elapsedMs: report.elapsedMs, report: path.join(out, "report.json"), error: report.error ?? null }));
  await driver.close();
  clearTimeout(watchdog);
}
