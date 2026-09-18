# Multiplayer and independent worlds

Status: Approved by the owner on September 6, 2026 with "do it". Local implementation and browser validation are recorded in [implementation status](./implementation-status.md). Release acceptance remains open for the measured performance limits and repository failures under [AGENTS.md](../../AGENTS.md).

Date: September 6, 2026. Source: [current run brief](./brief.md) and the owner's supplied multiplayer specification.

## Outcome

Corealm starts in single-player without configuration, an account, or a network connection. A deployment can register one multiplayer world or a directory of worlds. Players explicitly join a world, see nearby players, and play against server-owned shared state. Each world admits at most 1,000 concurrent players. Capacity must be measured with active clients, not inferred from a constant or idle connections.

## Existing constraints

`game/src/state/store.ts` combines one player's progression with mutable world state. `game/src/app/boot.ts` assembles browser-owned gameplay systems, and `game/src/app/loop.ts` advances simulation at 100 ms intervals. `game/src/api/gameApi.ts` provides synchronous local command results. `game/src/persistence/storage.ts` persists browser saves. These need deliberate authority and lifecycle changes. Exchanging player positions alone does not fulfill this specification.

Preserve existing performance changes in boot, loop, rendering, settings, and test tools. Integrate narrowly. Root owns shared contracts and updates all affected callers together. Existing content and PvE rules remain authoritative except for the authority and lifecycle changes specified here.

## Worlds and registration

- A world descriptor contains a stable world ID, display name, provider ID, connection information, content version, seed, population, capacity, and availability. Provider plus world ID forms the isolation key.
- Supply documented deployment configuration accepting either a single descriptor, a static descriptor list, or a directory URL. No multiplayer configuration means no multiplayer discovery or connection requests.
- Register providers through a typed interface. Discovery, session authentication, connection lifecycle, and persistence adapters stay outside gameplay rules. Ship a runnable self-hosted reference implementation and adapter conformance tests. No cloud account is required.
- Add a world selector with join, connecting, connected, full, incompatible, unavailable, reconnecting, and leave states. A single configured world can expose a direct join action. Do not join silently on ordinary boot.
- Validate descriptors and protocol versions. Do not place credentials in world lists, URLs, browser saves, or logs. Production endpoints use encrypted transport. Local development can use loopback transport.
- World switching releases the old connection and visible entities before applying the new world's state. Late packets from an earlier session cannot affect the current world.
- Leave returns the player to their separate offline session. A failed join leaves online progression untouched and offers an explicit retry or return to single-player.

## Gameplay authority and persistence

- Separate per-player state from shared world state. Keep single-player using the same gameplay rules through a local session implementation.
- A multiplayer server owns movement validation, collision/navigation, resource depletion and respawn, enemies, combat outcomes, loot ownership, inventory, equipment, progression, banking, purchases, production, and other gameplay writes. Clients send validated intents and render authoritative results.
- Extract a headless simulation boundary from browser boot. Reuse production content, navigation, and gameplay systems. Do not simulate a separate copy of the shared world for every player.
- Define asynchronous command acknowledgement explicitly. UI, input, agent tools, and debug callers must not interpret local enqueue success as authoritative action success. Read APIs may use the latest replicated state.
- Distinguish pending, authoritative acceptance, authoritative rejection, and unknown outcome after a connection loss. Acknowledging a long-running action means the server accepted its start, not that its eventual reward is already earned. Resolve uncertain commands through deduplication and authoritative resynchronization.
- Sequence commands and updates, reject malformed or excessive input, deduplicate retried commands, and reconcile predicted movement. A reconnect obtains a valid snapshot before resuming. A network failure cannot quietly create an offline branch of the multiplayer world.
- Shared resources and loot resolve competing claims atomically. Private inventory, bank, and quest data replicate only to the owning player. Existing quest progress remains per player. Shared enemy and resource outcomes come from the server.
- Isolate persistence by provider, world, and authenticated player. Preserve the existing offline save and never import it into online progression automatically. Reference hosting includes durable storage and restart recovery, with replacement storage behind an adapter.
- Bind player identity and world access on the server. Permit an explicit development guest mode and document the production authentication adapter. Define duplicate-login and reconnect reservation behavior so slots and rewards cannot be duplicated.
- Freeze the duplicate-login policy, reservation duration and expiry, command retry retention, persistence commit boundary, and restart recovery behavior with the contracts before implementation depends on them. Document how accepted writes and command receipts recover together without duplicate rewards.

## Scope exclusions

This release preserves existing PvE rules. PvP, player trading, chat, cross-world inventory transfers, seamless travel between servers, and new authored maps are outside this request. No production deployment, paid service provisioning, or cloud-provider selection is required to complete local implementation.

## Capacity and replication

- Enforce the configured admission limit atomically, with a maximum of 1,000 players per world. Count reconnect reservations consistently and reject the 1,001st admission without disturbing existing players. A deployment may configure a smaller limit.
- Use spatial interest queries, bounded update batches, delta replication, remote-actor interpolation, and bounded outbound queues. Avoid broadcasting every player's complete state to every other player each tick.
- Keep shared simulation independent of presentation culling. Crowded areas may reduce cosmetic update frequency, but nearby gameplay state and interaction outcomes must remain correct. Respect existing model-detail requirements.
- Slow clients cannot stall the world. Define resynchronization or disconnect behavior for excessive backlog, with explicit errors and bounded memory. Record configured message, input-rate, batch, and queue limits in hosting documentation.
- Start from the existing 10 Hz simulation cadence. Proposed reference-server acceptance targets are p95 tick time below 100 ms and p95 command acknowledgement below 250 ms on a controlled local network under the active 1,000-client workload. These are targets, not current measurements.
- Measure acknowledgement from client submission to receipt of the authoritative decision. Report timeouts, rejections, disconnects, and sustained tick throughput alongside latency so dropped work or a slowing simulation cannot produce a misleading pass.
- Include both distributed players and all players clustered in one area. Measure client rendering with the production scene separately from server capacity. Report any limit honestly. A smaller passing test does not certify 1,000 players.

## Delivery and acceptance order

1. After approval, boot the current game and lab in Chromium. Define and freeze world, provider, session, command, replication, and storage contracts in `game/src/contracts.ts`, updating callers together. Resolve the lifecycle and persistence decisions listed above during this step.
2. Implement local sessions, headless shared simulation, reference hosting, transport, and focused correctness tests. Prove provider independence with adapter conformance and a separate deterministic test adapter.
3. Add a multiplayer fixture and world selector to the persistent production lab. Connect two independent browser contexts to one real reference server. Use real movement and interaction inputs, compare semantic state before and after, check console errors, and inspect screenshots of remote actors and connection UI.
4. Prove the correctness cases below. Keep focused browser loops within the budgets in [docs/feature-lab.md](../../docs/feature-lab.md). Setup controls may establish deterministic conditions but cannot replace real inputs as interaction proof.
5. Only after root lab acceptance, integrate the accepted session path into final-world boot, persistence, input, UI, and agent APIs. Run a shallow authored-world integration check plus offline save/load regression checks.
6. Run the dedicated capacity suite outside the combined lab gate. Use 1,000 active network clients over a documented sustained interval of at least 10 minutes for each distributed and clustered placement. Include movement and representative gameplay commands. Test churn, slow consumers, and a 1,001st join. Do not replace gameplay load with heartbeat-only sockets.
7. Run type checking, relevant tests, build, and required repository checks. Obtain a fresh-context read-only critic review after evidence exists. Root resolves findings and accepts only passing implementation and browser evidence.

No lab-first exception is planned for multiplayer. Its reusable behavior can be isolated. Final-world wiring follows lab acceptance. Any later authored-world exception must state its reason and follow [docs/world-authoring.md](../../docs/world-authoring.md).

## Correctness acceptance

| Case | Required evidence |
| --- | --- |
| Offline default | Boot with no multiplayer configuration and with networking unavailable. Play, save, reload, and verify preserved progression. Confirm no discovery or connection requests. |
| Registration | Exercise single descriptor, static list, and directory URL configuration. Reject invalid descriptors and incompatible protocol/content versions with a useful selector state. |
| Provider independence | Run conformance tests against the reference adapter and a separate deterministic adapter without changing gameplay rules. |
| Same-world play | Two independent browser contexts see each other's movement and authoritative shared interaction outcomes through the production lab. Inspect remote-actor and UI screenshots. |
| World isolation | Different world IDs on one provider, and identical world IDs on different providers, cannot share entities, commands, progression, or persistence. |
| Competing claims | Concurrent resource and loot requests award only the available quantity under existing PvE ownership rules. Retries do not duplicate rewards. |
| Private state | Inspect replicated payloads and client state. Another player's inventory, bank, and quest data are absent, including snapshots and reconnect responses. |
| Forged writes | Reject identity spoofing, invalid movement, unauthorized inventory/progression writes, malformed messages, and excessive input without changing authoritative state. |
| Command outcomes | UI, input, agent, and debug callers distinguish queued work from authoritative decisions. Test rejection, delayed acknowledgement, retries, and lost responses. |
| Disconnect and reconnect | Verify entity cleanup and the documented reservation policy. Resume only after a valid snapshot, without duplicate slots, players, or rewards. Test duplicate login and expired reservations. |
| Switching and leave | Release the old session and entities. Inject a delayed old-session update and verify it cannot mutate the current world. Explicit leave restores the isolated offline path. |
| Full and unavailable worlds | Reject admission atomically at the configured limit. Show full or unavailable status without disturbing existing sessions. Test simultaneous joins for the last slot. |
| Restart persistence | Persist representative player and shared-world writes, restart the reference server, and verify recovery and retry behavior at the documented commit boundary. |
| Slow consumers | Trigger the configured queue bound. Confirm explicit resynchronization or disconnect, bounded queues, and continued progress for healthy clients. |
| Final-world integration | Verify authored-world loading, movement, a shared interaction, session switching, and offline save/load without replacing production content or rendering. |

## Capacity evidence

The capacity tool must produce a repeatable report with server and load-generator hardware, software versions, revision, configuration, duration, client placement, active/admitted/reserved counts, activity mix, attempted and completed commands, CPU, memory, tick percentiles, acknowledgement latency, and bandwidth. Report queue sizes, resynchronizations, disconnects, and errors. Separate warm-up from the measured interval and record whether client generation itself limits load.

Distributed and clustered scenarios each need at least 10 sustained minutes with 1,000 active clients. Report churn and slow-consumer scenarios separately, including their effect on healthy clients. Verify rejection of the 1,001st admission while the world is full. Record the client rendering workload, graphics settings, hardware, and frame timings separately using the production scene, and inspect crowded-area screenshots for readability and required model detail.

The report must state whether each target passed. If 1,000 active players or either latency target fails, report the measured limit and keep the capacity requirement open. Do not reduce the acceptance threshold silently or present a smaller test as certification.

## Deliverables

- Working offline and multiplayer game paths with explicit session lifecycle and authoritative command outcomes.
- Single-world, static-list, and directory registration examples, plus provider and storage contracts.
- A runnable self-hosted reference server with durable storage, restart recovery, explicit development guest mode, and documented production authentication integration.
- Production lab fixtures, controls, focused correctness tests, browser checks, and inspected visual evidence.
- A repeatable active-client capacity tool and reports separating measured server limits from production-scene rendering and deployment-dependent targets.
- Hosting documentation covering configuration, local startup, encrypted production transport, authentication, admission and reservation policy, persistence and recovery, protocol compatibility, queue limits, and capacity reproduction.

Generated screenshots and reports remain disposable under repository policy unless intentionally promoted as durable acceptance evidence. Record commands, results, and evidence locations in the implementation handoff.

Approval authorizes implementation. This document does not establish working multiplayer or a capacity measurement; those require the acceptance evidence above.

### Approved crowd simplification refinement

The owner requested simpler large crowds, then clarified that each player must retain their own armour. Keep the 256-player display cap and the actual equipped armour/weapon silhouettes and tier colours at every distance. Crowd simplification may reduce animation evaluation and shadows, and batch compatible gear. Do not replace equipped items with a shared outfit. Preserve authoritative gameplay and existing foliage detail. Accept the path in the persistent multiplayer lab before final-world integration.
