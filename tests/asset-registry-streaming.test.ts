import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssetRegistry,
  type AssetEntry,
  type AssetManifest,
  type PrimaryAssetRetryEvent,
} from "../game/src/render/assets.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  settled: boolean;
}

interface FakeGltf {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const state: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve(value) {
      if (state.settled) return;
      state.settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (state.settled) return;
      state.settled = true;
      rejectPromise(error);
    },
    settled: false,
  };
  return state;
}

function entry(id: string): AssetEntry {
  return {
    id,
    file: `${id}.glb`,
    pack: "test-pack",
    category: "prop",
    is: "test-prop",
    tags: ["test"],
    bytes: 100,
    size: { x: 1, y: 1, z: 1 },
    animations: [],
    materials: [],
  };
}

async function registryWith(
  ids: readonly string[],
  loadAsync: (url: string) => Promise<FakeGltf>,
): Promise<AssetRegistry> {
  const manifest: AssetManifest = {
    generatedAt: "2026-08-30T00:00:00.000Z",
    packs: [{
      id: "test-pack",
      name: "Test pack",
      author: "Tests",
      source: "local",
      license: "test-only",
    }],
    assets: ids.map(entry),
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => manifest,
  })));

  const registry = new AssetRegistry();
  (registry as unknown as { loader: { loadAsync: typeof loadAsync } }).loader = { loadAsync };
  await registry.loadManifest();
  return registry;
}

function gltf(id: string): FakeGltf {
  const scene = new THREE.Group();
  scene.name = `source:${id}`;
  return { scene, animations: [] };
}

function assetIdFromUrl(url: string): string {
  const file = url.split("/").at(-1);
  if (!file?.endsWith(".glb")) throw new Error(`Unexpected asset URL: ${url}`);
  return file.slice(0, -4);
}

async function flushQueue(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssetRegistry streaming", () => {
  it('only promotes pending requests and does not retry a failed download implicitly', async () => {
    const failure = deferred<FakeGltf>();
    const load = vi.fn(() => failure.promise);
    const registry = await registryWith(['far-model'], load);
    registry.prioritize('far-model', { priority: 'player' });
    await flushQueue();
    expect(load).not.toHaveBeenCalled();
    const request = registry.load('far-model', { priority: 'travel-prefetch' });
    const rejected = expect(request).rejects.toThrow('offline');
    await flushQueue();
    registry.prioritize('far-model', { priority: 'visible-spawn', primary: true });
    failure.reject(new Error('offline'));
    await rejected;
    registry.prioritize('far-model', { priority: 'visible-spawn' });
    await flushQueue();
    expect(load).toHaveBeenCalledTimes(1);
    expect(registry.getLoadStats().failed).toBe(1);
  });
  it("deduplicates queued and active requests while reporting lifecycle counters", async () => {
    const request = deferred<FakeGltf>();
    const loadAsync = vi.fn(() => request.promise);
    const registry = await registryWith(["oak", "pine"], loadAsync);

    const first = registry.load("oak", { priority: "background", regionId: "south" });
    const second = registry.load("oak", { priority: "visible-spawn", regionId: "north" });

    expect(second).toBe(first);
    expect(registry.getLoadStats()).toEqual({
      total: 2,
      requested: 1,
      loaded: 0,
      failed: 0,
      queued: 1,
      inflight: 0,
    });

    await flushQueue();
    expect(loadAsync).toHaveBeenCalledTimes(1);
    expect(registry.getLoadStats()).toMatchObject({ queued: 0, inflight: 1 });

    request.resolve(gltf("oak"));
    const [firstGroup, secondGroup] = await Promise.all([first, second]);
    await flushQueue();
    expect(firstGroup).toBe(secondGroup);
    expect(registry.getLoadStats()).toEqual({
      total: 2,
      requested: 1,
      loaded: 1,
      failed: 0,
      queued: 0,
      inflight: 0,
    });
  });

  it("retries primary failures and clears failed state after recovery", async () => {
    const attempts: Deferred<FakeGltf>[] = [];
    const loadAsync = vi.fn(() => {
      const attempt = deferred<FakeGltf>();
      attempts.push(attempt);
      return attempt.promise;
    });
    const registry = await registryWith(["hero"], loadAsync);
    const retryEvents: PrimaryAssetRetryEvent[] = [];
    const unsubscribe = registry.onPrimaryAssetRetry((event) => retryEvents.push(event));

    const first = registry.load("hero", { priority: "player", primary: true });
    await flushQueue();
    attempts[0]!.reject(new Error("temporary network failure"));
    await expect(first).rejects.toThrow("temporary network failure");

    expect(registry.isFailed("hero")).toBe(true);
    expect(registry.getLoadStats()).toMatchObject({ requested: 1, loaded: 0, failed: 1 });
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]).toMatchObject({ assetId: "hero", attempt: 1 });

    const retried = retryEvents[0]!.retry();
    const duplicateRetry = registry.retry("hero", { priority: "player" });
    expect(duplicateRetry).toBe(retried);
    await flushQueue();
    attempts[1]!.resolve(gltf("hero"));
    await expect(retried).resolves.toBeInstanceOf(THREE.Group);

    expect(loadAsync).toHaveBeenCalledTimes(2);
    expect(registry.isFailed("hero")).toBe(false);
    expect(registry.getLoadStats()).toEqual({
      total: 1,
      requested: 1,
      loaded: 1,
      failed: 0,
      queued: 0,
      inflight: 0,
    });
    unsubscribe();
  });

  it("attaches primary retry handling to a request that is already active", async () => {
    const request = deferred<FakeGltf>();
    const loadAsync = vi.fn(() => request.promise);
    const registry = await registryWith(["late-primary"], loadAsync);
    const lateEvents: PrimaryAssetRetryEvent[] = [];

    const background = registry.load("late-primary", { priority: "background" });
    await flushQueue();
    expect(registry.getLoadStats()).toMatchObject({ queued: 0, inflight: 1 });

    const promoted = registry.load("late-primary", {
      priority: "player",
      primary: true,
      onRetry: (event) => lateEvents.push(event),
    });
    expect(promoted).toBe(background);

    request.reject(new Error("active request failed"));
    await expect(background).rejects.toThrow("active request failed");
    expect(lateEvents).toHaveLength(1);
    expect(lateEvents[0]).toMatchObject({ assetId: "late-primary", attempt: 1 });
  });

  it("prioritizes player and active-region work, and reprioritizes after region travel", async () => {
    const blockerIds = Array.from({ length: 8 }, (_, index) => `blocker-${index}`);
    const ids = [...blockerIds, "north-visible", "south-prefetch", "player"];
    const started: string[] = [];
    const requests = new Map<string, Deferred<FakeGltf>>();
    const loadAsync = vi.fn((url: string) => {
      const id = assetIdFromUrl(url);
      const request = deferred<FakeGltf>();
      started.push(id);
      requests.set(id, request);
      return request.promise;
    });
    const registry = await registryWith(ids, loadAsync);
    registry.setActiveRegion("north");

    const promises = blockerIds.map((id) => registry.load(id, {
      priority: "background",
      regionId: "north",
    }));
    await flushQueue();
    expect(started).toEqual(blockerIds);

    const northBackground = registry.load("north-visible", {
      priority: "background",
      regionId: "south",
    });
    const northVisible = registry.load("north-visible", {
      priority: "visible-spawn",
      regionId: "north",
    });
    const southPrefetch = registry.load("south-prefetch", {
      priority: "travel-prefetch",
      regionId: "south",
    });
    const player = registry.load("player", { priority: "player", regionId: "south" });
    promises.push(northVisible, southPrefetch, player);
    expect(northBackground).toBe(northVisible);
    expect(registry.getLoadStats()).toMatchObject({ requested: 11, queued: 3, inflight: 8 });

    requests.get("blocker-0")!.resolve(gltf("blocker-0"));
    await flushQueue();
    expect(started.at(-1)).toBe("player");

    requests.get("blocker-1")!.resolve(gltf("blocker-1"));
    await flushQueue();
    expect(started.at(-1)).toBe("north-visible");

    registry.setActiveRegion("south");
    expect(registry.getActiveRegion()).toBe("south");
    requests.get("blocker-2")!.resolve(gltf("blocker-2"));
    await flushQueue();
    expect(started.at(-1)).toBe("south-prefetch");

    for (const [id, request] of requests) request.resolve(gltf(id));
    await Promise.all(promises);
    await flushQueue();
    expect(registry.getLoadStats()).toEqual({
      total: 11,
      requested: 11,
      loaded: 11,
      failed: 0,
      queued: 0,
      inflight: 0,
    });
  });
});
