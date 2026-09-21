/**
 * Which recast WebAssembly build this process loads.
 *
 * `@recast-navigation/core` ships two: the package default has the module base64-embedded in its
 * JavaScript, and `@recast-navigation/wasm/wasm` is the build that fetches a sidecar `.wasm` file.
 * `Navigation.initLibrary` passes the second to `init()` in a browser and passes nothing in Node,
 * which is what lets the server executable ship without a sidecar file.
 *
 * The test used to be `typeof window === "undefined"`, read as "this is Node". It is also true
 * inside a Web Worker, which is a browser with no `window` — so worker-hosted local play would have
 * taken the Node branch and decoded the embedded copy. This is the whole environment question, in
 * one pure function, so a test can ask it about all three environments without a browser.
 */

/** What the running environment answers about itself. */
export interface RecastEnvironment {
  /** A browser main thread: `window` is defined. */
  readonly window: boolean;
  /** Any Web Worker: `WorkerGlobalScope` is defined and `window` is not. */
  readonly worker: boolean;
  /** Node: `process.versions.node` is set. */
  readonly node: boolean;
}

/**
 * True when recast should load the external `.wasm` file, false when it should use the copy
 * embedded in the package.
 *
 * Node is the only environment that takes the embedded build, and it takes it on the same condition
 * as before: no `window`. Everything else — window, dedicated worker, shared worker, or an
 * environment that claims to be none of these — fetches the file, because outside Node the embedded
 * build costs a multi-megabyte base64 decode on the main path.
 */
export function usesExternalRecastWasm(environment: RecastEnvironment): boolean {
  if (environment.window || environment.worker) return true;
  return !environment.node;
}

/** What this process is, read from the globals that define each environment. */
export function currentRecastEnvironment(): RecastEnvironment {
  const global = globalThis as { WorkerGlobalScope?: unknown; process?: { versions?: { node?: string } } };
  return {
    window: typeof window !== "undefined",
    worker: typeof window === "undefined" && global.WorkerGlobalScope !== undefined,
    // Read off `globalThis` rather than the bare identifier: a bundler that shims `process.env`
    // leaves `versions` alone, and an unshimmed browser build must not throw a ReferenceError.
    node: typeof global.process?.versions?.node === "string",
  };
}
