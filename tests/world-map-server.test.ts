import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerWorld, setContentAssetOverlay } from "../game/src/app/config.js";
import { installPageCatalog } from "../game/src/content/catalogEntry.js";
import { takeInstalledCatalog } from "../game/src/content/catalogInstall.js";
import { clientCatalog } from "../game/src/content/clientCatalog.js";
import {
  WORLD_MAP_DETAIL_RENDITIONS, WORLD_MAP_MINIMAP_RENDITION, WORLD_MAP_TILED_LEVELS,
} from "../game/src/generated/worldMapFingerprint.js";
import { storePendingLaunch } from "../game/src/multiplayer/playIntent.js";
import { parseServerWorldMap, serverWorldMap, setServerWorldMap, worldMapUrl } from "../game/src/world/serverWorldMap.js";
import { repoRoot } from "../tools/lib/paths.js";

/*
  A live server's own world map (`game/src/world/serverWorldMap.ts`): the page that booted the
  server's baked world draws the map the server rendered for that world, and nothing else. A map
  rendered for another world, in another frame, or missing a file is refused, and the build's files
  are then read from the asset base, never through the server's file overlay.
*/

const WORLD = "b".repeat(64), OTHER = "d".repeat(64), CATALOG = "c".repeat(64);
const FILES = "https://ravenwood.test:4443/content-assets/";
const committed = JSON.parse(readFileSync(path.join(repoRoot, "game/public/generated/world-map.json"), "utf8")) as Record<string, unknown>;
const serverSha = "e".repeat(64);

/** The committed metadata as a server would store it: every file re-rendered, for `worldRevision`. */
function serverMetadata(worldRevision: string, change: (value: Record<string, any>) => void = () => {}): Record<string, unknown> {
  const value = JSON.parse(JSON.stringify(committed)) as Record<string, any>;
  value.worldRevision = worldRevision;
  delete value.sourceImage;
  value.renditions.minimap.sha256 = serverSha;
  for (const rendition of value.renditions.detail) rendition.sha256 = serverSha;
  for (const level of value.renditions.tiled) for (const tile of level.tiles) tile.sha256 = serverSha;
  change(value);
  return value;
}

const globals = globalThis as { sessionStorage?: Storage; document?: { baseURI: string } };
beforeEach(() => {
  const values = new Map<string, string>();
  globals.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, String(value)); }, removeItem: key => { values.delete(key); } } as Storage;
  globals.document = { baseURI: "https://game.test/" };
  resetServerWorld(); setContentAssetOverlay(null); setServerWorldMap(null);
});
afterEach(() => { delete globals.sessionStorage; delete globals.document; setServerWorldMap(null); vi.restoreAllMocks(); });

describe("a server's world map", () => {
  it("is accepted for the world it shows, in the build's frame, with every file", () => {
    const map = parseServerWorldMap(serverMetadata(WORLD), WORLD)!;
    expect(map.worldRevision).toBe(WORLD);
    expect(map.files.size).toBe(1 + WORLD_MAP_DETAIL_RENDITIONS.length + WORLD_MAP_TILED_LEVELS.reduce((sum, level) => sum + level.tiles.length, 0));
    expect(map.files.get(WORLD_MAP_MINIMAP_RENDITION.path)).toBe(serverSha);
  });

  it("is refused for another world, another frame, a missing tile or no revision", () => {
    expect(parseServerWorldMap(serverMetadata(OTHER), WORLD)).toBeUndefined();
    expect(parseServerWorldMap(serverMetadata(WORLD, value => { value.imageBounds.maxX += 150; }), WORLD)).toBeUndefined();
    expect(parseServerWorldMap(serverMetadata(WORLD, value => { value.renditions.tiled[0].tiles.pop(); }), WORLD)).toBeUndefined();
    expect(parseServerWorldMap(serverMetadata(WORLD, value => { delete value.worldRevision; }), WORLD)).toBeUndefined();
    expect(parseServerWorldMap(committed, WORLD)).toBeUndefined();
  });

  it("routes map files to the server only while its map is accepted", () => {
    setContentAssetOverlay({ base: FILES, files: { [WORLD_MAP_MINIMAP_RENDITION.path]: { sha256: serverSha } } });
    // A map the server rendered for another world is in its store, but the page draws the build's.
    expect(worldMapUrl(WORLD_MAP_MINIMAP_RENDITION)).toBe(`https://game.test/${WORLD_MAP_MINIMAP_RENDITION.path}?v=${WORLD_MAP_MINIMAP_RENDITION.sha256}`);
    setServerWorldMap(parseServerWorldMap(serverMetadata(WORLD), WORLD)!);
    expect(worldMapUrl(WORLD_MAP_MINIMAP_RENDITION)).toBe(`${FILES}${WORLD_MAP_MINIMAP_RENDITION.path}?v=${serverSha}`);
  });
});

describe("the entry of a page reloading onto a server's world", () => {
  const compiled = JSON.parse(readFileSync(path.join(repoRoot, "game/content/compiled/catalog.json"), "utf8")) as { revision: string; tables: Record<string, unknown> };
  const catalog = clientCatalog({ ...compiled, revision: CATALOG });
  const index = { "generated/world/manifest.json": { sha256: "1".repeat(64) }, "generated/corealm-navmesh.nav": { sha256: "2".repeat(64) }, "generated/world-map.json": { sha256: "3".repeat(64) } };
  const host = (metadata: unknown) => (async (input: string | URL) => {
    const url = String(input);
    if (url === `${FILES}index.json`) return Response.json({ revision: "r1", files: index });
    if (url === `https://ravenwood.test:4443/catalog/${CATALOG}`) return new Response(JSON.stringify(catalog));
    if (url === `${FILES}generated/world-map.json?v=${"3".repeat(64)}`) return Response.json(metadata);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const launch = () => storePendingLaunch({ providerId: "ravenwood", worldId: "main", attempts: 1, world: {
    revision: WORLD, contentAssetUrl: FILES, catalogUrl: `https://ravenwood.test:4443/catalog/${CATALOG}`, catalogRevision: CATALOG } });

  // One install per file: `installCatalog` refuses once content modules have evaluated. The refusal of a
  // map rendered for another world is `parseServerWorldMap`'s, tested above.
  it("adopts the server's map rendered for that world", async () => {
    launch();
    await installPageCatalog("https://game.test/generated/", "client", host(serverMetadata(WORLD)));
    takeInstalledCatalog();
    expect(serverWorldMap()?.worldRevision).toBe(WORLD);
  });
});
