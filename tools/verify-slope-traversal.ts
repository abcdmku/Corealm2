import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Vec3 } from "../game/src/contracts.js";
import { PLAYER_SLOPES } from "../game/src/app/config.js";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { repoRoot } from "./lib/paths.js";

interface Candidate {
  angle: number;
  high: Vec3;
  low: Vec3;
  regionId: string | null;
}

interface ToolResult {
  error?: string;
  message?: string;
  nextSeq?: number;
  events?: Array<{ type?: string; data?: unknown }>;
}

interface SlopeReport {
  passed: boolean;
  candidate: Candidate | null;
  navPath: Vec3[] | null;
  descent: {
    started: unknown;
    event: string | null;
    before: Vec3 | null;
    after: Vec3 | null;
    distanceToTarget: number | null;
  };
  ascent: {
    started: unknown;
    event: string | null;
    before: Vec3 | null;
    after: Vec3 | null;
    distanceToTarget: number | null;
  };
  screenshot: string | null;
  errors: { console: string[]; page: string[]; requests: string[] };
}

const SAMPLE_STEP = 2;
const MIN_PROBE_ANGLE = 30;
const MAX_PROBE_ANGLE = PLAYER_SLOPES.maxAscentAngle - 1;
const MAX_PATH_METRES = 4.5;
const NAV_ENDPOINT_TOLERANCE = 0.75;

function point(value: unknown): Vec3 {
  const row = value as { x?: number; y?: number; z?: number };
  return [Number(row.x), Number(row.y), Number(row.z)];
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function pathLength(path: readonly Vec3[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += distanceXZ(path[index - 1]!, path[index]!);
  }
  return length;
}

function navPath(value: unknown): Vec3[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => point(entry));
}

async function tool(driver: GameDriver, name: string, args: unknown): Promise<ToolResult> {
  return await driver.callDebug("callTool", [name, args]) as ToolResult;
}

async function cursor(driver: GameDriver): Promise<number> {
  const result = await tool(driver, "corealm_events", { sinceSeq: 0, timeoutMs: 0 });
  return Number(result.nextSeq ?? 0);
}

async function waitForNavigation(driver: GameDriver, sinceSeq: number): Promise<string | null> {
  const result = await tool(driver, "corealm_events", {
    sinceSeq,
    types: ["navigation.completed", "navigation.failed"],
    timeoutMs: 10_000,
  });
  return result.events?.[0]?.type ?? null;
}

async function findCandidate(driver: GameDriver): Promise<{ candidate: Candidate; path: Vec3[] } | null> {
  const page = driver.page;
  if (!page) throw new Error("Slope verification needs an open Chromium page");
  const candidates = await page.evaluate(({ step, minAngle, maxAngle, endpointTolerance }) => {
    const debug = window.__gameDebug as unknown as {
      groundHeight(x: number, z: number): number;
      getNavPoint(point: Vec3): { x: number; y: number; z: number } | null;
      sampleWorld(x: number, z: number): {
        playable?: boolean;
        semanticRegion?: string;
        waterBodyId?: string | null;
      } | null;
    };
    const found: Candidate[] = [];
    const directions = [[step, 0], [0, step]] as const;
    for (let x = -498; x <= 498; x += step) {
      for (let z = -373; z <= 373; z += step) {
        const fromY = debug.groundHeight(x, z);
        if (!Number.isFinite(fromY)) continue;
        for (const [dx, dz] of directions) {
          const toY = debug.groundHeight(x + dx, z + dz);
          if (!Number.isFinite(toY)) continue;
          const angle = Math.atan(Math.abs(toY - fromY) / step) * 180 / Math.PI;
          if (angle < minAngle || angle > maxAngle) continue;
          const middle = debug.sampleWorld(x + dx / 2, z + dz / 2);
          if (!middle?.playable || middle.waterBodyId) continue;
          // Kilnhalt's volcanic-flow banks contain separate molten and dry surfaces. They are a
          // useful collision stress case but a terrible screenshot fixture because a valid lower
          // path can sit below the bank overhang and hide the ground being measured.
          if (middle.semanticRegion === "kilnhalt") continue;
          const first: Vec3 = [x, fromY, z];
          const second: Vec3 = [x + dx, toY, z + dz];
          const high = fromY > toY ? first : second;
          const low = fromY > toY ? second : first;
          const highNav = debug.getNavPoint(high);
          const lowNav = debug.getNavPoint(low);
          if (!highNav || !lowNav) continue;
          if (Math.hypot(highNav.x - high[0], highNav.z - high[2]) > endpointTolerance
            || Math.abs(highNav.y - high[1]) > endpointTolerance) continue;
          if (Math.hypot(lowNav.x - low[0], lowNav.z - low[2]) > endpointTolerance
            || Math.abs(lowNav.y - low[1]) > endpointTolerance) continue;
          found.push({
            angle,
            high,
            low,
            regionId: middle.semanticRegion ?? null,
          });
        }
      }
    }
    return found.sort((left, right) => {
      const leftPriority = left.regionId === "karrowmoor" ? 0 : 1;
      const rightPriority = right.regionId === "karrowmoor" ? 0 : 1;
      return leftPriority - rightPriority || right.angle - left.angle;
    }).slice(0, 300);
  }, {
    step: SAMPLE_STEP,
    minAngle: MIN_PROBE_ANGLE,
    maxAngle: MAX_PROBE_ANGLE,
    endpointTolerance: NAV_ENDPOINT_TOLERANCE,
  });

  for (const candidate of candidates) {
    const down = navPath(await driver.callDebug("getNavPath", [candidate.high, candidate.low]));
    const up = navPath(await driver.callDebug("getNavPath", [candidate.low, candidate.high]));
    if (!down || !up || down.length < 2 || up.length < 2) continue;
    if (pathLength(down) > MAX_PATH_METRES || pathLength(up) > MAX_PATH_METRES) continue;
    const downStart = down[0]!;
    const downEnd = down[down.length - 1]!;
    const upStart = up[0]!;
    const upEnd = up[up.length - 1]!;
    if (distanceXZ(downStart, candidate.high) > NAV_ENDPOINT_TOLERANCE
      || Math.abs(downStart[1] - candidate.high[1]) > NAV_ENDPOINT_TOLERANCE) continue;
    if (distanceXZ(downEnd, candidate.low) > NAV_ENDPOINT_TOLERANCE
      || Math.abs(downEnd[1] - candidate.low[1]) > NAV_ENDPOINT_TOLERANCE) continue;
    if (distanceXZ(upStart, candidate.low) > NAV_ENDPOINT_TOLERANCE
      || Math.abs(upStart[1] - candidate.low[1]) > NAV_ENDPOINT_TOLERANCE) continue;
    if (distanceXZ(upEnd, candidate.high) > NAV_ENDPOINT_TOLERANCE
      || Math.abs(upEnd[1] - candidate.high[1]) > NAV_ENDPOINT_TOLERANCE) continue;
    return { candidate, path: down };
  }
  return null;
}

export async function verifySlopeTraversal(): Promise<SlopeReport> {
  const urlIndex = process.argv.indexOf("--url");
  const externalUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;
  const server = externalUrl
    ? { url: externalUrl, close: async () => undefined }
    : await startGameServer({ logLevel: "error" });
  const routeIndex = process.argv.indexOf("--route");
  const route = routeIndex >= 0 ? process.argv[routeIndex + 1]! : "/";
  const driver = new GameDriver(server, { browserArgs: ["--use-angle=d3d11", "--mute-audio"] });
  const report: SlopeReport = {
    passed: false,
    candidate: null,
    navPath: null,
    descent: { started: null, event: null, before: null, after: null, distanceToTarget: null },
    ascent: { started: null, event: null, before: null, after: null, distanceToTarget: null },
    screenshot: null,
    errors: { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors },
  };

  try {
    await driver.launch();
    await driver.open(120_000, route);
    const found = await findCandidate(driver);
    if (!found) throw new Error("No short nav path crossed a real authored 30-63 degree terrain facet");
    report.candidate = found.candidate;
    report.navPath = found.path;

    await driver.callDebug("teleport", [found.candidate.high]);
    await driver.wait(150);
    report.descent.before = point(await driver.callDebug("getPlayerPosition"));
    const downCursor = await cursor(driver);
    report.descent.started = await tool(driver, "corealm_move_to", { position: found.candidate.low });
    report.descent.event = await waitForNavigation(driver, downCursor);
    report.descent.after = point(await driver.callDebug("getPlayerPosition"));
    report.descent.distanceToTarget = distanceXZ(report.descent.after, found.candidate.low);

    await driver.wait(400);
    const screenshotDir = path.join(repoRoot, "test-results", "movement-slope");
    await mkdir(screenshotDir, { recursive: true });
    report.screenshot = await driver.screenshot(screenshotDir, "steep-descent");

    await driver.callDebug("teleport", [found.candidate.low]);
    await driver.wait(150);
    report.ascent.before = point(await driver.callDebug("getPlayerPosition"));
    const upCursor = await cursor(driver);
    report.ascent.started = await tool(driver, "corealm_move_to", { position: found.candidate.high });
    report.ascent.event = await waitForNavigation(driver, upCursor);
    report.ascent.after = point(await driver.callDebug("getPlayerPosition"));
    report.ascent.distanceToTarget = distanceXZ(report.ascent.after, found.candidate.high);

    const descended = report.descent.event === "navigation.completed"
      && report.descent.distanceToTarget !== null
      && report.descent.distanceToTarget <= NAV_ENDPOINT_TOLERANCE;
    const climbed = report.ascent.event === "navigation.completed"
      && report.ascent.distanceToTarget !== null
      && report.ascent.distanceToTarget <= NAV_ENDPOINT_TOLERANCE;
    report.passed = descended
      && climbed
      && driver.consoleErrors.length === 0
      && driver.pageErrors.length === 0;
  } finally {
    await driver.close();
    await server.close();
  }

  const output = path.join(repoRoot, "test-results", "movement-slope", "report.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  void verifySlopeTraversal()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.passed) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
