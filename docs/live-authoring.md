# Live authoring

September 27, 2026. Goal: the whole game is authored from devdocs, on a live server's `/admin` as
well as in the repository editor. Anything that works in the repo editor and not on a server is a
gap to close, except one boundary kept on purpose: formula **source** is code, and a web page must
not change a server's code. Formula parameters (families, templates, roles, balance tables) are
content and stay editable.

## Gaps found (audit, September 27)

1. A server has nowhere to store a new file: skin PNG, icon, model, audio.
2. Joined clients apply only items, recipes, resources, spells, enemies and shops from the server's
   catalog. Skins, NPCs, quests, dialogue, audio, sets, progression and terrain stay at the build.
3. Skins, uploads and image generation call repo-only endpoints and are not gated.
4. Devdocs in server mode runs the stage, thumbnails and derived numbers on its bundled catalog.
5. World geometry (terrain, navmesh, collision, map tiles) cannot change from a server.
6. Notes, requests and art verdicts have no server store; verdict bars are enabled and fail.
7. Publish never checks skin maps, item icons or audio paths.
8. Bulk actions, asset candidates (models, icons) and thumbnail caching are repo-only.
9. A publish carries no note.

## Design

- **Server asset store** (`multiplayer/contentAssetsContract.ts`): files in the server's data
  directory under the same `assets/...` paths the base uses, served at `/content-assets/<path>` with
  an index. The world descriptor's `contentAssetUrl` points clients at it; a path in the index wins
  over the asset host. Publish validation checks the union.
- **Clients apply the whole client catalog** on join and on every `content-updated`, and restore the
  build's tables on leave.
- **Devdocs is backend-neutral**: pages call `backend().patchMeta`, `putFiles` and `imagegen`, gated
  by the `meta`, `files` and `imagegen` capabilities. Repo mode writes the checkout; server mode
  writes the server.
- **Admin feature routes** plug into `createAdminApi({ routes })` (`AdminRoute`), one module each.

## Waves

1. Asset store and client resolution; full client catalog; server metadata store; devdocs server
   mode adopts the live catalog, sends publish notes, gates what it cannot do yet.
2. Skins, uploads and image generation on a server; model and icon upload with manifest overlay and
   measurements; bulk actions; thumbnail cache in the asset store; publish checks file paths.
3. World geometry: a server-side bake of terrain, navmesh and pack for a published world revision,
   with the generated tiles served from the asset store.

## Wave 1 ownership

| Owner | Files |
| --- | --- |
| Root | contracts (`adminApi.ts` hook, `contentAssetsContract.ts`, `contracts.ts` descriptor field, `devdocs/src/api/backend.ts`), `tools/multiplayer-server.ts` wiring, this doc |
| Asset store | new `game/src/multiplayer/contentAssets.ts`, `referenceServer.ts` (public routes, descriptor), `protocol.ts` descriptor parse, `assetManifest.ts`/asset host pools, client resolution in `game/src/render/assets.ts`, `ui/itemIcons.ts`, `render/creatureSkins.ts` map URLs, audio URL resolution, `app/config.ts` asset base helpers, tests `tests/content-assets-*.test.ts` |
| Client catalog | `game/src/content/clientCatalog.ts`, `clientCatalogOverlay.ts`, the client join/refresh path that calls it, `catalogHost.ts` `CATALOG_TABLE_APPLIES`, tests `tests/client-catalog-*.test.ts` |
| Metadata | new `game/src/multiplayer/adminMeta.ts`, `adminStorage.ts` (table), a shared pure meta-operation module, devdocs callers (`dev/NotesPanel.tsx`, `dev/SetPiecePanel.tsx`, `dev/BulkActionsPanel.tsx`, `model/artReview.ts`, `pages/EntityDetail.tsx`, `pages/CollectionPage.tsx` meta reads), tests `tests/admin-meta-*.test.ts` |
| Devdocs server mode | `devdocs/src/api/serverBackend.ts`, `repoBackend.ts`, `model/liveCatalog.ts`, `ui/ShellSaveBar.tsx`, `viewer/registry.ts`, `workspaces/art/**` gating, `devdocs/server/plugin.ts` + new `devdocs/server/handlers/files.ts` (repo `putFiles`) |
