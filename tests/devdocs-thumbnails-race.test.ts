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
    shadowMap = {}; info = { render: { triangles: 12 } };
    domElement = { toDataURL: () => `data:image/png;base64,${Buffer.from(drawn).toString("base64")}` };
    onDeviceLost?: () => void; outputColorSpace = ""; toneMapping = 0; toneMappingExposure = 1;
    async init() {} setPixelRatio() {} setSize() {} setClearColor() {} dispose() {}
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
