import { afterEach, describe, expect, it, vi } from "vitest";
import { setContentAssetOverlay } from "../game/src/app/config.js";
import { createContentAssetOverlay } from "../game/src/app/contentAssetOverlay.js";
import { CONTENT_MANIFEST_OVERLAY } from "../game/src/multiplayer/contentAssetsContract.js";
import { AssetRegistry, manifestOverlayEntries, setManifestOverlay, type AssetEntry, type AssetManifest } from "../game/src/render/assets.js";
import { editManifestOverlay, mergeManifestEntries, parseManifestOverlay } from "../game/src/render/manifestOverlay.js";

const model = (id: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({ id, file: `models/character/${id}.glb`, pack: "host", category: "character",
  is: "animal", tags: [], bytes: 10, size: { x: 1, y: 1, z: 1 }, base: { x: -0.5, y: 0, z: -0.5 }, animations: ["Walk"], materials: ["Coat"], ...extra });
const HOST: AssetManifest = { generatedAt: "2026-09-27T00:00:00Z", packs: [], assets: [model("animal_deer"), model("animal_frog")] };
const SERVER = "https://ravenwood.test:4443/content-assets/";
const SHA = "c".repeat(64);

afterEach(() => { setManifestOverlay(null); setContentAssetOverlay(null); vi.unstubAllGlobals(); });

describe("model manifest overlay", () => {
  it("merges over the host by id: the overlay wins in place and adds new ids after", () => {
    const replaced = model("animal_frog", { pack: "server", size: { x: 2, y: 2, z: 2 } });
    expect(mergeManifestEntries(HOST.assets, [model("animal_moonhart", { pack: "server" }), replaced]).map(entry => [entry.id, entry.pack]))
      .toEqual([["animal_deer", "host"], ["animal_frog", "server"], ["animal_moonhart", "server"]]);
  });

  it("keeps only entries a client may use, and edits one entry at a time", () => {
    const parsed = parseManifestOverlay({ assets: [model("animal_moonhart"), { ...model("bad"), file: "../escape.glb" }, { ...model("Upper") },
      { ...model("no_size"), size: { x: "1" } }, model("animal_moonhart", { pack: "second" })] });
    expect(parsed.map(entry => [entry.id, entry.pack])).toEqual([["animal_moonhart", "host"]]);
    expect(parseManifestOverlay("not json")).toEqual([]);
    const added = editManifestOverlay(parsed, { entry: model("animal_ghost") });
    expect(added.assets.map(entry => entry.id)).toEqual(["animal_moonhart", "animal_ghost"]);
    expect(editManifestOverlay(added.assets, { remove: "animal_moonhart" }).assets.map(entry => entry.id)).toEqual(["animal_ghost"]);
    expect(() => editManifestOverlay([], { entry: { ...model("x"), file: "icons/x.png" } })).toThrow(/file must be/);
  });

  it("is what every registry reads, loads the overlay model from its own URL, and is gone when cleared", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => structuredClone(HOST) })));
    const registry = new AssetRegistry({ manifestUrl: "https://assets.test/assets/manifest.json", assetBaseUrl: "https://assets.test/assets/" });
    registry.registerBuilt("procedural_blade", new (await import("three")).Group());
    await registry.loadManifest();
    expect(registry.entry("animal_moonhart")).toBeUndefined();

    const fileUrl = vi.fn((path: string) => path === "assets/models/character/animal_moonhart.glb" ? `${SERVER}${path}?v=${SHA}` : null);
    setManifestOverlay({ entries: [model("animal_moonhart", { size: { x: 3, y: 2, z: 1 } }), model("animal_deer", { size: { x: 9, y: 9, z: 9 } }), model("procedural_blade")], fileUrl });
    expect(registry.entry("animal_moonhart")?.size).toEqual({ x: 3, y: 2, z: 1 });
    expect(registry.assetSize("animal_deer")).toEqual({ x: 9, y: 9, z: 9 });
    expect(registry.byCategory("character").map(entry => entry.id)).toEqual(["animal_deer", "animal_frog", "animal_moonhart"]);
    // A server's entry never shadows a mesh the page builds itself.
    expect(registry.entry("procedural_blade")).toBeUndefined();
    expect(registry.getManifest()!.assets).toHaveLength(3);

    // The GLB is fetched from where the overlay says, not from the asset host.
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | Request) => { requested.push(typeof url === "string" ? url : url.url); return new Response(null, { status: 404 }); }));
    await registry.load("animal_moonhart").catch(() => undefined);
    expect(requested.some(url => url.startsWith(`${SERVER}assets/models/character/animal_moonhart.glb`))).toBe(true);

    setManifestOverlay(null);
    expect(registry.entry("animal_moonhart")).toBeUndefined();
    expect(registry.assetSize("animal_deer")).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("follows the joined server: its index names the overlay, the client reads it on enter and drops it on leave", async () => {
    const overlay = { assets: [model("animal_moonhart", { pack: "server" })] };
    const fetcher = vi.fn(async (url: string) => url.endsWith("index.json")
      ? new Response(JSON.stringify({ revision: "r", files: { [CONTENT_MANIFEST_OVERLAY]: { sha256: SHA }, "assets/models/character/animal_moonhart.glb": { sha256: SHA } } }))
      : url === `${SERVER}${CONTENT_MANIFEST_OVERLAY}?v=${SHA}` ? new Response(JSON.stringify(overlay)) : new Response(null, { status: 404 }));
    const files = createContentAssetOverlay({ fetch: fetcher as unknown as typeof fetch });
    await files.enter(SERVER);
    expect(manifestOverlayEntries().map(entry => entry.id)).toEqual(["animal_moonhart"]);
    files.leave();
    expect(manifestOverlayEntries()).toEqual([]);

    // A server without an overlay adds no models.
    const plain = createContentAssetOverlay({ fetch: (async () => new Response(JSON.stringify({ revision: "r", files: {} }))) as unknown as typeof fetch });
    await plain.enter(SERVER);
    expect(manifestOverlayEntries()).toEqual([]);
  });
});
