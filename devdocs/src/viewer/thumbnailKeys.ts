/** Thumbnail keys for creature definitions share the asset thumbnail cache and hooks. */
export const CREATURE_THUMBNAIL_KEY = 'creature:';

/**
 * The key that asks the installed thumbnail provider for a creature definition's picture: its model
 * drawn through the game's EntityViews at the definition's scale, tier tint and dye, standing in idle.
 * Use it wherever an asset id goes: `useAssetThumbnail(creatureThumbnailKey(id))`, or
 * `<Thumb spec={{ kind: 'asset', assetId: creatureThumbnailKey(id), icon, hue }} />`.
 * Kept apart from thumbnailRenderer.ts so a view can build keys without loading the renderer.
 */
export function creatureThumbnailKey(creatureId: string): string { return `${CREATURE_THUMBNAIL_KEY}${creatureId}`; }
