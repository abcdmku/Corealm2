/**
 * Measures how every creature's walk actually reads, one production boot, one creature at a time.
 *
 * The report is "nearly all creatures fail at walking smoothly", which is broad enough that the
 * useful first move is to measure the whole roster rather than argue about one animal. Four things
 * can each produce that complaint on their own and they need different fixes, so all four are
 * sampled separately:
 *
 *   slide   the feet against the ground. A cycle authored at 0.75 m/s under a body the simulation
 *           moves at 3.1 is skating, whatever else is right. Source gait speed multiplied by
 *           drawn forward scale and playback rate is the feet's world speed. Compare that with the
 *           real ground speed; `render/entityViews.ts: motionTimeScale` exists to make them equal.
 *   turn    heading change per second. `systems/movement.ts` caps the PLAYER at 7 rad/s;
 *           `enemyAI.faceDirection` assigns `atan2` outright with no cap at all, so a creature can
 *           spin on the spot between two ticks. That reads as a jitter, not as a walk.
 *   ground  how far the creature's Y sits off the terrain under it.
 *   path    whether it is animating at all. A creature drawn from a BAKED pose is a frozen model
 *           sliding across the ground, and no playback rate can fix that one.
 *
 * It runs in the feature lab rather than the open world deliberately. The lab boots one small yard
 * and one creature, which is both reproducible and light enough to survive a loaded machine — the
 * open-world probe (`tools/animals/motion-quality.ts`) crashes the tab under memory pressure, and a
 * crashed tab measures nothing.
 *
 * Usage:
 *   npx tsx tools/creature-walk-probe.ts               # every creature preset
 *   npx tsx tools/creature-walk-probe.ts goat coyote   # only ids containing these
 */
import { chromium, type Browser, type Page } from "playwright";
import type { FeatureLabCatalog, FeatureLabState } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { CREATURE_SPECIES } from "../game/src/content/creatureSpecies.js";
import MANIFEST from "../game/public/assets/manifest.json" with { type: "json" };
import { installTestDeadline } from "./lib/deadline.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

const TOTAL_BUDGET_MS = Number(process.env["WALK_PROBE_BUDGET_MS"] ?? 600_000);
const READY_BUDGET_MS = 30_000;
const SAMPLES = 26;
const SAMPLE_INTERVAL_MS = 90;

/** Slide above this fraction of ground speed is what a player calls skating. */
const SLIDE_TOLERANCE = 0.25;
/** The player's own cap in `systems/movement.ts`, in degrees per second, as the reference. */
const PLAYER_TURN_CAP_DEG = (7 * 180) / Math.PI;

interface Sample {
  /** Real elapsed milliseconds since the previous sample. NOT assumed from the requested interval. */
  atMs: number;
  x: number;
  z: number;
  y: number;
  ground: number;
  simYaw: number;
  drawnYaw: number;
  timeScale: number | null;
  /** Renderer scale * build[2] * scaleAxes[2], including tier and boss scale. */
  drawnStrideScale: number | null;
  motion: string | null;
  clip: string | null;
  path: string | null;
}

interface WalkReport {
  presetId: string;
  label: string;
  impliedWalkMps: number | null;
  impliedRunMps: number | null;
  moveSpeedMps: number | null;
  samples: number;
  paths: string[];
  motions: string[];
  clips: string[];
  timeScale: number | null;
  drawnStrideScale: number | null;
  /** Median ground speed while actually moving, m/s. */
  groundSpeed: number;
  /** What the feet imply at the applied playback rate, m/s. */
  footSpeed: number | null;
  /** |ground - foot| / ground. 0 is planted, 1 is the feet contributing nothing. */
  slide: number | null;
  simTurnDegPerSec: { median: number; p90: number; max: number };
  drawnTurnDegPerSec: { median: number; p90: number; max: number };
  groundOffset: { median: number; max: number };
  verdict: string[];
}

const started = performance.now();
const clearDeadline = installTestDeadline("creature walk probe", TOTAL_BUDGET_MS);
const filters = process.argv.slice(2);
let server: RunningGameServer | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

try {
  server = await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
  await page.goto(new URL("/index.html?mode=combat", ensureUrl(server.url)).href, {
    waitUntil: "domcontentloaded",
    timeout: READY_BUDGET_MS,
  });
  await waitForState(page, "lab readiness", (state) => state.ready && state.target !== null, READY_BUDGET_MS);

  const catalog = await readCatalog(page);
  const presets = catalog.targets.creature.filter(
    (preset) => filters.length === 0 || filters.some((needle) => preset.id.includes(needle)),
  );
  if (presets.length === 0) throw new Error("no creature presets matched");

  // A low combat level so a provoked animal survives long enough to walk. At the lab's default 99
  // a swing kills a tier 1 animal outright and the sample is a corpse.
  await page.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    for (const skill of ["melee", "magic"] as const) api.setLevel(skill, 1);
  });
  await page.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.equipPlayer("mainHand", null);
  });

  const reports: WalkReport[] = [];
  for (const preset of presets) {
    try {
      reports.push(await probe(page, preset.id, preset.label));
    } catch (cause) {
      console.error(`SKIPPED ${preset.id}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  reports.sort((a, b) => (b.slide ?? -1) - (a.slide ?? -1));
  const header = `${"creature".padEnd(24)} ${"path".padEnd(14)} ${"ground".padStart(7)} ${"feet".padStart(7)} ${"scaleZ".padStart(7)} ${"slide".padStart(6)}  ${"turn p90".padStart(9)}  ${"off".padStart(5)}  notes`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of reports) {
    console.log(
      `${row.presetId.padEnd(24)} ${(row.paths.join("/") || "-").padEnd(14)}`
      + ` ${row.groundSpeed.toFixed(2).padStart(7)}`
      + ` ${(row.footSpeed === null ? "-" : row.footSpeed.toFixed(2)).padStart(7)}`
      + ` ${(row.drawnStrideScale === null ? "-" : row.drawnStrideScale.toFixed(3)).padStart(7)}`
      + ` ${(row.slide === null ? "-" : `${Math.round(row.slide * 100)}%`).padStart(6)}`
      + `  ${row.drawnTurnDegPerSec.p90.toFixed(0).padStart(9)}`
      + `  ${row.groundOffset.median.toFixed(2).padStart(5)}`
      + `  ${row.verdict.join("; ")}`,
    );
  }

  const skating = reports.filter((row) => row.slide !== null && row.slide > SLIDE_TOLERANCE);
  const spinning = reports.filter((row) => row.drawnTurnDegPerSec.p90 > PLAYER_TURN_CAP_DEG);
  const frozen = reports.filter((row) => !row.paths.includes("live-rig"));
  console.log("");
  console.log(`${reports.length} creatures probed in ${Math.round((performance.now() - started) / 1000)} s`);
  console.log(`  skating (slide over ${Math.round(SLIDE_TOLERANCE * 100)}%): ${skating.length}  ${skating.map((r) => r.presetId).join(", ")}`);
  console.log(`  turning faster than the player's ${PLAYER_TURN_CAP_DEG.toFixed(0)} deg/s cap: ${spinning.length}  ${spinning.map((r) => r.presetId).join(", ")}`);
  console.log(`  never got a live rig: ${frozen.length}  ${frozen.map((r) => r.presetId).join(", ")}`);
} finally {
  clearDeadline();
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
}

async function probe(targetPage: Page, presetId: string, label: string): Promise<WalkReport> {
  await targetPage.evaluate(async (id) => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.spawnTarget("creature", id, { distance: 5 });
  }, presetId);
  const spawned = await waitForState(targetPage, `${presetId} spawns`, (state) => (
    state.target?.presetId === presetId && state.target?.ai !== null
  ));
  const entityId = spawned.target?.entityId ?? "";

  // Provoke, then run. A passive animal never moves otherwise, and the point is to measure a walk.
  await targetPage.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("attack");
  });
  await waitForState(targetPage, `${presetId} engages`, (state) => (
    state.target?.ai?.state === "aggro"
  ), 6_000).catch(() => spawned);
  await targetPage.evaluate(async () => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    await api.perform("flee");
  });

  const samples = await targetPage.evaluate(async (args: {
    id: string; count: number; intervalMs: number;
  }) => {
    const debug = (window as unknown as {
      __gameDebug?: {
        getEntityMotion(id: string): Record<string, unknown> | null;
        groundHeight(x: number, z: number): number;
      };
    }).__gameDebug;
    if (!debug) throw new Error("__gameDebug is unavailable");
    const out: unknown[] = [];
    for (let index = 0; index < args.count; index += 1) {
      await new Promise((resolve) => { setTimeout(resolve, args.intervalMs); });
      const motion = debug.getEntityMotion(args.id);
      if (!motion) continue;
      const semantic = motion["semanticPosition"] as number[] | undefined;
      if (!semantic) continue;
      out.push({
        // `setTimeout` is a floor, not a schedule. On a loaded machine a requested 90 ms lands at
        // 300, and dividing a real 300 ms of travel by an assumed 90 reports the creature moving
        // 3.3x faster than it does — which is exactly the phantom "every animal is 3.33x too fast"
        // this probe produced before it timestamped its own samples.
        atMs: performance.now(),
        x: semantic[0], y: semantic[1], z: semantic[2],
        ground: debug.groundHeight(semantic[0]!, semantic[2]!),
        simYaw: motion["semanticRotationY"],
        drawnYaw: motion["drawnRotationY"],
        timeScale: motion["timeScale"],
        drawnStrideScale: typeof motion["drawnStrideScale"] === "number"
          && Number.isFinite(motion["drawnStrideScale"])
          && Math.abs(motion["drawnStrideScale"]) > 1e-6
          ? Math.abs(motion["drawnStrideScale"]) : null,
        motion: motion["motion"],
        clip: motion["clip"],
        path: motion["path"],
      });
    }
    return out as Sample[];
  }, { id: entityId, count: SAMPLES, intervalMs: SAMPLE_INTERVAL_MS });

  return summarise(
    presetId,
    label,
    samples,
    impliedGaitsFor(presetId),
    spawned.target?.ai?.moveSpeedMps ?? null,
  );
}

function summarise(
  presetId: string,
  label: string,
  samples: Sample[],
  implied: { walk: number | null; run: number | null },
  moveSpeedMps: number | null,
): WalkReport {
  const speeds: number[] = [];
  const simTurns: number[] = [];
  const drawnTurns: number[] = [];
  const offsets: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1]!;
    const b = samples[index]!;
    const dt = (b.atMs - a.atMs) / 1000;
    if (dt <= 0) continue;
    const speed = Math.hypot(b.x - a.x, b.z - a.z) / dt;
    offsets.push(Math.abs(b.y - b.ground));
    // Only frames where it is actually walking say anything about a walk cycle. Standing still with
    // a walk clip is a different bug and would drag every median toward zero.
    if (speed < 0.2) continue;
    speeds.push(speed);
    if (Number.isFinite(a.simYaw) && Number.isFinite(b.simYaw)) {
      simTurns.push((wrap(b.simYaw - a.simYaw) / dt * 180) / Math.PI);
    }
    if (Number.isFinite(a.drawnYaw) && Number.isFinite(b.drawnYaw)) {
      drawnTurns.push((wrap(b.drawnYaw - a.drawnYaw) / dt * 180) / Math.PI);
    }
  }

  // Since the walk/run split, a provoked creature chases on its RUN cycle, so the slide check has
  // to retime against the gait the samples actually show — scoring a run's ground speed against
  // the walk cycle's implied metres-per-cycle reported phantom slide on every healthy creature.
  const locomoting = samples.filter((s) => s.motion === "walk" || s.motion === "run");
  const gait = locomoting.at(-1);
  const timeScale = gait?.timeScale ?? null;
  const drawnStrideScale = gait?.drawnStrideScale ?? null;
  const groundSpeed = median(speeds);
  const impliedGait = gait?.motion === "run" ? implied.run ?? implied.walk : implied.walk;
  // Manifest speeds are source-model metres. Use the renderer's actual forward transform, which
  // already includes placement/tier scale and the entity's build; multiplying tier again is wrong.
  const footSpeed = impliedGait !== null && timeScale !== null && drawnStrideScale !== null
    ? impliedGait * drawnStrideScale * timeScale : null;
  const slide = footSpeed !== null && groundSpeed > 0.2
    ? Math.abs(groundSpeed - footSpeed) / groundSpeed
    : null;

  const verdict: string[] = [];
  const paths = [...new Set(samples.map((s) => s.path).filter((p): p is string => Boolean(p)))];
  if (samples.length === 0) verdict.push("NO SAMPLES");
  else if (speeds.length === 0) verdict.push("never moved");
  if (!paths.includes("live-rig")) verdict.push("NOT ANIMATED");
  if (locomoting.length === 0 && speeds.length > 0) verdict.push("moved without a locomotion clip");
  if (locomoting.length > 0 && drawnStrideScale === null) verdict.push("drawn stride scale unavailable");
  if (slide !== null && slide > SLIDE_TOLERANCE) verdict.push(`${Math.round(slide * 100)}% foot slide`);
  const drawnP90 = percentile(drawnTurns.map(Math.abs), 0.9);
  if (drawnP90 > PLAYER_TURN_CAP_DEG) verdict.push(`turns ${drawnP90.toFixed(0)} deg/s`);
  if (median(offsets) > 0.25) verdict.push(`${median(offsets).toFixed(2)} m off the ground`);

  return {
    presetId,
    label,
    impliedWalkMps: implied.walk,
    impliedRunMps: implied.run,
    moveSpeedMps,
    samples: samples.length,
    paths,
    motions: [...new Set(samples.map((s) => s.motion).filter((m): m is string => Boolean(m)))],
    clips: [...new Set(samples.map((s) => s.clip).filter((c): c is string => Boolean(c)))],
    timeScale,
    drawnStrideScale,
    groundSpeed,
    footSpeed,
    slide,
    simTurnDegPerSec: spread(simTurns.map(Math.abs)),
    drawnTurnDegPerSec: spread(drawnTurns.map(Math.abs)),
    groundOffset: { median: median(offsets), max: offsets.length ? Math.max(...offsets) : 0 },
    verdict: verdict.length > 0 ? verdict : ["ok"],
  };
}

/**
 * The ground speeds the creature's own cycles imply, straight out of the manifest.
 *
 * Resolved in Node rather than in the page because the manifest is already a build input here and
 * the browser has no lookup for it. Presets use enemy group IDs, dungeon-prefixed group IDs, or
 * `species:<id>`, matching the keys `featureLab/catalog.ts` builds.
 */
function impliedGaitsFor(presetId: string): { walk: number | null; run: number | null } {
  const groups = REGIONS.flatMap((region) => [
    ...region.enemyGroups.map((group) => [group.id, group.assetId] as const),
    ...(region.dungeon?.enemyGroups ?? []).map(
      (group) => [`${region.dungeon!.id}:${group.id}`, group.assetId] as const,
    ),
  ]);
  const assetId = groups.find(([id]) => id === presetId)?.[1]
    ?? CREATURE_SPECIES.find((species) => `species:${species.id}` === presetId)?.assetId;
  if (assetId === undefined) return { walk: null, run: null };
  const asset = MANIFEST.assets.find((row) => row.id === assetId) as
    { impliedWalkMps?: number; impliedRunMps?: number } | undefined;
  return { walk: asset?.impliedWalkMps ?? null, run: asset?.impliedRunMps ?? null };
}

function wrap(delta: number): number {
  let value = delta;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

function spread(values: number[]): { median: number; p90: number; max: number } {
  return {
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    max: values.length ? Math.max(...values) : 0,
  };
}

async function readCatalog(targetPage: Page): Promise<FeatureLabCatalog> {
  return targetPage.evaluate(() => {
    const api = window.__featureLab;
    if (!api) throw new Error("window.__featureLab is unavailable");
    return api.getCatalog();
  });
}

async function waitForState(
  targetPage: Page,
  labelText: string,
  predicate: (state: FeatureLabState) => boolean,
  timeoutMs = 10_000,
): Promise<FeatureLabState> {
  const deadline = performance.now() + timeoutMs;
  let state: FeatureLabState | null = null;
  while (performance.now() < deadline) {
    try {
      state = await targetPage.evaluate(() => {
        const api = window.__featureLab;
        if (!api) throw new Error("window.__featureLab is unavailable");
        return api.getState();
      });
      if (predicate(state)) return state;
    } catch {
      // The lab API appears a moment after domcontentloaded; treat that window as pending.
    }
    await targetPage.waitForTimeout(40);
  }
  throw new Error(`${labelText} did not settle in ${timeoutMs}ms`);
}

function ensureUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
