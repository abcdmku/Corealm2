import {
  BufferGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedInterleavedBuffer, InterleavedBufferAttribute, Material, Matrix4, Mesh,
} from 'three';
import { attribute, mat4 } from 'three/tsl';

const MATRIX_ATTRIBUTES = ['effectMatrix0', 'effectMatrix1', 'effectMatrix2', 'effectMatrix3'] as const;

/** Named attributes let every pool share a graph while retaining its own instance data. */
export const effectInstanceMatrix = () => mat4(
  attribute<'vec4'>(MATRIX_ATTRIBUTES[0], 'vec4'), attribute<'vec4'>(MATRIX_ATTRIBUTES[1], 'vec4'),
  attribute<'vec4'>(MATRIX_ATTRIBUTES[2], 'vec4'), attribute<'vec4'>(MATRIX_ATTRIBUTES[3], 'vec4'),
);
export const effectInstanceColor = () => attribute<'vec3'>('effectColor', 'vec3');

export class EffectInstances<M extends Material = Material> extends Mesh<InstancedBufferGeometry, M> {
  readonly instanceMatrix: InstancedInterleavedBuffer;
  readonly instanceColors: InstancedBufferAttribute;
  readonly capacity: number;

  constructor(source: BufferGeometry, material: M, capacity: number,
    options: { matrices?: InstancedInterleavedBuffer; colors?: InstancedBufferAttribute } = {}) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('Invalid effect instance capacity');
    const geometry = new InstancedBufferGeometry();
    geometry.index = source.index;
    geometry.attributes = { ...source.attributes };
    geometry.groups = source.groups.map(group => ({ ...group }));
    geometry.drawRange = { ...source.drawRange };
    geometry.name = source.name;
    geometry.instanceCount = 0;
    super(geometry, material);
    this.capacity = capacity;
    this.instanceMatrix = options.matrices ?? new InstancedInterleavedBuffer(new Float32Array(capacity * 16), 16, 1);
    if (this.instanceMatrix.count !== capacity) throw new RangeError('Effect matrix capacity mismatch');
    this.instanceMatrix.setUsage(DynamicDrawUsage);
    if (!options.matrices) {
      const identity = new Matrix4();
      for (let index = 0; index < capacity; index++) identity.toArray(this.instanceMatrix.array, index * 16);
    }
    for (let column = 0; column < 4; column++)
      geometry.setAttribute(MATRIX_ATTRIBUTES[column]!, new InterleavedBufferAttribute(this.instanceMatrix, 4, column * 4));
    // `instanceColor` is reserved by Three for InstancedMesh's automatic varying.
    // Ordinary meshes consume the named attribute only when their graph requests it.
    this.instanceColors = options.colors ?? new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    if (this.instanceColors.count !== capacity) throw new RangeError('Effect color capacity mismatch');
    this.instanceColors.setUsage(DynamicDrawUsage);
    geometry.setAttribute('effectColor', this.instanceColors);
    this.frustumCulled = false;
  }

  // Keep Mesh.count at its default 1: larger values add the object's UUID to its graph key.
  get instanceCount(): number { return this.geometry.instanceCount; }
  set instanceCount(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > this.capacity) throw new RangeError('Effect instance count exceeds capacity');
    this.geometry.instanceCount = value;
  }
  setMatrixAt(index: number, matrix: Matrix4): void { matrix.toArray(this.instanceMatrix.array, index * 16); }
  getMatrixAt(index: number, matrix: Matrix4): void { matrix.fromArray(this.instanceMatrix.array, index * 16); }
  setColorAt(index: number, color: Color): void { color.toArray(this.instanceColors.array, index * 3); }
  getColorAt(index: number, color: Color): void { color.fromArray(this.instanceColors.array, index * 3); }
}
