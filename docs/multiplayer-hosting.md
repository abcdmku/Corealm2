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

The host reads `corealm-server.json` from its working directory. The [single executable](#the-server-executable) reads it from its own directory instead, so an operator can drop the binary and its file into a folder and start it from anywhere; a relative `data` resolves against the same place. `--config <path>` or `COREALM_CONFIG` names a different file; a file named that way must exist, while a missing default file is fine. The executable is the exception: with no configuration at all it prints a minimal sample and exits 78, because a packaged server has nothing else to go on. Settings resolve **flag, then environment variable, then file, then built-in default**. `--authored`, `--guests` and `--development-guests` are switches: the flag turns them on and the file's `authored` / `guests` / `developmentGuests` do the same, so neither can turn the other off.

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
| `name` | `--name` | `COREALM_SERVER_NAME` |
| `description` | `--description` | `COREALM_SERVER_DESCRIPTION` |
| `registerWithDirectory` | `--register-with-directory` | none |
| `adminUiDir` | `--admin-ui-dir` | `COREALM_ADMIN_UI_DIR` |
| `guests` | `--guests` | none |
| `developmentGuests` | `--development-guests` | none |
| `worlds` | `--worlds a,b` | `COREALM_WORLDS` |
| `threads` | `--threads auto\|on\|off` | `COREALM_THREADS` |
| follow the repo catalog | `--follow-repo-catalog` | none |
| every world's capacity | `--capacity` | `COREALM_CAPACITY` |

### Content catalog

The server keeps its content in its database and simulates from there. Three tables hold it. `catalogs` has one row per published revision with the server catalog, the client catalog as the exact bytes it serves, the source collections it was compiled from, the formula revision, who stored it and when. `catalog_active` is one row naming the active revision. `catalog_history` gets a row each time that pointer moves, with the revision it replaced. A revision is a content hash, so storing one twice changes nothing. Server code reaches all of it through `CatalogStorage` in `game/src/multiplayer/catalogStorage.ts`, which is asynchronous and takes JSON text for the same reason `WorldStorage` takes plain data. `MemoryCatalogStorage` follows the same rules without a file.

A server's content is its own copy of the source collections. An empty database is seeded from the catalog the server ships with and prints `{"event":"catalog-seeded","revision":"..."}`. From then on the database wins. A newer server release with a different shipped catalog changes nothing in a database that already has one, and prints one line so the owner knows:

```json
{"t":"2026-09-20T22:58:21.445Z","level":"warn","event":"catalog-base-ignored","activeRevision":"dee09b...","bundledRevision":"41c7aa...","message":"This database already has a catalog, so the catalog shipped with this server was not applied."}
```

Run from source, the shipped catalog is compiled at start from `game/content/data/` and the checkout's formulas. `--follow-repo-catalog` is for a developer's own database: at start it publishes that catalog over the active one when they differ, records the move in `catalog_history` under `follow`, and prints `catalog-followed`. `npm run multiplayer:dev` and `npm run multiplayer:prod` pass it, so content edited in the repo shows up in the local world. A live server never sets it, and no configuration file key exists for it.

The host opens storage, seeds it, reads the active server catalog, installs it with `installCatalog` from `game/src/content/catalogInstall.ts`, and only then imports the simulation, because the content modules read their tables as they load. `installCatalog` throws if a content module loaded first. An embedder that passes `catalog` to `startReferenceServer` must do the same. The server refuses to start when the store's active revision is not the catalog the process runs on. Without `catalog` the server keeps the catalog compiled into the build in memory, which is what tests and harnesses use.

Every descriptor the server sends carries `catalogRevision`, in `/worlds` and in the `joined` reply. A static page configuration leaves it out. The join message carries no content version. The client trusts the revision in `joined`, because the one it saw at discovery may be a publish old. It then loads the client catalog from the same host, `http` for `ws` and `https` for `wss`:

```text
GET /catalog/<revision>
Content-Type: application/json
Cache-Control: public, max-age=31536000, immutable
ETag: "<revision>"
Vary: Accept-Encoding
Access-Control-Allow-Origin: *
```

The reply is Brotli or gzip when the request accepts it, compressed once per revision and kept in memory for the last three revisions asked for. The shipped catalog is 638,630 bytes, 79,589 as Brotli. Any stored revision is served, so a client that joined just before a publish still loads. A revision that is not 64 lowercase hex characters, or is not stored, gets 404. The client catalog holds nothing a player cannot see in the game, which is why any origin may read it. [Content authoring](content-authoring.md#two-catalogs-one-revision) lists what it contains. The page keeps the reply in the Cache API under `corealm-catalog-v1` and drops that server's older revisions when it stores a new one. Outside a secure context there is no Cache API and the HTTP cache holds the immutable reply. While connected, the page shows the server's names, icons, item stats and shop stock. Leaving the world puts the build's own tables back, so local play never runs on another server's numbers. If the catalog cannot be loaded, the session continues with the build's names and the console says so.

### Publishing content

An admin changes the content of a running server through three endpoints. All need the `content:publish` scope, from an admin session or an API token, and accept bodies up to 16 MiB. The shipped collections are about 2 MiB together.

| Endpoint | Body | Does |
| --- | --- | --- |
| `POST /admin/content/validate` | same as publish | Runs every check a publish runs and stores nothing. Devdocs uses it as a dry run. |
| `POST /admin/content/publish` | `{base, collections: {<name>: {revision, value}}, note?}` | Compiles, stores and activates a new revision, moves the running server onto it and tells connected clients. |
| `POST /admin/content/rollback` | `{revision}` | Publishes the source collections of an earlier stored revision through the same path. |

`base` is the catalog revision the edit started from. Each entry of `collections` is one whole collection as it sits under `game/content/data/`, with the revision the editor read it at. A collection revision is the SHA-256 of the collection written as canonical JSON: two-space indent, a trailing newline. `GET /admin/content/sources` reports that revision for every collection beside the collections themselves, by the same function this check runs, so a client never computes one. `note` is at most 512 characters and is kept with the revision and the audit row.

A rollback compiles the stored sources of the named revision again, so the retire rule, the asset check and the spawn plan apply to it as they do to any publish. When the server's formulas are the ones that revision was compiled with, the result is that same revision and only the pointer moves. After a server release that changed formulas, the same sources compile to a new revision, and that one becomes active. Either way `catalog_history` gets a new row.

A publish runs in this order, one publish at a time for the whole server:

1. Each sent collection's revision is compared with the active sources. Any mismatch is a 409 that names the stale collections, so a second editor never overwrites the first without seeing their change.
2. The sent collections are merged over the active sources. A server's content is its own copy, so there is no overlay to resolve.
3. Asset ids are checked. See below.
4. The merged sources are compiled with the formula revision the server was built with. The compile takes about 90 ms for the shipped content and runs between two turns of the event loop, outside the tick hold.
5. The tick in flight finishes and the next one waits. The server looks for live instances of any item or creature definition the publish removes: stored characters and stored recovery caches through one JSON query over `players` and `world_players`, online players, their recovery caches, loot piles on the ground, and living creatures in every world.
6. Every world plans the spawn groups that changed, on copies. A creature that cannot be given a walkable floor refuses the publish.
7. The revision is stored and made active, and the `content.publish` or `content.rollback` audit row is written in the same transaction.
8. The process moves onto the new catalog, the worlds take their spawn plans, and every connected peer in every world is sent `{"type":"content-updated","revision":"..."}`. These steps are assignments that cannot fail. If one ever did, the server stops the way it does after a failed commit, and the next start runs the published catalog.

Nothing is written before step 7, so a refused publish leaves the database and the running game as they were. With the authored world, a publish took 225 to 250 ms end to end: about 90 ms to compile, 11 to 25 ms to plan spawns for 1 to 10 changed groups, 32 ms to store, 1 to 3 ms to swap. Ticks were held for 32 to 62 ms, less than one tick interval. [Content authoring](content-authoring.md#publishing-to-a-live-server) says which tables apply at once and which wait for a restart.

The reply to all three is the same:

```json
{"revision":"2c5db1...","previous":"32768c...","unchanged":false,"stored":true,
 "changedCollections":["placements"],"changedTables":["placements","world"],
 "revisions":{"placements":"9d41e8..."},
 "live":["placements","world"],"onRestart":[],
 "affected":{"placements":["redsill_frogs"],"regions":["fallowmarch"],"spawnGroups":["redsill_frogs"]},
 "problems":[],"assetValidation":"bundled",
 "spawns":[{"world":"corealm","added":0,"pending":7,"retiring":0,"removed":0}],
 "notified":12,
 "timings":{"manifestMs":0.2,"compileMs":92,"blockersMs":0.2,"spawnPlanMs":11.1,"storeMs":32,"swapMs":2,"tickStallMs":45.3,"totalMs":239}}
```

`revisions` is the revision each changed collection now has, which is what the next publish will compare a draft against; it is empty when nothing was stored, so a `validate` and an unchanged publish both move nothing. `affected` lists changed record ids by collection and by compiled table, so a loot table edit names the enemies it reaches. `problems` carries compiler warnings and `info` lines. `spawns` counts, per world, creatures added at once, living creatures waiting for their next respawn, creatures that will finish their life and leave, and dead ones removed at once. `validate` answers with `stored: false` and empty `spawns`. A publish that compiles to the active revision answers `unchanged: true` and does nothing.

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body is not `{base, collections, note?}`, a collection name is unknown, or a value has the wrong shape. |
| 401, 403 | `unauthorized`, `forbidden` | No credential, or one without `content:publish`. |
| 404 | `not_found` | Rollback to a revision that is not stored. |
| 409 | `stale_collections` | `error.stale` names the collections, `error.revisions` their current revisions, `error.revision` the active catalog. |
| 409 | `definition_in_use` | `error.blockers` lists up to 20 holders: `{kind:"item", id, heldBy:"player", place, accountId, name}` with `place` one of `inventory`, `bank`, `equipment` or `recovery-cache` (which adds `world`), `{kind:"item", id, heldBy:"loot-pile", world, pileId}` or `{kind:"creature", id, heldBy:"world", world, alive}`. Retire the definition instead. |
| 409 | `already_active`, `no_sources` | Rollback to the active revision, or a catalog that was stored without source collections. |
| 413 | `payload_too_large` | The body is over 16 MiB. It is counted as it streams and dropped at the cap. |
| 422 | `content_invalid` | `error.problems` is the compiler's errors, each `{path, message, severity}`. An unknown asset id is one of them. |
| 422 | `spawn_unplaceable` | A changed spawn group has a creature with no free walkable floor in `error.world`. |
| 502 | `asset_manifest_unavailable` | The asset host's manifest could not be fetched or is not a manifest. |

Asset ids are checked against the asset host the server points its clients at, because a server can only show models that host has. With `assetBaseUrl` set, the server fetches `<assetBaseUrl>assets/manifest.json`, the same file the client loads, with a 10 second timeout, a 32 MiB cap and a shape check. It keeps the result for 5 seconds and then revalidates with the manifest's ETag, so a run of publishes costs one download. Without `assetBaseUrl` it uses the manifest shipped with the server, which run from source is `game/public/assets/manifest.json`. The reply's `assetValidation` is `remote`, `bundled`, or `none` for an embedder that supplied neither. Audio files are not in the manifest, so the paths in the audio catalog are accepted as sent; the schema still checks their shape. A lab-only creature with an unknown model stays a warning.

A connected game client shows one line at the top of the screen, "The server's content was updated. Refresh to load it.", with Refresh and Later buttons. It never reloads by itself and play continues. The session keeps the client catalog it joined with until the page loads again. Every save written after a publish carries the new `catalogRevision`, and a server restarted after a publish boots on the published revision.

### Asset host

A server that sets `assetBaseUrl` puts it on every world descriptor it publishes, so `/worlds` and the join reply both carry it. The client loads its whole public file tree from that base: the asset manifest, models, textures, icons, the display font, sound and the generated terrain, navmesh and world data. The client's own JavaScript and CSS stay on the origin the page was served from. Cross-origin hosting needs `Access-Control-Allow-Origin` on every one of those files; the world map images and the asset image loader request them in CORS mode so the map canvas stays readable.

Boot picks the asset host once, before the first file is requested, from the worlds it discovered. All worlds a page can see must therefore agree on it; a world that names a different host is refused with an incompatible-world message, because a session cannot move hosts without reloading. A page with no server can set `window.__COREALM_ASSET_BASE__` before the game module, which wins over any world's answer and disables that check. With none of this configured the client uses relative paths exactly as before, which is what the GitHub Pages build needs.

For this standalone setup only, load one configuration example before the game module in `game/index.html`:

```html
<script src="/multiplayer.example.directory.js"></script>
```

The files `game/public/multiplayer.example.{single,list,directory}.js` demonstrate all three configuration forms. They are not loaded by default. These examples explicitly enable development guests and target the authored host above. For the lab, use `index.html?mode=combat&multiplayer=1`, world IDs `yard` / `second-yard`, and `fixture: "lab"`. Authored worlds use `fixture: "authored"`. A page refuses a world whose fixture is not the scene it loaded.

Configured game pages show Worlds over the loading screen. The list starts with **Local play only**, which is selected until the player chooses otherwise, followed by the worlds that were found. One button acts on that choice: Play offline puts the panel away and starts the single-player character, Join world enters the selected world, and Leave world returns to local play. Choosing a world before loading finishes shows Join when ready; the join then happens on its own as soon as the first frame is drawn.

Open the game menu with Escape or the minimap menu button to return to Worlds. The list shows population and availability, with incompatible and full worlds disabled for joining. Refresh worlds reloads the configured directory and every added host. Connection failures reopen the menu; the last complete scene stays visible and gameplay waits for a valid snapshot or an explicit return to offline play. Development guest names are shown only when guest mode is explicitly enabled; production deployments supply their authentication adapter.

### Adding a host

Players add their own hosts from the same panel. Type an address into the host field and select Add host: `127.0.0.1:4180`, `worlds.example.com`, a `ws://` endpoint, or a full directory URL. A bare address gets the reference host's `/worlds` path, loopback addresses default to `http` and everything else to `https`, which is what discovery accepts. Added hosts are stored in the browser under `corealm.hosts.v1`, are asked alongside the page's configured directory on every refresh, and are removed with the × beside the address. A host that cannot be reached reports itself in the status line without hiding the worlds other sources returned. Duplicate worlds are listed once. A page with no configuration of its own still shows Worlds when the player has added a host.

The browser currently requires a world's seed to match the loaded authored scene. Each world carries its own seed from the host's configuration, defaulting to 1337; a different seed produces an incompatible-world message. Switching worlds releases the old connection, keeps its frozen scene during connection setup, and replaces that scene when a validated snapshot arrives. Their progression remains independent even when terrain is identical.

Fixed authored scenery stays loaded from that matching map when buildings lie beyond the server's gameplay interest radius. Actors, resources and interactables still come from authoritative snapshots and deltas. This keeps distant structures visible without sending a larger world snapshot to every player.

## The server executable

A release is two files: `corealm-server-win-x64.exe` and `corealm-server-linux-x64`. Each is a Node 24 single executable — the official Node binary with the whole server bundled into it — so a host needs nothing installed, not Node, not a package manager, not a compiler. Everything the server needs at runtime is inside it: the simulation, the content compiler, the baked server world pack, the catalog it seeds an empty database with, `game/public/assets/manifest.json`, and the devdocs server-mode build it serves at `/admin/`. It writes one file, `worlds.sqlite`, plus `server.log` when the console is up.

The authored world always comes from the pack. The server reads no GLB and loads no renderer, and the build refuses a bundle that contains `three`, `@gltf-transform/*` or anything else on its forbidden list. A pack that is missing, of another format, or baked from different sources stops the server at start and names `npm run world:build`. A world configured with a seed the pack was not baked for is refused too, and the message lists the seeds it holds; bake more with `npx tsx tools/build-server-world-pack.ts --seeds 1337,4242`, and check a committed pack with `npx tsx tools/build-server-world-pack.ts --check`.

The executables are unsigned. Windows SmartScreen will warn the first time one runs; choose **More info**, then **Run anyway**, or sign it yourself. Check what you downloaded against the release's `SHA256SUMS`.

### First run

Put the executable in a folder on its own and start it:

```sh
./corealm-server --write-sample-config
./corealm-server
```

`--write-sample-config` writes a `corealm-server.json` next to the executable with every setting an operator has to choose, and prints what each one is for. With no configuration file at all the executable prints a minimal sample and exits **78**, which is why the systemd unit below sets `RestartPreventExitStatus=78`: restarting cannot fix a missing configuration file.

| Flag | Does |
| --- | --- |
| `--help` | Every option, and where the rest are documented. |
| `--version` | `corealm-server <version> (built <time>, node <version>)`. |
| `--write-sample-config` | Writes a documented `corealm-server.json` beside the executable. Refuses to overwrite one. |
| `--tui` | Draws the live console. See below. |
| `--config <path>` | A configuration file somewhere else. Relative to the executable's directory. |

Every setting in [Configuration file](#configuration-file) works the same way, and so does every flag and environment variable there. The executable resolves its configuration file, its data directory and `adminUiDir` against its own directory rather than the working directory, so a service manager may start it from anywhere. Absolute paths are used as given.

### Log lines

The default output is one JSON object per line, one line per event, on stdout. journald keeps them as they are, and so does every log shipper.

```json
{"t":"2026-09-20T22:58:21.445Z","level":"info","event":"ready","ready":true,"host":"0.0.0.0","port":4180,"fixture":"authored-world","authentication":"account","catalogRevision":"b18876ed…","worlds":[{"id":"corealm","name":"Corealm","seed":1337,"capacity":200}]}
{"t":"2026-09-20T22:59:02.118Z","level":"info","event":"session.join","accountId":"acc_9Qr7v2KpLd3XmB1sYwTgHa","detail":"corealm"}
{"t":"2026-09-20T23:04:41.702Z","level":"warn","event":"session.rejected","accountId":"acc_5Lm2p8QrTv1XwYzAbCdEf","detail":"DUPLICATE_LOGIN"}
```

`t`, `level` and `event` always lead. `level` is `info`, `warn` or `error`. Covered events are the start, the ready line, the owner setup code, joins, leaves and rejections, bans, kicks, admin sessions, publishes and rollbacks, storage migration, catalog seeding, every change of directory registration outcome, errors and the shutdown.

**No line ever contains a credential.** Any field named `token`, `session`, `secret`, `password`, `authorization`, `key`, `code` or `credential` is written as `[redacted]`, at any depth, and so is any `cas_…` or `cat_…` that turns up inside a message. The single exception is the `owner-setup-code` event, whose whole purpose is to show the code once.

### The live console

`--tui` replaces the log lines on stdout with a console that redraws once a second: players online against capacity per world, tick time last, mean and p95, memory, bandwidth, commands, rejections, errors, the active catalog revision, and the tail of the same event ring `GET /admin/stats` returns.

```text
  COREALM  Raid Night                                 up 3h 12m   0.0.0.0:4180

  WORLDS
    Corealm          12 / 200   players    tick 9031
    Corealm II        0 / 50    players    tick 9031

  tick     last 21.4 ms  mean 23.9 ms  p95 29.5 ms
  memory   rss 1.1 GiB   heap 393.3 MiB
  traffic  out 87.0 MiB  98.7 KiB/s
  commands 4821          rejected 3    errors 0
  catalog  9f2c1d4e7a0b3358   auth account

  EVENTS
    00:00:01  join          acc_9Qr7v2KpLd3XmB1sYwTgHa  corealm
    00:00:02  rejected      acc_5Lm2p8QrTv1XwYzAbCdEf   DUPLICATE_LOGIN
    00:00:03  leave         acc_5Lm2p8QrTv1XwYzAbCdEf   corealm

  log lines to /var/lib/corealm-server/server.log      Ctrl+C stops the server
```

It is plain ANSI: the alternate screen, a hidden cursor, one write per frame, and ASCII characters only, because box drawing turns into mojibake on a Windows console left on code page 437. p95 tick time turns red above 100 ms. The terminal is restored on exit, on Ctrl+C and after a crash. Resizing redraws.

While the console is up the log lines go to `server.log` in the data directory, capped at 8 MiB with one rotation kept as `server.log.1`. With stdout redirected to a file or a pipe, `--tui` says so once and keeps writing log lines, so a service manager can pass it harmlessly.

### systemd

`corealm-server.service` ships with the Linux release and is in the repository at `deploy/corealm-server.service`.

```sh
sudo useradd --system --home /opt/corealm --shell /usr/sbin/nologin corealm
sudo install -d -o corealm -g corealm /opt/corealm
sudo install -o corealm -g corealm -m 0755 corealm-server-linux-x64 /opt/corealm/corealm-server
sudo install -o corealm -g corealm -m 0640 corealm-server.json /opt/corealm/corealm-server.json
sudo install -m 0644 corealm-server.service /etc/systemd/system/corealm-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now corealm-server
journalctl -u corealm-server -f
```

Set `"data": "/var/lib/corealm-server"` in the configuration file. The unit's `StateDirectory=corealm-server` creates that directory with the right owner, and `ProtectSystem=strict` makes everything else read-only. The hardening is the usual set minus two: `MemoryDenyWriteExecute` stays off because V8 needs writable-executable pages, and the data directory stays a real writable filesystem because SQLite's WAL needs its `-wal` and `-shm` files beside the database. `TimeoutStopSec=60s` gives every world time to save its players.

The server speaks plain HTTP and `ws`, so put it behind a reverse proxy for TLS. One origin carries all three: the WebSocket, `/admin` and `/catalog`.

```nginx
server {
  listen 443 ssl http2;
  server_name worlds.example.com;
  ssl_certificate     /etc/letsencrypt/live/worlds.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/worlds.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:4180;
    proxy_http_version 1.1;
    # The game connection is a WebSocket. Without these two headers it never upgrades.
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # A world connection is long lived and quiet between ticks.
    proxy_read_timeout 1h;
    # A content publish body is up to 16 MiB.
    client_max_body_size 20m;
  }
}
```

`publicEndpoint` must be exactly what the proxy publishes, `wss://worlds.example.com/`, because every join token is minted for that audience. `allowedOrigins` must list the origin the game page and the admin UI are served from. Keep the server bound to `127.0.0.1` when a proxy is in front of it.

### Building the executables

```sh
npm ci
npm run devdocs:build:server     # writes dist/devdocs-server
npm run server:build             # writes dist/server
```

`npm run guide:build` empties `dist/`, so run it before `server:build`, never after. The build:

1. bundles `tools/multiplayer-server.ts` to one CommonJS file with esbuild;
2. stages the SEA assets — the server world pack, the admin UI archive, the seed catalog with its `formulaRevision`, the asset manifest and a build record;
3. builds the blob with `node --experimental-sea-config`, keeping `useCodeCache` and `useSnapshot` off, which is what makes the blob platform independent and lets one machine produce both executables;
4. downloads the official Node binary of the exact version that generated the blob, checks it against that release's `SHASUMS256.txt`, copies it and injects the blob with `postject`.

| Option | Does |
| --- | --- |
| `--targets win-x64,linux-x64` | Which executables to produce. |
| `--version <name>` | What `--version` reports. Defaults to the tag, then `package.json`. |
| `--cache <dir>` | Verified Node binaries, kept between builds. Default `.cache/node-binaries`, about 120 MB per target. |
| `--admin-ui <dir>` | Default `dist/devdocs-server`. |
| `--forbid a,b` | Packages the bundle may not contain. The default list is the renderer, the GLB reader and the bake's dependencies; `--allow-forbidden` builds anyway, which is for looking at a bundle and never for a release. |
| `--bundle-only` | Stop after the blob. Prints the bundle's largest modules. |

The build prints the bundle's size by package and every asset's size, so a release that grew has somewhere to look. On Windows it tries `signtool remove` first; the Windows SDK is usually absent, and the build says so and carries on, because the release executable is unsigned either way.

Install before import survives bundling. The entry installs the database's catalog and only then reaches the simulation through `await import()`, which esbuild keeps lazy; `tests/server-bundle-ordering.test.ts` proves that against the exact options the build uses, and `test-results/m6/exe-proof.ts` proves it against the finished binary by starting it on a database whose catalog no build contains.

### Releases

`.github/workflows/release.yml` runs on a `v*` tag. It builds the admin UI, checks that the committed world pack is current, builds both executables, starts the Linux one from an empty folder with a generated configuration file, checks `/healthz`, `/worlds` and `/admin/`, stops it with `SIGTERM` and asserts a clean exit, then attaches both executables, the systemd unit, a sample configuration file and `SHA256SUMS` to a GitHub release. It needs no secret beyond the default `GITHUB_TOKEN` with `contents: write`. A `workflow_dispatch` run does everything except publish, which is the way to try a release without tagging.

## Registration and authentication

`window.__COREALM_MULTIPLAYER__` accepts `WorldConfiguration` from `game/src/contracts.ts`: one descriptor, an array, or `{directoryUrl}`. Descriptors contain provider/world IDs, name, endpoint, protocol version, fixture, seed, population, capacity, availability, and an optional `assetBaseUrl`. Static population is the discovery-time count, not an admission guarantee. The host decides admission atomically.

`WorldProvider` separates discovery, authentication, and transport from gameplay. Register alternative implementations through `window.__COREALM_PROVIDERS__`. Other configured provider IDs use the reference WebSocket adapter. Adapter conformance tests exercise it and an independent deterministic adapter.

Protocol 2 adds public actions, visible activity timing, and authoritative targeted/area invocation commands. Update the browser and host together. Protocol 1 sessions are rejected explicitly. Existing durable character saves retain their storage schema.

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
{"t":"2026-09-20T22:58:21.445Z","level":"info","event":"owner-setup-code","code":"K7M3Q-2WXPR-9TVBH-4CJ8N","message":"Sign in to devdocs and enter this code to become the owner of this server. It is shown once and is replaced on the next start."}
```

This is the only line that carries a secret, and it is the only one the logger is allowed to write one in. See [log lines](#log-lines).

The code is 20 Crockford base32 characters, so 100 bits, and the database keeps only its SHA-256 hash. It does not expire; a restart with still no owner replaces it with a new one. Reading it back is impossible. Sign in through the identity service, then `POST /admin/setup` with that join token and the code. The first caller to get it right becomes owner and the code is spent, for everyone, including them. Typing is forgiving: any case, any separators, and O, I and L read as 0, 1 and 1. Wrong answers are capped at five per source address and twenty in total per minute, and a wrong code and a spent code give the same reply.

Set `ownerAccount` instead to name the owner in configuration. The host grants the role at start, records it in the audit log under the `config` credential and prints no code.

### Roles, bans, and tokens

Roles are `owner` and `admin`, by account id. Only an owner grants or revokes `admin`. No admin can demote an owner, an owner cannot be banned, and the last owner cannot be removed.

Bans are per server, by account id, with a reason, an optional expiry, who set it and when. A banned account is refused at the join with `BANNED` and the reason, is refused an admin session, and loses any admin session it holds. Banning someone who is playing disconnects them through the ordinary leave path, so their character is saved and their lease is freed. An expired ban stops applying on its own; nothing sweeps.

Devdocs signs in with `POST /admin/session`, exchanging a join token for a session token that starts `cas_` and lasts 12 hours. Automation uses API tokens, which start `cat_`, carry scopes, and expire only if given an expiry. Both are 32 random bytes, stored only as a SHA-256 hash, compared in constant time, and shown once at creation. A session carries every scope; a token carries only what it was created with and can never mint a token or grant a role.

| Scope | Allows |
| --- | --- |
| `content:read` | Reading source collections and the server catalog, for devdocs and the export workflow. |
| `content:publish` | Publishing a catalog. |
| `players:read` | `GET /admin/players`, `GET /admin/bans`. |
| `players:write` | `POST /admin/bans`, `DELETE /admin/bans/<accountId>`, `PATCH /admin/players/<accountId>`, `POST /admin/players/<accountId>/kick`. |
| `stats:read` | `GET /admin/stats`. |

### Endpoints

JSON in, JSON out. Failures are `{"error":{"code","message"}}` and every reply is `Cache-Control: no-store`. `Authorization: Bearer <cas_… or cat_…>`. CORS allows the exact origins in `allowedOrigins` and never `*`; a request from any other origin gets no allow header, and its preflight gets 403. Bodies are capped at 8 KiB, 128 KiB for a player edit, or 16 MiB for a content publish, and every field, header, query value and path segment is validated at the boundary.

| Endpoint | Credential | Does |
| --- | --- | --- |
| `POST /admin/setup` | join token + code | Makes the caller owner and returns a session. |
| `POST /admin/session` | join token | Returns `{session, expiresAt, accountId, name, role}` for a role holder, otherwise 403. |
| `DELETE /admin/session` | session | Revokes the presenting session. |
| `GET /admin/info` | none | `{name, description, endpoint, assetBaseUrl, identityUrl, authentication, catalogRevision, worlds}`. What a login screen needs before anyone has signed in: where to sign in, and the `endpoint` to ask the identity service for a token for. No secrets. |
| `GET /admin/me` | session or token | `{credential, accountId, tokenId, role, scopes, server}`. `server` is `{name, endpoint, assetBaseUrl, identityUrl, catalogRevision}`. |
| `GET /admin/roles` | session | Every role holder. |
| `PUT /admin/roles/<accountId>` | owner session | Body `{"role":"admin"}`. |
| `DELETE /admin/roles/<accountId>` | owner session | Removes a role. |
| `GET /admin/bans` | `players:read` | Live bans only. |
| `POST /admin/bans` | `players:write` | Body `{accountId, reason, expiresAt?}`. Returns `{ban, kicked}`. |
| `DELETE /admin/bans/<accountId>` | `players:write` | Lifts a ban. |
| `GET /admin/tokens` | session | Metadata only: id, label, scopes, createdBy, createdAt, lastUsedAt, expiresAt. |
| `POST /admin/tokens` | session | Body `{label, scopes[], expiresAt?}`. The reply is the only place the secret exists. |
| `DELETE /admin/tokens/<id>` | session | Revokes a token. |
| `GET /admin/audit?limit=&before=&action=&account=&target=` | session | Newest first. `before` is an id from the previous page. `action`, `account` and `target` are prefixes: `action=player.` finds every player write. |
| `GET /admin/settings`, `PATCH /admin/settings` | session | See [Settings](#settings). |
| `GET /admin/stats` | `stats:read` | Below. |
| `GET /admin/content/revision?limit=` | `content:read` | `{revision, history}`. `history` is the pointer moves, newest first, each `{id, revision, previous, by, at}`. `limit` is 1 to 200, default 50. |
| `GET /admin/content/sources?revision=` | `content:read` | `{revision, revisions, sources}`: the source collections that revision was compiled from, keyed by collection name as under `game/content/data/`, and the revision of each one as a publish checks it. Omit `revision` for the active one. 404 when it is not stored. |
| `GET /admin/content/catalog/<revision>` or `/active` | `content:read` | The whole server catalog as JSON, loot odds and spawn tables included, so it is `Cache-Control: private`. A revision is a content hash and is `immutable` for a year; `active` is a pointer and is `no-cache`. `ETag` and `X-Catalog-Revision` carry the revision. Served brotli or gzip. |
| `POST /admin/content/validate`, `/publish`, `/rollback` | `content:publish` | See [Publishing content](#publishing-content). |
| `GET /admin/players?query=&limit=&cursor=` | `players:read` | Summaries, newest seen first. `cursor` comes from the previous page. |
| `GET /admin/players/<accountId>` | `players:read` | One player with inventory, bank, equipment, skills and `revision`. |
| `PATCH /admin/players/<accountId>` | `players:write` | Body `{ops[], expect?}`. See [Editing a player](#editing-a-player). |
| `POST /admin/players/<accountId>/kick` | `players:write` | Body `{reason?}`. Returns `{kicked}`, or 409 `not_online`. |

A player who is online is read from the world holding them, not from the row the last commit wrote, so devdocs shows what the player is carrying right now.

### Editing a player

An edit goes through the running server and never straight to the database. The body is a list of typed operations, applied in order to a copy of the character. If any operation is malformed, names something the active catalog does not have, or does not fit, the whole patch is refused and nothing changes. The error names the operation: `{"error":{"code","message","op":2}}`. 400 is a patch that could never apply, 409 one that does not fit this player right now.

| Operation | Fields | Rule |
| --- | --- | --- |
| `inventory.set` | `slots`: up to 28 of `{itemId, quantity}` or `null` | The slot list as given, padded with empty slots. An item that does not stack holds 1 per slot. One that stacks fills one slot only. |
| `inventory.add`, `inventory.remove` | `itemId`, `quantity` | All of it or none: adding needs the free slots, removing needs the items. |
| `bank.set` | `slots`: up to 400 of `{itemId, quantity}` | Everything stacks in the bank, one row per item. |
| `bank.add`, `bank.remove` | `itemId`, `quantity` | The bank holds 400 kinds. |
| `equipment.set` | `slot`, `itemId` or `null` | The item must be wearable on that slot, and a two-handed weapon needs an empty off hand. Skill requirements are yours to override: unmet ones come back in `warnings` and the item is equipped anyway. |
| `currency.set` | `amount` | Gold is a balance, not a carried item, so `inventory.add` refuses it. |
| `skill.setXp` | `skill`, `xp` | 0 to 9,999,879. The level is recomputed from the XP table. |
| `position.set` | `world`: `{providerId, worldId}`, `regionId`, `position`: `[x, y, z]` | `world` must be the world the player is in, or the last one they were in. The region must exist, and the position snaps to walkable ground within 8 m or is refused. It stops whatever the player was doing, as a portal does. |

Quantities are whole numbers from 1 to 2,147,483,647, item ids must exist in the active catalog, and a retired item still counts as existing. A patch is at most 64 operations. There is no operation for a name: names belong to the identity service.

`GET` returns `revision`, a short hash of the inventory, bank, equipment, gold and skills. Send it back as `"expect":{"revision":"…"}` and an edit made from a stale view answers 409 `revision_mismatch` instead of overwriting what the player just looted. Position is left out of the hash so that an edit does not lose a race with a walking player.

The reply is `{applied, world, changed, warnings, player}`. `applied` is `live` or `stored`, `player` is the same body `GET` returns, after the edit. A patch that changes nothing answers `changed: false` and writes no audit row.

**Online.** The server applies the edit between ticks, inside the same hold a content publish uses, to the character the world is simulating. Max health, equipment bonuses and the player's own client follow through the ordinary tick: the client gets the change as a private delta one tick later, with `item.received` and `item.lost` events marked `source: "admin"`. The audit row rides that tick's commit, in the transaction that writes the edited character, and the reply waits for it. So the two land together: a crash or a failed commit loses both and the editor is told 503, and a lease that was lost in that instant writes neither and answers 409 `player_busy`.

**Offline.** The server writes the stored character with a compare and set under the player lease, and the audit row in the same transaction. The write is refused while a live session holds the account, or if the stored character is no longer the one the edit was computed from; the server then tries again, against the world the player has meanwhile joined. After a second of that it answers 409 `player_busy`. A player who joins at the same instant either claimed first, and is edited live, or claims after, and loads the edited character.

**Just disconnected.** Until the next commit saves a dropped player, their world still holds them, and the edit goes there and is saved with them. After it, the account is inside the 30 second reconnect reservation: the world has saved them and writes no more, so the edit goes to the stored character, and the reconnect loads it. A world that keeps a copy of an offline player for their campfire or recovery cache never writes that copy's character and never uses it for a join, and the edit refreshes the copy anyway so a publish that asks who holds an item gets the truth.

The audit row is `player.edit` with the account as `target`. `before` and `after` hold only what changed: inventory and bank slots by index, equipment by slot, skills by id, `currency`, `position`. `after` adds `applied`, and `world` for a live edit.

### Kicking a player

`POST /admin/players/<accountId>/kick` disconnects an account from whichever world holds it. The client gets `{"type":"error","error":{"code":"KICKED","message":"Kicked from this server: <reason>"}}` and the socket closes with 4000. A kick goes through the ordinary leave path as a deliberate leave: the character is saved and the lease is released on the next commit, with no reconnect reservation, so the player may join again at once. It is not a ban. The audit row is `player.kick` with `{reason}`, written before the disconnect. An account that is not connected answers 409 `not_online` and nothing is recorded.

### Settings

Some settings change while the server runs, with no restart. The configuration file, with its flags and environment variables, gives the default. A value an admin stores in the database overrides it, and clearing the stored value with `null` gives the default back.

| Setting | Body | Effect |
| --- | --- | --- |
| `name` | `"name": "Raid Night"` | What the public directory lists the server as. 3 to 48 letters, digits, spaces or `_ . ' -`. Default `Corealm server`. |
| `description` | `"description": "Fridays"` | Up to 200 characters. Shown in `/worlds` on every world, and in the directory. |
| `registerWithDirectory` | `"registerWithDirectory": true` | See [Directory registration](#directory-registration). Needs `identityUrl`. |
| world capacity | `"worlds": {"corealm": {"capacity": 120}}` | 1 to 1000. Decides the next join. Players already in stay when it drops below them, and `/worlds` then reports the world as full. |

`GET /admin/settings` and `PATCH /admin/settings` need an admin session, not an API token. Both return `{settings, overrides, defaults}`: what is in force, what is stored, and what the configuration says. A patch is validated whole before anything is stored. It writes one `settings.set` audit row, in the same transaction, whose `before` and `after` hold the stored keys that moved: `name`, `description`, `registerWithDirectory` and `capacity.<worldId>`.

### Directory registration

With `registerWithDirectory` on, the server sends `POST <identityUrl>servers/register` with `{name, endpoint, description?}`, where `endpoint` is its public endpoint. It does so at start, again whenever the setting, name or description changes, and every four minutes after, because the directory drops a server that has been silent for ten. The identity service checks that the endpoint is a public `wss:` address that answers `GET /worlds`, so a loopback server is refused unless the service allows private registration.

The directory is a convenience. A refusal or an unreachable service never stops play: the server logs `directory.refused` with the status and reason, or `directory.unreachable`, once per change of outcome, then `directory.registered` when it works again.

### The admin UI

The server serves the devdocs server-mode build at `/admin/`. The [single executable](#the-server-executable) carries that build inside itself as one archive and needs no directory. Run from a checkout, build it with `npm run devdocs:build:server`, which writes `dist/devdocs-server`; `adminUiDir` names another directory. When there is no build, `/admin/` answers 404 `admin_ui_missing` with that command in the message, and the API works as before. The same build also runs from any other origin listed in `allowedOrigins`.

The JSON API lives under `/admin/` as well, so the split is fixed:

- The API owns these first path segments, for every method and whatever the `Accept` header says: `info`, `setup`, `session`, `me`, `roles`, `bans`, `tokens`, `audit`, `content`, `stats`, `players`, `settings`. A browser that navigates to `/admin/players` gets the API's JSON.
- Everything else under `/admin/` is a static file, `GET` and `HEAD` only. The app routes in the URL fragment (`/admin/#/players`) and loads its files by relative path, so it never needs a path the API owns.
- `/admin` redirects to `/admin/`, because relative paths only resolve under the slash. A path with no file extension is a stale link: directly under `/admin/` it gets the page, any deeper it is redirected to `/admin/`.

`index.html` is `Cache-Control: no-cache` with an `ETag`. Files Vite wrote as `assets/<name>-<hash>.<ext>` are `public, max-age=31536000, immutable`; anything else is cached for five minutes. A path is decoded once and refused with 400 if it holds `..`, a dot file, a backslash, a colon, an empty segment, a control character or a second layer of percent-encoding, and the directory source refuses anything that resolves outside it.

Files are compressed on the way out. A request that accepts `br` gets brotli, one that accepts only `gzip` gets gzip, and one that accepts neither gets the bytes as they are; every answer carries `Vary: Accept-Encoding`, and each encoding has its own `ETag`, so a cache in the middle cannot hand one client another's copy. The editor's main chunk is 4,172,106 bytes and goes out as 291,497 brotli or 479,473 gzip. Nothing is compressed ahead of time: the first request for a file compresses it, which costs about 26 ms for that chunk and nothing afterwards, and the copies are kept in memory up to 8 MB. Already-compressed types (`.png`, `.jpg`, `.webp`, `.avif`, `.gif`, `.ico`, `.woff`, `.woff2`, `.glb`, `.ktx2`) and files under a kilobyte are sent as they are.

The page is served with:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' <hash of each inline script>; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: <asset origin>; font-src 'self' data:; connect-src 'self' blob: data: <identity origin> <asset origin>;
  media-src 'self' blob: <asset origin>; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

The identity origin comes from `identityUrl` and the asset origin from `assetBaseUrl`, so sign-in requests and model previews work and nothing else does. `'wasm-unsafe-eval'` is for the syntax highlighter's grammar engine, and inline styles are allowed because the component kit sets them. Every other file is served with `default-src 'none'; sandbox`, which makes an SVG opened on its own inert. The identity service hands the session back in the URL fragment, which a browser never sends in `Referer`; `no-referrer` keeps the rest of the URL private as well.

### Using the admin UI

Open `https://<your server>/admin/`. The page signs in through the identity service the server names, so the first screen is **Sign in**, which leaves for that service's own sign-in form — a password is typed there and never in devdocs — and then **Open this server**.

The first time, nobody holds a role yet, so that answers "This account holds no role on this server". Take the setup code the server printed at its first start, press **Enter setup code**, paste it and press **Claim this server**. That account becomes the owner, the code is spent, and the editor opens. An account that is not an owner or admin stops at the same screen and is never given a session.

Two workspaces appear that a repository checkout does not have. Everything else — items, creatures, the world map, quests, shops, spells — is the content editor, and **Save all** there publishes to the running server rather than writing files.

**Players** lists every account this server has seen, searched by name or account id. Choosing one shows what they are carrying right now, read from the world holding them when they are online:

- **Character** is the editable half: the 28 inventory slots, the bank, every equipment slot, gold, skill experience and position. Nothing is sent as it is typed. Edits collect in a panel at the top of the record which names each one in words, and **Apply** sends them as one patch against the record you read. A player who changed in between gets it refused rather than overwritten, and the record reloads. The result says whether it went to the live character or to the stored one, and repeats any warning the server gave, such as an item equipped over an unmet skill requirement.
- **Audit** is that player's own history.
- **Kick** and **Ban** are beside the name. Both state what will happen before they do it. A ban needs a reason and takes an optional expiry.

**Server** is the host itself:

- **Overview** reads `GET /admin/stats` about once a second while the tab is in front and stops while it is behind another: players per world against capacity, tick and stage times, memory, bandwidth, errors, the active catalog revision, and the recent events ring.
- **Publishes** is every move of the catalog pointer, with who, when and the note, and a **Roll back** on each. A rollback is a publish of that revision's sources, so it can be refused for the same reasons any publish can.
- **Settings** is name, description, directory registration and per-world capacity. A value an admin stored here carries an **override** badge and a **Restore default** that gives the configuration file's value back.
- **Access** is roles and API tokens. Only an owner grants or removes a role; an admin sees the controls disabled with the reason. A new API token's secret is shown once, in the panel that creates it, and never again.
- **Audit log** is every administrative write, filtered by kind, by who did it or by what it was done to.

`audit_log` gets one row inside the same transaction as the write that caused it: `id`, `at`, `account_id`, `credential`, `action`, `target`, `before` and `after`. The credential is `session`, `token:<id>`, `setup` for the one-time code, `config` for `ownerAccount`, or `login` for the join token that minted a session. Actions are `owner.setup`, `role.set`, `role.revoke`, `ban.set`, `ban.remove`, `token.create`, `token.revoke`, `session.create`, `session.revoke`, `content.publish`, `content.rollback`, `player.edit`, `player.kick` and `settings.set`. The one exception to "same transaction as the write" is an edit to an online player, whose write is the next tick commit: the row is in that commit. The content rows have the new revision as `target`, `{revision}` of the catalog it replaced as `before`, and `{revision, base, note, changedCollections, changedTables}` as `after`.

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
  "events": [{ "at": 1758327303000, "kind": "join", "accountId": "acc_...", "detail": "corealm" }],
  "catalogRevision": "9f2c…",
  "server": { "name": "Raid Night", "description": "Fridays", "endpoint": "wss://play.example.com/", "assetBaseUrl": "https://cdn.example.com/corealm/",
    "identityUrl": "https://identity.example.com/", "authentication": "account", "catalogRevision": "9f2c…", "host": "0.0.0.0", "registerWithDirectory": true,
    "worlds": [{ "providerId": "reference", "worldId": "corealm", "name": "Corealm", "seed": 1337, "capacity": 200 }] }
}
```

Tick figures come from the ring of the last 36,000 ticks, an hour at 10 Hz. Stage times are that stage's total divided by the number of samples, so they are a per-tick average over the life of the process, not a recent window. `bytesOutPerSecond` is the same kind of average. `server` is the settings summary the devdocs `server` workspace shows, with no secrets in it; the publish history is `GET /admin/content/revision`. `events` is a bounded ring of the last 256 of `join`, `leave`, `rejected`, `ban`, `unban`, `kick`, `admin-session` and `owner-setup`, oldest first; M6's console reads the same ring.

When each world runs in its own thread the body also has `threads`. `mode` is what the host asked for, `"on"` or `"auto"`. Per world it gives `worldId`, `available`, `restarts`, `failures` and `abandoned` (see [scaling](#scaling-on-one-machine)), `bootMs`, `buildMs`, its recent `ticks`, its `stages` totals, `heapUsedBytes`, `utilization` of its event loop and `cpuMs`; for the database thread it gives `calls`, `commits`, `commitMs`, `commitWaitMs`, `busyMs` and `utilization` since the last request. `tick` and `stages` above then cover every world's ticks together, and `worlds` is at most a second old. The field is absent when threads are off, which is what the devdocs **Server → Overview** Threads card reads to say so.

Without a credential the endpoint answers 401, and with a token that lacks `stats:read` it answers 403.

### Content workflows and their secrets

A server owns its own content. The repository's catalog seeds an empty database once and nothing flows back after that, so neither of these workflows is part of the normal loop. Both are manual, both run inside the repository they live in, and both read or write one configured server. A server cannot trigger either one.

| Workflow | When | Scope it uses | What it does |
| --- | --- | --- | --- |
| `.github/workflows/content-export.yml` | Manual only | `content:read` | Reads the active revision's source collections, writes them into `game/content/data/`, recompiles, and opens a pull request on the branch `content/live-export` that a human has to merge. Use it to back up a server's content, or to promote a change into the base game. |
| `.github/workflows/content-publish.yml` | Manual only | `content:publish` | Pushes the collections this branch differs on to a server you administer, for restoring a backup or loading content you authored offline. Validates by default; storing is an explicit choice. |

Both run `tsx` tools you can run yourself, which is the honest way to see what a workflow will do:

```sh
COREALM_CONTENT_TOKEN=cat_… npm run content:export:server -- --server https://play.example.com/ --dry-run
COREALM_CONTENT_TOKEN=cat_… npm run content:publish:server -- --server https://play.example.com/ --confirm "Raid Night" --validate-only
```

The token comes from `COREALM_CONTENT_TOKEN` and nowhere else. Both tools refuse a `--token` flag, because a command line is visible to every other process on the machine, and they strip the token out of any error before printing it. A server URL must be `https:` unless it is loopback, and may carry no credentials, query or fragment.

#### What to configure, once

| Kind | Name | Value |
| --- | --- | --- |
| Repository variable | `COREALM_SERVER_URL` | The one server the export reads, e.g. `https://play.example.com/`. A run can override it. |
| Repository secret | `COREALM_CONTENT_READ_TOKEN` | A `cat_…` token with `content:read` only. |
| Environment | `live-server` | Protects the publish workflow. Add required reviewers so a publish waits for a human. |
| Environment secret | `COREALM_CONTENT_PUBLISH_TOKEN` | A `cat_…` token with `content:publish`, stored **in that environment**, not at repository level, so the approval gate is the only way to reach it. |

Mint each token in the admin UI: **Server → Access → API tokens → New token**, label it after the workflow, tick only the scope it needs, and copy the secret then. It is shown once. Give the publish token an expiry and mint a fresh one when it lapses; the export token can live longer because reading is the safe direction. Revoking a token in the same panel takes effect at once.

Set the environment up in **Settings → Environments → New environment**, name it `live-server`, add the reviewers who may approve a publish, and add `COREALM_CONTENT_PUBLISH_TOKEN` as an environment secret there. Optionally restrict the environment to the default branch. With no environment of that name, GitHub creates one with no protection on the first run, so the reviewer list is the part that actually guards it.

Neither workflow prints a token, passes one on a command line, or grants itself more permission than it needs: the export holds `contents: write` and `pull-requests: write`, the publish holds `contents: read`. Both use `actions/checkout` and `actions/setup-node` and no third-party action; anything third-party added later must be pinned by full commit SHA. The export skips with a notice, rather than failing, when the variable or the secret is missing, so a fork stays green.

The export opens its pull request as GitHub Actions. A repository forbids that by default: switch on Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests". Without it the run pushes `content/live-export`, fails, and prints the comparison link so the pull request can be opened by hand.

### The self-test, which needs nothing

`.github/workflows/content-selftest.yml` proves the two tools work, with no hosted server and no secret. It is a test of the tools, not a flow anybody is meant to run on a schedule. It runs `npm run content:selftest`, which boots a real game server on loopback with a throwaway database, mints a real `cat_…` token through the admin API, publishes a small loot edit the way devdocs publishes one, runs the export tool's own command line against it, and asserts that the checkout now holds exactly that edit: one authored file changed, the bytes are the canonical writer's, the content still compiles. It runs on any branch whose push touches the content tooling, the content compiler or the server's content endpoints. It is not a required check.

Run it yourself with `npm run content:selftest`. On a working checkout it exports into a temporary copy of `game/content/data` and refuses to touch the real one; `--in-place` is for CI and disposable clones.

What the self-test cannot see on its own is GitHub: the branch, the pull request, the runner's credential. Run the workflow once from Actions → Content sync self-test → Run workflow with **open_pr** ticked, and it does that last mile against a throwaway branch `content/selftest-<run id>`, checks the pull request's own diff with `gh pr diff`, then closes the pull request and deletes the branch. Tick **keep_pr** as well if you want to look at it afterwards. It uses the default `GITHUB_TOKEN` and no secret of yours.

#### Reading the export pull request

The branch `content/live-export` belongs to the workflow and is rebuilt from the default branch on every run, so the pull request always shows the server's content against the branch you would merge it into. The body names the server, the revision, who published it and when, and the record ids in each changed collection. Review it as what it is: a proposal to move one server's edits into the base game. Merging it changes the base game for every server seeded after it, and changes nothing on any server already running.

A pull request whose diff is only `game/content/compiled/catalog.json` means the data is the same and this branch's balance formulas are not the ones the server's release was built with. Formulas are TypeScript that ships with a server release; only data is exported. The tool says so in the body rather than failing.

#### When both sides changed

The publish sends each collection with the revision the server itself reported for it. If somebody edited that collection in devdocs since this branch last exported, the server answers 409 `stale_collections` and the workflow fails with:

> Somebody edited this server in devdocs, and that server owns its content, so nothing is being forced. Export the server's content, reconcile it with this branch, then publish again.

There is no force flag, and adding one would be the wrong fix. Reconciling two people's edits to the same records belongs somewhere both are visible, not in a CLI that picks a winner. Export the server's content, work out what this branch should hold, then publish.

Two other refusals are worth knowing before you see them. `definition_in_use` means the publish removes an item or creature that a player is still holding or that is alive in a world; the message lists the holders, and the fix is to set `retired: true` on the definition instead. `wrong_server` means `--confirm` did not match the name the server reports at `GET /admin/info`, and nothing was sent. That check runs before anything is read, so a URL pasted from the wrong tab costs nothing.

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

Databases written before the players table kept a whole player inside each world. Opening one migrates it once, in a single transaction. Reopening does nothing. The host prints one JSON line, `{"t":"...","level":"warn","event":"storage-migrated","from":1,"to":2,...}`, with the number of worlds and players and every conflict it resolved. When the same player id exists in several worlds, the character with the most total skill XP is kept, then the one from the world with the higher tick, then the lower world key. The host discards the other characters, inventories included, and names them in that line. Every world keeps what the player owned there, its receipts and its random cursor. The host backs nothing up. Copy the data directory first if you may need the discarded characters. A database with a newer `schema_version` than the host understands is refused.

Format 3 adds the catalog tables and replaces the hand-edited `contentVersion` in each world row. `corealm-pve-1` becomes `fixture: "authored"` and `corealm-pve-1:lab` becomes `fixture: "lab"`. The row also gains `catalogRevision`, the revision the save was written under, which is `null` for a migrated save because nothing recorded it. The host prints `{"event":"storage-migrated","from":2,"to":3,"worlds":N}` and records `schema_version` 3 in the `meta` table. A save loads under any catalog revision, because content changes while a world lives. It still refuses a different fixture or seed. When a world loads a save, each saved creature takes its model and scale from the world built from the running catalog, and keeps its health, position and timers.

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

### Scaling on one machine

A server with more than one world runs each world in its own thread, and one more thread owns the database. The main thread keeps the sockets, login checks, the admin API and the log. `threads` in the configuration file, `--threads` or `COREALM_THREADS` takes `"auto"`, `"on"` or `"off"`. `"auto"` is the default and means on when there is more than one world. `"off"` runs every world in the main thread's one loop, which is how the server worked before and how tests and tools still run it. [Architecture](./architecture.md) says what runs where.

Size the machine at one core per world plus two, for the main thread and the database thread, and at about 700 MB of memory per world on top of about 200 MB for the rest. Each world thread loads the content, the catalog and its own world. The ten megabyte world pack is the one thing they share: every world reads it through one block of shared memory. Worlds boot side by side, so two worlds are ready in about the time one takes.

A one-world server gains nothing from a thread of its own. Measured below, its tick is two milliseconds slower and it holds about 100 MB more, which is why `"auto"` leaves it in the main thread.

The measurement is `npm run multiplayer:capacity -- --scaling`. It starts N authored worlds on one server and gives each K simulated players from a load process of its own. Every player joins at the world's spawn, steers for two seconds in every ten, and once every ten seconds asks for a path to a point up to forty metres away. All K stand in one crowd, so each tick replicates everyone to everyone. Each run uses a fresh server and database, waits until every player is in, and measures 60 seconds. The table gives the median of three runs on an Intel Core Ultra 9 285K with 24 logical cores, Windows 11, Node 24.14, K = 40. With threads on, the tick is the slower world's own tick. With threads off one loop ticks every world in turn, so the tick is all of them together, and that is how late an update reaches a player.

| Worlds | Threads | Tick p50 | Tick p95 | Tick p99 | Main loop lag p50 / p99 | Peak RSS | Boot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off | 36.3 ms | 75.5 ms | 89.7 ms | 15.8 / 91.9 ms | 774 MB | 4.0 s |
| 2 | off | 72.8 ms | 157.6 ms | 358.2 ms | 25.4 / 221.1 ms | 1094 MB | 7.7 s |
| 2 | on | 35.3 ms | 73.9 ms | 98.1 ms | 15.6 / 20.5 ms | 1556 MB | 5.4 s |
| 1 | on | 38.8 ms | 95.3 ms | 309.0 ms | 15.6 / 24.7 ms | 871 MB | 4.4 s |
| 3 | on | 36.7 ms | 89.0 ms | 243.0 ms | 15.6 / 23.7 ms | 2214 MB | 4.9 s |
| 3 | off, one 30 s run | 122.4 ms | 302.4 ms | 757.5 ms | 133.8 / 676.3 ms | 1319 MB | 11.3 s |

Two worlds in one thread tick in twice the time of one, and the second world pushes p95 past the 100 ms tick. Two worlds in their own threads tick like one world alone: 35.3 ms against 36.3 ms at p50 and 73.9 ms against 75.5 ms at p95. Each world thread used 0.33 of a core, and the whole process 0.75 of a core against 0.36 for one world. The main loop lag of about 15 ms at p50 is the resolution of the timer that measures it on an idle loop; the p99 is the number to read, and with threads on the main thread stays free whatever the worlds do. Tail latency in the threaded rows varies from run to run with how long SQLite's synchronous flush takes on this disk. The database thread ran 5 percent busy with one world, 6 percent with two and 8 percent with three. With two worlds a commit waited 1.8 ms at p50 and 2.7 ms at p95 to reach it, which includes copying the commit between threads, and then took 1.4 ms at p50 and 6.1 ms at p95 to run.

A tick's commit crosses to the database thread as a structured clone of the same patch the single-process server commits. At 40 players it is 109 kB and takes 0.8 ms to serialise and read back, split between the two threads. At 150 players it is 406 kB and 2.8 ms. The entity baseline a world commits once at boot is 9.1 MB. Replication frames cross the other way. The world thread serialises each frame once and writes the UTF-8 for one turn of its loop into one buffer, which is transferred rather than copied, so the main thread spends 0.004 ms per tick handing 126 kB of frames for 40 players to their sockets. Sent as strings instead, the same frames cost the main thread 0.10 ms per tick for re-encoding alone, and 0.42 ms against 0.014 ms at 150 players. The bytes on the wire are identical either way.

If a world's thread dies, the server logs `world.crashed`, disconnects that world's players with `UNAVAILABLE`, lists the world as unavailable in `/worlds`, frees its players' accounts so they can join another world at once, and starts the world again after one second, then two, four, up to a minute, logging `world.restarted`. The other worlds keep ticking. A failed database write still stops the whole server, as it always has. A publish, a settings change or a player edit that cannot stop every world at a tick boundary within ten seconds answers 503 and changes nothing.

A world that fails five times inside ten minutes is left down. The cause of a world that dies seconds after every start is in its own data or code, and the thousandth try goes the way the second did, so the server logs `world.abandoned` once, with the count and the window, and stops. The world stays unavailable until the server is restarted, the other worlds go on, and `/admin/stats` marks it `abandoned` with its `failures`, which the devdocs Threads card shows as **Given up**. A failure older than the window is forgotten, so a world that ran longer than ten minutes before it died begins counting again from one.

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
