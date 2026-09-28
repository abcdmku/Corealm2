import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatedUrl, resetServerWorld, serverWorld, setContentAssetOverlay } from "../game/src/app/config.js";
import { installPageCatalog } from "../game/src/content/catalogEntry.js";
import { takeInstalledCatalog } from "../game/src/content/catalogInstall.js";
import { clientCatalog } from "../game/src/content/clientCatalog.js";
import { storePendingLaunch } from "../game/src/multiplayer/playIntent.js";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * The page reloading onto a server's baked world installs the server's client catalog and file index
 * in the entry, before the app (and every content module) is imported, so boot builds terrain and
 * scatter from the server's rows and fetches the world from the server.
 */

const SERVER_WORLD = "b".repeat(64), CATALOG = "c".repeat(64);
const FILES = "https://ravenwood.test:4443/content-assets/";
const compiled = JSON.parse(readFileSync(path.join(repoRoot, "game/content/compiled/catalog.json"), "utf8")) as { revision: string; tables: Record<string, unknown> };
const server = clientCatalog({ ...compiled, revision: CATALOG });
server.tables.worldTerrain = { authoredBy: "the server" };
const sha = (n: number) => String(n).repeat(64).slice(0, 64);

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); }, removeItem: key => { values.delete(key); }, clear: () => values.clear() } as Storage;
}
const globals = globalThis as { sessionStorage?: Storage };
beforeEach(() => { globals.sessionStorage = storage(); resetServerWorld(); setContentAssetOverlay(null); });
afterEach(() => { delete globals.sessionStorage; vi.restoreAllMocks(); });

function host(index: Record<string, { sha256: string }>) {
  const asked: string[] = [];
  const fetcher = (async (input: string | URL) => {
    const url = String(input); asked.push(url);
    if (url === `${FILES}index.json`) return Response.json({ revision: "r1", files: index });
    if (url === `https://ravenwood.test:4443/catalog/${CATALOG}`) return new Response(JSON.stringify(server));
    if (url === "https://game.test/generated/local-world.json") return Response.json({ nope: true });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}
const complete = { "generated/world/manifest.json": { sha256: sha(1) }, "generated/corealm-navmesh.nav": { sha256: sha(2) } };
const launch = () => storePendingLaunch({ providerId: "ravenwood", worldId: "main", attempts: 1, world: {
  revision: SERVER_WORLD, contentAssetUrl: FILES, catalogUrl: `https://ravenwood.test:4443/catalog/${CATALOG}`, catalogRevision: CATALOG } });

describe("the entry of a page reloading onto a server's world", () => {
  it("installs the server's catalog, geometry tables included, and resolves generated files to the server", async () => {
    launch();
    const { asked, fetcher } = host(complete);
    const installed = await installPageCatalog("https://game.test/generated/", "client", fetcher);
    expect(installed.revision).toBe(CATALOG);
    const catalog = takeInstalledCatalog()!;
    expect(catalog.revision).toBe(CATALOG);
    expect(catalog.tables.worldTerrain).toEqual({ authoredBy: "the server" });
    expect(catalog.tables.regions).toEqual(server.tables.regions);
    expect(catalog.tables.worldResources).toEqual(server.tables.worldResources);
    expect(serverWorld()).toEqual({ revision: SERVER_WORLD, contentAssetUrl: FILES });
    expect(generatedUrl("world/manifest.json")).toBe(`${FILES}generated/world/manifest.json?v=${sha(1)}`);
    expect(generatedUrl("corealm-navmesh.nav")).toBe(`${FILES}generated/corealm-navmesh.nav?v=${sha(2)}`);
    // The build's own file list is never read for a server world.
    expect(asked.some(url => url.startsWith("https://game.test/"))).toBe(false);
  });

  it("boots the build's world when the server's index lacks the baked world, so the join refuses instead of looping", async () => {
    launch();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetcher } = host({ "generated/world/manifest.json": { sha256: sha(1) } });
    await expect(installPageCatalog("https://game.test/generated/", "client", fetcher)).rejects.toThrow(/file list does not match/);
    expect(serverWorld()).toBeNull();
    expect(generatedUrl("world/manifest.json")).not.toContain(FILES);
  });

  it("is not a lab's business: authoring pages install the build's full catalog", async () => {
    launch();
    const { asked, fetcher } = host(complete);
    await expect(installPageCatalog("https://game.test/generated/", "full", fetcher)).rejects.toThrow();
    expect(asked).toEqual(["https://game.test/generated/local-world.json"]);
    expect(serverWorld()).toBeNull();
  });

  it("reads the build's file list, not a server, with no server world pending", async () => {
    const { asked, fetcher } = host(complete);
    await expect(installPageCatalog("https://game.test/generated/", "client", fetcher)).rejects.toThrow(/file list does not match/);
    expect(asked).toEqual(["https://game.test/generated/local-world.json"]);
    expect(serverWorld()).toBeNull();
  });
});
