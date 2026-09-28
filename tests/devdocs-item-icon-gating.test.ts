import { describe, expect, it } from "vitest";
import { setBackend, type DevdocsBackend, type DevdocsCapabilities } from "../devdocs/src/api/backend.js";
import type { MetaPatch } from "../devdocs/shared/metaContracts.js";
import type { ImagegenRequest } from "../devdocs/shared/skinContracts.js";
import { iconBlock, itemIconPrompt, repoIcons, reviewIcon, startIconJob, storeUpload, type IconUpload } from "../devdocs/src/workspaces/items/iconApi.js";
import { itemIconArtworkId } from "../game/src/ui/itemIcons.js";

/*
  The item icon panel offers each action only where the backend can do it, and on a live server an
  upload is two stored files and a candidate record, a review one metadata patch, a generation one
  icon job.
*/

const SERVER: DevdocsCapabilities = { write: true, meta: true, requests: true, git: false, bulk: false, assets: false, formulas: false, files: true, imagegen: true, publish: true };
const REVISION = "c".repeat(64);

function fakeServer(capabilities: Partial<DevdocsCapabilities> = {}) {
  const puts: Record<string, string>[] = [], patches: { collection: string; id: string; patch: MetaPatch }[] = [], jobs: ImagegenRequest[] = [];
  const backend = {
    kind: "server", label: "test server", capabilities: { ...SERVER, ...capabilities }, assetBaseUrl: "https://assets.example/",
    get: async <T,>(path: string) => { expect(path).toBe("meta/items/air_orb"); return { collection: "items", entityId: "air_orb", revision: REVISION, data: {} } as T; },
    patchMeta: async (collection: string, id: string, patch: MetaPatch) => { patches.push({ collection, id, patch }); return { collection, entityId: id, revision: REVISION, data: {} }; },
    putFiles: async (files: Record<string, string>) => { puts.push(files); return { files: {} }; },
    imagegen: { start: async (request: ImagegenRequest) => { jobs.push(request); return { id: "j" } as never; }, list: async () => [], retry: async () => ({}) as never },
  } as unknown as DevdocsBackend;
  return { backend, puts, patches, jobs };
}

const upload = (): IconUpload => ({
  name: "air_orb.png", original: new Blob([new Uint8Array([1, 2, 3])]), sha256: "d".repeat(64), width: 1024, height: 1024,
  master: new Blob([new Uint8Array([4, 5])]), game: new Blob([new Uint8Array([6])]), masterUrl: "blob:m", gameUrl: "blob:g",
});

describe("item icon panel gating", () => {
  it("says why each action cannot run", () => {
    setBackend(fakeServer({ write: false }).backend);
    expect([iconBlock("generate"), iconBlock("upload"), iconBlock("review")]).toEqual(Array(3).fill("This editor is read only."));
    setBackend(fakeServer({ imagegen: false, files: false, meta: false }).backend);
    expect(iconBlock("generate")).toBe("Image generation does not run here.");
    expect(iconBlock("upload")).toContain("no file store");
    expect(iconBlock("review")).toContain("metadata store");
    setBackend(fakeServer().backend);
    expect([repoIcons(), iconBlock("generate"), iconBlock("upload"), iconBlock("review")]).toEqual([false, undefined, undefined, undefined]);
    setBackend(fakeServer({ assets: true, git: true, publish: false, files: false, meta: false }).backend);
    // The checkout's own icon routes store and review; they need neither the file store nor server metadata.
    expect([repoIcons(), iconBlock("upload"), iconBlock("review")]).toEqual([true, undefined, undefined]);
  });

  it("on a live server stores both sizes, then records the candidate; review and generation are one call each", async () => {
    const server = fakeServer();
    setBackend(server.backend);
    await storeUpload("air_orb", upload(), "A swirling air orb");
    expect(server.puts).toEqual([{ "assets/icons/items/256/air_orb.png": "BAU=", "assets/icons/items/48/air_orb.png": "Bg==" }]);
    expect(server.patches).toHaveLength(1);
    expect(server.patches[0]).toMatchObject({ collection: "items", id: "air_orb", patch: { revision: REVISION, operation: { kind: "icon", status: "candidate", sha256: "d".repeat(64), prompt: "A swirling air orb" } } });

    await reviewIcon("air_orb", "approved");
    expect(server.patches[1]!.patch.operation).toEqual({ kind: "icon", status: "approved" });

    await startIconJob("air_orb", "Air Orb", "A swirling air orb");
    expect(server.jobs).toEqual([{ kind: "icon", itemId: "air_orb", assetId: "", name: "Air Orb", prompt: "A swirling air orb", references: {} }]);
  });

  it("writes a first prompt from the item and knows which artwork an item draws", () => {
    const prompt = itemIconPrompt({ name: "Cobalt Sword", description: "A keen cobalt blade.", tier: 10, material: "Cobalt", kind: "sword", purpose: "worn in the main hand slot" });
    expect(prompt).toContain("inventory icon for Cobalt Sword");
    expect(prompt).toContain("Authored description: A keen cobalt blade.");
    expect(prompt).toContain("Subject: Cobalt Sword, a single Cobalt sword, tier 10, worn in the main hand slot.");
    expect(prompt).toContain("Genuine transparent alpha background");
    expect(itemIconArtworkId("air_orb")).toBe("air_orb");
    expect(itemIconArtworkId("dragonhide_boots")).toBe("starhide_boots");
  });
});

describe("item icon sources on a live server", () => {
  it("resolves icons when the game's asset base is another origin", async () => {
    const { resetPublicBaseUrl, setPublicBaseUrl } = await import("../game/src/app/config.js");
    const { setContentFiles } = await import("../devdocs/src/model/serverFiles.js");
    const { itemIconSources } = await import("../devdocs/src/ui/Thumb.js");
    setBackend(fakeServer().backend);
    resetPublicBaseUrl(); setPublicBaseUrl("https://assets.example/");
    try {
      setContentFiles("https://server.example/content-assets/", { "assets/icons/items/256/starhide_boots.png": { sha256: "e".repeat(64) } });
      expect(itemIconSources("air_orb", true)).toEqual(["https://assets.example/assets/icons/items/48/air_orb.png"]);
      expect(itemIconSources("dragonhide_boots", true)).toEqual([
        `https://server.example/content-assets/assets/icons/items/256/starhide_boots.png?v=${"e".repeat(12)}`,
        "https://assets.example/assets/icons/items/48/starhide_boots.png",
      ]);
    } finally { setContentFiles("", {}); resetPublicBaseUrl(); }
  });
});
