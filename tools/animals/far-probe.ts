/**
 * Measures each animal group's drawn size on BOTH render paths.
 *
 * `render/entityViews.ts` draws anything inside the animation radius with a live rig and
 * everything beyond it as an instance of a baked idle pose. The two read the asset differently, so
 * a scale error can be invisible up close and enormous far away, which is exactly how a 100x
 * animal shipped: the rigged deer measured 1.77 m and the instanced one 177 m.
 *
 * Near height is the animal. Far height is the whole instanced BATCH, so it is only meaningful as
 * an order of magnitude: a batch of metre-scale animals spread over a 20 m radius reads tens of
 * metres, and a batch of 100x ones reads thousands.
 */
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  const rows = await page.evaluate(async () => {
    // The real `__gameDebug` surface is typed for the game. A probe only needs these five, named
    // explicitly so `npm run typecheck` stays green without loosening the shared declaration.
    const dbg = window.__gameDebug as unknown as {
      getEntities(): Record<string, unknown>[];
      teleport(target: unknown): boolean;
      getDrawnBounds(id: string): Record<string, unknown> | null;
    };
    const entities = await dbg.getEntities();
    const groups = new Map<string, string>();
    for (const e of entities) {
      if (e.archetype !== "enemy" && e.archetype !== "boss") continue;
      const id = String(e.id);
      const groupId = id.replace(/_\d+$/, "");
      if (!groups.has(groupId)) groups.set(groupId, id);
    }

    const out: Record<string, unknown>[] = [];
    for (const [groupId, sampleId] of groups) {
      // Far first: sit at the world origin, which is outside the animation radius of everything.
      await dbg.teleport({ x: 0, y: 0, z: 0 });
      await new Promise((r) => { setTimeout(r, 350); });
      const far = dbg.getDrawnBounds(sampleId) as Record<string, unknown> | null;

      await dbg.teleport({ entityId: sampleId });
      await new Promise((r) => { setTimeout(r, 900); });
      const near = dbg.getDrawnBounds(sampleId) as Record<string, unknown> | null;

      out.push({
        groupId,
        nearPath: String(near?.path ?? "none"),
        nearH: typeof near?.height === "number" ? Number((near.height as number).toFixed(2)) : null,
        farPath: String(far?.path ?? "none"),
        farH: typeof far?.height === "number" ? Number((far.height as number).toFixed(1)) : null,
      });
    }
    return out;
  });

  console.log("group                        near(rigged)      far(instanced batch)");
  let suspect = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const farH = r.farH as number | null;
    const flag = farH !== null && farH > 200 ? "  <== SUSPECT" : "";
    if (flag) suspect += 1;
    console.log(
      `${String(r.groupId).padEnd(26)} ${String(r.nearH).padStart(6)} m ${String(r.nearPath).padEnd(18)}` +
      ` ${String(r.farH).padStart(8)} m ${String(r.farPath).padEnd(11)}${flag}`,
    );
  }
  console.log(`\n${suspect} groups with an implausible instanced batch size`);
  const errors = [...driver.consoleErrors, ...driver.pageErrors];
  if (errors.length) console.log("errors:", errors.slice(0, 5));
} finally {
  await driver.close();
  await server.close();
}
