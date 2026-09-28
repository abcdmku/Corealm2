import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatedUrl, resetServerWorld, serverWorld, setContentAssetOverlay } from "../game/src/app/config.js";
import { installPageCatalog } from "../game/src/content/catalogEntry.js";
import { takeInstalledCatalog } from "../game/src/content/catalogInstall.js";
import { clientCatalog } from "../game/src/content/clientCatalog.js";
import { storePendingLaunch } from "../game/src/multiplayer/playIntent.js";
import { repoRoot } from "../tools/lib/paths.js";
import { manifestOverlayEntries, setManifestOverlay } from "../game/src/render/assets.js";

/**
 * A page reloading onto a server's baked world installs that server's model overlay in the entry, before boot.
 * Every registry the scene builds then resolves its models from the first frame.
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
const OVERLAY = "assets/manifest.overlay.json";
const MOONHART = { id: "animal_moonhart", file: "models/character/animal_moonhart/animal_moonhart.glb", pack: "server-uploads", category: "character", is: "animal", tags: [],
  size: { x: 1, y: 2, z: 2 }, base: { x: -.5, y: 0, z: -1 }, bytes: 10, animations: ["Attack"], materials: [], attackSeconds: 1.08, contactNormalized: 0.43 };
afterEach(() => setManifestOverlay(null));

describe("a server's models before boot", () => {
  it("installs the overlay the server's index lists before the app is imported", async () => {
    storePendingLaunch({ providerId: "ravenwood", worldId: "main", attempts: 1, world: {
      revision: SERVER_WORLD, contentAssetUrl: FILES, catalogUrl: `https://ravenwood.test:4443/catalog/${CATALOG}`, catalogRevision: CATALOG } });
    const complete = { "generated/world/manifest.json": { sha256: sha(1) }, "generated/corealm-navmesh.nav": { sha256: sha(2) }, [OVERLAY]: { sha256: sha(3) } };
    const { asked, fetcher } = host(complete);
    const overlayFetch = (async (input: string | URL, init?: RequestInit) => String(input).startsWith(`${FILES}${OVERLAY}`)
      ? Response.json({ assets: [MOONHART, { id: "../bad" }] }) : fetcher(input, init)) as typeof fetch;
    await installPageCatalog("https://game.test/generated/", "client", overlayFetch);
    expect(manifestOverlayEntries()).toEqual([MOONHART]);
    expect(asked).not.toContain("https://game.test/generated/local-world.json");
  });

  it("boots without the models when the overlay cannot be read", async () => {
    storePendingLaunch({ providerId: "ravenwood", worldId: "main", attempts: 1, world: {
      revision: SERVER_WORLD, contentAssetUrl: FILES, catalogUrl: `https://ravenwood.test:4443/catalog/${CATALOG}`, catalogRevision: CATALOG } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetcher } = host({ "generated/world/manifest.json": { sha256: sha(1) }, "generated/corealm-navmesh.nav": { sha256: sha(2) }, [OVERLAY]: { sha256: sha(3) } });
    const installed = await installPageCatalog("https://game.test/generated/", "client", fetcher);
    expect(installed.revision).toBe(CATALOG);
    expect(serverWorld()).toEqual({ revision: SERVER_WORLD, contentAssetUrl: FILES });
    expect(manifestOverlayEntries()).toEqual([]);
  });
});
