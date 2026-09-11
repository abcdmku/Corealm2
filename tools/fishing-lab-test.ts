/** One real canvas click, dry-bank navigation, and a natural fish receipt on the production lab. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA, INTERACT_RANGE, PLAYER_RADIUS } from "../game/src/app/config.js";
import type { GameEvent, Result, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import type { WaterBodySnapshot } from "../game/src/render/scene.js";
import type { GameState } from "../game/src/state/store.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installAssetCandidates } from "./lib/assetCandidates.js";

type Point = { x: number; y: number; z: number };
type Bounds = { min: Point; max: Point; meshes: number };
interface FishingLabState {
  entityIds: string[];
  bodies: WaterBodySnapshot[];
  accessPositions: Record<string, Vec3>;
  path: Vec3[] | null;
}
interface FishingDebug {
  getState(): { ready: boolean; hoveredEntityId: string | null; selectedEntityId: string | null; clock: { timeScale: number; elapsedMs: number } };
  getEntity(id: string): SemanticEntity | null;
  getDrawnBounds(id: string): Bounds | null;
  getPlayerPosition(): Point;
  getCamera(): { position: Point; target: Point };
  getNavigationState(): unknown;
  getCurrentActivity(): unknown;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  getErrors(): unknown[];
  sampleWorld(x: number, z: number): { height: number; playable: boolean; waterBodyId: string | null };
}
interface DryTrace {
  stopped: boolean;
  positions: Point[];
  paths: Vec3[][];
  sampleCount: number;
  wetCount: number;
  firstWet: { x: number; z: number; waterBodyId: string | null; planned: boolean } | null;
  maxStep: number;
  error: string | null;
}

async function main(): Promise<void> {
  const started = Date.now();
  const clearDeadline = installTestDeadline("Fishing lab browser gate", 59_000);
  const args = process.argv.slice(2);
  const externalUrl = argValue(args, "--url");
  const itemModels = args.includes("--item-models");
  const rodId = argValue(args, "--rod") ?? "palewood_rod";
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const output = path.join(repoRoot, "test-results", itemModels ? `item-models/fishing-${rodId}` : "fishing-lab");
  await mkdir(output, { recursive: true });
  const report: Record<string, unknown> = {
    status: "failed", passed: false, url: server.url, route: "/index.html?mode=combat&fishing=1",
    setup: "Combat lab skill 99; save import clears carried inventory and must rebuild all four fishing entities; a production rod is granted and the player is placed on the dry approach.",
    inputProof: "Production hover verifies the canvas point before one real click. Navigation and the fish receipt run at timeScale 1.",
    dryProof: "Every changed rendered player position and planned path segment is sampled at 0.2 m, including the player radius, through production sampleWorld.",
    visualAcceptance: "Screenshots need root inspection. This gate asserts gameplay and placement, not art quality.",
    screenshots: [] as string[],
  };
  const screenshots = report.screenshots as string[];
  let observedEntityId: string | null = null;
  let eventCursor = 0;
  let stage = "boot";
  const remaining = (limit: number): number => {
    const budget = 57_000 - (Date.now() - started);
    assert(budget > 0, "Fishing acceptance exceeded its 57-second operation budget");
    return Math.max(1, Math.min(limit, budget));
  };

  try {
    await driver.launch();
    const page = driver.page!;
    if (itemModels) {
      const catalogPath = path.join(repoRoot, "art/item-models/candidates/rods/catalogue.json");
      report.assets = JSON.parse(await readFile(catalogPath, "utf8")).assets;
      await installAssetCandidates(page, catalogPath);
    }
    page.setDefaultTimeout(5_000);
    // tsx preserves names on nested callbacks with this helper. Playwright serializes the
    // callback body into another realm, so that realm needs the same name-only operation.
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    await driver.open(remaining(18_000), report.route as string);
    await page.waitForFunction(() => Boolean((window as unknown as { __fishingLab?: unknown }).__fishingLab), undefined, { timeout: remaining(3_000) });
    const fixture = await page.evaluate(() => (window as unknown as { __fishingLab: { getState(): FishingLabState } }).__fishingLab.getState());
    assert.equal(fixture.entityIds.length, 4, "The fixture must contain all four authored Redsill schools");
    assert(fixture.bodies.length === 1 && fixture.bodies[0]?.closed && !fixture.bodies[0].error, "The production pond is not enclosed");
    const entityId = fixture.entityIds[0]!;
    observedEntityId = entityId;
    stage = "fixture setup";
    const entity = await driver.callDebug("getEntity", [entityId]) as SemanticEntity | null;
    assert(entity, `The fishing fixture lists ${entityId}, but it is missing from the live entity store`);
    const anchor = entity.interactionPosition;
    assert(anchor && entity.resource, "Fishing has no dry access point or production resource");
    assert.deepEqual(anchor, fixture.accessPositions[entityId]);
    const body = fixture.bodies[0]!;
    const outwardX = anchor[0] - body.centre[0];
    const outwardZ = anchor[2] - body.centre[1];
    const outwardLength = Math.hypot(outwardX, outwardZ);
    assert(outwardLength > 0);
    const standX = anchor[0] + outwardX / outwardLength * 7;
    const standZ = anchor[2] + outwardZ / outwardLength * 7;
    const standY = await driver.callDebug("groundHeight", [standX, standZ]) as number;
    const fixtureSave = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    fixtureSave.inventory.slots = fixtureSave.inventory.slots.map(() => null);
    await driver.callDebug("loadSaveBlob", [JSON.stringify(fixtureSave)]);
    const restored = await page.evaluate((ids) => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      return ids.map((id) => debug.getEntity(id));
    }, fixture.entityIds);
    for (const [index, school] of restored.entries()) {
      const id = fixture.entityIds[index]!;
      assert(school, `Save import removed fishing fixture ${id} from the live entity store`);
      assert(school.resource && school.interactions.includes("fish"), `Save import rebuilt ${id} without production fishing behavior`);
      assert.deepEqual(school.interactionPosition, fixture.accessPositions[id], `Save import changed the bank anchor for ${id}`);
    }
    report.saveImport = { restoredEntityIds: restored.map((school) => school!.id), bankAnchorsPreserved: true };
    const rod = await driver.callDebug("giveItem", [rodId, 1, "inventory"]) as Result<number>;
    assert(rod.ok && rod.value === 1, "The production inventory refused the fishing rod setup");
    report.inventorySetup = { freeSlotsBeforeRod: fixtureSave.inventory.slots.length, rod };
    assert.equal(await driver.callDebug("inspectPose", [{
      x: standX, y: standY, z: standZ, yaw: Math.atan2(outwardX, outwardZ), pitch: 0.68, distance: 34,
    }]), true);
    const labPanel = page.locator("#panel-feature-lab");
    if (await labPanel.isVisible()) await labPanel.locator(".panel__close").click();
    await labPanel.waitFor({ state: "hidden", timeout: remaining(2_000) });
    // The lab panel can focus a select, which consumes the 'l' key. Close it through its actual
    // button and wait for the camera's position and target to settle before projecting a click.
    report.cameraSettled = await page.evaluate(async () => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      const started = performance.now();
      let stableSince = started;
      let previous = debug.getCamera();
      while (performance.now() - started < 3_000) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = debug.getCamera();
        const movement = Math.max(
          Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y, current.position.z - previous.position.z),
          Math.hypot(current.target.x - previous.target.x, current.target.y - previous.target.y, current.target.z - previous.target.z),
        );
        if (movement > 0.002) stableSince = performance.now();
        if (performance.now() - stableSince >= 250) return current;
        previous = current;
      }
      throw new Error("Fishing camera did not settle before the canvas click");
    });
    const initial = await page.evaluate((id) => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      const school = debug.getEntity(id);
      if (!school?.interactionPosition) throw new Error(`Fishing fixture ${id} lost its live entity or bank anchor during setup`);
      const bank = school.interactionPosition;
      const player = debug.getPlayerPosition();
      return {
        entity: school, bounds: debug.getDrawnBounds(id), player, clock: debug.getState().clock,
        fishSurface: debug.sampleWorld(school.position[0], school.position[2]),
        bankSurface: debug.sampleWorld(bank[0], bank[2]), playerSurface: debug.sampleWorld(player.x, player.z),
      };
    }, entityId);
    report.initial = initial;
    assert.equal(initial.clock.timeScale, 1);
    assert.equal(initial.fishSurface.waterBodyId, body.id, "The school is outside its production pond");
    assert.equal(initial.bankSurface.waterBodyId, null, "The casting anchor is underwater");
    assert.equal(initial.playerSurface.waterBodyId, null, "The initial approach is underwater");
    assert(initial.bounds && initial.bounds.meshes > 0 && initial.bounds.min.y < body.level, "No underwater fish geometry is drawn");
    assert(Math.hypot(initial.player.x - anchor[0], initial.player.z - anchor[2]) > INTERACT_RANGE, "The click must require an actual walk");
    screenshots.push(await driver.screenshot(output, "01-bank-approach"));
    const before = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    const cursor = (await driver.callDebug("getEvents", [0]) as { nextSeq: number }).nextSeq;
    eventCursor = cursor;
    const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);

    // Diagnostics generate candidates; only the live production raycaster can authorize the click.
    const projection = await page.evaluate((id) => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return { camera: debug.getCamera(), bounds: debug.getDrawnBounds(id)!, entity: debug.getEntity(id)!, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, entityId);
    const camera = new PerspectiveCamera(CAMERA.fov, projection.rect.width / projection.rect.height, CAMERA.near, CAMERA.far);
    camera.position.set(projection.camera.position.x, projection.camera.position.y, projection.camera.position.z);
    camera.lookAt(projection.camera.target.x, projection.camera.target.y, projection.camera.target.z);
    camera.updateMatrixWorld(true);
    const project = (x: number, y: number, z: number): { x: number; y: number; depth: number } => {
      const point = new Vector3(x, y, z).project(camera);
      return { x: projection.rect.x + (point.x + 1) * projection.rect.width / 2, y: projection.rect.y + (1 - point.y) * projection.rect.height / 2, depth: point.z };
    };
    const bounds = projection.bounds;
    const corners = [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) => [bounds.min.z, bounds.max.z].map((z) => project(x, y, z))));
    assert(corners.every((point) => point.depth > -1 && point.depth < 1), "The camera does not contain the fish school");
    const left = Math.min(...corners.map((point) => point.x));
    const right = Math.max(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    const bottom = Math.max(...corners.map((point) => point.y));
    const candidates = [
      project(...projection.entity.position),
      project((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2),
      ...[0.5, 0.25, 0.75, 0, 1].flatMap((u) => [0.5, 0.25, 0.75, 0, 1].map((v) => ({ x: left + (right - left) * u, y: top + (bottom - top) * v }))),
    ];
    await page.evaluate((radius) => {
      const global = window as unknown as { __fishingLab: { getState(): FishingLabState }; __fishingTrace: DryTrace };
      const debug = window.__gameDebug as unknown as FishingDebug;
      const trace: DryTrace = { stopped: false, positions: [], paths: [], sampleCount: 0, wetCount: 0, firstWet: null, maxStep: 0, error: null };
      global.__fishingTrace = trace;
      let last: Point | undefined;
      let pathKey = "";
      const offsets = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * radius, Math.sin(i * Math.PI / 4) * radius])];
      const segment = (from: Point, to: Point, planned: boolean): void => {
        const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.2));
        for (let step = 0; step <= steps; step++) for (const [dx, dz] of offsets) {
          const x = from.x + (to.x - from.x) * step / steps + dx!;
          const z = from.z + (to.z - from.z) * step / steps + dz!;
          const surface = debug.sampleWorld(x, z);
          trace.sampleCount++;
          if (!surface.playable || surface.waterBodyId !== null) {
            trace.wetCount++;
            trace.firstWet ??= { x, z, waterBodyId: surface.waterBodyId, planned };
          }
        }
      };
      const sample = (): void => {
        if (trace.stopped) return;
        try {
          const position = debug.getPlayerPosition();
          if (!last || position.x !== last.x || position.y !== last.y || position.z !== last.z) {
            if (last) trace.maxStep = Math.max(trace.maxStep, Math.hypot(position.x - last.x, position.z - last.z));
            segment(last ?? position, position, false);
            trace.positions.push(position);
            last = position;
          }
          const currentPath = global.__fishingLab.getState().path;
          const key = JSON.stringify(currentPath);
          if (currentPath && currentPath.length > 1 && key !== pathKey) {
            trace.paths.push(currentPath);
            for (let i = 1; i < currentPath.length; i++) {
              const a = currentPath[i - 1]!, b = currentPath[i]!;
              segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, true);
            }
          }
          pathKey = key;
          if (trace.positions.length > 2000 || trace.paths.length > 200) throw new Error("Fishing trace exceeded its bounded sample count");
        } catch (error) {
          trace.error = error instanceof Error ? error.message : String(error);
          trace.stopped = true;
        }
        if (!trace.stopped) requestAnimationFrame(sample);
      };
      sample();
    }, PLAYER_RADIUS);
    stage = "canvas hover";
    let click: { x: number; y: number } | undefined;
    let candidatesTried = 0;
    for (const candidate of candidates) {
      remaining(1);
      if (candidate.x < 0 || candidate.y < 0 || candidate.x >= 1440 || candidate.y >= 900) continue;
      candidatesTried++;
      await driver.moveMouse(candidate.x, candidate.y);
      await driver.wait(90);
      const hit = await page.evaluate(({ x, y }) => ({
        hovered: (window.__gameDebug as unknown as FishingDebug).getState().hoveredEntityId,
        surface: document.elementFromPoint(x, y)?.tagName,
      }), candidate);
      if (hit.hovered === entityId && hit.surface === "CANVAS") {
        // Fish and their ripple proxy keep animating. Reject an edge that only catches one
        // cached hover sample; the second read follows another full 70 ms picking interval.
        await driver.wait(90);
        const stableHit = await page.evaluate(({ x, y }) => ({
          hovered: (window.__gameDebug as unknown as FishingDebug).getState().hoveredEntityId,
          surface: document.elementFromPoint(x, y)?.tagName,
        }), candidate);
        if (stableHit.hovered !== entityId || stableHit.surface !== "CANVAS") continue;
        click = candidate;
        // Nothing that captures, changes setup or waits runs between the verified hover and click.
        await driver.click(candidate.x, candidate.y);
        break;
      }
    }
    assert(click, "No production canvas hover hit the projected fish school");
    const clicked = await page.evaluate((since) => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      return { state: debug.getState(), player: debug.getPlayerPosition(), camera: debug.getCamera(), events: debug.getEvents(since) };
    }, cursor);
    report.click = { ...click, entityId, candidatesTried, observation: clicked };
    assert.equal(clicked.state.selectedEntityId, entityId, `Canvas click selected ${clicked.state.selectedEntityId ?? "ground"}, not ${entityId}`);
    stage = "gathering receipt";
    if (itemModels) await page.evaluate(() => {
      const global = window as any;
      global.__authoredFishingFrames = [];
      const sample = () => {
        const motion = global.__gameDebug.getPlayerMotion();
        if (motion.fishing?.visible) global.__authoredFishingFrames.push(motion);
        if (global.__authoredFishingFrames.length < 600) global.__authoredFishingTimer = setTimeout(sample, 35);
      };
      sample();
    });
    await page.waitForFunction(({ id, since }) => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      const batch = debug.getEvents(since);
      const trace = (window as unknown as { __fishingTrace: DryTrace }).__fishingTrace;
      return batch.dropped || trace.error !== null || trace.wetCount > 0 || batch.events.some((event) => event.type === "navigation.failed"
        || (event.type === "item.received" && event.entityId === id && event.data.source === "gather"));
    }, { id: entityId, since: cursor }, { timeout: remaining(14_000), polling: 50 });

    const final = await page.evaluate(({ id, since }) => {
      const debug = window.__gameDebug as unknown as FishingDebug;
      const trace = (window as unknown as { __fishingTrace: DryTrace }).__fishingTrace;
      trace.stopped = true;
      return { entity: debug.getEntity(id)!, player: debug.getPlayerPosition(), clock: debug.getState().clock, events: debug.getEvents(since), trace, errors: debug.getErrors(), timeOrigin: performance.timeOrigin };
    }, { id: entityId, since: cursor });
    report.final = final;
    if (itemModels) {
      const frames = await page.evaluate(() => { const global = window as any; clearTimeout(global.__authoredFishingTimer); return global.__authoredFishingFrames as any[]; });
      assert(frames.length > 10, "Authored rod did not render an active fishing line");
      for (const frame of frames) {
        assert.equal(frame.attachments.mainHand, `equip-mainHand-corealm_item_${rodId}`);
        assert.equal(frame.fishing.visibleTackle, 0, "Decorative float duplicates the live fishing tackle");
        assert(frame.fishing.guideWorld && Math.hypot(...frame.fishing.tip.map((v: number, i: number) => v - frame.fishing.guideWorld[i])) < .002, "Line detached from deformed rod tip");
      }
      const bends = frames.map(frame => frame.fishing.guideLocal[2]);
      assert(Math.max(...bends) - Math.min(...bends) > .003, "Authored rod did not flex during fishing");
      report.authoredRod = { rodId, frames };
    }
    assert.equal(final.timeOrigin, documentTimeOrigin, "The document reloaded during acceptance; use a stable server without HMR");
    assert.equal(final.trace.error, null);
    assert.equal(final.trace.wetCount, 0, `The approach enters water: ${JSON.stringify(final.trace.firstWet)}`);
    assert(final.trace.positions.length > 4 && final.trace.paths.length > 0, "No actual walk or planned path was recorded");
    assert.equal(final.clock.timeScale, 1);
    assert(!final.events.dropped, "The event buffer dropped acceptance evidence");
    const events = final.events.events;
    assert(!events.some((event) => event.type === "navigation.failed"), "The fish click produced failed navigation");
    const navigation = events.find((event) => event.type === "navigation.started");
    const arrived = events.find((event) => event.type === "navigation.completed");
    const activity = events.find((event) => event.type === "activity.started" && event.data.entityId === entityId);
    const receipt = events.find((event) => event.type === "item.received" && event.entityId === entityId && event.data.source === "gather");
    assert(navigation && arrived && activity && receipt, "Missing click → walk → gathering → fish receipt event chain");
    assert(navigation.seq < arrived.seq && arrived.seq < activity.seq && activity.seq < receipt.seq);
    assert(Math.hypot(final.player.x - anchor[0], final.player.z - anchor[2]) <= INTERACT_RANGE, "The catch began beyond bank reach");
    assert(Math.hypot(final.player.x - entity.position[0], final.player.z - entity.position[2]) > INTERACT_RANGE, "The catch proof walked to the offshore school");
    const saved = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    const quantity = (state: GameState): number => state.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === entity.resource!.itemId ? slot.quantity : 0), 0);
    const received = events.filter((event) => event.type === "item.received" && event.entityId === entityId && event.data.itemId === entity.resource!.itemId && event.data.source === "gather")
      .reduce((sum, event) => sum + Number(event.data.quantity ?? 0), 0);
    assert(received > 0);
    assert.equal(quantity(saved) - quantity(before), received, "The real fish receipt disagrees with inventory");
    assert.equal(initial.entity.resource!.remaining - final.entity.resource!.remaining, received);
    assert.deepEqual(final.entity.position, initial.entity.position, "Interaction moved the visual school to the bank");
    screenshots.push(await driver.screenshot(output, "02-fishing-from-dry-bank"));
    if (itemModels) {
      await page.mouse.move(720, 450);
      for (let index = 0; index < 32; index++) await page.mouse.wheel(0, -100);
      await page.waitForTimeout(400);
      screenshots.push(await driver.screenshot(output, "03-authored-rod"));
    }
    assert.equal(final.errors.length + driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Runtime or request errors occurred");
    report.received = received;
    report.status = "passed";
    report.passed = true;
  } catch (error) {
    report.failedStage = stage;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page) {
      try {
        report.failureObservation = await driver.page.evaluate(({ id, since }) => {
          const debug = window.__gameDebug as unknown as FishingDebug | undefined;
          if (!debug) return { debugMissing: true };
          const global = window as unknown as { __fishingTrace?: DryTrace; __fishingLab?: { getState(): FishingLabState } };
          if (global.__fishingTrace) global.__fishingTrace.stopped = true;
          return {
            state: debug.getState(), player: debug.getPlayerPosition(), camera: debug.getCamera(),
            entity: id ? debug.getEntity(id) : null, navigation: debug.getNavigationState(), activity: debug.getCurrentActivity(),
            events: debug.getEvents(since), trace: global.__fishingTrace ?? null,
            path: global.__fishingLab?.getState().path ?? null, errors: debug.getErrors(),
            panels: [...document.querySelectorAll<HTMLElement>(".panel")].map((panel) => ({ id: panel.id, hidden: panel.hidden })),
          };
        }, { id: observedEntityId, since: eventCursor });
      } catch (observationError) {
        report.failureObservationError = observationError instanceof Error ? observationError.message : String(observationError);
      }
    }
    if (driver.page && Date.now() - started < 51_000) {
      try { screenshots.push(await driver.screenshot(output, "failure")); } catch { /* Preserve the gameplay error. */ }
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
