/** Final-world resource integration after the production forest and fishing lab gates pass.
 * npx tsx tools/world-resource-check.ts --url http://127.0.0.1:4175
 * Optional --forest-near x,z --tree-id id --fish-id cairn_tarn_spots_2 --headed.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA, INTERACT_RANGE, PLAYER_RADIUS, PLAYER_SLOPES } from "../game/src/app/config.js";
import type { GameEvent, Result, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import type { GameState } from "../game/src/state/store.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

type Point = { x: number; y: number; z: number };
type Bounds = { min: Point; max: Point; height: number; meshes: number; path: string };
type CameraView = { position: Point; target: Point };
interface Debug {
  getState(): { ready: boolean; regionId: string; selectedEntityId: string | null; hoveredEntityId: string | null; clock: { timeScale: number; elapsedMs: number } };
  getPlayerPosition(): Point;
  getEntity(id: string): SemanticEntity | null;
  listEntities(filter: { archetype: string; regionId?: string }): SemanticEntity[];
  getDrawnBounds(id: string): Bounds | null;
  getNavPoint(point: Vec3): Point | null;
  getNavPath(from: Vec3, to: Vec3): Point[] | null;
  getCamera(): CameraView;
  getNavigationState(): unknown;
  getScatterResidency(): { resident: string[] };
  getCurrentActivity(): unknown;
  getSaveBlob(): string;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  getErrors(): unknown[];
  sampleWorld(x: number, z: number): { height: number; playable: boolean; waterBodyId: string | null };
  getWaterBodies(): { id: string; centre: readonly [number, number]; level: number; closed: boolean }[];
}
interface Approach { entity: SemanticEntity; stand: Point; path: Point[] }
interface Trace {
  stopped: boolean;
  positions: Point[];
  travelled: number;
  samples: number;
  wet: number;
  firstWet: { x: number; z: number; waterBodyId: string | null } | null;
  error: string | null;
}
const tuple = (point: Point): Vec3 => [point.x, point.y, point.z];
const gap = (a: Point, b: Vec3): number => Math.hypot(a.x - b[0], a.z - b[2]);

async function main(): Promise<void> {
  const started = Date.now();
  const clearDeadline = installTestDeadline("World resource integration", 90_000);
  const args = process.argv.slice(2);
  const forestOnly = args.includes("--forest-only");
  const externalUrl = argValue(args, "--url");
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer();
  const output = path.join(repoRoot, "test-results", "world-resources");
  await mkdir(output, { recursive: true });
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const report: Record<string, unknown> = {
    status: "failed", passed: false, url: server.url, route: "/index.html",
    scope: forestOnly ? "Final-world tree placement and wiring after accepted production forest lab. No whole-world entity census."
      : "Final-world placement and wiring after accepted production forest/fishing labs. No whole-world entity census.",
    setup: "Fresh browser context; inventory cleared by save import; real hatchet/rod grants and skill 99; camera framing followed by nav-point teleport.",
    actionProof: `${forestOnly ? "One verified tree click" : "Two verified canvas clicks"}. Natural timeScale 1 gathering pays every yield and naturally depletes the forest tree.`,
    persistenceProof: "Import authentic pre-harvest save to restore standing tree, then authentic depleted save to restore stump; inspect after a distant excursion and return.",
    visualAcceptance: `Root must inspect ${forestOnly ? "tree and stump" : "stump and casting"} screenshots; semantic assertions do not grade the artwork.`,
    screenshots: [] as string[],
  };
  const screenshots = report.screenshots as string[];
  let stage = "boot";
  let currentId: string | null = null;
  let cursor = 0;
  const remaining = (limit: number): number => {
    const left = 88_000 - (Date.now() - started);
    assert(left > 0, "World resource integration exceeded its 88-second operation budget");
    return Math.max(1, Math.min(left, limit));
  };

  // Candidate selection is a small local read, not a scan of the rendered island. Navigation
  // validates terrain and static obstacles; the real clicked walk still exercises live trunks.
  async function approachFor(entityId: string | null): Promise<Approach | null> {
    return driver.page!.evaluate(({ id, radius, interactRange, ascent, descent }) => {
      const debug = window.__gameDebug as unknown as Debug;
      const player = debug.getPlayerPosition();
      const trees = debug.listEntities({ archetype: "tree", regionId: debug.getState().regionId });
      const isolation = (entity: SemanticEntity): number => Math.min(35, ...trees
        .filter(other => other.id !== entity.id && other.state !== "depleted")
        .map(other => Math.hypot(other.position[0] - entity.position[0], other.position[2] - entity.position[2])));
      const candidates = id ? [debug.getEntity(id)].filter((entity): entity is SemanticEntity => entity !== null)
        : trees.filter((entity) => entity.meta?.forestTree === true && entity.state === "available" && (entity.resource?.remaining ?? 0) > 0
          && Math.hypot(entity.position[0] - player.x, entity.position[2] - player.z) <= 35)
          .sort((a, b) => isolation(b) - isolation(a) || (a.resource!.remaining - b.resource!.remaining)
            || Math.hypot(a.position[0] - player.x, a.position[2] - player.z) - Math.hypot(b.position[0] - player.x, b.position[2] - player.z)).slice(0, 12);
      for (const entity of candidates) {
        const anchor = entity.interactionPosition ?? entity.position;
        const body = entity.archetype === "fishing_spot" ? debug.getWaterBodies().find((water) => water.id === entity.meta?.clusterId) : undefined;
        const baseAngle = body ? Math.atan2(anchor[0] - body.centre[0], anchor[2] - body.centre[1])
          : Math.atan2(player.x - anchor[0], player.z - anchor[2]);
        // Coast terrain can leave only a narrow dry, nav-aligned approach between slopes.
        const angles = [0, 45, -45, 90, -90, 135, -135, 180,
          15, -15, 30, -30, 60, -60, 75, -75, 105, -105, 120, -120, 150, -150, 165, -165];
        for (const distance of [6, 8, 10]) for (const angleOffset of angles) {
          const angle = baseAngle + angleOffset * Math.PI / 180;
          const x = anchor[0] + Math.sin(angle) * distance, z = anchor[2] + Math.cos(angle) * distance;
          const surface = debug.sampleWorld(x, z);
          if (!surface.playable || surface.waterBodyId !== null) continue;
          const nav = debug.getNavPoint([x, surface.height, z]);
          // Setup must meet the same vertical tolerance checked after physics settles the player.
          // A point half a metre above the actual ground is not a usable acceptance approach.
          if (!nav || Math.hypot(nav.x - x, nav.z - z) > 0.15 || Math.abs(nav.y - surface.height) > 0.20) continue;
          if (trees.some((tree) => tree.id !== entity.id && tree.state !== "depleted"
            && Math.hypot(nav.x - tree.position[0], nav.z - tree.position[2]) < Number(tree.meta?.trunkRadius ?? 0.6) + radius + 0.2)) continue;
          const route = debug.getNavPath([nav.x, nav.y, nav.z], anchor);
          if (!route || route.length < 2 || Math.hypot(route.at(-1)!.x - anchor[0], route.at(-1)!.z - anchor[2]) > 0.3) continue;
          let safe = true;
          for (let i = 1; i < route.length && safe; i++) {
            const a = route[i - 1]!, b = route[i]!;
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            const angle = Math.atan2(b.y - a.y, length) * 180 / Math.PI;
            if (angle > ascent || angle < -descent) { safe = false; break; }
            const steps = Math.max(1, Math.ceil(length / 0.3));
            for (let step = 0; step <= steps && safe; step++) {
              const x = a.x + (b.x - a.x) * step / steps, z = a.z + (b.z - a.z) * step / steps;
              for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
                const ground = debug.sampleWorld(x + dx!, z + dz!);
                if (!ground.playable || ground.waterBodyId !== null) { safe = false; break; }
              }
            }
          }
          if (safe && Math.hypot(nav.x - anchor[0], nav.z - anchor[2]) >= interactRange + 3) return { entity, stand: nav, path: route };
        }
      }
      return null;
    }, { id: entityId, radius: PLAYER_RADIUS, interactRange: INTERACT_RANGE, ascent: PLAYER_SLOPES.maxAscentAngle, descent: PLAYER_SLOPES.maxDescentAngle });
  }

  async function frame(approach: Approach): Promise<void> {
    const target = approach.entity.position;
    const stand = approach.stand;
    const fish = approach.entity.archetype === "fishing_spot";
    assert.equal(await driver.callDebug("inspectPose", [{
      ...stand, yaw: Math.atan2(stand.x - target[0], stand.z - target[2]), pitch: fish ? 0.72 : 0.48, distance: fish ? 30 : 17,
    }]), true);
    // inspectPose deliberately uses terrain height. The final placement must be the validated
    // nav point, particularly at a mountain basin where ground and nav Y can differ.
    assert.equal(await driver.callDebug("teleport", [tuple(stand)]), true);
    const checked = await driver.page!.evaluate(() => {
      const debug = window.__gameDebug as unknown as Debug;
      const player = debug.getPlayerPosition();
      return { player, nav: debug.getNavPoint([player.x, player.y, player.z]), surface: debug.sampleWorld(player.x, player.z) };
    });
    assert(checked.nav && gap(checked.player, tuple(checked.nav)) <= 0.1 && Math.abs(checked.player.y - checked.nav.y) <= 0.25, "The actual player is off the navmesh after setup");
    assert(checked.surface.playable && checked.surface.waterBodyId === null, "The actual player setup is not dry playable ground");
    assert(gap(checked.player, tuple(stand)) < 0.2, "Teleport changed the validated approach");
    await driver.page!.evaluate(async () => {
      const debug = window.__gameDebug as unknown as Debug;
      const started = performance.now();
      let stableSince = started, previous = debug.getCamera();
      while (performance.now() - started < 3_000) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = debug.getCamera();
        const delta = Math.max(
          Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y, current.position.z - previous.position.z),
          Math.hypot(current.target.x - previous.target.x, current.target.y - previous.target.y, current.target.z - previous.target.z));
        if (delta > 0.002) stableSince = performance.now();
        if (performance.now() - stableSince >= 250) return;
        previous = current;
      }
      throw new Error("Camera did not settle for the resource click");
    });
  }

  async function gather(approach: Approach, deplete: boolean) {
    currentId = approach.entity.id;
    const id = currentId;
    await frame(approach);
    await driver.page!.waitForFunction((id) => (window.__gameDebug as unknown as Debug).getDrawnBounds(id)?.meshes, id, { timeout: remaining(5_000) });
    const beforeBlob = await driver.callDebug("getSaveBlob") as string;
    const before = JSON.parse(beforeBlob) as GameState;
    const initial = await driver.page!.evaluate((id) => {
      const debug = window.__gameDebug as unknown as Debug;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return { entity: debug.getEntity(id)!, bounds: debug.getDrawnBounds(id)!, camera: debug.getCamera(), player: debug.getPlayerPosition(), clock: debug.getState().clock,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, cursor: debug.getEvents(0).nextSeq };
    }, id);
    assert.equal(initial.clock.timeScale, 1);
    const anchor = initial.entity.interactionPosition ?? initial.entity.position;
    assert(gap(initial.player, anchor) >= INTERACT_RANGE + 3);
    cursor = initial.cursor;
    const camera = new PerspectiveCamera(CAMERA.fov, initial.rect.width / initial.rect.height, CAMERA.near, CAMERA.far);
    camera.position.set(initial.camera.position.x, initial.camera.position.y, initial.camera.position.z);
    camera.lookAt(initial.camera.target.x, initial.camera.target.y, initial.camera.target.z);
    camera.updateMatrixWorld(true);
    const project = (x: number, y: number, z: number) => {
      const point = new Vector3(x, y, z).project(camera);
      return { x: initial.rect.x + (point.x + 1) * initial.rect.width / 2, y: initial.rect.y + (1 - point.y) * initial.rect.height / 2, depth: point.z };
    };
    const bounds = initial.bounds;
    const origin = initial.entity.position;
    const candidates = initial.entity.archetype === "tree"
      ? [
        ...[0.9, 1.3, 1.7, 0.5, 2.1].flatMap((height) => [-0.15, 0, 0.15].map((offset) => project(origin[0] + offset, origin[1] + height, origin[2]))),
        // Curved narrow trunks may be behind another tree. A visible crown is also a normal
        // clickable part of the production tree; every candidate still requires a real hover.
        ...[.6, .8, .4].flatMap(height => [.5, .35, .65].map(x => project(
          bounds.min.x + (bounds.max.x - bounds.min.x) * x,
          bounds.min.y + bounds.height * height, (bounds.min.z + bounds.max.z) / 2))),
      ]
      : [project(...origin), ...[0.5, 0.25, 0.75].flatMap((x) => [0.5, 0.25, 0.75].map((z) => project(
        bounds.min.x + (bounds.max.x - bounds.min.x) * x, (bounds.min.y + bounds.max.y) / 2, bounds.min.z + (bounds.max.z - bounds.min.z) * z)))];

    await driver.page!.evaluate((radius) => {
      const debug = window.__gameDebug as unknown as Debug;
      const global = window as unknown as { __worldResourceTrace: Trace };
      const trace: Trace = { stopped: false, positions: [], travelled: 0, samples: 0, wet: 0, firstWet: null, error: null };
      global.__worldResourceTrace = trace;
      const offsets = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * radius, Math.sin(i * Math.PI / 4) * radius])];
      let previous: Point | undefined;
      const sample = (): void => {
        if (trace.stopped) return;
        try {
          const player = debug.getPlayerPosition();
          if (!previous || player.x !== previous.x || player.y !== previous.y || player.z !== previous.z) {
            const from = previous ?? player;
            const distance = Math.hypot(player.x - from.x, player.z - from.z);
            trace.travelled += distance;
            const steps = Math.max(1, Math.ceil(distance / 0.2));
            for (let step = 0; step <= steps; step++) for (const [dx, dz] of offsets) {
              const x = from.x + (player.x - from.x) * step / steps + dx!;
              const z = from.z + (player.z - from.z) * step / steps + dz!;
              const surface = debug.sampleWorld(x, z);
              trace.samples++;
              if (!surface.playable || surface.waterBodyId !== null) { trace.wet++; trace.firstWet ??= { x, z, waterBodyId: surface.waterBodyId }; }
            }
            trace.positions.push(player);
            previous = player;
          }
          if (trace.positions.length > 2000) throw new Error("Movement trace exceeded 2000 changed positions");
        } catch (error) { trace.error = String(error); trace.stopped = true; }
        if (!trace.stopped) requestAnimationFrame(sample);
      };
      sample();
    }, PLAYER_RADIUS);
    let clicked: { x: number; y: number } | null = null;
    for (const candidate of candidates) {
      remaining(1);
      if (candidate.depth < -1 || candidate.depth > 1 || candidate.x < 0 || candidate.y < 0 || candidate.x >= 1440 || candidate.y >= 900) continue;
      await driver.moveMouse(candidate.x, candidate.y);
      let stable = true;
      for (let sample = 0; sample < 2; sample++) {
        await driver.wait(90);
        const hit = await driver.page!.evaluate(({ point, id }) =>
          (window.__gameDebug as unknown as Debug).getState().hoveredEntityId === id
          && document.elementFromPoint(point.x, point.y)?.tagName === "CANVAS", { point: candidate, id });
        if (!hit) { stable = false; break; }
      }
      if (stable) { await driver.click(candidate.x, candidate.y); clicked = candidate; break; }
    }
    assert(clicked, `No live canvas hover found ${id}; use --forest-near/--tree-id to choose an observed clear approach`);
    const clickState = await driver.page!.evaluate(() => {
      const debug = window.__gameDebug as unknown as Debug;
      const state = JSON.parse(debug.getSaveBlob()) as GameState;
      const path = state.player.movement.path;
      let wetSamples = 0;
      for (let i = 1; i < (path?.length ?? 0); i++) {
        const a = path![i - 1]!, b = path![i]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.2));
        for (let step = 0; step <= steps; step++) {
          if (debug.sampleWorld(a[0] + (b[0] - a[0]) * step / steps, a[2] + (b[2] - a[2]) * step / steps).waterBodyId !== null) wetSamples++;
        }
      }
      return { state: debug.getState(), path, destinationEntityId: state.player.movement.destinationEntityId, wetSamples };
    });
    report[`${stage}:click`] = { initial, clicked, observation: clickState };
    assert.equal(clickState.state.selectedEntityId, id, "The canvas click selected another entity or ground");
    assert.equal(clickState.destinationEntityId, id, "The real click did not navigate toward the selected resource");
    assert.equal(clickState.wetSamples, 0, "The actual navigation path crosses water");
    await driver.page!.waitForFunction(({ id, since, deplete }) => {
      const debug = window.__gameDebug as unknown as Debug;
      const trace = (window as unknown as { __worldResourceTrace: Trace }).__worldResourceTrace;
      const events = debug.getEvents(since);
      return trace.error !== null || trace.wet > 0 || events.dropped || events.events.some((event) => event.type === "navigation.failed")
        || (deplete ? debug.getEntity(id)?.state === "depleted"
          : events.events.some((event) => event.type === "item.received" && event.entityId === id && event.data.source === "gather"));
    }, { id, since: cursor, deplete }, { timeout: remaining(deplete ? 35_000 : 13_000), polling: 80 });
    const final = await driver.page!.evaluate(({ id, since }) => {
      const debug = window.__gameDebug as unknown as Debug;
      const trace = (window as unknown as { __worldResourceTrace: Trace }).__worldResourceTrace;
      trace.stopped = true;
      return { entity: debug.getEntity(id)!, bounds: debug.getDrawnBounds(id), player: debug.getPlayerPosition(), clock: debug.getState().clock,
        events: debug.getEvents(since), trace, errors: debug.getErrors(), save: debug.getSaveBlob() };
    }, { id, since: cursor });
    const saved = JSON.parse(final.save) as GameState;
    const { save: _save, ...observation } = final;
    report[stage] = { initial, clicked, observation };
    assert.equal(final.trace.error, null);
    assert.equal(final.trace.wet, 0, `Actual movement entered water: ${JSON.stringify(final.trace.firstWet)}`);
    assert(final.trace.travelled >= 3 && Math.hypot(final.player.x - initial.player.x, final.player.z - initial.player.z) >= 3, "The real resource approach moved less than three metres");
    assert.equal(final.clock.timeScale, 1);
    assert(!final.events.dropped, "The event buffer dropped resource evidence");
    const events = final.events.events;
    assert(!events.some((event) => event.type === "navigation.failed"), "Resource navigation failed");
    const navigation = events.find((event) => event.type === "navigation.started");
    const arrived = events.find((event) => event.type === "navigation.completed");
    const activity = events.find((event) => event.type === "activity.started" && event.data.entityId === id);
    const receipts = events.filter((event) => event.type === "item.received" && event.entityId === id && event.data.source === "gather" && event.data.itemId === initial.entity.resource!.itemId);
    assert(navigation && arrived && activity && receipts[0], "Missing ordered click, navigation, gathering and receipt evidence");
    assert(navigation.seq < arrived.seq && arrived.seq < activity.seq && activity.seq < receipts[0].seq);
    const received = receipts.reduce((sum, event) => sum + Number(event.data.quantity ?? 0), 0);
    const quantity = (state: GameState) => state.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === initial.entity.resource!.itemId ? slot.quantity : 0), 0);
    assert(received > 0);
    assert.equal(quantity(saved) - quantity(before), received, "Receipts disagree with saved inventory");
    assert.equal(initial.entity.resource!.remaining - final.entity.resource!.remaining, received, "Receipts disagree with node depletion");
    assert(gap(final.player, anchor) <= INTERACT_RANGE);
    assert.deepEqual(final.entity.position, initial.entity.position);
    assert.equal(final.errors.length, 0);
    if (deplete) {
      assert.equal(received, initial.entity.resource!.remaining);
      assert.equal(final.entity.state, "depleted");
      assert(events.some((event) => event.type === "resource.depleted" && event.entityId === id));
    } else assert(gap(final.player, initial.entity.position) > INTERACT_RANGE, "Fishing approach went to the offshore school");
    return { initial, final, beforeBlob, savedBlob: final.save, received };
  }

  try {
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(5_000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    await driver.open(remaining(25_000), "/index.html");
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    for (let i = 0; i < 8; i++) {
      const close = page.locator(".panel:not([hidden]) .panel__close").first();
      if (!await close.isVisible()) break;
      await close.click();
    }
    const setup = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    setup.inventory.slots.fill(null);
    await driver.callDebug("loadSaveBlob", [JSON.stringify(setup)]);
    await driver.callDebug("setSkillLevel", ["woodcutting", 99]);
    await driver.callDebug("setSkillLevel", ["fishing", 99]);
    for (const item of ["grithe_hatchet", "palewood_rod"]) {
      const result = await driver.callDebug("giveItem", [item, 1, "inventory"]) as Result<number>;
      assert(result.ok && result.value === 1, `The real inventory refused ${item}`);
    }
    stage = "forest selection";
    const requestedTree = argValue(args, "--tree-id") ?? null;
    const nearArg = argValue(args, "--forest-near");
    const initialPlayer = await driver.callDebug("getPlayerPosition") as Point;
    let probes: number[][];
    if (nearArg) {
      const coordinates = nearArg.split(",").map(Number);
      assert(coordinates.length === 2 && coordinates.every(Number.isFinite), "--forest-near must be x,z");
      probes = [coordinates];
    } else probes = [[initialPlayer.x, initialPlayer.z], [initialPlayer.x + 40, initialPlayer.z], [initialPlayer.x - 40, initialPlayer.z], [initialPlayer.x, initialPlayer.z + 40], [initialPlayer.x, initialPlayer.z - 40]];
    report.forestProbes = probes;
    let forest: Approach | null = null;
    for (const [x, z] of probes) {
      remaining(1);
      const point = await page.evaluate(({ x, z }) => {
        const debug = window.__gameDebug as unknown as Debug;
        const surface = debug.sampleWorld(x, z);
        return surface.playable && surface.waterBodyId === null ? debug.getNavPoint([x, surface.height, z]) : null;
      }, { x: x!, z: z! });
      if (!point) continue;
      await driver.callDebug("teleport", [tuple(point)]);
      // A teleport may enter an uncached tile. Wait for production scatter to finish
      // registering it before deciding that this part of the world has no trees.
      await page.waitForFunction(() => {
        const debug = window.__gameDebug as unknown as Debug;
        const player = debug.getPlayerPosition();
        return debug.getScatterResidency().resident.includes(`${Math.floor(player.x / 96)}:${Math.floor(player.z / 96)}`);
      }, undefined, { timeout: remaining(15_000) });
      for (let attempt = 0; attempt < 4 && !forest; attempt++) {
        await driver.wait(250);
        forest = await approachFor(requestedTree);
      }
      if (forest) break;
    }
    assert(forest, "No nearby ordinary forest tree has a valid approach; supply --forest-near x,z and optionally --tree-id from an observed final-world tree");
    assert(forest.entity.meta?.forestTree === true && !forest.entity.meta?.worldSiteId, "The selected tree is an authored grove rather than ordinary forest");
    report.forestSelection = forest;
    stage = "natural tree harvest";
    const tree = await gather(forest, true);
    const assertStump = async () => {
      await page.waitForFunction(({ id, standingHeight }) => {
        const debug = window.__gameDebug as unknown as Debug;
        const bounds = debug.getDrawnBounds(id);
        return debug.getEntity(id)?.state === "depleted" && bounds && bounds.meshes > 0 && bounds.height < standingHeight * 0.35;
      }, { id: forest.entity.id, standingHeight: tree.initial.bounds.height }, { timeout: remaining(3_000) });
      const observed = await page.evaluate((id) => {
        const debug = window.__gameDebug as unknown as Debug;
        return { entity: debug.getEntity(id), bounds: debug.getDrawnBounds(id), player: debug.getPlayerPosition() };
      }, forest.entity.id);
      assert.equal(observed.entity?.state, "depleted");
      assert.equal(observed.entity.resource?.remaining, 0);
      assert.deepEqual(observed.entity.position, tree.initial.entity.position);
      assert(observed.bounds && observed.bounds.meshes > 0 && observed.bounds.height < tree.initial.bounds.height * 0.35, "The depleted tree still draws its standing canopy");
      return observed;
    };
    await assertStump();
    screenshots.push(await driver.screenshot(output, "01-naturally-depleted-forest-tree"));
    stage = "forest save and return";
    await driver.callDebug("loadSaveBlob", [tree.beforeBlob]);
    cursor = 0;
    await page.waitForFunction(({ id, standingHeight }) => {
      const debug = window.__gameDebug as unknown as Debug;
      return debug.getEntity(id)?.state === "available" && (debug.getDrawnBounds(id)?.height ?? 0) >= standingHeight * 0.9;
    }, { id: forest.entity.id, standingHeight: tree.initial.bounds.height }, { timeout: remaining(3_000) });
    await driver.callDebug("loadSaveBlob", [tree.savedBlob]);
    await driver.wait(180);
    const restored = await assertStump();
    const far = await page.evaluate(({ origin }) => {
      const debug = window.__gameDebug as unknown as Debug;
      for (const [dx, dz] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) {
        const x = origin[0] + dx!, z = origin[2] + dz!;
        const surface = debug.sampleWorld(x, z);
        if (!surface.playable || surface.waterBodyId !== null) continue;
        const point = debug.getNavPoint([x, surface.height, z]);
        if (point && Math.hypot(point.x - origin[0], point.z - origin[2]) > 60) return point;
      }
      return null;
    }, { origin: forest.entity.position });
    assert(far, "No dry nav point beyond forest residency was found");
    await driver.callDebug("teleport", [tuple(far)]);
    await driver.wait(220);
    const distant = await driver.callDebug("getPlayerPosition") as Point;
    assert(gap(distant, forest.entity.position) > 50);
    const farTree = await driver.callDebug("getEntity", [forest.entity.id]) as SemanticEntity | null;
    assert.equal(farTree?.state, "depleted", "The distant forest registry forgot the depleted tree");
    await frame(forest);
    await driver.wait(180);
    const returned = await assertStump();
    const returnedSave = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    assert.deepEqual(returnedSave.world.nodes[forest.entity.id], (JSON.parse(tree.savedBlob) as GameState).world.nodes[forest.entity.id]);
    screenshots.push(await driver.screenshot(output, "02-restored-stump-after-distant-return"));
    await writeFile(path.join(output, "naturally-depleted-save.json"), tree.savedBlob);
    report.forestPersistence = { restored, distant, farTreeState: farTree?.state, returned, received: tree.received };
    if (!forestOnly) {
      stage = "Cairn fishing selection";
      const fishId = argValue(args, "--fish-id") ?? "cairn_tarn_spots_2";
      currentId = fishId;
      assert(fishId.startsWith("cairn_tarn_spots_"), "This integration check requires a Cairn Tarn school");
      const fishing = await approachFor(fishId);
      assert(fishing?.entity.interactionPosition, "Cairn Tarn has no dry, nav-valid casting approach");
      const fishWater = await page.evaluate((entity) => (window.__gameDebug as unknown as Debug).sampleWorld(entity.position[0], entity.position[2]), fishing.entity);
      assert.equal(fishWater.waterBodyId, "cairn_tarn_spots", "The authored Cairn school is not underwater");
      report.fishingSelection = fishing;
      stage = "Cairn fishing receipt";
      const fish = await gather(fishing, false);
      screenshots.push(await driver.screenshot(output, "03-casting-from-Cairn-dry-bank"));
      report.fishReceived = fish.received;
    }
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, "The document reloaded during the check; use a server without HMR");
    assert.equal(driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Chromium reported runtime or request errors");
    report.status = "passed";
    report.passed = true;
  } catch (error) {
    report.failedStage = stage;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page) {
      try {
        report.failure = await driver.page.evaluate(({ id, since }) => {
          const debug = window.__gameDebug as unknown as Debug | undefined;
          if (!debug) return { debugMissing: true };
          const trace = (window as unknown as { __worldResourceTrace?: Trace }).__worldResourceTrace;
          if (trace) trace.stopped = true;
          return { state: debug.getState(), player: debug.getPlayerPosition(), entity: id ? debug.getEntity(id) : null, bounds: id ? debug.getDrawnBounds(id) : null,
            camera: debug.getCamera(), navigation: debug.getNavigationState(), activity: debug.getCurrentActivity(), events: debug.getEvents(since), trace, errors: debug.getErrors() };
        }, { id: currentId, since: cursor });
        if (Date.now() - started < 82_000) screenshots.push(await driver.screenshot(output, "failure"));
      } catch (failure) { report.observationError = String(failure); }
    }
  } finally {
    report.elapsedMs = Date.now() - started;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, elapsedMs: report.elapsedMs, report: path.join(output, "report.json"), error: report.error }));
    await driver.close();
    await server.close();
    clearDeadline();
  }
}

await main();
