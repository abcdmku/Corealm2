# Corealm live server plan

This plan turns Corealm into a game that people can host, administer and edit while it runs. Read it top to bottom before starting. It states decisions that are final. Where it cites a file and line, check the reference first, because the code moves.

## Goal

When this plan is done:

- A player logs in once and can join any Corealm server. Each server keeps its own player data.
- A server owner runs one executable on Windows or headless Debian/Ubuntu. It shows live stats, with an optional TUI console.
- An admin logs in to devdocs, edits loot, spawns, creature models and settings on the live server, and sees player info and server stats. Loot changes apply on the next kill. Spawn changes apply on the next respawn. Model changes apply the next time a client loads.
- The client is a thin renderer in every mode. Local play runs the same server code in a Web Worker.
- The loading screen always shows a picker for local play or a server and world.
- Client assets come from a static asset host. Game servers serve no assets.

Agent training is out of scope. It comes after this plan, and it will pin a catalog revision and use disposable player databases, so nothing here may assume a single global database or an unversioned catalog.

## Current state

Corealm2 is a TypeScript browser game with an authoritative multiplayer server. Node 24 is required, as set in `.node-version` and the `engines` field in `package.json`.

Content is authored as JSON under `game/content/data/`. The compiler produces a server catalog, a client projection and a content `revision` hash. The base game version is separate: `package.json` `version` is strict semver and travels beside the catalog in the bundled seed. Changing that version alone does not change the content revision or the world-bake generation revision.

The server stores source collections, compiled catalogs, the active revision, base markers and the source snapshot for each base it has taken. An empty database takes the bundled base once. A later executable leaves an existing catalog alone and emits `base-update-available` when its bundled base differs. An admin can preview and apply a per-record three-way merge between the stored ancestor base, the server's current sources and the bundled base. The merge runs through the normal publish checks and tick barrier. At start the host compiles the active sources with its own compiler and refuses content it cannot run; `--apply-base-update` then runs the same preview and apply before any world starts.

The executable entry point is `tools/multiplayer-server.ts`. It loads the bundled world pack and base catalog, installs the active catalog before importing the simulation, and serves the game and admin endpoints. Accounts use the identity service's username and password pages. The server verifies signed join tokens offline, owns player leases and roles, and stores world and player data in SQLite. Each world can run in its own worker thread, with one database thread for the file.

The client is a renderer and input layer in every mode. Local play starts the same host core in a Web Worker over a MessagePort and persists through IndexedDB. Connected play uses the same session client over WebSocket. The picker exposes the server's catalog revision and base version, and all static game assets come from the selected asset host.

Devdocs has repository and server backends. Repository mode edits source JSON through the local Vite middleware. Server mode publishes through the authenticated admin API. The Base game screen previews and applies base updates, resolves record conflicts, reports stale or invalid requests, and warns when an update only moves the base marker; the focused server tests and bounded browser audit cover those paths.

CI checks pull requests, builds the game and guide for GitHub Pages, and provides manual content export and publish workflows. A server never starts a workflow, and an export is a deliberate backup or promotion step that a human reviews.

## Architecture

There are four deployable parts.

| Part | Owns |
|---|---|
| Identity service | Accounts and login. One per Corealm, run by the project owner. |
| Game server | Simulation, player data, content catalog, settings, admin list, admin API. One per host. |
| Asset host | Static files: client build, models, textures, audio, baked terrain and navmesh. |
| Devdocs | The admin and authoring UI. One app that works against the repo or against a live server. |

Identity is global. Player data, rules and admin rights belong to a server. A server runs one or more worlds. Worlds on the same server share player data and the content catalog, and a player only sees other players in their own world.

### Identity service

- A small Node 24 service in a new top-level `identity/` folder, using `node:sqlite` and `node:crypto`. It needs an HTTPS origin and CORS for the game and devdocs origins.
- Login uses username and password pages served by the identity origin. The service stores an scrypt password hash and never receives a password through the game or devdocs origin.
- An account has a stable id and a unique display name. Provider links are not part of this service.
- The service signs join tokens with Ed25519. Public keys are served at `/.well-known/corealm-keys.json` with key ids, so keys can rotate.
- A join token carries the account id, the display name, an audience, an expiry of 60 seconds, and a unique token id.
- The audience is the public endpoint origin of the game server the client is about to join. The client requests a fresh token for that endpoint before every join. A game server rejects any token whose audience is not its own configured public endpoint. This stops a hostile server from replaying a token against another server.

### Game server auth

- A new default `AuthenticationAdapter` verifies the join token signature, audience and expiry, and returns the account id as `playerId`. It fetches the identity public keys at start, caches them, and refetches on an unknown key id. It makes no network call per join.
- The guest adapter stays as a server option for LAN and offline servers. The `--auth-module` option stays for servers run from source.
- Roles are per server: `owner` and `admin`, stored in the server database by account id.
- On first start with no owner, the server prints a one-time setup code. A logged-in user enters it in devdocs to become owner. `COREALM_OWNER_ACCOUNT` sets the owner without the code.
- Bans are per server, by account id, with a reason and an optional expiry.
- Devdocs logs in by exchanging a join token at `POST /admin/session` for a server session token that lasts 12 hours. The server issues it only if the account holds a role.
- Admins create scoped API tokens in devdocs for automation. The server stores them hashed. Scopes are `content:read`, `content:publish`, `players:read`, `players:write` and `stats:read`.
- A static build never contains a secret. Credentials live in the server database, the identity service environment, and GitHub Actions secrets.

### Player data and worlds

- A server-level `players` table keyed by account id holds each player's character, inventory, bank, progression, last world and last position. World rows hold only world state.
- A player is live in exactly one world at a time. A `player_leases` table records which world holds each account, with an expiry that the holding world renews. Joining a world claims the lease. Leaving, disconnect timeout, or a world switch saves the player and releases it.
- Duplicate login rejection and the reconnect reservation move from per world to per server, built on the lease.
- A player who joins a different world than their last one spawns at that world's safe spawn point.
- All worlds on a server share one content catalog and one rule set. Worlds differ by id, name, seed and capacity.

### Content catalog

- The server database stores published catalogs as versioned rows keyed by revision hash, plus a pointer to the active revision. Each catalog and history row records `base_version` and `base_revision`; `catalog_bases` stores the source snapshot for every base the server has taken. The bundled base seeds an empty database. A deploy never overwrites a database that already has a catalog.
- A server owns its active source collections. A base update compares the stored ancestor base, the bundled base and those active sources record by record, then publishes the merged result after admin decisions.
- The compile step produces two outputs. The client catalog holds what rendering and UI need: presentation, names, icons, item stats. The server catalog holds everything, including loot rolls, AI parameters and spawn tables.
- `package.json` `version` is the base game version. It is strict semver and travels beside the catalog in the bundled seed, so changing the version alone does not change the content revision.
- The game server serves the client catalog at `GET /catalog/<revision>` with immutable caching.
- The join handshake exchanges the active revision hash. The client fetches that catalog if it isn't cached. `WORLD_CONTENT_VERSION` and the static client import of the catalog are deleted. Saves record the revision they were written under.
- Publish runs inside the server process. It validates and compiles, stores the new revision, calls `content.register()` with the new tables, clears `defCache`, and marks regions whose placements changed for a habitat rebuild. Living monsters stay where they are. Rebuilt habitats take effect at the next respawn.
- On publish, the server broadcasts a content-updated message. Clients show a refresh prompt.
- Rollback is a publish of an earlier stored revision.
- A base update whose merged sources equal the active revision still records a base marker move and audit entry, but does not swap the catalog or broadcast a refresh. A revision rollback cannot undo that marker-only move because the active revision did not change. To move the marker back, run the older executable and apply its bundled base with `allowDowngrade: true`; ordinary rollback restores the base recorded on its target revision.
- Removing a definition that has live instances is refused. Items in any inventory or bank, and creatures alive in any world, block removal. The author marks the definition retired instead. Retired definitions still resolve but no longer drop, spawn or sell.
- A server can only reference models that exist on the asset host it points at. Publish validates asset ids against that host's manifest.
- Balance formulas stay in TypeScript and ship with a server release. Data changes live, code changes need a deploy.

### Asset host

- The client takes its asset base URL from the selected server's descriptor. `WorldDescriptor` in `game/src/contracts.ts` carries `assetBaseUrl`, `catalogRevision` and the server's adopted `baseVersion`.
- Boot sets the existing `assetBaseUrl` override in `game/src/render/assets.ts`. Generated terrain and navmesh paths in `boot.ts` use the same base.
- GitHub Pages remains the default asset host. A host who wants custom models runs their own asset pack and points their server at it.

### Devdocs

- The API client gets a configurable base URL and an auth header. It has two backends behind one interface.
- Repo mode is the existing local Vite middleware that edits JSON files. It stays as the development workflow.
- Server mode talks to a game server's admin API and requires login. The content editing UI is the same in both modes.
- Server mode's **Base game** view reads the current and bundled base markers, previews the three-way merge, shows conflict sides and field differences, and sends per-record decisions with the preview's revision expectations. It shows the publish result, stale and validation failures, and the unchanged-content marker-only case. The HTTP endpoints remain the integration contract.
- The server executable embeds the server-mode build and serves it at `/admin`. The same build also works when hosted elsewhere, by asking for a server URL at login. Thumbnails and model previews load from the server's `assetBaseUrl`.
- The login screen signs in through the identity service, then exchanges for an admin session.
- A new `players` workspace lists players with last seen, playtime, world, position, inventory and bank. It supports edit, kick, ban and unban.
- Player edits go through the running server, never straight to the database. If the player is online, the server applies the change to the live player. If not, it applies it to the stored record. Every admin write adds a row to an `audit_log` table with account id, action, target, before, after and time.
- A new `server` workspace shows players online per world, tick time, stage timings, memory, bandwidth, uptime, active catalog revision, publish history with rollback, settings, roles and API tokens.
- Stats come from an authenticated `GET /admin/stats` endpoint that exposes the existing metrics object. `/healthz`, `/readyz` and `/worlds` stay public.

### Server executable

- Built as a Node 24 single executable application. esbuild bundles the server to one file, which is injected into the Node binary for `win-x64` and `linux-x64`.
- A build step bakes a server world pack with collision shapes, navmesh and habitat inputs. The server boots from the pack. It no longer parses GLB files and no longer depends on three or gltf-transform at runtime. The pack and the embedded devdocs build ship as SEA assets.
- A config file, `corealm-server.json`, sits next to the executable. It covers host, port, public endpoint, allowed origins, data directory, asset base URL, identity service URL, and the world list with id, name, seed and capacity. Flags and env vars override it. The hardcoded seed is removed.
- Default output is one JSON log line per event, suited to systemd and journald.
- `--tui` draws a live console with plain ANSI codes and no UI framework. It shows players online per world, tick time, memory, bandwidth, catalog revision, base version and recent events, redrawn once a second. It falls back to log lines when stdout is not a terminal.
- The Linux release includes a sample systemd unit.
- A release workflow builds both executables when a version tag is pushed and attaches them to a GitHub release.

### Client

- The loading screen always shows the picker: Play local, or a list of servers and then that server's worlds with live population and base version. Players can add a server by address. A public server directory is a JSON list the identity service serves, which servers register with.
- While the picker shows, the client preloads what every mode needs: terrain, models, shaders, navmesh and UI.
- The client runs no simulation in any mode. It keeps rendering, input, UI, interpolation and movement prediction.
- Local play starts `HeadlessWorld` in a Web Worker and connects to it through the same session interface the socket uses, over a message channel. The worker uses an IndexedDB storage adapter. Local play needs no login.
- Existing local saves are migrated once to the server's player and world record format.
- The final client keeps semantic world assembly for lab, bake and capture pages, while the authored game page reads baked records. `GameLoop.simTick()`, `LocalSession` and the old synchronous command path are gone. `CorealmGameApi` remains as a replica for page reads and as the executor hosts use for player commands. Feature-lab modes run in the same worker path.

### Scaling

- Each world moves to its own worker thread inside the server process. One thread owns the SQLite file and the world threads send it their writes.
- Running worlds on separate machines, with a gateway and a networked database, is not part of this plan. The lease model and the storage interface are what keep it possible later. Don't add anything that assumes all worlds share memory.

### CI

- An export workflow, manual only, uses a `content:read` API token from GitHub secrets to pull one server's source collections and open a pull request against `game/content/data/`. It writes with the canonical JSON writer in `tools/content/format.ts`.
- A publish workflow, manual only, uses a `content:publish` token to push the repo's content to a named server.
- Each server keeps its own database. Export is a backup or a reviewed promotion step, and no server starts it.

## Milestones

Do them in order. Each ends with a commit after its checks pass.

### M1. Baselines, config file, asset base URL

- Record boot span timings from `window.__corealmBootTelemetry` for a local session and a connected session, and write them to `docs/startup-performance.md`.
- Add `corealm-server.json` loading to `hostConfiguration.ts` with flag and env overrides. Move the seed into per-world config.
- Add `assetBaseUrl` to `WorldDescriptor` and wire it through boot.
- Done when the server starts from a config file and a client loads all assets from a different origin than the client build.

### M2. Identity service

- Build `identity/` with username and password accounts, Ed25519 signing, the keys endpoint, the join token endpoint and the server directory.
- Done when a test registers and signs in with a username and password, requests a token for an endpoint, and verifies signature, audience and expiry with only the published key.

### M3. Server accounts, players table, lease

- Add the token-verifying adapter and make it the default. Add client login and per-join token requests.
- Extract player records into the `players` table, add `player_leases`, and move duplicate login and reconnect handling to server level. Include a migration from the current world payload format.
- Add roles, the setup code, bans, `POST /admin/session`, API tokens, `audit_log` and `GET /admin/stats`.
- Done when one account joins two worlds on one server and sees the same inventory, a second simultaneous login is rejected, a token minted for another endpoint is rejected, and the stats endpoint returns 401 without a session.

### M4. Catalog in the database

- Split compile output into client and server catalogs. Store catalogs by revision and seed an empty database.
- Record the strict `package.json` semver as the base version beside the catalog. Keep each active revision's base version and base revision, store base source snapshots, migrate schema 3 databases, and log `base-update-available` when the bundled base differs.
- Add `GET /admin/content/base`, `GET /admin/content/base/sources`, `POST /admin/content/base/preview` and `POST /admin/content/base/apply`. Preview and apply use a canonical per-record three-way merge, require decisions for conflicts, validate the merged content, and apply through the normal publish barrier. A same-revision base move is an audited marker-only history move with no refresh.
- Add `GET /catalog/<revision>`, the revision handshake and the client fetch. Delete `WORLD_CONTENT_VERSION` and the static client catalog import.
- Add the publish endpoint with registry swap, `defCache` clear, habitat rebuild, the content-updated broadcast, rollback, the retire rule and asset id validation. Reuse the lock, revision check and compile gate from the devdocs `transact()` path.
- Done when a test publishes a loot change against a running server and the next kill rolls the new table with no restart, a spawn move takes effect at the next respawn, a rollback restores the old table, and removing an item that a player holds is refused.

### M5. Devdocs server mode

- Make the API client configurable with two backends. Add the login screen, the server-mode content editing path, and the `players` and `server` workspaces.
- The **Base game** view previews and resolves a base update, shows per-record conflict sides and decisions, handles stale and validation failures, and warns for an unchanged-content marker-only update.
- Serve the build from the game server at `/admin`.
- Done when an admin logs in, edits a loot table, publishes, sees the revision change in the `server` workspace, edits an online player's inventory and sees it change in the game client, and finds both actions in the audit log. The bounded server-mode audit also covers the Base game preview, resolved apply, stale preview, missing decisions, in-use record and invalid-content cases, with desktop and phone selector captures inspected. A non-admin account gets no admin session.

### M6. Server world pack and executables

- Bake the server world pack and boot the server from it. Remove three and gltf-transform from the server's runtime imports.
- Build the single executables, embed the pack and the devdocs build, add `--tui`, the JSON log lines, the systemd unit and the release workflow.
- Done when the Windows and Linux executables start from an empty folder with only a config file, accept a join, serve `/admin`, and show the TUI.

### M7. Thin client and worker local play

- Always show the picker. Preload shared assets behind it.
- Run local play as `HeadlessWorld` in a Web Worker with the IndexedDB adapter. Migrate local saves. Move the lab modes to the worker. Delete `simTick`, `LocalSession` and the synchronous command path. Remove the semantic world build, spawn prep and system construction from client boot.
- Done when local play and connected play use the same session code path, an old local save loads, and the connected boot timings beat the M1 baseline. Record the new numbers next to the old ones.

### M8. CI content workflows

- Add the export and publish workflows and document the secrets they need in `docs/multiplayer-hosting.md`.
- Done when a manual export run against a test server opens a pull request whose diff matches an edit made in devdocs.

### M9. Worker thread per world

- Move each world to its own thread with a single database owner thread.
- Done when `tools/multiplayer-capacity.ts` shows two loaded worlds ticking on separate cores, with tick times close to a single loaded world.

## Working rules for this repo

- Run focused checks while editing. After the round is complete, the root runs the combined gate and the hardware smoke test once.
- A file in the world-bake entry points' import graph can stale the baked world. Run `npm run world:build` when a bake input changes, then use `npx tsx tools/build-server-world-pack.ts --check` to verify the committed pack.
- Content schemas use the hand-rolled combinators in `game/src/content/schema/core.ts`. Don't add zod or another schema library.
- Devdocs UI uses Tailwind and the shadcn kit already in the app. Write no hand CSS. Run the devdocs consistency test and the surface-audit tool after UI work.
- The client build has enforced gzip budgets in `game/vite.config.ts`. Keep server-only code out of the client bundle, and keep the worker in its own chunk.
- Add no native dependencies to the server. They break the single executable build.
- Parse and validate all external input at the boundary: join messages, admin API bodies, config files and tokens.
- Update `docs/multiplayer-hosting.md`, `docs/architecture.md` and `docs/content-authoring.md` as the behavior they describe changes.

## Build notes

- M7 installs the generated client catalog before importing the app. A connected session overlays the server's client catalog by revision and removes it on leaving. Lab, bake and capture pages fetch the full server catalog in their worker path; it is not bundled into the player page.
- M4 compiles a publish on the tick thread. `compileCatalog` takes 85 to 120 ms on the shipped content, and it runs outside the tick hold, so it costs at most one late tick. No worker thread is used, and the M6 bundle needs no second entry for one. Revisit this if content grows several times over.
- Spawn placement still keeps its `SpawnContext` in `game/src/multiplayer/spawnPlan.ts`: floor heights, asset measurements, body rules, navmesh, door thresholds, terrain samples and tree trunks. The server world pack supplies those values without loading GLB files or a renderer.
- A publish does not re-run `registerHabitatClearances`. That step only feeds the tree scatter at world build, so trees stay where the boot catalog put them until the next start.
- The server checks asset ids against `assets/manifest.json`. The executable embeds the shipped manifest as a SEA asset and passes it as `assets.bundledManifest`.
- M7 deleted less of the client than the original plan promised. `GameLoop.simTick()`, the page's system ticks, `LocalSession`, the old save's load and autosave, `?local=main` and the static catalog import are gone. The synchronous `CorealmGameApi` stayed because a host runs every command through it: a page builds it as a replica that refuses synchronous writes. `Movement`, `Navigation` and `Solids` stay on the page for prediction, as do the read-side systems behind the API's read hooks. Semantic world build and spawn spreading stay reachable only from lab pages, the world bake and map capture; the authored game page reads the baked `assembly/semantic` and `spawns/world` records.
- M7's client catalog is installed by the entry before the app is imported, and it carries the quest journal fields the page reads. Completion predicates stay on the server. Feature-lab, bake and capture pages install the full catalog by fetch; nothing full is bundled.
- M7 found that the first-frame shader wait is a queue, not a list: the driver compiles programs in submission order, so the spell pools' programs are now submitted after the first frame rather than early, and a cast that beats them waits for its visual or, after 600 ms, goes without. See `docs/startup-performance.md` for the numbers.

- The browser smoke test is not part of CI. Headless Chromium on a hosted runner falls back to SwiftShader, which never reaches the first simulation tick of the authored world, so `docs.yml` carries a `smoke` job that stays skipped until the repository variable `COREALM_GPU_RUNNER` names a self-hosted runner with a GPU. It is run by hand on the hardware workstation instead: `npm run smoke -- --run runs/corealm --hardware`. The job is kept skipped rather than deleted or made `continue-on-error`, so nothing reports green over a gate nobody ran.
- The temporary `push` trigger on `live-server` and `.github/export-now` used to exercise `content-export.yml` before the branch merged have been removed. Content export and publish are manual-only workflows now.

- M9 runs a thread per world only when the server has more than one world, or when `threads` is `"on"`. One world in its own thread ticks no faster than one world in the main thread and pays for the messages, so `"auto"` leaves a one-world server as it was. A commit failure still fails the whole server closed; a world thread that dies does not, and is started again. The M4 note above about compiling a publish on the tick thread now reads: with threads on the compile runs on the main thread, which ticks nothing. The single executable starts its threads from a second copy of the bundle embedded as the asset `server.cjs`, because Node refuses the executable itself as a worker script; `docs/multiplayer-hosting.md` has the measurements under "Scaling on one machine".
- The save-recovery UI in the settings panel and the title screen is gone. M7 left it unreachable: nothing had passed `SaveRecoveryControls` since the client stopped loading a save. "Download my save" and "import a save" would be worth having, but the only `getSave`/`loadSave` path is the worker's debug channel, and inventing a player-facing one was not this pass's work. It is a follow-up idea, not a regression.
- M9's restart of a crashed world gives up. Five failures inside ten minutes leave the world unavailable with one `world.abandoned` log line, and `/admin/stats` marks it, because a world that dies seconds after every start will not be fixed by another try. A failure older than the window is forgotten.
- A base update that produces the active sources byte-for-byte records a real base marker move and audit entry without changing the catalog revision, swapping the registry or notifying clients. Revision rollback cannot undo that move. To restore only the base tracking, run the previous executable and apply its bundled base with `allowDowngrade: true`; the merge keeps server edits. Ordinary rollback restores the base recorded on its target revision.
- The Base game view in devdocs is implemented. The focused server tests and bounded browser audit cover preview, resolved apply, stale previews, missing decisions, in-use records and invalid content; the UI warns when the result is a marker-only move.
- The generation revision now follows the world-bake import graph, including the content compiler and the browser-side asset and cached-world inputs used by the bake drivers. `boot.ts` remains a conservative geometry input and unrelated UI imports are excluded. The world, navmesh and server pack were rebaked and passed the final integration checks on 2026-09-21; `docs/live-server-status.md` records the evidence and deployment limits.
- The base game version comes from `package.json` and must be strict semver. A release tag is `v<version>`, and `release.yml` rejects a mismatch. The version travels beside the catalog and does not change its content revision or bake hash by itself.
