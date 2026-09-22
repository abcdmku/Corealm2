import * as THREE from "three";
import type { PreparedLeafPixels } from "./leafTexturePixels.js";
import type { LeafTextureReply, LeafTextureTask } from "./leafTexture.worker.js";
export { associateLeafColour } from "./leafTexturePixels.js";

interface ImagePreparation {
  version: number;
  pending: Promise<PreparedLeafPixels>;
  ready?: PreparedLeafPixels;
}
interface TextureResult { image: object; version: number; sampler: string; texture: THREE.DataTexture }
interface QueuedImage {
  image: ImageBitmapSource;
  resolve: (pixels: PreparedLeafPixels) => void;
  reject: (error: unknown) => void;
}

const preparedTextures = new Map<string, THREE.DataTexture>();
const textureResults = new WeakMap<THREE.Texture, TextureResult>();
const imagePreparations = new WeakMap<object, ImagePreparation>();
const queue: QueuedImage[] = [];
const MAX_QUEUED_IMAGES = 32;
const WORKER_TIMEOUT_MS = 15_000;
let worker: Worker | undefined;
let active = false;
let nextId = 0;

function samplerKey(source: THREE.Texture): string {
  return [source.channel, source.mapping, source.wrapS, source.wrapT, source.flipY,
    ...source.offset.toArray(), ...source.repeat.toArray(), ...source.center.toArray(),
    source.rotation, source.matrixAutoUpdate, ...source.matrix.elements].join(",");
}

function sourceImage(source: THREE.Texture): (ImageBitmapSource & { width: number; height: number }) | undefined {
  const image = source.image as ImageBitmapSource & { width?: number; height?: number };
  return image?.width && image.height ? image as ImageBitmapSource & { width: number; height: number } : undefined;
}

function cachedTexture(source: THREE.Texture, image: object, sampler: string): THREE.Texture | undefined {
  const cached = textureResults.get(source);
  if (cached?.image === image && cached.version === source.source.version && cached.sampler === sampler
    && cached.texture.userData.leafDisposed !== true) return cached.texture;
  const prepared = imagePreparations.get(image);
  if (prepared?.version === source.source.version && prepared.ready) return materialTexture(source, image, sampler, prepared.ready);
  return undefined;
}

function materialTexture(source: THREE.Texture, image: object, sampler: string, pixels: PreparedLeafPixels): THREE.DataTexture {
  const key = `${pixels.hash},${sampler}`;
  let prepared = preparedTextures.get(key);
  if (!prepared) {
    prepared = new THREE.DataTexture(pixels.pixels, pixels.width, pixels.height);
    prepared.name = `${source.name || "Leaf spray"} · coverage-weighted colour`;
    prepared.channel = source.channel;
    prepared.mapping = source.mapping;
    prepared.wrapS = source.wrapS; prepared.wrapT = source.wrapT;
    prepared.offset.copy(source.offset); prepared.repeat.copy(source.repeat); prepared.center.copy(source.center);
    prepared.rotation = source.rotation; prepared.matrix.copy(source.matrix); prepared.matrixAutoUpdate = source.matrixAutoUpdate;
    prepared.flipY = source.flipY;
    prepared.colorSpace = THREE.SRGBColorSpace;
    // RGB is already associated in linear space. A second upload premultiplication is wrong.
    prepared.premultiplyAlpha = false;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 8;
    prepared.userData.leafAssociatedColour = true;
    prepared.needsUpdate = true;
    const owned = prepared;
    prepared.addEventListener("dispose", () => {
      owned.userData.leafDisposed = true;
      if (preparedTextures.get(key) === owned) preparedTextures.delete(key);
    });
    preparedTextures.set(key, prepared);
  }
  textureResults.set(source, { image, version: source.source.version, sampler, texture: prepared });
  return prepared;
}

function workerAttempt(image: ImageBitmapSource): Promise<PreparedLeafPixels> {
  if (typeof Worker === "undefined" || typeof createImageBitmap === "undefined") {
    return Promise.reject(new Error("Foliage preparation requires a bitmap worker"));
  }
  const current = worker ??= new Worker(new URL("./leafTexture.worker.ts", import.meta.url), { type: "module" });
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | undefined, value?: PreparedLeafPixels, broken = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      current.removeEventListener("message", onMessage);
      current.removeEventListener("error", onError);
      current.removeEventListener("messageerror", onMessageError);
      if (broken) {
        current.terminate();
        if (worker === current) worker = undefined;
      }
      if (error) reject(error); else resolve(value!);
    };
    const onMessage = (event: MessageEvent<LeafTextureReply>): void => {
      if (event.data.id !== id) return;
      if ("error" in event.data) finish(new Error(event.data.error));
      else finish(undefined, event.data);
    };
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      finish(new Error(event.message || "Foliage worker failed"), undefined, true);
    };
    const onMessageError = (): void => finish(new Error("Foliage worker returned an unreadable response"), undefined, true);
    const timeout = setTimeout(() => finish(new Error("Foliage preparation timed out"), undefined, true), WORKER_TIMEOUT_MS);
    current.addEventListener("message", onMessage);
    current.addEventListener("error", onError);
    current.addEventListener("messageerror", onMessageError);
    // Copy asynchronously. Transferring the original would detach every material using it.
    void createImageBitmap(image, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" }).then(bitmap => {
      if (settled) { bitmap.close(); return; }
      try {
        current.postMessage({ id, bitmap } satisfies LeafTextureTask, [bitmap]);
      } catch (cause) {
        bitmap.close();
        finish(new Error("Could not transfer foliage bitmap", { cause }), undefined, true);
      }
    }, cause => finish(new Error("Could not copy foliage bitmap", { cause })));
  });
}

async function processQueue(): Promise<void> {
  if (active) return;
  const job = queue.shift();
  if (!job) return;
  active = true;
  try {
    let result: PreparedLeafPixels;
    try { result = await workerAttempt(job.image); }
    catch { result = await workerAttempt(job.image); }
    job.resolve(result);
  } catch (cause) {
    job.reject(new Error("Foliage preparation failed after retry", { cause }));
  } finally {
    active = false;
    void processQueue();
  }
}

function queueImage(image: ImageBitmapSource): Promise<PreparedLeafPixels> {
  if (queue.length >= MAX_QUEUED_IMAGES) return Promise.reject(new Error("Foliage preparation queue is full; retry after pending assets finish"));
  return new Promise((resolve, reject) => {
    queue.push({ image, resolve, reject });
    void processQueue();
  });
}

/** Prepares foliage before model publication, using one worker and one transferred bitmap at a time. */
export async function prepareLeafTextureAsync(source: THREE.Texture): Promise<THREE.Texture> {
  const image = sourceImage(source);
  // CPU-only material tests have no browser bitmap. A browser never processes pixels here.
  if (!image || typeof document === "undefined") return source;
  const sampler = samplerKey(source);
  const cached = cachedTexture(source, image, sampler);
  if (cached) return cached;
  let preparation = imagePreparations.get(image);
  if (!preparation || preparation.version !== source.source.version) {
    const entry: ImagePreparation = { version: source.source.version, pending: queueImage(image) };
    preparation = entry;
    imagePreparations.set(image, entry);
    entry.pending = entry.pending.then(pixels => { entry.ready = pixels; return pixels; }, cause => {
      if (imagePreparations.get(image) === entry) imagePreparations.delete(image);
      throw cause;
    });
  }
  const pixels = await preparation.pending;
  if (source.image !== image || source.source.version !== preparation.version || samplerKey(source) !== sampler) {
    return prepareLeafTextureAsync(source);
  }
  return materialTexture(source, image, sampler, pixels);
}

/** Synchronous lookup only. Model loading must await prepareLeafTextureAsync before treatment. */
export function prepareLeafTexture(source: THREE.Texture): THREE.Texture {
  const image = sourceImage(source);
  if (!image || typeof document === "undefined") return source;
  const cached = cachedTexture(source, image, samplerKey(source));
  if (cached) return cached;
  throw new Error(`Foliage texture was not prepared before model publication: ${source.name || source.uuid}`);
}
