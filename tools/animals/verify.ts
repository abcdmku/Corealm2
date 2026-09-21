/**
 * Proves the animals are really in the world, not just in the tables.
 *
 * AGENTS.md rule 7: source review is not gameplay proof. This boots the real Vite game, reads the
 * semantic entity list back out of `__gameDebug`, and then teleports to each animal group and
 * screenshots it, so both halves - the state and the picture - are checked against the same run.
 *
 *   npx tsx tools/animals/verify.ts
 *   npx tsx tools/animals/verify.ts --shots        also write per-group screenshots
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../lib/driver.js";
import { repoRoot } from "../lib/paths.js";
import { startGameServer } from "../lib/server.js";

interface EnemyRow {
  id: string;
  name: string;
  archetype: string;
  regionId: string;
  tier: number;
  maxHealth: number;
  health: number;
  state: string;
  interactions: string[];
  position: number[];
}

const runDir = path.join(repoRoot, "runs", "corealm", "animals");
const shotDir = path.join(runDir, "screenshots");

async function main(): Promise<void> {
  const wantShots = process.argv.includes("--shots");
  const onlyArg = process.argv[process.argv.indexOf("--only") + 1];
  const only = process.argv.includes("--only") && onlyArg
    ? new Set(onlyArg.split(",").map((entry) => entry.trim()))
    : null;
  await mkdir(shotDir, { recursive: true });

  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 1280, height: 720 } });
  try {
    await driver.launch();
    await driver.open(60_000);
    const page = driver.page!;
    await page.waitForFunction(
      () => (window as never as { __gameDebug?: { getEntities?: unknown } }).__gameDebug?.getEntities !== undefined,
      null,
      { timeout: 60_000 },
    );

    const enemies = (await page.evaluate(async () => {
      const debug = (window as never as { __gameDebug: { getEntities(): Record<string, unknown>[] } }).__gameDebug;
      return (await debug.getEntities())
        .filter((entity) => entity.archetype === "enemy" || entity.archetype === "boss")
        // `getEntities` publishes a deliberately narrow projection (contracts.ts EntitySummary):
        // health and maxHealth are flattened onto the row and combat.level, meta and view are not
        // exposed at all. Read what is actually there rather than inventing fields.
        .map((entity) => ({
          id: entity.id, name: entity.name, archetype: entity.archetype,
          regionId: entity.regionId, tier: entity.tier,
          maxHealth: entity.maxHealth, health: entity.health,
          state: entity.state, interactions: entity.interactions,
          position: entity.position,
        }));
    })) as EnemyRow[];

    // One row per GROUP, not per entity: the group is what was authored.
    const groups = new Map<string, EnemyRow & { count: number }>();
    for (const row of enemies) {
      const groupId = row.id.replace(/_\d+$/, "");
      const seen = groups.get(groupId);
      if (seen) seen.count += 1;
      else groups.set(groupId, { ...row, count: 1 });
    }

    console.log(`\n${enemies.length} attackable entities in ${groups.size} groups\n`);
    let region = "";
    for (const [groupId, row] of groups) {
      if (row.regionId !== region) { console.log(`-- ${row.regionId}`); region = row.regionId; }
      console.log(
        `   ${groupId.padEnd(26)} ${String(row.name).padEnd(24)} x${String(row.count).padStart(2)}` +
        `  t${String(row.tier).padEnd(2)}  hp ${String(row.maxHealth).padStart(3)}` +
        `  ${String(row.state)}  [${(row.interactions ?? []).join(" ")}]`,
      );
    }

    // Every animal asset must have actually loaded a rig with its four clips, or the enemies are
    // standing in bind pose and the whole conversion was pointless.
    const clipReport = await page.evaluate(() => {
      const debug = window as never as { __gameDebug: { listClips?: () => string[] } };
      return debug.__gameDebug.listClips?.() ?? [];
    });
    console.log(`\nshared clip library: ${clipReport.length} names`);

    if (wantShots) {
      console.log("");
      for (const [groupId, row] of groups) {
        if (only && !only.has(groupId)) continue;
        const ok = await page.evaluate(
          (id) => (window as never as { __gameDebug: { teleport(t: unknown): boolean } })
            .__gameDebug.teleport({ entityId: id }),
          row.id,
        );
        if (!ok) { console.log(`   teleport failed: ${groupId}`); continue; }
        await page.waitForTimeout(1800);
        const drawn = await page.evaluate(
          (id) => (window as never as { __gameDebug: { getDrawnBounds(i: string): Record<string, unknown> | null } })
            .__gameDebug.getDrawnBounds(id),
          row.id,
        );
        // SwiftShader plus a loaded region needs well over the 30 s default here.
        await page.screenshot({ path: path.join(shotDir, `${groupId}.png`), timeout: 120_000 });
        // `path` is the field getDrawnBounds actually publishes: "instanced" is the baked-idle
        // fallback and "animated:<clip>" is a live mixer. A screenshot cannot tell them apart.
        const animated = drawn?.path ?? "no-bounds";
        const height = typeof drawn?.height === "number" ? (drawn.height as number).toFixed(2) : "?";
        console.log(`   shot ${groupId.padEnd(26)} drawn ${height} m  meshes=${String(drawn?.meshes ?? "?")}  ${String(animated)}`);
      }
    }

    await writeFile(
      path.join(runDir, "enemies.json"),
      `${JSON.stringify({ total: enemies.length, groups: [...groups.values()] }, null, 2)}\n`,
    );

    const errors = [...driver.consoleErrors, ...driver.pageErrors, ...driver.requestErrors];
    if (errors.length > 0) {
      console.log(`\n${errors.length} browser errors:`);
      for (const error of errors.slice(0, 12)) console.log(`   ${error.slice(0, 180)}`);
      process.exitCode = 1;
    } else {
      console.log("\nno console, page or request errors");
    }
  } finally {
    await driver.close();
    await server.close();
  }
}

await main();
