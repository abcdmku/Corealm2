import { BoxGeometry, Color, Float32BufferAttribute, Matrix4, PerspectiveCamera, Scene, Texture, Vector3, type BufferAttribute, type InterleavedBufferAttribute } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, WebGPURenderer, WGSLNodeBuilder } from 'three/webgpu';
// @ts-expect-error Three r185 does not declare its private RenderObject helper; the exercised methods are typed below.
import RenderObject from 'three/src/renderers/common/RenderObject.js';
import { positionLocal } from 'three/tsl';
import { expect as assert, it, vi } from 'vitest';
import { objectInstanceWorldOrigin, SCENERY_MATRIX_ATTRIBUTES } from '../game/src/render/objectTransformNodes.js';
import { isSceneryInstances, SceneryInstances } from '../game/src/render/sceneryInstances.js';

const expect = (value: unknown) => assert(value);
function lower(object: SceneryInstances) {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas });
  Object.assign(renderer.backend, { device: { features: new Set<string>(), limits: { maxUniformBufferBindingSize: 65536 } } });
  renderer.hasFeature = () => false;
  const builder = new WGSLNodeBuilder(object, renderer) as WGSLNodeBuilder & {
    scene: Scene; camera: PerspectiveCamera; build(): void; vertexShader: string; fragmentShader: string;
    attributes: { name: string; node?: { attribute?: BufferAttribute } }[];
  };
  builder.scene = new Scene(); builder.camera = new PerspectiveCamera(); builder.build();
  return { builder, renderer };
}

// Exercise the native cache and named-attribute resolution without a GPU device.
const renderObjectMethods = RenderObject.prototype as unknown as {
  getCacheKey(): number; getGeometryCacheKey(): string; getMaterialCacheKey(): number;
  getDynamicCacheKey(): number; getAttributes(): (BufferAttribute | InterleavedBufferAttribute)[];
};
function renderObject(object: SceneryInstances, lowered: ReturnType<typeof lower>) {
  return Object.assign(Object.create(renderObjectMethods) as typeof renderObjectMethods, {
    object, geometry: object.geometry, material: object.material, renderer: lowered.renderer,
    camera: lowered.builder.camera, scene: lowered.builder.scene, lightsNode: null,
    context: { id: 1 }, clippingContextCacheKey: '', attributes: null,
    _nodes: { getCacheKey: () => 0 },
    getNodeBuilderState: () => ({ nodeAttributes: lowered.builder.attributes }),
  });
}

it('shares native shader cache keys across capacities and resolves each cluster buffer at draw time', () => {
  const geometry = new BoxGeometry(), source = new MeshBasicNodeMaterial();
  const first = new SceneryInstances(geometry, source, 2, { colors: true });
  const second = new SceneryInstances(geometry, source, 5, { colors: true });
  const firstLowered = lower(first), secondLowered = lower(second);
  const firstDraw = renderObject(first, firstLowered), secondDraw = renderObject(second, firstLowered);
  expect(first.material).toBe(second.material);
  expect(firstDraw.getCacheKey()).toBe(secondDraw.getCacheKey());
  expect(firstLowered.builder.vertexShader).toBe(secondLowered.builder.vertexShader);
  expect(firstLowered.builder.fragmentShader).toBe(secondLowered.builder.fragmentShader);
  expect(firstLowered.builder.attributes.filter(value => value.name.startsWith('scenery'))).toHaveLength(5);
  expect(firstDraw.getAttributes()).toContain(first.geometry.getAttribute('sceneryMatrix0'));
  expect(secondDraw.getAttributes()).toContain(second.geometry.getAttribute('sceneryMatrix0'));
  expect(secondDraw.getAttributes()).not.toContain(first.geometry.getAttribute('sceneryMatrix0'));
  expect(secondDraw.getAttributes()).toContain(second.instanceColors);
  expect(first.instanceTransforms).not.toBe(second.instanceTransforms);
  expect(first.instanceColors).not.toBe(second.instanceColors);
  expect(first).not.toHaveProperty('isInstancedMesh');
  // r185 Mesh owns a default count=1. Scenery must never replace it with capacity.
  expect(first.count).toBe(1); expect(second.count).toBe(1);
  expect(first).not.toHaveProperty('instanceColor');
  first.dispose(); second.dispose(); source.dispose(); geometry.dispose();
});

it('keeps transforms, instance colors, draw counts and update ranges independent', () => {
  const geometry = new BoxGeometry(), source = new MeshBasicNodeMaterial();
  const mesh = new SceneryInstances(geometry, source, 3, { colors: true });
  expect(isSceneryInstances(mesh)).toBe(true);
  const matrix = new Matrix4().makeTranslation(4, 2, -7), actual = new Matrix4();
  mesh.getMatrixAt(0, actual); expect(actual.equals(new Matrix4())).toBe(true);
  mesh.setMatrixAt(1, matrix); mesh.getMatrixAt(1, actual); expect(actual.equals(matrix)).toBe(true);
  mesh.setColorAt(1, new Color(0.2, 0.4, 0.6)); const color = new Color(); mesh.getColorAt(1, color);
  expect(color.r).toBeCloseTo(0.2); expect(color.g).toBeCloseTo(0.4); expect(color.b).toBeCloseTo(0.6);
  mesh.instanceCount = 2; expect(mesh.geometry.instanceCount).toBe(2);
  expect(() => { mesh.instanceCount = 4; }).toThrow(RangeError);
  mesh.instanceTransforms.addUpdateRange(16, 16); mesh.instanceTransforms.needsUpdate = true;
  expect(mesh.instanceTransforms.version).toBe(1);
  expect(mesh.instanceTransforms.updateRanges).toEqual([{ start: 16, count: 16 }]);
  for (const name of SCENERY_MATRIX_ATTRIBUTES) expect((mesh.geometry.getAttribute(name) as InterleavedBufferAttribute).data).toBe(mesh.instanceTransforms);
  mesh.dispose(); source.dispose(); geometry.dispose();
});

it('aggregates only active transforms without mutating source bounds or compounding cluster bounds', () => {
  const source = new BoxGeometry(2, 2, 2), material = new MeshBasicNodeMaterial();
  const mesh = new SceneryInstances(source, material, 3);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(-4, 0, 0));
  mesh.setMatrixAt(1, new Matrix4().makeScale(2, 3, 4).setPosition(5, 0, 0));
  mesh.setMatrixAt(2, new Matrix4().makeTranslation(1000, 0, 0)); mesh.instanceCount = 2;
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  expect(mesh.boundingBox!.min.toArray()).toEqual([-5, -3, -4]);
  expect(mesh.boundingBox!.max.toArray()).toEqual([7, 3, 4]);
  expect(mesh.boundingSphere!.containsPoint(new Vector3(-5, -1, -1))).toBe(true);
  expect(mesh.boundingSphere!.containsPoint(new Vector3(7, 3, 4))).toBe(true);
  const box = mesh.boundingBox!.clone(), sphere = mesh.boundingSphere!.clone();
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  expect(mesh.boundingBox!.equals(box)).toBe(true); expect(mesh.boundingSphere!.equals(sphere)).toBe(true);
  expect(source.boundingBox).toBeNull(); expect(source.boundingSphere).toBeNull();
  mesh.instanceCount = 0; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  expect(mesh.boundingBox!.isEmpty()).toBe(true); expect(mesh.boundingSphere!.isEmpty()).toBe(true);
  mesh.dispose(); material.dispose(); source.dispose();
});

it('retains texture alpha, source deformation, and transformed normal and tangent graphs', () => {
  const source = new BoxGeometry(), texture = new Texture();
  source.setAttribute('tangent', new Float32BufferAttribute(new Float32Array(source.getAttribute('position').count * 4).fill(1), 4));
  const material = new MeshStandardNodeMaterial({ map: texture, alphaTest: 0.45 });
  material.positionNode = positionLocal.add(objectInstanceWorldOrigin().mul(0.125));
  const mesh = new SceneryInstances(source, material, 3, { colors: true });
  const { builder } = lower(mesh);
  const wrapped = mesh.material as MeshStandardNodeMaterial;
  expect(wrapped.map).toBe(texture); expect(wrapped.alphaTest).toBe(0.45);
  expect(builder.vertexShader).toContain('sceneryMatrix0');
  expect(builder.vertexShader).toContain('normalLocal =');
  expect(builder.vertexShader).toContain('tangentLocal =');
  const transform = builder.vertexShader.indexOf('positionLocal = (');
  const deformation = builder.vertexShader.indexOf('0.125');
  expect(transform).toBeGreaterThan(-1); expect(deformation).toBeGreaterThan(transform);
  expect(builder.fragmentShader).toContain('textureSample');
  expect(builder.fragmentShader).toContain('discard');
  expect(builder.attributes.filter(value => value.name.startsWith('sceneryMatrix'))).toHaveLength(4);
  mesh.dispose(); material.dispose(); texture.dispose(); source.dispose();
});

it('disposes only its wrapper and releases cached materials after their last cluster', () => {
  const geometry = new BoxGeometry(), source = new MeshBasicNodeMaterial();
  const first = new SceneryInstances(geometry, source, 2), second = new SceneryInstances(geometry, source, 3);
  const withColor = new SceneryInstances(geometry, source, 2, { colors: true });
  const sourceDisposed = vi.fn(), geometryDisposed = vi.fn(), wrapperDisposed = vi.fn(), materialDisposed = vi.fn();
  geometry.addEventListener('dispose', geometryDisposed); source.addEventListener('dispose', sourceDisposed);
  first.geometry.addEventListener('dispose', wrapperDisposed); (first.material as MeshBasicNodeMaterial).addEventListener('dispose', materialDisposed);
  expect(first.material).toBe(second.material); expect(withColor.material).not.toBe(first.material);
  expect(first.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
  expect(first.geometry.index).toBe(geometry.index);
  expect(first.geometry.groups).toEqual(geometry.groups); expect(first.geometry.groups).not.toBe(geometry.groups);
  expect(first.geometry).toHaveProperty('sharedScenerySource', geometry);
  first.dispose(); first.dispose(); expect(wrapperDisposed).toHaveBeenCalledOnce(); expect(materialDisposed).not.toHaveBeenCalled();
  second.dispose(); expect(materialDisposed).toHaveBeenCalledOnce();
  withColor.dispose(); expect(sourceDisposed).not.toHaveBeenCalled(); expect(geometryDisposed).not.toHaveBeenCalled();
  const replacement = new SceneryInstances(geometry, source, 1);
  expect(replacement.material).not.toBe(first.material); expect(replacement.instanceColors).toBeNull();
  expect(() => replacement.setColorAt(0, new Color())).toThrow(/constructor option/);
  replacement.dispose(); source.dispose(); geometry.dispose();
});
