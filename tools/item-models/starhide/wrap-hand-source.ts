import * as THREE from 'three';
import hand from './wrap-hand-data.json';

/**
 * Close-fitting glove shell extracted from the production male's native hand.
 * The stored left hand is in native bind space, expanded 1.8 mm from skin and
 * clipped at X = 0.694 m. Keeping the original finger topology preserves the
 * knuckles, webbing and fingertip proportions when native weights are applied.
 */
export function createWrapHandShell(
  side: 1 | -1,
  material: THREE.MeshStandardMaterial,
): THREE.Mesh {
  const positions = new Float32Array(hand.positions);
  const normals = new Float32Array(hand.normals);
  const indices = [...hand.indices];
  if (side === -1) {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = -positions[i]!;
      normals[i] = -normals[i]!;
    }
    for (let i = 0; i < indices.length; i += 3) {
      const second = indices[i + 1]!;
      indices[i + 1] = indices[i + 2]!;
      indices[i + 2] = second;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(hand.uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `starhide-wrap-${side === 1 ? 'left' : 'right'}-hand-shell`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.itemModelDeform = 'native-hand';
  mesh.userData.handSide = side === 1 ? 'left' : 'right';
  mesh.userData.nativeSurfaceOffset = hand.surfaceOffset;
  return mesh;
}
