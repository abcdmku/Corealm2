# Multiplayer reference hosting

Corealm boots offline without multiplayer configuration. A configured multiplayer page shows Worlds on the loading screen, so the player chooses while the scene is still being built; joining still requires an explicit player action, and it waits until the game is ready. The reference host uses Node 24, WebSockets, and durable SQLite. No cloud account is required.

## Run locally

Use Node 24 and run `npm ci` once. These commands start both the game page and one authored world, and configure the Worlds menu automatically:

| Command | Game URL | World port | Persistent saves |
| --- | --- | --- | --- |
| `npm run multiplayer:dev` | `http://127.0.0.1:4173` | 4180 | `local-worlds/dev/` |
| `npm run multiplayer:prod` | `http://127.0.0.1:4175` | 4182 | `local-worlds/prod/` |

Development runs Vite with hot reload. Production builds the release game first, then serves its compiled files with Vite preview. This is a local production-build preview, not a public hosting service. Both use the real reference world server in a separate process, durable SQLite, a 200-player admission ceiling and explicit local guest authentication. The ceiling is a configuration limit, not a measured capacity claim. There are no fake players.

Stop an existing `npm run dev` before starting the development launcher, or choose a different web port. Wait for the launcher to print **Open ...**, then open that URL. Worlds appears automatically when loading finishes: enter a guest character name, select the world and **Join world**. A successful join closes the menu and enters that world. Use the same name to resume that character. Ctrl+C stops both listeners and closes storage. The two modes have separate world IDs and save directories, so they can run together. Local saves are ignored by Git.

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

The standalone authored host exposes `corealm` by default. Use `--worlds corealm,second-corealm` for two independent worlds. Omit `--authored` for the production lab world `yard`. `--capacity <1..1000>` configures each world's admission ceiling. `/worlds` serves the directory. Keep the data directory across restarts. Run `npm run dev` in another terminal while the host is running.

For this standalone setup only, load one configuration example before the game module in `game/index.html`:

```html
<script src="/multiplayer.example.directory.js"></script>
```

The files `game/public/multiplayer.example.{single,list,directory}.js` demonstrate all three configuration forms. They are not loaded by default. These examples explicitly enable development guests and target the authored host above. For the lab, use `index.html?mode=combat&multiplayer=1`, world IDs `yard` / `second-yard`, and content version `corealm-pve-1:lab`. Authored worlds use `corealm-pve-1`. Scene/content mismatches are rejected before joining.

Configured game pages show Worlds over the loading screen. The list starts with **Local play only**, which is selected until the player chooses otherwise, followed by the worlds that were found. One button acts on that choice: Play offline puts the panel away and starts the single-player character, Join world enters the selected world, and Leave world returns to local play. Choosing a world before loading finishes shows Join when ready; the join then happens on its own as soon as the first frame is drawn.

Open the game menu with Escape or the minimap menu button to return to Worlds. The list shows population and availability, with incompatible and full worlds disabled for joining. Refresh worlds reloads the configured directory and every added host. Connection failures reopen the menu; the last complete scene stays visible and gameplay waits for a valid snapshot or an explicit return to offline play. Development guest names are shown only when guest mode is explicitly enabled; production deployments supply their authentication adapter.

### Adding a host

Players add their own hosts from the same panel. Type an address into the host field and select Add host: `127.0.0.1:4180`, `worlds.example.com`, a `ws://` endpoint, or a full directory URL. A bare address gets the reference host's `/worlds` path, loopback addresses default to `http` and everything else to `https`, which is what discovery accepts. Added hosts are stored in the browser under `corealm.hosts.v1`, are asked alongside the page's configured directory on every refresh, and are removed with the × beside the address. A host that cannot be reached reports itself in the status line without hiding the worlds other sources returned. Duplicate worlds are listed once. A page with no configuration of its own still shows Worlds when the player has added a host.

The browser currently requires a world's seed to match the loaded authored scene (default 1337). A different seed produces an incompatible-world message. Switching worlds releases the old connection, keeps its frozen scene during connection setup, and replaces that scene when a validated snapshot arrives. Their progression remains independent even when terrain is identical.

Fixed authored scenery stays loaded from that matching map when buildings lie beyond the server's gameplay interest radius. Actors, resources and interactables still come from authoritative snapshots and deltas. This keeps distant structures visible without sending a larger world snapshot to every player.

## Registration and authentication

`window.__COREALM_MULTIPLAYER__` accepts `WorldConfiguration` from `game/src/contracts.ts`: one descriptor, an array, or `{directoryUrl}`. Descriptors contain provider/world IDs, name, endpoint, protocol/content versions, seed, population, capacity, and availability. Static population is the discovery-time count, not an admission guarantee. The host decides admission atomically.

`WorldProvider` separates discovery, authentication, and transport from gameplay. Register alternative implementations through `window.__COREALM_PROVIDERS__`. Other configured provider IDs use the reference WebSocket adapter. Adapter conformance tests exercise it and an independent deterministic adapter.

Protocol 2 adds public actions, visible activity timing, and authoritative targeted/area invocation commands. Update the browser and host together. Protocol 1 sessions are rejected explicitly. Existing durable character saves retain their storage schema and content version.

Development guests require an explicit host flag and browser configuration. Guest names do not prove identity ownership. Production hosts must supply an `AuthenticationAdapter` to `startReferenceServer` that verifies credentials, checks access to the requested world, and returns a stable player ID and display name. Set `window.__COREALM_AUTHENTICATE__` to an async sign-in function returning `{token}`, or supply authentication through a custom provider. No production identity service is bundled.

Credentials belong in memory and the connection exchange, never in descriptors, URLs, saves, or logs. Remote endpoints require HTTPS/WSS; HTTP/WS is accepted only for loopback development. Configure `allowedOrigins` and encrypted transport when hosting remotely. No production deployment is required for local use.

## Authority, reconnect, and durability

One headless world owns navigation, resource schedules, enemies, collision, and shared state. Production player systems execute validated intents for movement, gathering, combat, loot, inventory, equipment, quests, hunts, banking, shops, production, campfires, travel, and progression. Browsers render replicated state. Movement prediction changes only the drawn pose and reconciles to authoritative updates.

Protocol version 3 adds proximity chat, eight-player parties, shared kill-bonus XP and automatic round-robin item delivery. Update the host and clients together. Chat recipients are selected by the server when a message is sent. Public loot piles can be collected by anyone; the server chooses the receiving party member and commits their inventory, the remaining pile and the next loot turn in the same transaction. Party state persists; chat and invitations are ephemeral. See [chat and party rules](game/parties.md).

`WorldSession.command` returns `accepted`, `rejected`, or `unknown` asynchronously. Acceptance means the result and receipt committed; a timed activity may still be running. Rewards arrive through later authoritative updates. UI, input, and agent callers use `sendGameCommand`; synchronous writers reject online calls that bypass the session.

Commands have a transport sequence and a logical operation ID scoped to provider/world/player. Retrying the identical operation returns its durable receipt. Reusing an ID for another command or retrying outside the retained 256-operation window is rejected. Reconnect obtains a valid snapshot before commands resume. Session IDs and lifecycle generation guards reject late packets.

Active duplicate logins are rejected. Unexpected disconnects reserve a slot for 30 seconds; reservations count toward capacity. Explicit leave releases the slot and restores the separate offline save. Network failure never creates an offline branch of the online world. Browser progression is neither imported nor overwritten automatically.

SQLite uses WAL, synchronous FULL transactions, and an exclusive database lock. State, random streams, and operation receipts commit atomically before acknowledgement. Storage failure stops simulation and acknowledgements. Restart resumes the saved simulation clock without advancing gameplay for downtime. Back up the directory while the host is stopped.

Replacement `WorldStorage` adapters implement `load`, `commit`, and `close`, preserving atomic commits and exclusive ownership. Optional paired `loadResident` / `loadPlayer` methods keep historical players on disk; `playerWrites: "patch"` retains omitted durable players. Inactive runtimes are evicted after a durable commit, retaining maintenance while an owned campfire or recovery cache exists.

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
