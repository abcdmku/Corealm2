import { expect, it } from "vitest";
import { currentRecastEnvironment, usesExternalRecastWasm } from "../game/src/systems/recastEnvironment.js";

/**
 * The guard `Navigation.initLibrary` used to carry was `typeof window === "undefined"`, which reads
 * "this is Node" and is also true in a Web Worker. Local play runs the world in a worker, so these
 * three answers are the whole contract.
 */
it("fetches the sidecar wasm in a browser window", () => {
  expect(usesExternalRecastWasm({ window: true, worker: false, node: false })).toBe(true);
});

it("fetches the sidecar wasm in a Web Worker, which has no window", () => {
  expect(usesExternalRecastWasm({ window: false, worker: true, node: false })).toBe(true);
});

it("keeps the embedded wasm in Node, so a packaged server needs no sidecar file", () => {
  expect(usesExternalRecastWasm({ window: false, worker: false, node: true })).toBe(false);
});

it("fetches the sidecar wasm when nothing identifies the environment", () => {
  expect(usesExternalRecastWasm({ window: false, worker: false, node: false })).toBe(true);
});

it("reads this process as Node", () => {
  expect(currentRecastEnvironment()).toEqual({ window: false, worker: false, node: true });
  expect(usesExternalRecastWasm(currentRecastEnvironment())).toBe(false);
});
