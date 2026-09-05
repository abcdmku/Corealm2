/**
 * Photographs every production structure recipe in the building feature lab, one at a time.
 *
 * This is a review instrument, not a gate. It boots one Vite server and one Chromium page in
 * `mode=building`, then walks the whole prefab-variant, composition and wall-run space through the
 * production `window.__featureLab` setup API. Each selection is captured from a fixed set of orbit
 * poses so joinery, ground contact and part alignment can be inspected without hand-driving the
 * lab. Output is disposable: screenshots plus one JSON manifest under `test-results/`.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type {
  FeatureLabState,
  FeatureLabStructureSelection,
  FeatureLabStructureView,
} from "../game/src/contracts.js";
import {
  BUILDING_KITS,
  COMPOSITION_IDS,
  KIT_IDS,
  PREFAB_IDS,
  type PrefabId,
} from "../game/src/render/buildings.js";
import { structureVariantCount } from "../game/src/render/structures/catalog.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot, safeName } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

const READY_BUDGET_MS = 60_000;
const REBUILD_BUDGET_MS = 30_000;
const SCREENSHOT_TIMEOUT_MS = 120_000;

/** Footprints the authored world actually places, so the sweep reviews shipped geometry. */
const SWEEP_FOOTPRINTS: Readonly<Record<PrefabId, readonly [number, number]>> = {
  cottage: [6, 4],
  townhouse: [6, 4],
  hall: [12, 6],
  tower: [6, 6],
  stall: [3, 2],
  wall_segment: [8, 2],
  gatehouse: [8, 4],
  shed: [4, 4],
  ruin: [6, 4],
  quarry_hut: [6, 4],
  forge: [6, 5],
  porch: [4, 3],
  arcade: [6, 3],
  market_row: [9, 3],
  well: [2, 2],
  farmstead: [10, 6],
};

interface AnglePose {
  readonly name: string;
  /** Yaw offset in radians from the fitted front pose. */
  readonly yawOffset: number;
  readonly pitch: number;
  /** Multiplier applied to the fitted viewing distance. */
  readonly distanceScale: number;
  /** Stands the production player rig beside the structure as a scale reference. */
  readonly showPlayer?: boolean;
}

const ANGLES: readonly AnglePose[] = [
  { name: "a-front", yawOffset: -0.62, pitch: 0.44, distanceScale: 1 },
  { name: "b-rear", yawOffset: Math.PI + 0.62, pitch: 0.44, distanceScale: 1 },
  { name: "c-eye", yawOffset: -0.62, pitch: 0.16, distanceScale: 0.66 },
  { name: "d-scale", yawOffset: -0.32, pitch: 0.3, distanceScale: 0.86, showPlayer: true },
];

/** The lab HUD covers a quarter of the frame; a review capture wants the scene alone. */
const HIDE_UI_CSS = "#ui-root { display: none !important; }";

interface SweepCase {
  readonly key: string;
  readonly group: string;
  readonly selection: FeatureLabStructureSelection;
}

interface SweepRecord {
  readonly key: string;
  readonly group: string;
  readonly selection: FeatureLabStructureSelection;
  readonly variant: string | null;
  readonly partCount: number;
  readonly assetCount: number;
  readonly collisionCount: number;
  readonly bounds: FeatureLabStructureView["bounds"];
  readonly size: { x: number; y: number; z: number } | null;
  readonly buildMs: number;
  readonly shots: string[];
  readonly errors: string[];
}

const args = process.argv.slice(2);
const outDir = path.resolve(repoRoot, argValue(args, "--out") ?? path.join("test-results", "structure-sweep"));
const only = (argValue(args, "--only") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const groupFilter = (argValue(args, "--group") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const limit = Number(argValue(args, "--limit") ?? Number.POSITIVE_INFINITY);
const angleFilter = (argValue(args, "--angles") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const shotWidth = Number(argValue(args, "--width") ?? 1200);
const shotHeight = Number(argValue(args, "--height") ?? 800);
const headed = args.includes("--headed");
const asJpeg = !args.includes("--png");
const jpegQuality = Number(argValue(args, "--quality") ?? 88);
const deadlineMs = Number(argValue(args, "--deadline") ?? 3_600_000);

/** `--shard 2/4` renders every fourth case, so several sweeps can share one output directory. */
const shard = (argValue(args, "--shard") ?? "1/1").split("/").map((value) => Number(value.trim()));
const shardCount = Number.isFinite(shard[1]) && (shard[1] ?? 0) > 0 ? shard[1]! : 1;
const shardIndex = Math.min(shardCount - 1, Math.max(0, (Number.isFinite(shard[0]) ? shard[0]! : 1) - 1));

const angles = angleFilter.length > 0
  ? ANGLES.filter((angle) => angleFilter.includes(angle.name) || angleFilter.includes(angle.name.slice(2)))
  : ANGLES;

function buildCases(): SweepCase[] {
  const cases: SweepCase[] = [];
  for (const prefab of PREFAB_IDS) {
    const footprint = SWEEP_FOOTPRINTS[prefab];
    for (const kit of KIT_IDS) {
      const variants = Math.max(1, structureVariantCount(prefab, footprint, BUILDING_KITS[kit]));
      for (let seed = 0; seed < variants; seed += 1) {
        cases.push({
          key: `prefab-${prefab}-${kit}-s${seed}`,
          group: `prefab:${prefab}`,
          selection: {
            kind: "prefab", id: prefab, kit, width: footprint[0], depth: footprint[1], seed,
          },
        });
      }
    }
  }
  for (const composition of COMPOSITION_IDS) {
    for (const kit of KIT_IDS) {
      cases.push({
        key: `composition-${composition}-${kit}`,
        group: `composition:${composition}`,
        selection: { kind: "composition", id: composition, kit, width: 6, depth: 4, seed: 3 },
      });
    }
  }
  for (const kit of KIT_IDS) {
    for (const size of [[10, 4], [18, 6]] as const) {
      cases.push({
        key: `wall-run-${kit}-w${size[0]}-o${size[1]}`,
        group: "wall-run",
        selection: { kind: "wall-run", id: "wall_run", kit, width: size[0], depth: size[1], seed: 2 },
      });
    }
  }
  return cases;
}

function selectCases(cases: readonly SweepCase[]): SweepCase[] {
  const matches = cases.filter((entry, index) => {
    if (groupFilter.length > 0 && !groupFilter.some((value) => entry.group.includes(value))) return false;
    if (only.length > 0 && !only.some((value) => entry.key.includes(value))) return false;
    // Round-robin sharding keeps every shard's mix of rebuild costs roughly even.
    if (shardCount > 1 && index % shardCount !== shardIndex) return false;
    return true;
  });
  return Number.isFinite(limit) ? matches.slice(0, limit) : matches;
}

async function waitForLab(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const debug = window.__gameDebug as { ready?: () => boolean } | undefined;
      return window.__featureLab?.getState().ready === true && debug?.ready?.() === true;
    },
    undefined,
    { timeout: READY_BUDGET_MS },
  );
}

async function applySelection(
  page: Page,
  selection: FeatureLabStructureSelection,
): Promise<FeatureLabState> {
  return page.evaluate(async (patch) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    const state = await api.setStructure(patch);
    return JSON.parse(JSON.stringify(state)) as FeatureLabState;
  }, selection);
}

/** Reproduces the lab's own fit maths so each pose keeps the whole structure framed. */
function viewingDistance(view: FeatureLabStructureView): number {
  const bounds = view.bounds;
  const spanX = bounds ? bounds.max[0] - bounds.min[0] : view.selection.width;
  const spanY = bounds ? bounds.max[1] - bounds.min[1] : 3.123;
  const spanZ = bounds ? bounds.max[2] - bounds.min[2] : view.selection.depth;
  return Math.max(14, Math.min(40, Math.max(spanX, spanY * 1.4, spanZ) * 1.25));
}

async function pose(page: Page, view: FeatureLabStructureView, angle: AnglePose): Promise<void> {
  const bounds = view.bounds;
  const centreX = bounds ? (bounds.min[0] + bounds.max[0]) / 2 : -8;
  const centreZ = bounds ? (bounds.min[2] + bounds.max[2]) / 2 : 12;
  const centreY = bounds ? (bounds.min[1] + bounds.max[1]) / 2 : 1.5;
  const spanX = bounds ? bounds.max[0] - bounds.min[0] : view.selection.width;
  const spanZ = bounds ? bounds.max[2] - bounds.min[2] : view.selection.depth;
  const distance = viewingDistance(view) * angle.distanceScale;
  // Free-camera focus stays on the structure centre, so the standing point only moves the rig.
  const standX = angle.showPlayer ? centreX + spanX / 2 + 1.4 : centreX;
  const standZ = angle.showPlayer ? centreZ - spanZ / 2 - 1.4 : centreZ;
  await page.evaluate((request) => {
    const debug = window.__gameDebug as {
      inspectPose?: (pose: typeof request.pose) => boolean;
    } | undefined;
    if (!debug?.inspectPose) throw new Error("window.__gameDebug.inspectPose is unavailable");
    debug.inspectPose(request.pose);
    window.__featureLab?.setPlayerVisible(request.showPlayer);
  }, {
    pose: {
      x: standX,
      y: centreY,
      z: standZ,
      yaw: Math.PI + angle.yawOffset,
      pitch: angle.pitch,
      distance,
    },
    showPlayer: angle.showPlayer === true,
  });
  await page.waitForTimeout(160);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const clearDeadline = installTestDeadline("structure sweep", deadlineMs);
let server: RunningGameServer | null = null;
let browser: Browser | null = null;
const consoleErrors: string[] = [];
const records: SweepRecord[] = [];

try {
  const cases = selectCases(buildCases());
  await mkdir(outDir, { recursive: true });
  server = await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: !headed,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({
    viewport: { width: shotWidth, height: shotHeight },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  page.on("pageerror", (error) => consoleErrors.push((error.stack ?? error.message).slice(0, 400)));

  await page.goto(`${server.url}/index.html?mode=building`, { waitUntil: "load", timeout: READY_BUDGET_MS });
  await waitForLab(page);
  if (!args.includes("--keep-ui")) await page.addStyleTag({ content: HIDE_UI_CSS });
  await page.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    api.setPlayerVisible(false);
    api.setWalkingEnabled(false);
    api.setFreeCameraEnabled(true);
  });

  let index = 0;
  for (const entry of cases) {
    index += 1;
    const before = consoleErrors.length;
    const shots: string[] = [];
    let state: FeatureLabState;
    try {
      state = await Promise.race([
        applySelection(page, entry.selection),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("structure rebuild timed out")), REBUILD_BUDGET_MS);
          timer.unref();
        }),
      ]);
    } catch (cause) {
      records.push({
        key: entry.key,
        group: entry.group,
        selection: entry.selection,
        variant: null,
        partCount: 0,
        assetCount: 0,
        collisionCount: 0,
        bounds: null,
        size: null,
        buildMs: 0,
        shots: [],
        errors: [String(cause)],
      });
      process.stdout.write(`! ${entry.key}: ${String(cause)}\n`);
      continue;
    }
    const view = state.structure;
    // Editing a recipe while a sweep is running makes Vite hot-reload the document out from under
    // it, which drops `window.__gameDebug`. Wait the lab back up rather than losing the run.
    const apiPresent = await page.evaluate(() => {
      const debug = window.__gameDebug as { inspectPose?: unknown } | undefined;
      return typeof debug?.inspectPose === "function";
    });
    if (!apiPresent) {
      process.stdout.write("  (page reloaded; waiting for the lab and rebuilding)\n");
      await waitForLab(page);
      if (!args.includes("--keep-ui")) await page.addStyleTag({ content: HIDE_UI_CSS });
      await page.evaluate(() => {
        const api = window.__featureLab;
        api?.setPlayerVisible(false);
        api?.setWalkingEnabled(false);
        api?.setFreeCameraEnabled(true);
      });
      await applySelection(page, entry.selection);
    }
    await page.evaluate(() => window.__featureLab?.fitStructure());
    for (const angle of angles) {
      await pose(page, view, angle);
      const file = path.join(outDir, `${safeName(`${entry.key}-${angle.name}`)}.${asJpeg ? "jpg" : "png"}`);
      await page.screenshot(asJpeg
        ? {
          path: file, type: "jpeg", quality: jpegQuality,
          timeout: SCREENSHOT_TIMEOUT_MS, animations: "disabled",
        }
        : { path: file, type: "png", timeout: SCREENSHOT_TIMEOUT_MS, animations: "disabled" });
      shots.push(path.relative(repoRoot, file).replaceAll("\\", "/"));
    }
    const bounds = view.bounds;
    records.push({
      key: entry.key,
      group: entry.group,
      selection: view.selection,
      variant: view.variant,
      partCount: view.partCount,
      assetCount: view.assetCount,
      collisionCount: view.collisionCount,
      bounds,
      size: bounds
        ? {
          x: round3(bounds.max[0] - bounds.min[0]),
          y: round3(bounds.max[1] - bounds.min[1]),
          z: round3(bounds.max[2] - bounds.min[2]),
        }
        : null,
      buildMs: Math.round(view.buildMs),
      shots,
      errors: [...state.errors, ...consoleErrors.slice(before)],
    });
    process.stdout.write(
      `[${index}/${cases.length}] ${entry.key} variant=${view.variant ?? "classic"} `
      + `parts=${view.partCount} collision=${view.collisionCount}\n`,
    );
  }

  const manifest = {
    generatedBy: "tools/structure-sweep.ts",
    viewport: { width: shotWidth, height: shotHeight },
    angles: angles.map((angle) => angle.name),
    caseCount: records.length,
    shotCount: records.reduce((total, record) => total + record.shots.length, 0),
    records,
  };
  const manifestName = shardCount > 1 ? `manifest-${shardIndex + 1}of${shardCount}.json` : "manifest.json";
  await writeFile(path.join(outDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`\nWrote ${manifest.shotCount} screenshots for ${manifest.caseCount} structures to ${outDir}\n`);
} finally {
  clearDeadline();
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
}
