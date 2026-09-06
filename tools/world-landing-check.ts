/**
 * Authored-world fishing landings: routed arrival, stance, casting and camera readability.
 *   npx tsx tools/world-landing-check.ts [--site blackwater_landing] [--url http://127.0.0.1:4189]
 *     [--out test-results/world-landings]
 *
 * One relocation per site is debug setup and is reported as such. The approach walk, the arrival
 * at each school and the cast itself all run through the production route planner, movement and
 * interaction dispatcher. Screenshots still need human inspection.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { WORLD_SITES } from "../game/src/content/worldSites.js";
import { fishingAccessPositions } from "../game/src/app/fishingAccess.js";
import { INTERACT_RANGE } from "../game/src/app/config.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const args = process.argv.slice(2);
const only = argValue(args, "--site");
const url = argValue(args, "--url") ?? `http://127.0.0.1:${process.env.PORT ?? "4189"}`;
const out = path.resolve(argValue(args, "--out") ?? "test-results/world-landings");
const fisheries = WORLD_SITES.filter((site) => site.kind === "fishery" && (!only || site.id === only));
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline("World fishing landings", 60_000 * Math.max(1, fisheries.length));
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
type Xyz = { x: number; y: number; z: number };
const xyz = (p: Xyz): Vec3 => [p.x, p.y, p.z];
const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
const report: Record<string, unknown> = { passed: false, url, sites: [], findings: [] };
const findings = report.findings as string[];
const locations = new Map(REGIONS.flatMap((region) => region.locations.map((row) => [row.id, row] as const)));

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
  await driver.callDebug("setSkillLevel", ["fishing", 60]);
  const waterBodies = await driver.callDebug("getWaterBodies") as
    { id: string; level: number; contour: [number, number][] }[];
  // The same solver the world builder uses, so the landing under test is the authored one.
  // `heightAt` only supplies the y of each point, which is resolved from the live terrain below.
  const access = fishingAccessPositions(WORLD_SITES, waterBodies, () => 0);
  report.accessPositions = Object.fromEntries(access);

  for (const site of fisheries) {
    const row: Record<string, unknown> = { id: site.id, locationId: site.locationId, schools: [] };
    (report.sites as unknown[]).push(row);
    const authored = access.get(site.locationId) ?? [
      locations.get(site.locationId)?.position[0] ?? site.centre[0], 0,
      locations.get(site.locationId)?.position[1] ?? site.centre[1],
    ] as Vec3;
    const authoredY = await driver.callDebug("groundHeight", [authored[0], authored[2]]) as number;
    row.authoredLanding = [authored[0], authoredY, authored[2]];
    const landing = await driver.callDebug("getNavPoint", [[authored[0], authoredY, authored[2]]]) as Xyz | null;
    if (!landing) { findings.push(`${site.id}: authored landing ${authored[0].toFixed(1)},${authored[2].toFixed(1)} is off the navmesh`); row.landing = null; continue; }
    row.landing = landing;
    row.landingSnap = Math.hypot(landing.x - authored[0], landing.z - authored[2]);
    if ((row.landingSnap as number) > 1) findings.push(`${site.id}: authored landing snaps ${(row.landingSnap as number).toFixed(2)} m to reach the navmesh`);

    // Setup only: stand 22 m back along the site's own approach bearing, then walk in for real.
    const bearing = site.rotationY;
    const backX = landing.x - Math.sin(bearing) * 22, backZ = landing.z - Math.cos(bearing) * 22;
    const startY = await driver.callDebug("groundHeight", [backX, backZ]) as number;
    const start = await driver.callDebug("getNavPoint", [[backX, startY, backZ]]) as Xyz | null ?? landing;
    await driver.callDebug("teleport", [xyz(start)]);
    await driver.wait(300);
    row.setupStart = start;

    const walk = await driver.callDebug("callTool", ["corealm_move_to", { locationId: site.locationId }]) as any;
    row.routedApproach = walk;
    if (walk.error) { findings.push(`${site.id}: routed travel to ${site.locationId} refused (${walk.error})`); continue; }
    await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 40_000 }).catch(() => {});
    const arrived = await driver.callDebug("getPlayer") as any;
    row.arrived = arrived;
    row.arrivalGap = gap(xyz(arrived.position), xyz(landing));
    if ((row.arrivalGap as number) > 3) findings.push(`${site.id}: routed travel stopped ${(row.arrivalGap as number).toFixed(2)} m from the landing`);

    const sample = await driver.callDebug("sampleWorld", [arrived.position.x, arrived.position.z]) as any;
    const ground = await driver.callDebug("groundHeight", [arrived.position.x, arrived.position.z]) as number;
    const body = waterBodies?.find((water) => Math.abs(water.level - ground) < 5) ?? null;
    row.stance = { ground, playerY: arrived.position.y, sample, nearestWaterLevel: body?.level ?? null };
    if (body && ground < body.level - 0.02) findings.push(`${site.id}: landing stance is ${(body.level - ground).toFixed(2)} m under the water surface`);

    await driver.wait(500);
    const camera = await driver.callDebug("getCamera") as any;
    const silhouette = await driver.callDebug("getPlayerSilhouette") as any;
    row.camera = camera; row.silhouette = silhouette;
    if (camera?.occluded) findings.push(`${site.id}: follow camera reports an occluded landing view`);
    if (silhouette?.active) findings.push(`${site.id}: player is drawn through geometry at the landing (silhouette opacity ${silhouette.opacity})`);
    row.shot = await driver.screenshot(out, `${site.id}-landing`);

    // `getEntities` returns a lean projection with `{x,y,z}` positions and no interaction stance,
    // so the nearby fishable ids are resolved back to their full authored entities.
    const listed = await driver.callDebug("getEntities") as { id: string; interactions?: string[]; position: Xyz }[];
    const nearby = listed.filter((entity) => entity.interactions?.includes("fish")
      && Math.hypot(entity.position.x - site.centre[0], entity.position.z - site.centre[1]) < Math.max(...site.extent) + 6);
    const local = (await Promise.all(nearby.map((entity) => driver.callDebug("getEntity", [entity.id]))))
      .filter((entity): entity is SemanticEntity => Boolean(entity));
    row.schoolCount = local.length;
    if (local.length === 0) findings.push(`${site.id}: no fishable school within the authored extent`);
    for (const school of local) {
      const entry: Record<string, unknown> = { id: school.id, position: school.position,
        interactionPosition: school.interactionPosition ?? null };
      (row.schools as unknown[]).push(entry);
      const moved = await driver.callDebug("callTool", ["corealm_move_to", { entityId: school.id }]) as any;
      entry.routed = moved;
      if (moved.error) { findings.push(`${site.id}/${school.id}: routed travel refused (${moved.error})`); continue; }
      await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().moving, undefined, { timeout: 30_000 }).catch(() => {});
      const at = await driver.callDebug("getPlayer") as any;
      const stance = school.interactionPosition ?? school.position;
      entry.stanceGap = gap(xyz(at.position), stance as Vec3);
      entry.reach = gap(xyz(at.position), school.position);
      const cast = await driver.callDebug("callTool", ["corealm_interact", { entityId: school.id, interaction: "fish" }]) as any;
      entry.cast = cast;
      if (cast.error) { findings.push(`${site.id}/${school.id}: fishing refused at the routed stance (${cast.error})`); continue; }
      await driver.wait(400);
      entry.activity = await driver.callDebug("getCurrentActivity");
      if ((entry.activity as any)?.kind !== "gathering") findings.push(`${site.id}/${school.id}: cast did not start a gathering activity`);
      entry.silhouette = await driver.callDebug("getPlayerSilhouette");
      await driver.callDebug("callTool", ["corealm_stop", {}]);
      // The dispatcher measures the school's authored stance, not the fish. `reach` is the cast
      // distance across the water and is recorded for review, not asserted.
      if ((entry.stanceGap as number) > INTERACT_RANGE) findings.push(`${site.id}/${school.id}: routed arrival is ${(entry.stanceGap as number).toFixed(2)} m from the authored stance`);
      const level = waterBodies.find((water) => Math.abs(water.level - (school.position[1] as number)) < 8)?.level;
      if (level !== undefined && school.position[1] > level - 0.1) {
        findings.push(`${site.id}/${school.id}: fish sit at ${school.position[1].toFixed(2)} m against a ${level.toFixed(2)} m water surface`);
      }
    }
    (row.schools as unknown[]).length > 0 && ((row as any).castShot = await driver.screenshot(out, `${site.id}-cast`));
  }
  report.errors = await driver.callDebug("getErrors");
  report.console = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  report.passed = findings.length === 0 && driver.pageErrors.length === 0 && driver.consoleErrors.length === 0
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
