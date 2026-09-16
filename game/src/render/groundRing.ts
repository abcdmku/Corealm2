import * as THREE from 'three';

/** A hollow, feathered ground marking. Vertex alpha keeps it texture-free. */
export function groundRingGeometry(radius: number, width = 0.075): THREE.RingGeometry {
  const inner = Math.max(0.01, radius - width / 2);
  const geometry = new THREE.RingGeometry(inner, radius + width / 2, 64, 3);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colour = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    const row = Math.floor(i / 65);
    colour.set([1, 1, 1, row === 0 || row === 3 ? 0 : 1], i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 4));
  return geometry;
}

/** Project onto the same height surface used by movement, including other maps and interiors. */
export function seatGroundRing(mesh: THREE.Mesh, origin: THREE.Vector3,
  heightAt: (x: number, z: number, referenceY: number) => number): void {
  const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const y = heightAt(origin.x + positions.getX(i), origin.z + positions.getZ(i), origin.y);
    positions.setY(i, (Number.isFinite(y) ? y : origin.y) - origin.y + 0.025);
  }
  positions.needsUpdate = true;
  mesh.frustumCulled = false;
}
