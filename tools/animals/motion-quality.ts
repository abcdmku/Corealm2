/**
 * Measures HOW an animal moves, not whether its clip plays.
 *
 * Everything measured so far has been about the animation: does the walk cycle close, does its
 * playback rate match the ground covered. Those are now clean and the movement still reads badly,
 * which points at the steering rather than the art. So this samples the three things steering can
 * get wrong and the clip cannot fix:
 *
 *   turn      how fast the creature is allowed to change heading. `systems/movement.ts` caps the
 *             PLAYER at 7 rad/s; `systems/enemyAI.ts faceDirection` assigns `atan2` outright, which
 *             is uncapped, so this reports what that actually costs in degrees per second.
 *   ground    how far the creature's Y sits from the terrain under it. A walker that keeps its old
 *             height while it crosses a slope wades through the hill.
 *   speed     metres per second between samples, to catch a standing start snapping to full pace.
 */
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";

const target = process.argv[2] ?? "highcairn_bears_1";
const SAMPLES = 90;
const INTERVAL_MS = 60;

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  const rows = await page.evaluate(async (args: { id: string; samples: number; intervalMs: number }) => {
    const dbg = window.__gameDebug as unknown as {
      teleport(t: unknown): boolean;
      setHealth(v: number): void;
      getPlayerPosition(): { x: number; y: number; z: number };
      getEntity(id: string): Record<string, unknown> | null;
      getEntityMotion(id: string): Record<string, unknown> | null;
      groundHeight(x: number, z: number): number;
      callTool(n: string, a: unknown): Promise<unknown>;
    };
    await dbg.teleport({ entityId: args.id });
    await new Promise((r) => { setTimeout(r, 1000); });
    await dbg.setHealth(9999);
    // Deliberately NOT attacking. Hitting a passive animal is the only way to make it chase, but a
    // hen has four health and dies inside a second, which measures a corpse rather than a walk.
    // An aggressive family comes on its own, and then the whole sample is steering.
    // Step away so the chase has ground to cover, but stay INSIDE the aggro radius. The first
    // version stepped 19.8 m from a goat whose radius is 8 and measured ninety frames of a goat
    // doing nothing - which is a fact about the probe, not about the goat.
    const here = dbg.getPlayerPosition();
    await dbg.teleport({ x: here.x + 4, y: here.y, z: here.z + 4 });

    // Everything comes off `motionSnapshot`, which carries the SEMANTIC values the simulation
    // commands and the DRAWN ones the renderer settles on. Reading both separates a steering
    // problem from an interpolation one: the sim's yaw is what `faceDirection` assigned, the drawn
    // yaw is that after `shortestArc` has smeared it across a tick.
    const out: {
      sx: number; sy: number; sz: number; syaw: number; dyaw: number; ground: number;
    }[] = [];
    for (let i = 0; i < args.samples; i += 1) {
      await new Promise((r) => { setTimeout(r, args.intervalMs); });
      await dbg.setHealth(9999);
      const entity = await dbg.getEntity(args.id) as Record<string, unknown> | null;
      if (!entity || entity.state === "dead") break;
      const m = dbg.getEntityMotion(args.id) as Record<string, unknown> | null;
      if (!m) continue;
      const sp = m.semanticPosition as number[];
      out.push({
        sx: sp[0]!, sy: sp[1]!, sz: sp[2]!,
        syaw: m.semanticRotationY as number,
        dyaw: m.drawnRotationY as number,
        ground: dbg.groundHeight(sp[0]!, sp[2]!),
      });
    }
    return out;
  }, { id: target, samples: SAMPLES, intervalMs: INTERVAL_MS });

  const dt = INTERVAL_MS / 1000;
  const simTurns: number[] = [];
  const drawnTurns: number[] = [];
  const speeds: number[] = [];
  const groundGaps: number[] = [];
  const wrap = (d: number): number => {
    let v = d;
    while (v > Math.PI) v -= 2 * Math.PI;
    while (v < -Math.PI) v += 2 * Math.PI;
    return Math.abs(v);
  };
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    speeds.push(Math.hypot(b.sx - a.sx, b.sz - a.sz) / dt);
    groundGaps.push(Math.abs(b.sy - b.ground));
    if (Number.isFinite(a.syaw) && Number.isFinite(b.syaw)) simTurns.push(wrap(b.syaw - a.syaw) / dt);
    if (Number.isFinite(a.dyaw) && Number.isFinite(b.dyaw)) drawnTurns.push(wrap(b.dyaw - a.dyaw) / dt);
  }
  const stat = (xs: number[]): string => {
    if (xs.length === 0) return "no data";
    const sorted = [...xs].sort((p, q) => p - q);
    const at = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]!;
    return `median ${at(0.5).toFixed(2)}  p90 ${at(0.9).toFixed(2)}  max ${at(1).toFixed(2)}`;
  };

  console.log(`${target}: ${rows.length} samples at ${INTERVAL_MS} ms`);
  console.log("");
  const deg = (xs: number[]): number[] => xs.map((t) => (t * 180) / Math.PI);
  console.log(`  sim yaw deg/s     ${stat(deg(simTurns))}`);
  console.log(`  drawn yaw deg/s   ${stat(deg(drawnTurns))}`);
  console.log(`  speed m/s         ${stat(speeds)}`);
  console.log(`  height off ground ${stat(groundGaps)} m`);
  console.log("");
  console.log("  player cap for comparison: MAX_TURN_RATE 7 rad/s = 401 deg/s (systems/movement.ts)");
} finally {
  await driver.close();
  await server.close();
}
