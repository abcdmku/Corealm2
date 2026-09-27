/**
 * The albedo maps a creature model draws with, as PNGs, so the browser can recolor them or send
 * them to image generation as references. Contract: the actor-stage owner implements this.
 */
export interface AlbedoMap {
  /** The model's material name; skins key their maps by it. */
  material: string;
  width: number;
  height: number;
  png: Blob;
}

/**
 * The maps of `assetId` as the game would draw them: the model's own, or `skinId`'s where that skin
 * replaces a material. Materials without a colour map are left out.
 */
export async function albedoMaps(assetId: string, skinId?: string): Promise<AlbedoMap[]> {
  void assetId; void skinId;
  throw new Error('albedoMaps is not implemented yet');
}
