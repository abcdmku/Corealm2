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

Corealm2 is a TypeScript browser game with an authoritative multiplayer server. Node 24 is required, set in `.node-version` and `package.json` engines.

Content:

- Authored content is JSON in `game/content/data/*.json`. `tools/content/compile.ts` compiles it to `game/content/compiled/catalog.json`, which holds `version`, a content hash named `revision`, and `tables`.
- Server and client both import that catalog statically at build time through `game/src/content/resolvedCatalog.ts`. Nothing reads content at runtime from a file or database. The client chunk for it is about 2.8 MB.
- `WORLD_CONTENT_VERSION` in `game/src/contracts.ts` is a hand-edited string. The server rejects joins and saves that don't match it. Nothing checks `revision` at runtime.
- The compile step flattens loot tables onto each enemy def as `lootRolls`. `CombatSystem.rollDrops` in `game/src/systems/combat.ts` reads them from the in-memory `ContentRegistry`, with a per-entity `defCache` in front.
- Spawn habitats are computed once at world boot by `createAuthoredWorld` in `game/src/multiplayer/authoredWorld.ts`, from the compiled world table, then adjusted by `prepareMobSpawns`.
- Balance formulas are TypeScript under `game/src/content/formulas/` and run during compile.

Server:

- Entry point is `tools/multiplayer-server.ts`, run with `tsx`. The server logic is `game/src/multiplayer/referenceServer.ts`, which uses `node:http` and the `ws` package.
- Storage is `node:sqlite` in `game/src/multiplayer/sqliteStorage.ts`. Tables are `worlds`, `world_chunks`, `world_receipts` and `world_entities`, all keyed by `world_key`. There is no players table. Player state lives inside each world's payload.
- One process hosts several worlds, and all of them tick on one thread.
- Identity is an opaque token on the join message, resolved by an `AuthenticationAdapter` with one method, `authenticate(token, world)`, which returns `playerId` and `name`. Two adapters exist: loopback-only guests, and an external module loaded with `--auth-module`. There are no accounts, roles, bans or admin concepts.
- `game/src/multiplayer/admission.ts` handles capacity, duplicate login rejection and a 30 second reconnect reservation, per world.
- Config is flags and env vars in `game/src/multiplayer/hostConfiguration.ts`. There is no config file. The seed is hardcoded to 1337 in `tools/multiplayer-server.ts`.
- Public endpoints are `/healthz`, `/readyz` and `/worlds`. A metrics object in `referenceServer.ts` collects tick durations, stage timings, commands, rejects and bytes out, but no endpoint exposes it.
- `createAuthoredWorld` reads GLB files from `game/public/assets` relative to the working directory, through three and gltf-transform, to get collision geometry. The server only starts from the repo root.
- The recast navigation wasm is base64-embedded under Node, so it needs no sidecar file.

Client:

- `game/src/app/boot.ts` builds the full semantic world, spawn prep, save load and all simulation systems before the player chooses a mode. On connect, `game/src/multiplayer/browserSession.ts` turns the simulation off with `loop.setRemoteSimulation(true)` and discards the local world state.
- Local play steps the systems on the main thread through `GameLoop.simTick()` in `loop.ts`, with commands through `LocalSession` and the synchronous `CorealmGameApi`. This is a second orchestrator next to the server's `HeadlessWorld`, over the same system classes. There are no Web Workers.
- Connected play already has movement prediction in `game/src/multiplayer/movementPrediction.ts` and needs the navmesh for it.
- The world picker in `game/src/multiplayer/worldSelector.ts` only appears when a host is configured through `window.__COREALM_MULTIPLAYER__` or added by the player. With no hosts the game goes local with no picker.
- `ASSET_BASE_URL` and `ASSET_MANIFEST_URL` in `game/src/app/config.ts` are relative constants. `game/src/render/assets.ts` accepts an `assetBaseUrl` override that nothing sets.
- Boot phases are timed in `game/src/perf/bootTelemetry.ts` and exposed on `window.__corealmBootTelemetry`.

Devdocs:

- A React and Vite app in `devdocs/` with workspaces `home`, `items`, `creatures`, `world`, `quests`, `npcs`, `shops`, `spells`, `assets` and `tuning`, registered in `devdocs/src/workspaces/registry.ts`.
- All API calls go through `devdocs/src/api/client.ts`, which hardcodes the `/__devdocs/` path. The API is a Vite dev middleware in `devdocs/server/`. Its only access control is a loopback check.
- Writes go through `transact()` in `devdocs/server/handlers/transaction.ts`. It takes a lock, checks per-collection revisions, runs the full compile, returns 422 if the compile fails, and writes the JSON files and the catalog atomically.
- A `--mode player` build produces the read-only player guide from a prebuilt bundle.

CI:

- One workflow, `.github/workflows/docs.yml`. It verifies pull requests and deploys the game and player guide to GitHub Pages. It uses no secrets.

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
- Login is OAuth only, with Discord and GitHub as the first providers. The service stores no passwords.
- An account has a stable id, a unique display name, and linked provider ids.
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

- The server database stores published catalogs as versioned rows keyed by revision hash, plus a pointer to the active revision. The catalog compiled from the repo seeds an empty database. A deploy never overwrites a database that already has a catalog.
- A server's content is the base catalog plus that server's overrides. Publishing compiles the merged result and stores it under its own revision.
- The compile step produces two outputs. The client catalog holds what rendering and UI need: presentation, names, icons, item stats. The server catalog holds everything, including loot rolls, AI parameters and spawn tables.
- The game server serves the client catalog at `GET /catalog/<revision>` with immutable caching.
- The join handshake exchanges the active revision hash. The client fetches that catalog if it isn't cached. `WORLD_CONTENT_VERSION` and the static client import of the catalog are deleted. Saves record the revision they were written under.
- Publish runs inside the server process. It validates and compiles, stores the new revision, calls `content.register()` with the new tables, clears `defCache`, and marks regions whose placements changed for a habitat rebuild. Living monsters stay where they are. Rebuilt habitats take effect at the next respawn.
- On publish, the server broadcasts a content-updated message. Clients show a refresh prompt.
- Rollback is a publish of an earlier stored revision.
- Removing a definition that has live instances is refused. Items in any inventory or bank, and creatures alive in any world, block removal. The author marks the definition retired instead. Retired definitions still resolve but no longer drop, spawn or sell.
- A server can only reference models that exist on the asset host it points at. Publish validates asset ids against that host's manifest.
- Balance formulas stay in TypeScript and ship with a server release. Data changes live, code changes need a deploy.

### Asset host

- The client takes its asset base URL from the selected server's descriptor. `WorldDescriptor` in `game/src/contracts.ts` gains `assetBaseUrl` and `catalogRevision`.
- Boot sets the existing `assetBaseUrl` override in `game/src/render/assets.ts`. Generated terrain and navmesh paths in `boot.ts` use the same base.
- GitHub Pages remains the default asset host. A host who wants custom models runs their own asset pack and points their server at it.

### Devdocs

- The API client gets a configurable base URL and an auth header. It has two backends behind one interface.
- Repo mode is the existing local Vite middleware that edits JSON files. It stays as the development workflow.
- Server mode talks to a game server's admin API and requires login. The content editing UI is the same in both modes.
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
- `--tui` draws a live console with plain ANSI codes and no UI framework. It shows players online per world, tick time, memory, bandwidth, catalog revision and recent events, redrawn once a second. It falls back to log lines when stdout is not a terminal.
- The Linux release includes a sample systemd unit.
- A release workflow builds both executables when a version tag is pushed and attaches them to a GitHub release.

### Client

- The loading screen always shows the picker: Play local, or a list of servers and then that server's worlds with live population. Players can add a server by address. A public server directory is a JSON list the identity service serves, which servers register with.
- While the picker shows, the client preloads what every mode needs: terrain, models, shaders, navmesh and UI.
- The client runs no simulation in any mode. It keeps rendering, input, UI, interpolation and movement prediction.
- Local play starts `HeadlessWorld` in a Web Worker and connects to it through the same session interface the socket uses, over a message channel. The worker uses an IndexedDB storage adapter. Local play needs no login.
- Existing local saves are migrated once to the server's player and world record format.
- When this lands, the semantic world build, spawn prep, save load and system construction leave the client boot path. `GameLoop.simTick()`, `LocalSession` and the synchronous command path of `CorealmGameApi` are deleted. The feature lab modes in `game/src/app/bootProfile.ts` move to a lab variant of the worker in the same milestone.

### Scaling

- Each world moves to its own worker thread inside the server process. One thread owns the SQLite file and the world threads send it their writes.
- Running worlds on separate machines, with a gateway and a networked database, is not part of this plan. The lease model and the storage interface are what keep it possible later. Don't add anything that assumes all worlds share memory.

### CI

- An export workflow, manual and scheduled, uses a `content:read` API token from GitHub secrets to pull the live server's source collections and open a pull request against `game/content/data/`. It writes with the canonical JSON writer in `tools/content/format.ts`.
- A publish workflow, manual only, uses a `content:publish` token to push the repo's content to a named server.
- Once a server is live, it is the source of truth for its data. The repo receives exports.

## Milestones

Do them in order. Each ends with a commit after its checks pass.

### M1. Baselines, config file, asset base URL

- Record boot span timings from `window.__corealmBootTelemetry` for a local session and a connected session, and write them to `docs/startup-performance.md`.
- Add `corealm-server.json` loading to `hostConfiguration.ts` with flag and env overrides. Move the seed into per-world config.
- Add `assetBaseUrl` to `WorldDescriptor` and wire it through boot.
- Done when the server starts from a config file and a client loads all assets from a different origin than the client build.

### M2. Identity service

- Build `identity/` with OAuth for Discord and GitHub, accounts, Ed25519 signing, the keys endpoint, the join token endpoint and the server directory.
- Done when a test logs in with a stubbed provider, requests a token for an endpoint, and verifies signature, audience and expiry with only the published key.

### M3. Server accounts, players table, lease

- Add the token-verifying adapter and make it the default. Add client login and per-join token requests.
- Extract player records into the `players` table, add `player_leases`, and move duplicate login and reconnect handling to server level. Include a migration from the current world payload format.
- Add roles, the setup code, bans, `POST /admin/session`, API tokens, `audit_log` and `GET /admin/stats`.
- Done when one account joins two worlds on one server and sees the same inventory, a second simultaneous login is rejected, a token minted for another endpoint is rejected, and the stats endpoint returns 401 without a session.

### M4. Catalog in the database

- Split compile output into client and server catalogs. Store catalogs by revision and seed an empty database.
- Add `GET /catalog/<revision>`, the revision handshake and the client fetch. Delete `WORLD_CONTENT_VERSION` and the static client catalog import.
- Add the publish endpoint with registry swap, `defCache` clear, habitat rebuild, the content-updated broadcast, rollback, the retire rule and asset id validation. Reuse the lock, revision check and compile gate from the devdocs `transact()` path.
- Done when a test publishes a loot change against a running server and the next kill rolls the new table with no restart, a spawn move takes effect at the next respawn, a rollback restores the old table, and removing an item that a player holds is refused.

### M5. Devdocs server mode

- Make the API client configurable with two backends. Add the login screen, the server-mode content editing path, and the `players` and `server` workspaces.
- Serve the build from the game server at `/admin`.
- Done when an admin logs in, edits a loot table, publishes, sees the revision change in the `server` workspace, edits an online player's inventory and sees it change in the game client, and finds both actions in the audit log. A non-admin account gets no admin session.

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

- Run the full check and test suite before each milestone commit: `npm run check`, `npm run smoke`, `npm run build`.
- Any edit under `game/src` stales the world revision. Run `npm run world:build` before running gates.
- Content schemas use the hand-rolled combinators in `game/src/content/schema/core.ts`. Don't add zod or another schema library.
- Devdocs UI uses Tailwind and the shadcn kit already in the app. Write no hand CSS. Run the devdocs consistency test and the surface-audit tool after UI work.
- The client build has enforced gzip budgets in `game/vite.config.ts`. Keep server-only code out of the client bundle, and keep the worker in its own chunk.
- Add no native dependencies to the server. They break the single executable build.
- Parse and validate all external input at the boundary: join messages, admin API bodies, config files and tokens.
- Update `docs/multiplayer-hosting.md`, `docs/architecture.md` and `docs/content-authoring.md` as the behavior they describe changes.

## Build notes

- M4 keeps the static client import of the catalog. Until M7 makes the client thin, the client still builds the full simulation world at boot and needs the full tables, so the catalog it fetches from a server is laid over the bundled one while connected and removed on leaving. M7 deletes the static import together with the client simulation.
- M4 compiles a publish on the tick thread. `compileCatalog` takes 85 to 120 ms on the shipped content, and it runs outside the tick hold, so it costs at most one late tick. No worker thread is used, and the M6 bundle needs no second entry for one. Revisit this if content grows several times over.
- M4 keeps the inputs of spawn placement for the life of a world as `SpawnContext` in `game/src/multiplayer/spawnPlan.ts`: the floor height under a spot per region including dungeon chambers, each asset's base offset and box size, the body placement rules over the final solids, navmesh, door thresholds and terrain placement sampler, and the scattered tree trunks. Today these close over the GLB-built scene. M6's world pack must answer the same questions from baked data: a height and placement-surface sampler (height, slope, semantic region, water) per terrain, the solids, the navmesh, the dungeon spec and door thresholds, asset measurements, and the tree list.
- A publish does not re-run `registerHabitatClearances`. That step only feeds the tree scatter at world build, so trees stay where the boot catalog put them until the next start.
- The server checks asset ids against `assets/manifest.json`. M6 must embed the shipped manifest as a SEA asset and pass it as `assets.bundledManifest`.
- The owner replaced OAuth with username and password accounts on 2026-09-21, so the "Login is OAuth only… The service stores no passwords" lines above no longer hold: there are no providers, and the service stores an scrypt hash per account. A password is typed only on the identity origin, which serves its own sign-in, registration and password pages; the game client and devdocs still redirect and read the session out of the fragment exactly as before. `docs/identity-service.md` is the current description, including the forward migration that keeps a database from the OAuth service and turns its accounts into unclaimed names.
- M9 runs a thread per world only when the server has more than one world, or when `threads` is `"on"`. One world in its own thread ticks no faster than one world in the main thread and pays for the messages, so `"auto"` leaves a one-world server as it was. A commit failure still fails the whole server closed; a world thread that dies does not, and is started again. The M4 note above about compiling a publish on the tick thread now reads: with threads on the compile runs on the main thread, which ticks nothing. The single executable starts its threads from a second copy of the bundle embedded as the asset `server.cjs`, because Node refuses the executable itself as a worker script; `docs/multiplayer-hosting.md` has the measurements under "Scaling on one machine".
