/**
 * Screenshots a group mid-chase, which is the only moment the pile-up exists.
 *
 * `verify.ts` teleports and shoots immediately, so it catches every animal still at its spawn
 * scatter and reports a clean picture. The bears only stack once they have all steered at the
 * player, which takes a few seconds.
 *
 *   npx tsx tools/animals/chase-shot.ts highcairn_bears deepwood_coyotes
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { GameDriver } from "../lib/driver.js";
import { repoRoot } from "../lib/paths.js";
import { startGameServer } from "../lib/server.js";

const groups = process.argv.slice(2);
if (groups.length === 0) throw new Error("name at least one enemy group");
const outDir = path.join(repoRoot, "runs", "corealm", "animals", "chase");
await mkdir(outDir, { recursive: true });

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  for (const group of groups) {
    const target = await page.evaluate(async (wanted: string) => {
      const dbg = window.__gameDebug as unknown as {
        getEntities(): Record<string, unknown>[];
        teleport(t: unknown): boolean;
      };
      const hit = (await dbg.getEntities()).find((e) => String(e.id).startsWith(`${wanted}_`));
      if (!hit) return null;
      await dbg.teleport({ entityId: String(hit.id) });
      return String(hit.id);
    }, group);
    if (!target) { console.log(`  ${group}: no such group`); continue; }

    await page.waitForTimeout(6000);
    const shot = path.join(outDir, `${group}.png`);
    // The default 30 s is not enough while the game is rendering a live scene under a headless GPU;
    // `verify.ts` raises it for the same reason.
    await page.screenshot({ path: shot, timeout: 120_000 });
    console.log(`  ${group}: ${path.relative(repoRoot, shot)}`);
  }
} finally {
  await driver.close();
  await server.close();
}
