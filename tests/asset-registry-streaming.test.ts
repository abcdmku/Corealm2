import * as THREE from "three";
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from "vitest";
import * as leafTexture from '../game/src/render/leafTexture.js';
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
  release = false,
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
    ...(release ? { optimizedTextures: {} } : {}),
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => manifest,
  })));

  const registry = new AssetRegistry();
  const parsed = new Map<ArrayBuffer, FakeGltf>();
  const fileLoader = {
    setPath(_path: string) { return this; },
    setWithCredentials(_value: boolean) { return this; },
    setRequestHeader(_headers: Record<string, unknown>) { return this; },
    loadAsync: async (url: string): Promise<ArrayBuffer> => {
      const result = await loadAsync(url);
      const bytes = new ArrayBuffer(1);
      parsed.set(bytes, result);
      return bytes;
    },
  };
  (registry as unknown as {
    fileLoader: typeof fileLoader;
    loader: { parseAsync(bytes: ArrayBuffer, root: string): Promise<FakeGltf> };
  }).fileLoader = fileLoader;
  (registry as unknown as {
    loader: { parseAsync(bytes: ArrayBuffer, root: string): Promise<FakeGltf> };
  }).loader = {
    parseAsync: async (bytes) => {
      const result = parsed.get(bytes);
      if (!result) throw new Error("Test parser received unknown bytes");
      return result;
    },
  };
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
  // Startup preparation now yields to actual tasks too, rather than only promise continuations.
  for (let turn = 0; turn < 12; turn += 1) await nextTask();
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AssetRegistry streaming", () => {
  it('reduces active download concurrency during gameplay and restores startup throughput', async () => {
    const ids = Array.from({length:20}, (_,i) => `play-${i}`);
    const pending = new Map<string, Deferred<FakeGltf>>();
    const registry = await registryWith(ids, async url => {
      const id = assetIdFromUrl(url), request = deferred<FakeGltf>();
      pending.set(id, request); return request.promise;
    }, true);
    registry.setGameplayActive(true);
    const requests = ids.map(id => registry.load(id));
    await flushQueue();
    expect(registry.getLoadStats()).toMatchObject({inflight:2, queued:18});
    registry.setGameplayActive(false); await flushQueue();
    expect(registry.getLoadStats()).toMatchObject({inflight:16, queued:4});
    for (let turn = 0; turn < 12 && registry.getLoadStats().loaded < ids.length; turn += 1) {
      for (const [id, request] of pending) request.resolve(gltf(id));
      await flushQueue();
    }
    await Promise.all(requests);
    expect(registry.getLoadStats()).toMatchObject({loaded:20, failed:0});
  });

  it('reserves gameplay capacity for visible content while background requests are waiting', async () => {
    const pending = new Map<string, Deferred<FakeGltf>>();
    const registry = await registryWith(['far-a', 'far-b', 'far-c', 'near', 'player'], async url => {
      const id = assetIdFromUrl(url), request = deferred<FakeGltf>();
      pending.set(id, request); return request.promise;
    });
    registry.setGameplayActive(true);
    const requests = ['far-a', 'far-b', 'far-c'].map(id => registry.load(id));
    await flushQueue();
    expect([...pending.keys()]).toEqual(['far-a', 'far-b']);
    requests.push(registry.load('near', { priority: 'visible-spawn' }));
    requests.push(registry.load('player', { priority: 'player' }));
    await flushQueue();
    expect([...pending.keys()]).toEqual(['far-a', 'far-b', 'player', 'near']);
    registry.setGameplayActive(false);
    await flushQueue();
    for (const [id, request] of pending) request.resolve(gltf(id));
    await Promise.all(requests);
  });

  it('bounds outstanding model bytes and permits one oversized model to finish', async () => {
    const pending = new Map<string, Deferred<FakeGltf>>();
    const registry = await registryWith(['large-a', 'large-b', 'small', 'oversized'], async url => {
      const id = assetIdFromUrl(url), request = deferred<FakeGltf>();
      pending.set(id, request); return request.promise;
    });
    for (const id of ['large-a', 'large-b']) registry.entry(id)!.bytes = 20 * 1024 * 1024;
    registry.entry('oversized')!.bytes = 40 * 1024 * 1024;
    const requests = ['large-a', 'large-b', 'small', 'oversized'].map(id => registry.load(id));
    await flushQueue();
    expect([...pending.keys()]).toEqual(['large-a', 'small']);
    pending.get('large-a')!.resolve(gltf('large-a'));
    pending.get('small')!.resolve(gltf('small'));
    await flushQueue();
    expect([...pending.keys()]).toEqual(['large-a', 'small', 'large-b']);
    pending.get('large-b')!.resolve(gltf('large-b'));
    await flushQueue();
    expect([...pending.keys()]).toEqual(['large-a', 'small', 'large-b', 'oversized']);
    pending.get('oversized')!.resolve(gltf('oversized'));
    await Promise.all(requests);
  });

  it("does not begin raw GLB parsing inline when gameplay is active", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const registry = await registryWith(["hero"], async () => gltf("hero"));
    const bytes = new ArrayBuffer(4);
    const managerEvents: string[] = [];
    const manager = (registry as any).textureCache.manager as THREE.LoadingManager;
    manager.onLoad = () => managerEvents.push("manager-load");
    const parseAsync = vi.fn(async (_bytes: ArrayBuffer, root: string) => {
      managerEvents.push("parse");
      expect(_bytes).toBe(bytes);
      expect(root).toBe("/assets/");
      return gltf("hero");
    });
    (registry as any).fileLoader = {
      setPath() { return this; },
      setWithCredentials() { return this; },
      setRequestHeader() { return this; },
      loadAsync: vi.fn(async (url: string) => {
        manager.itemStart(url);
        try { return bytes; } finally { manager.itemEnd(url); }
      }),
    };
    (registry as any).loader = { parseAsync };
    registry.setGameplayActive(true);

    const loaded = registry.load("hero");
    for (let turn = 0; turn < 40; turn++) await Promise.resolve();
    expect(parseAsync).not.toHaveBeenCalled();
    expect(managerEvents).toEqual([]);
    expect(frames).toHaveLength(1);

    frames.shift()!(performance.now());
    await nextTask();
    expect(parseAsync).toHaveBeenCalledTimes(1);
    expect(managerEvents).toEqual(["parse", "manager-load"]);

    // Drain the captured frames without bypassing the loading-screen preparation budget.
    registry.setGameplayActive(false);
    for (let turn = 0; turn < 10 && !registry.isLoaded('hero'); turn++) {
      frames.shift()?.(performance.now());
      await nextTask();
    }
    await expect(loaded).resolves.toBeInstanceOf(THREE.Group);
  });

  it('converts imported material slots before publication while retaining shared textures and materials', async () => {
    const image = new THREE.Texture();
    const standard = new THREE.MeshStandardMaterial({ map: image, roughness: 0.7 });
    const physical = new THREE.MeshPhysicalMaterial({ map: image, transmission: 0.4, clearcoat: 0.6 });
    const basic = new THREE.MeshBasicMaterial({ map: image });
    const scene = new THREE.Group();
    const first = new THREE.Mesh(new THREE.BufferGeometry(), [standard, physical, basic]);
    const second = new THREE.Mesh(new THREE.BufferGeometry(), standard);
    scene.add(first, second);
    const registry = await registryWith(['imported'], async () => ({ scene, animations: [] }));
    const loaded = await registry.load('imported');
    expect(loaded).toBe(scene);
    expect(first.material).toHaveLength(3);
    expect(first.material[0]).toMatchObject({ isMeshStandardNodeMaterial: true, roughness: 0.7, map: image });
    expect(first.material[1]).toMatchObject({ isMeshPhysicalNodeMaterial: true, transmission: 0.4, clearcoat: 0.6, map: image });
    expect(first.material[2]).toMatchObject({ isMeshBasicNodeMaterial: true, map: image });
    expect(second.material).toBe(first.material[0]);
    expect(first.material[0]).not.toBe(standard);
    expect(standard.map).toBe(image);
  });

  it('rejects custom imported shaders instead of publishing a silently simplified asset', async () => {
    const scene = new THREE.Group();
    const custom = new THREE.MeshStandardMaterial();
    custom.onBeforeCompile = shader => { shader.vertexShader += '\n// custom deformation'; };
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), custom));
    const registry = await registryWith(['custom'], async () => ({ scene, animations: [] }));
    await expect(registry.load('custom')).rejects.toThrow('unported onBeforeCompile');
    expect(registry.isLoaded('custom')).toBe(false);
    expect(registry.isFailed('custom')).toBe(true);
  });

  it('waits for cutout foliage preparation before publishing without processing other maps', async () => {
    const leafMap = new THREE.Texture(), secondLeafMap = new THREE.Texture();
    const ordinaryMap = new THREE.Texture(), decorativeMap = new THREE.Texture();
    const pending = deferred<THREE.Texture>();
    const prepare = vi.spyOn(leafTexture, 'prepareLeafTextureAsync')
      .mockReturnValueOnce(pending.promise).mockResolvedValue(secondLeafMap);
    const leaf = new THREE.MeshStandardMaterial({ map: leafMap });
    leaf.name = 'Leaves_oak_cutout';
    const secondLeaf = new THREE.MeshStandardMaterial({ map: secondLeafMap });
    secondLeaf.name = 'Leaves_pine_cutout';
    const ordinary = new THREE.MeshStandardMaterial({ map: ordinaryMap });
    ordinary.name = 'Leaves';
    const decorative = new THREE.MeshStandardMaterial({ map: decorativeMap });
    decorative.name = 'Flower_cutout';
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), [leaf, leaf, secondLeaf, ordinary, decorative]));
    const registry = await registryWith(['foliage'], async () => ({ scene, animations: [] }));
    const loading = registry.load('foliage');
    await flushQueue();
    expect(prepare).toHaveBeenCalledExactlyOnceWith(leafMap);
    expect(registry.isLoaded('foliage')).toBe(false);
    pending.resolve(leafMap);
    await expect(loading).resolves.toBe(scene);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenLastCalledWith(secondLeafMap);
    expect(registry.isLoaded('foliage')).toBe(true);
  });

  it('loads compressed release models on desktop through the normal geometry and animation path', async () => {
    vi.stubGlobal('matchMedia', () => ({matches:false}));
    const asset = {...entry('hero'), compactFile:'hero.glb.model'};
    const source = new Uint8Array([1,2,3,4]);
    const fetch = vi.fn(async (url: string) => url.endsWith('.model')
      ? new Response(Uint8Array.from(gzipSync(source)))
      : {ok:true,json:async () => ({assets:[asset],packs:[],generatedAt:''})});
    vi.stubGlobal('fetch', fetch);
    const registry = new AssetRegistry();
    const loadAsync = vi.fn();
    const parseAsync = vi.fn(async (bytes: ArrayBuffer, root: string) => {
      expect(new Uint8Array(bytes)).toEqual(source);
      expect(root).toMatch(/assets\/$/);
      return gltf('hero');
    });
    (registry as any).loader = {loadAsync,parseAsync};
    await registry.loadManifest();
    expect((await registry.load('hero')).name).toBe('hero');
    expect(parseAsync).toHaveBeenCalledTimes(1);
    expect(loadAsync).not.toHaveBeenCalled();
    expect(registry.getLoadStats()).toMatchObject({loaded:1,failed:0});
  });

  it.each([false,true])('keeps the optimized queue bounded on desktop %s while overlapping texture waits', async desktop => {
    const ids=Array.from({length:20},(_,i)=>`part-${i}`);
    const pending=new Map<string,Deferred<FakeGltf>>();
    const registry=await registryWith(ids,async url=>{
      const id=assetIdFromUrl(url),request=deferred<FakeGltf>();pending.set(id,request);return request.promise;
    },desktop);
    vi.stubGlobal('matchMedia',()=>({matches:!desktop}));
    const requests=ids.map(id=>registry.load(id,{priority:'visible-spawn'}));
    await flushQueue();
    expect(registry.getLoadStats()).toMatchObject({inflight:16,queued:4});
    for(const [id,request] of pending)request.resolve(gltf(id));
    await flushQueue();
    expect(registry.getLoadStats()).toMatchObject({inflight:4,queued:0,loaded:16});
    for(const [id,request] of pending)request.resolve(gltf(id));
    await Promise.all(requests);
    expect(registry.getLoadStats()).toMatchObject({loaded:20,failed:0});
  });

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
