# Corealm for new maintainers

Corealm is a 3D browser game: a Three.js client drawing an authoritative TypeScript simulation. Anyone can host a server from one executable, and a player signs in once and joins any server. Admins edit loot, spawns, creatures and prices in a web editor while the game runs.

This page is the ten-minute tour. Every section links to the document that goes deeper.

## The four parts

<picture><source media="(prefers-color-scheme: dark)" srcset="figures/maintainers/parts-dark.svg"><img alt="The four deployable parts. A player's browser signs in to the identity service, takes a join token, loads files from the asset host and plays against a game server over a WebSocket. Devdocs calls the game server's admin API, and the game server serves devdocs at /admin. The game server fetches the identity service's public keys once at start." src="figures/maintainers/parts-light.svg"></picture>

| Part | What it owns | Where the code is | How it runs |
| --- | --- | --- | --- |
| Identity service | Accounts, username and password login, the signed join tokens, the public server directory. | `identity/`, entry `tools/identity-server.ts` | `npm run identity`. One per Corealm, behind HTTPS. |
| Game server | Simulation, player characters, the content catalog, roles, bans, the audit log, the admin API. | `game/src/multiplayer/`, entry `tools/multiplayer-server.ts` | One executable per host. Settings in `corealm-server.json`, data in `worlds.sqlite`. |
| Asset host | Static files: the client build, models, textures, the baked world, the navmesh, the world pack. | `game/public/`, built by `npm run build` | GitHub Pages by default. A server names its host in `assetBaseUrl`. |
| Devdocs | The authoring and admin UI. One app, two modes. | `devdocs/` | `npm run devdocs` for repo mode. The game server serves the server-mode build at `/admin/`. |

One host core runs the world: `game/src/multiplayer/worldHost.ts`. The WebSocket server wraps it, and so does local play in a Web Worker, so there is one copy of the game rules.

## How a player gets into a world

<picture><source media="(prefers-color-scheme: dark)" srcset="figures/maintainers/join-dark.svg"><img alt="Joining a server in six steps: pick a world, sign in on the identity service, get a 60-second join token, the game server verifies it offline, the server claims the account's lease, then play. Playing locally takes three steps with no login: pick Play local, the host core starts in a Web Worker on IndexedDB, and the page joins it over a MessagePort." src="figures/maintainers/join-light.svg"></picture>

A password is typed on the identity service's own pages and nowhere else. The game and devdocs send the player there and get a session back in the URL fragment, which a browser never puts in a `Referer` header. Before every join, including each reconnect, the client asks for a fresh join token naming that one server's endpoint.

The game server verifies the token offline, against keys it fetched at start. A join therefore makes no call to the identity service, and a token minted for another server is refused. See [identity service](identity-service.md) and [authentication modes](multiplayer-hosting.md#authentication-modes).

A `player_leases` row holds one account in one world at a time. A second login is refused with `DUPLICATE_LOGIN`. A disconnect saves the character and keeps the place for 30 seconds.

Local play needs no account. The same host core starts in a Web Worker, saves to IndexedDB, and the page joins it over a MessagePort through the same session client. Connected play and local play share one code path.

## How content reaches the game

<picture><source media="(prefers-color-scheme: dark)" srcset="figures/maintainers/content-dark.svg"><img alt="Base game JSON under game/content/data compiles into a client catalog and a server catalog under one revision hash. The bundled base seeds an empty server database once. Devdocs publishes new revisions into that server's database, and a newer base game reaches it through update from base: preview, resolve conflicts, and apply. A note beside the database says export is a manual backup or reviewed promotion; nothing flows back automatically." src="figures/maintainers/content-light.svg"></picture>

The repository holds the base game. Authored JSON compiles to two catalogs under one content revision: a small client catalog the browser may read, and the full server catalog with loot rolls and spawn tables. The bundled base carries the strict `package.json` version beside those catalogs. It seeds a new server's database once, on its first start with an empty database, and a later deploy never overwrites a database that already holds a catalog.

From then on the server owns its source collections. Admins edit them live in devdocs, and those edits stay on that server. A later base release logs `base-update-available`; an admin can preview the ancestor/server/new-base merge, choose conflict sides and apply it through the normal publish checks.

A publish from devdocs compiles, checks and swaps in one step. Loot applies at the next kill, spawns at the next respawn, and every other table at the next restart. A rollback is a publish of an older revision and restores that revision's recorded base marker. If a base update leaves the active revision unchanged, it records an audited marker-only move; rollback cannot undo that move, so restore the marker with the previous executable and `allowDowngrade: true`. Removing an item a player holds, or a creature alive in a world, is refused: mark the definition `retired` instead. See [content authoring](content-authoring.md).

## The repository

<picture><source media="(prefers-color-scheme: dark)" srcset="figures/maintainers/repo-dark.svg"><img alt="Nine top-level folders with one line each: game, devdocs, identity, tools, tests, docs, deploy, art and runs. Read first: docs/live-server-plan.md, docs/multiplayer-hosting.md, game/src/contracts.ts with game/src/multiplayer/worldHost.ts, and the scripts block of package.json." src="figures/maintainers/repo-light.svg"></picture>

## Environments and pipelines

<picture><source media="(prefers-color-scheme: dark)" srcset="figures/maintainers/pipelines-dark.svg"><img alt="Three columns. Local dev runs npm run dev, devdocs, identity and multiplayer:server. CI on GitHub runs five workflows: docs.yml, content-export.yml, content-publish.yml, release.yml and content-selftest.yml. The two content workflows are manual, on dashed arrows: export backs up or promotes one server's content as a pull request, publish pushes a checkout's content to a server you administer. Deployed are the asset host, the game server behind a reverse proxy, the GitHub release carrying both executables, and the identity service. Secrets live in the server database, the identity service's environment and GitHub secrets." src="figures/maintainers/pipelines-light.svg"></picture>

The owner also runs a test server on their own machine: the same executable behind a TLS proxy.

Secrets live in three places: the game server's own database, the identity service's environment, and GitHub secrets. A static build never holds one. The publish workflow keeps its token in the `live-server` environment, so a reviewer has to approve before it can be read. Both content tools read the token from `COREALM_CONTENT_TOKEN` and refuse a `--token` flag, because a command line is visible to every other process on the machine.

Neither content workflow runs on a schedule. Both are manual, both run inside the repository they live in, and both read or write one configured server. A server cannot start either of them, and the export can only open a pull request that a human merges, so no host you do not control has a path into this repository.

## Day to day

| I want to | Command, or where | Read |
| --- | --- | --- |
| Run the game | `npm run dev` | [feature-lab.md](feature-lab.md) |
| Run the editor | `npm run devdocs` | [content-authoring.md](content-authoring.md) |
| Run a server locally | `npm run multiplayer:server -- --authored --development-guests --port 4180 --data ./local-worlds` | [multiplayer-hosting.md](multiplayer-hosting.md#run-locally) |
| Run accounts locally | `npm run identity -- --origins http://127.0.0.1:4173` | [identity-service.md](identity-service.md#configuration) |
| Edit content | Devdocs, then **Save all** | [content-authoring.md](content-authoring.md#the-save-cycle) |
| Update a server from a newer base | Server API: preview, resolve conflicts, apply | [updating from a newer base](multiplayer-hosting.md#updating-from-a-newer-base) |
| Push this checkout's content to a server I administer | The **Content publish** workflow, or `npm run content:publish:server -- --server <url> --confirm "<server name>"` | [content workflows](multiplayer-hosting.md#content-workflows-and-their-secrets) |
| Back up a server's content, or promote one of its changes into the base game | The **Content export** workflow, or `npm run content:export:server -- --server <url> --dry-run` | [content workflows](multiplayer-hosting.md#content-workflows-and-their-secrets) |
| Rebake the world | `npm run world:build` | [server world pack](world-authoring.md#server-world-pack) |
| Run the gates | `npm run check`, then `npm run smoke -- --run runs/corealm --hardware` | [feature-lab.md](feature-lab.md#everyday-commands) |
| Build the server executables | `npm run devdocs:build:server`, then `npm run server:build` | [building the executables](multiplayer-hosting.md#building-the-executables) |
| Cut a release | Push a `v*` tag. `release.yml` builds and attaches both executables. | [releases](multiplayer-hosting.md#releases) |
| Give someone admin | Devdocs, **Server → Access**. Only an owner may grant a role. | [roles, bans, and tokens](multiplayer-hosting.md#roles-bans-and-tokens) |
| Kick or ban a player | Devdocs, **Players**, beside the name. A kick saves the character; a ban needs a reason. | [kicking a player](multiplayer-hosting.md#kicking-a-player) |
| Roll back content | Devdocs, **Server → Publishes → Roll back** | [publishing content](multiplayer-hosting.md#publishing-content) |
| Reset a player's password | On the identity service host: `npx tsx tools/identity-admin.ts --data identity-data set-password <name>`. A player who still knows theirs changes it on the service's own `/password` page. | [the operator tool](identity-service.md#the-operator-tool) |

## Rules that bite

- Node 24, nothing else. `.node-version` and the `engines` field both pin it.
- A change in the world-bake entry points' import graph can stale the baked world. Run `npm run world:build` when a bake input changes, then check the committed pack before the gates. A small server or UI change outside that graph does not require a rebake.
- Content schemas use the hand-rolled combinators in `game/src/content/schema/core.ts`. Do not add zod or another schema library.
- The server takes no native dependency. One would break the single executable build.
- The devdocs UI is Tailwind and the shadcn kit that is already in the app. Write no hand CSS.
- The client build enforces gzip budgets in `game/vite.config.ts`. Keep server-only code and catalog tables out of the client bundle and out of the worker.
- Parse and validate every external input at the boundary: join messages, admin API bodies, configuration files and tokens.
- The game is pre-v1. Delete a retired path and its callers instead of leaving a compatibility shim.

## Status

| Milestone | What it added | State |
| --- | --- | --- |
| M1 to M3 | The configuration file, the asset base URL, the identity service, server accounts, the players table and the lease. | Done |
| M4 | The catalog in the server database, live publish and rollback. | Done |
| M5 | Devdocs server mode, the players, server and Base game workspaces. | Done. The bounded browser audit covers the base preview, conflict resolution, apply and failure states; desktop and phone selector captures were inspected. |
| M6 | The baked server world pack and the two single executables. | Done |
| M7 | Thin client, local play in a Web Worker. | Done |
| M8 | The CI content workflows. | Done. Export has run against the test server; publish has never run from `main`. |
| M9 | A worker thread per world. | Done |
| Base version and update API | Strict semver, per-revision base markers, schema 4 migration, three-way merge and authenticated preview/apply endpoints. | Done in server code, focused tests and the bounded browser audit. |

Every milestone is built. [Live server status](live-server-status.md) has the evidence one line at a time, what is still unverified, and the checklist for merging `live-server` into `main`.

## Where to read more

- [live-server-plan.md](live-server-plan.md): the architecture and the milestones. Its **Build notes** section records where the code went another way.
- [live-server-status.md](live-server-status.md): what is done, what is not verified, what the known limits are, and what merging to `main` needs.
- [live-server-m7-stages.md](live-server-m7-stages.md): how M7 was staged. Kept as the record of that milestone, not as a plan.
- [multiplayer-hosting.md](multiplayer-hosting.md): configuration, the admin API, publishing, the executable, releases.
- [identity-service.md](identity-service.md): accounts, join tokens, key rotation, the server directory.
- [content-authoring.md](content-authoring.md): the two catalogs, the save cycle, repo mode against server mode.
- [world-authoring.md](world-authoring.md): the authored world, and the server world pack the game server boots from.
- [architecture.md](architecture.md): the host core, worker local play and the storage rules.
- [feature-lab.md](feature-lab.md): the development loop and which check to run.
- [AGENTS.md](../AGENTS.md): the rules agents working in this repository follow.
