import * as THREE from "three";
import { SRGBToLinear } from "three/src/math/ColorManagement.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { associateLeafColour, prepareLeafPixels } from "../game/src/render/leafTexturePixels.js";
import type { LeafTextureTask } from "../game/src/render/leafTexture.worker.js";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function workerBrowser() {
  const pixels = new Uint8ClampedArray([65, 143, 38, 255, 0, 0, 0, 0]);
  const workers: FakeWorker[] = [];
  const transfers: Transferable[][] = [];
  let blocked = false;
  let errors = 0;
  let crashes = 0;
  class FakeWorker extends EventTarget {
    pending: LeafTextureTask[] = [];
    terminate = vi.fn(() => { this.pending.length = 0; });
    constructor() { super(); workers.push(this); }
    postMessage(task: LeafTextureTask, transfer: Transferable[]) {
      transfers.push(transfer);
      this.pending.push(task);
      if (!blocked) queueMicrotask(() => this.finish());
    }
    finish() {
      const task = this.pending.shift()!;
      if (crashes-- > 0) {
        const event = new Event("error", { cancelable: true });
        Object.assign(event, { message: "Worker crashed" });
        this.dispatchEvent(event);
        return;
      }
      const data = errors-- > 0 ? { id: task.id, error: "Pixel read failed" }
        : { id: task.id, ...prepareLeafPixels(pixels, task.bitmap.width, task.bitmap.height) };
      task.bitmap.close();
      this.dispatchEvent(new MessageEvent("message", { data }));
    }
  }
  const copy = vi.fn(async (source: { width: number; height: number }) => ({
    width: source.width, height: source.height, close: vi.fn(),
  }));
  vi.stubGlobal("document", { createElement: () => { throw new Error("No page canvas work allowed"); } });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("createImageBitmap", copy);
  return {
    workers, transfers, copy,
    block: () => { blocked = true; },
    unblock: () => { blocked = false; if (workers.at(-1)?.pending.length) workers.at(-1)!.finish(); },
    fail: (count: number) => { errors = count; },
    crash: (count: number) => { crashes = count; },
  };
}

describe("foliage colour filtering", () => {
  it("preserves every alpha and opaque colour byte", () => {
    const source = Uint8Array.from({ length: 256 * 4 }, (_, i) => i % 4 === 3 ? i / 4 : 47 + i % 3 * 45);
    const result = associateLeafColour(source);
    for (let i = 3; i < source.length; i += 4) expect(result[i]).toBe(source[i]);
    expect(result.slice(0, 4)).toEqual(new Uint8Array(4));
    expect(result.slice(-4)).toEqual(source.slice(-4));
  });

  it("keeps green colour stable as its filtered coverage shrinks beside empty texels", () => {
    const colour = [65, 143, 38];
    const pixels = new Uint8Array([...colour, 255, 250, 20, 240, 0, ...colour, 85, 0, 0, 0, 0]);
    const associated = associateLeafColour(pixels);
    for (const footprint of [[0], [0, 1], [0, 1, 2, 3]]) {
      const coverage = footprint.reduce((sum, p) => sum + associated[p * 4 + 3]! / 255, 0);
      for (let c = 0; c < 3; c++) {
        const filtered = footprint.reduce((sum, p) => sum + SRGBToLinear(associated[p * 4 + c]! / 255), 0) / coverage;
        expect(Math.abs(filtered - SRGBToLinear(colour[c]! / 255))).toBeLessThan(.0015);
      }
    }
  });

  it("prepares shared images once in a worker, preserving UV transforms and original bitmaps", async () => {
    const browser = workerBrowser();
    const { prepareLeafTexture, prepareLeafTextureAsync } = await import("../game/src/render/leafTexture.js");
    const original = { width: 2, height: 1, close: vi.fn() };
    const source = new THREE.Texture(original);
    source.colorSpace = THREE.SRGBColorSpace;
    source.flipY = false; source.offset.set(.25, .125); source.repeat.set(.5, .75);
    const variant = source.clone();
    expect(() => prepareLeafTexture(source)).toThrow("not prepared");
    const [prepared, shared] = await Promise.all([prepareLeafTextureAsync(source), prepareLeafTextureAsync(variant)]);
    expect(shared).toBe(prepared);
    expect(browser.copy).toHaveBeenCalledTimes(1);
    expect(browser.copy).toHaveBeenCalledWith(original, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
    expect(browser.transfers[0]![0]).not.toBe(original);
    expect(original.close).not.toHaveBeenCalled();
    expect(prepareLeafTexture(variant)).toBe(prepared);
    expect(prepareLeafTexture(source)).toBe(prepared);
    const data = (prepared as THREE.DataTexture).image.data as Uint8Array;
    expect(data.filter((_, i) => i % 4 === 3)).toEqual(new Uint8Array([255, 0]));
    expect(prepared.offset).toEqual(source.offset); expect(prepared.repeat).toEqual(source.repeat);
    expect(prepared.flipY).toBe(false);
    expect(prepared.premultiplyAlpha).toBe(false);
    expect(prepared.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(prepared.generateMipmaps).toBe(true);
    expect(source.image).toBe(original);
    prepared.dispose();
    const replacement = prepareLeafTexture(source);
    expect(replacement).not.toBe(prepared);
    expect(replacement.userData.leafDisposed).not.toBe(true);
    replacement.dispose(); source.dispose(); variant.dispose();
  });

  it("shares identical content but keeps distinct UV samplers without processing a shared image again", async () => {
    const browser = workerBrowser();
    const { prepareLeafTextureAsync, prepareLeafTexture } = await import("../game/src/render/leafTexture.js");
    const source = new THREE.Texture({ width: 2, height: 1 });
    const differentImage = new THREE.Texture({ width: 2, height: 1 });
    const variant = source.clone();
    variant.offset.x = .25;
    const first = await prepareLeafTextureAsync(source);
    expect(await prepareLeafTextureAsync(differentImage)).toBe(first);
    const sampled = prepareLeafTexture(variant);
    expect(sampled).not.toBe(first);
    expect(sampled.offset.x).toBe(.25);
    expect(browser.copy).toHaveBeenCalledTimes(2);
    expect((sampled as THREE.DataTexture).image.data).toBe((first as THREE.DataTexture).image.data);
    first.dispose(); sampled.dispose();
  });

  it("replaces a crashed worker and retries without detaching the source", async () => {
    const browser = workerBrowser();
    browser.crash(1);
    const { prepareLeafTextureAsync } = await import("../game/src/render/leafTexture.js");
    const original = { width: 2, height: 1, close: vi.fn() };
    const texture = await prepareLeafTextureAsync(new THREE.Texture(original));
    expect(texture.userData.leafAssociatedColour).toBe(true);
    expect(browser.workers).toHaveLength(2);
    expect(browser.workers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(browser.copy).toHaveBeenCalledTimes(2);
    expect(original.close).not.toHaveBeenCalled();
    texture.dispose();
  });

  it("rejects persistent worker failures and lets a later asset retry succeed", async () => {
    const browser = workerBrowser();
    browser.fail(2);
    const { prepareLeafTextureAsync, prepareLeafTexture } = await import("../game/src/render/leafTexture.js");
    const source = new THREE.Texture({ width: 2, height: 1 });
    await expect(prepareLeafTextureAsync(source)).rejects.toThrow("failed after retry");
    expect(() => prepareLeafTexture(source)).toThrow("not prepared");
    const prepared = await prepareLeafTextureAsync(source);
    expect(prepareLeafTexture(source)).toBe(prepared);
    expect(browser.copy).toHaveBeenCalledTimes(3);
    prepared.dispose();
  });

  it("bounds queued images and creates only one transferable bitmap at a time", async () => {
    const browser = workerBrowser();
    browser.block();
    const { prepareLeafTextureAsync } = await import("../game/src/render/leafTexture.js");
    const jobs = Array.from({ length: 33 }, () => prepareLeafTextureAsync(new THREE.Texture({ width: 2, height: 1 })));
    const overflow = new THREE.Texture({ width: 2, height: 1 });
    await expect(prepareLeafTextureAsync(overflow)).rejects.toThrow("queue is full");
    expect(browser.copy).toHaveBeenCalledTimes(1);
    expect(browser.workers[0]!.pending).toHaveLength(1);
    browser.unblock();
    const textures = await Promise.all(jobs);
    expect(new Set(textures).size).toBe(1);
    expect(await prepareLeafTextureAsync(overflow)).toBe(textures[0]);
    textures[0]!.dispose();
  });

  it("bounds stalled worker requests, releases the queue, and allows a fresh worker afterward", async () => {
    vi.useFakeTimers();
    const browser = workerBrowser();
    browser.block();
    const { prepareLeafTextureAsync } = await import("../game/src/render/leafTexture.js");
    const source = new THREE.Texture({ width: 2, height: 1 });
    const rejected = expect(prepareLeafTextureAsync(source)).rejects.toThrow("failed after retry");
    await vi.runAllTimersAsync();
    await rejected;
    expect(browser.workers).toHaveLength(2);
    for (const worker of browser.workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
    browser.unblock();
    const prepared = await prepareLeafTextureAsync(source);
    expect(browser.workers).toHaveLength(3);
    prepared.dispose();
  });

  it("performs canvas readback and conversion in the worker and transfers the exact output buffer", async () => {
    const input = new Uint8ClampedArray([65, 143, 38, 255, 90, 50, 10, 63]);
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({ data: input }));
    const context = { drawImage, getImageData };
    const scope = { onmessage: (_event: { data: LeafTextureTask }) => {}, postMessage: vi.fn() };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext() { return context; }
    });
    await import("../game/src/render/leafTexture.worker.js");
    const bitmap = { width: 2, height: 1, close: vi.fn() };
    scope.onmessage({ data: { id: 17, bitmap: bitmap as unknown as ImageBitmap } });
    const [reply, options] = scope.postMessage.mock.calls[0]!;
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(reply).toEqual({ id: 17, ...prepareLeafPixels(input, 2, 1) });
    expect(options.transfer).toEqual([reply.pixels.buffer]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    getImageData.mockImplementationOnce(() => { throw new Error("Read failed"); });
    scope.onmessage({ data: { id: 18, bitmap: bitmap as unknown as ImageBitmap } });
    expect(scope.postMessage).toHaveBeenLastCalledWith({ id: 18, error: "Read failed" });
    expect(bitmap.close).toHaveBeenCalledTimes(2);
  });

  it("prepares in browser workers even when document is absent", async () => {
    const browser = workerBrowser();
    vi.stubGlobal("document", undefined);
    const { prepareLeafTextureAsync, prepareLeafTexture } = await import("../game/src/render/leafTexture.js");
    const source = new THREE.Texture({ width: 2, height: 1 });
    expect(() => prepareLeafTexture(source)).toThrow("not prepared");
    const prepared = await prepareLeafTextureAsync(source);
    expect(prepared.userData.leafAssociatedColour).toBe(true);
    expect(browser.copy).toHaveBeenCalledTimes(1);
    prepared.dispose();
  });

  it("keeps CPU-only tests deterministic without introducing a browser synchronous fallback", async () => {
    const { prepareLeafTextureAsync, prepareLeafTexture } = await import("../game/src/render/leafTexture.js");
    const source = new THREE.Texture({ width: 2, height: 1 });
    expect(prepareLeafTexture(source)).toBe(source);
    expect(await prepareLeafTextureAsync(source)).toBe(source);
    vi.stubGlobal("document", {});
    await expect(prepareLeafTextureAsync(source)).rejects.toThrow("failed after retry");
  });
});
