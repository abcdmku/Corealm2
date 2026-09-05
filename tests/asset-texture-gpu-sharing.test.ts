import * as THREE from "three";
import { WebGLInfo } from "three/src/renderers/webgl/WebGLInfo.js";
import { WebGLProperties } from "three/src/renderers/webgl/WebGLProperties.js";
import { WebGLTextures } from "three/src/renderers/webgl/WebGLTextures.js";
import { WebGLUtils } from "three/src/renderers/webgl/WebGLUtils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetTextureCache } from "../game/src/render/assets.js";

class TestImageBitmap {
  readonly width = 4;
  readonly height = 4;
  readonly close = vi.fn();
}

/**
 * Runs the installed Three texture manager, property store, format conversion and
 * memory accounting. Only the WebGL driver and state calls are replaced. This
 * proves allocation/upload/disposal decisions, not browser or GPU performance.
 */
function textureDriver() {
  let nextTextureId = 0;
  const gl = {
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8c43,
    UNSIGNED_BYTE: 0x1401,
    REPEAT: 0x2901,
    CLAMP_TO_EDGE: 0x812f,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    UNPACK_ALIGNMENT: 0x0cf5,
    createTexture: vi.fn(() => ({ id: ++nextTextureId })),
    deleteTexture: vi.fn(),
    texParameteri: vi.fn(),
    generateMipmap: vi.fn(),
  };
  const state = {
    bindTexture: vi.fn(),
    activeTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texStorage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    texImage2D: vi.fn(),
  };
  const extensions = { has: () => false, get: () => null };
  type Dependencies = ConstructorParameters<typeof WebGLTextures>;
  const driver = gl as unknown as Dependencies[0];
  const driverExtensions = extensions as unknown as Dependencies[1];
  const properties = new WebGLProperties();
  const info = new WebGLInfo(driver);
  const textures = new WebGLTextures(
    driver,
    driverExtensions,
    state as unknown as Dependencies[2],
    properties,
    { maxTextures: 16, maxTextureSize: 4096 } as Dependencies[4],
    new WebGLUtils(driver, driverExtensions),
    info,
  );
  return { gl, state, properties, info, textures };
}

function bitmapTexture(bitmap: TestImageBitmap): THREE.Texture {
  const texture = new THREE.Texture(bitmap as unknown as ImageBitmap);
  texture.needsUpdate = true;
  return texture;
}

function rootFor(texture: THREE.Texture): THREE.Object3D {
  return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
}

function allocation(driver: ReturnType<typeof textureDriver>, texture: THREE.Texture): unknown {
  return (driver.properties.get(texture) as { __webglTexture?: unknown }).__webglTexture;
}

beforeEach(() => {
  vi.stubGlobal("ImageBitmap", TestImageBitmap);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssetTextureCache through Three's WebGL texture manager", () => {
  it("allocates and uploads twice for the same bitmap when Sources remain distinct", () => {
    const bitmap = new TestImageBitmap();
    const first = bitmapTexture(bitmap);
    const second = bitmapTexture(bitmap);
    const driver = textureDriver();

    expect(first.image).toBe(second.image);
    expect(first.source).not.toBe(second.source);
    driver.textures.setTexture2D(first, 0);
    driver.textures.setTexture2D(second, 1);

    expect(driver.gl.createTexture).toHaveBeenCalledTimes(2);
    expect(driver.state.texStorage2D).toHaveBeenCalledTimes(2);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(2);
    expect(driver.info.memory.textures).toBe(2);
    expect(allocation(driver, first)).not.toBe(allocation(driver, second));
    first.dispose();
    second.dispose();
    expect(driver.gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(driver.info.memory.textures).toBe(0);
  });

  it("shares one allocation and upload while keeping compatible Texture objects distinct", () => {
    const bitmap = new TestImageBitmap();
    const first = bitmapTexture(bitmap);
    const second = bitmapTexture(bitmap);
    second.offset.set(0.25, 0.5);
    second.repeat.set(2, 3);
    second.channel = 1;
    const firstRoot = rootFor(first);
    const secondRoot = rootFor(second);
    const versions = [first.version, second.version, first.source.version];
    const cache = new AssetTextureCache();

    cache.shareSources([firstRoot, secondRoot]);

    expect(first).not.toBe(second);
    expect(first.source).toBe(second.source);
    expect([first.version, second.version, first.source.version]).toEqual(versions);
    expect(second.offset.toArray()).toEqual([0.25, 0.5]);
    expect(second.repeat.toArray()).toEqual([2, 3]);
    expect(second.channel).toBe(1);

    const driver = textureDriver();
    driver.textures.setTexture2D(first, 0);
    driver.textures.setTexture2D(second, 1);
    driver.textures.setTexture2D(first, 0);
    driver.textures.setTexture2D(second, 1);

    expect(driver.gl.createTexture).toHaveBeenCalledTimes(1);
    expect(driver.state.texStorage2D).toHaveBeenCalledTimes(1);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(driver.state.texSubImage2D).toHaveBeenCalledWith(
      driver.gl.TEXTURE_2D, 0, 0, 0, driver.gl.RGBA, driver.gl.UNSIGNED_BYTE, bitmap,
    );
    expect(driver.gl.generateMipmap).toHaveBeenCalledTimes(1);
    expect(driver.info.memory.textures).toBe(1);
    expect(allocation(driver, first)).toBe(allocation(driver, second));
    first.dispose();
    second.dispose();
  });

  it("does not reupload an existing Source when a later compatible texture has a different version", () => {
    const bitmap = new TestImageBitmap();
    const first = bitmapTexture(bitmap);
    const cache = new AssetTextureCache();
    const driver = textureDriver();
    cache.shareSources([rootFor(first)]);
    driver.textures.setTexture2D(first, 0);
    const uploadedSourceVersion = first.source.version;

    const later = bitmapTexture(bitmap);
    later.needsUpdate = true;
    later.needsUpdate = true;
    const laterVersion = later.version;
    expect(laterVersion).not.toBe(first.version);
    cache.shareSources([rootFor(later)]);
    expect(later.source).toBe(first.source);
    expect(later.source.version).toBe(uploadedSourceVersion);
    expect(later.version).toBe(laterVersion);

    driver.textures.setTexture2D(later, 1);
    cache.shareSources([rootFor(first), rootFor(later)]);
    driver.textures.setTexture2D(first, 0);
    driver.textures.setTexture2D(later, 1);

    expect(driver.gl.createTexture).toHaveBeenCalledTimes(1);
    expect(driver.state.texStorage2D).toHaveBeenCalledTimes(1);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(driver.info.memory.textures).toBe(1);
    expect(allocation(driver, first)).toBe(allocation(driver, later));
    first.dispose();
    later.dispose();
  });

  it("isolates color spaces and uploads the matching internal formats", () => {
    const bitmap = new TestImageBitmap();
    const linear = bitmapTexture(bitmap);
    const srgb = bitmapTexture(bitmap);
    linear.colorSpace = THREE.LinearSRGBColorSpace;
    srgb.colorSpace = THREE.SRGBColorSpace;
    new AssetTextureCache().shareSources([rootFor(linear), rootFor(srgb)]);
    expect(linear.source).not.toBe(srgb.source);

    const driver = textureDriver();
    driver.textures.setTexture2D(linear, 0);
    driver.textures.setTexture2D(srgb, 1);

    expect(driver.gl.createTexture).toHaveBeenCalledTimes(2);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(2);
    expect(driver.state.texStorage2D).toHaveBeenNthCalledWith(1, driver.gl.TEXTURE_2D, 3, driver.gl.RGBA8, 4, 4);
    expect(driver.state.texStorage2D).toHaveBeenNthCalledWith(2, driver.gl.TEXTURE_2D, 3, driver.gl.SRGB8_ALPHA8, 4, 4);
    expect(allocation(driver, linear)).not.toBe(allocation(driver, srgb));
    linear.dispose();
    expect(driver.info.memory.textures).toBe(1);
    srgb.dispose();
    expect(driver.info.memory.textures).toBe(0);
  });

  it("isolates sampler differences and submits each texture's wrapping", () => {
    const bitmap = new TestImageBitmap();
    const clamped = bitmapTexture(bitmap);
    const repeating = bitmapTexture(bitmap);
    repeating.wrapS = THREE.RepeatWrapping;
    new AssetTextureCache().shareSources([rootFor(clamped), rootFor(repeating)]);
    expect(clamped.source).not.toBe(repeating.source);

    const driver = textureDriver();
    driver.textures.setTexture2D(clamped, 0);
    driver.textures.setTexture2D(repeating, 1);

    expect(driver.gl.createTexture).toHaveBeenCalledTimes(2);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(2);
    expect(driver.gl.texParameteri).toHaveBeenCalledWith(driver.gl.TEXTURE_2D, driver.gl.TEXTURE_WRAP_S, driver.gl.CLAMP_TO_EDGE);
    expect(driver.gl.texParameteri).toHaveBeenCalledWith(driver.gl.TEXTURE_2D, driver.gl.TEXTURE_WRAP_S, driver.gl.REPEAT);
    expect(allocation(driver, clamped)).not.toBe(allocation(driver, repeating));
    clamped.dispose();
    repeating.dispose();
    expect(driver.gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(driver.info.memory.textures).toBe(0);
  });

  it("keeps the shared allocation until its last owner disposes and reallocates for a later owner", () => {
    const bitmap = new TestImageBitmap();
    const first = bitmapTexture(bitmap);
    const second = bitmapTexture(bitmap);
    const cache = new AssetTextureCache();
    cache.shareSources([rootFor(first), rootFor(second)]);
    const driver = textureDriver();
    driver.textures.setTexture2D(first, 0);
    driver.textures.setTexture2D(second, 1);
    const sharedAllocation = allocation(driver, second);

    first.dispose();
    expect(driver.properties.has(first)).toBe(false);
    expect(driver.properties.has(second)).toBe(true);
    expect(driver.gl.deleteTexture).not.toHaveBeenCalled();
    expect(driver.info.memory.textures).toBe(1);
    driver.textures.setTexture2D(second, 0);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(allocation(driver, second)).toBe(sharedAllocation);

    second.dispose();
    expect(driver.properties.has(second)).toBe(false);
    expect(driver.gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(sharedAllocation);
    expect(driver.info.memory.textures).toBe(0);
    first.dispose();
    second.dispose();
    expect(driver.gl.deleteTexture).toHaveBeenCalledTimes(1);

    const later = bitmapTexture(bitmap);
    cache.shareSources([rootFor(later)]);
    driver.textures.setTexture2D(later, 0);
    expect(driver.gl.createTexture).toHaveBeenCalledTimes(2);
    expect(driver.state.texStorage2D).toHaveBeenCalledTimes(2);
    expect(driver.state.texSubImage2D).toHaveBeenCalledTimes(2);
    expect(allocation(driver, later)).not.toBe(sharedAllocation);
    expect(driver.info.memory.textures).toBe(1);
    later.dispose();
    expect(driver.gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(driver.info.memory.textures).toBe(0);
    expect(bitmap.close).not.toHaveBeenCalled();
  });
});
