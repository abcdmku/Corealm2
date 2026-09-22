import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { oceanDepthGridBounds, type OceanDepthGrid } from "../game/src/world/coastDepth.js";

function grid(overrides: Partial<OceanDepthGrid> = {}): OceanDepthGrid {
  return {
    heights: new Float32Array([0, 10, 20, 100]),
    cols: 2,
    rows: 2,
    minX: -20,
    minZ: 30,
    stepX: 2,
    stepZ: 3,
    ...overrides,
  };
}

function bindingsFor(material: THREE.Material): { uniforms: Record<string, {value:any}> } {
  const water = material.userData.corealmWater;
  return { uniforms: { ...water.uniforms, ...water.oceanDepth } };
}

const libraries: MaterialLibrary[] = [];
function library(): MaterialLibrary {
  const result = new MaterialLibrary();
  libraries.push(result);
  return result;
}
afterEach(() => {
  for (const materials of libraries.splice(0)) materials.dispose();
});

describe("coastal depth field", () => {
  it("keeps negative origins and unequal grid spacing in world bounds", () => {
    expect(oceanDepthGridBounds(grid())).toEqual({ maxX: -18, maxZ: 33 });
    expect(oceanDepthGridBounds(grid({
      cols: 3,
      heights: new Float32Array(6),
    }))).toEqual({ maxX: -16, maxZ: 33 });
  });

  it.each([
    { cols: 1 },
    { rows: 2.5 },
    { heights: new Float32Array(3) },
    { stepX: 0 },
    { stepZ: -1 },
    { minX: Number.NaN },
    { minZ: Number.POSITIVE_INFINITY },
    { stepX: Number.POSITIVE_INFINITY },
    { stepZ: 1e-300 },
    { minX: 1e300 },
    { minX: 3e38, stepX: 3e38 },
    { minX: 1e20, stepX: 1 },
    { heights: new Float32Array([0, Number.NaN, 0, 0]) },
    { heights: new Float32Array([0, 0, Number.NEGATIVE_INFINITY, 0]) },
  ])("rejects invalid field metadata or heights: %j", (invalid) => {
    expect(() => oceanDepthGridBounds(grid(invalid))).toThrow(RangeError);
  });

  it("uploads row-major raw heights without filtering, colour conversion or caller mutations", () => {
    const materials = library();
    const source = grid();
    materials.setOceanDepthGrid(source, -5.25);
    const bindings = bindingsFor(materials.water("fallowmarch", "ocean"));
    const texture = bindings.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const data = texture.image.data as Float32Array;
    expect(texture.image.width).toBe(2);
    expect(texture.image.height).toBe(2);
    expect(Array.from(data)).toEqual([0, 10, 20, 100]);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.type).toBe(THREE.FloatType);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.flipY).toBe(false);
    expect(texture.unpackAlignment).toBe(1);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(bindings.uniforms.uOceanGridBounds!.value.toArray()).toEqual([-20, 30, -18, 33]);
    expect(bindings.uniforms.uOceanGridSize!.value.toArray()).toEqual([2, 2]);
    expect(bindings.uniforms.uOceanGridStep!.value.toArray()).toEqual([2, 3]);
    expect(bindings.uniforms.uOceanSeaLevel!.value).toBe(-5.25);
    source.heights[0] = 999;
    expect(data[0]).toBe(0);
  });

  it("builds distinct depth colour, shoreline opacity and two-wave normal graphs", () => {
    const materials = library();
    const ocean = materials.water("fallowmarch", "ocean");
    const lake = materials.water();
    expect(ocean.isMeshStandardNodeMaterial).toBe(true);
    for (const material of [ocean, lake]) {
      expect(material.colorNode).not.toBeNull();
      expect(material.opacityNode).not.toBeNull();
      expect(material.normalNode).not.toBeNull();
      expect(material.envNode).not.toBeNull();
      expect(material.userData.corealmWater.uniforms.uDepthRange.value).toBe(1.2);
      expect(material.userData.corealmWater.uniforms.uEdgeFade.value).toBe(0.25);
    }
    expect(ocean.opacityNode).not.toBe(lake.opacityNode);
    expect(ocean.userData.corealmWater.oceanDepth).not.toBeNull();
    expect(lake.userData.corealmWater.oceanDepth).toBeNull();
  });

  it("gives rivers independent animation controls without modifying cached lake settings", () => {
    const materials = library(), time = { value: 5 };
    const river = materials.createWaterVariant('crownward', { time,
      waveScrollA: new THREE.Vector2(-.003, .0005), waveScrollB: new THREE.Vector2(-.005, -.001), edgeFade: .045 });
    const lake = materials.water('crownward');
    materials.setTime(9);
    expect(river.userData.corealmWater.uniforms.uTime).toBe(time);
    expect(time.value).toBe(5);
    expect(lake.userData.corealmWater.uniforms.uTime.value).toBe(9);
    expect(river.userData.corealmWater.uniforms.uEdgeFade.value).toBe(.045);
    expect(lake.userData.corealmWater.uniforms.uEdgeFade.value).toBe(.25);
    expect(river.normalMap).toBe(lake.normalMap);
    expect(river.normalNode).not.toBe(lake.normalNode);
    river.dispose();
  });

});

describe("ocean material lifecycle", () => {
  it("keeps lake defaults, uniforms and cache separate from the ocean variant", () => {
    const materials = library();
    const lake = materials.water();
    const lakeBindings = bindingsFor(lake);
    const ocean = materials.water("fallowmarch", "ocean");
    materials.setOceanDepthGrid(grid(), -5.25);
    const oceanBindings = bindingsFor(ocean);
    expect(materials.water("fallowmarch", "lake")).toBe(lake);
    expect(materials.water("fallowmarch", "ocean")).toBe(ocean);
    expect(ocean).not.toBe(lake);
    expect(ocean.customProgramCacheKey()).not.toBe(lake.customProgramCacheKey());
    expect(lake.opacity).toBe(0.94);
    expect(lake.name).toBe("water-fallowmarch");
    expect(ocean.opacity).toBe(1);
    expect(ocean.transparent).toBe(true);
    expect(ocean.depthWrite).toBe(false);
    expect(ocean.side).toBe(THREE.FrontSide);
    expect(lake.normalMap).toBe(ocean.normalMap);
    expect(Object.keys(lakeBindings.uniforms).some((key) => key.startsWith("uOcean"))).toBe(false);
    expect(lakeBindings.uniforms.uShallow).not.toBe(oceanBindings.uniforms.uShallow);
    expect(lakeBindings.uniforms.uShallow!.value.equals(oceanBindings.uniforms.uShallow!.value)).toBe(true);
    expect(lakeBindings.uniforms.uDeep!.value.equals(oceanBindings.uniforms.uDeep!.value)).toBe(true);
    materials.setTime(17);
    expect(lakeBindings.uniforms.uTime!.value).toBe(17);
    expect(oceanBindings.uniforms.uTime!.value).toBe(17);
    expect(materials.size()).toBe(2);
  });

  it("rebinds ocean node uniforms across replacement, clear and rebuild", () => {
    const materials = library();
    const ocean = materials.water("fallowmarch", "ocean");
    const bindings = bindingsFor(ocean);
    const wrappers = { ...bindings.uniforms };
    expect(bindings.uniforms.uOceanDepthReady!.value).toBe(0);
    expect(bindings.uniforms.uOceanDepthGrid!.value).toBeNull();
    materials.setOceanDepthGrid(grid(), -5.25);
    const firstTexture = bindings.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const firstDispose = vi.fn();
    firstTexture.addEventListener("dispose", firstDispose);
    materials.setOceanDepthGrid(grid({ cols: 3, heights: new Float32Array(6), minX: 60 }), 4);
    const secondTexture = bindings.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const secondDispose = vi.fn();
    secondTexture.addEventListener("dispose", secondDispose);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondTexture).not.toBe(firstTexture);
    expect(secondTexture.image.width).toBe(3);
    expect(bindings.uniforms.uOceanGridBounds!.value.toArray()).toEqual([60, 30, 64, 33]);
    expect(bindings.uniforms.uOceanSeaLevel!.value).toBe(4);
    for (const name of Object.keys(wrappers)) expect(bindings.uniforms[name]).toBe(wrappers[name]);
    materials.setOceanDepthGrid(null);
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(bindings.uniforms.uOceanDepthReady!.value).toBe(0);
    expect(bindings.uniforms.uOceanDepthGrid!.value).toBeNull();
    materials.setOceanDepthGrid(grid(), -5.25);
    const rebuiltBindings = bindingsFor(ocean);
    expect(rebuiltBindings.uniforms.uOceanDepthGrid).toBe(bindings.uniforms.uOceanDepthGrid);
    expect(bindings.uniforms.uOceanDepthReady!.value).toBe(1);
    expect(materials.water("fallowmarch", "ocean")).toBe(ocean);
    expect(materials.size()).toBe(1);
  });

  it("retains the current field when a replacement or sea level is invalid", () => {
    const materials = library();
    materials.setOceanDepthGrid(grid(), -5.25);
    const bindings = bindingsFor(materials.water("fallowmarch", "ocean"));
    const texture = bindings.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const disposed = vi.fn();
    texture.addEventListener("dispose", disposed);
    expect(() => materials.setOceanDepthGrid(grid({ stepX: -1 }), 2)).toThrow(RangeError);
    expect(() => materials.setOceanDepthGrid(grid(), Number.NaN)).toThrow(RangeError);
    expect(() => materials.setOceanDepthGrid(grid(), 1e300)).toThrow(RangeError);
    expect(bindings.uniforms.uOceanDepthGrid!.value).toBe(texture);
    expect(bindings.uniforms.uOceanDepthReady!.value).toBe(1);
    expect(bindings.uniforms.uOceanSeaLevel!.value).toBe(-5.25);
    expect(disposed).not.toHaveBeenCalled();
  });

  it("releases its depth texture exactly once at library disposal", () => {
    const materials = library();
    materials.setOceanDepthGrid(grid());
    const bindings = bindingsFor(materials.water("fallowmarch", "ocean"));
    const disposed = vi.fn();
    (bindings.uniforms.uOceanDepthGrid!.value as THREE.DataTexture).addEventListener("dispose", disposed);
    materials.dispose();
    materials.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(bindings.uniforms.uOceanDepthGrid!.value).toBeNull();
    expect(bindings.uniforms.uOceanDepthReady!.value).toBe(0);
  });
});
