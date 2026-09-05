/**
 * `corealm_manual`: what an agent that has never seen Corealm needs to know, from the game itself.
 *
 * A website cannot make an agent read its documentation site, and a tool description has to be
 * short. This is the layer between: the rules, the words, the event catalogue and the collaboration
 * contract, returned as structured text on request. The tool list inside it is generated from the
 * live registry, and the event and error catalogues are checked by test against the contract, so
 * the manual cannot say something the runtime does not do.
 */
import type { GameErrorCode, GameEventType } from "../contracts.js";
import { GAME_ERROR_CODES, GAME_EVENT_TYPES } from "../contracts.js";
import { MANUAL_TOPICS, TOOL_SPECS, type ManualTopic } from "./catalogue.js";
import { defineTool, type ToolDef, type ToolDeps } from "./toolkit.js";

/** One line per event type, plus the payload fields. Mirrors `GameEventPayloads` in contracts. */
export const EVENT_CATALOGUE: Record<GameEventType, { about: string; fields: string }> = {
  "navigation.started": { about: "The character began walking.", fields: "etaMs, pathLength?, points?, legs?, route?" },
  "navigation.completed": { about: "The character arrived.", fields: "position" },
  "navigation.failed": { about: "The walk ended early. reason is unreachable, cancelled, or movement-disabled.", fields: "reason, to?" },
  "activity.started": { about: "A gathering, production, traversal, eating or campfire activity began; banking and shopping also announce themselves here.", fields: "kind, skill?, entityId?, interaction?, recipeId?" },
  "activity.stopped": { about: "That activity ended. reason names why: complete, depleted, inventory-full, cancelled, moved, damaged.", fields: "kind, reason, skill?, entityId?, completed?, remaining?" },
  "resource.depleted": { about: "A node ran out. It respawns after respawnInSeconds.", fields: "entityId?, itemId?, tier?, respawnInSeconds?" },
  "inventory.full": { about: "Something could not be carried.", fields: "itemId?, name?, attempted?, added?, recipeId?" },
  "item.received": { about: "Items or marks entered the pack. source says how: gather, loot, buy, production. A loot pile drop lists items instead.", fields: "itemId?, name?, quantity?, source?, skill?, from?, currency?, pileId?, items?" },
  "item.lost": { about: "Items or marks left the pack: consumed, sold, or dropped on death.", fields: "itemId?, name?, quantity?, reason?, cacheId?, items?" },
  "item.equipped": { about: "Gear moved from the pack to a worn slot. Not an item.lost; replaced names what came off.", fields: "itemId, name, slot, replaced" },
  "item.unequipped": { about: "Gear moved from a worn slot to the pack. Not an item.received.", fields: "itemId, name, slot, quantity" },
  "combat.started": { about: "A fight began (initiator player or enemy). Boss choreography reuses this type with event = boss.phase, boss.telegraph, boss.slam.", fields: "initiator?, targetId?, by?, name?, spellId?, event?, enemyId?, phase?, centre?, radius?, firesAtMs?, damage?, hit?" },
  "combat.ended": { about: "A fight ended. reason is killed, disengaged, or fled. killed carries xp.", fields: "reason, enemyId?, name?, xp?" },
  "spell.launched": { about: "A cast was rolled and paid for; the bolt lands flightMs later. hit is already decided.", fields: "spellId, targetId, element, rung, flightMs, hit, fuelSource, weaponItemId, remainingCharges, essenceItemId, remainingEssence" },
  "essence.altarAwakened": { about: "A regional altar was awakened with its Orb.", fields: "altarId, element, orbItemId" },
  "essence.recharged": { about: "An altar refilled the equipped weapon. after is the new charge count.", fields: "altarId, weaponItemId, element, before, after, essenceItemId, essenceSpent" },
  "health.low": { about: "Health crossed below the low threshold.", fields: "health, maxHealth, fraction, threshold" },
  "player.died": { about: "The character died and will respawn. Carried items drop into a Recovery Cache at the death position.", fields: "position, regionId, respawnPointId, respawnPosition" },
  "level.gained": { about: "A skill levelled up.", fields: "skill, level, levelsGained" },
  "production.completed": { about: "One unit of a recipe finished.", fields: "recipeId?, recipeName?, skill?, kind?, tier?" },
  "campfire.built": { about: "A portable cooking fire was placed.", fields: "logItemId, tier, lifetimeMs, expiresAtPlaySeconds" },
  "campfire.replaced": { about: "A new campfire replaced the previous one.", fields: "previousLogItemId, previousTier, logItemId, tier" },
  "campfire.expired": { about: "The campfire burned out.", fields: "logItemId, tier, position" },
  "quest.updated": { about: "A quest was accepted, advanced, or completed. Only the current objective is ever included.", fields: "questId, status, stage, stageCount, objective, objectiveRefs" },
  "dialogue.opened": { about: "A conversation opened. Read it with corealm_dialogue {op:\"state\"} or corealm_context.", fields: "npcId, speaker, nodeId, optionCount" },
  "dialogue.closed": { about: "The conversation closed.", fields: "npcId" },
  "entity.discovered": { about: "The player came within 40 m of a place for the first time; it is now known.", fields: "locationId, regionId, via" },
  "agent.session": { about: "The collaboration session changed: mode, control owner, pause, objective, or connection. by says who did it.", fields: "change, mode, controlOwner, paused, objective, agentName, by" },
  "agent.task": { about: "A bounded operation started, completed, failed, or was cancelled.", fields: "taskId, tool, status, summary, reason?" },
  "agent.approval": { about: "An approval request was raised or answered.", fields: "requestId, kind, description, status" },
  "overlay.arrived": { about: "The player reached a marker overlay's target (corealm_overlay marker, corealm_route, or the current step of a corealm_propose plan). cleared says whether the marker took itself down.", fields: "id, position, cleared" },
  "agent.guide": { about: "A proposed plan's cursor moved: a step completed (via arrived, agent, or player) and the next is current; the last step completed (finished); or the plan was cleared. step and text are the now-current step, null when there is none.", fields: "change, completed, via, step, text, stepCount" },
};

export const ERROR_CATALOGUE: Record<GameErrorCode, string> = {
  NOT_FOUND: "No such entity, item, location, recipe, or request. For an entity: the player has never seen it, or the id is wrong.",
  OUT_OF_RANGE: "Too far away for this interaction. Walk closer (corealm_interact does this for you).",
  NOT_REACHABLE: "No route on the navmesh or the route graph reaches that place.",
  REQUIREMENTS_NOT_MET: "A skill level, tool, quest, or loadout requirement is missing. The message says which.",
  INVENTORY_FULL: "All 28 slots are taken. Bank, drop, or use something first.",
  BUSY: "Something is already running: an activity, a fight, or a bounded operation. Wait, or stop it.",
  INVALID_ARGUMENT: "The arguments failed the tool's schema. The message names the field.",
  DEAD: "The character is dead. Wait for the respawn.",
  DEPLETED: "The node has nothing left right now.",
  NOT_ENOUGH_CURRENCY: "Not enough marks.",
  NOT_ENOUGH_ITEMS: "The recipe or trade needs more of an item than the pack holds.",
  NO_DIALOGUE: "No conversation is open.",
  TIMEOUT: "The wait or the walk did not finish in time.",
  UNAVAILABLE: "A system is not ready or a defect was hit. Retry once; if it persists, stop.",
  NOT_PERMITTED: "The current mode or control owner does not allow this tool. Ask with corealm_session.",
  PAUSED: "The player paused the agent. Wait for the agent.session event that resumes it.",
  CANCELLED: "The player, a mode change, or your own cancel ended the operation early.",
  APPROVAL_REQUIRED: "The player has not answered yet. Wait with corealm_session {op:\"wait_approval\"} and retry.",
};

function overview(version: ToolDeps["version"]): string {
  return [
    "Corealm is a single-player browser RPG played by a human and an AI agent together, through one set of actions.",
    "The player walks a character across five regions (Farmland, Woodlands, Highlands, Ashlands, and the Stone Cavern dungeon), trains ten skills, accepts quests from NPCs, gathers resources, crafts at stations, fights enemies and bosses, banks, and trades.",
    "Every tool you have calls the same game function a click does. There is no privileged path and no cheat: if a human cannot do it, neither can you. Movement takes real time at 4.2 m/s; gathering rolls every 1.8 s; a fight lasts as long as it lasts.",
    `Versions: build ${version.build}, contracts ${version.contracts}, content ${version.content}. Cache what you learn from corealm_search_docs against the content version.`,
    "Start with corealm_context. It returns the session, the player, the surroundings, and suggested next actions as exact tool calls. Then act in the mode the player has given you (see topic modes).",
    "Nothing throws. Every failure is a result with `error` (a code from topic errors) and a human-readable `message` that says what is missing.",
  ].join("\n");
}

const MODES = [
  "Three collaboration modes, chosen by the player and reported in corealm_context.session.mode:",
  "guide — read-only. You answer questions, explain, and recommend. Tools that read (corealm_context, corealm_observe, corealm_search_docs, corealm_wait, ...) work; anything that draws or acts returns NOT_PERMITTED.",
  "assist — the player drives. You may draw routes and highlights (corealm_route, corealm_overlay) and put plans in front of them (corealm_propose). A marker is a destination: it carries a ground route from the player and clears itself when they arrive (overlay.arrived); a plan's current step is drawn the same way and the cursor advances on arrival (agent.guide). You may not move the character or change the world.",
  "play — you act. corealm_navigate, corealm_gather, corealm_fight, corealm_interact and the rest work while you hold control (session.controlOwner = \"agent\") and are not paused.",
  "You can set guide or assist yourself: corealm_session {op:\"set_mode\", mode}. Play is granted by the player: corealm_session {op:\"request_control\", objective} asks, the panel shows the request, and the call returns granted, denied, or pending. Say what you intend to do in the objective; the player reads it.",
  "When your task is done, corealm_session {op:\"release_control\"} hands the character back and drops you to assist. Summarise what changed.",
].join("\n");

const CONTROL = [
  "The player has an agent panel in the game with Pause, Stop, and Take control, plus an Allow/Deny prompt for your requests.",
  "Pause halts the character and parks your running operation; tools that act return PAUSED until Resume. Your operation continues from where it was.",
  "Stop cancels your operation, halts the character, hands control to the player, and drops you to assist. Your objective is kept; ask for control again if you want to continue.",
  "Take control hands the character to the player without halting it; your operation is cancelled with CANCELLED and you drop to assist.",
  "Every one of these arrives as an agent.session event with `by: \"player\"`. Wait on it with corealm_events or corealm_wait {events:[\"agent.session\"]}.",
  "What needs approval: entering play mode; and, in play mode, every shop buy or sell (the call waits for the answer). The player can pre-approve either kind in the panel.",
  "What never needs approval: reading, drawing, proposing, and once in play mode, moving, gathering, fighting, crafting, banking, dialogue, and equipment changes.",
  "To stop yourself: corealm_session {op:\"stop\"} halts the character and releases control; {op:\"cancel_task\"} ends just the running operation; {op:\"disconnect\"} leaves.",
].join("\n");

const RULES = [
  "Skills: melee, magic, mining, woodcutting, fishing, smithing, crafting, cooking, fletching, agility. Levels 1 to 99 on an exponential XP table (corealm_search_docs \"xp table\").",
  "Gathering: one corealm_interact on a node keeps yielding until the node depletes, the pack fills, the character moves, or you stop. Success per 1.8 s attempt is 0.30 + 0.016 × (effective level − required level), capped at 0.95. A more demanding resource is not always better XP per hour: distance to the bank matters.",
  "Inventory: 28 slots. Most resources do not stack. Bank at a bank entity (corealm_interact {interaction:\"bank\"}, then corealm_bank).",
  "Production: at the right station with the ingredients in the pack. corealm_craft runs a batch and waits. Recipes and stations are in corealm_search_docs.",
  "Combat: melee reaches 1.6 m and walks in; a wand or staff casts at 15 m. A cast costs one matching Essence or one weapon charge and lands flightMs later. Regeneration stops for eight seconds after any blow. Below the low-health threshold, eat (corealm_use_item on food) or retreat.",
  "Death: the character respawns at the last respawn point; carried items drop into a Recovery Cache at the death position that expires (simMs deadline) — go back and loot it.",
  "Quests: accepted by talking to the giver NPC and choosing the offer. The journal shows only the current stage's objective and the ids it refers to (currentObjectiveRefs). Later stages are hidden until reached, for you and for the player alike.",
  "Discovery: a fresh character knows a handful of places. Walking within 40 m of a place discovers it. corealm_search_docs lists every place's locationId, and corealm_navigate accepts a locationId whether or not it is discovered — look it up, walk there, discover it on arrival.",
  "Magic: boss-dropped Orbs are altar keys. Carry the Orb to the dormant altar at its region's Essence Cache and use awaken. An awakened altar recharges a matching elemental weapon: 100 matching Essence for 1000 charges.",
  "Time: the sim clock (corealm_player time.simMs) stamps every deadline. Never compare a deadline against wall time.",
].join("\n");

const TERMINOLOGY = [
  "entityId — a world object the player can see or has seen: nodes, NPCs, enemies, stations, banks, shops, loot piles. From corealm_observe.",
  "locationId — a place on the route graph, e.g. bracken_pit. From corealm_search_docs or corealm_observe {scope:\"known\"}. A bank entity coldbrace_bank stands at location bank_interior; only the location id goes to navigate {locationId}.",
  "archetype — what kind of entity: ore, tree, fishing_spot, enemy, boss, npc, station, bank, shop, obstacle, door, portal, loot, recovery_cache, landmark.",
  "interaction — a verb an entity offers: mine, chop, fish, attack, talk, open, enter, climb, vault, loot, take, awaken, produce, recharge, bank, trade, inspect.",
  "level — an enemy's combat level is calculated from its actual stats. Resource, equipment, and spell requirements are actual skill levels. Internal content bands are not player-facing levels.",
  "marks — the currency.",
  "Essence — carried spell fuel by element (Air, Earth, Water, Fire). The internal element name for Air is wind.",
  "requirementsMet / blockedBy — whether the player qualifies for an entity right now, and why not.",
  "revision — the state change token from corealm_context: {revision, eventSeq, simMs, tick}. Equal means nothing happened.",
  "cursor / sinceSeq / nextSeq — the event stream position. Pass nextSeq back as sinceSeq; never re-read from 0 once you have a cursor.",
  "controlOwner — who may move the character: player or agent.",
  "bounded operation — a tool that runs to a goal and returns (corealm_navigate, corealm_gather, corealm_fight, corealm_loot_nearby, corealm_craft, corealm_follow_route). One at a time; interruptible.",
].join("\n");

const EFFICIENCY = [
  "Use the bounded operations. corealm_gather {interaction:\"mine\", quantity: 20} is one call; the same job through corealm_interact and corealm_events is a dozen.",
  "Never poll. corealm_events with a timeout and a type filter blocks until something relevant happens. corealm_wait {idle:true} blocks until the character is free.",
  "Filter corealm_observe hard (archetypes, interaction, requirementsMet) or you get scenery.",
  "Read corealm_context with `sections` when you only need part of it.",
  "Cache the docs: XP tables, recipes and locations do not change within a content version.",
  "Predict the pack: 28 slots, most resources do not stack. Bank before a session that will overflow, not after.",
  "Check `dropped` on corealm_events. If true, re-read corealm_context instead of reconstructing from the stream.",
].join("\n");

function toolsText(tools: readonly ToolDef[]): string {
  const lines: string[] = ["Tools, in reading order. access: read = any mode, assist = assist or play, act = play with control."];
  for (const tool of tools) {
    const params = Object.keys((tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {});
    lines.push(`${tool.name} [${tool.access}${tool.annotations.readOnlyHint ? ", read-only" : ""}] — ${tool.title}. ${params.length ? `Args: ${params.join(", ")}.` : "No args."}`);
  }
  return lines.join("\n");
}

function eventsText(): string {
  const lines = ["Events arrive from corealm_events as {seq, type, atMs, entityId?, data}. atMs is sim time. Payload fields per type (? = optional):"];
  for (const type of GAME_EVENT_TYPES) {
    const entry = EVENT_CATALOGUE[type];
    lines.push(`${type} — ${entry.about} data: ${entry.fields}`);
  }
  return lines.join("\n");
}

function errorsText(): string {
  const lines = ["Every failure is {error, message, ...}. Codes:"];
  for (const code of GAME_ERROR_CODES) lines.push(`${code} — ${ERROR_CATALOGUE[code]}`);
  return lines.join("\n");
}

export function createManualTool({ version }: ToolDeps, tools: () => readonly ToolDef[]): ToolDef {
  return defineTool(TOOL_SPECS.corealm_manual, (args) => {
    const topic = (typeof args.topic === "string" ? args.topic : "overview") as ManualTopic;
    const sections: Record<Exclude<ManualTopic, "all">, () => string> = {
      overview: () => overview(version),
      modes: () => MODES,
      control: () => CONTROL,
      tools: () => toolsText(tools()),
      rules: () => RULES,
      terminology: () => TERMINOLOGY,
      events: eventsText,
      errors: errorsText,
      efficiency: () => EFFICIENCY,
    };
    if (topic === "all") {
      const out: Record<string, string> = {};
      for (const [name, render] of Object.entries(sections)) out[name] = render();
      return { topics: MANUAL_TOPICS.filter((entry) => entry !== "all"), ...out };
    }
    return { topic, text: sections[topic](), topics: MANUAL_TOPICS.filter((entry) => entry !== "all") };
  });
}
