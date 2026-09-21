/** Aggros an animal, walks away so it must chase, and reports the walk clip's applied rate. */
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 800, height: 500 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  for (const id of process.argv.slice(2)) {
    const seen = await page.evaluate(async (enemyId: string) => {
      const dbg = window.__gameDebug as unknown as {
        setSkillLevel(s: string, n: number): void; setHealth(n: number): void;
        teleport(t: unknown): boolean; callTool(n: string, a: unknown): Promise<unknown>;
        getDrawnBounds(i: string): Record<string, unknown> | null;
        getPlayerPosition(): { x: number; y: number; z: number };
      };
      await dbg.setSkillLevel("melee", 30);
      await dbg.teleport({ entityId: enemyId });
      await new Promise((r) => { setTimeout(r, 1200); });
      await dbg.setHealth(999);
      await dbg.callTool("corealm_attack", { entityId: enemyId });
      const paths = new Set<string>();
      for (let i = 0; i < 40; i += 1) {
        // Keep retreating so the enemy has to keep walking.
        if (i % 6 === 0) {
          const p = dbg.getPlayerPosition();
          await dbg.teleport({ x: p.x + 5, y: p.y, z: p.z + 5 });
        }
        await new Promise((r) => { setTimeout(r, 250); });
        const b = dbg.getDrawnBounds(enemyId);
        if (b?.path) paths.add(String(b.path));
      }
      return [...paths];
    }, id);
    console.log(`${id.padEnd(26)} ${seen.join("  ")}`);
  }
  const errors = [...driver.consoleErrors, ...driver.pageErrors];
  if (errors.length) console.log("errors:", errors.slice(0, 4));
} finally {
  await driver.close();
  await server.close();
}
