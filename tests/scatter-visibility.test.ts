import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { ScatterVisibility } from "../game/src/render/scatterVisibility.js";

const meshes: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];

function translation(x: number, y = 0, z = -6): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

function makeMesh(
  matrices: readonly THREE.Matrix4[],
  geometry: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1),
  capacity = matrices.length,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), capacity);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.count = matrices.length;
  mesh.updateMatrixWorld(true);
  meshes.push(mesh);
  return mesh;
}

function drawnMatrices(mesh: THREE.InstancedMesh): number[][] {
  return Array.from({ length: mesh.count }, (_, index) => {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    return matrix.toArray();
  });
}

function makeCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 1, 20);
  camera.updateMatrixWorld(true);
  return camera;
}

afterEach(() => {
  for (const mesh of meshes.splice(0)) {
    mesh.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

describe("scatter visibility", () => {
  it("keeps intersecting geometry in source order and recovers after turning away", () => {
    const geometry = new THREE.BoxGeometry(2, 1, 1).translate(4, 0, 0);
    const mesh = makeMesh([
      translation(0),
      translation(-4),
      translation(-6.5),
      new THREE.Matrix4().compose(
        new THREE.Vector3(0, -4, -6),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
        new THREE.Vector3(1, 0.5, 1),
      ),
      translation(-8),
      translation(-4, 0, -23),
      translation(-4, 4),
    ], geometry);
    const original = drawnMatrices(mesh);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    const originalBox = mesh.boundingBox!;
    const originalSphere = mesh.boundingSphere!;
    const box = originalBox.clone();
    const sphere = originalSphere.clone();
    const expectResidentBounds = () => {
      expect(mesh.boundingBox).toBe(originalBox);
      expect(mesh.boundingSphere).toBe(originalSphere);
      expect(originalBox.equals(box)).toBe(true);
      expect(originalSphere.equals(sphere)).toBe(true);
    };
    const camera = makeCamera();
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);

    visibility.prepare(camera);
    // The second survivor's origin is outside the view, but its right edge is visible.
    expect(drawnMatrices(mesh)).toEqual([original[1], original[2], original[3]]);
    expectResidentBounds();
    const version = mesh.instanceMatrix.version;

    camera.lookAt(0, 0, 1);
    camera.updateMatrixWorld(true);
    visibility.prepare(camera);
    expect(mesh.count).toBe(0);
    expect(mesh.instanceMatrix.version).toBe(version);
    expectResidentBounds();

    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld(true);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1], original[2], original[3]]);
    expect(mesh.instanceMatrix.version).toBe(version);
    expectResidentBounds();
    visibility.setEnabled(false);
    expect(drawnMatrices(mesh)).toEqual(original);
  });

  it("uses perspective depth and retains geometry crossing the side, near and far planes", () => {
    const mesh = makeMesh([
      translation(3, 0, -2),
      translation(3, 0, -6),
      translation(0, 0, -0.5),
      translation(0, 0, -1),
      translation(0, 0, -20.3),
      translation(0, 0, -20),
      translation(6.1, 0, -6),
      translation(6.5, 0, -6),
      translation(0, 3, -2),
      translation(0, 3, -6),
    ], new THREE.BoxGeometry(0.2, 0.2, 0.2));
    const original = drawnMatrices(mesh);
    const camera = new THREE.PerspectiveCamera(90, 1, 1, 20);
    camera.updateMatrixWorld(true);
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);

    visibility.prepare(camera);

    expect(drawnMatrices(mesh)).toEqual([original[1], original[3], original[5], original[6], original[9]]);
  });

  it("uploads changed members when the count is equal and skips unchanged matrices", () => {
    const mesh = makeMesh([translation(20), translation(-1), translation(1, 0, 6)]);
    const original = drawnMatrices(mesh);
    const camera = makeCamera();
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);
    const firstVersion = mesh.instanceMatrix.version;

    visibility.prepare(camera);
    expect(mesh.instanceMatrix.version).toBe(firstVersion);
    camera.lookAt(0, 0, 1);
    camera.updateMatrixWorld(true);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[2]]);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(firstVersion);
    const secondVersion = mesh.instanceMatrix.version;
    visibility.prepare(camera);
    expect(mesh.instanceMatrix.version).toBe(secondVersion);
  });

  it("pads wind after the instance transform and before the parent transform", () => {
    const matrices = [1.2, 1.7].map((x) => new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, -6), new THREE.Quaternion(), new THREE.Vector3(0.1, 0.1, 0.1),
    ));
    const still = makeMesh(matrices);
    const windy = makeMesh(matrices);
    const original = drawnMatrices(windy);
    const parent = new THREE.Group();
    parent.scale.x = 2;
    parent.add(still, windy);
    parent.updateMatrixWorld(true);
    const visibility = new ScatterVisibility();
    visibility.add(still, 0);
    visibility.add(windy, 0.2);

    visibility.prepare(makeCamera());

    expect(still.count).toBe(0);
    // Its static left edge is x=2.3; wind can move it to x=1.9 inside the view.
    expect(drawnMatrices(windy)).toEqual([original[0]]);
  });

  it("uses current mesh and ancestor transforms when testing the camera frustum", () => {
    const mesh = makeMesh([
      translation(3, 0, 0), translation(3, 0, -10 / 3), translation(-3, 0, -10 / 3),
    ]);
    const original = drawnMatrices(mesh);
    const parent = new THREE.Group();
    parent.position.x = 10;
    parent.rotation.y = Math.PI / 2;
    parent.scale.set(2, 1, 3);
    mesh.position.x = 1;
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    const visibility = new ScatterVisibility();
    const camera = makeCamera();
    visibility.add(mesh, 0);

    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);
    parent.position.x = 30;
    parent.updateMatrixWorld(true);
    visibility.prepare(camera);
    expect(mesh.count).toBe(0);
    parent.position.x = 10;
    parent.updateMatrixWorld(true);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);
  });

  it("clips only geometry wholly beyond opaque fog and preserves frustum rejection", () => {
    const mesh = makeMesh([
      translation(0, 0, -11),
      translation(0, 0, -4),
      translation(0, 0, -8.25),
      translation(0, 0, -8.5),
      translation(0, 0, -8.75),
      translation(4, 0, -4),
      translation(0, 0, 0),
    ]);
    const original = drawnMatrices(mesh);
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);

    visibility.prepare(makeCamera(), 8);

    // The last retained box just touches the opaque plane at its nearest face.
    expect(drawnMatrices(mesh)).toEqual([original[1], original[2], original[3]]);
  });

  it("uses view depth rather than radial distance for perspective fog", () => {
    const mesh = makeMesh([
      translation(7, 0, -7.5),
      translation(0, 0, -9),
      translation(10, 0, -7.5),
    ], new THREE.BoxGeometry(0.2, 0.2, 0.2));
    const original = drawnMatrices(mesh);
    const camera = new THREE.PerspectiveCamera(90, 1, 1, 30);
    camera.updateMatrixWorld(true);
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);

    visibility.prepare(camera, 8);

    // This plant is over ten metres from the camera but only 7.5 metres deep.
    expect(drawnMatrices(mesh)).toEqual([original[0]]);
  });

  it("transforms fog through a camera ancestor and mirrored mesh parent with wind", () => {
    const matrices = [4, 2, 3].map((z) => translation(0, 0, z));
    const still = makeMesh(matrices, new THREE.BoxGeometry(0.2, 0.2, 0.2));
    const windy = makeMesh(matrices, new THREE.BoxGeometry(0.2, 0.2, 0.2));
    const original = drawnMatrices(windy);
    const camera = makeCamera();
    const cameraParent = new THREE.Group();
    cameraParent.position.set(10, 3, 20);
    cameraParent.rotation.y = Math.PI / 2;
    camera.position.z = 2;
    cameraParent.add(camera);
    cameraParent.updateMatrixWorld(true);

    const meshParent = new THREE.Group();
    camera.getWorldPosition(meshParent.position);
    camera.getWorldQuaternion(meshParent.quaternion);
    meshParent.scale.set(2, 1, -3);
    still.position.x = 0.25;
    windy.position.x = 0.25;
    meshParent.add(still, windy);
    meshParent.updateMatrixWorld(true);
    const visibility = new ScatterVisibility();
    visibility.add(still, 0);
    visibility.add(windy, 0.3);

    visibility.prepare(camera, 8);

    expect(drawnMatrices(still)).toEqual([original[1]]);
    // Mirroring puts source Z=3 nine metres ahead. Wind reaches depth 7.8.
    expect(drawnMatrices(windy)).toEqual([original[1], original[2]]);

    camera.position.z = 0;
    cameraParent.updateMatrixWorld(true);
    visibility.prepare(camera, 8);
    expect(drawnMatrices(still)).toEqual([original[1], original[2]]);
    expect(drawnMatrices(windy)).toEqual([original[1], original[2]]);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "restores fog-clipped instances when opaque depth is %s without restoring frustum rejects",
    (opaqueFogDepth) => {
      const mesh = makeMesh([
        translation(0, 0, -12), translation(4, 0, -6), translation(0, 0, -6),
      ]);
      const original = drawnMatrices(mesh);
      const camera = makeCamera();
      const visibility = new ScatterVisibility();
      visibility.add(mesh, 0);
      visibility.prepare(camera, 8);
      expect(drawnMatrices(mesh)).toEqual([original[2]]);

      visibility.prepare(camera, opaqueFogDepth);

      expect(drawnMatrices(mesh)).toEqual([original[0], original[2]]);
    },
  );

  it.each([0, -1])("applies a finite opaque depth of %s", (opaqueFogDepth) => {
    const mesh = makeMesh([translation(0)]);
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);

    visibility.prepare(makeCamera(), opaqueFogDepth);

    expect(mesh.count).toBe(0);
  });

  it("reports registered sources and effective draw counts across fog, frustum and hidden meshes", () => {
    const inside = makeMesh([translation(-0.5, 0, -4), translation(0.5, 0, -4)]);
    const partial = makeMesh([
      translation(0, 0, -12), translation(0, 0, -4), translation(4, 0, -4),
    ]);
    const fogRejected = makeMesh([translation(0, 0, -12)]);
    // The aggregate crosses the view, but neither member does.
    const splitOutside = makeMesh([translation(-4, 0, -4), translation(4, 0, -4)]);
    const hidden = makeMesh([translation(0, 0, -4)]);
    hidden.visible = false;
    const hiddenByParent = makeMesh([translation(-0.5, 0, -4), translation(0.5, 0, -4)]);
    const parent = new THREE.Group();
    parent.visible = false;
    parent.add(hiddenByParent);
    parent.updateMatrixWorld(true);
    const empty = makeMesh([]);
    const registered = [inside, partial, fogRejected, splitOutside, hidden, hiddenByParent, empty];
    const versions = registered.map((mesh) => mesh.instanceMatrix.version);
    const visibility = new ScatterVisibility();
    for (const mesh of registered) visibility.add(mesh, 0);
    const camera = makeCamera();

    visibility.prepare(camera, 8);

    expect(visibility.getStats()).toEqual({
      registeredMeshes: 7, sourceInstances: 11, retainedInstances: 3,
      insideMeshes: 1, outsideMeshes: 5, matrixUploads: 1,
    });
    expect(registered.map((mesh, index) => mesh.instanceMatrix.version - versions[index]!))
      .toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(hidden.count).toBe(1);
    expect(hiddenByParent.count).toBe(2);

    visibility.prepare(camera, 8);
    expect(visibility.getStats().matrixUploads).toBe(0);
    visibility.prepare(camera);
    expect(visibility.getStats()).toEqual({
      registeredMeshes: 7, sourceInstances: 11, retainedInstances: 5,
      insideMeshes: 2, outsideMeshes: 4, matrixUploads: 1,
    });
  });

  it("counts only matrix writes during fog compaction, zero-count changes and full restoration", () => {
    const mesh = makeMesh([translation(0, 0, -12), translation(0, 0, -4)]);
    const original = drawnMatrices(mesh);
    const camera = makeCamera();
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);
    visibility.prepare(camera, 8);
    const compactedVersion = mesh.instanceMatrix.version;
    expect(visibility.getStats().matrixUploads).toBe(1);
    expect(visibility.getStats().insideMeshes).toBe(0);

    visibility.prepare(camera, 2);
    expect(mesh.count).toBe(0);
    expect(visibility.getStats().outsideMeshes).toBe(1);
    expect(visibility.getStats().matrixUploads).toBe(0);
    expect(mesh.instanceMatrix.version).toBe(compactedVersion);

    visibility.prepare(camera, 8);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);
    expect(visibility.getStats().matrixUploads).toBe(0);
    expect(mesh.instanceMatrix.version).toBe(compactedVersion);

    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual(original);
    expect(visibility.getStats()).toEqual({
      registeredMeshes: 1, sourceInstances: 2, retainedInstances: 2,
      insideMeshes: 1, outsideMeshes: 0, matrixUploads: 1,
    });
    expect(mesh.instanceMatrix.version).toBe(compactedVersion + 1);
    visibility.prepare(camera);
    expect(visibility.getStats().matrixUploads).toBe(0);
  });

  it("returns detached last-prepare stats and reports restored visible counts while disabled", () => {
    const zeroStats = {
      registeredMeshes: 0, sourceInstances: 0, retainedInstances: 0,
      insideMeshes: 0, outsideMeshes: 0, matrixUploads: 0,
    };
    const visibility = new ScatterVisibility();
    expect(visibility.getStats()).toEqual(zeroStats);
    const mesh = makeMesh([translation(0, 0, -12), translation(0, 0, -4)]);
    visibility.add(mesh, 0);
    expect(visibility.getStats()).toEqual(zeroStats);
    const camera = makeCamera();
    visibility.prepare(camera, 8);
    const snapshot = visibility.getStats();
    const completedStats = { ...snapshot };
    snapshot.retainedInstances = 999;
    expect(visibility.getStats()).toEqual(completedStats);

    const hidden = makeMesh([translation(-1), translation(0), translation(1)]);
    const parent = new THREE.Group();
    parent.visible = false;
    parent.add(hidden);
    parent.updateMatrixWorld(true);
    visibility.add(hidden, 0);
    visibility.setEnabled(false);
    expect(mesh.count).toBe(2);
    expect(visibility.getStats()).toEqual(completedStats);

    visibility.prepare(camera, -1);
    const disabledStats = {
      registeredMeshes: 2, sourceInstances: 5, retainedInstances: 2,
      insideMeshes: 0, outsideMeshes: 1, matrixUploads: 0,
    };
    expect(visibility.getStats()).toEqual(disabledStats);
    visibility.remove(mesh);
    expect(visibility.getStats()).toEqual(disabledStats);
    visibility.prepare(camera);
    expect(visibility.getStats()).toEqual({
      registeredMeshes: 1, sourceInstances: 3, retainedInstances: 0,
      insideMeshes: 0, outsideMeshes: 1, matrixUploads: 0,
    });
    visibility.clear();
    expect(visibility.getStats().registeredMeshes).toBe(1);
    visibility.prepare(camera);
    expect(visibility.getStats()).toEqual(zeroStats);
  });

  it.each([false, true])("preserves source geometry with existing bounds=%s", (hasBounds) => {
    const geometry = new THREE.BoxGeometry(2, 3, 1).translate(0.2, 0.3, -0.1);
    if (hasBounds) {
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    const sourceBox = geometry.boundingBox;
    const sourceSphere = geometry.boundingSphere;
    const box = sourceBox?.clone();
    const sphere = sourceSphere?.clone();
    const positions = Array.from(geometry.getAttribute("position").array);
    const indices = Array.from(geometry.index!.array);
    const mesh = makeMesh([translation(20), translation(0)], geometry);
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0.4);
    visibility.prepare(makeCamera());
    visibility.clear();

    expect(mesh.geometry).toBe(geometry);
    expect(Array.from(geometry.getAttribute("position").array)).toEqual(positions);
    expect(Array.from(geometry.index!.array)).toEqual(indices);
    expect(geometry.boundingBox).toBe(sourceBox);
    expect(geometry.boundingSphere).toBe(sourceSphere);
    if (box && sphere) {
      expect(sourceBox!.equals(box)).toBe(true);
      expect(sourceSphere!.equals(sphere)).toBe(true);
    }
  });

  it("restores the registered population immediately on disable, remove and clear", () => {
    const mesh = makeMesh([translation(20), translation(-1), translation(1, 0, 6)], undefined, 5);
    const other = makeMesh([translation(20), translation(0)]);
    const original = drawnMatrices(mesh);
    const originalBuffer = Array.from(mesh.instanceMatrix.array);
    const otherOriginal = drawnMatrices(other);
    const camera = makeCamera();
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);
    visibility.add(other, 0);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);

    visibility.setEnabled(false);
    expect(drawnMatrices(mesh)).toEqual(original);
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(originalBuffer);
    expect(drawnMatrices(other)).toEqual(otherOriginal);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual(original);
    visibility.setEnabled(true);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);

    visibility.remove(mesh);
    expect(drawnMatrices(mesh)).toEqual(original);
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(originalBuffer);
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual(original);
    expect(other.count).toBe(1);
    visibility.clear();
    expect(drawnMatrices(other)).toEqual(otherOriginal);
    visibility.prepare(camera);
    expect(drawnMatrices(other)).toEqual(otherOriginal);
  });

  it("leaves invisible meshes and hidden ancestors untouched until they are visible", () => {
    const mesh = makeMesh([translation(20), translation(-1), translation(1, 0, 6)]);
    const original = drawnMatrices(mesh);
    const parent = new THREE.Group();
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    const camera = makeCamera();
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0);
    visibility.prepare(camera);
    const version = mesh.instanceMatrix.version;
    camera.lookAt(0, 0, 1);
    camera.updateMatrixWorld(true);

    mesh.visible = false;
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);
    expect(mesh.instanceMatrix.version).toBe(version);
    mesh.visible = true;
    parent.visible = false;
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[1]]);
    expect(mesh.instanceMatrix.version).toBe(version);
    parent.visible = true;
    visibility.prepare(camera);
    expect(drawnMatrices(mesh)).toEqual([original[2]]);
  });

  it("keeps a zero-count population empty even when capacity contains matrices", () => {
    const mesh = makeMesh([translation(0)]);
    mesh.count = 0;
    const originalBuffer = Array.from(mesh.instanceMatrix.array);
    const visibility = new ScatterVisibility();
    visibility.add(mesh, 0.3);
    visibility.prepare(makeCamera());
    visibility.setEnabled(false);
    visibility.clear();
    expect(mesh.count).toBe(0);
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(originalBuffer);
  });

  it("rejects registrations that would lose shadow or per-instance data", () => {
    const mesh = makeMesh([translation(0)]);
    const visibility = new ScatterVisibility();
    mesh.castShadow = true;
    expect(() => visibility.add(mesh, 0)).toThrow();
    mesh.castShadow = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 0, 0]), 3);
    expect(() => visibility.add(mesh, 0)).toThrow();
    mesh.instanceColor = null;
    const texture = new THREE.DataTexture();
    mesh.morphTexture = texture;
    expect(() => visibility.add(mesh, 0)).toThrow();
    mesh.morphTexture = null;
    texture.dispose();
    mesh.geometry.setAttribute("variation", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
    expect(() => visibility.add(mesh, 0)).toThrow();
    mesh.geometry.deleteAttribute("variation");
    for (const margin of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => visibility.add(mesh, margin)).toThrow();
    }
    visibility.add(mesh, 0);
    expect(() => visibility.add(mesh, 0)).toThrow();
    expect(mesh.count).toBe(1);
  });
});
