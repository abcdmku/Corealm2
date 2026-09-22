# Trained player agents, first milestone

Status: Draft for owner approval. Requirements reflect the user's specification and September 20, 2026 clarifications. No trained-policy or capacity result is claimed.

Source: [brief](./brief.md). Follow [agent rules](../../AGENTS.md) and [feature-lab workflow](../../docs/feature-lab.md).

## Outcome and scope

Run 100 AI-controlled regular player accounts in one authoritative shared world. Each has its own identity, progression, inventory, bank, goals, personality, recent history, and persistent memory. Models are shared across accounts. Human players can join in addition to those 100; acceptance includes one human-controlled observer session and does not imply an unbounded human population.

Train and accept two tasks before expanding to the authored full world:

- Combat in one arena using existing enemies, equipment, abilities, navigation, damage, death, and recovery rules.
- Gather a selected production resource, fill the usable inventory, travel to the bank, deposit gathered items while retaining required tools, and resume gathering. Prove two consecutive cycles.

All work runs locally on the confirmed RTX 5080 machine. Benchmark CPU inference first. RTX 3080 deployment certification, remote training, full-world expansion, and an actual LLM service are deferred. There is no agreed GPU-hour ceiling; use bounded, checkpointed training runs and report elapsed training time and learning progress.

## Existing implementation to reuse

- `game/src/multiplayer/headlessWorld.ts` and `headlessPlayer.ts` already assemble production simulation systems without a renderer.
- `game/src/contracts.ts`, production game APIs, and multiplayer command acknowledgements define legal actions and authoritative outcomes.
- `game/src/multiplayer/labWorld.ts` and the existing combat, presentation, and bank controls provide compact scenes to extend only where needed.
- `tools/multiplayer-capacity.ts` provides existing multi-client capacity machinery. Extend it for policy-driven workloads rather than duplicating the runner.
- Existing chat, parties, player visibility, and resource contention rules remain authoritative.

The host supports an authentication adapter but does not bundle an account service. Add a minimal persistent local account implementation through that adapter and provision 100 new identities. Use the same authentication and player-state paths for human and agent accounts. Store credentials outside tracked files and decision traces. Guest identities do not satisfy account acceptance. A public signup service is outside this milestone.

## Observation and action contracts

The root defines and freezes versioned observation, action, model, trace, and provider contracts in the shared contracts file before dependent implementation.

Observations contain the account's structured state, legitimately visible nearby entities and players, cooldowns, available actions, goal, five personality traits, bounded recent history, and delivered-message metadata. Use the same visibility and private-state boundaries as an ordinary player. A server-side training process must not leak hidden enemies, other inventories, unrevealed targets, or future simulation state into the policy.

Start with bounded entity candidates and masked discrete action/target choices. Output typed production commands. Mask unavailable actions during training and inference; validate again against current authoritative state at execution. Reject stale targets, expired observations, obsolete goals, and results from previous sessions. Existing pathfinding performs movement. Policies select destinations and actions rather than inventing a second movement simulation.

Keep per-account recurrent state or bounded history separate. Reset or restore it deliberately on scenario reset, reconnect, account switch, and rollback. Valid waiting during cooldowns, gathering rolls, or travel is distinct from being stuck.

## Policies and training

Start with separate small combat and casual policies, each approximately 100K-2M parameters. The casual policy includes a social-decision output. Use a local training implementation, export ONNX artifacts, and verify masked action and output parity against the training model.

Bootstrap from scripted demonstrations that call production actions, with human demonstrations supported by the same trace format. Refine both gameplay policies with reinforcement learning. A fallback-only run or an untrained/random ONNX file cannot satisfy this milestone.

Expose explicit simulation stepping, deterministic seeded resets, episode termination, and faster-than-real-time execution using production logic. Isolate parallel simulation instances, including mutable content registries and random generators. Establish repeatable trajectories before collecting training data.

Progress from simple encounters and uncontested gathering to varied equipment, levels, enemies, terrain, parties, resource contention, personalities, and interruptions. Include rejected commands, inventory pressure, depleted nodes, changing targets, death, disconnected sessions, and interrupted bank trips. Keep scenario seeds and designated opponents held out of demonstrations, RL updates, and model selection used for final acceptance.

Condition on aggression, caution, loyalty, generosity, and curiosity. Demonstrations or rewards must associate each trait with observable choices. Define paired probes before training: engagement choice, retreat threshold, party assistance, allocation of existing shared rewards where the API permits it, and selection of unfamiliar visible opportunities. Do not invent unsupported trading actions. For each trait, require the expected directional change, an effect of at least 10 percentage points on its binary probe, and a paired confidence interval excluding zero. Report task success alongside personality effects so a broken policy cannot pass by behaving differently.

## Runtime and LLM boundary

Use a TypeScript orchestrator with ONNX Runtime, bounded inference batches, per-account state, event priorities, bounded queues, and fair scheduling. Combat preempts casual and social work. Coalesce superseded events without losing required reactions. Recheck validity before submission and distinguish server acceptance from local enqueue success and eventual task completion.

Implement a simple legal fallback controller for missing models, inference failures, or exhausted deadlines. Record every fallback and rejection. Require at least 99% of eligible gameplay decisions in acceptance runs to use the trained policies; fallback cannot conceal failed training or overload.

The trained casual policy chooses among ignoring a message, requesting a reply, initiating a conversation with an eligible visible player, and continuing ordinary activity. Spontaneous initiation uses seeded stochastic policy sampling, trained examples or rewards, and explicit cooldowns. A random timer alone does not satisfy the learned decision requirement.

An optional provider supplies dialogue text and structured goal proposals. Define provider registration, configuration, capability checks, request schemas, timeouts, cancellation, bounded concurrency, and output validation. A configured conforming provider becomes available automatically without retraining or changing gameplay code. The policies are trained with provider availability as an input. With no provider, gameplay continues and no dialogue text is sent.

Provider calls run asynchronously. Combat never waits for them. A late response must still refer to a valid conversation, recipient, session, and permitted chat channel. Apply existing chat rules plus per-agent and per-recipient cooldowns, bounded replies per conversation, and duplicate suppression to prevent agent-to-agent reply loops. Test these paths with a deterministic fake provider; no real messages or paid provider calls are part of draft preparation.

Goal proposals use allowlisted typed goals, receive ordinary state validation, and cannot issue arbitrary commands. Received chat text cannot grant permissions or become executable instructions. Keep deeper planning off the combat path. Semantic quality of real LLM dialogue remains unverified until a provider is integrated.

## Acceptance

Freeze episode horizons, beatable combat configurations, scenario splits, reward definitions, and the personality probes before training. Use at least 200 held-out episodes per gameplay task. Publish sample counts, point estimates, confidence intervals, failures, and results by scenario and personality. Acceptance thresholds apply to the point estimates; disclose uncertainty.

| Measure | Gate |
| --- | --- |
| Combat | At least 90% wins against the designated beatable held-out encounters within their episode horizon. Report deaths, survival, party assistance, and recovery separately. |
| Gather/bank | At least 95% of held-out episodes complete two full gather/bank cycles and resume gathering within the episode horizon, preserving tools and accounting for items. |
| Stalls | No unexplained lack of progress lasting over 10 seconds without a recovery action. Legal scheduled waits must be identifiable, bounded, and separately reported. |
| Personality | All five paired probes meet the defined directional and effect-size gates. |
| Policy use | At least 99% of eligible gameplay decisions use trained inference. Report fallback, mask failures, stale decisions, and authoritative rejection counts. |
| Combat reaction | Event receipt at the orchestrator to authoritative acceptance of a relevant valid action <=200 ms p95 and <=400 ms p99. Instrument enqueue, inference, submission, acceptance, and acknowledgement separately. |
| Casual reaction | Eligible casual decisions within 1-10 seconds, excluding explicitly justified production action waits. |
| Capacity | 100 authenticated active agents in one shared world plus one human-controlled browser session. Include repeated synchronized combat bursts and shared resource contention. |
| Social readiness | Learned reply/initiate decisions, provider absence, fake-provider activation, timeout, stale response, recipient validity, and conversation-loop suppression pass. |

Measure idle, mixed combat/gathering, and all-100 simultaneous-combat workloads separately. Existing 60-second lab gate budgets still apply; use repeated bounded measurement windows with documented warmup and at least 1,000 eligible reactions across the combat workload. Report tails per workload, sample counts, timeouts, dropped work, disconnects, queue depth, CPU/RAM, inference batch sizes, and server tick performance. Rejected actions and no-op acknowledgements do not count as successful combat reactions. Record server publication-to-receipt delay as well, so the stated reaction metric cannot hide slow event delivery.

Run load measurements without concurrent training, builds, or unrelated rendering work. The required human observer stays connected. Record actual CPU, RAM, GPU, runtime versions, and model hashes. A pass on this machine makes no performance claim about the future 7700X/32GB/RTX 3080 host.

## Delivery and verification order

1. Approve this PRD, boot the existing game and lab in Chromium, and freeze shared contracts. Reuse one development server and one persistent browser session.
2. Implement account provisioning, observations, legal actions, deterministic training stepping, and the baseline controller. Verify parity with production systems through focused tests and real lab gameplay.
3. Train combat and gather/bank policies, export versioned ONNX artifacts, and evaluate held-out behavior. Verify social decisions and the optional provider boundary with a fake provider.
4. Run trained policies in the production multiplayer lab. Use real command sessions and semantic before/after assertions for damage, deaths, gathering yields, full inventories, bank transfers, resumed tasks, and account isolation. Inspect screenshots through normal gameplay camera controls.
5. Run the 100-agent workload, relevant regression tests, typecheck, and production build. Accept or explicitly report unmet gates. Full-world rollout follows only after this milestone passes.

Version models with observation/action schemas, training configuration, content version, seed splits, and artifact hashes. Reject incompatible artifacts, retain a known-good model, support atomic rollback, and trace decisions with bounded retention and no credentials. Keep screenshots and measurement output disposable under ignored test-results paths; retain the reproducible configuration and model metadata needed to rerun acceptance.
