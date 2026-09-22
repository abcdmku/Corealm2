import * as THREE from "three";

/**
 * Three's WebGPU upload promotes non-normalized 8/16-bit integer buffers to 32-bit.
 * GLTFLoader can share that same interleaved buffer with normalized colors or
 * weights. Give each integer attribute its own packed buffer before any upload,
 * preserving both raw joint indices and the normalized color/weight interpretation.
 */
export function* prepareImportedVertexLayouts(roots: readonly THREE.Object3D[]): Generator<void> {
  const visited = new Set<THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  const packed = new Map<THREE.InterleavedBufferAttribute, THREE.BufferAttribute>();
  const pending = [...roots];
  while (pending.length) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);
    pending.push(...object.children);
    const geometry = (object as THREE.Mesh).geometry;
    if (!geometry || geometries.has(geometry)) { yield; continue; }
    geometries.add(geometry);
    const entries: { source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      replace: (attribute: THREE.BufferAttribute) => void }[] = [];
    for (const [name, source] of Object.entries(geometry.attributes)) {
      entries.push({ source, replace: attribute => { geometry.setAttribute(name, attribute); } });
    }
    for (const attributes of Object.values(geometry.morphAttributes)) {
      attributes.forEach((source, index) => entries.push({ source, replace: attribute => { attributes[index] = attribute; } }));
    }
    for (const { source, replace } of entries) {
        const attribute = source as THREE.InterleavedBufferAttribute;
        if (!attribute.isInterleavedBufferAttribute) continue;
        const values = attribute.array;
        if (!(values instanceof Uint8Array || values instanceof Int8Array
          || values instanceof Uint16Array || values instanceof Int16Array)) continue;
        let output = packed.get(attribute);
        if (!output) {
          const Values = values.constructor as THREE.TypedArrayConstructor;
          const array = new Values(attribute.count * attribute.itemSize);
          for (let vertex = 0; vertex < attribute.count; vertex++) {
            for (let component = 0; component < attribute.itemSize; component++) {
              array[vertex * attribute.itemSize + component] = values[vertex * attribute.data.stride + attribute.offset + component]!;
            }
            if ((vertex + 1) % 2048 === 0) yield;
          }
          const data = attribute.data as THREE.InstancedInterleavedBuffer & { isInstancedInterleavedBuffer?: boolean };
          output = data.isInstancedInterleavedBuffer
            ? new THREE.InstancedBufferAttribute(array, attribute.itemSize, attribute.normalized, data.meshPerAttribute)
            : new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized);
          output.name = attribute.name;
          output.setUsage(attribute.data.usage);
          const gpuType = (attribute as THREE.InterleavedBufferAttribute & { gpuType?: THREE.AttributeGPUType }).gpuType;
          if (gpuType !== undefined) output.gpuType = gpuType;
          packed.set(attribute, output);
        }
        replace(output);
        yield;
    }
    yield;
  }
}
