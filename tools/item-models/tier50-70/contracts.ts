import type * as THREE from 'three';

export type ArmorTheme = 'dragonhide' | 'starhide';
export interface ArmorMaterials {
  cloth: THREE.MeshStandardMaterial;
  scales: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  lining: THREE.MeshStandardMaterial;
  gem: THREE.MeshStandardMaterial;
  sole: THREE.MeshStandardMaterial;
  thread: THREE.MeshStandardMaterial;
  /** Solid pebbled scute variants for actual overlapping plate geometry. */
  scutes: readonly THREE.MeshStandardMaterial[];
}
/** Native male rest space, metres, Y up, +Z forward. Immutable shared materials. */
export type ArmorBuilder = (theme: ArmorTheme, materials: ArmorMaterials) => THREE.Group;
export type Surface = (u: number, v: number) => THREE.Vector3;
export interface ScaleFieldOptions {
  columns: number;
  rows: number;
  /** Tip points toward decreasing V by default. */
  reverse?: boolean;
  /** Native skin hint shared by plates and their decoration. */
  deform?: 'skirt' | 'native-hand';
  bone?: string;
  lift?: number;
  seed?: number;
}
