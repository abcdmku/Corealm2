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
- **Admin feature routes** plug into `createAdminApi({ routes })` (`AdminRoute`), one module each,
  under first segments listed in `ADMIN_API_SEGMENTS` (`files`, `meta`, `imagegen`). The store's
  admin API is `/admin/files`: `/admin/assets/` is the devdocs build's own folder.

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

## Wave 2 ownership

Contracts added: `CONTENT_MANIFEST_OVERLAY` (`assets/manifest.overlay.json`, extra manifest entries a
server adds) and image job kinds (`skin` | `icon`, `itemId`, `outputs`) in `devdocs/shared/skinContracts.ts`.

| Owner | Files |
| --- | --- |
| Image jobs | new `game/src/multiplayer/adminImagegen.ts`, a shared runner module moved out of `devdocs/server/handlers/imagegen.ts` (+ that handler, `skins.ts`, their tests), `serverBackend.ts`/`repoBackend.ts` imagegen parts, `workspaces/art/creatures/{SkinsPanel,skinApi}.tsx?` job UI |
| Models | manifest overlay merge in `render/assets.ts` (client) and the server's asset registry / footprints / publish pools, `dev/AssetCandidates.tsx` + a browser-side model measurement module, `workspaces/assets/**` upload UI |
| Item icons | new icon art module (256 master → 48 derivative, portable), icon job kind on top of the image jobs runner (coordinate), item icon panel in `workspaces/items/**`, icon provenance in item meta (`icon` block) |
| Server-side follow, bulk, checks | `multiplayer/contentSwap.ts` (server refreshers for npcs, quests, spells, sets, fuels), `catalogHost.ts` applies, bulk actions client-side via `patchMeta` + `transact` (retire `/__devdocs/bulk`), thumbnail cache via `putFiles`, publish check for `audio/` paths |

## Wave 3 design (world geometry)

Scoping (September 27): nothing in the world bake computes on the GPU. Chromium hosts two bakes only
because they run `boot.ts`; the server pack already bakes in Node (about 40 s). Plan:

1. `geometryRevision(catalog)`: a hash of the code revision plus the geometry views of `world`,
   `worldTerrain`, `resources`, `items` and creature presentation, with a narrowness test.
2. The server loads `<data>/world/<geometryRevision>.pack` when it matches the active catalog, else the
   embedded pack, and says which.
3. A baker bundle the server spawns as a child process (three, gltf-transform, recast, `bake/`),
   fetching GLBs from the asset host and the server's model overlay; writes the pack.
4. A Node port of the world-record bake (terrain, assembly, spawns, site cuts, scatter tiles) with a
   parity test against the Chromium bake. Highest risk: scatter signature parity.
5. Clients take the navmesh from the pack's navData with the fingerprint the server names.
6. The file store accepts `generated/world/*.world`, `generated/world/manifest.json`,
   `generated/corealm-navmesh.nav` (per-file cap about 32 MiB).
7. `WorldDescriptor` gains `worldRevision` / `worldDataUrl`; joining a world whose geometry differs
   from the build reloads onto it, and the entry installs the server's catalog before boot builds terrain.
8. Publish: tables that change geometry start a bake job (status in devdocs); on success the server
   restarts each world on the new pack, snaps saved positions to the new navmesh and tells clients to
   reload. The last good revision stays until the new one passes the release gates.
9. `CATALOG_TABLE_APPLIES` / `CLIENT_TABLE_FOLLOWS` get a `rebake` state for `worldTerrain`, regions
   and resource placements. The world map image stays stale until regenerated; devdocs says so.

## Wave 3 ownership

Contracts: `game/src/world/serverWorldContract.ts` (geometry revision, bake record, `GEOMETRY_TABLES`),
`WorldDescriptor.worldRevision`, file store `generated/world/*.world|manifest.json`,
`generated/corealm-navmesh.nav` (32 MiB cap).

| Owner | Files |
| --- | --- |
| Node world bake | new `game/src/world/bake/nodeWorldBake.ts` (+ helpers under `game/src/world/bake/`), the pack-to-client navmesh export, parity tests `tests/node-world-bake-*.test.ts` |
| Server bake jobs | new `game/src/multiplayer/serverWorldBake.ts`, `adminWorld.ts` (`/admin/world`), baker child process + its bundle in `tools/build-server-exe.ts`, pack-per-revision loading (`worldPack.ts` loader, `contentAtStart.ts`), `contentAssets.ts` size cap, a small hook in `contentPublish.ts`, world restart and position snap, tests `tests/server-world-bake-*.test.ts` |
| Client reload | `protocol.ts`, `playIntent.ts`, `browserSession.ts`, `app/config.ts`, `app/contentAssetOverlay.ts`, `content/catalogEntry.ts`, `world/shippedWorldData.ts`, navmesh fingerprint in `systems/navigation.ts`, minimal `app/boot.ts`, tests `tests/client-world-reload-*.test.ts` |
| Devdocs + applies | World workspace bake status, save bar "world rebake" state, map staleness note (`devdocs/src/workspaces/world/**`, `ui/ShellSaveBar.tsx`, `api/serverBackend.ts` bake reads), `catalogHost.ts` / `clientContentSwap.ts` `rebake` state, tests `tests/devdocs-world-bake-*.test.ts` |
