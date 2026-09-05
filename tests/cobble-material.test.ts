import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaterialLibrary } from "../game/src/render/materials.js";
import type { CorealmSurfaceTextures } from "../game/src/render/corealmSurfaceMaterials.js";

const libraries: MaterialLibrary[] = [];
function ground(textures?: CorealmSurfaceTextures) {
  const library = new MaterialLibrary();
  libraries.push(library);
  if (textures) library.setGroundStoneSurface(textures);
  const material = library.ground();
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<THREE.Material["onBeforeCompile"]>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const texture = shader.uniforms.uCobble!.value as THREE.DataTexture;
  const metres = 1 / (shader.uniforms.uCobbleTiling!.value as number);
  return { library, material, shader, texture, metres };
}
afterEach(() => {
  for (const library of libraries.splice(0)) library.dispose();
});

describe("gathered cobble ground", () => {
  it("selects only stone paving and preserves other surfaces through the production blends", () => {
    const { shader } = ground();
    const expression = (pattern: RegExp): string => {
      const value = shader.fragmentShader.match(pattern)?.[1];
      expect(value).toBeDefined();
      return value!;
    };
    // Execute the injected scalar expressions, so this check does not maintain a CPU copy of
    // the shader's selection logic. The normal expression is evaluated once per component.
    const stone = new Function("vPaved", "max", `return ${expression(/float wStone = ([^;]+);/)};`);
    const coverage = new Function("paved", "wStone", `return ${expression(/float cobbled = ([^;]+);/)};`);
    const shade = new Function("shade", "cobbleShade", "cobbled", "mix",
      `return ${expression(/shade = (mix\( shade, cobbleShade, cobbled \));/)};`);
    const terrainRelief = new Function("gGroundBump", "cobbled",
      `return gGroundBump * (${expression(/gGroundBump \*= ([^;]+);/)});`);
    const roughness = new Function("roughnessFactor", "gCobbleRoughness", "gCobbleCoverage", "mix",
      `return ${expression(/roughnessFactor = (mix\( roughnessFactor, gCobbleRoughness, gCobbleCoverage \));/)};`);
    const macro = new Function("gMacroShade", "macroShade", "cobbled", "mix",
      `return ${expression(/gMacroShade = (mix\( gMacroShade, macroShade, cobbled \));/)};`);
    for (const [paving, surface, expected] of [
      [0, 0, 0], [0, 0.5, 0], [0, 1, 0],
      [1, 0.5, 0], [1, 1, 0], [0.4, 0.8, 0],
      [1, 0, 1], [0.4, 0, 0.4], [1, 0.25, 0.5],
    ]) {
      const weight = coverage(paving, stone(surface, Math.max));
      expect(weight).toBeCloseTo(expected!);
      expect(shade(0.74, 1.04, weight, THREE.MathUtils.lerp)).toBeCloseTo(0.74 + 0.30 * expected!);
      expect(terrainRelief(-0.2, weight)).toBeCloseTo(-0.2 * (1 - expected!));
      expect(roughness(0.97, 0.65, weight, THREE.MathUtils.lerp)).toBeCloseTo(0.97 - 0.32 * expected!);
      expect(macro(0.71, 0.93, weight, THREE.MathUtils.lerp)).toBeCloseTo(0.71 + 0.22 * expected!);
    }
  });

  it("draws individual stones at a readable metre scale with a narrow joint bed", () => {
    const { texture, metres } = ground();
    const { width, height } = texture.image;
    const pixels = texture.image.data as Uint8Array;
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const stoneAreas: number[] = [];
    const face = (index: number): boolean => pixels[index * 4 + 3]! > 200;
    let joints = 0, faces = 0, faceValue = 0, jointValue = 0;
    for (let index = 0; index < width * height; index++) {
      if (face(index)) { faces++; faceValue += pixels[index * 4]! / 255 * 1.5; }
      if (pixels[index * 4 + 3]! < 20) { joints++; jointValue += pixels[index * 4]! / 255 * 1.5; }
      if (visited[index] || !face(index)) continue;
      let read = 0, write = 1;
      queue[0] = index;
      visited[index] = 1;
      while (read < write) {
        const current = queue[read++]!;
        const x = current % width, z = Math.floor(current / width);
        for (const neighbour of [
          z * width + (x + 1) % width, z * width + (x + width - 1) % width,
          ((z + 1) % height) * width + x, ((z + height - 1) % height) * width + x,
        ]) {
          if (visited[neighbour] || !face(neighbour)) continue;
          visited[neighbour] = 1;
          queue[write++] = neighbour;
        }
      }
      stoneAreas.push(write / (width * height) * metres ** 2);
    }
    expect(stoneAreas.length).toBeGreaterThanOrEqual(45);
    expect(stoneAreas.length).toBeLessThanOrEqual(90);
    // Face areas reject gravel-sized specks and metre-wide slabs, independent of texture size.
    expect(Math.min(...stoneAreas)).toBeGreaterThan(0.04);
    expect(Math.max(...stoneAreas)).toBeLessThan(0.65);
    expect(Math.max(...stoneAreas) / Math.min(...stoneAreas)).toBeGreaterThan(1.8);
    expect(faces / (width * height)).toBeGreaterThan(0.6);
    expect(joints / (width * height)).toBeGreaterThan(0.025);
    expect(joints / (width * height)).toBeLessThan(0.12);
    expect(faceValue / faces - jointValue / joints).toBeGreaterThan(0.15);
    expect(faceValue / faces - jointValue / joints).toBeLessThan(0.35);
    expect(faceValue / faces).toBeGreaterThan(0.9);
    expect(faceValue / faces).toBeLessThan(1.18);
  });

  it("keeps the wrap seam within the ordinary texture variation and filters distant joints", () => {
    const { texture } = ground();
    const { width, height } = texture.image;
    const pixels = texture.image.data as Uint8Array;
    let seam = 0, interior = 0, seamSamples = 0, interiorSamples = 0;
    let normalX = 0, normalZ = 0, reliefPixels = 0;
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const offset = (z * width + x) * 4;
        const nx = pixels[offset + 1]! / 255 * 2 - 1;
        const nz = pixels[offset + 2]! / 255 * 2 - 1;
        normalX += nx; normalZ += nz;
        if (Math.hypot(nx, nz) > 0.1) reliefPixels++;
        for (const [nextX, nextZ, wrap, adjacent] of [
          [(x + 1) % width, z, x === width - 1, x === 0 || x === width - 2],
          [x, (z + 1) % height, z === height - 1, z === 0 || z === height - 2],
        ] as const) {
          const next = (nextZ * width + nextX) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const difference = Math.abs(pixels[offset + channel]! - pixels[next + channel]!);
            if (wrap) { seam += difference; seamSamples++; }
            else if (adjacent) { interior += difference; interiorSamples++; }
          }
        }
      }
    }
    // The tile edge runs through a stone course, so compare it with its immediate neighbours,
    // not with the quieter centres of every stone elsewhere in the texture.
    expect(seam / seamSamples).toBeLessThan(interior / interiorSamples * 1.4);
    expect(Math.abs(normalX / (width * height))).toBeLessThan(0.01);
    expect(Math.abs(normalZ / (width * height))).toBeLessThan(0.01);
    expect(reliefPixels / (width * height)).toBeGreaterThan(0.15);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  });

  it("reuses the material and releases its deterministic cobble texture", () => {
    const first = ground();
    const disposed = vi.fn();
    first.texture.addEventListener("dispose", disposed);
    expect(first.library.ground()).toBe(first.material);
    const original = (first.texture.image.data as Uint8Array).slice();
    first.library.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    const second = ground();
    expect(second.texture).not.toBe(first.texture);
    expect(second.texture.image.data).toEqual(original);
  });

  it("borrows the shared stone PBR maps before or after material creation without recoloring their source", () => {
    const stone = {
      albedo: new THREE.Texture(), normal: new THREE.Texture(), roughness: new THREE.Texture(),
      meanLinearRgb: [0.26, 0.22, 0.16] as const, tileMetres: 2.4,
    };
    stone.albedo.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [stone.albedo, stone.normal, stone.roughness]) texture.repeat.setScalar(1 / stone.tileMetres);
    const textures: CorealmSurfaceTextures = { stone, bark: stone, leaf: stone };
    const before = ground(textures);
    const after = ground();
    expect(after.shader.uniforms.uGroundStoneReady!.value).toBe(0);
    after.library.setGroundStoneSurface(textures);
    for (const fixture of [before, after]) {
      expect(fixture.library.ground()).toBe(fixture.material);
      expect(fixture.shader.uniforms.uGroundStoneReady!.value).toBe(1);
      expect(fixture.shader.uniforms.uGroundStoneAlbedo!.value).toBe(stone.albedo);
      expect(fixture.shader.uniforms.uGroundStoneNormal!.value).toBe(stone.normal);
      expect(fixture.shader.uniforms.uGroundStoneRoughness!.value).toBe(stone.roughness);
      expect(fixture.shader.uniforms.uGroundStoneMean!.value.toArray()).toEqual(stone.meanLinearRgb);
      expect(fixture.shader.uniforms.uGroundStoneTiling!.value).toBe(1 / stone.tileMetres);
      expect(fixture.material.map).toBeNull();
      expect(fixture.material.normalMap).toBeNull();
      expect(fixture.material.roughnessMap).toBeNull();
    }
    for (const texture of [stone.albedo, stone.normal, stone.roughness]) {
      const disposed = vi.fn();
      texture.addEventListener("dispose", disposed);
      before.library.dispose(); after.library.dispose();
      expect(disposed).not.toHaveBeenCalled();
      expect(texture.repeat.toArray()).toEqual([1 / stone.tileMetres, 1 / stone.tileMetres]);
      texture.dispose();
    }
    expect(stone.albedo.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
