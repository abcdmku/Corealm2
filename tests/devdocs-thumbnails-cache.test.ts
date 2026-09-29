import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setBackend, type DevdocsBackend, type DevdocsCapabilities } from "../devdocs/src/api/backend.js";

/**
 * A rendered thumbnail is kept where the mode can keep it: the checkout's own cache route, or a live
 * server's asset store at `assets/thumbnails/<key>.png`, read back through the store's index.
 * The GPU is replaced by a renderer that "draws" a fixed PNG, so the test counts renders.
 */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SHA = "ab".repeat(32), KEY = `boulder-${SHA.slice(0, 16)}-r2`;
let renders = 0;

vi.mock("three/webgpu", async original => ({
  ...await original<typeof import("three/webgpu")>(),
  WebGPURenderer: class {
    shadowMap = {}; info = { render: { triangles: 12 } }; backend = { isWebGPUBackend: true };
    onDeviceLost?: () => void; outputColorSpace = ""; toneMapping = 0; toneMappingExposure = 1;
    async init() {} setPixelRatio() {} setSize() {} setClearColor() {} setOutputRenderTarget() {} dispose() {}
    async readRenderTargetPixelsAsync(_target: unknown, _x: number, _y: number, width: number, height: number) { return new Uint8Array(width * height * 4); }
    render() { renders++; }
    async compileAsync() {}
  },
  PMREMGenerator: class { fromScene() { return { texture: {}, dispose() {} }; } dispose() {} },
}));
vi.mock("../devdocs/src/viewer/creature.js", () => ({
  loadAssetModel: async () => {
    const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    return { root, animationRoot: root, clips: [], clipGroups: new Map(), parts: [], attachments: [], missingBones: [], dispose() {} };
  },
}));
vi.mock("../devdocs/src/viewer/registry.js", async original => ({
  ...await original<typeof import("../devdocs/src/viewer/registry.js")>(),
  viewerRegistry: async () => ({ entry: (id: string) => id === "boulder" ? { id, category: "prop", sha256: SHA } : undefined }),
}));

const NONE: DevdocsCapabilities = { write: true, meta: true, requests: true, git: false, bulk: true, assets: false, formulas: false, files: false, imagegen: false, publish: true };
let putFiles: ReturnType<typeof vi.fn>;
function install(kind: "repo" | "server", capabilities: Partial<DevdocsCapabilities>): void {
  putFiles = vi.fn(async (files: Record<string, string>) => {
    const { setContentFiles } = await import("../devdocs/src/viewer/registry.js");
    setContentFiles("https://play.example.com/content-assets/", Object.fromEntries(Object.keys(files).map(path => [path, { sha256: "cd".repeat(32) }])));
    return { files: Object.fromEntries(Object.keys(files).map(path => [path, { sha256: "cd".repeat(32), bytes: 67 }])) };
  });
  setBackend({ kind, label: kind, assetBaseUrl: kind === "server" ? "https://assets.example.com/corealm/" : "", capabilities: { ...NONE, ...capabilities }, putFiles } as Partial<DevdocsBackend> as DevdocsBackend);
}

beforeEach(async () => {
  renders = 0;
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }), baseURI: "http://localhost:5173/" });
  vi.stubGlobal("ImageData", class { data: Uint8ClampedArray; constructor(width: number, height: number) { this.data = new Uint8ClampedArray(width * height * 4); } });
  vi.stubGlobal("OffscreenCanvas", class {
    getContext() { return { putImageData() {} }; }
    async convertToBlob() { return new Blob([Buffer.from(PNG.split(",")[1]!, "base64")]); }
  });
  (await import("../devdocs/src/viewer/registry.js")).setContentFiles("", {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("thumbnail cache", () => {
  it("reads and writes the checkout's cache route", async () => {
    install("repo", { assets: true, files: true });
    const fetch = vi.fn(async (_url: string, init: RequestInit) => new Response(init.method === "HEAD" ? null : "{}", { status: init.method === "HEAD" ? 404 : 200 }));
    vi.stubGlobal("fetch", fetch);
    const { createThumbnailProvider } = await import("../devdocs/src/viewer/thumbnailRenderer.js");
    expect(await createThumbnailProvider()("boulder")).toBe(PNG);
    // First the list of thumbnails shipped with the build (none here), then the checkout's cache.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls.map(([url, init]) => `${init.method ?? "GET"} ${url}`)).toEqual([`GET http://localhost:5173/assets/thumbnails/index.json`, `HEAD /__devdocs/thumbnails/${KEY}.png`, `PUT /__devdocs/thumbnails/${KEY}.png`]);
    expect(putFiles).not.toHaveBeenCalled();

    fetch.mockImplementation(async () => new Response(null, { status: 200, headers: { "Content-Type": "image/png" } }));
    expect(await createThumbnailProvider()("boulder")).toBe(`/__devdocs/thumbnails/${KEY}.png`);
    expect(renders).toBe(1);
  });

  it("stores a live server's renders in its asset store, batched, and shows them from there", async () => {
    vi.useFakeTimers();
    install("server", { files: true });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { createThumbnailProvider } = await import("../devdocs/src/viewer/thumbnailRenderer.js");
    expect(await createThumbnailProvider()("boulder")).toBe(PNG);
    expect(putFiles).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(putFiles).toHaveBeenCalledExactlyOnceWith({ [`assets/thumbnails/${KEY}.png`]: PNG.slice("data:image/png;base64,".length) });

    // The next session knows it from the store's index, without asking anyone.
    expect(await createThumbnailProvider()("boulder")).toBe(`https://play.example.com/content-assets/assets/thumbnails/${KEY}.png?v=${"cd".repeat(6)}`);
    expect(renders).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders every time where nothing can be kept", async () => {
    install("server", {});
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { createThumbnailProvider } = await import("../devdocs/src/viewer/thumbnailRenderer.js");
    expect(await createThumbnailProvider()("boulder")).toBe(PNG);
    expect(await createThumbnailProvider()("absent_asset")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(putFiles).not.toHaveBeenCalled();
  });
});
