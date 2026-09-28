import "./lib/worldMathFirst.js";
/**
 * Bakes the client world records, their manifest and the client navmesh in plain Node, without a browser.
 *
 *   npx tsx tools/bake-world-node.ts --out <dir> [--catalog <catalog.json>] [--assets <dir|url>] [--revision <hex>] [--seed 1337]
 *
 * With no `--catalog` it bakes the repo's compiled catalog, and with no `--revision` names the manifest
 * after the build's generation revision, so the output can be compared with `game/public/generated/world`.
 * It never writes into `game/public/generated` itself: `npm run world:build` owns the committed world.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gameRoot, repoRoot } from "./lib/paths.js";
import { generationRevision } from "./lib/generation-revision.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const out = flag("out");
if (!out) throw new Error("--out <directory> is required");
const outDir = path.resolve(out);
if (!path.relative(path.join(gameRoot, "public/generated"), outDir).startsWith("..")) throw new Error("--out must not be inside game/public/generated");
const catalogFile = flag("catalog") ?? path.join(repoRoot, "game/content/compiled/catalog.json");
const assets = flag("assets") ?? path.join(gameRoot, "public/assets");
const seed = Number(flag("seed") ?? 1337);

const { bakeCatalogWorldRecords } = await import("../game/src/world/bake/installAndBake.js");
const { BakeGeometryAssets, directoryAssetSource, urlAssetSource } = await import("../game/src/world/bake/bakeAssets.js");
const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
const codeRevision = await generationRevision(gameRoot);
const worldDir = path.join(outDir, "world");
await mkdir(worldDir, { recursive: true });
const startedAt = performance.now();
let peakRss = 0;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 250);
const result = await bakeCatalogWorldRecords(catalog, {
  codeRevision, geometryRevision: flag("revision") ?? codeRevision, seed,
  assets: await BakeGeometryAssets.open(/^https?:\/\//.test(assets) ? urlAssetSource(assets) : directoryAssetSource(assets)),
  log: message => console.log(message),
  onRecord: (_key, bytes, entry) => writeFile(path.join(worldDir, entry.file), bytes),
});
clearInterval(sampler);
await writeFile(path.join(worldDir, "manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
await writeFile(path.join(outDir, "corealm-navmesh.bin"), result.navmesh.bin);
await writeFile(path.join(outDir, "corealm-navmesh.nav"), result.navmesh.nav);
await writeFile(path.join(outDir, "corealm-navmesh.json"), `${JSON.stringify({ ...result.navmesh.metadata, path: "generated/corealm-navmesh.bin", bytes: result.navmesh.bin.byteLength, worldSeed: String(seed) }, null, 2)}\n`);
const compressed = Object.values(result.manifest.records).reduce((sum, record) => sum + record.bytes, 0);
console.log(`Baked ${Object.keys(result.manifest.records).length} records (${(compressed / 1e6).toFixed(2)} MB), navmesh ${result.navmesh.release.fingerprint.slice(0, 12)}, `
  + `${Math.round((performance.now() - startedAt) / 1000)} s, peak RSS ${Math.round(peakRss / 1e6)} MB. Steps: ${JSON.stringify(result.timings)}`);
// Recast and the asset readers keep handles open.
process.exit(0);
