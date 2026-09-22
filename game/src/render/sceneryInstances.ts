import {
  Box3, BufferGeometry, Color, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedInterleavedBuffer, InterleavedBufferAttribute, Material, Matrix4, Mesh,
  Sphere, type Object3D,
} from 'three';
import { Fn, attribute, normalLocal, positionLocal, tangentLocal, transformNormal, vec4 } from 'three/tsl';
import { cloneNodeMaterial, composeSurface, type SurfaceNodeMaterial, type SurfaceNodes } from './nodeMaterials.js';
import { objectInstanceMatrix, SCENERY_MATRIX_ATTRIBUTES } from './objectTransformNodes.js';

type SharedMaterial = { material: SurfaceNodeMaterial; references: number };
const materials = new WeakMap<Material, Map<boolean, SharedMaterial>>();

function acquireMaterial(source: Material, colors: boolean): SharedMaterial {
  let layouts = materials.get(source);
  if (!layouts) { layouts = new Map(); materials.set(source, layouts); }
  let entry = layouts.get(colors);
  if (!entry) {
    const material = cloneNodeMaterial(source);
    composeSurface(material, {
      position: inherited => Fn(builder => {
        const matrix = objectInstanceMatrix().toVar();
        positionLocal.assign(matrix.mul(vec4(positionLocal, 1)).xyz);
        if (builder.geometry.hasAttribute('normal')) normalLocal.assign(transformNormal(normalLocal, matrix));
        if (builder.geometry.hasAttribute('tangent')) tangentLocal.assign(matrix.mul(vec4(tangentLocal, 0)).xyz.normalize());
        // Native instancing precedes the source position graph. Wind and other
        // deformation therefore still see the transformed position and normal.
        return inherited;
      })(),
      ...(colors ? { color: (previous: SurfaceNodes['color']) =>
        previous.mul(attribute<'vec3'>('sceneryColor', 'vec3')) } : {}),
    });
    entry = { material, references: 0 };
    layouts.set(colors, entry);
  }
  entry.references++;
  return entry;
}

function releaseMaterial(source: Material, colors: boolean, entry: SharedMaterial): void {
  if (--entry.references !== 0) return;
  materials.get(source)?.delete(colors);
  entry.material.dispose();
}

/** Instanced scenery whose shader graph depends on attribute layout, not cluster identity. */
export class SceneryInstances extends Mesh<InstancedBufferGeometry, Material | Material[]> {
  readonly isSceneryInstances = true;
  readonly sourceGeometry: BufferGeometry;
  readonly instanceTransforms: InstancedInterleavedBuffer;
  readonly instanceColors: InstancedBufferAttribute | null;
  private readonly capacity: number;
  private readonly materialSources: Material[];
  private readonly materialEntries: SharedMaterial[];
  private readonly sourceBounds: BufferGeometry;
  private disposed = false;

  constructor(sourceGeometry: BufferGeometry, sourceMaterial: Material | Material[], capacity: number, options: { colors?: boolean } = {}) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('Scenery instance capacity must be a nonnegative integer.');
    const geometry = new InstancedBufferGeometry();
    geometry.index = sourceGeometry.index;
    geometry.attributes = { ...sourceGeometry.attributes };
    geometry.morphAttributes = { ...sourceGeometry.morphAttributes };
    geometry.morphTargetsRelative = sourceGeometry.morphTargetsRelative;
    geometry.groups = sourceGeometry.groups.map(group => ({ ...group }));
    geometry.drawRange = { ...sourceGeometry.drawRange };
    geometry.name = sourceGeometry.name;
    // The renderer's disposal integration retains these shared source buffers.
    (geometry as InstancedBufferGeometry & { sharedScenerySource: BufferGeometry }).sharedScenerySource = sourceGeometry;
    const sources = Array.isArray(sourceMaterial) ? sourceMaterial : [sourceMaterial];
    const entries = sources.map(source => acquireMaterial(source, options.colors === true));
    super(geometry, Array.isArray(sourceMaterial) ? entries.map(entry => entry.material) : entries[0]!.material);
    this.sourceGeometry = sourceGeometry;
    this.capacity = capacity;
    this.materialSources = sources;
    this.materialEntries = entries;
    this.instanceTransforms = new InstancedInterleavedBuffer(new Float32Array(capacity * 16), 16, 1);
    for (let column = 0; column < 4; column++) {
      geometry.setAttribute(SCENERY_MATRIX_ATTRIBUTES[column]!, new InterleavedBufferAttribute(this.instanceTransforms, 4, column * 4));
    }
    const identity = new Matrix4();
    for (let index = 0; index < capacity; index++) identity.toArray(this.instanceTransforms.array, index * 16);
    this.instanceColors = options.colors ? new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3) : null;
    if (this.instanceColors) geometry.setAttribute('sceneryColor', this.instanceColors);
    geometry.instanceCount = capacity;

    // Computing cluster bounds must not fill or replace bounds on shared assets.
    this.sourceBounds = new BufferGeometry();
    this.sourceBounds.attributes = sourceGeometry.attributes;
    this.sourceBounds.morphAttributes = sourceGeometry.morphAttributes;
    this.sourceBounds.morphTargetsRelative = sourceGeometry.morphTargetsRelative;
    this.sourceBounds.boundingBox = sourceGeometry.boundingBox?.clone() ?? null;
    this.sourceBounds.boundingSphere = sourceGeometry.boundingSphere?.clone() ?? null;
  }

  get instanceCount(): number { return this.geometry.instanceCount; }
  set instanceCount(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > this.capacity) throw new RangeError('Scenery instance count exceeds its allocated capacity.');
    this.geometry.instanceCount = value;
  }
  get boundingBox(): Box3 | null { return this.geometry.boundingBox; }
  get boundingSphere(): Sphere | null { return this.geometry.boundingSphere; }

  getMatrixAt(index: number, matrix: Matrix4): void { matrix.fromArray(this.instanceTransforms.array, index * 16); }
  setMatrixAt(index: number, matrix: Matrix4): void { matrix.toArray(this.instanceTransforms.array, index * 16); }
  getColorAt(index: number, color: Color): void {
    if (this.instanceColors) color.fromArray(this.instanceColors.array, index * 3);
    else color.setRGB(1, 1, 1);
  }
  setColorAt(index: number, color: Color): void {
    if (!this.instanceColors) throw new Error('Scenery colors must be allocated with the colors constructor option.');
    color.toArray(this.instanceColors.array, index * 3);
  }

  computeBoundingBox(): void {
    if (!this.sourceBounds.boundingBox) this.sourceBounds.computeBoundingBox();
    const bounds = this.geometry.boundingBox ??= new Box3();
    const instanceBounds = new Box3(), matrix = new Matrix4();
    bounds.makeEmpty();
    for (let index = 0; index < this.instanceCount; index++) {
      this.getMatrixAt(index, matrix);
      bounds.union(instanceBounds.copy(this.sourceBounds.boundingBox!).applyMatrix4(matrix));
    }
  }

  computeBoundingSphere(): void {
    if (!this.sourceBounds.boundingSphere) this.sourceBounds.computeBoundingSphere();
    const bounds = this.geometry.boundingSphere ??= new Sphere();
    const instanceBounds = new Sphere(), matrix = new Matrix4();
    bounds.makeEmpty();
    for (let index = 0; index < this.instanceCount; index++) {
      this.getMatrixAt(index, matrix);
      bounds.union(instanceBounds.copy(this.sourceBounds.boundingSphere!).applyMatrix4(matrix));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    for (let index = 0; index < this.materialSources.length; index++) {
      releaseMaterial(this.materialSources[index]!, this.instanceColors !== null, this.materialEntries[index]!);
    }
  }
}

export function isSceneryInstances(object: Object3D): object is SceneryInstances {
  return (object as SceneryInstances).isSceneryInstances === true;
}
