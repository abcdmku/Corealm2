import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssetRegistry,
  type AssetManifest,
  type PrimaryAssetRetryEvent,
} from "../game/src/render/assets.js";

function deferredGroup() {
  let resolve!: (group: THREE.Group) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<THREE.Group>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushQueue(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function stubManifest(id: string): AssetManifest {
  const manifest: AssetManifest = {
    generatedAt: "2026-09-04T00:00:00.000Z",
    packs: [],
    assets: [{
      id,
      file: `${id}.glb`,
      pack: "test-pack",
      category: "prop",
      is: "test-prop",
      tags: [],
      bytes: 100,
      size: { x: 1, y: 2, z: 3 },
      animations: [],
      materials: [],
    }],
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => manifest,
  })));
  return manifest;
}

afterEach(() => vi.unstubAllGlobals());

describe("AssetRegistry factories", () => {
  it("defers construction until load and shares the pending build and cached group", async () => {
    const registry = new AssetRegistry();
    const build = deferredGroup();
    const factory = vi.fn(() => build.promise);
    registry.registerFactory("generated-prop", factory);

    expect(factory).not.toHaveBeenCalled();
    expect(registry.isLoaded("generated-prop")).toBe(false);
    expect(() => registry.instance("generated-prop")).toThrow("Asset not loaded");

    const first = registry.load("generated-prop");
    const concurrent = registry.load("generated-prop", { priority: "player" });
    expect(concurrent).toBe(first);
    await flushQueue();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.isLoaded("generated-prop")).toBe(false);

    const group = new THREE.Group();
    group.add(new THREE.Object3D());
    build.resolve(group);
    await expect(first).resolves.toBe(group);
    await expect(concurrent).resolves.toBe(group);
    await expect(registry.load("generated-prop")).resolves.toBe(group);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(group.name).toBe("generated-prop");
    expect(registry.isLoaded("generated-prop")).toBe(true);
    const instance = registry.instance("generated-prop");
    expect(instance).not.toBe(group);
    expect(instance.children[0]).not.toBe(group.children[0]);
  });

  it.each(["throw", "reject"] as const)("clears a failed %s so a later load can rebuild", async (failureMode) => {
    const registry = new AssetRegistry();
    const failure = new Error("builder unavailable");
    const group = new THREE.Group();
    let attempts = 0;
    const factory = vi.fn(() => {
      attempts += 1;
      if (attempts > 1) return Promise.resolve(group);
      if (failureMode === "throw") throw failure;
      return Promise.reject(failure);
    });
    registry.registerFactory("recoverable-prop", factory);

    await expect(registry.load("recoverable-prop")).rejects.toBe(failure);
    expect(registry.isLoaded("recoverable-prop")).toBe(false);
    expect(registry.isFailed("recoverable-prop")).toBe(true);
    expect(registry.getLoadStats()).toMatchObject({ total: 0, requested: 0, loaded: 0, failed: 0 });
    await expect(registry.load("recoverable-prop")).resolves.toBe(group);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(registry.isLoaded("recoverable-prop")).toBe(true);
    expect(registry.isFailed("recoverable-prop")).toBe(false);
  });

  it("merges primary observers and preserves them through deduplicated retry closures", async () => {
    const registry = new AssetRegistry();
    const builds = [deferredGroup(), deferredGroup(), deferredGroup()];
    let attempt = 0;
    const factory = vi.fn(() => builds[attempt++]!.promise);
    registry.registerFactory("primary-prop", factory);
    const globalObserver = vi.fn((_event: PrimaryAssetRetryEvent) => undefined);
    const firstObserver = vi.fn((_event: PrimaryAssetRetryEvent) => undefined);
    const lateObserver = vi.fn((_event: PrimaryAssetRetryEvent) => undefined);
    const throwingObserver = vi.fn(() => { throw new Error("observer failed"); });
    registry.onPrimaryAssetRetry(throwingObserver);
    registry.onPrimaryAssetRetry(globalObserver);

    const first = registry.load("primary-prop", { onRetry: firstObserver });
    expect(registry.load("primary-prop", { onRetry: globalObserver })).toBe(first);
    await flushQueue();
    expect(registry.load("primary-prop", { primary: true, onRetry: lateObserver })).toBe(first);
    const firstFailure = new Error("first build failed");
    builds[0]!.reject(firstFailure);
    await expect(first).rejects.toBe(firstFailure);
    const firstEvent = firstObserver.mock.calls[0]![0];
    expect(firstEvent).toMatchObject({ assetId: "primary-prop", attempt: 1, error: firstFailure });
    for (const observer of [globalObserver, firstObserver, lateObserver]) {
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls[0]![0]).toBe(firstEvent);
    }
    expect(throwingObserver).toHaveBeenCalledTimes(1);

    const second = firstEvent.retry();
    expect(lateObserver.mock.calls[0]![0].retry()).toBe(second);
    expect(registry.retry("primary-prop")).toBe(second);
    await flushQueue();
    const secondFailure = new Error("second build failed");
    builds[1]!.reject(secondFailure);
    await expect(second).rejects.toBe(secondFailure);
    const secondEvent = firstObserver.mock.calls[1]![0];
    expect(secondEvent).toMatchObject({ assetId: "primary-prop", attempt: 2, error: secondFailure });
    for (const observer of [globalObserver, firstObserver, lateObserver]) {
      expect(observer).toHaveBeenCalledTimes(2);
      expect(observer.mock.calls[1]![0]).toBe(secondEvent);
    }
    expect(throwingObserver).toHaveBeenCalledTimes(2);

    const third = secondEvent.retry();
    expect(firstEvent.retry()).toBe(third);
    const group = new THREE.Group();
    builds[2]!.resolve(group);
    await expect(third).resolves.toBe(group);
    await expect(secondEvent.retry()).resolves.toBe(group);
    expect(factory).toHaveBeenCalledTimes(3);
    expect(registry.isLoaded("primary-prop")).toBe(true);
    expect(globalObserver).toHaveBeenCalledTimes(2);
  });

  it("keeps generated assets out of manifest metadata and authored-file counters", async () => {
    const manifest = stubManifest("authored-prop");
    const registry = new AssetRegistry();
    await registry.loadManifest();
    const fileStats = registry.getLoadStats();
    const build = deferredGroup();
    registry.registerFactory("generated-prop", () => build.promise);
    expect(registry.getLoadStats()).toEqual(fileStats);
    expect(registry.getManifest()).toBe(manifest);
    expect(registry.entry("generated-prop")).toBeUndefined();
    expect(registry.assetSize("generated-prop")).toBeNull();
    expect(registry.byCategory("prop").map((entry) => entry.id)).toEqual(["authored-prop"]);

    const pending = registry.load("generated-prop");
    await flushQueue();
    expect(registry.getLoadStats()).toMatchObject({ total: 1, requested: 0, loaded: 0 });
    build.resolve(new THREE.Group());
    await pending;
    await flushQueue();
    expect(registry.getLoadStats()).toEqual(fileStats);
    expect(registry.stats().loaded).toBe(1);
    expect(registry.entry("generated-prop")).toBeUndefined();
  });

  it("rejects a manifest id reserved by an unbuilt factory", async () => {
    stubManifest("shared-id");
    const registry = new AssetRegistry();
    const factory = vi.fn(async () => new THREE.Group());
    registry.registerFactory("shared-id", factory);
    await expect(registry.loadManifest()).rejects.toThrow(/collid/i);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects a factory id already present in the manifest", async () => {
    stubManifest("shared-id");
    const registry = new AssetRegistry();
    await registry.loadManifest();
    const factory = vi.fn(async () => new THREE.Group());
    expect(() => registry.registerFactory("shared-id", factory)).toThrow(/collid/i);
    expect(factory).not.toHaveBeenCalled();
  });

  it("guards factory and built reservations in both registration orders", async () => {
    const registry = new AssetRegistry();
    const original = new THREE.Group();
    registry.registerFactory("factory-id", async () => original);
    expect(() => registry.registerFactory("factory-id", async () => new THREE.Group())).toThrow();
    expect(() => registry.registerBuilt("factory-id", new THREE.Group())).toThrow();
    await expect(registry.load("factory-id")).resolves.toBe(original);
    expect(() => registry.registerFactory("factory-id", async () => new THREE.Group())).toThrow();
    expect(() => registry.registerBuilt("factory-id", new THREE.Group())).toThrow();

    const built = new THREE.Group();
    registry.registerBuilt("built-id", built);
    expect(() => registry.registerFactory("built-id", async () => new THREE.Group())).toThrow();
    expect(() => registry.registerBuilt("built-id", new THREE.Group())).toThrow();
    await expect(registry.load("built-id")).resolves.toBe(built);
  });
});
