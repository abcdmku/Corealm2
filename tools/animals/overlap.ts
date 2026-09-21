/**
 * Finds animals standing inside one another.
 *
 * The report was "several animals stacked in one spot", which has two very different causes and
 * this tells them apart. If the SIMULATION has two enemies on top of each other then the spawn
 * scatter put them there and the fix is in `world/regionBuilder.ts`. If the simulation has them
 * apart but the picture shows one lump, the fix is in `render/entityViews.ts`.
 *
 * Overlap is judged per PAIR, not against a constant, because it cannot be otherwise: two hens
 * 1.2 m apart are two hens and two cattle 1.2 m apart are one lump of beef. The bodies come from
 * the sizes `build-animals.ts` measured into the manifest, so the threshold is the animals' own.
 */
import "../lib/repoContent.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { REGIONS } from "../../game/src/content/regions.js";
import { GameDriver } from "../lib/driver.js";
import { gameRoot } from "../lib/paths.js";
import { startGameServer } from "../lib/server.js";

/** Widest net the browser side casts. Everything past this is separate by any body size here. */
const SEARCH_M = 6;
/**
 * With `--chase`, teleport into each aggressive group and let it come before measuring.
 *
 * Spawn positions are scattered and never overlap; the pile-up happens afterwards, because every
 * animal that aggros paths at the SAME point - the player - and nothing makes them give way to each
 * other. Measuring only the world at rest reports a clean bill of health for a bug you can see.
 */
const CHASE = process.argv.includes("--chase");
const CHASE_MS = 5000;

const manifest = JSON.parse(
  await readFile(path.join(gameRoot, "public", "assets", "manifest.json"), "utf8"),
) as { assets: { id: string; size?: { x: number; y: number; z: number } }[] };
const halfWidth = new Map<string, number>();
for (const asset of manifest.assets) {
  if (!asset.size) continue;
  halfWidth.set(asset.id, Math.max(asset.size.x, asset.size.z) / 2);
}

// The debug entity list carries no assetId, so the spawn group is resolved to one here, offline,
// out of the same region tables the world was built from.
const groupAsset = new Map<string, string>();
for (const region of REGIONS) {
  for (const group of [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]) {
    groupAsset.set(group.id, group.assetId);
  }
}

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 900, height: 600 } });
try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, null, { timeout: 90_000 });

  // No named inner functions in here: the bundler runs with `keepNames`, which injects a `__name`
  // call that does not exist inside the page and the whole evaluate throws before it measures.
  const raw = await page.evaluate(async (opts: { limit: number; chase: boolean; waitMs: number }) => {
    const dbg = window.__gameDebug as unknown as {
      getEntities(): Record<string, unknown>[];
      teleport(target: unknown): boolean;
    };

    // One representative per group, so every species gets its turn at pulling a crowd. Empty when
    // not chasing, in which case the single pass below just reads the world where it stands.
    const targets: string[] = [];
    if (opts.chase) {
      const seen = new Set<string>();
      for (const e of dbg.getEntities()) {
        if (e.archetype !== "enemy" && e.archetype !== "boss") continue;
        const group = String(e.id).replace(/_\d+$/, "");
        if (seen.has(group)) continue;
        seen.add(group);
        targets.push(String(e.id));
      }
    }

    let total = 0;
    const worst = new Map<string, { d: number; a: string; b: string }>();
    const passes = targets.length > 0 ? targets : [""];
    for (const target of passes) {
      if (target) {
        dbg.teleport({ entityId: target });
        await new Promise((r) => { setTimeout(r, opts.waitMs); });
      }
      const animals = dbg.getEntities().filter((e) => e.archetype === "enemy" || e.archetype === "boss");
      total = animals.length;
      for (let i = 0; i < animals.length; i += 1) {
        for (let j = i + 1; j < animals.length; j += 1) {
          const pa = animals[i]!.position as { x: number; z: number };
          const pb = animals[j]!.position as { x: number; z: number };
          const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
          if (d > opts.limit) continue;
          const key = `${animals[i]!.id}|${animals[j]!.id}`;
          const held = worst.get(key);
          // Keep the CLOSEST each pair ever came, not where they ended up: the pile-up is a moment
          // during the chase, and a snapshot afterwards can catch them already drifting apart.
          if (!held || d < held.d) worst.set(key, { d, a: String(animals[i]!.id), b: String(animals[j]!.id) });
        }
      }
    }
    return { total, pairs: [...worst.values()] };
  }, { limit: SEARCH_M, chase: CHASE, waitMs: CHASE_MS });

  const groupOf = (id: string): string => id.replace(/_\d+$/, "");
  const bodyOf = (id: string): number => halfWidth.get(groupAsset.get(groupOf(id)) ?? "") ?? 0.4;

  const rows = raw.pairs
    .map((p) => {
      const clearance = bodyOf(p.a) + bodyOf(p.b);
      return { ...p, clearance, bite: clearance - p.d };
    })
    .filter((r) => r.bite > 0)
    .sort((a, b) => b.bite - a.bite);

  console.log(`${raw.total} animals; ${rows.length} pairs whose bodies intersect\n`);
  console.log("overlap  gap    bodies need   a / b");
  for (const r of rows.slice(0, 40)) {
    const mixed = groupOf(r.a) === groupOf(r.b) ? "" : "   <== two species";
    console.log(
      `${r.bite.toFixed(2).padStart(6)} m ${r.d.toFixed(2).padStart(5)} m  ` +
      `${r.clearance.toFixed(2).padStart(5)} m      ${r.a} / ${r.b}${mixed}`,
    );
  }
  const byGroup = new Map<string, number>();
  for (const r of rows) {
    for (const id of [r.a, r.b]) byGroup.set(groupOf(id), (byGroup.get(groupOf(id)) ?? 0) + 1);
  }
  console.log("\nintersecting members per group:");
  for (const [g, n] of [...byGroup].sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(28)} ${n}`);
} finally {
  await driver.close();
  await server.close();
}
