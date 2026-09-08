/**
 * Production forest acceptance in one Chromium boot. Run with a warm Vite server:
 *   npx tsx tools/forest-lab-test.ts --url http://127.0.0.1:4174
 * Setup uses debug camera/skill controls; the approach and every harvested log require one real
 * canvas click and natural simulation time. Save import and forced timer expiry are separate probes.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { GameEvent, SemanticEntity } from "../game/src/contracts.js";
import type { GameState } from "../game/src/state/store.js";
import type { ForestTreeDescriptor } from "../game/src/world/forestResources.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installAssetCandidates } from "./lib/assetCandidates.js";

type Point = { x: number; y: number; z: number };
type Bounds = { min: Point; max: Point; height: number; width: number; meshes: number; path: string };
type ForestState = { registered: number; resident: number; depleted: number; entityIds: string[]; obstacles: number };
interface ForestDebug {
  getState(): { ready: boolean; hoveredEntityId: string | null; clock: { timeScale: number; elapsedMs: number } };
  getEntity(id: string): SemanticEntity | null;
  getDrawnBounds(id: string): Bounds | null;
  getPlayerPosition(): Point;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  getErrors(): unknown[];
}
interface Observation {
  entity: SemanticEntity | null;
  bounds: Bounds | null;
  player: Point;
  forest: ForestState;
  clock: { timeScale: number; elapsedMs: number };
  events: { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  errors: unknown[];
}

const POSE = { x: 22, y: 0, z: 12, yaw: 0.5, pitch: 0.45, distance: 16 };
const CLICK = { x: 485, y: 528 };
const TOTAL_MS = 57_000;

async function main(): Promise<void> {
  const started = Date.now();
  const clearDeadline = installTestDeadline("Forest lab browser gate", 59_000);
  const output = path.join(repoRoot, "test-results", "forest-lab");
  await mkdir(output, { recursive: true });
  const args = process.argv.slice(2);
  const url = argValue(args, "--url");
  const server = url ? { url, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
      "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
    ],
  });
  const evidence: Record<string, unknown> = {
    status: "failed", passed: false, url: server.url, route: "/index.html?mode=combat&forest=1",
    inputProof: "One real canvas click; natural gathering at timeScale 1; no interaction or depletion debug call.",
    debugSetup: ["Existing combat lab skill 99; imported fixture save with inventory cleared except required hatchet", "inspectPose at the known clear tree approach"],
    separateProbes: ["forceRespawn invalidates live state before importing the depleted save", "teleport across the forest residency boundary", "forceRespawn expires the final respawn timer"],
    visualAcceptance: "Screenshots require human inspection; semantic and drawn-bounds checks do not grade art quality.",
    boundsProbe: "Bounds are read-only renderer observations. Transition screenshots follow natural render time; no query forces a visual update.",
    screenshots: [] as string[], phases: {} as Record<string, unknown>,
  };
  const phases = evidence.phases as Record<string, unknown>;
  const screenshots = evidence.screenshots as string[];
  let entityId = "";
  let cursor = 0;
  let epoch = "click";
  const events: Array<GameEvent & { epoch: string }> = [];
  let latest: Observation | undefined;
  const remaining = (limit: number): number => {
    const time = TOTAL_MS - (Date.now() - started);
    assert(time > 0, "Forest acceptance exceeded its 57-second operation budget");
    return Math.max(1, Math.min(limit, time));
  };
  async function observe(includeBounds = false): Promise<Observation> {
    const result = await driver.page!.evaluate(({ id, since, includeBounds }) => {
      const debug = window.__gameDebug as unknown as ForestDebug;
      const forest = (window as unknown as { __forestLab: { getState(): ForestState } }).__forestLab;
      return {
        entity: debug.getEntity(id), bounds: includeBounds ? debug.getDrawnBounds(id) : null, player: debug.getPlayerPosition(),
        forest: forest.getState(), clock: debug.getState().clock,
        events: debug.getEvents(since), errors: debug.getErrors(),
      };
    }, { id: entityId, since: cursor, includeBounds });
    assert(!result.events.dropped, "The event buffer dropped acceptance evidence");
    cursor = result.events.nextSeq;
    events.push(...result.events.events.map((event) => ({ ...event, epoch })));
    latest = result;
    assert.equal(result.errors.length, 0, "The game recorded a runtime error");
    return result;
  }
  async function until(label: string, predicate: (observation: Observation) => boolean, limit: number): Promise<Observation> {
    const end = Date.now() + remaining(limit);
    do {
      const observation = await observe();
      assert(!events.some((event) => event.epoch === "click" && event.type === "navigation.failed"), "The real tree click produced failed navigation");
      if (predicate(observation)) return observation;
      await driver.wait(Math.min(120, Math.max(1, end - Date.now())));
    } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
  }
  function stump(observation: Observation, tree: ForestTreeDescriptor, liveHeight: number): void {
    assert.equal(observation.entity?.state, "depleted");
    assert.equal(observation.entity.resource?.remaining, 0);
    assert.deepEqual(observation.entity.position, tree.position, "Stump semantic origin moved from the actual trunk");
    const bounds = observation.bounds;
    assert(bounds && bounds.meshes > 0 && bounds.height > 0, "No stump geometry is drawn");
    assert(bounds.height < liveHeight * 0.3, "The depleted renderer still draws the standing canopy");
    assert(bounds.min.x <= tree.position[0] && bounds.max.x >= tree.position[0]
      && bounds.min.z <= tree.position[2] && bounds.max.z >= tree.position[2], "Drawn stump no longer covers the trunk origin");
    assert(observation.forest.depleted >= 1, "The forest lost its depleted resident");
  }

  try {
    await driver.launch();
    const candidateCatalog = argValue(args, "--catalog");
    if (candidateCatalog) await installAssetCandidates(driver.page!, candidateCatalog);
    driver.page!.setDefaultTimeout(5_000);
    await driver.open(remaining(18_000), evidence.route as string);
    await driver.page!.waitForFunction(() => Boolean((window as Window & { __forestLab?: unknown }).__forestLab), undefined, { timeout: remaining(3_000) });
    const trees = await driver.page!.evaluate(() => (window as unknown as {
      __forestLab: { getTrees(): ForestTreeDescriptor[] };
    }).__forestLab.getTrees());
    const tree = [...trees].sort((a, b) => Math.hypot(a.position[0] - 19.764, a.position[2] - 15.963)
      - Math.hypot(b.position[0] - 19.764, b.position[2] - 15.963))[0];
    assert(tree && Math.hypot(tree.position[0] - 19.764, tree.position[2] - 15.963) < 0.5, "Known clear approach tree is absent from the fixture");
    entityId = tree.id;
    evidence.tree = tree;
    // The combat fixture carries spell reagents and crafting supplies. Make room for this
    // whole tree while retaining the real required tool; acquisition is not under test here.
    const fixtureSave = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    fixtureSave.inventory.slots = fixtureSave.inventory.slots.map((slot) => slot?.itemId === "grithe_hatchet" ? slot : null);
    await driver.callDebug("loadSaveBlob", [JSON.stringify(fixtureSave)]);
    cursor = 0;
    assert.equal(await driver.callDebug("inspectPose", [POSE]), true);
    await driver.wait(350);
    await until("available tree joins production gathering", (o) => o.entity?.state === "available", 3_000);
    const initial = await observe(true);
    assert(initial.bounds && initial.bounds.height > 2, "Available tree has no standing geometry");
    assert.equal(initial.clock.timeScale, 1, "Natural gathering proof requires timeScale 1");
    const liveHeight = initial.bounds!.height;
    const initialYields = initial.entity!.resource!.remaining;
    const itemId = initial.entity!.resource!.itemId;
    const beforeSave = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    const quantity = (save: GameState) => save.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === itemId ? slot.quantity : 0), 0);
    phases.available = initial;

    // There is no public projection probe. Validate the observed fixture coordinate through the
    // real raycaster first; never turn a missed canvas click into a debug interaction fallback.
    await driver.moveMouse(CLICK.x, CLICK.y);
    await driver.page!.waitForFunction((id) => window.__gameDebug?.getState().hoveredEntityId === id, entityId, { timeout: remaining(2_000) });
    const hitSurface = await driver.page!.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, CLICK);
    assert.equal(hitSurface, "CANVAS", "A UI overlay blocks the tested trunk point");
    cursor = (await driver.callDebug("getEvents", [cursor]) as { nextSeq: number }).nextSeq;
    events.length = 0;
    evidence.click = { ...CLICK, hoveredEntityId: entityId, surface: hitSurface, projection: "Observed fixture point, verified by production hover" };
    await driver.click(CLICK.x, CLICK.y);
    const receipt = await until("real click walks to the tree and receives a gathered log", () => events.some((event) => event.type === "item.received" && event.entityId === entityId && event.data.source === "gather"), 8_000);
    const navigation = events.find((event) => event.type === "navigation.started");
    const arrived = events.find((event) => event.type === "navigation.completed");
    const activity = events.find((event) => event.type === "activity.started" && event.data.entityId === entityId);
    const firstReceipt = events.find((event) => event.type === "item.received" && event.entityId === entityId && event.data.source === "gather");
    assert(navigation && arrived && activity && firstReceipt, "Missing click → navigation → gathering event chain");
    assert(navigation.seq < arrived.seq && arrived.seq < activity.seq && activity.seq < firstReceipt.seq, "Gathering receipt did not follow completed navigation");
    phases.realClick = { observation: receipt, navigation, arrived, activity, firstReceipt };

    await until("natural depletion after all real gather receipts", (o) => o.entity?.state === "depleted", 25_000);
    await driver.wait(350);
    screenshots.push(await driver.screenshot(output, "01-naturally-depleted-stump"));
    const depleted = await observe(true);
    stump(depleted, tree, liveHeight);
    const receipts = events.filter((event) => event.type === "item.received" && event.entityId === entityId && event.data.source === "gather" && event.data.itemId === itemId);
    const received = receipts.reduce((sum, event) => sum + Number(event.data.quantity ?? 0), 0);
    assert.equal(received, initialYields, "Receipts do not account for every naturally depleted yield");
    assert(events.some((event) => event.type === "resource.depleted" && event.entityId === entityId), "No production depletion event");
    const depletedBlob = await driver.callDebug("getSaveBlob") as string;
    const saved = JSON.parse(depletedBlob) as GameState;
    assert.equal(quantity(saved) - quantity(beforeSave), received, "Gathering receipts disagree with saved inventory");
    assert.equal(saved.world.nodes[entityId]?.state, "depleted");
    assert.equal(saved.world.nodes[entityId]?.remaining, 0);
    phases.naturalDepletion = { observation: depleted, initialYields, received, inventoryDelta: quantity(saved) - quantity(beforeSave), savedNode: saved.world.nodes[entityId] };
    await writeFile(path.join(output, "depleted-save.json"), depletedBlob);

    // Establish a different live state so loading the same depleted save must actually restore it.
    assert.equal(await driver.callDebug("forceRespawn", [entityId]), true);
    await until("restore precondition: tree has returned", (o) => o.entity?.state === "available", 2_000);
    await driver.callDebug("loadSaveBlob", [depletedBlob]);
    cursor = 0;
    epoch = "restored-save";
    await until("production save import restores the stump", (o) => o.entity?.state === "depleted", 2_000);
    const restored = await observe(true);
    stump(restored, tree, liveHeight);
    const restoredSave = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    assert.deepEqual(restoredSave.world.nodes[entityId], saved.world.nodes[entityId], "Saved node lifecycle was not restored");
    assert.equal(quantity(restoredSave), quantity(saved), "Save import changed gathered inventory");
    phases.saveRestore = restored;

    assert.equal(await driver.callDebug("teleport", [[tree.position[0] - 80, 0, tree.position[2] + 25]]), true);
    await driver.wait(300);
    const far = await observe();
    const farDistance = Math.hypot(far.player.x - tree.position[0], far.player.z - tree.position[2]);
    assert(farDistance > 50, `Far probe reached only ${farDistance.toFixed(2)} metres`);
    assert.equal(far.entity?.state, "depleted", "Distance streaming forgot the saved stump");
    assert.equal(far.entity.resource?.remaining, 0);
    assert.deepEqual(far.entity.position, tree.position);
    assert(far.forest.depleted >= 1, "Distance streaming released the depleted resident");
    // An offscreen view may legitimately be culled. Require the stump's geometry after returning.
    assert.equal(await driver.callDebug("inspectPose", [POSE]), true);
    await driver.wait(350);
    screenshots.push(await driver.screenshot(output, "02-restored-stump-after-return"));
    const returned = await observe(true);
    stump(returned, tree, liveHeight);
    phases.distanceSuppression = { farDistance, far, returned, proof: "Depleted residency persisted beyond 50 m; return bounds remain a stump, with a screenshot for visual inspection." };

    assert.equal(await driver.callDebug("forceRespawn", [entityId]), true);
    await until("expired timer restores the original standing tree", (o) => o.entity?.state === "available", 2_000);
    await driver.wait(350);
    screenshots.push(await driver.screenshot(output, "03-respawned-tree"));
    const regrown = await observe(true);
    assert(regrown.bounds && regrown.bounds.height > liveHeight * 0.9, "Respawn did not draw the standing tree");
    assert.deepEqual(regrown.entity!.position, tree.position);
    assert.equal(regrown.entity!.view?.assetId, tree.assetId);
    assert(regrown.entity!.resource!.remaining > 0);
    assert.equal(regrown.entity!.resource!.remaining, regrown.entity!.resource!.maxYields);
    assert(Math.abs(regrown.bounds!.height - liveHeight) < 0.03, "Respawn did not restore the original silhouette");
    phases.respawn = { method: "Debug timer expiry, followed by production gathering tick and renderer", observation: regrown };
    assert.equal(driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Chromium reported runtime or request errors");
    evidence.status = "passed";
    evidence.passed = true;
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.lastObservation = latest;
    process.exitCode = 1;
  } finally {
    evidence.elapsedMs = Date.now() - started;
    evidence.events = events;
    evidence.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    await writeFile(path.join(output, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ status: evidence.status, elapsedMs: evidence.elapsedMs, report: path.join(output, "report.json"), error: evidence.error }));
    await driver.close();
    await server.close();
    clearDeadline();
  }
}

await main();
