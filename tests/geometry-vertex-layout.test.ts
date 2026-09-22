import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { prepareImportedVertexLayouts } from "../game/src/render/geometryVertexLayout.js";

const prepare = (roots: THREE.Object3D[]) => { for (const _ of prepareImportedVertexLayouts(roots)) { /* consume */ } };

describe("imported WebGPU vertex layouts", () => {
  it.each([Uint8Array, Uint16Array])("isolates normalized color and weights from joint integer promotion (%s)", Values => {
    const maximum = Values === Uint8Array ? 255 : 65535;
    const bytes = new Values([maximum, Math.floor(maximum / 2), 0, maximum, 1, 2, 3, 4,
      0, maximum, maximum, maximum, 5, 6, 7, 8]);
    const buffer = new THREE.InterleavedBuffer(bytes, 8).setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.InterleavedBufferAttribute(buffer, 4, 0, true);
    const joints = new THREE.InterleavedBufferAttribute(buffer, 4, 4, false);
    color.name = "authored colors";
    Object.assign(joints, { gpuType: THREE.IntType });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("color", color).setAttribute("skinWeight", color).setAttribute("skinIndex", joints);
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
    geometry.boundingBox = bounds;
    geometry.setIndex([0, 1, 0]);
    const mesh = new THREE.Mesh(geometry), root = new THREE.Group(); root.add(mesh);
    const expected = Array.from({ length: 2 }, (_, i) => [color.getX(i), color.getY(i), color.getZ(i), color.getW(i)]).flat();
    prepare([root, root]);
    const result = geometry.getAttribute("color") as THREE.BufferAttribute;
    const indices = geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
    expect(result.isBufferAttribute).toBe(true);
    expect(result.normalized).toBe(true);
    expect(result.name).toBe("authored colors");
    expect(result.usage).toBe(THREE.DynamicDrawUsage);
    expect(indices.gpuType).toBe(THREE.IntType);
    expect(geometry.getAttribute("skinWeight")).toBe(result);
    expect(Array.from(indices.array)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // This is the upstream upload promotion that previously mutated the shared color buffer.
    indices.array = new Uint32Array(indices.array);
    expect(result.array).toBeInstanceOf(Values);
    expect(Array.from({ length: 2 }, (_, i) => [result.getX(i), result.getY(i), result.getZ(i), result.getW(i)]).flat()).toEqual(expected);
    expect(buffer.array).toBe(bytes);
    expect(geometry.boundingBox).toBe(bounds);
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 0]);
    prepare([root]);
    expect(geometry.getAttribute("color")).toBe(result);
  });

  it("retains instancing, morph attributes, shared geometry and float layouts while slicing large copies", () => {
    const values = new Int16Array(4096 * 4).fill(-32767);
    const buffer = new THREE.InstancedInterleavedBuffer(values, 4, 3);
    const normal = new THREE.InterleavedBufferAttribute(buffer, 3, 0, true);
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.Float32BufferAttribute(new Float32Array(4096 * 3), 3);
    geometry.setAttribute("position", position);
    geometry.setAttribute("normal", normal);
    geometry.morphAttributes.normal = [normal];
    const root = new THREE.Group(); root.add(new THREE.Mesh(geometry), new THREE.Mesh(geometry));
    const steps = [...prepareImportedVertexLayouts([root])];
    const output = geometry.getAttribute("normal") as THREE.InstancedBufferAttribute;
    expect(output.isInstancedBufferAttribute).toBe(true);
    expect(output.meshPerAttribute).toBe(3);
    expect(output.getX(0)).toBe(-1);
    expect(geometry.morphAttributes.normal![0]).toBe(output);
    expect(geometry.getAttribute("position")).toBe(position);
    expect(steps.length).toBeGreaterThan(3);
  });
});
