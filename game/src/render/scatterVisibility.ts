import * as THREE from "three";

interface ScatterEntry {
  mesh: THREE.InstancedMesh;
  count: number;
  /** Original placement data is never rewritten when the draw prefix changes. */
  matrices: Float32Array;
  /** Six mesh-local AABB coordinates per source instance, including wind. */
  bounds: Float64Array;
  aggregate: THREE.Box3;
  /** Which original matrix currently occupies each physical buffer slot. */
  slots: Uint32Array;
  reordered: boolean;
}

/** Snapshot of the last completed prepare(), including registrations hidden by their ancestors. */
export interface ScatterVisibilityStats {
  registeredMeshes: number;
  sourceInstances: number;
  /** Prepared draw counts from effectively visible registrations only. */
  retainedInstances: number;
  /** Visible, nonempty aggregate bounds wholly within every active clipping plane. */
  insideMeshes: number;
  /** Registrations drawing zero instances because they are hidden, empty or rejected. */
  outsideMeshes: number;
  /** Matrix-buffer update requests issued during prepare(), not completed GPU transfers. */
  matrixUploads: number;
}

/**
 * Compacts static, matrix-only scatter before renderer.render().
 *
 * windMargin is in mesh-local metres after the source instance transforms, as in
 * finalizeScatterBounds(). Call prepare after camera and mesh world matrices are current.
 * Existing mesh bounds must already include that margin via finalizeScatterBounds();
 * they are preserved for Three's outer frustum test and streaming residency.
 * Registered placements and instance attributes must remain unchanged until remove().
 * Shadow casters need a separate pass-aware path and cannot register here.
 */
export class ScatterVisibility {
  private readonly entries = new Map<THREE.InstancedMesh, ScatterEntry>();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly localProjection = new THREE.Matrix4();
  private readonly localView = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly fogPlane = new THREE.Plane();
  private readonly fogPlanes = [...this.frustum.planes, this.fogPlane];
  private enabled = true;
  private stats: ScatterVisibilityStats = {
    registeredMeshes: 0, sourceInstances: 0, retainedInstances: 0,
    insideMeshes: 0, outsideMeshes: 0, matrixUploads: 0,
  };

  add(mesh: THREE.InstancedMesh, windMargin: number): void {
    if (this.entries.has(mesh)) throw new Error("Scatter visibility mesh is already registered");
    if (mesh.castShadow) throw new Error("Scatter visibility cannot compact shadow casters");
    if (mesh.instanceColor || mesh.morphTexture
      || Object.values(mesh.geometry.attributes).some(attribute =>
        attribute instanceof THREE.InstancedBufferAttribute
        || (attribute instanceof THREE.InterleavedBufferAttribute
          && attribute.data instanceof THREE.InstancedInterleavedBuffer))) {
      throw new Error("Scatter visibility requires matrix-only instance attributes");
    }
    if (!Number.isFinite(windMargin) || windMargin < 0) {
      throw new Error("Scatter visibility wind margin must be finite and nonnegative");
    }
    const count = mesh.count;
    if (!Number.isInteger(count) || count < 0 || count > mesh.instanceMatrix.count) {
      throw new Error("Scatter visibility instance count is outside its matrix buffer");
    }

    const matrices = new Float32Array(mesh.instanceMatrix.array.slice(0, count * 16));
    const bounds = new Float64Array(count * 6);
    const slots = new Uint32Array(count);
    const aggregate = new THREE.Box3();
    const geometryBox = mesh.geometry.boundingBox?.clone() ?? new THREE.Box3();
    if (!mesh.geometry.boundingBox && count > 0) {
      const positions = mesh.geometry.getAttribute("position");
      if (!positions) throw new Error("Scatter visibility geometry has no positions");
      geometryBox.setFromBufferAttribute(positions as THREE.BufferAttribute);
    }
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (let index = 0; index < count; index += 1) {
      matrix.fromArray(matrices, index * 16);
      box.copy(geometryBox).applyMatrix4(matrix).expandByScalar(windMargin);
      box.min.toArray(bounds, index * 6);
      box.max.toArray(bounds, index * 6 + 3);
      aggregate.union(box);
      slots[index] = index;
    }

    // Keep complete resident bounds while count changes. Otherwise Three could lazily
    // compute an empty sphere during a turned-away frame and never admit the mesh again.
    if (!mesh.boundingBox) mesh.boundingBox = aggregate.clone();
    if (!mesh.boundingSphere) mesh.boundingSphere = aggregate.getBoundingSphere(new THREE.Sphere());
    this.entries.set(mesh, { mesh, count, matrices, bounds, aggregate, slots, reordered: false });
  }

  remove(mesh: THREE.InstancedMesh): void {
    const entry = this.entries.get(mesh);
    if (!entry) return;
    this.restore(entry);
    this.entries.delete(mesh);
  }

  /**
   * opaqueFogDepth is Three's linear fog far depth (-viewZ), never a radial distance.
   * Omit it for fog-free views; nonfinite values also disable the extra plane.
   */
  prepare(camera: THREE.Camera, opaqueFogDepth?: number): void {
    const stats: ScatterVisibilityStats = {
      registeredMeshes: this.entries.size, sourceInstances: 0, retainedInstances: 0,
      insideMeshes: 0, outsideMeshes: 0, matrixUploads: 0,
    };
    const useFog = opaqueFogDepth !== undefined && Number.isFinite(opaqueFogDepth);
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const entry of this.entries.values()) {
      const mesh = entry.mesh;
      stats.sourceInstances += entry.count;
      if (this.enabled && mesh.castShadow) throw new Error("Scatter visibility cannot compact shadow casters");
      if (!isVisible(mesh)) {
        stats.outsideMeshes += 1;
        continue;
      }
      if (!this.enabled) {
        // setEnabled(false) already restored the buffers. No clipping classifications or
        // uploads happened in this prepare; report the visible full population only.
        stats.retainedInstances += mesh.count;
        if (mesh.count === 0) stats.outsideMeshes += 1;
        continue;
      }
      if (entry.count === 0) {
        mesh.count = 0;
        stats.outsideMeshes += 1;
        continue;
      }

      // Testing cached boxes in mesh-local coordinates avoids transforming every
      // instance bound each frame, including when a fixture has a transformed parent.
      this.localProjection.multiplyMatrices(this.viewProjection, mesh.matrixWorld);
      this.frustum.setFromProjectionMatrix(
        this.localProjection, camera.coordinateSystem, camera.reversedDepth,
      );
      if (useFog) {
        this.localView.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
        const elements = this.localView.elements;
        // Retain viewZ + fogFar >= 0. Expressing this plane in mesh-local space
        // tests the complete cached, wind-expanded boxes under any parent transform.
        this.fogPlane.setComponents(
          elements[2]!, elements[6]!, elements[10]!, elements[14]! + opaqueFogDepth!,
        );
      }
      const planes = useFog ? this.fogPlanes : this.frustum.planes;
      const aggregateState = classifyBox(planes, entry.aggregate);
      if (aggregateState < 0) {
        mesh.count = 0;
        stats.outsideMeshes += 1;
        continue;
      }
      if (aggregateState > 0) {
        if (this.restore(entry)) stats.matrixUploads += 1;
        stats.insideMeshes += 1;
        stats.retainedInstances += mesh.count;
        continue;
      }

      const target = mesh.instanceMatrix.array;
      let retained = 0;
      let changed = false;
      for (let source = 0; source < entry.count; source += 1) {
        if (!intersectsBounds(planes, entry.bounds, source * 6)) continue;
        if (entry.slots[retained] !== source) {
          const from = source * 16;
          const to = retained * 16;
          for (let component = 0; component < 16; component += 1) {
            target[to + component] = entry.matrices[from + component]!;
          }
          entry.slots[retained] = source;
          changed = true;
        }
        retained += 1;
      }
      mesh.count = retained;
      stats.retainedInstances += retained;
      if (retained === 0) stats.outsideMeshes += 1;
      if (changed) {
        entry.reordered = true;
        mesh.instanceMatrix.needsUpdate = true;
        stats.matrixUploads += 1;
      }
    }
    this.stats = stats;
  }

  /** Returns a detached JSON-safe snapshot; mutations take effect in the next prepare. */
  getStats(): ScatterVisibilityStats {
    return { ...this.stats };
  }

  clear(): void {
    for (const entry of this.entries.values()) this.restore(entry);
    this.entries.clear();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) for (const entry of this.entries.values()) this.restore(entry);
  }

  private restore(entry: ScatterEntry): boolean {
    entry.mesh.count = entry.count;
    if (!entry.reordered) return false;
    entry.mesh.instanceMatrix.array.set(entry.matrices);
    entry.mesh.instanceMatrix.needsUpdate = true;
    for (let index = 0; index < entry.count; index += 1) entry.slots[index] = index;
    entry.reordered = false;
    return true;
  }
}

function isVisible(mesh: THREE.Object3D): boolean {
  for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
    if (!object.visible) return false;
  }
  return true;
}

/** -1 outside, 0 straddling a plane, 1 wholly inside. */
function classifyBox(planes: readonly THREE.Plane[], box: THREE.Box3): number {
  if (box.isEmpty()) return -1;
  let inside = true;
  for (const plane of planes) {
    const { x, y, z } = plane.normal;
    const far = x * (x > 0 ? box.max.x : box.min.x)
      + y * (y > 0 ? box.max.y : box.min.y)
      + z * (z > 0 ? box.max.z : box.min.z) + plane.constant;
    if (far < 0) return -1;
    const near = x * (x > 0 ? box.min.x : box.max.x)
      + y * (y > 0 ? box.min.y : box.max.y)
      + z * (z > 0 ? box.min.z : box.max.z) + plane.constant;
    if (near < 0) inside = false;
  }
  return inside ? 1 : 0;
}

function intersectsBounds(planes: readonly THREE.Plane[], bounds: Float64Array, offset: number): boolean {
  for (const plane of planes) {
    const { x, y, z } = plane.normal;
    const distance = x * bounds[offset + (x > 0 ? 3 : 0)]!
      + y * bounds[offset + (y > 0 ? 4 : 1)]!
      + z * bounds[offset + (z > 0 ? 5 : 2)]! + plane.constant;
    if (distance < 0) return false;
  }
  return true;
}
