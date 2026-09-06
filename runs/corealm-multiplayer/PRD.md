# Multiplayer and independent worlds

Status: Proposed, awaiting owner approval before major implementation under AGENTS.md rule 2.

## Outcome

Corealm starts in single-player without configuration, an account, or a network connection. A deployment can register one multiplayer world or a directory of worlds. Players explicitly join a world, see nearby players, and play against server-owned shared state. Each world admits at most 1,000 concurrent players. Capacity must be measured with active clients, not inferred from a constant or idle connections.

## Existing constraints

`game/src/state/store.ts` currently combines one player's progression with mutable world state. `game/src/app/boot.ts` assembles browser-owned gameplay systems, and `game/src/app/loop.ts` advances simulation at 100 ms intervals. `game/src/api/gameApi.ts` provides synchronous local command results. `game/src/persistence/storage.ts` persists browser saves. These need deliberate authority and lifecycle changes; exchanging player positions alone does not fulfill this specification.

The worktree already contains performance changes, including boot, loop, rendering, settings, and test tools. Preserve those changes and integrate narrowly. Root owns changes to shared contracts and all affected callers.

## Worlds and registration

- A world descriptor contains a stable world ID, display name, provider ID, connection information, content version, seed, population, capacity, and availability. Provider plus world ID forms the isolation key.
- Supply a documented deployment configuration accepting either a single descriptor, a static descriptor list, or a directory URL. No multiplayer configuration means no multiplayer discovery or connection requests.
- Register providers through a typed interface. Discovery, session authentication, connection lifecycle, and persistence adapters stay outside gameplay rules. Ship a runnable self-hosted reference implementation and adapter conformance tests; no cloud account is required.
- Add a world selector with join, connecting, connected, full, incompatible, unavailable, reconnecting, and leave states. A single configured world can expose a direct join action. Do not join silently on ordinary boot.
- Validate descriptors and protocol versions. Do not place credentials in world lists, URLs, browser saves, or logs. Production endpoints use encrypted transport; local development can use loopback transport.
- World switching releases the old connection and visible entities before applying the new world's state. Late packets from an earlier session cannot affect the current world.

## Gameplay authority and persistence

- Separate per-player state from shared world state. Keep single-player using the same gameplay rules through a local session implementation.
- A multiplayer server owns movement validation, collision/navigation, resource depletion and respawn, enemies, combat outcomes, loot ownership, inventory, equipment, progression, banking, purchases, production, and other gameplay writes. Clients send validated intents and render authoritative results.
- Extract a headless simulation boundary from browser boot. Reuse production content, navigation, and gameplay systems. Do not simulate a separate copy of the shared world for every player.
- Define asynchronous command acknowledgement explicitly. UI, input, agent tools, and debug callers must not interpret local enqueue success as authoritative action success. Read APIs may use the latest replicated state.
- Sequence commands and updates, reject malformed or excessive input, deduplicate retried commands, and reconcile predicted movement. A reconnect obtains a valid snapshot before resuming; a network failure cannot quietly create an offline branch of the multiplayer world.
- Shared resources and loot resolve competing claims atomically. Private inventory, bank, and quest data replicate only to the owning player. Existing quest progress remains per player; shared enemy and resource outcomes come from the server.
- Isolate persistence by provider, world, and authenticated player. Preserve the existing offline save and never import it into online progression automatically. Reference hosting includes durable storage and restart recovery, with replacement storage behind an adapter.
- Bind player identity and world access on the server. Permit an explicit development guest mode; document the production authentication adapter. Define duplicate-login and reconnect reservation behavior so slots and rewards cannot be duplicated.
- This release preserves existing PvE rules. PvP, player trading, chat, cross-world inventory transfers, seamless travel between servers, and new authored maps are outside this request.

## Capacity and replication

- Enforce the configured admission limit atomically, with a maximum of 1,000 players per world. Count reconnect reservations consistently and reject the 1,001st admission without disturbing existing players.
- Use spatial interest queries, bounded update batches, delta replication, remote-actor interpolation, and bounded outbound queues. Avoid broadcasting every player's complete state to every other player each tick.
- Keep shared simulation independent of presentation culling. Crowded areas may reduce cosmetic update frequency, but nearby gameplay state and interaction outcomes must remain correct. Respect existing model-detail requirements.
- Slow clients cannot stall the world. Define resynchronization or disconnect behavior for excessive backlog, with explicit errors and bounded memory.
- Start from the existing 10 Hz simulation cadence. Proposed reference-server acceptance targets are p95 tick time below 100 ms and p95 command acknowledgement below 250 ms on a controlled local network, under the active 1,000-client workload. Record hardware, duration, client placement, activity mix, CPU, memory, tick percentiles, acknowledgement latency, and bandwidth. These are targets, not current measurements.
- Include both distributed players and all players clustered in one area. Measure client rendering with the production scene separately from server capacity. Report any limit honestly; a smaller passing test does not certify 1,000 players.

## Delivery and acceptance order

1. After approval, boot the current game and lab in Chromium. Define and freeze world, provider, session, command, replication, and storage contracts in `game/src/contracts.ts`, updating callers together.
2. Implement local sessions, headless shared simulation, reference hosting, transport, and focused correctness tests. Prove provider independence with adapter conformance and a separate deterministic test adapter.
3. Add a multiplayer fixture and world selector to the persistent production lab. Connect two independent browser contexts to one real reference server. Use real movement and interaction inputs, compare semantic state before and after, check console errors, and inspect screenshots of remote actors and connection UI.
4. Prove same-world visibility, separate-world isolation, competing resource/loot claims, private-state filtering, rejection of forged writes, disconnect cleanup, reconnect, full-world rejection, version mismatch, and server restart persistence. Keep focused browser loops within the budgets in `docs/feature-lab.md`.
5. Only after root lab acceptance, integrate the accepted session path into final-world boot, persistence, input, UI, and agent APIs. Run a shallow authored-world integration check plus offline save/load regression checks.
6. Run the dedicated capacity suite outside the combined lab gate. Use 1,000 active network clients over a documented sustained interval of at least 10 minutes, with movement and representative gameplay commands. Test crowded and distributed placements, churn, slow consumers, and a 1,001st join. Do not replace gameplay load with heartbeat-only sockets.
7. Run type checking, relevant tests, build, and required repository checks. Obtain a fresh-context read-only critic review after evidence exists. Root resolves findings and accepts only passing implementation and browser evidence.

## Deliverables

Working offline and multiplayer game paths; single-world and directory registration examples; provider and storage contracts; a runnable reference server; production lab controls and browser checks; a repeatable capacity tool; and hosting documentation that separates measured limits from deployment-dependent targets.

No production deployment, paid service provisioning, or cloud-provider selection is required to complete local implementation. No multiplayer implementation or capacity claim has been made by creating this document.
