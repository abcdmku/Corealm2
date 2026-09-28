import { afterEach, describe, expect, it, vi } from "vitest";
import { assetUrl, contentAssetOverride, publicUrl, resetPublicBaseUrl, setContentAssetOverlay, setPublicBaseUrl } from "../game/src/app/config.js";
import { contentAssetFiles, createContentAssetOverlay } from "../game/src/app/contentAssetOverlay.js";
import type { CreatureSkin } from "../game/src/content/schema/creatureSkins.js";
import type { ItemDef } from "../game/src/contracts.js";
import { configureAssetDelivery, deliveryUrl } from "../game/src/render/assetDelivery.js";
import { CreatureLooks } from "../game/src/render/creatureSkins.js";
import { itemIconUrl } from "../game/src/ui/itemIcons.js";

const SERVER = "https://ravenwood.test:4443/content-assets/";
const SHA = "a".repeat(64), OTHER = "b".repeat(64);
const MAP = "assets/skins/animal_deer/frost/coat.png";

afterEach(() => { setContentAssetOverlay(null); resetPublicBaseUrl(); configureAssetDelivery("/assets/"); vi.unstubAllGlobals(); });

describe("content asset overlay", () => {
  it("sends a path the joined server stores to the server, pinned to its hash, and every other path to the asset host", () => {
    setPublicBaseUrl("https://assets.test/corealm/");
    expect(assetUrl("skins/animal_deer/frost/coat.png")).toBe("https://assets.test/corealm/assets/skins/animal_deer/frost/coat.png");
    setContentAssetOverlay({ base: SERVER, files: { [MAP]: { sha256: SHA }, "audio/sfx/server/bell.ogg": { sha256: OTHER } } });
    expect(assetUrl("skins/animal_deer/frost/coat.png")).toBe(`${SERVER}${MAP}?v=${SHA}`);
    expect(publicUrl(`/${MAP}`)).toBe(`${SERVER}${MAP}?v=${SHA}`);
    // Audio paths are the catalogue's own, relative to the public root.
    expect(publicUrl("audio/sfx/server/bell.ogg")).toBe(`${SERVER}audio/sfx/server/bell.ogg?v=${OTHER}`);
    expect(publicUrl("audio/sfx/base/bell.ogg")).toBe("https://assets.test/corealm/audio/sfx/base/bell.ogg");
    expect(publicUrl("assets/manifest.json")).toBe("https://assets.test/corealm/assets/manifest.json");
    expect(contentAssetOverride("assets/skins/animal_deer/other/coat.png")).toBeNull();
    setContentAssetOverlay(null);
    expect(assetUrl("skins/animal_deer/frost/coat.png")).toBe("https://assets.test/corealm/assets/skins/animal_deer/frost/coat.png");
  });

  it("resolves item icons, creature skin maps and delivered textures through it", async () => {
    setContentAssetOverlay({ base: SERVER, files: { "assets/icons/items/48/server_blade.png": { sha256: SHA }, [MAP]: { sha256: SHA }, "assets/textures/corealm/stone.png": { sha256: OTHER } } });
    expect(itemIconUrl({ id: "server_blade", category: "equipment" } as ItemDef)).toBe(`${SERVER}assets/icons/items/48/server_blade.png?v=${SHA}`);
    expect(itemIconUrl({ id: "bronze_bar", category: "bar" } as ItemDef)).toMatch(/\/assets\/icons\/items\/48\/bronze_bar\.png$/);

    const loaded: string[] = [];
    const looks = new CreatureLooks({ baseUrl: () => "https://assets.test/assets/", skin: id => skins.find(skin => skin.id === id),
      loadImage: async url => { loaded.push(url); return { width: 4, height: 4 } as unknown as HTMLCanvasElement; } });
    const skins: CreatureSkin[] = [{ id: "frost", assetId: "animal_deer", name: "Frost", kind: "upload", createdAt: "2026-09-27T00:00:00Z",
      maps: { coat: "skins/animal_deer/frost/coat.png", antler: "skins/animal_deer/frost/antler.png" } }];
    await looks.whenLoaded(looks.resolve("animal_deer", "frost")!);
    expect(loaded.sort()).toEqual(["https://assets.test/assets/skins/animal_deer/frost/antler.png", `${SERVER}${MAP}?v=${SHA}`]);

    vi.stubGlobal("document", { baseURI: "https://game.test/" });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    configureAssetDelivery("/assets/", {}, { "textures/corealm/stone.png": "optimized/stone.webp" });
    // The server's file replaces the host's file and its optimized variant.
    expect(deliveryUrl("/assets/textures/corealm/stone.png")).toBe(`${SERVER}assets/textures/corealm/stone.png?v=${OTHER}`);
    expect(deliveryUrl(`${SERVER}assets/textures/corealm/stone.png?v=${OTHER}`)).toBe(`${SERVER}assets/textures/corealm/stone.png?v=${OTHER}`);
  });

  it("loads the joined world's index, drops a stale load, ignores bad entries and clears on leave", async () => {
    const answers = new Map<string, { resolve(value: Response): void }>();
    const fetcher = vi.fn((url: string) => new Promise<Response>(resolve => answers.set(url, { resolve })));
    const failed = vi.fn();
    const overlay = createContentAssetOverlay({ fetch: fetcher as unknown as typeof fetch, failed });
    const index = (files: Record<string, unknown>) => new Response(JSON.stringify({ revision: "r", files }));

    const first = overlay.enter("https://one.test/content-assets/");
    const second = overlay.enter("https://two.test/content-assets/");
    answers.get("https://two.test/content-assets/index.json")!.resolve(index({ [MAP]: { sha256: OTHER } }));
    await second;
    answers.get("https://one.test/content-assets/index.json")!.resolve(index({ [MAP]: { sha256: SHA } }));
    await first;
    expect(contentAssetOverride(MAP)).toBe(`https://two.test/content-assets/${MAP}?v=${OTHER}`);

    const refreshed = overlay.refresh();
    answers.get("https://two.test/content-assets/index.json")!.resolve(index({ [MAP]: { sha256: SHA }, "../escape.png": { sha256: SHA }, "assets/skins/a/b/c.png": { sha256: "short" } }));
    await refreshed;
    expect(contentAssetOverride(MAP)).toBe(`https://two.test/content-assets/${MAP}?v=${SHA}`);
    expect(contentAssetOverride("assets/skins/a/b/c.png")).toBeNull();

    overlay.leave();
    expect(contentAssetOverride(MAP)).toBeNull();
    await overlay.enter(undefined);
    expect(overlay.base).toBeNull();
    expect(failed).not.toHaveBeenCalled();

    const broken = overlay.enter("https://three.test/content-assets/");
    answers.get("https://three.test/content-assets/index.json")!.resolve(new Response("nope", { status: 500 }));
    await broken;
    expect(failed).toHaveBeenCalledOnce();
    expect(contentAssetOverride(MAP)).toBeNull();
    expect(() => contentAssetFiles([])).toThrow();
  });
});
