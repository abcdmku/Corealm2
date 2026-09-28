/**
 * A server's own files: the textures, icons, models and audio its authors add from devdocs.
 *
 * The base game's files come from the asset host (the Pages build). A server that authors new ones
 * keeps them in its data directory and serves them itself, under the SAME relative paths the base
 * uses (`assets/skins/<asset>/<skin>/<material>.png`, `assets/icons/items/48/<item>.png`,
 * `audio/sfx/...`).
 * A client resolves a path against this server's index first and the asset host second, so a
 * server file can add a path or replace a base one.
 *
 * Routes (see `contentAssets.ts`):
 *   GET    /content-assets/index.json          ContentAssetIndex         public, CORS *
 *   GET    /content-assets/<path>               the file                  public, CORS *, immutable per sha
 *   GET    /admin/files                         ContentAssetIndex         content:read
 *   POST   /admin/files     PutContentAssets    ContentAssetIndex         content:publish
 *   DELETE /admin/files     { paths: string[] } ContentAssetIndex         content:publish
 *
 * (`/admin/assets/` is the devdocs build's own folder, so the API is `/admin/files`.)
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

/**
 * Models a server adds: extra `assets/manifest.json` entries, stored as this one file. A client's and
 * the server's asset registry merge it over the host manifest by id (an entry here wins), and a
 * publish accepts its ids. Entries carry the same measurements the build writes (size, bounds,
 * groundY, animations, materials, clip timings), measured when the model is uploaded.
 */
export const CONTENT_MANIFEST_OVERLAY = "assets/manifest.overlay.json";
export interface ContentManifestOverlay { assets: readonly import("../render/assets.js").AssetEntry[] }

/** Base64 file contents by path. */
export interface PutContentAssets { files: Record<ContentAssetPath, string> }

/** Where a server-authored file may live, and what it may be. */
// Audio lives at the public root (`audio/...`) in the base, everything else under `assets/`.
// A segment never starts with a dot, so `.` and `..` cannot appear.
export const CONTENT_ASSET_PATH = /^(?:assets\/manifest\.overlay\.json$|(?:assets\/(?:skins|icons|models|textures|thumbnails|vfx)|audio)\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpg|jpeg|webp|glb|ogg|mp3|wav|json)$)/;
