# Multiplayer reference hosting

Corealm boots offline without multiplayer configuration. A configured multiplayer page shows Worlds on the loading screen, so the player chooses while the scene is still being built; joining still requires an explicit player action, and it waits until the game is ready. The reference host uses Node 24, WebSockets, and durable SQLite. No cloud account is required.

## Run locally

Use Node 24 and run `npm ci` once. These commands start both the game page and one authored world, and configure the Worlds menu automatically:

| Command | Game URL | World port | Persistent saves |
| --- | --- | --- | --- |
| `npm run multiplayer:dev` | `http://127.0.0.1:4173` | 4180 | `local-worlds/dev/` |
| `npm run multiplayer:prod` | `http://127.0.0.1:4175` | 4182 | `local-worlds/prod/` |

Development runs Vite with hot reload. Production builds the release game first, then serves its compiled files with Vite preview. This is a local production-build preview, not a public hosting service. Both use the real reference world server in a separate process, durable SQLite, a 200-player admission ceiling and explicit local guest authentication. The ceiling is a configuration limit, not a measured capacity claim. There are no fake players.

Stop an existing `npm run dev` before starting the development launcher, or choose a different web port. Wait for the launcher to print **Open ...**, then open that URL. Worlds appears automatically when loading finishes: enter a guest character name, select the world and **Join world**. A successful join closes the menu and enters that world. Use the same name to resume that character. The host stores a guest as `guest:<name>`. Ctrl+C stops both listeners and closes storage. The two modes have separate world IDs and save directories, so they can run together. Local saves are ignored by Git.

Options go after `--`:

```sh
npm run multiplayer:dev -- --web-port 4190 --world-port 4191
npm run multiplayer:prod -- --data ./local-worlds/my-world --capacity 100
npm run multiplayer:prod -- --skip-build
```

`--skip-build` explicitly reuses the existing `game/dist` release. Omit it after changing game code or assets. `--help` lists options. `--lab` starts the compact production multiplayer fixture with separate lab saves for acceptance checks. Both launchers bind only to loopback; their guest mode is for local testing. For public hosting, use the standalone host below with a production authentication adapter and HTTPS/WSS.

### Standalone world host

For separate management of the game page and world process:

```sh
npm ci
npm run multiplayer:server -- --authored --development-guests --port 4180 --data ./local-worlds
npm run dev
```

The standalone authored host exposes `corealm` by default. Use `--worlds corealm,second-corealm` for two independent worlds, which get seed 1337 and the `--capacity` ceiling. Omit `--authored` for the production lab world `yard`. `--capacity <1..1000>` sets the admission ceiling of every world and overrides the configuration file. `/worlds` serves the directory. Keep the data directory across restarts. Run `npm run dev` in another terminal while the host is running.

### Configuration file

The host reads `corealm-server.json` from its working directory. `--config <path>` or `COREALM_CONFIG` names a different file; a file named that way must exist, while a missing default file is fine. Settings resolve **flag, then environment variable, then file, then built-in default**. `--authored`, `--guests` and `--development-guests` are switches: the flag turns them on and the file's `authored` / `guests` / `developmentGuests` do the same, so neither can turn the other off.

```json
{
  "host": "127.0.0.1",
  "port": 4180,
  "publicEndpoint": "wss://worlds.example.com/",
  "allowedOrigins": ["https://play.example.com"],
  "data": "./local-worlds",
  "assetBaseUrl": "https://assets.example.com/corealm/",
  "identityUrl": "https://identity.example.com/",
  "ownerAccount": "acc_9Qr7v2KpLd3XmB1sYwTgHa",
  "authored": true,
  "worlds": [
    { "id": "corealm", "name": "Corealm", "seed": 1337, "capacity": 200 },
    { "id": "second-corealm", "name": "Corealm II", "seed": 4242, "capacity": 50 }
  ]
}
```

Only `id` is required per world. `name` defaults to the id, `seed` to 1337 and `capacity` to 64. Unknown keys, wrong types, a capacity outside 1 to 1000 and duplicate world ids are all rejected before storage opens. `assetBaseUrl` and `identityUrl` must be HTTPS, or plain HTTP on loopback, and are normalised to end with a slash. Setting `identityUrl` selects account authentication; see [Authentication modes](#authentication-modes).

| Setting | Flag | Environment variable |
| --- | --- | --- |
| config file | `--config` | `COREALM_CONFIG` |
| `host` | `--host` | `COREALM_HOST` |
| `port` | `--port` | `COREALM_PORT` |
| `publicEndpoint` | `--public-endpoint` | `COREALM_PUBLIC_ENDPOINT` |
| `allowedOrigins` | `--origins` | `COREALM_ALLOWED_ORIGINS` |
| `data` | `--data` | `COREALM_DATA` |
| `assetBaseUrl` | `--asset-base-url` | `COREALM_ASSET_BASE_URL` |
| `identityUrl` | `--identity-url` | `COREALM_IDENTITY_URL` |
| `ownerAccount` | `--owner-account` | `COREALM_OWNER_ACCOUNT` |
| `authModule` | `--auth-module` | `COREALM_AUTH_MODULE` |
| `guests` | `--guests` | none |
| `developmentGuests` | `--development-guests` | none |
| `worlds` | `--worlds a,b` | `COREALM_WORLDS` |
| every world's capacity | `--capacity` | `COREALM_CAPACITY` |

### Asset host

A server that sets `assetBaseUrl` puts it on every world descriptor it publishes, so `/worlds` and the join reply both carry it. The client loads its whole public file tree from that base: the asset manifest, models, textures, icons, the display font, sound and the generated terrain, navmesh and world data. The client's own JavaScript and CSS stay on the origin the page was served from. Cross-origin hosting needs `Access-Control-Allow-Origin` on every one of those files; the world map images and the asset image loader request them in CORS mode so the map canvas stays readable.

Boot picks the asset host once, before the first file is requested, from the worlds it discovered. All worlds a page can see must therefore agree on it; a world that names a different host is refused with an incompatible-world message, because a session cannot move hosts without reloading. A page with no server can set `window.__COREALM_ASSET_BASE__` before the game module, which wins over any world's answer and disables that check. With none of this configured the client uses relative paths exactly as before, which is what the GitHub Pages build needs.

For this standalone setup only, load one configuration example before the game module in `game/index.html`:

```html
<script src="/multiplayer.example.directory.js"></script>
```

The files `game/public/multiplayer.example.{single,list,directory}.js` demonstrate all three configuration forms. They are not loaded by default. These examples explicitly enable development guests and target the authored host above. For the lab, use `index.html?mode=combat&multiplayer=1`, world IDs `yard` / `second-yard`, and content version `corealm-pve-1:lab`. Authored worlds use `corealm-pve-1`. Scene/content mismatches are rejected before joining.

Configured game pages show Worlds over the loading screen. The list starts with **Local play only**, which is selected until the player chooses otherwise, followed by the worlds that were found. One button acts on that choice: Play offline puts the panel away and starts the single-player character, Join world enters the selected world, and Leave world returns to local play. Choosing a world before loading finishes shows Join when ready; the join then happens on its own as soon as the first frame is drawn.

Open the game menu with Escape or the minimap menu button to return to Worlds. The list shows population and availability, with incompatible and full worlds disabled for joining. Refresh worlds reloads the configured directory and every added host. Connection failures reopen the menu; the last complete scene stays visible and gameplay waits for a valid snapshot or an explicit return to offline play. Development guest names are shown only when guest mode is explicitly enabled; production deployments supply their authentication adapter.

### Adding a host

Players add their own hosts from the same panel. Type an address into the host field and select Add host: `127.0.0.1:4180`, `worlds.example.com`, a `ws://` endpoint, or a full directory URL. A bare address gets the reference host's `/worlds` path, loopback addresses default to `http` and everything else to `https`, which is what discovery accepts. Added hosts are stored in the browser under `corealm.hosts.v1`, are asked alongside the page's configured directory on every refresh, and are removed with the × beside the address. A host that cannot be reached reports itself in the status line without hiding the worlds other sources returned. Duplicate worlds are listed once. A page with no configuration of its own still shows Worlds when the player has added a host.

The browser currently requires a world's seed to match the loaded authored scene. Each world carries its own seed from the host's configuration, defaulting to 1337; a different seed produces an incompatible-world message. Switching worlds releases the old connection, keeps its frozen scene during connection setup, and replaces that scene when a validated snapshot arrives. Their progression remains independent even when terrain is identical.

Fixed authored scenery stays loaded from that matching map when buildings lie beyond the server's gameplay interest radius. Actors, resources and interactables still come from authoritative snapshots and deltas. This keeps distant structures visible without sending a larger world snapshot to every player.

## Registration and authentication

`window.__COREALM_MULTIPLAYER__` accepts `WorldConfiguration` from `game/src/contracts.ts`: one descriptor, an array, or `{directoryUrl}`. Descriptors contain provider/world IDs, name, endpoint, protocol/content versions, seed, population, capacity, availability, and an optional `assetBaseUrl`. Static population is the discovery-time count, not an admission guarantee. The host decides admission atomically.

`WorldProvider` separates discovery, authentication, and transport from gameplay. Register alternative implementations through `window.__COREALM_PROVIDERS__`. Other configured provider IDs use the reference WebSocket adapter. Adapter conformance tests exercise it and an independent deterministic adapter.

Protocol 2 adds public actions, visible activity timing, and authoritative targeted/area invocation commands. Update the browser and host together. Protocol 1 sessions are rejected explicitly. Existing durable character saves retain their storage schema and content version.

### Authentication modes

A host authenticates players in exactly one way. Configuring none, or more than one, stops the host before it opens storage.

| Mode | Configure | Player id | Descriptor `authentication` |
| --- | --- | --- | --- |
| Accounts, the default for a public host | `identityUrl` | the account id, `acc_...` | `account` |
| Guests | `guests: true` or `--guests` | `guest:<name>` | `guest` |
| Development guests | `developmentGuests: true` or `--development-guests` | `guest:<name>` | `guest` |
| Module | `authModule` | whatever the module returns | the module's `authentication`, else `guest` |

**Accounts.** The host fetches `<identityUrl>/.well-known/corealm-keys.json` once at start and refuses to start when it cannot. After that it verifies every join token offline. It checks the signature, the audience, the expiry, and that it has not accepted this token id before. The audience is the host's `publicEndpoint`, so a token minted for another server is refused. A token that names a key the host has not seen triggers one key refetch, shared by every join waiting on it and at most once every 10 seconds, which is how key rotation reaches a running host. An identity outage after start does not affect joins signed with keys the host already holds. Rejections say only that the token expired, was issued for another server, or is invalid. See [identity service](identity-service.md).

**Guests.** A guest presents `guest:<name>` and gets the player id `guest:<name>`. Guest names prove nothing. Anyone who can reach the host can play any guest. `--guests` is for a LAN or offline server whose owner accepts that, and works on any listener. `--development-guests` is the same adapter but refuses to start on a non-loopback listener, so a launcher or a copied command line cannot open a public guest server by accident. Account ids start with `acc_` and contain no colon, so no guest name can reach an account's character if the owner later switches the same database to accounts.

**Module.** `--auth-module` loads a module that exports `authenticate(token, world)` returning a stable player id and display name, for hosts run from source. Embedders pass any `AuthenticationAdapter` to `startReferenceServer`, and may pass `beforeAdmission(player, world)`, which runs after the host's own ban check and before the player lease is claimed; throwing a `SessionFailure` there refuses the join.

On the browser side, set `window.__COREALM_AUTHENTICATE__` to an async sign-in function returning `{token}`, or supply authentication through a custom provider.

Credentials belong in memory and the connection exchange, never in descriptors, URLs, saves, or logs. Remote endpoints require HTTPS/WSS; HTTP/WS is accepted only for loopback development. Configure `allowedOrigins` and encrypted transport when hosting remotely. No production deployment is required for local use.

## Administration

Administration is account work. A host in accounts mode serves `/admin/*`; a guest or module host answers every admin path with 501 and `{"error":{"code":"admin_unavailable"}}`. `/healthz`, `/readyz` and `/worlds` stay public and unchanged.

### Becoming the owner

A host with no owner prints one line at start and nothing else about it:

```json
{"event":"owner-setup-code","code":"K7M3Q-2WXPR-9TVBH-4CJ8N","message":"Sign in to devdocs and enter this code to become the owner of this server. It is shown once and is replaced on the next start."}
```

The code is 20 Crockford base32 characters, so 100 bits, and the database keeps only its SHA-256 hash. It does not expire; a restart with still no owner replaces it with a new one. Reading it back is impossible. Sign in through the identity service, then `POST /admin/setup` with that join token and the code. The first caller to get it right becomes owner and the code is spent, for everyone, including them. Typing is forgiving: any case, any separators, and O, I and L read as 0, 1 and 1. Wrong answers are capped at five per source address and twenty in total per minute, and a wrong code and a spent code give the same reply.

Set `ownerAccount` instead to name the owner in configuration. The host grants the role at start, records it in the audit log under the `config` credential and prints no code.

### Roles, bans, and tokens

Roles are `owner` and `admin`, by account id. Only an owner grants or revokes `admin`. No admin can demote an owner, an owner cannot be banned, and the last owner cannot be removed.

Bans are per server, by account id, with a reason, an optional expiry, who set it and when. A banned account is refused at the join with `BANNED` and the reason, is refused an admin session, and loses any admin session it holds. Banning someone who is playing disconnects them through the ordinary leave path, so their character is saved and their lease is freed. An expired ban stops applying on its own; nothing sweeps.

Devdocs signs in with `POST /admin/session`, exchanging a join token for a session token that starts `cas_` and lasts 12 hours. Automation uses API tokens, which start `cat_`, carry scopes, and expire only if given an expiry. Both are 32 random bytes, stored only as a SHA-256 hash, compared in constant time, and shown once at creation. A session carries every scope; a token carries only what it was created with and can never mint a token or grant a role.

| Scope | Allows |
| --- | --- |
| `content:read` | Reading source collections, for the export workflow. |
| `content:publish` | Publishing a catalog. |
| `players:read` | `GET /admin/players`, `GET /admin/bans`. |
| `players:write` | `POST /admin/bans`, `DELETE /admin/bans/<accountId>`. |
| `stats:read` | `GET /admin/stats`. |

### Endpoints

JSON in, JSON out. Failures are `{"error":{"code","message"}}` and every reply is `Cache-Control: no-store`. `Authorization: Bearer <cas_… or cat_…>`. CORS allows the exact origins in `allowedOrigins` and never `*`; a request from any other origin gets no allow header, and its preflight gets 403. Bodies are capped at 8 KiB and every field, header, query value and path segment is validated at the boundary.

| Endpoint | Credential | Does |
| --- | --- | --- |
| `POST /admin/setup` | join token + code | Makes the caller owner and returns a session. |
| `POST /admin/session` | join token | Returns `{session, expiresAt, accountId, name, role}` for a role holder, otherwise 403. |
| `DELETE /admin/session` | session | Revokes the presenting session. |
| `GET /admin/me` | session or token | `{credential, accountId, tokenId, role, scopes}`. |
| `GET /admin/roles` | session | Every role holder. |
| `PUT /admin/roles/<accountId>` | owner session | Body `{"role":"admin"}`. |
| `DELETE /admin/roles/<accountId>` | owner session | Removes a role. |
| `GET /admin/bans` | `players:read` | Live bans only. |
| `POST /admin/bans` | `players:write` | Body `{accountId, reason, expiresAt?}`. Returns `{ban, kicked}`. |
| `DELETE /admin/bans/<accountId>` | `players:write` | Lifts a ban. |
| `GET /admin/tokens` | session | Metadata only: id, label, scopes, createdBy, createdAt, lastUsedAt, expiresAt. |
| `POST /admin/tokens` | session | Body `{label, scopes[], expiresAt?}`. The reply is the only place the secret exists. |
| `DELETE /admin/tokens/<id>` | session | Revokes a token. |
| `GET /admin/audit?limit=&before=` | session | Newest first. `before` is an id from the previous page. |
| `GET /admin/stats` | `stats:read` | Below. |
| `GET /admin/players?query=&limit=&cursor=` | `players:read` | Summaries, newest seen first. `cursor` comes from the previous page. |
| `GET /admin/players/<accountId>` | `players:read` | One player with inventory, bank, equipment and skills. |

A player who is online is read from the world holding them, not from the row the last commit wrote, so devdocs shows what the player is carrying right now. M5 adds editing and kicking beside these readers.

`audit_log` gets one row inside the same transaction as the write that caused it: `id`, `at`, `account_id`, `credential`, `action`, `target`, `before` and `after`. The credential is `session`, `token:<id>`, `setup` for the one-time code, `config` for `ownerAccount`, or `login` for the join token that minted a session. Actions are `owner.setup`, `role.set`, `role.revoke`, `ban.set`, `ban.remove`, `token.create`, `token.revoke`, `session.create` and `session.revoke`.

### Stats

`GET /admin/stats` exposes the metrics the server already collects. Times are milliseconds, sizes are bytes, timestamps are epoch milliseconds.

```json
{
  "startedAt": 1758326400000, "uptimeSeconds": 903.4,
  "worlds": [{ "providerId": "reference", "worldId": "corealm", "name": "Corealm", "playersOnline": 12, "capacity": 200, "tick": 9031 }],
  "tick": { "samples": 9031, "lastMs": 21.4, "meanMs": 23.9, "p95Ms": 29.5, "maxMs": 134.2 },
  "stages": { "samples": 9031, "simulationMs": 18.1, "snapshotMs": 3.4, "commitMs": 0.9, "replicationMs": 1.5 },
  "commands": 4821, "rejected": 3, "errors": 0, "backlogDisconnects": 0,
  "bytesOut": 91263344, "bytesOutPerSecond": 101021.2,
  "memory": { "rssBytes": 1231847424, "heapUsedBytes": 412398080 },
  "events": [{ "at": 1758327303000, "kind": "join", "accountId": "acc_...", "detail": "corealm" }]
}
```

Tick figures come from the ring of the last 36,000 ticks, an hour at 10 Hz. Stage times are that stage's total divided by the number of samples, so they are a per-tick average over the life of the process, not a recent window. `bytesOutPerSecond` is the same kind of average. `events` is a bounded ring of the last 256 of `join`, `leave`, `rejected`, `ban`, `unban`, `admin-session` and `owner-setup`, oldest first; M6's console reads the same ring.

Without a credential the endpoint answers 401, and with a token that lacks `stats:read` it answers 403.

## Authority, reconnect, and durability

One headless world owns navigation, resource schedules, enemies, collision, and shared state. Production player systems execute validated intents for movement, gathering, combat, loot, inventory, equipment, quests, hunts, banking, shops, production, campfires, travel, and progression. Browsers render replicated state. Movement prediction changes only the drawn pose and reconciles to authoritative updates.

Protocol version 3 adds proximity chat, eight-player parties, shared kill-bonus XP and automatic round-robin item delivery. Update the host and clients together. Chat recipients are selected by the server when a message is sent. Public loot piles can be collected by anyone; the server chooses the receiving party member and commits their inventory, the remaining pile and the next loot turn in the same transaction. Party state persists; chat and invitations are ephemeral. See [chat and party rules](game/parties.md).

`WorldSession.command` returns `accepted`, `rejected`, or `unknown` asynchronously. Acceptance means the result and receipt committed; a timed activity may still be running. Rewards arrive through later authoritative updates. UI, input, and agent callers use `sendGameCommand`; synchronous writers reject online calls that bypass the session.

Commands have a transport sequence and a logical operation ID scoped to provider/world/player. Retrying the identical operation returns its durable receipt. Reusing an ID for another command or retrying outside the retained 256-operation window is rejected. Reconnect obtains a valid snapshot before commands resume. Session IDs and lifecycle generation guards reject late packets.

A second simultaneous login of one account is rejected with `DUPLICATE_LOGIN` in every world of the host, not only the world the first session is in. An unexpected disconnect saves the player and keeps their place for 30 seconds: the place counts toward that world's capacity, and the same account may resume at once. If they join a different world of the host inside that window they are admitted there, because the drop already saved them, and the held place is freed. Explicit leave saves, frees the account and restores the separate offline save. Network failure never creates an offline branch of the online world. Browser progression is neither imported nor overwritten automatically.

SQLite uses WAL, synchronous FULL transactions, and an exclusive database lock. World state, random streams, operation receipts and the characters a world holds commit atomically before acknowledgement. Storage failure stops simulation and acknowledgements. Restart resumes the saved simulation clock without advancing gameplay for downtime. Back up the directory while the host is stopped. The file is `worlds.sqlite` in the data directory and holds the whole server, not one world.

### Players, worlds and the lease

A player has one character per host, shared by every world on it. The database keeps three things apart:

| Table | Key | Holds |
| --- | --- | --- |
| `players` | account id | The character: inventory, bank, equipment, skills, quests, currency, position and the rest of the private state, as JSON in `character`. Also `name`, `last_world`, `first_seen` and `last_seen` in epoch milliseconds, and `playtime_seconds`. Position is stored once, as `$.player.position` and `$.player.regionId` inside `character`, and is meaningful in `last_world`. |
| `world_players` | world, account id | What the player owns in that world: campfire, recovery cache and used obstacles, plus that world's random cursor. Command receipts stay in `world_receipts`. |
| `player_leases` | account id | Which world and session may write the character, until when, and whether the row is a dropped player's reservation. |

Administration lives in the same file, in `server_roles`, `server_settings`, `player_bans`, `admin_sessions`, `api_tokens` and `audit_log`. Server code reaches all of it through `ServerAdminStorage` in `game/src/multiplayer/adminStorage.ts`, which is asynchronous and takes plain data for the same reason `WorldStorage` is: the database moves to its own thread later.

Joining a world claims the account's lease in one transaction. The claim succeeds when there is no lease, the lease has expired, or it is a reservation; otherwise the join is `DUPLICATE_LOGIN`. A live lease lasts 30 seconds and the holding world renews it every 10 seconds inside its ordinary tick commit, together with `last_seen` and `playtime_seconds`, so renewal costs no transaction of its own. A world that crashes stops renewing and its leases run out by themselves. A world that starts again frees the leases its previous life left behind.

Every character write is fenced. The commit writes a character only while the lease still names that world and that session, in the same transaction as the world state. A world that lost the lease, because it stalled past the expiry and another world took the account, has its write refused, is told which players were refused, and disconnects them with `SESSION_EXPIRED`. What the player owns in that world is still written, because that belongs to the world.

A player with a live campfire or recovery cache stays simulated in that world while offline, so the fire burns down and the cache expires on schedule. That resident copy never writes the character. When the player joins any world, the character comes from `players`, never from a resident copy, and is combined with what they own in the world they joined. Joining a different world than `last_world` places the character at that world's safe spawn and clears activity, dialogue, movement and combat timers, which were timed by the other world's clock. Joining the same world resumes at the saved position.

Replacement `WorldStorage` adapters implement `load`, `openWorld`, `claimPlayer`, `releasePlayer`, `commit` and `close` from `game/src/contracts.ts`. Every method is asynchronous and takes plain data, and none may assume worlds share memory. The lease and the fence keep one character safe when worlds later run on separate threads. `commit` retains players the record omits. `MemoryWorldStorage` in `game/src/multiplayer/memoryStorage.ts` implements the same rules without a file. Inactive runtimes are evicted after their final save commits, retaining maintenance while an owned campfire or recovery cache exists.

### Migrating an older database

Databases written before the players table kept a whole player inside each world. Opening one migrates it once, in a single transaction, and records `schema_version` 2 in the `meta` table. Reopening does nothing. The host prints one JSON line, `{"event":"storage-migrated",...}`, with the number of worlds and players and every conflict it resolved. When the same player id exists in several worlds, the character with the most total skill XP is kept, then the one from the world with the higher tick, then the lower world key. The host discards the other characters, inventories included, and names them in that line. Every world keeps what the player owned there, its receipts and its random cursor. The host backs nothing up. Copy the data directory first if you may need the discarded characters. A database with a newer `schema_version` than the host understands is refused.

Guests were stored under their bare name before this change and are `guest:<name>` now, so a guest character from an older local save is not resumed under the new id.

Adapters may opt into `entityPatches: true`. Commits with `entityWrites: "patch"` upsert the supplied entity rows, retain omitted rows, and delete `removedEntityIds`, atomically with the world clock, player state, random cursors and receipts. Loads must reconstruct the complete entity list. The reference SQLite adapter migrates old monolithic entity saves in that transaction. The server establishes the initial baseline before accepting connections; adapters without this capability continue receiving complete snapshots. A failed commit stops the world rather than advancing its in-memory delta baseline and continuing to acknowledge commands.

Server spatial interest has a 48 m radius. Clients select at most the nearest 256 remote players within 32 m for rendering and interpolation. Equal-distance ties use stable player IDs. The session keeps all replicated player state; shared simulation and resource/enemy outcomes do not use this presentation limit. The constants live in `game/src/multiplayer/visiblePlayers.ts`. Inventory, bank, quest, hunt, and recovery state goes only to its owner. Public motion uses four float32 values per actor. Up to 128 nearby actors update at 10 Hz. In larger crowds, the nearest 32 retain 10 Hz movement and the remainder use 2 Hz. Interpolation spans the actual update interval; gameplay and activity changes bypass the cosmetic throttle. Messages, input rates, entity batches, and queues are bounded. Exceeding the 2 MiB outbound budget disconnects that client with close code 4008 and BACKLOG reason. Snapshots above 2,048 nearby semantic entities also disconnect that client, without halting the world.

### Public actions and smooth presentation

`PublicActions` projects a strict allowlist of visual cues from production combat and events. A bounded 4,096-entry circular log carries spell launches, melee windups and hits, attack cancellation, bank gestures, and deaths. Publication overwrites one slot; cursor reads copy only new entries. Each connection advances an action cursor and filters by realm and distance. Private events and reward payloads stay with their owner. A resynchronization restores current activity from the snapshot without replaying old one-shot effects. Durable commit still precedes publication.

Persistent presentation contains the current pose, the visible tool, and timing needed to draw gathering or a traversal. The client uses the production animation clips, fishing line/pose, and traversal contact layers. Unchanged heartbeats preserve playing actions; explicit movement, stop, death, or cancellation can interrupt them. Traversal draws the production curve while the server retains control of success and landing. Death and fatal-hit cues use the original combat location even when respawn happens in the same tick.

When an enemy changes targets, its previous owner's pending attack is cancelled before the new engagement proceeds. Public cancellation retains the original scene and owner; a delayed cancellation from the previous owner cannot remove the new owner's projectile.

The action bar routes preferred spells, targeted invocations and area placement through `sendGameCommand`. An area reticle allows one pending placement and ignores responses for a replaced reticle. Cast locks come from the authority. Prediction clones only mutable player movement state instead of inventory, quests and world data on every update.

Configured multiplayer clients allocate and prepare spell pools before gameplay. Local casts have four basic slots and one invocation slot; remote casts have 32 basic slots and four invocation slots. Saturation reuses the earliest-ending slot. Remote invocation pools add no point lights, avoiding shader recompilation as casters appear. Local and remote casts retain separate origins and slots. These are effect-density limits, not limits on server combat or damage.

The multiplayer lab uses the game's startup and streamed shader preparation. Refraction prepares its separate camera/light layer too. Remote animation palettes include all public action clips, so an activity change during detail preparation cannot select a missing clip. Projectile, fishing, and traversal presentation advance between server ticks. Interpolation never rewinds when a socket callback runs after a frame timestamp was captured.

## Checks and measured limits

```sh
npm run multiplayer:lab
npm run multiplayer:authored
npm run multiplayer:render
npm run multiplayer:capacity -- --clients 1000 --seconds 600 --placement distributed
npm run multiplayer:capacity -- --clients 1000 --seconds 600 --placement clustered
```

The two-browser lab uses real movement and interaction inputs against a real host, including resource/loot contention, private recovery, reconnect, restart persistence, and full/incompatible/unavailable UI. The authored smoke checks production terrain/actors and offline-save isolation/restoration. Their separate budgets are 60 s and 120 s.

Run capacity tests separately from builds, browser gates, and other heavy work. Reports under `test-results/multiplayer-capacity` record source fingerprint, hardware, duration, placement, activity, durable mining awards, CPU, peak RSS, bandwidth, ticks, and acknowledgement latency. Every player steers and starts production mining once per ten seconds. The workload includes churn, paused consumers, and an extra admission. Clustered clients contend for one shared resource; gameplay rejections are separate from transport errors.

The synthetic flat capacity pad uses production rules but does not measure authored-scene rendering. The render tool separately places 999 synthetic server actors with one real browser in the production scene. That is render evidence, not 1,000 network clients. Remote equipment comes from the server; crowded actors retain their equipped appearance with simpler geometry and sampled animation.

See [implementation status](../runs/corealm-multiplayer/implementation-status.md) for sustained measurements and acceptance limits. Proposed p95 targets are tick time below 100 ms and acknowledgement below 250 ms. Current sustained runs exceed those targets. Successful admission alone is not 1,000-player performance certification.

### Crowded player presentation

Crowd presentation activates at 64 selected remote players and turns off below 48. The nearest 32 use the normal animation path, with a 1 m retention bias. Other selected players keep their equipped armour, weapons, colours and hair, using simpler geometry and sampled animation. Both paths cast shadows. Batches share only compatible equipped appearances. Equipment changes replicate from the server and rebuild the affected appearance. The 256-player/32 m selection and authoritative state remain unchanged.

### Investigating local response stalls

Run `npx tsx tools/multiplayer-response-test.ts --authored` separately from builds or browser gates. This creates an isolated world and save under `test-results`, then measures one active network client for 20 seconds. The report separates simulation, snapshot, durable commit and replication work. It measures responsiveness, not capacity. Use `tools/multiplayer-launcher-test.ts --prod --authored --sustained` for the separate browser movement check after the production lab passes.

The September 17 performance audit found that multiplayer enemy separation used the full authored enemy list, about 4,900 actors, for pairwise overlap checks. Unobserved idle actors skipped AI movement but still entered separation. The fix uses the actually simulated actors and spatial buckets for nearby pairs. Multiplayer also preserves entity render references between deltas and uses the same maximum 20 ms movement steps as offline gameplay. The next bottleneck was cloning and rewriting roughly 9 MB of unchanged entities every tick. Entity patches remove that repeated cloning and database rewrite; detecting changes still scans entity serialization. Sub-50 ms responses are a direction for further work, not a demonstrated guarantee.

Main's input-first frame scheduling, sliced animation preparation and GPU submission pacing remain enabled. Multiplayer now uses its stable render snapshots instead of clearing and rebuilding the entity index for every network update. Selected graphics quality, armour and crowd shadows are preserved.

Measured locally on September 17, 2026, on an Intel Core Ultra 9 285K, with one active network client in the authored world and on-disk SQLite. Each response run sampled 20 seconds of alternating movement in a separate client process:

| Measurement | After AI fix, before entity patches | After both fixes |
| --- | ---: | ---: |
| Server tick p95 | 134 ms | 29.5 ms |
| Command acknowledgement p95 | 253 ms | 135 ms |
| Average durable commit | 58.9 ms | 0.9 ms |

The final two-browser production run acknowledged 123 commands with 147 ms p95 latency and no reconnections during its 20-second movement/click sample. A 1.6-second maximum RAF gap still occurred during cold rendering preparation; this is not hitch-free rendering. The isolated server probe recorded no failed commands, about 5.7 CPU seconds over 21 seconds, and 1.23 GB final RSS. These short local measurements do not certify the configured 200-player limit. Disposable reports are under `test-results/multiplayer-response-authored` and `test-results/multiplayer-launcher-prod-authored`.
