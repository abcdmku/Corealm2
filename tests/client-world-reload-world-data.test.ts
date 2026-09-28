import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetServerWorld, setContentAssetOverlay, setServerWorld, contentAssetOverride } from "../game/src/app/config.js";
import { createContentAssetOverlay } from "../game/src/app/contentAssetOverlay.js";
import { serverNavigationRelease } from "../game/src/systems/navigation.js";
import { GenerationCache } from "../game/src/world/generationCache.js";
import { acceptsWorldManifest, ShippedWorldData, worldCacheScope } from "../game/src/world/shippedWorldData.js";
import { encodeWorldData, worldDataSha256, type WorldDataManifest } from "../game/src/world/worldDataFormat.js";
import { repoRoot } from "../tools/lib/paths.js";

/** A server's baked world is read with the server's revision and navmesh identity, and cached apart from the build's. */

const BUILD = "a".repeat(64), SERVER = "b".repeat(64), SCOPE = "game/1337/world";

class MemoryLocal extends GenerationCache {
  constructor(revision: string, scope: string, readonly records = new Map<string, { revision: string; data: unknown }>()) { super(revision, scope); }
  override async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    const entry = this.records.get(`${this.scope}/${key}`);
    return entry?.revision === this.revision && valid(entry.data) ? structuredClone(entry.data) as T : null;
  }
  override async put(key: string, data: unknown) { this.records.set(`${this.scope}/${key}`, { revision: this.revision, data: structuredClone(data) }); return true; }
}
afterEach(() => { vi.unstubAllGlobals(); resetServerWorld(); setContentAssetOverlay(null); });
const valid = (value: unknown): value is { from: string } => !!value && typeof (value as { from?: unknown }).from === "string";

async function serverHost(revision: string) {
  const packed = gzipSync(encodeWorldData({ from: "server" })), sha256 = await worldDataSha256(packed);
  const manifest = { format: "corealm-world", version: 1, revision, scope: SCOPE, tiles: [],
    records: { "terrain/world": { file: `${sha256}.world`, bytes: packed.length, sha256 } } };
  const asked: string[] = [];
  vi.stubGlobal("location", { href: "https://game.test/" });
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    asked.push(String(url));
    return String(url).includes("manifest.json") ? Response.json(manifest) : new Response(Uint8Array.from(packed));
  }));
  return { asked };
}

describe("the world manifest a page accepts", () => {
  const manifest: WorldDataManifest = { format: "corealm-world", version: 1, revision: SERVER, scope: SCOPE, tiles: [], records: {} };
  it("is the expected world's revision and scope, and nothing else", () => {
    expect(acceptsWorldManifest(manifest, { revision: SERVER, scope: SCOPE })).toBe(true);
    expect(acceptsWorldManifest(manifest, { revision: BUILD, scope: SCOPE })).toBe(false);
    expect(acceptsWorldManifest(manifest, { revision: SERVER, scope: "game/7/world" })).toBe(false);
    expect(acceptsWorldManifest({ ...manifest, records: undefined } as never, { revision: SERVER, scope: SCOPE })).toBe(false);
    expect(acceptsWorldManifest(null, { revision: SERVER, scope: SCOPE })).toBe(false);
  });
});

describe("a server's world records", () => {
  it("load from the server's manifest under its revision, cached apart from the build's", async () => {
    const { asked } = await serverHost(SERVER);
    const shared = new Map<string, { revision: string; data: unknown }>();
    const buildCache = new MemoryLocal(BUILD, worldCacheScope(SCOPE, null), shared);
    await buildCache.put("terrain/world", { from: "build" });
    const serverCache = new MemoryLocal(SERVER, worldCacheScope(SCOPE, SERVER), shared);
    const manifestUrl = "https://ravenwood.test:4443/content-assets/generated/world/manifest.json?v=1";
    const source = new ShippedWorldData(serverCache, manifestUrl, true, { revision: SERVER, scope: SCOPE });
    expect(await source.get("terrain/world", valid)).toEqual({ from: "server" });
    expect(asked[1]).toMatch(/^https:\/\/ravenwood\.test:4443\/content-assets\/generated\/world\/[0-9a-f]{64}\.world$/);
    // Both copies stay: the page moving back to the build's world still finds its own.
    expect(await buildCache.get("terrain/world", valid)).toEqual({ from: "build" });
    expect(await serverCache.get("terrain/world", valid)).toEqual({ from: "server" });
    expect([...shared.keys()].sort()).toEqual([`${SCOPE}/terrain/world`, `${SCOPE}@server/${SERVER}/terrain/world`]);
  });

  it("refuse a manifest for another bake than the one the page reloaded onto", async () => {
    await serverHost("d".repeat(64));
    const source = new ShippedWorldData(new MemoryLocal(SERVER, worldCacheScope(SCOPE, SERVER)), "https://ravenwood.test/generated/world/manifest.json", true, { revision: SERVER, scope: SCOPE });
    await expect(source.get("terrain/world", valid)).rejects.toThrow(/revision does not match/);
  });

  it("the build's world keeps its own scope and expects its own manifest", async () => {
    await serverHost(SERVER);
    expect(worldCacheScope(SCOPE, null)).toBe(SCOPE);
    const source = new ShippedWorldData(new MemoryLocal(BUILD, SCOPE), "https://game.test/generated/world/manifest.json", true);
    await expect(source.get("terrain/world", valid)).rejects.toThrow(/revision does not match/);
  });
});

describe("a server's navmesh", () => {
  it("is accepted under the identity its own metadata names", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(repoRoot, "game/public/generated/corealm-navmesh.bin")));
    const named = JSON.parse(readFileSync(path.join(repoRoot, "game/public/generated/corealm-navmesh.json"), "utf8"));
    expect(await serverNavigationRelease(bytes, 1337)).toEqual({ fingerprint: named.fingerprint, worldSeed: "1337",
      strategy: named.settings.strategy, sourceMeshes: named.sourceMeshes, sourceTriangles: named.sourceTriangles });
  });

  it("is refused when damaged", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(repoRoot, "game/public/generated/corealm-navmesh.bin")));
    bytes[bytes.length - 1]! ^= 0xff;
    await expect(serverNavigationRelease(bytes, 1337)).rejects.toThrow(/hash does not match/);
  });
});

describe("the joined server's files on a page that booted onto its world", () => {
  const FILES = "https://ravenwood.test:4443/content-assets/";
  it("stay in use on join, and are read again for the server's models", async () => {
    setServerWorld({ revision: SERVER, contentAssetUrl: FILES });
    setContentAssetOverlay({ base: FILES, files: { "generated/world/manifest.json": { sha256: "1".repeat(64) } } });
    let answer: (response: Response) => void = () => {};
    const overlay = createContentAssetOverlay({ fetch: (() => new Promise<Response>(resolve => { answer = resolve; })) as typeof fetch });
    expect(overlay.base).toBe(FILES);
    const entered = overlay.enter(FILES);
    // While the index is read again, the world files still resolve to the server.
    expect(contentAssetOverride("generated/world/manifest.json")).toBe(`${FILES}generated/world/manifest.json?v=${"1".repeat(64)}`);
    answer(Response.json({ revision: "r2", files: { "generated/world/manifest.json": { sha256: "2".repeat(64) } } }));
    await entered;
    expect(contentAssetOverride("generated/world/manifest.json")).toBe(`${FILES}generated/world/manifest.json?v=${"2".repeat(64)}`);
  });
});
