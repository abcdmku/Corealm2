import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MaterialLibrary, REGION_PALETTES } from '../game/src/render/materials.js';
import { float, vec3 } from 'three/tsl';
import { GROUND_CLIFF_PROJECTIONS, groundCliffCoverage, groundCliffProjectionWeights, type GroundSurfaceInputs } from '../game/src/render/groundSurfaceNodes.js';

const libraries: MaterialLibrary[] = [];
function shaderFixture() {
  const library = new MaterialLibrary();
  libraries.push(library);
  const material = library.ground();
  const uniforms = material.userData.groundSurface.inputs as GroundSurfaceInputs;
  return { library, material, uniforms };
}

type Value = number | number[];
function calculate(node: any): Value {
  if (node.isConstNode) return typeof node.value === 'number' ? node.value : node.value.toArray();
  if (node.isVarNode || node.isConvertNode) return calculate(node.node);
  if (node.isJoinNode) return node.nodes.flatMap(calculate);
  if (node.isSplitNode) {
    const value = calculate(node.node);
    return typeof value === 'number' ? value : value['xyzw'.indexOf(node.components)]!;
  }
  const a = calculate(node.aNode);
  const b = node.bNode ? calculate(node.bNode) : 0;
  const c = node.cNode ? calculate(node.cNode) : 0;
  const operation = (x: number, y: number, z: number): number => {
    if (node.op === '+') return x + y;
    if (node.op === '-') return x - y;
    if (node.op === '*') return x * y;
    if (node.op === '/') return x / y;
    if (node.method === 'abs') return Math.abs(x);
    if (node.method === 'pow') return Math.pow(x, y);
    if (node.method === 'max') return Math.max(x, y);
    if (node.method === 'smoothstep') {
      const t = Math.max(0, Math.min(1, (z - x) / (y - x)));
      return t * t * (3 - 2 * t);
    }
    throw new Error(`Unexpected terrain node ${node.type}`);
  };
  const values = [a, b, c];
  const vector = values.find(Array.isArray);
  if (!vector) return operation(a as number, b as number, c as number);
  return vector.map((_, i) => operation(...values.map(v => Array.isArray(v) ? v[i]! : v) as [number, number, number]));
}
afterEach(() => libraries.splice(0).forEach(library => library.dispose()));

describe('terrain cliff stone projection', () => {
  it('keeps both texture dimensions on every vertical face at the authored metre scale', () => {
    const projections = GROUND_CLIFF_PROJECTIONS;
    const point = { x: 3, y: 5, z: 7 };
    const tileMetres = 2.4;
    for (const normalAxis of ['x', 'y', 'z'] as const) {
      const uv = projections[normalAxis];
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
    const coverage = (paved: number, slope: number) => calculate(groundCliffCoverage(float(paved), vec3(0, 1 - slope, 0))) as number;
    expect(coverage(0, 0)).toBe(0);
    expect(coverage(0, 1 - Math.cos(20 * Math.PI / 180))).toBe(0);
    expect(coverage(0, 1)).toBe(1);
    expect(coverage(1, 1)).toBe(0);
    expect(coverage(0.5, 1)).toBe(0.5);
    let previous = 0;
    for (let slope = 0; slope <= 1; slope += 0.01) {
      const current = coverage(0, slope);
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current - previous).toBeLessThan(0.03);
      previous = current;
    }
  });

  it('feeds stone PBR relief into the real lighting path with stable normals at projection seams', () => {
    const { material } = shaderFixture();
    expect(material.isMeshStandardNodeMaterial).toBe(true);
    expect(material.normalNode?.isNode).toBe(true);
    expect(material.roughnessNode?.isNode).toBe(true);
    expect(material.fog).toBe(true);
    for (const vector of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1], [1, 1, 0], [1, 1, 1]]) {
      const weights = calculate(groundCliffProjectionWeights(vec3(...vector as [number, number, number]))) as number[];
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      expect(weights.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
  });

  it('reuses the loaded quarry maps without extra textures or changes to their tiling', () => {
    const { library, material, uniforms } = shaderFixture();
    const stone = { albedo: new THREE.Texture(), normal: new THREE.Texture(), roughness: new THREE.Texture(),
      tileMetres: 2.4, meanLinearRgb: [0.26, 0.22, 0.16] as const };
    library.setGroundStoneSurface({ stone, bark: stone, leaf: stone });
    expect(uniforms.uGroundStoneReady.value).toBe(1);
    expect(uniforms.uGroundStoneAlbedo.value).toBe(stone.albedo);
    expect(uniforms.uGroundStoneNormal.value).toBe(stone.normal);
    expect(uniforms.uGroundStoneRoughness.value).toBe(stone.roughness);
    expect(uniforms.uGroundStoneTiling.value).toBeCloseTo(1 / stone.tileMetres);
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
