import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetTextureCache } from "../game/src/render/assets.js";

const PAGE_URL = "https://assets.example/game/index.html";
const IMAGE_URL = "https://assets.example/game/assets/textures/imported/hash.png";
const DECODE_OPTIONS: ImageBitmapOptions = {
  premultiplyAlpha: "none",
  colorSpaceConversion: "none",
  imageOrientation: "none",
};

class TestImageBitmap {
  readonly width = 4;
  readonly height = 4;
  readonly close = vi.fn();
  readonly [Symbol.toStringTag] = "ImageBitmap";
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockImages() {
  const fetchImage = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { status: 200 }));
  const decode = vi.fn(async (_blob: Blob, _options?: ImageBitmapOptions) => new TestImageBitmap());
  vi.stubGlobal("fetch", fetchImage);
  vi.stubGlobal("createImageBitmap", decode);
  return { fetchImage, decode };
}

function imageHandler(cache: AssetTextureCache): THREE.ImageBitmapLoader {
  const handler = cache.manager.getHandler("../../textures/imported/hash.png");
  expect(handler).not.toBeNull();
  expect(handler).toMatchObject({ isImageBitmapLoader: true });
  return handler as THREE.ImageBitmapLoader;
}

function fixtureDocument(transform = false): string {
  // An accessor without a bufferView initializes its three positions to zero.
  // This keeps real GLTF mesh/material loading independent of buffer fetch mocks.
  return JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [0, 0, 0] }],
    images: [{ uri: "../../textures/imported/hash.png" }],
    textures: [{ source: 0 }],
    extensionsUsed: transform ? ["KHR_texture_transform"] : [],
    materials: [{
      pbrMetallicRoughness: {
        baseColorTexture: transform
          ? { index: 0, extensions: { KHR_texture_transform: { offset: [0.2, 0.3], scale: [2, 3], rotation: 0.4, texCoord: 1 } } }
          : { index: 0 },
      },
    }],
  });
}

function loadedMap(root: THREE.Object3D): THREE.Texture {
  let map: THREE.Texture | null = null;
  root.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) map = object.material.map;
  });
  expect(map).toBeInstanceOf(THREE.Texture);
  return map!;
}

function texture(bitmap: TestImageBitmap = new TestImageBitmap()): THREE.Texture {
  const result = new THREE.Texture(bitmap);
  result.needsUpdate = true;
  return result;
}

function sceneWith(...textures: THREE.Texture[]): THREE.Group {
  const root = new THREE.Group();
  const child = new THREE.Group();
  child.add(new THREE.Mesh(new THREE.BufferGeometry(), textures.map(map => new THREE.MeshStandardMaterial({ map }))));
  root.add(child);
  return root;
}

function textureState(value: THREE.Texture) {
  return {
    uuid: value.uuid,
    image: value.image,
    version: value.version,
    name: value.name,
    channel: value.channel,
    mapping: value.mapping,
    offset: value.offset.toArray(),
    repeat: value.repeat.toArray(),
    center: value.center.toArray(),
    rotation: value.rotation,
    matrix: value.matrix.toArray(),
    matrixAutoUpdate: value.matrixAutoUpdate,
    wrapS: value.wrapS,
    wrapT: value.wrapT,
    magFilter: value.magFilter,
    minFilter: value.minFilter,
    colorSpace: value.colorSpace,
    flipY: value.flipY,
    format: value.format,
    type: value.type,
    normalized: value.normalized,
  };
}

beforeEach(() => {
  vi.stubGlobal("ImageBitmap", TestImageBitmap);
  vi.stubGlobal("document", { baseURI: PAGE_URL });
  vi.stubGlobal("location", new URL(PAGE_URL));
  vi.stubGlobal("self", globalThis);
  mockImages();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AssetTextureCache image requests", () => {
  it("uses its own manager and only installs external PNG/JPEG handlers when bitmap decoding exists", () => {
    const cache = new AssetTextureCache();
    expect(cache.manager).not.toBe(THREE.DefaultLoadingManager);
    const handler = imageHandler(cache);
    for (const url of ["image.png", "image.JPG", "image.jpeg?revision=2", "https://assets.example/image.PNG#part"]) {
      expect(cache.manager.getHandler(url)).toBe(handler);
    }
    for (const url of ["asset.glb", "image.webp", "image.ktx2", "data:image/png;base64,AAAA", "blob:https://assets.example/image"]) {
      expect(cache.manager.getHandler(url)).toBeNull();
    }
    expect(THREE.DefaultLoadingManager.getHandler("../../textures/imported/hash.png")).not.toBe(handler);

    vi.stubGlobal("createImageBitmap", undefined);
    const fallback = new AssetTextureCache();
    expect(fallback.manager.getHandler("image.png")).toBeNull();
  });

  it("shares one decode across independent installed GLTFLoader documents and preserves UV transforms", async () => {
    const { fetchImage, decode } = mockImages();
    const cache = new AssetTextureCache();
    const [building, weapon] = await Promise.all([
      new GLTFLoader(cache.manager).parseAsync(fixtureDocument(), "assets/models/building/"),
      new GLTFLoader(cache.manager).parseAsync(fixtureDocument(true), "assets/models/weapon/"),
    ]);
    const first = loadedMap(building.scene);
    const second = loadedMap(weapon.scene);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(fetchImage.mock.calls[0]![0]).toBe(IMAGE_URL);
    expect(decode).toHaveBeenCalledTimes(1);
    expect({ imageOrientation: "none", ...decode.mock.calls[0]![1] }).toEqual(DECODE_OPTIONS);
    expect(first).not.toBe(second);
    expect(first.image).toBeInstanceOf(TestImageBitmap);
    expect(second.image).toBe(first.image);
    expect(first.source).not.toBe(second.source);
    expect(first.flipY).toBe(false);
    expect(first.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(second.channel).toBe(1);
    expect(second.offset.toArray()).toEqual([0.2, 0.3]);
    expect(second.repeat.toArray()).toEqual([2, 3]);
    expect(second.rotation).toBe(0.4);
    const before = [textureState(first), textureState(second)];
    const versions = [first.source.version, second.source.version];

    cache.shareSources([building.scene]);
    cache.shareSources([weapon.scene]);

    expect(second.source).toBe(first.source);
    expect([textureState(first), textureState(second)]).toEqual(before);
    expect(first.source.version).toBe(versions[0]);
    expect(second.source.version).toBeLessThanOrEqual(Math.max(...versions));
  });

  it("deduplicates pending normalized URLs and balances manager callbacks for every caller", async () => {
    const { fetchImage, decode } = mockImages();
    const pending = deferred<TestImageBitmap>();
    decode.mockImplementation(() => pending.promise);
    const cache = new AssetTextureCache();
    const handler = imageHandler(cache);
    const start = vi.spyOn(cache.manager, "itemStart");
    const end = vi.spyOn(cache.manager, "itemEnd");
    const first = handler.loadAsync("assets/models/building/../../textures/imported/hash.png");
    const second = handler.loadAsync(IMAGE_URL);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    expect(end).not.toHaveBeenCalled();
    const bitmap = new TestImageBitmap();
    pending.resolve(bitmap);
    expect(await Promise.all([first, second])).toEqual([bitmap, bitmap]);
    expect(end).toHaveBeenCalledTimes(2);
    expect(await handler.loadAsync(IMAGE_URL)).toBe(bitmap);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(3);
    expect(end).toHaveBeenCalledTimes(3);
  });

  it.each(["fetch", "decode"] as const)("evicts a failed %s promise, reports each waiter, and retries", async failureStage => {
    const { fetchImage, decode } = mockImages();
    const failure = new Error(`temporary ${failureStage} failure`);
    if (failureStage === "fetch") fetchImage.mockRejectedValueOnce(failure);
    else decode.mockRejectedValueOnce(failure);
    const cache = new AssetTextureCache();
    const handler = imageHandler(cache);
    const errors = vi.spyOn(cache.manager, "itemError");
    const ends = vi.spyOn(cache.manager, "itemEnd");
    const settled = await Promise.allSettled([handler.loadAsync(IMAGE_URL), handler.loadAsync(IMAGE_URL)]);
    expect(settled).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(ends).toHaveBeenCalledTimes(2);
    const recovered = await handler.loadAsync(IMAGE_URL);
    expect(recovered).toBeInstanceOf(TestImageBitmap);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(await handler.loadAsync(IMAGE_URL)).toBe(recovered);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(ends).toHaveBeenCalledTimes(4);
  });

  it("keys request headers, credentials, and decode options without depending on property order", async () => {
    const { fetchImage, decode } = mockImages();
    const handler = imageHandler(new AssetTextureCache());
    handler.setRequestHeader({ Authorization: "Bearer first", Accept: "image/png" });
    handler.setOptions({ ...DECODE_OPTIONS });
    const original = await handler.loadAsync(IMAGE_URL);
    handler.setRequestHeader({ Accept: "image/png", Authorization: "Bearer first" });
    handler.setOptions({ imageOrientation: "none", colorSpaceConversion: "none", premultiplyAlpha: "none" });
    expect(await handler.loadAsync(IMAGE_URL)).toBe(original);
    expect(fetchImage).toHaveBeenCalledTimes(1);

    handler.setRequestHeader({ Accept: "image/png", Authorization: "Bearer second" });
    const newHeaders = await handler.loadAsync(IMAGE_URL);
    expect(newHeaders).not.toBe(original);
    handler.setCrossOrigin("use-credentials");
    const credentials = await handler.loadAsync(IMAGE_URL);
    expect(credentials).not.toBe(newHeaders);
    expect(fetchImage.mock.calls[0]![1]).toMatchObject({ credentials: "same-origin" });
    expect(new Headers(fetchImage.mock.calls[0]![1]!.headers).get("Authorization")).toBe("Bearer first");
    expect(fetchImage.mock.calls[2]![1]).toMatchObject({ credentials: "include" });
    handler.setOptions({ ...DECODE_OPTIONS, imageOrientation: "flipY" });
    const flipped = await handler.loadAsync(IMAGE_URL);
    expect(flipped).not.toBe(credentials);
    expect(decode.mock.calls[3]![1]).toEqual({ ...DECODE_OPTIONS, imageOrientation: "flipY" });
    handler.setOptions({ ...DECODE_OPTIONS });
    expect(await handler.loadAsync(IMAGE_URL)).toBe(credentials);
    expect(fetchImage).toHaveBeenCalledTimes(4);
  });

  it("snapshots request and decode options before an in-flight caller changes the handler", async () => {
    const { fetchImage, decode } = mockImages();
    const response = deferred<Response>();
    fetchImage.mockImplementationOnce(() => response.promise);
    const handler = imageHandler(new AssetTextureCache());
    const headers = { Authorization: "Bearer original" };
    const options: ImageBitmapOptions = { ...DECODE_OPTIONS };
    handler.setRequestHeader(headers).setOptions(options);
    const pending = handler.loadAsync(IMAGE_URL);
    headers.Authorization = "Bearer changed";
    options.imageOrientation = "flipY";
    handler.setOptions({ ...DECODE_OPTIONS, resizeWidth: 2 });
    response.resolve(new Response(new Blob(["image"]), { status: 200 }));
    await pending;
    expect(new Headers(fetchImage.mock.calls[0]![1]!.headers).get("Authorization")).toBe("Bearer original");
    expect(decode.mock.calls[0]![1]).toEqual(DECODE_OPTIONS);
  });

  it("keeps query variants and separate registry caches independent without touching THREE.Cache", async () => {
    const { fetchImage } = mockImages();
    const enabled = THREE.Cache.enabled;
    const files = THREE.Cache.files;
    const before = { ...files };
    const globalReads = vi.spyOn(THREE.Cache, "get");
    const globalWrites = vi.spyOn(THREE.Cache, "add");
    const globalRemoves = vi.spyOn(THREE.Cache, "remove");
    const first = imageHandler(new AssetTextureCache());
    const second = imageHandler(new AssetTextureCache());
    const plain = await first.loadAsync(IMAGE_URL);
    expect(await first.loadAsync(`${IMAGE_URL}?revision=2`)).not.toBe(plain);
    expect(await second.loadAsync(IMAGE_URL)).not.toBe(plain);
    expect(fetchImage).toHaveBeenCalledTimes(3);
    expect(THREE.Cache.enabled).toBe(enabled);
    expect(THREE.Cache.files).toBe(files);
    expect(THREE.Cache.files).toEqual(before);
    expect(globalReads).not.toHaveBeenCalled();
    expect(globalWrites).not.toHaveBeenCalled();
    expect(globalRemoves).not.toHaveBeenCalled();
  });
});

describe("AssetTextureCache source sharing", () => {
  it("interns bitmap sources across nested material arrays without replacing textures or changing UV state", () => {
    const cache = new AssetTextureCache();
    const bitmap = new TestImageBitmap();
    const first = texture(bitmap);
    const second = texture(bitmap);
    second.name = "separate material texture";
    second.offset.set(0.3, 0.6);
    second.repeat.set(2, 4);
    second.center.set(0.5, 0.5);
    second.rotation = 0.8;
    second.channel = 2;
    second.mapping = THREE.CubeReflectionMapping;
    second.updateMatrix();
    second.matrixAutoUpdate = false;
    const root = sceneWith(first, second);
    const firstSource = first.source;
    const secondSource = second.source;
    const before = [textureState(first), textureState(second)];
    cache.shareSources([root]);
    const sharedSource = first.source;
    expect(second.source).toBe(sharedSource);
    expect(sharedSource.version).toBe(1);
    expect(firstSource.version).toBe(1);
    expect(secondSource.version).toBe(1);
    expect([textureState(first), textureState(second)]).toEqual(before);
    cache.shareSources([root, root]);
    expect(second.source).toBe(sharedSource);
    expect(sharedSource.version).toBe(1);
    expect(firstSource.version).toBe(1);
  });

  it.each([
    ["wrapS", { wrapS: THREE.RepeatWrapping }],
    ["wrapT", { wrapT: THREE.MirroredRepeatWrapping }],
    ["wrapR", { wrapR: THREE.RepeatWrapping }],
    ["magFilter", { magFilter: THREE.NearestFilter }],
    ["minFilter", { minFilter: THREE.NearestMipmapNearestFilter }],
    ["anisotropy", { anisotropy: 4 }],
    ["internalFormat", { internalFormat: "RGBA8" }],
    ["format", { format: THREE.RedFormat }],
    ["type", { type: THREE.HalfFloatType }],
    ["generateMipmaps", { generateMipmaps: false }],
    ["premultiplyAlpha", { premultiplyAlpha: true }],
    ["flipY", { flipY: false }],
    ["unpackAlignment", { unpackAlignment: 1 }],
    ["colorSpace", { colorSpace: THREE.SRGBColorSpace }],
  ])("separates sources for incompatible %s uploads while sharing within each group", (_name, settings) => {
    const cache = new AssetTextureCache();
    const bitmap = new TestImageBitmap();
    const original = texture(bitmap);
    const changed = Object.assign(texture(bitmap), settings);
    const sameChanged = Object.assign(texture(bitmap), settings);
    const before = [original.version, changed.version, sameChanged.version];
    cache.shareSources([sceneWith(original, changed, sameChanged)]);
    expect(changed.source).not.toBe(original.source);
    expect(sameChanged.source).toBe(changed.source);
    expect([original.version, changed.version, sameChanged.version]).toEqual(before);
    expect([original.source.version, changed.source.version, sameChanged.source.version]).toEqual([1, 1, 1]);
  });

  it("splits incompatible GLTF-style clones that already share a source", () => {
    const cache = new AssetTextureCache();
    const linear = texture();
    const color = linear.clone();
    color.colorSpace = THREE.SRGBColorSpace;
    expect(color.source).toBe(linear.source);
    const before = [linear.version, color.version, linear.source.version];
    cache.shareSources([sceneWith(linear, color)]);
    expect(color.image).toBe(linear.image);
    expect(color.source).not.toBe(linear.source);
    expect([linear.version, color.version, linear.source.version]).toEqual(before);
    expect(color.source.version).toBe(before[2]);
  });

  it("separates normalized 16-bit uploads and reuses only the matching source across calls", () => {
    const cache = new AssetTextureCache();
    const bitmap = new TestImageBitmap();
    const integer = texture(bitmap);
    integer.type = THREE.UnsignedShortType;
    integer.normalized = false;
    const normalized = texture(bitmap);
    normalized.type = THREE.UnsignedShortType;
    normalized.normalized = true;
    const matching = texture(bitmap);
    matching.type = THREE.UnsignedShortType;
    matching.normalized = true;
    const before = [integer, normalized, matching].map(textureState);

    cache.shareSources([sceneWith(integer, normalized)]);
    expect(normalized.image).toBe(integer.image);
    expect(normalized.source).not.toBe(integer.source);
    cache.shareSources([sceneWith(matching)]);
    expect(matching.source).toBe(normalized.source);
    expect([integer, normalized, matching].map(textureState)).toEqual(before);
    expect([integer.source.version, normalized.source.version, matching.source.version]).toEqual([1, 1, 1]);
  });

  it("uses bitmap identity and visits other material texture slots", () => {
    const cache = new AssetTextureCache();
    const bitmap = new TestImageBitmap();
    const map = texture(bitmap);
    const normalMap = texture(bitmap);
    const roughnessMap = texture(bitmap);
    const otherImage = texture();
    const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalnessMap: otherImage });
    const root = new THREE.Mesh(new THREE.BufferGeometry(), material);
    cache.shareSources([root]);
    expect(normalMap.source).toBe(map.source);
    expect(roughnessMap.source).toBe(map.source);
    expect(otherImage.source).not.toBe(map.source);
    expect(material.normalMap).toBe(normalMap);
    expect(material.roughnessMap).toBe(roughnessMap);
  });

  it("leaves mutable images, special textures, and manual mipmaps under their original ownership", () => {
    const cache = new AssetTextureCache();
    const bitmap = new TestImageBitmap();
    const ordinary = texture(bitmap);
    const manual = texture(bitmap);
    manual.mipmaps = [{ data: new Uint8Array(4), width: 1, height: 1 }];
    const renderTarget = texture(bitmap);
    renderTarget.isRenderTargetTexture = true;
    const canvas = { width: 4, height: 4, getContext: vi.fn() } as unknown as HTMLCanvasElement;
    const video = { width: 4, height: 4, readyState: 0 } as HTMLVideoElement;
    const data = new Uint8Array(64);
    const excluded = [
      manual, renderTarget,
      new THREE.CanvasTexture(canvas), new THREE.CanvasTexture(canvas),
      new THREE.VideoTexture(video), new THREE.VideoTexture(video),
      new THREE.DataTexture(data, 4, 4), new THREE.DataTexture(data, 4, 4),
      new THREE.Texture(canvas), new THREE.Texture(canvas),
    ];
    const sources = excluded.map(value => value.source);
    const versions = excluded.map(value => value.version);
    cache.shareSources([sceneWith(ordinary, ...excluded)]);
    excluded.forEach((value, index) => {
      expect(value.source).toBe(sources[index]);
      expect(value.source).not.toBe(ordinary.source);
      expect(value.version).toBe(versions[index]);
    });
  });

  it("preserves independent texture disposal and never closes the shared bitmap", () => {
    const cache = new AssetTextureCache();
    const bitmap = new TestImageBitmap();
    const first = texture(bitmap);
    const second = texture(bitmap);
    const firstDisposed = vi.fn();
    const secondDisposed = vi.fn();
    first.addEventListener("dispose", firstDisposed);
    second.addEventListener("dispose", secondDisposed);
    cache.shareSources([sceneWith(first, second)]);
    const source = second.source;
    expect(firstDisposed).not.toHaveBeenCalled();
    expect(secondDisposed).not.toHaveBeenCalled();
    first.dispose();
    expect(firstDisposed).toHaveBeenCalledTimes(1);
    expect(secondDisposed).not.toHaveBeenCalled();
    expect(second.source).toBe(source);
    expect(second.image).toBe(bitmap);
    expect(bitmap.close).not.toHaveBeenCalled();
    second.dispose();
    expect(secondDisposed).toHaveBeenCalledTimes(1);
    expect(bitmap.close).not.toHaveBeenCalled();
  });
});
