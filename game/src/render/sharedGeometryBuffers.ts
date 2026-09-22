import { REVISION, type BufferAttribute, type BufferGeometry, type InterleavedBuffer, type InterleavedBufferAttribute } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

type Attribute = BufferAttribute | InterleavedBufferAttribute;
type Buffer = BufferAttribute | InterleavedBuffer;
type RenderObject = { geometry: BufferGeometry; getAttributes(): Attribute[]; onDispose?: (...args: unknown[]) => unknown };
type DisposeListener = () => void;
type AttributeData = { version?: number };
interface Backend {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  has(key: object): boolean;
  get(key: object): { buffer?: { destroy(): void } };
  delete(key: object): unknown;
  destroyAttribute(attribute: Buffer): void;
}
interface AttributeStore {
  data: WeakMap<object, AttributeData>;
  delete(attribute: Attribute): AttributeData | null;
  info: { destroyAttribute(attribute: Attribute): void };
}
interface Geometries {
  data: WeakMap<BufferGeometry, { initialized?: boolean }>;
  attributes: AttributeStore;
  info: { memory: { geometries: number } };
  attributeCall: WeakMap<object, number>;
  wireframes: WeakMap<BufferGeometry, BufferAttribute>;
  _geometryDisposeListeners: Map<BufferGeometry, DisposeListener>;
  initGeometry(object: RenderObject): void;
  updateAttributes(object: RenderObject): void;
  getIndex(object: RenderObject): BufferAttribute | null;
}
interface Internals {
  backend: Backend;
  _geometries: Geometries | null;
  _attributes: AttributeStore | null;
  dispose(): void;
}
interface GeometryOwner {
  geometry: BufferGeometry;
  attributes: Set<Attribute>;
  extras: Map<Attribute, number>;
  extraBindings: Set<ExtraBinding>;
  layout: Map<string, Attribute>;
  morphs: Map<string, readonly Attribute[] | undefined>;
  index: BufferAttribute | null;
  indirect: BufferAttribute | null;
  wireframe: BufferAttribute | undefined;
  renderAttributes: WeakMap<RenderObject, readonly Attribute[]>;
  dispose: DisposeListener;
}
interface ExtraBinding {
  owner: GeometryOwner;
  object: RenderObject;
  attributes: Set<Attribute>;
  original: (...args: unknown[]) => unknown;
  wrapper: (...args: unknown[]) => unknown;
  released: boolean;
  called: boolean;
}
interface BufferOwners {
  aliases: Map<Attribute, number>;
  owners: Set<GeometryOwner>;
}
const installed = new WeakMap<WebGPURenderer, () => void>();
const bufferOf = (attribute: Attribute): Buffer => (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute
  ? (attribute as InterleavedBufferAttribute).data : attribute as BufferAttribute;

/** r185 destroys buffers when any geometry using them is disposed. Native scenery uses
 * small instanced geometry wrappers over shared source attributes, so buffer ownership
 * must instead follow all initialized geometries. Install after renderer.init(), before
 * the first geometry upload. CPU source geometry does not pin unused GPU allocations.
 * The returned cleanup is also called before renderer.dispose().
 */
export function installSharedGeometryBuffers(renderer: WebGPURenderer): () => void {
  const existing = installed.get(renderer);
  if (existing) return existing;
  const internal = renderer as unknown as Internals;
  if (internal.backend.isWebGLBackend === true) return () => {};
  const geometries = internal._geometries, attributes = internal._attributes, backend = internal.backend;
  if (REVISION !== '185' || backend.isWebGPUBackend !== true || !geometries || !attributes
    || geometries.attributes !== attributes || !(geometries.data instanceof WeakMap)
    || !(attributes.data instanceof WeakMap) || !(geometries.attributeCall instanceof WeakMap)
    || !(geometries.wireframes instanceof WeakMap) || !(geometries._geometryDisposeListeners instanceof Map)
    || typeof geometries.initGeometry !== 'function' || typeof geometries.updateAttributes !== 'function'
    || typeof geometries.getIndex !== 'function' || typeof attributes.delete !== 'function'
    || typeof backend.destroyAttribute !== 'function' || typeof backend.has !== 'function'
    || typeof backend.get !== 'function' || typeof backend.delete !== 'function') {
    throw new Error('Shared geometry buffers require initialized Three r185 native geometry/attribute stores');
  }
  if (geometries._geometryDisposeListeners.size !== 0)
    throw new Error('Install shared geometry buffer ownership before the first native geometry is initialized');

  const owners = new Map<BufferGeometry, GeometryOwner>();
  const buffers = new Map<Buffer, BufferOwners>();
  const extrasByObject = new WeakMap<RenderObject, ExtraBinding>();
  const initGeometry = geometries.initGeometry;
  const updateAttributes = geometries.updateAttributes;
  const getIndex = geometries.getIndex;
  const deleteAttribute = attributes.delete;
  const rendererDispose = internal.dispose;
  let closed = false;

  const releaseAlias = (owner: GeometryOwner, attribute: Attribute): void => {
    const buffer = bufferOf(attribute), record = buffers.get(buffer);
    if (!record) return;
    owner.attributes.delete(attribute);
    const aliases = (record.aliases.get(attribute) ?? 1) - 1;
    if (aliases > 0) record.aliases.set(attribute, aliases);
    else {
      record.aliases.delete(attribute);
      attributes.data.delete(attribute);
      attributes.info.destroyAttribute(attribute);
      geometries.attributeCall.delete(attribute);
      // Interleaved views can have backend layout data, but the GPU buffer belongs
      // to their canonical InterleavedBuffer and must remain while any view is live.
      if (attribute !== buffer) backend.delete(attribute);
    }
    if (![...owner.attributes].some(candidate => bufferOf(candidate) === buffer)) record.owners.delete(owner);
    if (record.owners.size === 0) {
      if (backend.has(buffer) && backend.get(buffer).buffer) backend.destroyAttribute(buffer);
      backend.delete(buffer);
      geometries.attributeCall.delete(buffer);
      buffers.delete(buffer);
    }
  };

  const acquireAlias = (owner: GeometryOwner, attribute: Attribute): void => {
    if (owner.attributes.has(attribute)) return;
    owner.attributes.add(attribute);
    const buffer = bufferOf(attribute);
    let record = buffers.get(buffer);
    if (!record) { record = { aliases: new Map(), owners: new Set() }; buffers.set(buffer, record); }
    record.owners.add(owner);
    record.aliases.set(attribute, (record.aliases.get(attribute) ?? 0) + 1);
  };

  const geometryUses = (owner: GeometryOwner, attribute: Attribute): boolean => {
    const geometry = owner.geometry;
    if (geometry.index === attribute || geometry.indirect === attribute || geometries.wireframes.get(geometry) === attribute) return true;
    for (const name in geometry.attributes) if (geometry.attributes[name] === attribute) return true;
    const morphs = geometry.morphAttributes as Record<string, Attribute[] | undefined>;
    for (const name in morphs) if (morphs[name]?.includes(attribute)) return true;
    return false;
  };

  const releaseExtra = (owner: GeometryOwner, attribute: Attribute): void => {
    const count = (owner.extras.get(attribute) ?? 1) - 1;
    if (count > 0) owner.extras.set(attribute, count);
    else {
      owner.extras.delete(attribute);
      if (!geometryUses(owner, attribute)) releaseAlias(owner, attribute);
    }
  };
  const releaseBinding = (binding: ExtraBinding): void => {
    if (binding.released) return;
    binding.released = true;
    binding.owner.extraBindings.delete(binding);
    binding.owner.renderAttributes.delete(binding.object);
    if (extrasByObject.get(binding.object) === binding) extrasByObject.delete(binding.object);
    if (binding.object.onDispose === binding.wrapper) binding.object.onDispose = binding.original;
    for (const attribute of binding.attributes) releaseExtra(binding.owner, attribute);
    binding.attributes.clear();
  };
  const updateExtras = (owner: GeometryOwner, object: RenderObject, next: Set<Attribute>): void => {
    let binding = extrasByObject.get(object);
    if (binding && (binding.owner !== owner || next.size === 0)) { releaseBinding(binding); binding = undefined; }
    if (!next.size) return;
    if (!binding) {
      if (typeof object.onDispose !== 'function')
        throw new Error('Native shader attributes require the r185 render object disposal callback');
      const original = object.onDispose;
      const created: ExtraBinding = { owner, object, attributes: new Set(), original, released: false, called: false,
        wrapper: function (this: unknown, ...args: unknown[]): unknown {
          if (created.called) return;
          created.called = true;
          let result: unknown;
          try { releaseBinding(created); }
          finally { result = original.apply(this, args); }
          return result;
        } };
      binding = created; extrasByObject.set(object, binding); owner.extraBindings.add(binding);
      object.onDispose = binding.wrapper;
    }
    for (const attribute of next) if (!binding.attributes.has(attribute)) {
      owner.extras.set(attribute, (owner.extras.get(attribute) ?? 0) + 1);
      acquireAlias(owner, attribute);
    }
    for (const attribute of binding.attributes) if (!next.has(attribute)) releaseExtra(owner, attribute);
    binding.attributes = next;
  };

  const layoutMatches = (owner: GeometryOwner): boolean => {
    const geometry = owner.geometry;
    const morphAttributes = geometry.morphAttributes as Record<string, Attribute[] | undefined>;
    if (owner.index !== geometry.index || owner.indirect !== geometry.indirect
      || owner.wireframe !== geometries.wireframes.get(geometry)) return false;
    let count = 0;
    for (const name in geometry.attributes) {
      count++;
      if (owner.layout.get(name) !== geometry.attributes[name]) return false;
    }
    if (count !== owner.layout.size) return false;
    count = 0;
    for (const name in morphAttributes) {
      count++;
      const current = morphAttributes[name], previous = owner.morphs.get(name);
      if (!owner.morphs.has(name) || current?.length !== previous?.length) return false;
      for (let index = 0; index < (current?.length ?? 0); index++) if (current![index] !== previous![index]) return false;
    }
    return count === owner.morphs.size;
  };

  const synchronize = (owner: GeometryOwner, object?: RenderObject): void => {
    const geometry = owner.geometry;
    const morphAttributes = geometry.morphAttributes as Record<string, Attribute[] | undefined>;
    const changed = !layoutMatches(owner);
    const renderAttributes = object?.getAttributes();
    if (renderAttributes && owner.renderAttributes.get(object!) !== renderAttributes) {
      owner.renderAttributes.set(object!, renderAttributes);
      // A cached render object's array changes only with a new binding layout.
      // Extra instance/node buffers follow that render object's own disposal.
      const extras = new Set<Attribute>();
      for (const attribute of renderAttributes) if (!geometryUses(owner, attribute)) extras.add(attribute);
      updateExtras(owner, object!, extras);
    }
    if (!changed) return;

    const current = new Set<Attribute>();
    owner.layout.clear();
    for (const name in geometry.attributes) {
      const attribute = geometry.attributes[name]!;
      current.add(attribute); owner.layout.set(name, attribute);
    }
    owner.index = geometry.index; owner.indirect = geometry.indirect;
    if (geometry.index) current.add(geometry.index);
    if (geometry.indirect) current.add(geometry.indirect);
    owner.morphs.clear();
    for (const name in morphAttributes) {
      const morphs = morphAttributes[name];
      owner.morphs.set(name, morphs?.slice());
      for (const attribute of morphs ?? []) current.add(attribute);
    }
    for (const attribute of owner.extras.keys()) current.add(attribute);
    owner.wireframe = geometries.wireframes.get(geometry);
    if (owner.wireframe) current.add(owner.wireframe);
    for (const attribute of current) acquireAlias(owner, attribute);
    for (const attribute of [...owner.attributes]) if (!current.has(attribute)) releaseAlias(owner, attribute);
  };

  const releaseGeometry = (owner: GeometryOwner): void => {
    if (owners.get(owner.geometry) !== owner) return;
    owners.delete(owner.geometry);
    owner.geometry.removeEventListener('dispose', owner.dispose);
    geometries._geometryDisposeListeners.delete(owner.geometry);
    // r185 leaves initialized=true after disposal. Delete its record so reusing a
    // disposed geometry rebuilds both the listener and all native attribute caches.
    geometries.data.delete(owner.geometry);
    geometries.wireframes.delete(owner.geometry);
    geometries.info.memory.geometries--;
    for (const binding of [...owner.extraBindings]) releaseBinding(binding);
    for (const attribute of [...owner.attributes]) releaseAlias(owner, attribute);
    owner.extras.clear();
  };

  const patchedInit = function (this: Geometries, object: RenderObject): void {
    initGeometry.call(this, object);
    const geometry = object.geometry, originalDispose = this._geometryDisposeListeners.get(geometry);
    if (!originalDispose) throw new Error('Three r185 geometry initialization did not install its expected disposal listener');
    geometry.removeEventListener('dispose', originalDispose);
    const owner: GeometryOwner = { geometry, attributes: new Set(), extras: new Map(), extraBindings: new Set(), layout: new Map(), morphs: new Map(),
      index: null, indirect: null, wireframe: undefined, renderAttributes: new WeakMap(), dispose: () => releaseGeometry(owner) };
    owners.set(geometry, owner);
    geometry.addEventListener('dispose', owner.dispose);
    this._geometryDisposeListeners.set(geometry, owner.dispose);
    try { synchronize(owner, object); }
    catch (error) { releaseGeometry(owner); throw error; }
  };
  const patchedUpdate = function (this: Geometries, object: RenderObject): void {
    const owner = owners.get(object.geometry);
    if (!owner) throw new Error('Native geometry attributes were updated without shared buffer ownership');
    synchronize(owner, object);
    updateAttributes.call(this, object);
  };
  const patchedIndex = function (this: Geometries, object: RenderObject): BufferAttribute | null {
    const index = getIndex.call(this, object);
    const owner = owners.get(object.geometry);
    if (owner && owner.wireframe !== this.wireframes.get(object.geometry)) synchronize(owner);
    return index;
  };
  const patchedDelete = function (this: AttributeStore, attribute: Attribute): AttributeData | null {
    // Wireframe regeneration also calls Attributes.delete. Its old buffer is released
    // by synchronize after the geometry switches indexes, respecting other owners.
    if (buffers.get(bufferOf(attribute))?.owners.size) return null;
    return deleteAttribute.call(this, attribute);
  };

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    for (const owner of [...owners.values()]) releaseGeometry(owner);
    if (geometries.initGeometry === patchedInit) geometries.initGeometry = initGeometry;
    if (geometries.updateAttributes === patchedUpdate) geometries.updateAttributes = updateAttributes;
    if (geometries.getIndex === patchedIndex) geometries.getIndex = getIndex;
    if (attributes.delete === patchedDelete) attributes.delete = deleteAttribute;
    if (internal.dispose === patchedDispose) internal.dispose = rendererDispose;
    installed.delete(renderer);
  };
  const patchedDispose = function (this: Internals): void { cleanup(); rendererDispose.call(this); };
  geometries.initGeometry = patchedInit;
  geometries.updateAttributes = patchedUpdate;
  geometries.getIndex = patchedIndex;
  attributes.delete = patchedDelete;
  internal.dispose = patchedDispose;
  installed.set(renderer, cleanup);
  return cleanup;
}
