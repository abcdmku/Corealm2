/** First-load cancellation and one natural craft through the production station UI. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA, INTERACT_RANGE } from "../game/src/app/config.js";
import type { GameEvent, ItemStack, Result, SemanticEntity } from "../game/src/contracts.js";
import { RECIPES } from "../game/src/content/recipes.js";
import type { GameState } from "../game/src/state/store.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

type Point = { x: number; y: number; z: number };
type Bounds = { min: Point; max: Point; meshes: number };
interface ProductionDebug {
  getState(): { hoveredEntityId: string | null; clock: { timeScale: number } };
  getCamera(): { position: Point; target: Point };
  getPlayerPosition(): Point;
  getEntity(id: string): SemanticEntity | null;
  getDrawnBounds(id: string): Bounds | null;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  getErrors(): unknown[];
}

async function main(): Promise<void> {
  const started = Date.now();
  const clearDeadline = installTestDeadline("Production panel lab gate", 40_000);
  const args = process.argv.slice(2);
  const externalUrl = argValue(args, "--url");
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const output = path.join(repoRoot, "test-results", "production-panel-lab");
  const report: Record<string, unknown> = {
    passed: false, route: "/index.html?mode=building", url: server.url,
    setup: "Production Essence Altar Ruins; lab awakening consumes the seeded Air Orb. Recipe ingredients are granted and its skill is set to the required level, below the XP cap. Simulation remains at timeScale 1.",
    inputProof: "Both opens require a production canvas hover, real right click, and the altar's Use menu action. The altar's plain left-click action is Recharge.",
    screenshots: [] as string[],
  };
  const screenshots = report.screenshots as string[];
  let stage = "boot";
  let releaseChunk: (() => void) | undefined;
  let chunkRequests = 0;
  const remaining = (limit: number): number => {
    const budget = 37_000 - (Date.now() - started);
    assert(budget > 0, "Production panel acceptance exceeded its 37-second operation budget");
    return Math.max(1, Math.min(limit, budget));
  };
  const count = (slots: readonly (ItemStack | null)[], itemId: string): number =>
    slots.reduce((total, stack) => total + (stack?.itemId === itemId ? stack.quantity : 0), 0);

  try {
    await mkdir(output, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3_000);
    // tsx's name-preservation helper must also exist in serialized Playwright callbacks.
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    const heldChunk = new Promise<void>((resolve) => { releaseChunk = resolve; });
    await page.route("**/ui/productionPanel.ts*", async (route) => {
      chunkRequests++;
      await heldChunk;
      await route.continue();
    });
    await driver.open(remaining(18_000), report.route as string);
    const documentOrigin = await page.evaluate(() => performance.timeOrigin);
    assert.equal(chunkRequests, 0, "Production controls loaded during boot before any station was opened");
    stage = "altar setup";
    const fixture = await page.evaluate(async () => {
      const lab = window.__featureLab!;
      await lab.setStructure({ kind: "composition", id: "essence_altar_ruins", kit: "plaster" });
      lab.setWalkingEnabled(true);
      lab.setPlayerVisible(true);
      return lab.perform("awaken-altar");
    });
    assert.equal(fixture.errors.length, 0);
    assert.equal(fixture.altar?.state, "awakened");
    assert.equal(fixture.altar?.orbConsumed, true);
    const entityId = fixture.altar!.entityId;
    const altar = await driver.callDebug("getEntity", [entityId]) as SemanticEntity;
    assert(altar.station?.recipeIds.includes("craft_air_wand") && altar.interactions.includes("produce"));
    // The standalone tool has no game boot to populate the mutable content registry.
    const recipe = RECIPES.find((entry) => entry.id === "craft_air_wand");
    assert(recipe, "The authored Air Wand recipe is missing from the production table");
    const skillSetup = await page.evaluate(({ skill, level }) => window.__featureLab!.setLevel(skill, level), {
      skill: recipe.skill, level: recipe.reqLevel,
    });
    assert.equal(skillSetup.levels[recipe.skill], recipe.reqLevel);
    for (const input of recipe.inputs) {
      const supplied = await driver.callDebug("giveItem", [input.itemId, input.quantity, "inventory"]) as Result<number>;
      assert(supplied.ok && supplied.value === input.quantity, `Could not supply ${input.quantity} ${input.itemId}`);
    }
    const stand = { x: altar.position[0], z: altar.position[2] - 1.8 };
    const ground = await driver.callDebug("groundHeight", [stand.x, stand.z]) as number;
    assert.equal(await driver.callDebug("inspectPose", [{ ...stand, y: ground, yaw: 0, pitch: 0.6, distance: 13 }]), true);
    const labPanel = page.locator("#panel-feature-lab");
    await labPanel.waitFor({ state: "visible", timeout: remaining(3_000) });
    await labPanel.locator(".panel__close").click();
    await page.evaluate(async () => {
      const debug = window.__gameDebug as unknown as ProductionDebug;
      const started = performance.now();
      let stableSince = started;
      let previous = debug.getCamera();
      while (performance.now() - started < 3_000) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = debug.getCamera();
        const moved = Math.max(
          Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y, current.position.z - previous.position.z),
          Math.hypot(current.target.x - previous.target.x, current.target.y - previous.target.y, current.target.z - previous.target.z),
        );
        if (moved > 0.002) stableSince = performance.now();
        if (performance.now() - stableSince >= 200) return;
        previous = current;
      }
      throw new Error("Camera did not settle before projecting the altar");
    });
    const projection = await page.evaluate((id) => {
      const debug = window.__gameDebug as unknown as ProductionDebug;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return {
        camera: debug.getCamera(), bounds: debug.getDrawnBounds(id), player: debug.getPlayerPosition(), clock: debug.getState().clock,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }, entityId);
    assert(projection.bounds && projection.bounds.meshes > 0, "The real altar has no drawn geometry");
    assert.equal(projection.clock.timeScale, 1);
    assert(Math.hypot(projection.player.x - altar.position[0], projection.player.y - altar.position[1], projection.player.z - altar.position[2]) <= INTERACT_RANGE,
      "The player must stand within the real production station range");
    report.setupState = { altar, player: projection.player, recipeId: recipe.id };
    const camera = new PerspectiveCamera(CAMERA.fov, projection.rect.width / projection.rect.height, CAMERA.near, CAMERA.far);
    camera.position.set(projection.camera.position.x, projection.camera.position.y, projection.camera.position.z);
    camera.lookAt(projection.camera.target.x, projection.camera.target.y, projection.camera.target.z);
    camera.updateMatrixWorld(true);
    const bounds = projection.bounds;
    const candidates = [0.5, 0.25, 0.75].flatMap((u) => [0.75, 0.5, 0.25].flatMap((v) => [0.5, 0.25, 0.75].map((w) => {
      const point = new Vector3(
        bounds.min.x + (bounds.max.x - bounds.min.x) * u,
        bounds.min.y + (bounds.max.y - bounds.min.y) * v,
        bounds.min.z + (bounds.max.z - bounds.min.z) * w,
      ).project(camera);
      return { x: projection.rect.x + (point.x + 1) * projection.rect.width / 2, y: projection.rect.y + (1 - point.y) * projection.rect.height / 2, depth: point.z };
    })));
    async function openFromCanvas(): Promise<void> {
      for (const candidate of candidates) {
        remaining(1);
        if (candidate.depth < -1 || candidate.depth > 1 || candidate.x < 0 || candidate.y < 0 || candidate.x >= 1440 || candidate.y >= 900) continue;
        await driver.moveMouse(candidate.x, candidate.y);
        await driver.wait(90);
        const hit = await page.evaluate(({ x, y }) => ({
          hovered: (window.__gameDebug as unknown as ProductionDebug).getState().hoveredEntityId,
          surface: document.elementFromPoint(x, y)?.tagName,
        }), candidate);
        if (hit.hovered !== entityId || hit.surface !== "CANVAS") continue;
        await driver.click(candidate.x, candidate.y, "right");
        const use = page.getByRole("menuitem", { name: `Use ${altar.name}`, exact: true });
        await use.waitFor({ state: "visible", timeout: remaining(2_000) });
        assert.notEqual(await use.getAttribute("aria-disabled"), "true");
        await use.click();
        report.canvasPoint = candidate;
        return;
      }
      throw new Error("No production hover hit the altar's projected geometry");
    }

    stage = "delayed first open";
    await Promise.all([
      page.waitForRequest("**/ui/productionPanel.ts*", { timeout: remaining(4_000) }),
      openFromCanvas(),
    ]);
    assert.equal(chunkRequests, 1);
    assert.equal(await page.locator("#panel-production:visible").count(), 0);
    await driver.press("Escape");
    assert.equal(await page.locator(".title:visible").count(), 0, "Escape did not consume the pending station request");
    await driver.press("Escape");
    const resume = page.getByRole("button", { name: "Return to game", exact: true });
    await resume.waitFor({ state: "visible", timeout: remaining(2_000) });
    releaseChunk!();
    await page.locator("#panel-production").waitFor({ state: "attached", timeout: remaining(4_000) });
    // Attached proves the delayed module constructed its panel; two frames let its queued open run.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.equal(await page.locator("#panel-production:visible").count(), 0, "Canceled load reopened Production");
    assert(await resume.isVisible(), "Canceled load replaced the newer pause menu");
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest(".title"))), "Canceled load stole pause-menu focus");
    report.cancelDuringLoad = true;
    await resume.click();

    stage = "normal reopen and craft";
    await openFromCanvas();
    const panel = page.locator("#panel-production");
    await panel.waitFor({ state: "visible", timeout: remaining(2_000) });
    assert.equal(await panel.locator(".production-row").count(), altar.station!.recipeIds.length);
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest("#panel-production"))), "Opening the station did not focus its controls");
    const row = panel.locator(".production-row").filter({ has: page.getByText(recipe.name, { exact: true }) });
    const make = row.getByRole("button", { name: "Make", exact: true });
    assert(await make.isEnabled(), "The supplied base wand did not enable its production recipe");
    screenshots.push(await driver.screenshot(output, "01-production-ready"));
    const before = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    const cursor = (await driver.callDebug("getEvents", [0]) as { nextSeq: number }).nextSeq;
    await make.click();
    await page.waitForFunction(({ since, recipeId, stationId }) => {
      const events = (window.__gameDebug as unknown as ProductionDebug).getEvents(since);
      return events.dropped || events.events.some((event) => event.type === "production.completed" && event.entityId === stationId && event.data.recipeId === recipeId);
    }, { since: cursor, recipeId: recipe.id, stationId: entityId }, { timeout: remaining(5_000), polling: 50 });
    const after = JSON.parse(await driver.callDebug("getSaveBlob") as string) as GameState;
    const events = await driver.callDebug("getEvents", [cursor]) as { events: GameEvent[]; dropped?: boolean };
    assert(!events.dropped);
    const completion = events.events.filter((event) => event.type === "production.completed" && event.entityId === entityId && event.data.recipeId === recipe.id);
    assert.equal(completion.length, 1, "The Make button must complete exactly one batch");
    assert.equal(count(after.inventory.slots, recipe.output.itemId) - count(before.inventory.slots, recipe.output.itemId), recipe.output.quantity);
    for (const input of recipe.inputs) assert.equal(count(before.inventory.slots, input.itemId) - count(after.inventory.slots, input.itemId), input.quantity);
    assert.equal(after.skills[recipe.skill].xp - before.skills[recipe.skill].xp, recipe.xp);
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, "The page reloaded during acceptance");
    assert.deepEqual(await driver.callDebug("getErrors"), []);
    assert.equal(driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Runtime or request errors occurred");
    report.production = { completion: completion[0], ingredientDelta: recipe.inputs, outputDelta: recipe.output, xpDelta: recipe.xp };
    report.passed = true;
  } catch (error) {
    report.stage = stage;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page && Date.now() - started < 31_000) {
      try { screenshots.push(await driver.screenshot(output, "failure")); } catch { /* Retain the original failure. */ }
    }
  } finally {
    releaseChunk?.();
    report.elapsedMs = Date.now() - started;
    report.chunkRequests = chunkRequests;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    try {
      await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ passed: report.passed, elapsedMs: report.elapsedMs, error: report.error, report: path.join(output, "report.json") }));
    } finally {
      await driver.close();
      await server.close();
      clearDeadline();
    }
  }
}

await main();
