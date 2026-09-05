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

function shaderFor(material: THREE.Material): Parameters<THREE.Material["onBeforeCompile"]>[0] {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<THREE.Material["onBeforeCompile"]>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
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
    const shader = shaderFor(materials.water("fallowmarch", "ocean"));
    const texture = shader.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
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
    expect(shader.uniforms.uOceanGridBounds!.value.toArray()).toEqual([-20, 30, -18, 33]);
    expect(shader.uniforms.uOceanGridSize!.value.toArray()).toEqual([2, 2]);
    expect(shader.uniforms.uOceanGridStep!.value.toArray()).toEqual([2, 3]);
    expect(shader.uniforms.uOceanSeaLevel!.value).toBe(-5.25);
    source.heights[0] = 999;
    expect(data[0]).toBe(0);
  });

  it("evaluates the production shader's triangle expression on a noncoplanar cell", () => {
    const shader = shaderFor(library().water("fallowmarch", "ocean"));
    const expression = shader.fragmentShader.match(/float height = ([\s\S]*?);/)?.[1];
    expect(expression).toBeDefined();
    // This scalar GLSL expression is valid JavaScript. Evaluate the production expression,
    // rather than supplying a second CPU interpolation implementation to this check.
    const height = new Function("a", "b", "c", "d", "f", `return (${expression});`) as (
      a: number, b: number, c: number, d: number, f: { x: number; y: number },
    ) => number;
    const sample = (x: number, z: number): number => height(0, 10, 20, 100, { x, y: z });
    expect(sample(0.25, 0.25)).toBe(7.5);
    expect(sample(0.75, 0.75)).toBe(57.5);
    expect(sample(0.75, 0.25)).toBe(12.5);
    expect(sample(0, 0)).toBe(0);
    expect(sample(1, 0)).toBe(10);
    expect(sample(0, 1)).toBe(20);
    expect(sample(1, 1)).toBe(100);
    expect(Math.abs(sample(0.6, 0.4 - 1e-8) - sample(0.6, 0.4 + 1e-8))).toBeLessThan(1e-5);
  });

  it("fades the production ocean at the shore and becomes exactly opaque in deep water", () => {
    const shader = shaderFor(library().water("fallowmarch", "ocean"));
    const expression = shader.fragmentShader.match(/diffuseColor\.a \*= ([^;]+);/)?.[1];
    expect(expression).toBeDefined();
    const alpha = new Function("depth", "depth01", "uEdgeFade", "smoothstep", "mix", `return (${expression});`) as (
      depth: number, depth01: number, edge: number,
      smoothstep: (low: number, high: number, x: number) => number,
      mix: (a: number, b: number, t: number) => number,
    ) => number;
    const sample = (depth: number): number => alpha(
      depth, THREE.MathUtils.clamp(depth / shader.uniforms.uDepthRange!.value, 0, 1),
      shader.uniforms.uEdgeFade!.value,
      (low, high, x) => THREE.MathUtils.smoothstep(x, low, high), THREE.MathUtils.lerp,
    );
    expect(sample(0)).toBe(0);
    expect(sample(0.125)).toBeCloseTo(0.473125);
    expect(sample(0.25)).toBeCloseTo(0.9525);
    expect(sample(1.2)).toBe(1);
    expect(sample(3)).toBe(1);
  });
});

describe("ocean material lifecycle", () => {
  it("keeps lake defaults, uniforms and cache separate from the ocean variant", () => {
    const materials = library();
    const lake = materials.water();
    const lakeShader = shaderFor(lake);
    const ocean = materials.water("fallowmarch", "ocean");
    materials.setOceanDepthGrid(grid(), -5.25);
    const oceanShader = shaderFor(ocean);
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
    expect(lakeShader.fragmentShader).not.toContain("uOcean");
    expect(Object.keys(lakeShader.uniforms).some((key) => key.startsWith("uOcean"))).toBe(false);
    expect(lakeShader.uniforms.uShallow).not.toBe(oceanShader.uniforms.uShallow);
    expect(lakeShader.uniforms.uShallow!.value.equals(oceanShader.uniforms.uShallow!.value)).toBe(true);
    expect(lakeShader.uniforms.uDeep!.value.equals(oceanShader.uniforms.uDeep!.value)).toBe(true);
    materials.setTime(17);
    expect(lakeShader.uniforms.uTime!.value).toBe(17);
    expect(oceanShader.uniforms.uTime!.value).toBe(17);
    expect(materials.size()).toBe(2);
  });

  it("rebinds compiled ocean uniforms across replacement, clear and rebuild", () => {
    const materials = library();
    const ocean = materials.water("fallowmarch", "ocean");
    const shader = shaderFor(ocean);
    const wrappers = { ...shader.uniforms };
    expect(shader.uniforms.uOceanDepthReady!.value).toBe(0);
    expect(shader.uniforms.uOceanDepthGrid!.value).toBeNull();
    materials.setOceanDepthGrid(grid(), -5.25);
    const firstTexture = shader.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const firstDispose = vi.fn();
    firstTexture.addEventListener("dispose", firstDispose);
    materials.setOceanDepthGrid(grid({ cols: 3, heights: new Float32Array(6), minX: 60 }), 4);
    const secondTexture = shader.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const secondDispose = vi.fn();
    secondTexture.addEventListener("dispose", secondDispose);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondTexture).not.toBe(firstTexture);
    expect(secondTexture.image.width).toBe(3);
    expect(shader.uniforms.uOceanGridBounds!.value.toArray()).toEqual([60, 30, 64, 33]);
    expect(shader.uniforms.uOceanSeaLevel!.value).toBe(4);
    for (const name of Object.keys(wrappers)) expect(shader.uniforms[name]).toBe(wrappers[name]);
    materials.setOceanDepthGrid(null);
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(shader.uniforms.uOceanDepthReady!.value).toBe(0);
    expect(shader.uniforms.uOceanDepthGrid!.value).toBeNull();
    materials.setOceanDepthGrid(grid(), -5.25);
    const rebuiltShader = shaderFor(ocean);
    expect(rebuiltShader.uniforms.uOceanDepthGrid).toBe(shader.uniforms.uOceanDepthGrid);
    expect(shader.uniforms.uOceanDepthReady!.value).toBe(1);
    expect(materials.water("fallowmarch", "ocean")).toBe(ocean);
    expect(materials.size()).toBe(1);
  });

  it("retains the current field when a replacement or sea level is invalid", () => {
    const materials = library();
    materials.setOceanDepthGrid(grid(), -5.25);
    const shader = shaderFor(materials.water("fallowmarch", "ocean"));
    const texture = shader.uniforms.uOceanDepthGrid!.value as THREE.DataTexture;
    const disposed = vi.fn();
    texture.addEventListener("dispose", disposed);
    expect(() => materials.setOceanDepthGrid(grid({ stepX: -1 }), 2)).toThrow(RangeError);
    expect(() => materials.setOceanDepthGrid(grid(), Number.NaN)).toThrow(RangeError);
    expect(() => materials.setOceanDepthGrid(grid(), 1e300)).toThrow(RangeError);
    expect(shader.uniforms.uOceanDepthGrid!.value).toBe(texture);
    expect(shader.uniforms.uOceanDepthReady!.value).toBe(1);
    expect(shader.uniforms.uOceanSeaLevel!.value).toBe(-5.25);
    expect(disposed).not.toHaveBeenCalled();
  });

  it("releases its depth texture exactly once at library disposal", () => {
    const materials = library();
    materials.setOceanDepthGrid(grid());
    const shader = shaderFor(materials.water("fallowmarch", "ocean"));
    const disposed = vi.fn();
    (shader.uniforms.uOceanDepthGrid!.value as THREE.DataTexture).addEventListener("dispose", disposed);
    materials.dispose();
    materials.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(shader.uniforms.uOceanDepthGrid!.value).toBeNull();
    expect(shader.uniforms.uOceanDepthReady!.value).toBe(0);
  });
});
