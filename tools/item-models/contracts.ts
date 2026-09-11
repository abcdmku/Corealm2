import type * as THREE from "three";

/** Frozen author interface. Pure geometry builders; no publication or file I/O.
 * A wearable Mesh may set userData.itemModelBone to a native bone name for a rigid plate.
 * Its attached rivets/borders must use the same bone. Unmarked cloth retains blended skinning.
 */
export interface ItemModelAuthor {
  readonly ids: readonly string[];
  build(itemId: string): THREE.Group;
}

/** Meters, Y-up, +Z front. Worn geometry uses the native male full-body T-pose. */
export interface ItemModelMetadata {
  readonly itemId: string;
  readonly author: string;
  readonly reference: string;
  readonly description: string;
  readonly grip?: readonly [number, number, number];
  readonly focus?: readonly [number, number, number];
  readonly wearable?: boolean;
  /** Bare anatomy replaced by this item's continuous lining, in native bind-space meters. */
  readonly bodyCoverage?: readonly { readonly region: "torso" | "legs"; readonly minY: number; readonly maxY: number }[];
  readonly fishing?: {
    readonly lineGuide: readonly [number, number, number];
    readonly crankAnchor: readonly [number, number, number];
    readonly line: number;
    readonly bobber: number;
  };
}

/** Put this metadata in root.userData.itemModel; every mesh/material must have a useful name. */
export function metadata(group: THREE.Group): ItemModelMetadata {
  const value = group.userData["itemModel"] as ItemModelMetadata | undefined;
  if (!value?.itemId || !value.author || !value.reference || !value.description) {
    throw new Error("Item model lacks author/reference metadata");
  }
  return value;
}
