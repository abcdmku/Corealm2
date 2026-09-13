import type * as THREE from 'three';

/** Frozen for the Starhide authoring round. Native male bind-space meters, Y up, +Z front.
 * Each builder returns a group. Materials are immutable shared inputs; clone before changing UV repeats.
 * All image maps must be byte DataTexture objects for the production item exporter.
 */
export interface StarhideMaterials {
  cloth: THREE.MeshStandardMaterial;
  scales: THREE.MeshStandardMaterial;
  silver: THREE.MeshStandardMaterial;
  lining: THREE.MeshStandardMaterial;
  gem: THREE.MeshStandardMaterial;
  sole: THREE.MeshStandardMaterial;
  thread: THREE.MeshStandardMaterial;
}
export type StarhideBuilder = (materials: StarhideMaterials) => THREE.Group;
