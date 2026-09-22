import * as THREE from 'three';
import { WebGPURenderer, WGSLNodeBuilder } from 'three/webgpu';
import { expect, it, vi } from 'vitest';
import { ElementalEnergyBodies } from '../game/src/render/elementalEnergyBodies.js';
import { ElementalParticleCloud } from '../game/src/render/elementalParticleCloud.js';
import { ElementalAtmosphere } from '../game/src/render/elementalAtmosphere.js';

type Pool = {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  begin(seconds: number): void;
  dispose(): void;
};
type ClockReference = {
  property?: string; object: unknown; updateType: string;
  node: { value: number };
  updateReference(state: { object: THREE.Object3D }): unknown;
  update(): void;
};
type NativeRenderObject = {
  getCacheKey(): number;
  getAttributes(): (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[];
};
const renderObjectModule = 'three/src/renderers/common/RenderObject.js';
const native = await import(renderObjectModule) as { default: { prototype: NativeRenderObject } };

function lower(mesh: Pool['mesh']) {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas });
  Object.assign(renderer.backend, { device: { features: new Set<string>(), limits: { maxUniformBufferBindingSize: 65536 } } });
  renderer.hasFeature = () => false;
  const builder = new WGSLNodeBuilder(mesh, renderer) as WGSLNodeBuilder & {
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; build(): void;
    vertexShader: string; fragmentShader: string;
    attributes: { name: string; node?: { attribute?: THREE.BufferAttribute } }[];
    updateNodes: ClockReference[];
  };
  builder.scene = new THREE.Scene(); builder.camera = new THREE.PerspectiveCamera(); builder.build();
  return { builder, renderer };
}

function renderObject(mesh: Pool['mesh'], built: ReturnType<typeof lower>): NativeRenderObject {
  return Object.assign(Object.create(native.default.prototype) as NativeRenderObject, {
    object: mesh, geometry: mesh.geometry, material: mesh.material, renderer: built.renderer,
    camera: built.builder.camera, scene: built.builder.scene, lightsNode: null,
    context: { id: 1 }, clippingContextCacheKey: '', attributes: null,
    _nodes: { getCacheKey: () => 0 },
    getNodeBuilderState: () => ({ nodeAttributes: built.builder.attributes }),
  });
}

function proveShared(first: Pool, second: Pool, hasClock = true): void {
  expect(first.mesh.material).toBe(second.mesh.material);
  expect(first.mesh.geometry).not.toBe(second.mesh.geometry);
  expect(first.mesh.userData.effectClock).not.toBe(second.mesh.userData.effectClock);
  first.begin(1.25); second.begin(8.75);
  expect(first.mesh.userData.effectClock.value).toBe(1.25);
  expect(second.mesh.userData.effectClock.value).toBe(8.75);
  const built = lower(first.mesh);
  expect(built.builder.vertexShader).toContain('@vertex');
  expect(built.builder.fragmentShader).toContain('@fragment');
  const firstDraw = renderObject(first.mesh, built), secondDraw = renderObject(second.mesh, built);
  expect(firstDraw.getCacheKey()).toBe(secondDraw.getCacheKey());
  for (const [name, attribute] of Object.entries(first.mesh.geometry.attributes)) {
    if (!(attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) continue;
    const other = second.mesh.geometry.getAttribute(name);
    expect(other).not.toBe(attribute);
    if (built.builder.attributes.some(input => input.name === name)) {
      expect(firstDraw.getAttributes()).toContain(attribute);
      expect(secondDraw.getAttributes()).toContain(other);
      expect(secondDraw.getAttributes()).not.toContain(attribute);
    }
  }
  const clocks = built.builder.updateNodes.filter(node => node.property === 'userData.effectClock.value');
  expect(clocks.length > 0).toBe(hasClock);
  for (const clock of clocks) {
    expect(clock.object).toBeNull(); expect(clock.updateType).toBe('object');
    for (const pool of [first, second, first]) {
      clock.updateReference({ object: pool.mesh }); clock.update();
      expect(clock.node.value).toBe(pool.mesh.userData.effectClock.value);
    }
  }
}

it.each(['light', 'smoke', 'fragment', 'droplet'] as const)('shares %s particle graphs across capacities with independent draw data', kind => {
  const parent = new THREE.Group(), first = new ElementalParticleCloud(parent, kind, 2), second = new ElementalParticleCloud(parent, kind, 5);
  try {
    proveShared(first, second, kind === 'fragment' || kind === 'smoke');
    first.put(1, 2, 3, .5, 0xff0000, .7, 3); first.end();
    second.put(8, 9, 10, .8, 0x0000ff, .4, 7); second.end();
    expect(first.mesh.geometry.getAttribute('tintAlpha').getX(0)).toBe(1);
    expect(first.mesh.geometry.getAttribute('tintAlpha').getZ(0)).toBe(0);
    expect(second.mesh.geometry.getAttribute('tintAlpha').getX(0)).toBe(0);
    expect(second.mesh.geometry.getAttribute('tintAlpha').getZ(0)).toBe(1);
    expect(first.mesh.geometry.getAttribute('centreSize').getX(0)).toBe(1);
    expect(second.mesh.geometry.getAttribute('centreSize').getX(0)).toBe(8);
  } finally { first.dispose(); second.dispose(); }
});

it('preserves linear particle energy across pools and avoids uploading empty pools', () => {
  const parent = new THREE.Group(), first = new ElementalParticleCloud(parent, 'light', 3), second = new ElementalParticleCloud(parent, 'light', 3);
  try {
    first.begin(1, 1.25); second.begin(2, .5);
    first.put(1, 2, 3, .03, 0xc73a09, .7, 31, 1.3, 1.7);
    second.put(4, 5, 6, .06, 0xc73a09, .4, 51, 1.9, 2);
    first.end(); second.end();
    for (const [pool, gain] of [[first, 1.25 * 1.7], [second, 1]] as const) {
      const tint = pool.mesh.geometry.getAttribute('tintAlpha');
      const expected = new THREE.Color(0xc73a09).multiplyScalar(gain);
      expect(tint.getX(0)).toBeCloseTo(expected.r, 6);
      expect(tint.getY(0)).toBeCloseTo(expected.g, 6);
      expect(tint.getZ(0)).toBeCloseTo(expected.b, 6);
      const attributes = Object.values(pool.mesh.geometry.attributes).filter(a => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) as THREE.BufferAttribute[];
      expect(attributes.reduce((n, a) => n + a.updateRanges.reduce((m, r) => m + r.count, 0) * 4, 0)).toBe(40);
      const versions = attributes.map(a => a.version);
      pool.begin(3); pool.end();
      expect(pool.mesh.visible).toBe(false); expect(pool.instances).toBe(0);
      expect(attributes.map(a => a.version)).toEqual(versions);
    }
  } finally { first.dispose(); second.dispose(); }
});

it.each((['earth', 'wind', 'water', 'fire'] as const).flatMap(element =>
  [false, true].map(magical => ({ element, magical }))))('shares $element energy graphs (magical=$magical) without sharing curve or tint buffers', ({ element, magical }) => {
  const parent = new THREE.Group(), first = new ElementalEnergyBodies(parent, element, magical), second = new ElementalEnergyBodies(parent, element, magical);
  try {
    proveShared(first, second);
    first.curve([0, 0, 0], [1, 1, 0], [2, 1, 0], [3, 0, 0], .2, 0xff0000, .7, 2); first.end();
    second.curve([8, 0, 0], [9, 1, 0], [10, 1, 0], [11, 0, 0], .4, 0x0000ff, .4, 9); second.end();
    expect(first.mesh.geometry.getAttribute('curveA').getX(0)).toBe(0);
    expect(second.mesh.geometry.getAttribute('curveA').getX(0)).toBe(8);
    expect(first.mesh.geometry.getAttribute('bodyTint').getX(0)).toBe(1);
    expect(second.mesh.geometry.getAttribute('bodyTint').getZ(0)).toBe(1);
  } finally { first.dispose(); second.dispose(); }
});

it.each(['fire', 'wind', 'dust', 'smoke'] as const)('shares %s atmosphere graphs with per-object clocks and volumes', kind => {
  const parent = new THREE.Group(), first = new ElementalAtmosphere(parent, kind), second = new ElementalAtmosphere(parent, kind);
  try {
    proveShared(first, second);
    first.put(1, 2, 3, 2, 3, 4, .7, 3); first.end();
    second.put(8, 9, 10, 4, 5, 6, .4, 7); second.end();
    expect(first.mesh.geometry.getAttribute('volumeCentre').getX(0)).toBe(1);
    expect(second.mesh.geometry.getAttribute('volumeCentre').getX(0)).toBe(8);
    expect(first.mesh.geometry.getAttribute('volumeShape').getX(0)).toBe(2);
    expect(second.mesh.geometry.getAttribute('volumeShape').getX(0)).toBe(4);
  } finally { first.dispose(); second.dispose(); }
});

it.each([
  { name: 'particle', create: (parent: THREE.Group) => new ElementalParticleCloud(parent, 'smoke', 2) },
  { name: 'energy', create: (parent: THREE.Group) => new ElementalEnergyBodies(parent, 'fire', true) },
  { name: 'atmosphere', create: (parent: THREE.Group) => new ElementalAtmosphere(parent, 'fire') },
])('keeps the shared $name material alive until the last pool is disposed', ({ create }) => {
  const parent = new THREE.Group(), first = create(parent), second = create(parent);
  const material = first.mesh.material, disposed = vi.fn();
  material.addEventListener('dispose', disposed);
  first.dispose();
  try {
    expect(disposed).not.toHaveBeenCalled();
    second.begin(9);
    expect(lower(second.mesh).builder.fragmentShader).toContain('@fragment');
  } finally { second.dispose(); }
  expect(disposed).toHaveBeenCalledOnce();
  const replacement = create(parent);
  try { expect(replacement.mesh.material).not.toBe(material); }
  finally { replacement.dispose(); }
});

it('keeps visually different recipes separate', () => {
  const parent = new THREE.Group();
  const pools = [new ElementalParticleCloud(parent, 'light', 1), new ElementalParticleCloud(parent, 'smoke', 1),
    new ElementalEnergyBodies(parent, 'fire', true), new ElementalEnergyBodies(parent, 'fire', false),
    new ElementalEnergyBodies(parent, 'water', true), new ElementalAtmosphere(parent, 'fire'), new ElementalAtmosphere(parent, 'smoke')];
  try { expect(new Set(pools.map(pool => pool.mesh.material)).size).toBe(pools.length); }
  finally { for (const pool of pools) pool.dispose(); }
});
