# Multiplayer implementation decisions

Owner approval: September 6, 2026. Root owns the contracts and affected callers.

## Authority boundary

One `HeadlessWorld` owns a shared entity registry, navigation, spatial index, clock, enemy AI, and mutable resources/enemies/loot. Per-player production systems operate on a private state view over that shared state. Quest/hunt progression, private doors, recovery caches, and inventory remain player-owned. Shared AI advances once per world rather than once per player.

`LocalSession` and `WebSocketSession` implement the same asynchronous command boundary. Production `CorealmGameApi` remains the internal synchronous executor; online synchronous calls reject. UI, input, debug, and agent command callers await authoritative results. Browser online simulation and save writers are disabled. Read APIs use the latest replicated state. Private `loot.opened` events hand authoritative loot containers to the human panel.

The headless authored factory reuses production terrain, content, navigation, GLB collision geometry, forest placement, dungeon exclusions, resource systems, and spawn anchors. Geometry assets load through a Node adapter without textures or WebGL. Authored world generation is an AGENTS.md rule 11 exception to compact lab-first proof; reusable actors, controls, UI, and local interactions retain lab-first acceptance.

## Lifecycle and storage

Isolation keys serialize provider ID and world ID without ambiguous delimiters; progression additionally uses server-authenticated player identity. Duplicate active login is rejected. Unexpected disconnects reserve a slot for 30 seconds; explicit leave releases it. Reconnect requires a new snapshot and never creates an offline branch. Session IDs and controller generations reject late packets after leave/switch.

Each transport sequences commands. Logical operation IDs additionally survive transport reconnect and deduplicate against the most recent 256 durable receipts. A repeated operation must contain the identical intent. Expired or conflicting operations reject. State, random streams, and receipts commit atomically before acknowledgement. Initial/reconnect/requested snapshots wait for any in-flight commit. A failed commit stops the host's simulation and acknowledgement path.

SQLite keeps world metadata, player/random chunks, and per-operation receipt rows in one transaction. The optional paired `loadResident`/`loadPlayer` storage capability loads historical players on demand. Patch commits retain omitted durable players. The host evicts inactive runtimes after committing; campfires and recovery caches retain bounded-duration maintenance. Receipt head changes persist even when the last receipt is unchanged. Single-process ownership is enforced by SQLite's exclusive OS lock.

The browser captures the current offline state on initial connection, isolates all online writes, and restores that offline state on explicit leave. The reference uses content IDs distinguishing the lab from the authored scene. Current authored clients accept only the loaded map seed; other seeds report incompatibility.

## Replication and presentation

A 48 m spatial interest query filters public actors and semantic entities. Private fields never enter the public cache. Snapshots establish baselines; deltas carry their base sequence. Private top-level deltas merge only after validation. Public motion uses packed float32 arrays; browsers decode and interpolate it. Crowds above 128 nearby actors stagger cosmetic refresh at 2 Hz while equipment/health/realm changes take priority. World simulation is independent of rendering culling. Client presentation selects the nearest 256 remote players inside 32 m, retains all replicated player state, and only creates views/interpolates poses for the selected actors. Stable ID ordering resolves equal-distance ties.

Local prediction reuses production movement/navigation against a cloned presentation state, caps extrapolation at 250 ms, and reconciles server corrections without changing authoritative reads. Remote actors resolve their public equipped item IDs through the production armour and weapon mappings. The same equipment silhouette and tier treatment apply in both detail paths.

Messages, input rates, pending commands, entity batches, and outbound queues are bounded. Excessive interest or outbound backlog disconnects the affected client. Slow connections cannot block the world's simulation loop.

## Evidence

See `implementation-status.md` for acceptance results and measured limits, and `docs/multiplayer-hosting.md` for configuration, authentication, storage, and workload instructions. Capacity targets are not current certification: sustained 1,000-client runs remain above the proposed latency limits.

### Crowd detail budget

Crowd presentation activates at 64 selected remote players and turns off below 48. The nearest 32 use the normal animation and shadow path, with a 1 m retention bias. Other selected players keep the same equipped armour, weapons, colours, hair and geometry, using sampled animation without individual shadow casting. Batches share only compatible equipped appearances. Equipment changes replicate from the server and rebuild the affected appearance. The 256-player/32 m selection and authoritative state remain unchanged. This replaces the earlier shared-outfit substitution.

The optional `view.crowd` flag is set on client presentation copies. It selects a separate sampled-animation group for the same equipped character appearance. Unique rig promotion skips that group, including budget eviction, and sampled meshes preserve their shadow policy when instance buffers grow. Session cleanup resets the population and distance history.
