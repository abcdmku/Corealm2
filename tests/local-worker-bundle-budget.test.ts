import { expect, it } from "vitest";
import { analyzeBundleBudget, assertBundleBudgets, BUNDLE_BUDGETS, LOCAL_WORKER_DIRECTORY, type BundleArtifact } from "../game/vite.config.js";

/** Vite emits a worker's bundle into the page's as assets, so the budget finds the worker by its directory. */
const entry: BundleArtifact = { type: "chunk", fileName: "assets/entry/index-a.js", name: "index", code: "export{}", isEntry: true, imports: ["assets/chunks/three-a.js", "assets/chunks/recast-a.js"] };
const engine = (name: string): BundleArtifact => ({ type: "chunk", fileName: `assets/chunks/${name}-a.js`, name, code: "export{}", isEntry: false, imports: [] });
const worker = (name: string, source: string): BundleArtifact => ({ type: "asset", fileName: `${LOCAL_WORKER_DIRECTORY}${name}.js`, source });
const bundle = (...artifacts: BundleArtifact[]) => Object.fromEntries([entry, engine("three"), engine("recast"), ...artifacts].map(artifact => [artifact.fileName, artifact]));
/** Text gzip cannot shrink, so a size is a size. */
const noise = (bytes: number): string => { let text = "", seed = 1; while (text.length < bytes) { seed = (seed * 1103515245 + 12345) % 2147483648; text += seed.toString(36); } return text; };

it("counts the worker's files against the worker's budget and never against the page's", () => {
  const report = analyzeBundleBudget(bundle(worker("localHost-a", "self.onmessage=()=>{}"), worker("localHostRuntime-a", `const x="${noise(40_000)}"`)));
  expect(report.localWorkerFiles).toEqual(["assets/worker/localHost-a.js", "assets/worker/localHostRuntime-a.js"]);
  expect(report.localWorkerJsGzipBytes).toBeGreaterThan(20_000);
  expect(report.applicationInitialJsGzipBytes).toBeLessThan(200);
  expect(() => assertBundleBudgets(report)).not.toThrow();
});

it("fails a worker that outgrows its budget or carries the content it must fetch", () => {
  const heavy = analyzeBundleBudget(bundle(worker("localHostRuntime-a", `const x="${noise(BUNDLE_BUDGETS.localWorkerJsGzipBytes * 2)}"`)));
  expect(() => assertBundleBudgets(heavy)).toThrow("local-play worker JavaScript is");
  const bundled = analyzeBundleBudget(bundle(worker("localHostRuntime-a", `const tables={items:[],lootTables:[{id:"frog"}],"compiledCreatures":[]}`)));
  expect(bundled.localWorkerCatalogFiles).toEqual(["assets/worker/localHostRuntime-a.js"]);
  expect(() => assertBundleBudgets(bundled)).toThrow("bundles content tables it must fetch instead");
});

it("fails a page script that carries loot rolls, habitats or the compiled catalog, and counts the app chunk as first-load code", () => {
  const app = (code: string): BundleArtifact => ({ type: "chunk", fileName: "assets/chunks/boot-a.js", name: "boot", code, isEntry: false, imports: [], modules: { "D:/repo/game/src/app/boot.ts": {} } } as BundleArtifact);
  const clean = analyzeBundleBudget(bundle(app(`const unknownEnemy={lootRolls:[]};const x="${noise(30_000)}"`)));
  expect(clean.pageCatalogFiles).toEqual([]);
  expect(clean.initialChunks).toContain("assets/chunks/boot-a.js");
  expect(clean.applicationInitialJsGzipBytes).toBeGreaterThan(15_000);
  for (const leak of [`{id:"frog",lootRolls:[{itemId:"hide",chance:.5}]}`, `{"habitats":[{"id":"h1","anchors":[]}]}`, `{compiledCreatures:[{id:"frog"}]}`]) {
    const leaked = analyzeBundleBudget(bundle(app(`const tables=${leak}`)));
    expect(leaked.pageCatalogFiles).toEqual(["assets/chunks/boot-a.js"]);
    expect(() => assertBundleBudgets(leaked)).toThrow("the page bundles content tables it must fetch instead");
  }
});
