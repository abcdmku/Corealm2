import type * as THREE from "three";

export type CoreArmorSlot = "head" | "body" | "legs" | "feet" | "hands";
export interface FitSection {
  readonly level: number;
  /** Cross-section center and counterclockwise outer samples in the perpendicular plane. */
  readonly center: readonly [number, number];
  readonly outline: readonly (readonly [number, number])[];
}
export interface ArmorBodyProfile {
  readonly source: string;
  readonly sourceSha256: string;
  readonly torso: readonly FitSection[]; // level Y, outline X/Z
  readonly head: readonly FitSection[]; // level Y, outline X/Z
  readonly leftLeg: readonly FitSection[]; // level Y, outline X/Z
  readonly leftArm: readonly FitSection[]; // level X, outline Y/Z
  readonly leftHand: readonly FitSection[]; // level X, outline Y/Z
  readonly leftFoot: readonly FitSection[]; // level Y, outline X/Z
}
export interface CoreArmorMaterials {
  shell: THREE.MeshStandardMaterial;
  edge: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  lining: THREE.MeshStandardMaterial;
  thread: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
}
export interface CoreArmorOptions {
  readonly body: ArmorBodyProfile;
  readonly materials: CoreArmorMaterials;
  /** Minor craftsmanship changes only; never change fit or overall mass between tiers. */
  readonly detail: 0 | 1 | 2;
}
/** Return native male bind-space geometry. Root adds item identity and exports native skin. */
export type CoreArmorBuilder = (slot: CoreArmorSlot, options: CoreArmorOptions) => THREE.Group;
