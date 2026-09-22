import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { installSharedGeometryBuffers } from '../game/src/render/sharedGeometryBuffers.js';

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Buffer = THREE.BufferAttribute | THREE.InterleavedBuffer;
type RenderObject = { geometry: THREE.BufferGeometry; material: { wireframe: boolean }; attributes: Attribute[]; getAttributes(): Attribute[]; onDispose: (...args: unknown[]) => unknown };
const canonical = (attribute: Attribute | Buffer): Buffer => (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
  ? (attribute as THREE.InterleavedBufferAttribute).data : attribute as Buffer;
interface NativeAttributes { update(attribute: Attribute, type: number): void; delete(attribute: Attribute): unknown; data: WeakMap<object, object> }
interface NativeGeometries {
  updateForRender(object: RenderObject): void;
  has(object: RenderObject): boolean;
  getIndex(object: RenderObject): THREE.BufferAttribute | null;
  initGeometry(object: RenderObject): void;
  updateAttributes(object: RenderObject): void;
  dispose(): void;
  _geometryDisposeListeners: Map<THREE.BufferGeometry, () => void>;
  wireframes: WeakMap<THREE.BufferGeometry, THREE.BufferAttribute>;
  attributeCall: WeakMap<object, number>;
}
// Run the real r185 lifecycle implementation; only the physical GPU allocation is faked.
const attributesModule = 'three/src/renderers/common/Attributes.js';
const geometriesModule = 'three/src/renderers/common/Geometries.js';
const Attributes = (await import(attributesModule) as { default: new (backend: object, info: object) => NativeAttributes }).default;
const Geometries = (await import(geometriesModule) as { default: new (attributes: NativeAttributes, info: object) => NativeGeometries }).default;

function fixture() {
  type Allocation = { destroyed: boolean; destroy: Mock<() => void> };
  const allocations: Allocation[] = [], metadata = new WeakMap<object, { buffer?: Allocation }>();
  const tracked = new Set<Attribute>();
  const info = {
    memory: { geometries: 0 }, render: { calls: 0 },
    createAttribute: (attribute: Attribute) => tracked.add(attribute),
    createIndexAttribute: (attribute: Attribute) => tracked.add(attribute),
    createStorageAttribute: (attribute: Attribute) => tracked.add(attribute),
    createIndirectStorageAttribute: (attribute: Attribute) => tracked.add(attribute),
    destroyAttribute: (attribute: Attribute) => tracked.delete(attribute),
  };
  const get = (key: object) => {
    let value = metadata.get(key);
    if (!value) { value = {}; metadata.set(key, value); }
    return value;
  };
  const create = (attribute: Attribute | Buffer) => {
    const data = get(canonical(attribute));
    if (!data.buffer) {
      const allocation: Allocation = { destroyed: false, destroy: vi.fn(() => { allocation.destroyed = true; }) };
      data.buffer = allocation; allocations.push(allocation);
    }
  };
  const backend = {
    isWebGPUBackend: true, has: (key: object) => metadata.has(key), get, delete: (key: object) => metadata.delete(key),
    createAttribute: create, createIndexAttribute: create, createStorageAttribute: create, createIndirectStorageAttribute: create,
    updateAttribute: vi.fn(),
    destroyAttribute: (attribute: Attribute | Buffer) => {
      get(canonical(attribute)).buffer!.destroy();
      // Match the native view-key deletion bug. The adapter must delete canonical data.
      metadata.delete(attribute);
    },
  };
  const attributes = new Attributes(backend, info), geometries = new Geometries(attributes, info);
  const originalDispose = vi.fn(() => { geometries.dispose(); });
  const renderer = { backend, _attributes: attributes, _geometries: geometries, dispose: originalDispose };
  const restore = installSharedGeometryBuffers(renderer as unknown as WebGPURenderer);
  const render = (object: RenderObject) => { info.render.calls++; geometries.updateForRender(object); };
  return { renderer, backend, attributes, geometries, info, tracked, allocations, originalDispose, restore, render };
}
function object(geometry: THREE.BufferGeometry, attributes = Object.values(geometry.attributes)): RenderObject {
  return { geometry, material: { wireframe: false }, attributes, getAttributes() { return this.attributes; }, onDispose: vi.fn() };
}
function source() {
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)).setIndex([0, 1, 2]);
}
function wrapper(source: THREE.BufferGeometry) {
  const result = new THREE.InstancedBufferGeometry();
  for (const name in source.attributes) result.setAttribute(name, source.attributes[name]!);
  result.setIndex(source.index);
  result.setAttribute('instanceRow0', new THREE.InstancedBufferAttribute(new Float32Array([1, 0, 0, 0]), 4));
  return result;
}

describe('native shared geometry buffer ownership', () => {
  it('frees retired wrapper transforms while retaining shared attributes and indexes until their final owner', () => {
    const f = fixture(), mesh = source(), a = wrapper(mesh), b = wrapper(mesh);
    f.render(object(a)); f.render(object(b));
    const position = mesh.getAttribute('position'), index = mesh.index!;
    const shared = f.backend.get(position).buffer!, sharedIndex = f.backend.get(index).buffer!;
    const aTransform = f.backend.get(a.getAttribute('instanceRow0')).buffer!;
    const bTransform = f.backend.get(b.getAttribute('instanceRow0')).buffer!;
    expect(f.allocations).toHaveLength(4);
    a.dispose();
    expect(aTransform.destroy).toHaveBeenCalledOnce();
    expect(shared.destroy).not.toHaveBeenCalled(); expect(sharedIndex.destroy).not.toHaveBeenCalled();
    expect(bTransform.destroy).not.toHaveBeenCalled(); expect(f.info.memory.geometries).toBe(1);
    b.dispose();
    for (const allocation of f.allocations) expect(allocation.destroy).toHaveBeenCalledOnce();
    expect(f.tracked.size).toBe(0); expect(f.geometries._geometryDisposeListeners.size).toBe(0);
    expect(mesh.getAttribute('position')).toBe(position); expect(mesh.index).toBe(index);
    f.renderer.dispose();
  });

  it('can upload an uninitialized source later and reinitialize the same disposed geometry in the same render call', () => {
    const f = fixture(), mesh = source(), a = wrapper(mesh), draw = object(a);
    f.render(draw); const first = f.backend.get(mesh.getAttribute('position')).buffer!;
    a.dispose(); expect(f.geometries.has(draw)).toBe(false);
    // Same native call ID deliberately verifies attributeCall does not suppress re-upload.
    f.geometries.updateForRender(draw);
    const second = f.backend.get(mesh.getAttribute('position')).buffer!;
    expect(second).not.toBe(first); expect(second.destroyed).toBe(false);
    a.dispose(); f.render(object(mesh));
    expect(f.backend.get(mesh.getAttribute('position')).buffer).not.toBe(second);
    mesh.dispose(); f.renderer.dispose();
    for (const allocation of f.allocations) expect(allocation.destroy).toHaveBeenCalledOnce();
  });

  it('counts a rendered source as an owner regardless of source/wrapper disposal order', () => {
    const f = fixture(), mesh = source(), a = wrapper(mesh), b = wrapper(mesh);
    f.render(object(a)); f.render(object(mesh)); f.render(object(b));
    const shared = f.backend.get(mesh.getAttribute('position')).buffer!;
    mesh.dispose(); a.dispose(); expect(shared.destroyed).toBe(false);
    b.dispose(); expect(shared.destroy).toHaveBeenCalledOnce();
    // Disposing before native initialization does not retire the CPU asset.
    const c = wrapper(mesh); c.dispose(); f.render(object(c));
    expect(f.backend.get(mesh.getAttribute('position')).buffer!.destroyed).toBe(false);
    c.dispose(); f.renderer.dispose();
  });

  it('deduplicates interleaved data and clears every view cache before a later source upload', () => {
    const f = fixture(), data = new THREE.InterleavedBuffer(new Float32Array(18), 6);
    const a = new THREE.BufferGeometry().setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0))
      .setAttribute('normal', new THREE.InterleavedBufferAttribute(data, 3, 3));
    const b = new THREE.BufferGeometry().setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0))
      .setAttribute('normal', new THREE.InterleavedBufferAttribute(data, 3, 3));
    f.render(object(a)); f.render(object(b));
    const shared = f.backend.get(data).buffer!; expect(f.allocations).toHaveLength(1);
    a.dispose(); expect(shared.destroyed).toBe(false);
    b.dispose(); expect(shared.destroy).toHaveBeenCalledOnce(); expect(f.backend.has(data)).toBe(false);
    for (const attribute of [...Object.values(a.attributes), ...Object.values(b.attributes)]) {
      expect(f.attributes.data.has(attribute)).toBe(false); expect(f.geometries.attributeCall.has(attribute)).toBe(false);
    }
    expect(f.tracked.size).toBe(0);
    f.render(object(a)); expect(f.backend.get(data).buffer).not.toBe(shared);
    a.dispose(); f.renderer.dispose();
  });

  it('observes later shader attributes and real layout replacements without reallocating stable layouts', () => {
    const f = fixture(), mesh = source(), draw = object(mesh, [mesh.getAttribute('position')]);
    f.render(draw); const initial = f.allocations.length;
    for (let index = 0; index < 20; index++) f.render(draw);
    expect(f.allocations).toHaveLength(initial);
    const extra = new THREE.InstancedBufferAttribute(new Float32Array(4), 4);
    draw.attributes = [...draw.attributes, extra]; f.render(draw);
    const extraBuffer = f.backend.get(extra).buffer!;
    const old = mesh.getAttribute('position'), oldBuffer = f.backend.get(old).buffer!;
    mesh.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    draw.attributes = [mesh.getAttribute('position'), extra]; f.render(draw);
    expect(oldBuffer.destroy).toHaveBeenCalledOnce(); expect(extraBuffer.destroyed).toBe(false);
    mesh.dispose(); expect(extraBuffer.destroy).toHaveBeenCalledOnce(); f.renderer.dispose();
    expect(f.tracked.size).toBe(0);
  });

  it('releases per-object shader buffers on layout replacement and native disposal while preserving shared geometry', () => {
    const f = fixture(), mesh = source(), a = object(mesh), b = object(mesh);
    const extra = new THREE.InstancedBufferAttribute(new Float32Array(16), 4);
    a.attributes = [...a.attributes, extra]; b.attributes = [...b.attributes, extra];
    const context = { owner: 'native caller' }, original = vi.fn(function (this: unknown, token: unknown) { expect(this).toBe(context); return token; });
    a.onDispose = original;
    f.render(a); f.render(b);
    const sharedGeometry = f.backend.get(mesh.getAttribute('position')).buffer!;
    const sharedExtra = f.backend.get(extra).buffer!;
    const wrapped = a.onDispose;
    expect(wrapped.call(context, 42)).toBe(42);
    expect(original).toHaveBeenCalledOnce(); expect(a.onDispose).toBe(original);
    wrapped.call(context, 43); expect(original).toHaveBeenCalledOnce();
    expect(sharedExtra.destroyed).toBe(false);
    const replacement = new THREE.InstancedBufferAttribute(new Float32Array(16), 4);
    b.attributes = [...Object.values(mesh.attributes), replacement]; f.render(b);
    expect(sharedExtra.destroy).toHaveBeenCalledOnce(); expect(sharedGeometry.destroyed).toBe(false);
    const replacementBuffer = f.backend.get(replacement).buffer!;
    b.onDispose(); expect(replacementBuffer.destroy).toHaveBeenCalledOnce();
    expect(sharedGeometry.destroyed).toBe(false);
    // Reusing the same render object can register a new native lifetime safely.
    f.render(a); expect(f.backend.get(extra).buffer).not.toBe(sharedExtra);
    a.onDispose.call(context, 44); expect(original).toHaveBeenCalledTimes(2);
    mesh.dispose(); f.renderer.dispose(); expect(f.tracked.size).toBe(0);
  });

  it('releases regenerated wireframe indexes and all remaining allocations before renderer disposal', () => {
    const f = fixture(), mesh = source(), draw = object(mesh); draw.material.wireframe = true;
    f.render(draw); const wireframe = f.geometries.getIndex(draw)!;
    const first = f.backend.get(wireframe).buffer!;
    mesh.index!.needsUpdate = true; f.render(draw);
    expect(first.destroy).toHaveBeenCalledOnce();
    const live = f.allocations.filter(allocation => !allocation.destroyed);
    f.originalDispose.mockImplementation(() => { expect(live.every(allocation => allocation.destroyed)).toBe(true); f.geometries.dispose(); });
    f.renderer.dispose();
    expect(f.originalDispose).toHaveBeenCalledOnce(); expect(f.renderer.dispose).toBe(f.originalDispose);
    expect(f.geometries._geometryDisposeListeners.size).toBe(0); expect(f.info.memory.geometries).toBe(0);
    mesh.dispose(); f.restore();
    for (const allocation of f.allocations) expect(allocation.destroy).toHaveBeenCalledOnce();
  });
});
