import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MaterialLibrary, REGION_PALETTES } from '../game/src/render/materials.js';

const libraries: MaterialLibrary[] = [];
function shaderFixture() {
  const library = new MaterialLibrary();
  libraries.push(library);
  const material = library.ground();
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {},
  } as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return { library, material, shader };
}
afterEach(() => libraries.splice(0).forEach(library => library.dispose()));

describe('terrain cliff stone projection', () => {
  it('keeps both texture dimensions on every vertical face at the authored metre scale', () => {
    const { shader } = shaderFixture();
    // Read the production shader's actual coordinate selections, rather than copy its UV rule.
    const samples = [...shader.fragmentShader.matchAll(/texture2D\( source, point\.([xyz]{2}) \) \* weights\.([xyz])/g)];
    expect(samples).toHaveLength(3);
    const projections = new Map(samples.map(match => [match[2], match[1]!]));
    const point = { x: 3, y: 5, z: 7 };
    const tileMetres = 2.4;
    for (const normalAxis of ['x', 'y', 'z'] as const) {
      const uv = projections.get(normalAxis)!;
      expect(uv.includes(normalAxis), `${normalAxis}-normal projection must not collapse`).toBe(false);
      const tangentAxes = (['x', 'y', 'z'] as const).filter(axis => axis !== normalAxis);
      const sample = (value: typeof point) => [...uv].map(axis => value[axis as keyof typeof point] / tileMetres);
      const origin = sample(point);
      const a = sample({ ...point, [tangentAxes[0]!]: point[tangentAxes[0]!] + tileMetres });
      const b = sample({ ...point, [tangentAxes[1]!]: point[tangentAxes[1]!] + tileMetres });
      const area = Math.abs((a[0]! - origin[0]!) * (b[1]! - origin[1]!)
        - (a[1]! - origin[1]!) * (b[0]! - origin[0]!));
      expect(area, `${normalAxis} wall keeps one square tile`).toBeCloseTo(1, 10);
    }
  });

  it('leaves flat ground and paving unchanged while smoothly selecting bare steep slopes', () => {
    const { shader } = shaderFixture();
    const expression = shader.fragmentShader.match(/gCliffCoverage = ([^;]+);/)?.[1];
    expect(expression).toBeDefined();
    const coverage = new Function('paved', 'cliffSlope', 'smoothstep', `return ${expression};`);
    const smoothstep = (low: number, high: number, value: number) => {
      const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
      return t * t * (3 - 2 * t);
    };
    expect(coverage(0, 0, smoothstep)).toBe(0);
    expect(coverage(0, 1 - Math.cos(20 * Math.PI / 180), smoothstep)).toBe(0);
    expect(coverage(0, 1, smoothstep)).toBe(1);
    expect(coverage(1, 1, smoothstep)).toBe(0);
    expect(coverage(0.5, 1, smoothstep)).toBe(0.5);
    let previous = 0;
    for (let slope = 0; slope <= 1; slope += 0.01) {
      const current = coverage(0, slope, smoothstep) as number;
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current - previous).toBeLessThan(0.03);
      previous = current;
    }
  });

  it('feeds stone PBR relief into the real lighting path with stable normals at projection seams', () => {
    const { shader } = shaderFixture();
    expect(shader.vertexShader).toContain('vGroundWorldNormal = normalize( mat3( modelMatrix ) * normal )');
    expect(shader.fragmentShader).toContain('return bump - worldNormal * dot( bump, worldNormal )');
    expect(shader.fragmentShader).toContain('mat3( viewMatrix ) * gCliffBump * 0.72 * gCliffCoverage');
    expect(shader.fragmentShader).toContain('mix( roughnessFactor, gCliffRoughness, gCliffCoverage )');
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
    expect(shader.fragmentShader).toContain('#include <fog_fragment>');
    const power = Number(shader.fragmentShader.match(/pow\( abs\( worldNormal \), vec3\( ([\d.]+) \) \)/)?.[1]);
    expect(power).toBeGreaterThan(0);
    for (const vector of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1], [1, 1, 0], [1, 1, 1]]) {
      const values = vector.map(value => Math.abs(value) ** power);
      const total = values.reduce((sum, value) => sum + value, 0);
      const weights = values.map(value => value / Math.max(total, 0.0001));
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      expect(weights.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
  });

  it('reuses the loaded quarry maps without extra textures or changes to their tiling', () => {
    const { library, material, shader } = shaderFixture();
    const stone = { albedo: new THREE.Texture(), normal: new THREE.Texture(), roughness: new THREE.Texture(),
      tileMetres: 2.4, meanLinearRgb: [0.26, 0.22, 0.16] as const };
    library.setGroundStoneSurface({ stone, bark: stone, leaf: stone });
    expect(shader.uniforms.uGroundStoneReady!.value).toBe(1);
    expect(shader.uniforms.uGroundStoneAlbedo!.value).toBe(stone.albedo);
    expect(shader.uniforms.uGroundStoneNormal!.value).toBe(stone.normal);
    expect(shader.uniforms.uGroundStoneRoughness!.value).toBe(stone.roughness);
    expect(shader.uniforms.uGroundStoneTiling!.value).toBeCloseTo(1 / stone.tileMetres);
    expect(library.ground()).toBe(material);
    for (const texture of [stone.albedo, stone.normal, stone.roughness]) {
      expect(texture.repeat.toArray()).toEqual([1, 1]);
      texture.dispose();
    }
  });

  it('gives the fairy floors teal swatches and low-saturation rock with a cooler T60 variation', () => {
    const rgb = (value: number) => [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    for (const id of ['gloamgarden', 'faeholme'] as const) {
      const ground = rgb(REGION_PALETTES[id].groundLow);
      expect(ground[1]!).toBeGreaterThan(ground[0]! * 1.4);
      expect(ground[2]!).toBeGreaterThan(ground[0]! * 1.4);
      const stone = rgb(REGION_PALETTES[id].rock);
      expect(Math.max(...stone) - Math.min(...stone)).toBeLessThan(16);
    }
    const early = rgb(REGION_PALETTES.gloamgarden.groundLow), deep = rgb(REGION_PALETTES.faeholme.groundLow);
    expect(deep[2]! - deep[1]!).toBeGreaterThan(early[2]! - early[1]!);
  });
});
