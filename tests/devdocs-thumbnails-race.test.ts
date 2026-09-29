import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setBackend, type DevdocsBackend, type DevdocsCapabilities } from "../devdocs/src/api/backend.js";

/**
 * Thumbnails share one stage. Compiling pipelines yields, so a second render could put its model on
 * the stage while the first waits, and the first would photograph the wrong model. The fake GPU here
 * yields in `compileAsync` and "draws" whatever model is on the stage at `render`.
 */
let drawn = "";

vi.mock("three/webgpu", async original => ({
  ...await original<typeof import("three/webgpu")>(),
  WebGPURenderer: class {
    shadowMap = {}; info = { render: { triangles: 12 } }; backend = { isWebGPUBackend: true };
    onDeviceLost?: () => void; outputColorSpace = ""; toneMapping = 0; toneMappingExposure = 1;
    async init() {} setPixelRatio() {} setSize() {} setClearColor() {} setOutputRenderTarget() {} dispose() {}
    /** The copy is queued with the draw: it holds what was drawn then, one opaque pixel per character. */
    async readRenderTargetPixelsAsync(_target: unknown, _x: number, _y: number, width: number, height: number) {
      const pixels = new Uint8Array(width * height * 4);
      [...drawn].forEach((char, index) => pixels.set([char.charCodeAt(0), 0, 0, 255], index * 4));
      await new Promise(resolve => setTimeout(resolve, 5));
      return pixels;
    }
    async compileAsync() { await new Promise(resolve => setTimeout(resolve, 5)); }
    render(scene: THREE.Scene) {
      const names: string[] = [];
      scene.traverse(object => { if (object.name.startsWith("model:")) names.push(object.name); });
      drawn = names.join(",");
    }
  },
  PMREMGenerator: class { fromScene() { return { texture: {}, dispose() {} }; } dispose() {} },
}));
vi.mock("../devdocs/src/viewer/creature.js", () => ({
  loadAssetModel: async ({ assetId }: { assetId: string }) => {
    const root = new THREE.Group(); root.name = `model:${assetId}`; root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    return { root, animationRoot: root, clips: [], clipGroups: new Map(), parts: [], attachments: [], missingBones: [], dispose() {} };
  },
}));
vi.mock("../devdocs/src/viewer/registry.js", async original => ({
  ...await original<typeof import("../devdocs/src/viewer/registry.js")>(),
  viewerRegistry: async () => ({ entry: (id: string) => ({ id, category: "prop", sha256: "ab".repeat(32) }) }),
}));

const CAPABILITIES: DevdocsCapabilities = { write: true, meta: false, requests: false, git: false, bulk: false, assets: false, formulas: false, files: false, imagegen: false, publish: false };

beforeEach(() => {
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }), baseURI: "http://localhost:5173/" });
  vi.stubGlobal("ImageData", class { data: Uint8ClampedArray; constructor(width: number, height: number) { this.data = new Uint8ClampedArray(width * height * 4); } });
  // The "PNG" is the red channel of the opaque pixels, so the test reads back what was drawn.
  vi.stubGlobal("OffscreenCanvas", class {
    image?: ImageData;
    getContext() { return { putImageData: (image: ImageData) => { this.image = image; } }; }
    async convertToBlob() {
      const text: number[] = [];
      for (let at = 0; this.image!.data[at + 3] === 255; at += 4) text.push(this.image!.data[at]!);
      return new Blob([String.fromCharCode(...text)]);
    }
  });
  setBackend({ kind: "repo", label: "repo", assetBaseUrl: "", capabilities: CAPABILITIES } as Partial<DevdocsBackend> as DevdocsBackend);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("thumbnail stage", () => {
  it("photographs each model on its own, however many render at once", async () => {
    const { createThumbnailProvider } = await import("../devdocs/src/viewer/thumbnailRenderer.js");
    const provide = createThumbnailProvider();
    const ids = ["cow", "frog", "goose", "hen", "rabbit", "stag"];
    const shots = await Promise.all(ids.map(id => provide(id)));
    const pictured = shots.map(shot => Buffer.from(String(shot).split(",")[1] ?? "", "base64").toString());
    expect(pictured).toEqual(ids.map(id => `model:${id}`));
  });
});
