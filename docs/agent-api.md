# Writing an agent for Corealm

Corealm is a browser RPG that an AI agent plays alongside a human, through the same actions the
human uses. There is no privileged automation path: every tool below calls the identical function
the human UI calls. If a human can do it, you can; if they cannot, neither can you.

The game is self-describing. An agent that has never seen it learns everything it needs from two
tools: `corealm_context` (the whole situation, right now) and `corealm_manual` (the rules). This
document is the same material for a human reader, plus a worked example.

## Getting a handle

Two entry points, one implementation behind both.

```js
// WebMCP, in a capable browser. This is how an agent in the browser reaches the game.
const tools = await document.modelContext.getTools();

// Always present, in every browser. Same handlers, same validation, same session rules.
const agent = window.corealm.agent;
```

Tools are registered with `document.modelContext.registerTool` with a `title`, a `description`, a strict `inputSchema`, and
`annotations.readOnlyHint`. Each `execute(input, { signal })` returns
`{ content: [{ type: "text", text: <JSON> }], isError? }`; the JSON is the tool's result. A browser
without WebMCP gets no stand-in: `window.corealm.agent.webmcp()` reports `binding: "none"` and the
in-game agent panel says so.

`window.corealm.agent` exposes:

| Method | Returns |
| --- | --- |
| `listTools()` | every tool with name, title, description, JSON Schema, access level, annotations |
| `call(name, args, { signal })` | the tool's result. **Never throws.** |
| `webmcp()` | which container the adapter bound to, whether it was native, and how |
| `version()` | build, contracts, and content versions — cache knowledge against these |
| `session()` | the collaboration session: mode, control owner, objective, pending approval |

## The single most important thing

**Nothing throws.** A failure comes back as data:

```js
const result = await agent.call("corealm_interact", { entityId: "x", interaction: "mine" });
// { error: "REQUIREMENTS_NOT_MET", message: "Requires Mining 10", entityId: "x" }
```

Always check for `.error` before using a result. The codes:

`NOT_FOUND`, `OUT_OF_RANGE`, `NOT_REACHABLE`, `REQUIREMENTS_NOT_MET`, `INVENTORY_FULL`, `BUSY`,
`INVALID_ARGUMENT`, `DEAD`, `DEPLETED`, `NOT_ENOUGH_CURRENCY`, `NOT_ENOUGH_ITEMS`, `NO_DIALOGUE`,
`TIMEOUT`, `UNAVAILABLE`, and the four session codes `NOT_PERMITTED`, `PAUSED`, `CANCELLED`,
`APPROVAL_REQUIRED`.

`message` is always human-readable and states what is missing. Arguments are validated against
each tool's schema before anything runs: a wrong type, an unknown field, a value outside its range
or enum is an `INVALID_ARGUMENT` naming the field, never a silently-applied default.

## The three modes

The player chooses how much the agent may do, and the agent panel in the game shows it.

| Mode | The agent may | Tools |
| --- | --- | --- |
| `guide` | read, answer, explain, recommend | everything marked `read` |
| `assist` | also mark destinations and highlights, and propose plans that walk themselves forward | plus `assist` tools: `corealm_overlay`, `corealm_route`, `corealm_propose` |
| `play` | also act, while it holds control and is not paused | plus `act` tools |

`corealm_session {op:"set_mode", mode}` moves to `guide` or `assist`. `play` is granted by the
player: `corealm_session {op:"request_control", objective}` asks, the panel shows the request with
Allow and Deny, and the call returns `granted`, `denied`, or `pending` (with a `requestId` for
`wait_approval`). When the task is done, `{op:"release_control"}` hands the character back.

The player can always Pause, Stop, or Take control from the panel. Each arrives as an
`agent.session` event, so `corealm_events` or `corealm_wait {events:["agent.session"]}` is how the
agent notices. Shop buys and sells in play mode ask for approval per call unless the player has
pre-approved trades. Everything else in play mode is free.

## Start with corealm_context

One call, one atomic snapshot of the same tick:

```js
const ctx = await agent.call("corealm_context");
ctx.session.mode            // "guide" | "assist" | "play"
ctx.session.controlOwner    // "player" | "agent"
ctx.player                  // position, health, inCombat, activityKind, ...
ctx.quests.active[0].refs   // the current objective as ids
ctx.nearby.entities         // what is within 40 m, with interactions
ctx.events.nextSeq          // the cursor to continue from
ctx.revision                // { revision, eventSeq, simMs, tick } — equal means nothing changed
ctx.suggestedActions        // ranked exact tool calls, with `requires` when a mode is needed
```

Pass `sections` to read a subset. Read `corealm_manual` once (`overview` and `modes`), and look
the other topics up as needed: `control`, `tools`, `rules`, `terminology`, `events`, `errors`,
`efficiency`.

## The second most important thing

**Do not poll.** `corealm_events` blocks until something happens:

```js
const { events, nextSeq, dropped } = await agent.call("corealm_events", {
  sinceSeq: cursor,
  types: ["activity.stopped", "inventory.full", "resource.depleted"],
  timeoutMs: 30000,
});
cursor = nextSeq;
if (dropped) { /* the ring moved on without you: re-read corealm_context */ }
```

Events are a monotonic sequence. Keep the `nextSeq` you were given and pass it back as
`sinceSeq`. The ring keeps the last 512 events; if your cursor is older than that, `dropped` is
true and `droppedCount` says how many you missed.

The event types, with payloads documented in `corealm_manual {topic:"events"}`:

```
navigation.started  navigation.completed  navigation.failed
activity.started    activity.stopped      resource.depleted   inventory.full
item.received       item.lost             item.equipped       item.unequipped
combat.started      combat.ended          spell.launched      essence.altarAwakened
essence.recharged   health.low            player.died         level.gained
production.completed campfire.built       campfire.replaced   campfire.expired
quest.updated       dialogue.opened       dialogue.closed     entity.discovered
agent.session       agent.task            agent.approval
overlay.arrived     agent.guide
```

`spell.launched` fires when a cast is rolled and its bolt leaves. A spell does NOT damage anything
until it arrives, `flightMs` later, so an agent that reads health immediately after
`corealm_attack` reads the old value. Gear moving onto or off the body is `item.equipped` /
`item.unequipped`, never `item.received` / `item.lost`.

## The 34 tools

Access: `read` works in any mode; `assist` needs assist or play; `act` needs play mode with agent
control, not paused.

### Orientation
- `corealm_context` (read) — the whole situation, atomically. Call this first.
- `corealm_manual` (read) — the rules, by topic.
- `corealm_session` (read) — connect, set the objective, ask for or release control, stop, cancel.

### Helping the player
- `corealm_propose` — a summary and up to eight steps, with a cursor. The panel lists them and
  marks the current one; outside guide mode the current step's place is a marker in the world
  and the later steps are numbered labels. Reaching the current step completes it, clears its
  marker and lights the next one (an `agent.guide` event each time). A step with `done:
  "manual"` or no place waits for `{advance: true}`; `{clear: true}` takes the plan down.
- `corealm_route` — the path the character would walk, and in assist or play a marker at the
  destination. Read-only on the world.
- `corealm_overlay` (assist) — highlight, path, marker, label. Pure presentation.

A **marker is a destination**, wherever it comes from. It gets a pin, an optional `text` label,
and a ground route drawn from the player that re-plans as they walk. When the player arrives —
within `arriveRadius` (4 m for an entity, 8 m for a location, 5 m for a position), or by starting
to use the target — it clears itself with a small flourish and emits `overlay.arrived`; pass
`persist: true` to keep it, or `route: false` for a pin alone. The pinned quest's current
objective is drawn the same way for the player, and follows the quest's stages. `highlight` is
"this thing": a ring at the target with no route. So: mark the bank, then
`corealm_wait {events:["overlay.arrived"]}`.

### Bounded operations (act)
One call each, interruptible by Pause, Stop, Take control, or the caller's own AbortSignal.
- `corealm_navigate` — walk and wait for arrival.
- `corealm_follow_route` — several waypoints in order.
- `corealm_gather` — mine, chop, or fish until `quantity` items arrive; picks the nearest
  qualifying node and moves on when one depletes.
- `corealm_fight` — attack, wait for the outcome, optionally retreat below a health fraction, loot.
- `corealm_loot_nearby` — open and empty every pile within reach.
- `corealm_craft` — a production batch, waited to completion.
- `corealm_wait` (read) — block on events, idle, health, or respawn.

### Reading state (read)
- `corealm_player`, `corealm_skills`, `corealm_inventory`, `corealm_quests`, `corealm_spellbook`.
  `corealm_quests` lists quests from regions the player has entered whose prerequisites are done;
  objectives stay hidden until a quest is accepted. `currentObjectiveRefs` is the objective as ids.

### Finding things (read)
- `corealm_observe` — what is visible now (`scope: "visible"`, 140 m ceiling) or the places the
  player has discovered (`scope: "known"`). Discovery is real: a fresh character knows four
  places. `corealm_search_docs` lists every place's `locationId`, and `corealm_navigate` accepts
  one whether or not it is discovered — look it up, walk there, discover it on arrival.
- `corealm_inspect` — full detail on one entity.
- `corealm_search_docs` — the public documentation. Never quest solutions.

### Primitives (act)
- `corealm_move_to`, `corealm_stop`, `corealm_interact`, `corealm_take_loot`, `corealm_use_item`,
  `corealm_equip`, `corealm_produce`, `corealm_build_campfire`, `corealm_attack`.
- `corealm_dialogue`, `corealm_bank`, `corealm_shop` — `state` / `list` read in any mode; the
  other ops act.

### Events (read)
- `corealm_events` — the cursor and long-poll described above.

## Magic loadout and recharging

A cast needs a wand or staff in `mainHand` and one unit of matching fuel. A matching elemental
weapon spends one stored charge first, including on a miss. A plain or empty weapon spends one
carried Essence instead. Boss-dropped Orbs are altar keys: carry the matching Orb to the dormant
altar at that region's Essence Cache and use its `awaken` interaction. An awakened altar refills
the equipped elemental weapon to 1,000 for exactly 100 matching Essence.

## Three things that will surprise you

**Movement takes real time.** The character walks at 4.2 m/s over a real navmesh. `corealm_move_to`
returns immediately with an ETA; `corealm_navigate` waits for you.

**Interaction walks you into range automatically.** `corealm_interact` on something far away starts
walking and returns `{ started: "walking to ..." }`; the interaction runs on arrival.

**Gathering is a continuing activity.** One `corealm_interact` with `mine` keeps yielding ore until
the node depletes, your pack fills, you move, or you stop. `corealm_gather` counts for you.

## Distances are walking distances

`ObservedEntity.distance` is path length over the navmesh, not straight line. Trust the number.

## A complete worked example: train Mining from 1 to 10

```js
const agent = window.corealm.agent;

// Orient, then ask for the keys. The player clicks Allow in the panel.
const ctx = await agent.call("corealm_context", { sections: ["session", "skills"] });
if (ctx.session.mode !== "play") {
  const asked = await agent.call("corealm_session", {
    op: "request_control", objective: "Train Mining to 10 at the Bracken Pit", timeoutMs: 25000,
  });
  if (asked.status !== "granted") return;
}

while ((await agent.call("corealm_skills")).mining.level < 10) {
  await agent.call("corealm_navigate", { locationId: "bracken_pit" });
  const free = (await agent.call("corealm_inventory")).freeSlots;
  const mined = await agent.call("corealm_gather", { interaction: "mine", quantity: free });
  if (mined.error === "CANCELLED") return;              // the player stopped us
  await agent.call("corealm_navigate", { entityId: "coldbrace_bank" });
  await agent.call("corealm_bank", { op: "depositAll" });
}

await agent.call("corealm_session", { op: "release_control" });
```

That is about **a dozen tool calls** for the whole 1→10 climb.

## Being efficient

**Use the bounded operations.** They replace a dozen primitive calls each and return when done.

**Cache what does not change.** The XP table, recipes, item stats and region layouts are fixed for
a build. Read them once through `corealm_search_docs`, key the cache on
`agent.version().content`, and never ask again.

**Filter hard.** An unfiltered `corealm_observe` in a town returns mostly scenery. Pass
`archetypes`, `interaction`, and `requirementsMet: true`.

**Predict inventory.** 28 slots; ore does not stack. Bank before a session that will overflow.

## The optimisation that makes this a game

The highest-tier resource is not always the best one:

| Choice | XP/hour at Mining 12 |
| --- | --- |
| Tier 5 Corven ore, 38 m from the Rootfall bank | **16,521** |
| Tier 10 Kaldite ore, 188 m from the Highcairn bank | 14,266 |
| Tier 10 Kaldite ore, via the Sunder Ledge shortcut (needs Agility 10) | **18,409** |

Work it out from data you can read: `corealm_observe` gives tier and walking distance,
`corealm_search_docs` gives XP per gather, and success chance per 1.8 s attempt is
`0.30 + 0.016 * (effectiveLevel - requiredLevel)`, capped at 0.95.

## Information parity

You discover the world the way a player does.

- `corealm_inspect` on an entity you have never seen returns `NOT_FOUND`.
- `corealm_quests` lists what a player's journal would: nothing from a region they have not set
  foot in, nothing behind an unfinished prerequisite, no objective text before acceptance.
- `corealm_search_docs` returns documented public knowledge only.
- `corealm_observe` with `scope: "visible"` returns what is genuinely observable right now.

## Testing your agent

In a development build, `window.__gameDebug` offers deterministic setup: `setSkillLevel`,
`giveItem`, `teleport`, `advanceGameTime`, `setTimeScale`, `reset`. Use these to **set up** a
test, never to accomplish the task. `__gameDebug.callTool` runs a tool without the session gate,
for click-parity probes only; nothing reachable from WebMCP or `window.corealm.agent` can.
