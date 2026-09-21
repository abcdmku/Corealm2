/**
 * Records every animation clip an animal actually plays through a whole fight.
 *
 * The question is narrow and worth answering with data rather than a screenshot: does the attack
 * one-shot ever reach the rig? `playAction` refuses while `movingTicks > 0`, and `syncMotion`
 * re-arms that counter on any position change over 3 cm in a single frame, so an enemy that keeps
 * adjusting its standoff distance can in principle never be allowed to swing.
 */
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";

const targets = process.argv.slice(2);
const groups = targets.length > 0 ? targets : ["marchfield_hens_1", "open_march_goats_1", "highcairn_bears_1"];

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 800, height: 500 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  for (const enemyId of groups) {
    const result = await page.evaluate(async (id: string) => {
    // See far-probe.ts: a narrow local view of the debug surface, not a change to the real one.
      const dbg = window.__gameDebug as unknown as {
        setSkillLevel(skill: string, level: number): void;
        setHealth(value: number): void;
        teleport(target: unknown): boolean;
        callTool(name: string, args: unknown): Promise<unknown>;
        getDrawnBounds(id: string): Record<string, unknown> | null;
        getState(): Record<string, unknown>;
      };
      await dbg.setSkillLevel("melee", 1);
      await dbg.teleport({ entityId: id });
      await new Promise((r) => { setTimeout(r, 900); });
      await dbg.setHealth(999);
      await dbg.callTool("corealm_attack", { entityId: id });

      const seen: string[] = [];
      const counts: Record<string, number> = {};
      for (let i = 0; i < 90; i += 1) {
        await new Promise((r) => { setTimeout(r, 120); });
        const b = dbg.getDrawnBounds(id) as Record<string, unknown> | null;
        const path = String(b?.path ?? "none");
        counts[path] = (counts[path] ?? 0) + 1;
        if (seen[seen.length - 1] !== path) seen.push(path);
        // Keep the fight going without killing it: top the player up and re-engage.
        if (i % 8 === 0) {
          await dbg.setHealth(999);
          const st = dbg.getState() as Record<string, unknown>;
          if (!st.combatTargetId) await dbg.callTool("corealm_attack", { entityId: id });
        }
      }
      return { counts, sequence: seen.slice(0, 24) };
    }, enemyId);

    console.log(`\n=== ${enemyId}`);
    console.log(`  clips seen: ${JSON.stringify(result.counts)}`);
    console.log(`  sequence  : ${result.sequence.join(" -> ")}`);
  }

  const errors = [...driver.consoleErrors, ...driver.pageErrors];
  if (errors.length) console.log("errors:", errors.slice(0, 5));
} finally {
  await driver.close();
  await server.close();
}
