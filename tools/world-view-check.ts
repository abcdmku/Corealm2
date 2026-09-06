/**
 * Ordinary player camera views of the coast, lakes and relief, for composition review.
 *   npx tsx tools/world-view-check.ts [--url http://127.0.0.1:4189] [--out test-results/world-views]
 *
 * Every view is the production follow camera behind a relocated player, not a detached inspector
 * pose, so what the capture shows is what a player standing there sees. Relocation is setup. The
 * report records terrain samples, scatter residency and console state; the images need inspection.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Vec3 } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const args = process.argv.slice(2);
const url = argValue(args, "--url") ?? `http://127.0.0.1:${process.env.PORT ?? "4189"}`;
const out = path.resolve(argValue(args, "--out") ?? "test-results/world-views");
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline("World coast and relief views", 300_000);
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
type Xyz = { x: number; y: number; z: number };
const report: Record<string, unknown> = { passed: false, url, views: [], findings: [] };
const findings = report.findings as string[];

/** Relief and settlement views a player reaches on foot, named for the report. */
const RELIEF: { name: string; x: number; z: number; yaw: number }[] = [
  { name: "karrowmoor-terraces", x: 140, z: -16, yaw: 2.4 },
  { name: "rockslide-landing", x: 108, z: -24, yaw: 1.2 },
  { name: "gorge-head", x: 104, z: 192, yaw: -0.6 },
  { name: "vellenwood-valley", x: 128, z: 84, yaw: 1.9 },
  { name: "highcairn-approach", x: 176, z: -114, yaw: 0.4 },
  { name: "coldbrace-mill-road", x: -160, z: -56, yaw: 0.2 },
];

try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
  await driver.open(50_000, "/index.html");
  await page.waitForFunction(() => (window as any).__gameDebug.getNavigationState().status === "ready", undefined, { timeout: 20_000 });
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
  if (!(typeof report.renderer === "string" && /D3D11|Direct3D11/i.test(report.renderer))) {
    throw new Error(`Hardware D3D11 required: ${report.renderer}`);
  }

  const capture = async (name: string, point: Vec3, yaw: number): Promise<void> => {
    const view: Record<string, unknown> = { name, requested: point, yaw };
    (report.views as unknown[]).push(view);
    const navPoint = await driver.callDebug("getNavPoint", [point]) as Xyz | null;
    if (!navPoint) { view.reachable = false; findings.push(`${name}: ${point[0].toFixed(0)},${point[2].toFixed(0)} is off the navmesh`); return; }
    view.reachable = true;
    view.navPoint = navPoint;
    view.snap = Math.hypot(navPoint.x - point[0], navPoint.z - point[2]);
    await driver.callDebug("teleport", [navPoint]);
    // Turn on the spot with real input so the follow camera settles behind the player.
    await driver.callDebug("inspectPose", [{ ...navPoint, yaw, pitch: 0.42, distance: 12, detached: false }]);
    await driver.wait(700);
    view.sample = await driver.callDebug("sampleWorld", [navPoint.x, navPoint.z]);
    view.ground = await driver.callDebug("groundHeight", [navPoint.x, navPoint.z]);
    view.camera = await driver.callDebug("getCamera");
    view.silhouette = await driver.callDebug("getPlayerSilhouette");
    view.shot = await driver.screenshot(out, name);
    if ((view.camera as any)?.occluded) findings.push(`${name}: follow camera is occluded from an ordinary standing position`);
    if ((view.silhouette as any)?.active) findings.push(`${name}: player is drawn through geometry here`);
  };

  // Walk outward from the gameplay rectangle on each cardinal until the sampler says the ground is
  // no longer playable, then step back onto the last dry metre. That is the real coastal edge.
  const bounds = { minX: -350, maxX: 350, minZ: -200, maxZ: 460 };
  const cardinals: { name: string; from: Vec3; step: [number, number]; yaw: number }[] = [
    { name: "coast-west", from: [bounds.minX + 4, 0, 130], step: [-4, 0], yaw: -Math.PI / 2 },
    { name: "coast-east", from: [bounds.maxX - 4, 0, 130], step: [4, 0], yaw: Math.PI / 2 },
    { name: "coast-south", from: [0, 0, bounds.minZ + 4], step: [0, -4], yaw: Math.PI },
    { name: "coast-north", from: [0, 0, bounds.maxZ - 4], step: [0, 4], yaw: 0 },
  ];
  for (const cardinal of cardinals) {
    let x = cardinal.from[0], z = cardinal.from[2], lastDry: [number, number] | null = null;
    for (let step = 0; step < 60; step++) {
      const sample = await driver.callDebug("sampleWorld", [x, z]) as { playable?: boolean } | null;
      if (!sample?.playable) break;
      lastDry = [x, z];
      x += cardinal.step[0]; z += cardinal.step[1];
    }
    if (!lastDry) { findings.push(`${cardinal.name}: no playable ground found walking outward`); continue; }
    const inlandX = lastDry[0] - cardinal.step[0] * 2, inlandZ = lastDry[1] - cardinal.step[1] * 2;
    const inlandY = await driver.callDebug("groundHeight", [inlandX, inlandZ]) as number;
    await capture(cardinal.name, [inlandX, inlandY, inlandZ], cardinal.yaw);
    (report.views as any[]).at(-1).shorelineReach = Math.hypot(lastDry[0], lastDry[1]);
  }

  const bodies = await driver.callDebug("getWaterBodies") as
    { id: string; level: number; contour: [number, number][] }[];
  report.waterBodies = bodies.map((body) => ({ id: body.id, level: body.level, points: body.contour.length }));
  for (const body of bodies) {
    // Stand a few metres outside the solved contour, looking back across the water.
    const centre = body.contour.reduce((sum, p) => [sum[0] + p[0] / body.contour.length, sum[1] + p[1] / body.contour.length], [0, 0]);
    const far = body.contour.reduce((best, p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])
      > Math.hypot(best[0] - centre[0], best[1] - centre[1]) ? p : best, body.contour[0]!);
    const dx = far[0] - centre[0], dz = far[1] - centre[1];
    const length = Math.hypot(dx, dz) || 1;
    const shoreX = far[0] + dx / length * 5, shoreZ = far[1] + dz / length * 5;
    const shoreY = await driver.callDebug("groundHeight", [shoreX, shoreZ]) as number;
    await capture(`lake-${body.id}`, [shoreX, shoreY, shoreZ], Math.atan2(centre[0] - shoreX, centre[1] - shoreZ));
  }

  for (const relief of RELIEF) {
    const y = await driver.callDebug("groundHeight", [relief.x, relief.z]) as number;
    await capture(relief.name, [relief.x, y, relief.z], relief.yaw);
  }

  report.errors = await driver.callDebug("getErrors");
  report.console = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  report.passed = driver.pageErrors.length === 0 && driver.consoleErrors.length === 0
    && Array.isArray(report.errors) && report.errors.length === 0;
} catch (error) {
  report.failure = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.exitCode = 1;
  if (driver.page) await driver.screenshot(out, "failure").catch(() => {});
} finally {
  await driver.close();
  clearDeadline();
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, findings, failure: report.failure, out })}\n`);
}
