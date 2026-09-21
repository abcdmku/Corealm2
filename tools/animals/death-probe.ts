/**
 * Watches one animal die and proves the corpse actually leaves.
 *
 * Three things have to be true and only a running game can say so: the body stays whole while the
 * death animation plays, it is gone within a few seconds of that, and the loot crate outlives it
 * and then goes too. A unit test pins the fade curve; this pins that the curve is wired to a body.
 *
 *   npx tsx tools/animals/death-probe.ts marchfield_hens_1
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { GameDriver } from "../lib/driver.js";
import { repoRoot } from "../lib/paths.js";
import { startGameServer } from "../lib/server.js";

const target = process.argv[2] ?? "marchfield_hens_1";
const shots = process.argv.includes("--shots");
const outDir = path.join(repoRoot, "runs", "corealm", "animals", "death");
await mkdir(outDir, { recursive: true });

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  // No named inner functions inside evaluate: the bundler's `keepNames` injects a `__name` call
  // that does not exist in the page.
  const killed = await page.evaluate(async (id: string) => {
    const dbg = window.__gameDebug as unknown as {
      setSkillLevel(skill: string, level: number): void;
      setHealth(value: number): void;
      teleport(target: unknown): boolean;
      callTool(name: string, args: unknown): Promise<unknown>;
      getEntity(id: string): Record<string, unknown> | null;
      getState(): Record<string, unknown>;
      select(entityId: string | null): void;
    };
    // Enough to end the fight quickly, so the sampling below is all corpse and no combat.
    await dbg.setSkillLevel("melee", 60);
    await dbg.teleport({ entityId: id });
    await new Promise((r) => { setTimeout(r, 900); });
    await dbg.setHealth(999);
    // Select it the way a player would before the fight, so the deselect below is a real
    // observation rather than a field that was never set.
    dbg.select(id);
    const selectedWhileAlive = String(dbg.getState().selectedEntityId ?? "-");
    await dbg.callTool("corealm_attack", { entityId: id });

    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => { setTimeout(r, 150); });
      await dbg.setHealth(999);
      const entity = await dbg.getEntity(id) as Record<string, unknown> | null;
      if (entity?.state === "dead") {
        return { died: true, selectedWhileAlive, selectedAtDeath: String(dbg.getState().selectedEntityId ?? "-") };
      }
      const st = dbg.getState() as Record<string, unknown>;
      if (!st.combatTargetId) await dbg.callTool("corealm_attack", { entityId: id });
    }
    return { died: false, selectedWhileAlive, selectedAtDeath: "-" };
  }, target);

  if (!killed.died) throw new Error(`${target} did not die within the probe window`);
  console.log(`selection while alive: ${killed.selectedWhileAlive}`);
  console.log(`selection at death:    ${killed.selectedAtDeath}`);
  console.log(`${target} killed; sampling the corpse\n`);
  console.log("  t+s   drawn      fade  path                      crates  selected");

  // Sampled out past the slowest death clip in the game plus its fade. Each sample sleeps the GAP
  // since the previous one, so the printed time really is time since death - the first version slept
  // a flat 300 ms and printed labels that had nothing to do with when it looked.
  let sampledAtSeconds = 0;
  for (const atSeconds of [0.5, 1.5, 3.0, 4.0, 4.5, 5.0, 5.5, 6.5, 8.0, 12.0]) {
    const waitMs = Math.max(0, (atSeconds - sampledAtSeconds) * 1000);
    sampledAtSeconds = atSeconds;
    const row = await page.evaluate(async (args: { id: string; waitMs: number }) => {
      await new Promise((r) => { setTimeout(r, args.waitMs); });
      const dbg = window.__gameDebug as unknown as {
        getDrawnBounds(id: string): Record<string, unknown> | null;
        getEntities(): Record<string, unknown>[];
        getState(): Record<string, unknown>;
      };
      const bounds = dbg.getDrawnBounds(args.id) as Record<string, unknown> | null;
      return {
        height: typeof bounds?.height === "number" ? Number((bounds.height as number).toFixed(2)) : null,
        fade: typeof bounds?.fade === "number" ? Number((bounds.fade as number).toFixed(2)) : null,
        path: String(bounds?.path ?? "none"),
        crates: (await dbg.getEntities()).filter((e) => e.archetype === "loot").length,
        selected: String(dbg.getState().selectedEntityId ?? "-"),
      };
    }, { id: target, waitMs });
    console.log(
      `  ${String(atSeconds).padStart(4)}  ${String(row.height ?? "-").padStart(6)} m  ` +
      `${String(row.fade ?? "-").padStart(4)}  ${row.path.padEnd(24)} ${String(row.crates).padStart(6)}  ${row.selected}`,
    );
    if (shots) {
      await page.screenshot({ path: path.join(outDir, `${target}-t${atSeconds}.png`), timeout: 120_000 });
    }
  }
  // The crate is on a one-minute timer (`systems/combat.ts LOOT_DESPAWN_MS`). Waiting that out in
  // real time would make this probe a minute long, so the sim clock is wound forward instead.
  const crates = await page.evaluate(async () => {
    const dbg = window.__gameDebug as unknown as {
      advanceGameTime(seconds: number): void;
      getEntities(): Record<string, unknown>[];
    };
    const before = (await dbg.getEntities()).filter((e) => e.archetype === "loot").length;
    await dbg.advanceGameTime(75);
    await new Promise((r) => { setTimeout(r, 1200); });
    return { before, after: (await dbg.getEntities()).filter((e) => e.archetype === "loot").length };
  });
  console.log(`
  crates before +75 s: ${crates.before}, after: ${crates.after}`);
} finally {
  await driver.close();
  await server.close();
}
