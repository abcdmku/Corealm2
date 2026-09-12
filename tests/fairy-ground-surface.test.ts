import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialLibrary } from '../game/src/render/materials.js';

const libraries = new Set<MaterialLibrary>();
const textures: THREE.Texture[] = [];

function groundFixture() {
  const library = new MaterialLibrary();
  libraries.add(library);
  const material = library.ground();
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return { library, material, shader };
}

async function surfaceFixture() {
  const albedo = new THREE.Texture<HTMLImageElement>();
  const normal = new THREE.Texture<HTMLImageElement>();
  textures.push(albedo, normal);
  const loadTexture = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async url => {
    if (url.endsWith('/grass-albedo.webp')) return albedo;
    if (url.endsWith('/grass-normal.webp')) return normal;
    throw Error(`Unexpected texture request: ${url}`);
  });
  // Real exported metadata includes filenames. They must never overwrite decoded textures.
  const metadata = {
    albedo: 'grass-albedo.webp', normal: 'grass-normal.webp',
    meanLinearRgb: [0.13, 0.24, 0.09], tileMetres: 2.4,
  };
  const fetchMetadata = vi.fn(async () => new Response(JSON.stringify(metadata), { status: 200 }));
  vi.stubGlobal('fetch', fetchMetadata);
  const { loadFairyGroundSurface } = await import('../game/src/render/fairyGroundSurface.js');
  return { albedo, normal, metadata, loadTexture, fetchMetadata, loadFairyGroundSurface };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  for (const library of libraries) library.dispose();
  libraries.clear();
  for (const texture of textures.splice(0)) texture.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fairy grass surface loading and material ownership', () => {
  it('keeps decoded textures through filename-bearing metadata and into compiled ground uniforms', async () => {
    const { library, shader } = groundFixture();
    const fixture = await surfaceFixture();
    const pending = fixture.loadFairyGroundSurface();
    expect(fixture.loadFairyGroundSurface()).toBe(pending);
    const surface = await pending;
    expect(await fixture.loadFairyGroundSurface()).toBe(surface);
    expect(fixture.loadTexture).toHaveBeenCalledTimes(2);
    expect(fixture.fetchMetadata).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/grass-surface\.json$/));
    expect(surface.albedo).toBe(fixture.albedo);
    expect(surface.normal).toBe(fixture.normal);
    expect(surface.meanLinearRgb).toEqual(fixture.metadata.meanLinearRgb);
    expect(surface.tileMetres).toBe(fixture.metadata.tileMetres);
    expect(surface.albedo.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(surface.normal.colorSpace).toBe(THREE.NoColorSpace);
    for (const texture of [surface.albedo, surface.normal]) {
      expect(texture).toBeInstanceOf(THREE.Texture);
      expect(texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(texture.repeat.toArray()).toEqual([1, 1]);
      expect(texture.flipY).toBe(false);
      expect(texture.anisotropy).toBe(8);
      expect(texture.version).toBeGreaterThan(0);
    }
    library.setFairyGroundSurface(surface);
    expect(shader.uniforms.uFairyGrassReady!.value).toBe(1);
    expect(shader.uniforms.uFairyGrassAlbedo!.value).toBe(fixture.albedo);
    expect(shader.uniforms.uFairyGrassNormal!.value).toBe(fixture.normal);
    expect(shader.uniforms.uFairyGrassMean!.value.toArray()).toEqual(fixture.metadata.meanLinearRgb);
    expect(shader.uniforms.uFairyGrassTiling!.value).toBeCloseTo(1 / fixture.metadata.tileMetres);
  });

  it('disables and reenables an existing ground material without disposing shared borrowed textures', async () => {
    const fixture = await surfaceFixture();
    const surface = await fixture.loadFairyGroundSurface();
    const albedoDisposed = vi.spyOn(fixture.albedo, 'dispose');
    const normalDisposed = vi.spyOn(fixture.normal, 'dispose');
    const first = groundFixture();
    const second = groundFixture();
    const materialVersion = first.material.version;
    first.library.setFairyGroundSurface(surface);
    second.library.setFairyGroundSurface(surface);

    first.library.setFairyGroundSurface(null);
    expect(first.shader.uniforms.uFairyGrassReady!.value).toBe(0);
    expect(first.shader.uniforms.uFairyGrassAlbedo!.value).toBeNull();
    expect(first.shader.uniforms.uFairyGrassNormal!.value).toBeNull();
    expect(first.library.ground()).toBe(first.material);
    expect(first.material.version).toBe(materialVersion);
    expect(second.shader.uniforms.uFairyGrassReady!.value).toBe(1);
    expect(second.shader.uniforms.uFairyGrassAlbedo!.value).toBe(surface.albedo);

    first.library.setFairyGroundSurface(surface);
    expect(first.library.ground()).toBe(first.material);
    expect(first.shader.uniforms.uFairyGrassReady!.value).toBe(1);
    expect(first.shader.uniforms.uFairyGrassNormal!.value).toBe(surface.normal);
    for (const { library } of [first, second]) {
      library.dispose();
      libraries.delete(library);
      expect(albedoDisposed).not.toHaveBeenCalled();
      expect(normalDisposed).not.toHaveBeenCalled();
    }
  });
});
