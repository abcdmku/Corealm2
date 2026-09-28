/**
 * A server's own files: the textures, icons, models and audio its authors add from devdocs.
 *
 * The base game's files come from the asset host (the Pages build). A server that authors new ones
 * keeps them in its data directory and serves them itself, under the SAME relative paths the base
 * uses (`assets/skins/<asset>/<skin>/<material>.png`, `assets/icons/items/48/<item>.png`, ...).
 * A client resolves a path against this server's index first and the asset host second, so a
 * server file can add a path or replace a base one.
 *
 * Routes (see `contentAssets.ts`):
 *   GET    /content-assets/index.json          ContentAssetIndex         public, CORS *
 *   GET    /content-assets/<path>               the file                  public, CORS *, immutable per sha
 *   GET    /admin/assets                        ContentAssetIndex         content:read
 *   POST   /admin/assets    PutContentAssets    ContentAssetIndex         content:publish
 *   DELETE /admin/assets    { paths: string[] } ContentAssetIndex         content:publish
 *
 * The world descriptor names where the index lives (`WorldDescriptor.contentAssetUrl`).
 */

/** A path under the game's public tree, such as `assets/skins/animal_deer/frost/coat.png`. */
export type ContentAssetPath = string;

export interface ContentAssetEntry {
  sha256: string;
  bytes: number;
  /** MIME type, from the extension. */
  type: string;
  /** ISO time the file was stored. */
  at: string;
}

export interface ContentAssetIndex {
  /** Changes whenever a file is added, replaced or removed. */
  revision: string;
  files: Readonly<Record<ContentAssetPath, ContentAssetEntry>>;
}

/** Base64 file contents by path. */
export interface PutContentAssets { files: Record<ContentAssetPath, string> }

/** Where a server-authored file may live, and what it may be. */
export const CONTENT_ASSET_PATH = /^assets\/(?:skins|icons|models|audio|textures|thumbnails)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp|glb|ogg|mp3|wav|json)$/;
