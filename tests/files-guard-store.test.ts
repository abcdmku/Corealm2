import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdminRouteContext } from "../game/src/multiplayer/adminApi.js";
import { activeFileReferences, setOverlayMotionTiming } from "../game/src/multiplayer/assetManifest.js";
import { createContentAssetStore } from "../game/src/multiplayer/contentAssets.js";
import { CONTENT_MANIFEST_OVERLAY } from "../game/src/multiplayer/contentAssetsContract.js";
import { CREATURE_MOTION_TIMING } from "../game/src/content/creatureMotionTiming.js";
import type { AssetEntry } from "../game/src/render/assets.js";

const ACTOR = { accountId: "acc_OOOOOOOOOOOOOOOOOOOOOO", credential: "session", at: 0 };
const B64 = Buffer.from("bytes").toString("base64");
const dirs: string[] = [];
async function tempDir(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "corealm-guard-")); dirs.push(dir); return dir; }
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

const model = (id: string, file: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({ id, file, pack: "server-uploads", category: "character", is: "animal", tags: [],
  size: { x: 1, y: 1, z: 2 }, base: { x: -.5, y: 0, z: -1 }, bytes: 5, animations: ["Attack"], materials: [], ...extra });
const overlay = (...assets: AssetEntry[]): string => Buffer.from(JSON.stringify({ assets })).toString("base64");

/** What `createAdminApi` hands a feature route, recording the answer. */
function call(store: ReturnType<typeof createContentAssetStore>, method: string, body: Record<string, unknown>) {
  const answer: { status?: number; body?: any } = {};
  const context = {
    method, rest: ["files"], url: new URL("http://x/admin/files"), request: {} as never, response: {} as never,
    scoped: async () => ({ accountId: ACTOR.accountId, tokenId: null, actor: ACTOR }),
    body: async () => body,
    json: (status: number, value: unknown) => { answer.status = status; answer.body = value; },
    fail: (status: number, code: string, message: string): never => { throw Object.assign(new Error(message), { status, code }); },
  } as unknown as AdminRouteContext;
  return store.route(context).then(() => answer, (error: { status: number; code: string; message: string }) => ({ status: error.status, body: { error: { code: error.code, message: error.message } } }));
}

describe("file store guards", () => {
  it("refuses a POST or DELETE whose expected index revision is stale, and accepts the current one", async () => {
    const store = createContentAssetStore({ dir: await tempDir() });
    const first = await store.index();
    const put = await call(store, "POST", { files: { "assets/icons/items/48/a.png": B64 }, expect: first.revision });
    expect(put.status).toBe(200);
    // A second author read the index before that write.
    const stale = await call(store, "POST", { files: { "assets/icons/items/48/b.png": B64 }, expect: first.revision });
    expect(stale).toEqual({ status: 409, body: { error: { code: "stale", message: expect.any(String), revision: put.body.revision } } });
    expect(Object.keys((await store.index()).files)).toEqual(["assets/icons/items/48/a.png"]);
    expect((await call(store, "DELETE", { paths: ["assets/icons/items/48/a.png"], expect: first.revision })).status).toBe(409);
    expect((await call(store, "DELETE", { paths: ["assets/icons/items/48/a.png"], expect: put.body.revision })).status).toBe(200);
    expect((await call(store, "POST", { files: { "assets/icons/items/48/b.png": B64 }, expect: "nope" })).body.error.code).toBe("invalid_request");
    // Without `expect` a write is last-writer-wins, as before.
    expect((await call(store, "POST", { files: { "assets/icons/items/48/b.png": B64 } })).status).toBe(200);
  });

  it("refuses to delete what the active catalog still names, listing the records", async () => {
    const dir = await tempDir();
    let sources: Record<string, unknown> = {
      creatureSkins: [{ id: "deer_frost", maps: { coat: "skins/animal_deer/frost/coat.png" } }],
      audio: { cues: { "ui.bell": { variants: [{ url: "audio/sfx/server/bell.ogg" }] } } },
      items: [{ id: "server_blade" }, { id: "iron_sword__r3__flame" }, { id: "host_icon_item" }],
      creatureDefinitions: [{ id: "moon_t1", presentation: { assetId: "animal_moonhart" } }],
    };
    const base = { files: null as unknown as ReturnType<typeof createContentAssetStore> };
    const hostHas = new Set(["assets/icons/items/48/host_icon_item.png"]);
    const references = activeFileReferences({ sources: async () => sources, files: { index: () => base.files.index(), read: path => base.files.read(path) },
      host: { missingFiles: async paths => paths.filter(path => !hostHas.has(path)) } });
    const store = base.files = createContentAssetStore({ dir, references });
    await store.put({
      "assets/skins/animal_deer/frost/coat.png": B64, "audio/sfx/server/bell.ogg": B64,
      "assets/icons/items/48/server_blade.png": B64, "assets/icons/items/256/server_blade.png": B64, "assets/icons/items/48/iron_sword.png": B64,
      "assets/icons/items/48/host_icon_item.png": B64, "assets/icons/items/48/gone_item.png": B64,
      "assets/models/character/animal_moonhart/animal_moonhart.glb": B64, "assets/models/character/animal_moonhart/fur.png": B64,
      "assets/models/character/unused_model.glb": B64,
      [CONTENT_MANIFEST_OVERLAY]: overlay(model("animal_moonhart", "models/character/animal_moonhart/animal_moonhart.glb"), model("unused_model", "models/character/unused_model.glb")),
    }, ACTOR);

    expect(Object.fromEntries(await references())).toEqual({
      "assets/skins/animal_deer/frost/coat.png": ["creatureSkins/deer_frost"],
      "audio/sfx/server/bell.ogg": ["audio/cues/ui.bell"],
      "assets/icons/items/48/server_blade.png": ["items/server_blade"],
      "assets/icons/items/256/server_blade.png": ["items/server_blade"],
      "assets/icons/items/48/iron_sword.png": ["items/iron_sword__r3__flame"],
      "assets/models/character/animal_moonhart/animal_moonhart.glb": ["creatureDefinitions/moon_t1"],
      "assets/models/character/animal_moonhart/fur.png": ["creatureDefinitions/moon_t1"],
      [CONTENT_MANIFEST_OVERLAY]: ["creatureDefinitions/moon_t1"],
    });

    const refused = await call(store, "DELETE", { paths: ["assets/skins/animal_deer/frost/coat.png", "assets/icons/items/48/gone_item.png"] });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("file_referenced");
    expect(refused.body.error.references).toEqual({ "assets/skins/animal_deer/frost/coat.png": ["creatureSkins/deer_frost"] });
    expect(refused.body.error.message).toContain("creatureSkins/deer_frost");
    // Nothing of a refused request is removed.
    expect((await store.index()).files["assets/icons/items/48/gone_item.png"]).toBeDefined();

    // Free to go: an icon of no item, an icon the host also serves, a model nothing names.
    for (const path of ["assets/icons/items/48/gone_item.png", "assets/icons/items/48/host_icon_item.png", "assets/models/character/unused_model.glb"])
      expect((await call(store, "DELETE", { paths: [path] })).status).toBe(200);
    expect((await call(store, "DELETE", { paths: [CONTENT_MANIFEST_OVERLAY] })).status).toBe(409);

    // Once content stops naming them, they may go.
    sources = { items: [] };
    expect((await call(store, "DELETE", { paths: ["assets/skins/animal_deer/frost/coat.png", CONTENT_MANIFEST_OVERLAY, "assets/models/character/animal_moonhart/fur.png"] })).status).toBe(200);
  });

  it("times an uploaded creature's attack in the server's combat table, and restores a replaced build timing", () => {
    const build = CREATURE_MOTION_TIMING.animal_deer;
    setOverlayMotionTiming([model("animal_moonhart", "models/character/animal_moonhart.glb", { attackSeconds: 1.2, contactNormalized: .45 }),
      model("animal_deer", "models/character/animal_deer.glb", { attackSeconds: 2, contactNormalized: .5 }), model("no_attack", "models/character/no_attack.glb")]);
    expect(CREATURE_MOTION_TIMING.animal_moonhart).toEqual({ seconds: 1.2, contactNormalized: .45 });
    expect(CREATURE_MOTION_TIMING.animal_deer).toEqual({ seconds: 2, contactNormalized: .5 });
    expect(CREATURE_MOTION_TIMING.no_attack).toBeUndefined();
    setOverlayMotionTiming([]);
    expect(CREATURE_MOTION_TIMING.animal_moonhart).toBeUndefined();
    expect(CREATURE_MOTION_TIMING.animal_deer).toEqual(build);
  });
});
