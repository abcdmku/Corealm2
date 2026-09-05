import * as THREE from "three";

/** Maximum displacement of the wind shader after an instance's linear transform. */
export function scatterWindMargin(matrix: THREE.Matrix4, strength: number): number {
  if (strength === 0) return 0;
  const elements = matrix.elements;
  let maximumSquared = 0;
  // Each sine is in [-1, 1]. A linear transform maps their possible bends to a
  // parallelogram, whose farthest point from the origin is one of these corners.
  for (const main of [-1, 1]) {
    for (const ripple of [-1, 1]) {
      const localX = 0.86 * main - 0.22 * ripple;
      const localZ = 0.51 * main + 0.37 * ripple;
      const x = elements[0]! * localX + elements[8]! * localZ;
      const y = elements[1]! * localX + elements[9]! * localZ;
      const z = elements[2]! * localX + elements[10]! * localZ;
      maximumSquared = Math.max(maximumSquared, x * x + y * y + z * z);
    }
  }
  return Math.sqrt(maximumSquared) * Math.abs(strength);
}

/** Bounds static instances and their wind motion without changing their geometry or matrices. */
export function finalizeScatterBounds(mesh: THREE.InstancedMesh, windMargin: number): void {
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  const box = mesh.boundingBox!;
  const sphere = mesh.boundingSphere!;
  if (mesh.count === 0 || box.isEmpty()) {
    box.makeEmpty();
    sphere.makeEmpty();
    return;
  }

  const margin = Math.max(0, windMargin);
  box.expandByScalar(margin);
  sphere.radius += margin;
  const boxSphere = box.getBoundingSphere(new THREE.Sphere());
  // THREE unions each instance sphere in sequence. The sphere of the final box
  // can be tighter, especially for large, flat tiles. Both enclose all instances.
  const sphereValid = Number.isFinite(sphere.radius) && sphere.radius >= 0;
  const boxSphereValid = Number.isFinite(boxSphere.radius) && boxSphere.radius >= 0;
  if (boxSphereValid && (!sphereValid || boxSphere.radius < sphere.radius)) {
    sphere.copy(boxSphere);
  }
}
