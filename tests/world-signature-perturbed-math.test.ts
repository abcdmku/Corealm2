import { beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { gameRoot } from "../tools/lib/paths.js";
import { perturbedMath } from "./world-signature-fixtures.js";

/**
 * A release page accepts a baked world record only when it re-derives the record's inputs exactly: the
 * terrain spec and flats, the scatter specs and exclusions (roads, sites, habitats) and the spawn signature.
 *
 * This bakes a sample of the real world (terrain, assembly, site cuts, spawns, every 24th scatter tile)
 * under the world's `Math`, then replays the same production steps over those records as a page would,
 * reading each back through its own validator, on an engine whose `Math` is one unit off on two thirds of
 * calls to every transcendental function (`world-signature-fixtures.ts`). Each pass evaluates the game's
 * modules afresh under its own `Math`, as a page does, so constants computed at evaluation count too.
 *
 * Without `installWorldMath` that page rejects the terrain and every scatter tile (a release throws
 * "Release attempted runtime world generation"); with it, it accepts every record.
 */
const state = vi.hoisted(() => ({
  mode: "bake" as "bake" | "native" | "installed",
  records: new Map<string, unknown>(),
  rejected: [] as string[],
}));

// The bake's cache writer, which on a replay reads the baked records back and records every rejection.
vi.mock("../game/src/world/bake/worldRecordWriter.js", async importOriginal => {
  const real = await importOriginal<typeof import("../game/src/world/bake/worldRecordWriter.js")>();
  const { decodeWorldData, encodeWorldData } = await import("../game/src/world/worldDataFormat.js");
  class ReplayCache extends real.WorldRecordWriter {
    override async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
      if (state.mode === "bake") return null;
      const stored = state.records.get(key);
      const copy = stored === undefined ? undefined : decodeWorldData(encodeWorldData(stored));
      if (copy !== undefined && valid(copy)) return copy;
      state.rejected.push(key);
      return null;
    }
    override async put(key: string, data: unknown): Promise<boolean> {
      if (state.mode !== "bake") return true;
      state.records.set(key, decodeWorldData(encodeWorldData(data)));
      return super.put(key, data);
    }
  }
  return { ...real, WorldRecordWriter: ReplayCache };
});

// Each pass sets `Math` itself, for the whole pass, before the modules are evaluated.
vi.mock("../game/src/world/worldMath.js", async importOriginal => ({
  ...await importOriginal<typeof import("../game/src/world/worldMath.js")>(),
  withWorldMath: <T>(work: () => Promise<T>) => work(),
}));

const math = Math as unknown as Record<string, unknown>;
const native = Object.fromEntries(Object.getOwnPropertyNames(Math).filter(name => typeof math[name] === "function").map(name => [name, math[name]]));
let rejectedNative: string[] = [], rejectedInstalled: string[] = [], installed: readonly string[] = [];

async function run(mode: typeof state.mode): Promise<string[]> {
  state.mode = mode; state.rejected = [];
  Object.assign(math, native);
  vi.resetModules();
  // The bake runs under the world's Math; the page on another engine starts from that engine's own.
  if (mode !== "bake") Object.assign(math, perturbedMath());
  if (mode !== "native") {
    const replaced = (await import("../game/src/world/worldMath.js")).installWorldMath();
    if (mode === "installed") installed = replaced;
  }
  try {
    const [{ RESOLVED_TABLES }, { BakeGeometryAssets, directoryAssetSource }, { bakeWorldRecords }] = await Promise.all([
      import("../game/src/content/resolvedCatalog.js"), import("../game/src/world/bake/bakeAssets.js"), import("../game/src/world/bake/nodeWorldBake.js")]);
    let index = 0;
    await bakeWorldRecords({ tables: RESOLVED_TABLES, codeRevision: "test", geometryRevision: "test", seed: 1337,
      assets: await BakeGeometryAssets.open(directoryAssetSource(path.join(gameRoot, "public/assets"))),
      tiles: () => index++ % 24 === 5, onRecord: () => {} });
  } finally { Object.assign(math, native); }
  return [...state.rejected];
}

beforeAll(async () => {
  await run("bake");
  rejectedNative = await run("native");
  rejectedInstalled = await run("installed");
}, 1_800_000);

describe("world record signatures on an engine whose Math is not Chromium's", () => {
  it("bakes signed terrain, spawn and scatter records to replay", () => {
    const keys = [...state.records.keys()];
    expect(keys).toEqual(expect.arrayContaining(["terrain/world", "terrain/fairy", "spawns/world", "assembly/semantic"]));
    expect(keys.filter(key => key.startsWith("scatter/")).length).toBeGreaterThan(12);
  });

  it("rejects the baked terrain and scatter records when the page keeps its own Math", () => {
    expect(rejectedNative).toEqual(expect.arrayContaining(["terrain/world", "terrain/fairy"]));
    expect(rejectedNative.filter(key => key.startsWith("scatter/")).length).toBeGreaterThan(12);
  });

  it("accepts every baked record once the page installs the world's Math", () => {
    expect(installed).toEqual(["sin", "cos", "tan", "atan", "atan2", "asin", "acos", "exp", "log", "log2", "hypot", "pow"]);
    expect(rejectedInstalled).toEqual([]);
  });
});
