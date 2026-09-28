import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { RESOLVED_TABLES } from "../game/src/content/resolvedCatalog.js";
import { BakeGeometryAssets, directoryAssetSource } from "../game/src/world/bake/bakeAssets.js";
import { bakeWorldRecords, type WorldRecordBake } from "../game/src/world/bake/nodeWorldBake.js";
import { decodeNavigationArtifact } from "../game/src/systems/navigationArtifact.js";
import type { WorldDataManifest } from "../game/src/world/worldDataFormat.js";
import { gameRoot } from "../tools/lib/paths.js";

/**
 * The Node world bake against the committed Chromium bake (`npm run world:build`), for the build's own catalog.
 * Every record must be the same bytes: the same encoding, the same gzip, so the same sha256 file name.
 *
 * By default it bakes every terrain, assembly, site-cut and spawn record and a spread of scatter tiles
 * over both maps. NODE_WORLD_BAKE_FULL=1 bakes and compares every tile (about ten minutes).
 *
 * A failure after a generation source changed means the committed world is stale: `npm run world:build`.
 */
const SEED = 1337;
const FULL = process.env.NODE_WORLD_BAKE_FULL === "1";
const generated = path.join(gameRoot, "public/generated");
let committed: WorldDataManifest, bake: WorldRecordBake, sample: Set<string>;
const baked = new Map<string, Uint8Array>();

beforeAll(async () => {
  committed = JSON.parse(await readFile(path.join(generated, "world/manifest.json"), "utf8"));
  // Every 24th tile, which crosses the main island, its coast and the fairy map.
  sample = new Set(committed.tiles.filter((_, index) => FULL || index % 24 === 5));
  bake = await bakeWorldRecords({ tables: RESOLVED_TABLES, codeRevision: committed.revision, geometryRevision: committed.revision, seed: SEED,
    assets: await BakeGeometryAssets.open(directoryAssetSource(path.join(gameRoot, "public/assets"))),
    tiles: id => sample.has(id), onRecord: (key, bytes) => { baked.set(key, bytes); } });
  console.log(`node world bake: ${JSON.stringify(bake.timings)}, ${sample.size} tiles`);
}, 1_800_000);

/** The first differing field of two decoded records, for a readable failure. */
async function firstDifference(key: string): Promise<string> {
  const { decodeWorldData } = await import("../game/src/world/worldDataFormat.js");
  const ours = decodeWorldData(gunzipSync(baked.get(key)!)), theirs = decodeWorldData(gunzipSync(await readFile(path.join(generated, "world", committed.records[key]!.file))));
  const walk = (a: unknown, b: unknown, at: string): string | null => {
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
      if (x.length !== y.length) return `${at}: length ${x.length} vs ${y.length}`;
      for (let index = 0; index < x.length; index++) if (!Object.is(x[index], y[index])) return `${at}[${index}]: ${x[index]} vs ${y[index]}`;
      return null;
    }
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return Object.is(a, b) ? null : `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = walk((a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field], `${at}.${field}`);
      if (found) return found;
    }
    return null;
  };
  return walk(ours, theirs, key) ?? `${key}: same content, different gzip`;
}

async function differing(keys: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const key of keys) if (bake.manifest.records[key]?.sha256 !== committed.records[key]?.sha256) out.push(baked.has(key) ? await firstDifference(key) : `${key}: not baked`);
  return out;
}

describe("Node world bake parity with the Chromium bake", () => {
  it("bakes terrain, assembly, site cuts and spawns to the committed bytes", async () => {
    const keys = Object.keys(committed.records).filter(key => !key.startsWith("scatter/"));
    expect(keys.length).toBeGreaterThan(20);
    expect(Object.keys(bake.manifest.records).filter(key => !key.startsWith("scatter/"))).toEqual(keys);
    expect(await differing(keys)).toEqual([]);
  });

  it("bakes the sampled scatter tiles to the committed bytes", async () => {
    expect(sample.size).toBeGreaterThan(FULL ? 300 : 12);
    expect(bake.manifest.tiles).toEqual(committed.tiles.filter(tile => sample.has(tile)));
    expect(await differing([...sample].map(tile => `scatter/${tile}`))).toEqual([]);
  });

  it("writes a manifest the release accepts, named by the geometry revision", () => {
    expect({ ...bake.manifest, records: {}, tiles: [] }).toEqual({ ...committed, records: {}, tiles: [] });
    for (const [key, entry] of Object.entries(bake.manifest.records)) expect([key, entry.file, entry.bytes]).toEqual([key, `${entry.sha256}.world`, baked.get(key)!.byteLength]);
  });

  it("exports the client navmesh the navmesh bake ships", async () => {
    const shipped = await readFile(path.join(generated, "corealm-navmesh.bin"));
    const [ours, theirs] = await Promise.all([decodeNavigationArtifact(bake.navmesh.bin), decodeNavigationArtifact(shipped)]);
    expect(ours.metadata).toEqual(theirs.metadata);
    expect(Buffer.from(ours.navData).equals(Buffer.from(theirs.navData))).toBe(true);
    expect(gunzipSync(bake.navmesh.nav).equals(Buffer.from(bake.navmesh.bin))).toBe(true);
    expect(bake.navmesh.release).toEqual({ fingerprint: theirs.metadata.fingerprint, worldSeed: String(SEED), strategy: theirs.metadata.settings.strategy,
      sourceMeshes: theirs.metadata.sourceMeshes, sourceTriangles: theirs.metadata.sourceTriangles });
  });
});
