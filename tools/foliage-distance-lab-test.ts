/** Production foliage distance proof. Root runs against a stable existing Vite server:
 * npx tsx tools/foliage-distance-lab-test.ts --url http://127.0.0.1:4175
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3, LinearMipmapLinearFilter } from "three";
import { CAMERA } from "../game/src/app/config.js";
import { TREE_SPECIES, treeAssetIds, treeSpeciesForAsset } from "../game/src/content/treeSpecies.js";
import type { Vec3 } from "../game/src/contracts.js";
import type { EnvironmentWorkbench, EnvironmentWorkbenchState } from "../game/src/featureLab/environment.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";

type Point = { x: number; y: number; z: number };
type Bounds = { min: Vec3; max: Vec3 };
type Draw = { name: string; pass: string; calls: number; triangles: number;
  materials: { name: string; alphaToCoverage: boolean; coverageSamples: number; mapMinFilter: number | null; mapAnisotropy: number | null; transparent: boolean; leafAssociatedColour: boolean }[] };
interface Debug {
  getState(): { ready: boolean };
  getCamera(): { position: Point; target: Point; occluded: boolean };
  getPlayerPosition(): Point;
  getRenderProfile(namePrefix?: string): { calls: number; triangles: number; draws: Draw[] };
  getSceneStats(): { counts: Record<string, number>; hidden: Record<string, number> };
  getFoliageOcclusion(): { enabled: boolean; foot: number[]; head: number[] };
  getErrors(): unknown[];
}
interface Source { id: string; file: string; triangles: number; sha256: string }
interface Observation {
  state: EnvironmentWorkbenchState;
  bounds: Bounds | null;
  camera: ReturnType<Debug["getCamera"]>;
  player: Point;
  profile: ReturnType<Debug["getRenderProfile"]>;
  foliageObjects: Record<string, number>;
  hiddenFoliage: Record<string, number>;
  occlusion: ReturnType<Debug["getFoliageOcclusion"]>;
  canvas: { x: number; y: number; width: number; height: number; bufferWidth: number; bufferHeight: number };
  timeOrigin: number;
}
const ASSETS = [
  ...TREE_SPECIES.flatMap(treeAssetIds),
  "corealm_fern_1", "corealm_fern_2", "corealm_shrub_1", "corealm_shrub_2",
];
const CAPTURE = new Set(["corealm_oak_1", "corealm_pine_1", "corealm_fern_1", "corealm_shrub_2"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = argValue(args, "--url");
  assert(url, "Supply --url for the existing stable Vite server; this gate does not start another server");
  const started = Date.now();
  const clearDeadline = installTestDeadline("Foliage distance lab", 45_000);
  const output = path.join(repoRoot, "test-results", "foliage-distance-lab");
  await mkdir(output, { recursive: true });
  const driver = new GameDriver({ url, close: async () => {} }, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const route = "/index.html?mode=combat&environment=1";
  const requests: string[] = [];
  const samples: Record<string, unknown>[] = [];
  const screenshots: string[] = [];
  const report: Record<string, unknown> = {
    status: "failed", passed: false, url, route, samples, screenshots,
    scope: "One native production scatter instance per asset, held through near, far and return poses. Colour GPU submissions compared with the served source manifest.",
    setup: "Production graphics and wind; inspectPose moves the actual player outside foliage. No geometry swaps, visibility edits or occlusion disabling by this tool.",
    placementProof: "The fixture is created once per asset. Its native scale, one-instance count, source bounds and scene object counts must remain unchanged through the sweep.",
    visualAcceptance: "Root must inspect the eight full-viewport oak, pine, fern and shrub screenshots.",
  };
  let stage = "boot";
  let assetId: string | null = null;
  let documentTimeOrigin = 0;
  const remaining = (limit: number): number => {
    const left = 42_000 - (Date.now() - started);
    assert(left > 0, "Foliage distance lab exceeded its 42-second operation budget");
    return Math.max(1, Math.min(left, limit));
  };

  async function observe(): Promise<Observation> {
    return driver.page!.evaluate(() => {
      const debug = window.__gameDebug as unknown as Debug;
      const environment = (window as unknown as { __environmentLab: EnvironmentWorkbench }).__environmentLab;
      const scene = debug.getSceneStats();
      const canvas = document.querySelector("canvas")!;
      const rect = canvas.getBoundingClientRect();
      return {
        state: environment.getState(), bounds: environment.getBounds(),
        camera: debug.getCamera(), player: debug.getPlayerPosition(), profile: debug.getRenderProfile("lab-foliage-"),
        foliageObjects: Object.fromEntries(Object.entries(scene.counts).filter(([name]) => name.startsWith("lab-foliage-"))),
        hiddenFoliage: Object.fromEntries(Object.entries(scene.hidden).filter(([name]) => name.startsWith("lab-foliage-"))),
        occlusion: debug.getFoliageOcclusion(),
        canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bufferWidth: canvas.width, bufferHeight: canvas.height },
        timeOrigin: performance.timeOrigin,
      };
    });
  }

  function validate(observation: Observation, source: Source, far: boolean): Record<string, unknown> {
    const { state, bounds, camera, player, canvas } = observation;
    assert.equal(observation.timeOrigin, documentTimeOrigin, "Document reloaded during the sweep; use a server without HMR");
    assert(state.ready && state.mode === "foliage");
    assert.equal(state.selection, source.id);
    assert.deepEqual(state.assets, [source.id], "The workbench contains more than one foliage source");
    assert.deepEqual(state.foliage, { layout: "lane", count: 1, span: 1 });
    assert.deepEqual(state.entityIds, [], "This must use production scatter instancing");
    assert(bounds, "The source has no production drawn bounds");
    const group = `lab-foliage-${source.id}-lane`;
    const shardPattern = new RegExp(`^${group}-t\\d+$`);
    const meshPattern = new RegExp(`^${group}-t\\d+-\\d+$`);
    const shardNames = Object.keys(observation.foliageObjects).sort();
    assert(shardNames.length > 0 && shardNames.every((name) => shardPattern.test(name)),
      "A previous or alternate foliage source remains in the scene, or no source shard exists");
    assert.deepEqual(observation.hiddenFoliage, {}, "The source was hidden at this distance");
    const colour = observation.profile.draws.filter((draw) => draw.pass === "colour" && draw.name.startsWith("lab-foliage-"))
      .sort((a, b) => a.name.localeCompare(b.name));
    assert(colour.length > 0, "No foliage colour submissions. A missing or top-40-truncated profile cannot pass");
    assert(colour.every((draw) => meshPattern.test(draw.name) && draw.calls === 1 && draw.triangles > 0));
    const submittedObjects: Record<string, number> = {};
    for (const draw of colour) {
      const shard = draw.name.replace(/-\d+$/, "");
      submittedObjects[shard] = (submittedObjects[shard] ?? 0) + 1;
    }
    assert.deepEqual(submittedObjects, observation.foliageObjects,
      "Some source shard meshes disappeared or were omitted from the render profile");
    const triangles = colour.reduce((sum, draw) => sum + draw.triangles, 0);
    assert.equal(triangles, source.triangles, "Actual colour triangles differ from the served native source");
    if (treeSpeciesForAsset(source.id)) {
      const leaves = colour.flatMap(draw => draw.materials.filter(material => material.name.includes("_cutout")));
      assert(leaves.length > 0, "The tree has no submitted leaf cutout material");
      for (const leaf of leaves) {
        assert(leaf.alphaToCoverage && leaf.coverageSamples >= 2, "Leaf edges are not using actual multisample coverage");
        assert(!leaf.transparent, "Leaves must keep opaque depth writing and instance batching");
        assert.equal(leaf.mapMinFilter, LinearMipmapLinearFilter);
        assert.equal(leaf.mapAnisotropy, 8);
        assert(leaf.leafAssociatedColour, "Leaf colour must be filtered with coverage before shading");
      }
    }

    const centre = new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5);
    const distance = centre.distanceTo(new Vector3(camera.position.x, camera.position.y, camera.position.z));
    const baseDistance = Math.hypot(camera.position.x - centre.x, camera.position.y - bounds.min[1], camera.position.z - centre.z);
    const threshold = treeSpeciesForAsset(source.id) ? 70 : 34;
    assert(far ? distance > threshold + 5 : distance < threshold - 5,
      `Actual camera distance ${distance.toFixed(2)} m did not cross the old ${threshold} m threshold`);
    assert(!camera.occluded, "A camera blocker changed the intended foliage view");
    const actorClearance = Math.hypot(
      Math.max(bounds.min[0] - player.x, 0, player.x - bounds.max[0]),
      Math.max(bounds.min[2] - player.z, 0, player.z - bounds.max[2]),
    );
    assert(actorClearance > 1, "The actor is standing inside or directly against the plant");
    const projection = new PerspectiveCamera(CAMERA.fov, canvas.width / canvas.height, CAMERA.near, CAMERA.far);
    projection.position.set(camera.position.x, camera.position.y, camera.position.z);
    projection.lookAt(camera.target.x, camera.target.y, camera.target.z);
    projection.updateMatrixWorld(true);
    const corners = [bounds.min[0], bounds.max[0]].flatMap((x) => [bounds.min[1], bounds.max[1]]
      .flatMap((y) => [bounds.min[2], bounds.max[2]].map((z) => new Vector3(x, y, z))));
    const depths = corners.map((point) => -point.clone().applyMatrix4(projection.matrixWorldInverse).z);
    const projected = corners.map((point) => point.project(projection));
    assert(projected.every((point) => point.x > -0.97 && point.x < 0.97 && point.y > -0.97 && point.y < 0.97 && point.z > -1 && point.z < 1),
      "The full source bounds leave the actual viewport");
    const rect = {
      left: canvas.x + (Math.min(...projected.map((point) => point.x)) + 1) * canvas.width / 2,
      right: canvas.x + (Math.max(...projected.map((point) => point.x)) + 1) * canvas.width / 2,
      top: canvas.y + (1 - Math.max(...projected.map((point) => point.y))) * canvas.height / 2,
      bottom: canvas.y + (1 - Math.min(...projected.map((point) => point.y))) * canvas.height / 2,
    };
    assert(rect.right - rect.left > 5 && rect.bottom - rect.top > 5, "The source is too small to inspect even at full viewport resolution");
    // The production reveal only removes foliage in front of the actor capsule. Keep either
    // the complete plant behind that capsule or its projection clear of the reveal footprint.
    const { enabled, foot, head } = observation.occlusion;
    if (enabled && Math.min(...depths) <= Math.max(foot[2]!, head[2]!) + 0.2) {
      const radius = Math.max(foot[3]!, head[3]!) + 2;
      const sx = canvas.width / canvas.bufferWidth, sy = canvas.height / canvas.bufferHeight;
      const reveal = {
        left: canvas.x + (Math.min(foot[0]!, head[0]!) - radius) * sx,
        right: canvas.x + (Math.max(foot[0]!, head[0]!) + radius) * sx,
        top: canvas.y + canvas.height - (Math.max(foot[1]!, head[1]!) + radius) * sy,
        bottom: canvas.y + canvas.height - (Math.min(foot[1]!, head[1]!) - radius) * sy,
      };
      assert(rect.right < reveal.left || rect.left > reveal.right || rect.bottom < reveal.top || rect.top > reveal.bottom,
        "Player reveal dither overlaps the foliage photograph");
    }
    return { colour, triangles, calls: colour.reduce((sum, draw) => sum + draw.calls, 0), shardMeshes: submittedObjects,
      distance, baseDistance, oldThreshold: threshold, actorClearance, projectedBounds: rect };
  }

  async function pose(tree: boolean, far: boolean): Promise<void> {
    const bounds = tree ? await driver.page!.evaluate(() =>
      (window as unknown as { __environmentLab: EnvironmentWorkbench }).__environmentLab.getBounds()) : null;
    const side = bounds ? Math.max(6, bounds.max[0] + 2) : 6;
    const nearDistance = bounds ? Math.max(24, (bounds.max[1] - bounds.min[1]) * 2.5) : 24;
    const position = tree
      ? far ? { x: side, z: -28, yaw: Math.PI, pitch: 0.18, distance: 34 } : { x: side, z: 18, yaw: Math.PI, pitch: 0.35, distance: nearDistance }
      : far ? { x: -3, z: 8, yaw: Math.PI, pitch: 0.18, distance: 28 } : { x: -3, z: 25, yaw: 0, pitch: 0.48, distance: 7 };
    const y = await driver.callDebug("groundHeight", [position.x, position.z]) as number;
    assert.equal(await driver.callDebug("inspectPose", [{ ...position, y }]), true);
    await driver.page!.evaluate(async () => {
      const debug = window.__gameDebug as unknown as Debug;
      const start = performance.now();
      let stable = start;
      let previous = debug.getCamera();
      while (performance.now() - start < 1_500) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const current = debug.getCamera();
        if (Math.max(
          Math.hypot(current.position.x - previous.position.x, current.position.y - previous.position.y, current.position.z - previous.position.z),
          Math.hypot(current.target.x - previous.target.x, current.target.y - previous.target.y, current.target.z - previous.target.z),
        ) > 0.005) stable = performance.now();
        if (performance.now() - stable >= 100) return;
        previous = current;
      }
      throw new Error("The production camera did not settle for the distance sample");
    });
  }

  try {
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(remaining(3_000));
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    page.on("request", (request) => { if (/\.glb(?:[?#]|$)/i.test(request.url())) requests.push(request.url()); });
    await driver.open(remaining(18_000), route);
    await page.waitForFunction(() => (window as unknown as { __environmentLab?: EnvironmentWorkbench }).__environmentLab?.getState().ready === true,
      undefined, { timeout: remaining(4_000) });
    documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    for (const panel of await page.locator(".panel:not([hidden]) .panel__close").all()) if (await panel.isVisible()) await panel.click();
    const sources = await page.evaluate(async (ids) => {
      const response = await fetch("/assets/manifest.json");
      if (!response.ok) throw new Error(`Source manifest returned HTTP ${response.status}`);
      const manifest = await response.json() as { assets: Source[] };
      return manifest.assets.filter((entry) => ids.includes(entry.id)).map(({ id, file, triangles, sha256 }) => ({ id, file, triangles, sha256 }));
    }, ASSETS);
    const catalog = await page.evaluate((ids) => (window as unknown as { __environmentLab: EnvironmentWorkbench }).__environmentLab.getCatalog()
      .assets.filter((entry) => ids.includes(entry.id)), ASSETS);

    for (const id of ASSETS) {
      remaining(1);
      assetId = id;
      stage = `${id}: native source`;
      const source = sources.find((entry) => entry.id === id);
      assert(source && Number.isInteger(source.triangles) && source.triangles > 0, `Missing source triangle metadata for ${id}`);
      const catalogEntry = catalog.find((entry) => entry.id === id);
      assert(catalogEntry && catalogEntry.file === source.file && !source.file.includes("_far"));
      await page.evaluate(async (id) => {
        await (window as unknown as { __environmentLab: EnvironmentWorkbench }).__environmentLab.showFoliage(id, { layout: "lane", count: 1, span: 1, scale: 1 });
      }, id);
      stage = `${id}: workbench label`;
      await page.waitForFunction((id) => {
        const mode = document.querySelector<HTMLSelectElement>("#environment-lab-mode");
        const selection = document.querySelector<HTMLSelectElement>("#environment-lab-selection");
        const load = document.querySelector<HTMLButtonElement>("#environment-lab-load");
        const status = document.querySelector("#environment-lab-status")?.textContent ?? "";
        const source = document.querySelector("#environment-lab-source")?.textContent ?? "";
        return mode?.value === "foliage" && selection?.value === id && load !== null && !load.disabled
          && /^1 foliage instances\b/.test(status) && status.includes("1 model files loaded")
          && !/loading/i.test(status) && source.includes(id);
      }, id, { timeout: remaining(2_000), polling: 50 });
      const assetSample: Record<string, unknown> = { assetId: id, source, stages: [] };
      samples.push(assetSample);
      const stages = assetSample.stages as Record<string, unknown>[];
      let baseline: Observation | undefined;
      let baselineGeometry: unknown;
      for (const phase of ["near", "far", "return"] as const) {
        remaining(1);
        stage = `${id}: ${phase}`;
        await pose(Boolean(treeSpeciesForAsset(id)), phase === "far");
        const observation = await observe();
        const sample: Record<string, unknown> = { phase, observation };
        stages.push(sample);
        const geometry = validate(observation, source, phase === "far");
        sample.geometry = geometry;
        if (baseline) {
          assert.deepEqual(geometry.colour, baselineGeometry, "Source colour geometry changed across distance");
          assert.deepEqual(observation.bounds, baseline.bounds, "Native placement bounds changed during the same-instance sweep");
          assert.deepEqual(observation.foliageObjects, baseline.foliageObjects, "Instance mesh population changed across distance");
          assert.deepEqual(observation.state, baseline.state, "The held source fixture changed across distance");
        } else { baseline = observation; baselineGeometry = geometry.colour; }
        if (CAPTURE.has(id) && phase !== "return") {
          remaining(5_000);
          const screenshot = await driver.screenshot(output, `${id}-${phase}`);
          screenshots.push(screenshot);
          sample.screenshot = screenshot;
        }
        assert(!requests.some((request) => /_far\.glb(?:[?#]|$)/i.test(request)), "The production runtime requested an alternate _far GLB");
      }
      assert(requests.some((request) => new URL(request).pathname.endsWith(`/${source.file}`)), `The native ${id} GLB was never requested by the game`);
    }
    report.runtimeErrors = await driver.callDebug("getErrors");
    assert.deepEqual(report.runtimeErrors, []);
    assert.equal(driver.consoleErrors.length + driver.pageErrors.length + driver.requestErrors.length, 0, "Runtime or asset request errors occurred");
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentTimeOrigin);
    assert.equal(screenshots.length, 8);
    report.status = "passed";
    report.passed = true;
  } catch (error) {
    report.failedStage = stage;
    report.assetId = assetId;
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page && Date.now() - started < 40_000) {
      try { report.failureObservation = await observe(); } catch (failure) { report.failureObservationError = String(failure); }
      try { screenshots.push(await driver.screenshot(output, "failure")); } catch { /* Keep the original assertion. */ }
    }
  } finally {
    report.elapsedMs = Date.now() - started;
    report.glbRequests = [...new Set(requests)];
    report.farRequests = requests.filter((request) => /_far\.glb(?:[?#]|$)/i.test(request));
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, elapsedMs: report.elapsedMs, report: path.join(output, "report.json"), error: report.error }));
    await driver.close();
    clearDeadline();
  }
}

await main();
