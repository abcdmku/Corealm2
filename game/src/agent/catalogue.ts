/**
 * Every tool's static half: name, title, description, schema, access. Pure data, no handlers, so
 * the boot chunk can register the WebMCP descriptors and answer `listTools()` without loading
 * the handlers, validation, bounded operations, context builder or manual text — those arrive
 * with `agent/runtime.ts` on the first call. Reading order is the order an unfamiliar agent
 * should meet them: orientation, session, helping, operations, then the world.
 */
import { ARCHETYPES, EQUIP_SLOTS, GAME_EVENT_TYPES, INTERACTION_IDS } from "../contracts.js";
import type { AgentMode } from "../contracts.js";
import { ALL_SPELLS } from "../content/spells.js";
import { BOOL, ENUM, INT, NUM, STR, VEC3, obj, type ToolSpec } from "./toolkit.js";

export const MANUAL_TOPICS = [
  "overview", "modes", "control", "tools", "rules", "terminology", "events", "errors", "efficiency", "all",
] as const;
export type ManualTopic = (typeof MANUAL_TOPICS)[number];

export const CONTEXT_SECTIONS = [
  "session", "player", "skills", "inventory", "equipment", "magic", "quests", "nearby", "places",
  "dialogue", "combat", "activity", "bank", "shop", "events", "suggestions",
] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];

export const GATHER_INTERACTIONS = ["mine", "chop", "fish"] as const;
export type GatherInteraction = (typeof GATHER_INTERACTIONS)[number];

export const MAX_TIMEOUT_MS = 600_000;

const MODES: readonly AgentMode[] = ["guide", "assist", "play"];
const NUM_RADIUS = NUM("Metres. Default 40 for loot, 140 for gathering. Max 140.", { minimum: 1, maximum: 140 });
const NUM_FRACTION = NUM("Fraction of max health, 0 to 1", { minimum: 0, maximum: 1 });
const SPELL_IDS = ALL_SPELLS.map((spell) => spell.id);
const SECTIONS = CONTEXT_SECTIONS;

export const TOOL_SPECS = {
  corealm_player: {
    name: "corealm_player",
    title: "Read player state",
    access: "read",
    description:
      "Read the player's current state: position, region, health, whether they are in combat, "
      + "moving, dead, and what activity is running, plus the sim clock. Cheap. Prefer "
      + "corealm_context for a first read; use this for a quick re-check. Every deadline the game "
      + "reports, including a recovery cache's expiry, is stamped in the same sim "
      + "milliseconds as `time.simMs`, never in wall time.",
    inputSchema: obj({}),
  },
  corealm_skills: {
    name: "corealm_skills",
    title: "Read skills",
    access: "read",
    description:
      "Read all 10 skill levels with current XP and XP remaining to the next level. Use this to "
      + "decide what content the player qualifies for.",
    inputSchema: obj({}),
  },
  corealm_inventory: {
    name: "corealm_inventory",
    title: "Read inventory and equipment",
    access: "read",
    description:
      "Read the 28 inventory slots, the equipped items with their summed bonuses, and the mark "
      + "balance. `freeSlots` is what you check before starting a long gathering session.",
    inputSchema: obj({}),
  },
  corealm_quests: {
    name: "corealm_quests",
    title: "Read the quest journal",
    access: "read",
    description:
      "Read every quest the player knows about, with status, stage, and the current objective. "
      + "`currentObjective` is prose for a player; `currentObjectiveRefs` is the same objective as "
      + "ids you can act on. Unstarted quests appear once the player has entered their region and "
      + "met their prerequisites; their objectives stay hidden until accepted, exactly as for a "
      + "human. Quests are accepted by talking to their giver NPC through corealm_dialogue.",
    inputSchema: obj({}),
  },
  corealm_observe: {
    name: "corealm_observe",
    title: "Look around",
    access: "read",
    description:
      "List entities the player can currently see, or locations they have discovered. This is the "
      + "main way to find something to interact with. Results are sorted nearest first and "
      + "`distance` is walking distance over the navmesh, not straight line. In `known` scope, "
      + "a row backed by an entity has both its entity `id` and a `locationId`; a pure landmark "
      + "has `state: \"known\"` and its `id` is the location id. Filter hard: an unfiltered call "
      + "in a town is mostly scenery you cannot use.",
    inputSchema: obj({
      scope: ENUM(["visible", "known"], "visible = what is in range now (default); known = discovered locations"),
      radius: NUM("Metres. Default 40, max 140.", { minimum: 1, maximum: 140 }),
      archetypes: { type: "array", items: ENUM(ARCHETYPES, "Entity archetype"), maxItems: 16, description: "e.g. [\"ore\",\"tree\",\"bank\",\"npc\",\"enemy\"]" },
      interaction: ENUM(INTERACTION_IDS, "Only entities offering this interaction, e.g. \"mine\""),
      requirementsMet: BOOL("true = only what the player currently qualifies for"),
      regionId: STR("Restrict to one region id"),
      limit: INT("Default 25, max 100.", { minimum: 1, maximum: 100 }),
    }),
  },
  corealm_inspect: {
    name: "corealm_inspect",
    title: "Inspect one entity",
    access: "read",
    description:
      "Full detail for one entity: state, requirements, available interactions, and for a "
      + "resource node how many gathers it has left and how long it takes to respawn. NPC rows "
      + "list the quests they give. Returns NOT_FOUND for anything the player has never seen.",
    inputSchema: obj({ entityId: STR("Entity id from corealm_observe", { minLength: 1 }) }, ["entityId"]),
  },
  corealm_search_docs: {
    name: "corealm_search_docs",
    title: "Search the game documentation",
    access: "read",
    description:
      "Search Corealm's public game documentation: XP tables, skill guides, recipes, item stats, "
      + "region information, enemies, and every place with its `locationId`. This is documented "
      + "public knowledge, not hidden state: quest solutions and undiscovered secrets are never "
      + "in it. Use it to find where a resource is, then walk there with corealm_navigate.",
    inputSchema: obj({
      query: STR("Free text", { minLength: 1, maxLength: 200 }),
      limit: INT("Default 5, max 25", { minimum: 1, maximum: 25 }),
    }, ["query"]),
  },
  corealm_move_to: {
    name: "corealm_move_to",
    title: "Start walking",
    access: "act",
    description:
      "Start walking the character to an entity, a location id, or a world position. Movement is "
      + "at normal game speed over the real navmesh — this returns immediately with an ETA, it "
      + "does not teleport and does not block. Wait for navigation.completed, or use "
      + "corealm_navigate, which does the waiting for you.",
    inputSchema: obj({
      entityId: STR("Walk to this entity"),
      locationId: STR("Walk to this location id (see corealm_search_docs)"),
      position: VEC3,
    }),
  },
  corealm_stop: {
    name: "corealm_stop",
    title: "Stop the character",
    access: "act",
    description:
      "Cancel whatever the character is doing: navigation, the current activity, and combat. "
      + "To stop the AGENT rather than the character, call corealm_session {op:\"stop\"}.",
    inputSchema: obj({}),
  },
  corealm_interact: {
    name: "corealm_interact",
    title: "Interact with an entity",
    access: "act",
    description:
      "Perform an interaction on an entity: mine, chop, fish, talk, open, "
      + "climb, vault, loot, take, awaken, produce, recharge, bank, trade, inspect. If the character is out of "
      + "range this walks them into range first, exactly as a human click does, and returns "
      + "{ started: \"walking to ...\" }; wait for navigation.completed and the interaction runs "
      + "on arrival. Gathering interactions continue after one call until the node is depleted, "
      + "the pack is full, or you stop. Use awaken on a dormant regional Essence Altar while carrying "
      + "its matching boss Orb. For recharge, target that awakened altar while a matching charged "
      + "Air, Earth, or Water wand or staff is equipped; the altar spends exactly 100 matching "
      + "essence and fills the weapon to 1000 charges. A loot interaction only opens the "
      + "container; use corealm_take_loot to move stacks.",
    inputSchema: obj({
      entityId: STR("Entity id", { minLength: 1 }),
      interaction: ENUM(INTERACTION_IDS, "One of the entity's listed interactions"),
    }, ["entityId", "interaction"]),
  },
  corealm_take_loot: {
    name: "corealm_take_loot",
    title: "Take loot",
    access: "act",
    description:
      "Explicitly take loot after opening a loot pile or Recovery Cache. Give stackIndex to take "
      + "one displayed stack, or omit it to take everything that fits. Opening with "
      + "corealm_interact and the loot interaction never transfers items.",
    inputSchema: obj({
      entityId: STR("Opened loot container id", { minLength: 1 }),
      stackIndex: INT("Optional zero-based index in the displayed contents grid", { minimum: 0 }),
    }, ["entityId"]),
  },
  corealm_use_item: {
    name: "corealm_use_item",
    title: "Use an item",
    access: "act",
    description: "Use a carried item to eat food or equip gear.",
    inputSchema: obj({
      itemId: STR("Item to use", { minLength: 1 }),
    }, ["itemId"]),
  },
  corealm_equip: {
    name: "corealm_equip",
    title: "Equip or unequip",
    access: "act",
    description:
      "Equip an inventory item, or unequip a worn slot. Equipping checks skill requirements and "
      + "returns REQUIREMENTS_NOT_MET with the reason if the character does not qualify. Wands and "
      + "staffs occupy mainHand. Boss Orbs are altar keys and cannot be equipped.",
    inputSchema: obj({
      itemId: STR("Item to equip"),
      unequipSlot: ENUM(EQUIP_SLOTS, `Slot to clear. Slots: ${EQUIP_SLOTS.join(", ")}`),
    }),
  },
  corealm_produce: {
    name: "corealm_produce",
    title: "Start production",
    access: "act",
    description:
      "Start a production job at a station: smelt, smith, cook, craft, or fletch. Runs `quantity` "
      + "repetitions back to back and stops on missing ingredients, a full pack, movement, or "
      + "damage. Pass stationId to bind the exact selected station; otherwise the nearest valid "
      + "station is used. The character must already be at the right station. Returns "
      + "immediately; corealm_craft does the same and waits for the result.",
    inputSchema: obj({
      recipeId: STR("Recipe id from corealm_search_docs", { minLength: 1 }),
      quantity: INT("How many to make. Default 1.", { minimum: 1, maximum: 28 }),
      stationId: STR("Optional exact range, campfire, furnace, anvil, bench, or crafting station id"),
    }, ["recipeId"]),
  },
  corealm_build_campfire: {
    name: "corealm_build_campfire",
    title: "Build a campfire",
    access: "act",
    description:
      "Build a portable cooking fire from one carried log. The game chooses the first valid "
      + "nearby dry placement; the three-second build consumes the log only when it completes.",
    inputSchema: obj({ logItemId: STR("Oak, Maple, Pine, or Cedar log item id", { minLength: 1 }) }, ["logItemId"]),
  },
  corealm_attack: {
    name: "corealm_attack",
    title: "Attack a target",
    access: "act",
    description:
      "Attack an enemy with the main-hand weapon. With a wand or staff and no spellId, this casts "
      + "the selected spell when it is castable, otherwise the highest-level castable spell. If "
      + "none is castable it returns REQUIREMENTS_NOT_MET and does not attack in melee. Pass "
      + "spellId to require that exact spell. Magic reaches 15 metres; melee reaches 1.6 metres "
      + "and walks in first. One cast spends one matching Essence when the bolt launches, or one "
      + "weapon charge. Wands cast every 2200 ms and staffs every 3000 ms. Damage lands 0.3 to "
      + "1.3 seconds after launch: read spell.launched.data.flightMs before checking target "
      + "health. Attacking repeats on that cadence until the target dies, leaves pursuit range, "
      + "another command replaces it, or the character dies. corealm_fight wraps this and waits "
      + "for the outcome.",
    inputSchema: obj({
      entityId: STR("Enemy entity id", { minLength: 1 }),
      // Enumerated from the content table rather than typed out, because a hand-written list is
      // the thing that goes stale first, and the enum makes a bad id a schema rejection here
      // instead of a NOT_FOUND three calls later.
      spellId: ENUM(
        ALL_SPELLS.map((spell) => spell.id),
        "Optional. With a wand or staff, forces this spell; omit it to use the standing choice or "
        + "the strongest compatible spell automatically. With a non-magic weapon, supplying it "
        + "returns a loadout error. Advanced invocations (rank 1 to 5) fire once on the next cast "
        + "beat and also spend their tier rune, plus a Field Rune when they strike an area. Spells "
        + "and the Magic level each needs: "
        + ALL_SPELLS.map((spell) => `${spell.id} (${spell.element}, Magic ${spell.reqLevel})`).join(", ")
        + ". The player-facing Air Essence supplies wind spells.",
      ),
    }, ["entityId"]),
  },
  corealm_spellbook: {
    name: "corealm_spellbook",
    title: "Spellbook",
    access: "read",
    mutates: true,
    description:
      "Read the sixteen basic spells and twenty advanced invocations with the active automatic "
      + "choice, or set the standing choice. Each spell row returns id, name, element, rung, rank "
      + "(0 basic, 1 to 5 advanced), aoe, runes (itemId, name, quantity, carried), reqLevel, maxHit, "
      + "baseXp, castMs, requiredElement, fuelCost, unlocked, castable, blockedBy, and description. "
      + "The top-level result returns preferredSpellId, activeSpellId, magicLevel, equippedWeapon "
      + "(with live charges, capacity, rechargeItemId, rechargeCost), carried Essence by element, "
      + "releasedElements, the six runes with carried counts, and castLock while an advanced "
      + "invocation is still resolving. Automatic selection only ever picks a basic spell. Selecting a locked or currently incompatible spell is allowed; "
      + "automatic selection stands in until it becomes castable. Pass an explicit null spellId "
      + "to restore automatic selection. `select` is a loadout preference, not a world action, "
      + "so it is allowed in every mode.",
    inputSchema: obj({
      op: ENUM(["read", "select"], "read the spellbook, or select the standing spell"),
      spellId: ENUM([...ALL_SPELLS.map((spell) => spell.id), null], "Required when op is select. Null clears the choice back to automatic."),
    }, ["op"]),
  },
  corealm_dialogue: {
    name: "corealm_dialogue",
    title: "Conversation",
    access: "read",
    mutates: true,
    description:
      "Read the open dialogue (op state, allowed in every mode), choose an option by id, or end "
      + "the conversation. Choosing and ending change the world and need play mode. Talk to an "
      + "NPC first with corealm_interact using the \"talk\" interaction; accepting a quest is a "
      + "dialogue option.",
    inputSchema: obj({
      op: ENUM(["state", "choose", "end"], "state = read; choose = pick optionId; end = close"),
      optionId: STR("Required when op is choose"),
    }, ["op"]),
  },
  corealm_bank: {
    name: "corealm_bank",
    title: "Bank",
    access: "read",
    mutates: true,
    description:
      "Use a bank the character is standing at: list contents (allowed in every mode), deposit or "
      + "withdraw a quantity, or deposit everything (play mode). Open the bank first with "
      + "corealm_interact {interaction:\"bank\"} on a bank entity; corealm_navigate can take you "
      + "there. Banks are the geographic anchor of every gathering route.",
    inputSchema: obj({
      op: ENUM(["list", "deposit", "withdraw", "depositAll"], "What to do"),
      itemId: STR("Item to move"),
      quantity: INT("How many. Omit or use -1 for all of that item.", { minimum: -1 }),
      filter: STR("Substring filter for list"),
    }, ["op"]),
  },
  corealm_shop: {
    name: "corealm_shop",
    title: "Shop",
    access: "read",
    mutates: true,
    description:
      "Use a shop the character is standing at: list stock (allowed in every mode), buy, or sell "
      + "(play mode). Buying and selling spend the player's marks or goods, so each call asks the "
      + "player to approve unless they have pre-approved trades in the agent panel; the call "
      + "waits up to `approvalTimeoutMs` for the answer.",
    inputSchema: obj({
      op: ENUM(["list", "buy", "sell"], "What to do"),
      shopId: STR("Shop entity id"),
      itemId: STR("Item to trade"),
      quantity: INT("How many. Default 1.", { minimum: 1 }),
      approvalTimeoutMs: INT("How long to wait for the player's approval. Default 20000.", { minimum: 0, maximum: 120000 }),
    }, ["op"]),
  },
  corealm_overlay: {
    name: "corealm_overlay",
    title: "Draw in the player's view",
    access: "assist",
    description:
      "Draw or clear an assistance overlay in the player's world view. Pure presentation: it can "
      + "never change game state. Kinds: `highlight` rings a thing on the ground (\"this one\"); "
      + "`marker` is a destination (\"go here\") — a pin with a ground route drawn from the player "
      + "that follows them as they walk, plus `text` as a floating label, and it clears itself "
      + "when they arrive and emits overlay.arrived (pass `persist: true` to keep it; "
      + "`route: false` for a pin alone); `path` draws a polyline you supply; `label` is text "
      + "alone. Use `locationId` for a known place and `entityId` for a real entity; if a "
      + "location id is passed as `entityId` it is resolved as a location. Unknown targets return "
      + "NOT_FOUND and draw nothing. Reusing an id replaces that overlay.",
    inputSchema: obj({
      op: ENUM(["set", "clear"], "set draws; clear removes one id, or everything when id is omitted"),
      id: STR("Overlay id. Reusing an id replaces it."),
      kind: ENUM(["highlight", "path", "marker", "label"], "What to draw"),
      entityId: STR("Entity to attach to"),
      locationId: STR("Known place id to mark at its fixed world position"),
      position: VEC3,
      path: { type: "array", items: VEC3, minItems: 2, maxItems: 512, description: "Polyline for kind path" },
      text: STR("Label text. On a marker it floats above the pin.", { maxLength: 80 }),
      colour: STR("#rrggbb"),
      ttlMs: INT("Auto-clear after this long. 0 or omitted means until cleared.", { minimum: 0 }),
      persist: BOOL("Marker only: keep it after the player arrives. Default false."),
      arriveRadius: NUM("Marker only: metres from the target that count as arriving. Defaults: 4 for an entity, 8 for a location, 5 for a position.", { minimum: 1, maximum: 40 }),
      route: BOOL("Marker only: draw the ground route from the player. Default true."),
    }, ["op"]),
  },
  corealm_events: {
    name: "corealm_events",
    title: "Read or wait for events",
    access: "read",
    description:
      "Read game events since a cursor, optionally blocking until one arrives. Pass each returned "
      + "nextSeq as the next sinceSeq. A timeout lets you wait for inventory.full or "
      + "resource.depleted without polling. The ring keeps the last 512 events: if your cursor "
      + "is older than that, `dropped` is true and `droppedCount` says how many you missed — "
      + "re-read corealm_context rather than trusting a reconstruction. Session changes "
      + "(agent.session, agent.task, agent.approval) arrive on this stream too. Payload shapes "
      + "per type are in corealm_manual {topic:\"events\"}.",
    inputSchema: obj({
      sinceSeq: INT("Cursor. Use 0 on the first call, then the nextSeq you were given.", { minimum: 0 }),
      types: {
        type: "array",
        items: ENUM(GAME_EVENT_TYPES, "Event type"),
        maxItems: 32,
        description: "Optional event-type filter, for example [\"inventory.full\",\"resource.depleted\"].",
      },
      timeoutMs: INT("Block up to this long waiting for a matching event. Omit or 0 to return immediately. Max 120000.", { minimum: 0, maximum: 120_000 }),
    }),
  },
  corealm_navigate: {
    name: "corealm_navigate",
    title: "Walk somewhere and wait",
    access: "act",
    description:
      "Walk the character to an entity, a location id, or a position, and return when they "
      + "arrive. This is corealm_move_to plus the wait for navigation.completed. Walking is at "
      + "game speed (4.2 m/s over the navmesh, portals and Agility shortcuts included), so a "
      + "200 m trip takes about 50 s. Location ids come from corealm_search_docs or "
      + "corealm_observe {scope:\"known\"}. Interruptible: Stop, Take control, or Pause in the "
      + "agent panel end or park it.",
    inputSchema: obj({
      entityId: STR("Walk to this entity"),
      locationId: STR("Walk to this location id"),
      position: VEC3,
      timeoutMs: INT("Give up after this long. Default 120000, max 600000.", { minimum: 1000, maximum: MAX_TIMEOUT_MS }),
    }),
  },
  corealm_follow_route: {
    name: "corealm_follow_route",
    title: "Follow a route",
    access: "act",
    description:
      "Walk through a list of waypoints in order and return at the last one. Each waypoint is an "
      + "entity id, a location id, or a position. Stops at the first waypoint that cannot be "
      + "reached and reports how far it got.",
    inputSchema: obj({
      waypoints: {
        type: "array", minItems: 1, maxItems: 12,
        items: obj({ entityId: STR("Entity id"), locationId: STR("Location id"), position: VEC3 }),
        description: "Waypoints in walking order",
      },
      timeoutMs: INT("Give up after this long in total. Default 300000, max 600000.", { minimum: 1000, maximum: MAX_TIMEOUT_MS }),
    }, ["waypoints"]),
  },
  corealm_gather: {
    name: "corealm_gather",
    title: "Gather a quantity",
    access: "act",
    description:
      "Mine, chop, or fish until `quantity` items have been received, then stop. "
      + "Give entityId for a specific node, or omit it and the nearest visible node offering "
      + "`interaction` that the player qualifies for is used, moving to another when one "
      + "depletes. Walks into range first. Returns early with `reason` on a full pack, a death, "
      + "no reachable node, or the timeout. One call replaces dozens: a level-1 to level-10 "
      + "mining session is one corealm_gather of about 40 ore.",
    inputSchema: obj({
      interaction: ENUM(GATHER_INTERACTIONS, "Which gathering verb"),
      entityId: STR("A specific node. Omit to pick the nearest qualifying node automatically."),
      quantity: INT("How many items to collect before stopping. Max 28.", { minimum: 1, maximum: 28 }),
      radius: NUM_RADIUS,
      timeoutMs: INT("Give up after this long. Default 300000, max 600000.", { minimum: 1000, maximum: MAX_TIMEOUT_MS }),
    }, ["interaction", "quantity"]),
  },
  corealm_fight: {
    name: "corealm_fight",
    title: "Fight a target",
    access: "act",
    description:
      "Attack one enemy and return when the fight ends: the target dies, disengages, the "
      + "character dies, or health falls below `retreatBelow` (a fraction of max health; the "
      + "character then stops attacking and the call returns `retreated`). With `loot` true, "
      + "any loot pile the kill dropped is opened and emptied before returning. Uses the "
      + "main-hand weapon and the standing spell like corealm_attack; pass spellId to force one.",
    inputSchema: obj({
      entityId: STR("Enemy entity id", { minLength: 1 }),
      spellId: ENUM(SPELL_IDS, "Optional spell to force"),
      retreatBelow: NUM_FRACTION,
      loot: BOOL("Take the drops afterwards. Default true."),
      timeoutMs: INT("Give up after this long. Default 180000, max 600000.", { minimum: 1000, maximum: MAX_TIMEOUT_MS }),
    }, ["entityId"]),
  },
  corealm_loot_nearby: {
    name: "corealm_loot_nearby",
    title: "Loot nearby drops",
    access: "act",
    description:
      "Open and empty every visible loot pile and Recovery Cache within `radius` metres that the "
      + "player can carry, walking to each. Returns what was taken and what had to be left "
      + "behind for lack of space.",
    inputSchema: obj({
      radius: NUM_RADIUS,
      timeoutMs: INT("Give up after this long. Default 120000.", { minimum: 1000, maximum: MAX_TIMEOUT_MS }),
    }),
  },
  corealm_craft: {
    name: "corealm_craft",
    title: "Produce and wait",
    access: "act",
    description:
      "Run a production recipe `quantity` times at the station the character is standing at "
      + "and return when the batch finishes or stops early. This is corealm_produce plus the "
      + "wait for production.completed. Reports how many were made and why it stopped: "
      + "complete, missing ingredients, a full pack, or interruption. Walk to the station first "
      + "with corealm_navigate; recipes and their stations are in corealm_search_docs.",
    inputSchema: obj({
      recipeId: STR("Recipe id", { minLength: 1 }),
      quantity: INT("How many. Default 1, max 28.", { minimum: 1, maximum: 28 }),
      stationId: STR("Optional exact station entity id"),
      timeoutMs: INT("Give up after this long. Default 300000.", { minimum: 1000, maximum: MAX_TIMEOUT_MS }),
    }, ["recipeId"]),
  },
  corealm_wait: {
    name: "corealm_wait",
    title: "Wait for a condition",
    access: "read",
    description:
      "Block until a condition holds, then return. Conditions: `events` (any of these types "
      + "arrives), `idle` (the character is not moving, not in an activity, and not in combat), "
      + "`healthAtLeast` (a fraction of max health, for waiting out regeneration), "
      + "`respawned` (the character is alive again). Give at least one. Returns which condition "
      + "was met and any matching events. Read-only, so it works in every mode; while the "
      + "player drives it is how you follow along.",
    inputSchema: obj({
      events: { type: "array", items: ENUM(GAME_EVENT_TYPES, "Event type"), maxItems: 32, description: "Return when any of these arrives" },
      idle: BOOL("Return when the character is idle"),
      healthAtLeast: NUM_FRACTION,
      respawned: BOOL("Return when the character is alive"),
      timeoutMs: INT("Give up after this long. Default 60000, max 120000.", { minimum: 1000, maximum: 120_000 }),
    }),
  },
  corealm_session: {
    name: "corealm_session",
    title: "Agent session and control",
    access: "read",
    mutates: true,
    description:
      "The control channel between you and the player. Ops: `read` the session; `connect` with "
      + "your agentName so the panel shows who is helping; `set_objective` to state what you "
      + "are working on; `set_activity` to say what you are doing right now; `set_mode` to "
      + "guide or assist (play is granted by the player, not set); `request_control` to ask "
      + "for play mode and the character — this waits up to `timeoutMs` for the player's "
      + "answer and returns `granted`, `denied`, or `pending` with a requestId; `wait_approval` "
      + "to keep waiting on a pending requestId; `release_control` when your task is done; "
      + "`cancel_task` to end a running bounded operation; `stop` to halt the character and "
      + "hand control back at once; `disconnect` to leave. The player can pause, stop, or take "
      + "control at any moment from the agent panel, and every change arrives as an "
      + "agent.session event.",
    inputSchema: obj({
      op: ENUM([
        "read", "connect", "set_objective", "set_activity", "set_mode", "request_control",
        "wait_approval", "release_control", "cancel_task", "stop", "disconnect",
      ], "What to do"),
      agentName: STR("For connect: how the panel names you, e.g. \"ChatGPT\"", { maxLength: 48 }),
      objective: STR("For set_objective and request_control: what you intend to do, in one line", { maxLength: 200 }),
      activity: STR("For set_activity: what you are doing right now, in one line", { maxLength: 160 }),
      mode: ENUM(MODES, "For set_mode: guide or assist. play goes through request_control."),
      reason: STR("For request_control: why you need control, shown to the player", { maxLength: 240 }),
      requestId: STR("For wait_approval: the pending request"),
      timeoutMs: INT("For request_control and wait_approval: how long to wait for the player. Default 25000, max 120000.", { minimum: 0, maximum: 120_000 }),
    }, ["op"]),
  },
  corealm_propose: {
    name: "corealm_propose",
    title: "Propose a plan",
    access: "read",
    mutates: true,
    description:
      "Put a plan in front of the player: a one-line summary and up to eight steps, with a cursor. "
      + "The agent panel lists the steps and marks the current one. In assist or play mode the "
      + "current step's place (entityId, locationId or position) is drawn in the world as a pin "
      + "with a ground route from the player, and later steps as numbered labels. When the player "
      + "reaches the current step's place it is completed, its marker clears, and the next step "
      + "lights up — you get an agent.guide event each time. A step with `done: \"manual\"` (or "
      + "no place) waits for you: call again with `advance: true` once you see it is done. "
      + "Nothing is executed. Call with `clear: true` to take the plan down.",
    inputSchema: obj({
      summary: STR("What the plan achieves, in one line", { maxLength: 200 }),
      steps: {
        type: "array", maxItems: 8,
        items: obj({
          text: STR("The step, for the player", { minLength: 1, maxLength: 160 }),
          tool: STR("The tool you would call for this step, if any"),
          entityId: STR("Entity this step happens at, for the marker"),
          locationId: STR("Location this step happens at, for the marker"),
          position: VEC3,
          done: ENUM(["arrive", "manual"], "How the step completes. Default arrive when the step has a place, manual otherwise."),
          arriveRadius: NUM("Metres from the place that count as arriving. Defaults: 4 for an entity, 8 for a location, 5 for a position.", { minimum: 1, maximum: 40 }),
        }, ["text"]),
        description: "Ordered steps",
      },
      advance: BOOL("Complete the current step by hand and move the cursor to the next one"),
      clear: BOOL("Remove the current proposal instead of setting one"),
    }),
  },
  corealm_route: {
    name: "corealm_route",
    title: "Preview a route",
    access: "read",
    mutates: true,
    description:
      "Compute the path the character would walk to an entity, a location id, or a position, "
      + "without walking it: the polyline, its length in metres, the ETA, and any portal or "
      + "Agility-shortcut hops it needs. In assist or play mode the destination is also marked in "
      + "the player's view — a pin with a ground route that re-plans from the player as they walk "
      + "and clears itself when they arrive (overlay.arrived) — pass draw: false to skip that; in "
      + "guide mode it is computed only. Mark a route, then let the player walk it — that is "
      + "assist mode's main move. `clear: true` removes the marked route early.",
    inputSchema: obj({
      entityId: STR("Route to this entity"),
      locationId: STR("Route to this location id"),
      position: VEC3,
      draw: BOOL("Draw the route in the world. Default true outside guide mode."),
      label: STR("Optional label at the destination", { maxLength: 60 }),
      clear: BOOL("Remove the marked route instead of computing one"),
    }),
  },
  corealm_context: {
    name: "corealm_context",
    title: "Read the whole situation",
    access: "read",
    description:
      "Call this first. One atomic snapshot of everything: what Corealm is and its versions; the "
      + "agent session (mode, who holds control, pause, objective, pending approval); the player's "
      + "position, health, activity and combat state; skills, currency, inventory and worn "
      + "equipment; magic loadout; active, available and complete quests with objective ids; "
      + "entities within 40 m with their interactions; nearest known places; any open "
      + "conversation, bank or shop; the state revision, the last few events, and the event "
      + "cursor to continue from; "
      + "and ranked suggested next actions as exact tool calls. Pass `sections` to read a subset. "
      + "Read corealm_manual once for the rules, then use this whenever you need to re-orient.",
    inputSchema: obj({
      sections: {
        type: "array", items: ENUM(SECTIONS, "Section"), maxItems: SECTIONS.length,
        description: `Optional subset. All of: ${SECTIONS.join(", ")}`,
      },
    }),
  },
  corealm_manual: {
    name: "corealm_manual",
    title: "Read the manual",
    access: "read",
    description:
      "How Corealm works, from the game itself. Topics: overview (what this is and how to start), "
      + "modes (guide, assist, play and how to move between them), control (pause, stop, take "
      + "control, what needs approval, how to stop yourself), tools (every tool with its access "
      + "level), rules (skills, gathering, combat, death, quests, discovery, magic, time), "
      + "terminology (ids and words the tools use), events (every event type and its payload), "
      + "errors (every error code), efficiency (how to spend few calls), or all. Read overview and "
      + "modes once; look the rest up as needed.",
    inputSchema: obj({ topic: ENUM(MANUAL_TOPICS, "Which topic. Default overview.") }),
  },
} as const satisfies Record<string, ToolSpec>;

export type ToolName = keyof typeof TOOL_SPECS;

/** Reading order. */
export const TOOL_ORDER: readonly ToolName[] = [
  // Orientation.
  "corealm_context", "corealm_manual", "corealm_session",
  // Helping the player.
  "corealm_propose", "corealm_route", "corealm_overlay",
  // Bounded operations.
  "corealm_navigate", "corealm_follow_route", "corealm_gather", "corealm_fight", "corealm_loot_nearby",
  "corealm_craft", "corealm_wait",
  // Reading and finding.
  "corealm_player", "corealm_skills", "corealm_inventory", "corealm_quests", "corealm_spellbook",
  "corealm_observe", "corealm_inspect", "corealm_search_docs",
  // Primitives.
  "corealm_move_to", "corealm_stop", "corealm_interact", "corealm_take_loot", "corealm_use_item",
  "corealm_equip", "corealm_produce", "corealm_build_campfire", "corealm_attack",
  "corealm_dialogue", "corealm_bank", "corealm_shop",
  // Events.
  "corealm_events",
];
