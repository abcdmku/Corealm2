/** Generated-world spatial audit. Candidate metadata is injected only into this browser page. */
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { RPG_REGIONAL_PACK_PLAN } from "../game/src/content/rpgRegionalPacks.js";
import { RPG_BESTIARY } from "../game/src/content/rpgBestiary.js";
import type { RegionalPackAuditResult } from "../game/src/world/regionalPackAudit.js";
import { FAST_TEST_SETTINGS, GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shard = argValue(args, "--shard") ?? "1/8";
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  if (!match) throw new Error("--shard must be a one-based index/count, such as 1/8");
  const index = Number(match[1]), count = Number(match[2]);
  if (index < 1 || index > count || count < 8 || count > 96) throw new Error("Use 8–96 shards, each with at most 12 packs");
  const start = Math.floor((index - 1) * RPG_REGIONAL_PACK_PLAN.length / count);
  const end = Math.floor(index * RPG_REGIONAL_PACK_PLAN.length / count);
  const packIds = RPG_REGIONAL_PACK_PLAN.slice(start, end).map((row) => row.packId);
  const cataloguePath = argValue(args, "--catalogue") ?? "art/rebuild/candidates/finish-bestiary/retained-unhorned15/catalog.json";
  const source = await readFile(path.resolve(repoRoot, cataloguePath), "utf8");
  const candidates = JSON.parse(source) as { assets: { id: string; file: string }[]; packs?: { id: string }[] };
  const publicManifest = JSON.parse(await readFile(path.join(repoRoot, "game/public/assets/manifest.json"), "utf8")) as {
    assets: { id: string; file: string }[]; packs: { id: string }[];
  };
  const stagedIds = new Set(candidates.assets.map((row) => row.id));
  for (const species of RPG_BESTIARY.filter(row => RPG_REGIONAL_PACK_PLAN.some(pack => pack.speciesId === row.id))) assert(stagedIds.has(species.assetId) || publicManifest.assets.some(asset => asset.id === species.assetId), `Candidate catalogue is incomplete: ${species.assetId}`);
  const injected = { ...publicManifest,
    assets: [...publicManifest.assets.filter((row) => !stagedIds.has(row.id)),
      ...candidates.assets.map((row) => ({ ...row, file: `__pack-audit-candidate/${row.file}` }))],
    packs: [...new Map([...publicManifest.packs, ...(candidates.packs ?? [])].map((row) => [row.id, row])).values()],
  };
  const clearDeadline = installTestDeadline(`Regional pack generated-world audit ${shard}`, 120000);
  const external = argValue(args, "--url");
  const server = external ? { url: external, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, { headless: !args.includes("--headed"),
    viewport: { width: 960, height: 600 }, settings: FAST_TEST_SETTINGS,
    browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const output = path.join(repoRoot, "test-results", "regional-pack-world");
  await mkdir(output, { recursive: true });
  const report: Record<string, unknown> = { passed: false, shard, packIds, cataloguePath,
    catalogueSha256: createHash("sha256").update(source).digest("hex"),
    proof: "Generated terrain, raw nav routes, solved water polygons, static solids and generated forest trunks. No creature rendering or visual acceptance.",
  };
  try {
    await driver.launch();
    const page = driver.page!;
    const unexpectedCandidateLoads: string[] = [];
    await page.route("**/assets/manifest.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(injected) }));
    await page.route("**/assets/__pack-audit-candidate/**", async (route) => {
      unexpectedCandidateLoads.push(route.request().url());
      await route.abort();
    });
    await driver.open(45000, "/index.html?packAudit=1");
    const result = await page.evaluate(async (ids) => {
      const probe = (window as unknown as { __packWorldAudit?: {
        run(ids: string[]): Promise<{ accepted: boolean; packs: RegionalPackAuditResult[] }>;
      } }).__packWorldAudit;
      if (!probe) throw new Error("Root packAudit exposure is unavailable");
      return probe.run(ids);
    }, packIds);
    report.result = result;
    report.unexpectedCandidateLoads = unexpectedCandidateLoads;
    assert.deepEqual(result.packs.map((row) => row.packId), packIds);
    assert.equal(unexpectedCandidateLoads.length, 0, "spatial audit must not activate candidate model views");
    assert.deepEqual(driver.pageErrors, []);
    assert(result.accepted, JSON.stringify(result.packs.filter((row) => !row.accepted)));
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    await writeFile(path.join(output, `shard-${index}-of-${count}.json`), JSON.stringify(report, null, 2));
    await driver.close();
    await server.close();
    clearDeadline();
  }
  console.log(JSON.stringify(report));
}
await main();
