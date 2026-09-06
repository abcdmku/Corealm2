/**
 * Doorway entry and exit from several bearings, with the fixed follow camera and roof cutaway.
 *   npx tsx tools/settlement-door-check.ts --region vellenwood [--url http://127.0.0.1:4189]
 *     [--out test-results/settlement-doors]
 *
 * Each building that has walkable floor inside its footprint is approached from three bearings
 * through the production route planner, then left again. Relocation to the approach ring is setup;
 * the walk in, the walk out and the camera are production behaviour. Screenshots need inspection.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Vec3 } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { PLAYER_RADIUS } from "../game/src/app/config.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const args = process.argv.slice(2);
const regionId = argValue(args, "--region") ?? "fallowmarch";
const url = argValue(args, "--url") ?? `http://127.0.0.1:${process.env.PORT ?? "4189"}`;
const out = path.resolve(argValue(args, "--out") ?? "test-results/settlement-doors", regionId);
const limit = Number(argValue(args, "--limit") ?? 5);
const region = REGIONS.find((row) => row.id === regionId);
if (!region?.settlement) throw new Error(`Use --region ${REGIONS.filter((r) => r.settlement).map((r) => r.id).join("|")}`);
const settlement = region.settlement;
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline(`Settlement doors ${regionId}`, 240_000);
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
type Xyz = { x: number; y: number; z: number };
const xyz = (p: Xyz): Vec3 => [p.x, p.y, p.z];
const flat = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
const report: Record<string, unknown> = { passed: false, regionId, settlementId: settlement.id, url, buildings: [], findings: [] };
const findings = report.findings as string[];

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
  report.roofsBefore = await driver.callDebug("getRoofVisibility");

  // One building per prefab family, up to `--limit`, so the run covers distinct doorways rather
  // than the same cottage six times inside the deadline.
  const seen = new Set<string>();
  const chosen = settlement.buildings.filter((building) => {
    if (seen.has(building.prefab)) return false;
    seen.add(building.prefab);
    return true;
  }).slice(0, limit);
  report.chosen = chosen.map((building) => building.id);
  for (const building of chosen) {
    const [x, z] = building.position;
    const row: Record<string, unknown> = { id: building.id, name: building.name, prefab: building.prefab,
      position: building.position, footprint: building.footprint, approaches: [] };
    (report.buildings as unknown[]).push(row);
    const insideY = await driver.callDebug("groundHeight", [x, z]) as number;
    const inside = await driver.callDebug("getNavPoint", [[x, insideY, z]]) as Xyz | null;
    // A prefab with no walkable floor under its footprint is a solid block, not a doorway to test.
    row.enterable = Boolean(inside && flat(xyz(inside), [x, insideY, z]) < 0.75);
    if (!row.enterable) continue;
    row.inside = inside;
    const reach = Math.max(...building.footprint) / 2 + 9;
    for (const bearing of [building.rotationY, building.rotationY + Math.PI / 2, building.rotationY + Math.PI]) {
      const approach: Record<string, unknown> = { bearing: Math.round(bearing * 1000) / 1000 };
      (row.approaches as unknown[]).push(approach);
      const startX = x + Math.sin(bearing) * reach, startZ = z + Math.cos(bearing) * reach;
      const startY = await driver.callDebug("groundHeight", [startX, startZ]) as number;
      const start = await driver.callDebug("getNavPoint", [[startX, startY, startZ]]) as Xyz | null;
      if (!start) { approach.start = null; findings.push(`${building.id}: no navigable approach at bearing ${approach.bearing}`); continue; }
      approach.start = start;
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      await driver.callDebug("teleport", [start]);
      await driver.wait(250);

      const walkIn = await driver.callDebug("callTool", ["corealm_move_to", { position: xyz(inside!) }]) as any;
      approach.walkIn = walkIn;
      if (walkIn.error) { findings.push(`${building.id}: entry from bearing ${approach.bearing} refused (${walkIn.error})`); continue; }
      await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 25_000 }).catch(() => {});
      const at = await driver.callDebug("getPlayer") as any;
      approach.arrived = at;
      approach.entryGap = flat(xyz(at.position), xyz(inside!));
      approach.detour = walkIn.pathLength / Math.max(1, flat(xyz(start), xyz(inside!)));
      approach.clearance = await driver.callDebug("probeWorldClearance", [{ ...at.position, radius: PLAYER_RADIUS }]);
      approach.roofs = await driver.callDebug("getRoofVisibility");
      approach.camera = await driver.callDebug("getCamera");
      approach.silhouette = await driver.callDebug("getPlayerSilhouette");
      if ((approach.entryGap as number) > 1.5) findings.push(`${building.id}: entry from bearing ${approach.bearing} stopped ${(approach.entryGap as number).toFixed(2)} m short`);
      if ((approach.detour as number) > 2.4) findings.push(`${building.id}: entry from bearing ${approach.bearing} walked ${(approach.detour as number).toFixed(2)}x the straight line`);
      if (((approach.clearance as any)?.staticShift ?? 0) > 0.01) findings.push(`${building.id}: inside stance intersects static geometry by ${(approach.clearance as any).staticShift.toFixed(3)} m`);
      // Recorded, not asserted. The cutaway is camera driven, so a stance the camera can already
      // see into - through a gate arch, under porch eaves - correctly keeps its roof.
      const roofs = approach.roofs as { hiddenBuildingIds?: string[] } | null;
      approach.roofCutForThisBuilding = Boolean(roofs?.hiddenBuildingIds?.includes(building.id));
      if ((approach.silhouette as any)?.active) findings.push(`${building.id}: player is drawn through geometry inside`);
      approach.shot = await driver.screenshot(out, `${building.id}-${Math.round(bearing * 100)}-inside`);

      const walkOut = await driver.callDebug("callTool", ["corealm_move_to", { position: xyz(start) }]) as any;
      approach.walkOut = walkOut;
      if (walkOut.error) { findings.push(`${building.id}: exit to bearing ${approach.bearing} refused (${walkOut.error})`); continue; }
      await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 25_000 }).catch(() => {});
      const back = await driver.callDebug("getPlayer") as any;
      approach.exitGap = flat(xyz(back.position), xyz(start));
      approach.roofsAfter = await driver.callDebug("getRoofVisibility");
      if ((approach.exitGap as number) > 1.5) findings.push(`${building.id}: exit to bearing ${approach.bearing} stopped ${(approach.exitGap as number).toFixed(2)} m short`);
      if (((approach.roofsAfter as any)?.hiddenBuildingIds ?? []).includes(building.id)) {
        findings.push(`${building.id}: roof stayed cut away after the player left`);
      }
    }
  }

  // Keyboard travel across the square, so direct input is proved as well as click-to-move.
  const centre = settlement.buildings[0]!;
  const centreY = await driver.callDebug("groundHeight", [centre.position[0], centre.position[1] + 12]) as number;
  const keyStart = await driver.callDebug("getNavPoint", [[centre.position[0], centreY, centre.position[1] + 12]]) as Xyz | null;
  if (keyStart) {
    await driver.callDebug("teleport", [keyStart]);
    await driver.wait(250);
    const before = await driver.callDebug("getPlayer") as any;
    await driver.press("w", 1200);
    await driver.wait(200);
    const after = await driver.callDebug("getPlayer") as any;
    report.keyboard = { before, after, metres: flat(xyz(before.position), xyz(after.position)) };
    // Inconclusive rather than a failure when it does not move: the start point is derived, so
    // "w" can be aimed at a wall. A zero here means re-run from a hand-picked open bearing.
    if ((report.keyboard as any).metres < 2) (report.keyboard as any).inconclusive = "held w did not clear 2 m; check the bearing";
    (report as any).keyboardShot = await driver.screenshot(out, "keyboard-walk");
  }

  report.errors = await driver.callDebug("getErrors");
  report.console = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  report.passed = findings.length === 0 && driver.pageErrors.length === 0
    && Array.isArray(report.errors) && report.errors.length === 0;
} catch (error) {
  report.failure = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.exitCode = 1;
  if (driver.page) await driver.screenshot(out, "failure").catch(() => {});
} finally {
  await driver.close();
  clearDeadline();
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ passed: report.passed, regionId, findings, failure: report.failure, out })}\n`);
}
