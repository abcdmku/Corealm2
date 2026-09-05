/**
 * `corealm_context`: the one call an unfamiliar agent makes first.
 *
 * Everything an agent needs to orient in one atomic read of the same tick: who it is talking to,
 * what mode it is in, where the player is, what they carry, what is near, what they are in the
 * middle of, and what it could legally do next. It reads through `GameApi` like every other tool
 * — there is nothing here the individual tools cannot return — but it reads it all at once, so
 * the revision it reports is one revision and not eight reads from eight different moments.
 *
 * The `suggestedActions` list is heuristics over the same snapshot. They are suggestions, ranked,
 * with the exact tool call each one means, and they never name a tool the current mode forbids
 * without saying what to ask for.
 */
import type {
  ActivitySummary, DialogueView, GameApi, InventorySlot, ObservedEntity, PlayerView, QuestObjectiveRef,
  QuestSummary, SemanticEntity,
} from "../contracts.js";
import { content } from "../content/index.js";
import type { AgentSession } from "./session.js";
import { CONTEXT_SECTIONS as SECTIONS, TOOL_SPECS, type ContextSection as Section } from "./catalogue.js";
import { defineTool, type ToolDef, type ToolDeps } from "./toolkit.js";

interface SuggestedAction {
  tool: string;
  args: Record<string, unknown>;
  why: string;
  /** Present when the tool needs a mode the session is not in. */
  requires?: string;
}

function compactSlots(slots: (InventorySlot | null)[]): { slot: number; itemId: string; name: string; quantity: number }[] {
  const rows: { slot: number; itemId: string; name: string; quantity: number }[] = [];
  for (const slot of slots) {
    if (!slot) continue;
    rows.push({ slot: slot.slotIndex, itemId: slot.itemId, name: content.item(slot.itemId)?.name ?? slot.itemId, quantity: slot.quantity });
  }
  return rows;
}

function compactEntity(row: ObservedEntity): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    archetype: row.archetype,
    tier: row.tier,
    distance: Math.round(row.distance * 10) / 10,
    state: row.state,
    interactions: row.interactions,
    requirementsMet: row.requirementsMet,
    ...(row.blockedBy ? { blockedBy: row.blockedBy } : {}),
    ...(row.locationId ? { locationId: row.locationId } : {}),
  };
}

function refToTarget(ref: QuestObjectiveRef): Record<string, unknown> | null {
  if (ref.kind === "location") return { locationId: ref.id };
  if (ref.kind === "entity") return { entityId: ref.id };
  return null;
}

const RECENT_EVENTS = 12;

export async function buildContext(api: GameApi, session: AgentSession, version: ToolDeps["version"], sections: ReadonlySet<Section>): Promise<Record<string, unknown>> {
  const want = (section: Section): boolean => sections.has(section);
  const revision = api.getRevision();
  const player = api.getPlayer();
  const time = api.getTime();
  const sessionView = session.read();
  const out: Record<string, unknown> = {
    game: {
      name: "Corealm",
      summary: "A browser RPG: ten skills, five regions, quests, crafting and combat, played by a human and any WebMCP agent through the same actions. Read corealm_manual for the rules.",
      version,
    },
    revision,
    time,
  };

  if (want("session")) {
    out.session = {
      ...sessionView,
      controls: {
        requestControl: 'corealm_session {op:"request_control", objective}',
        releaseControl: 'corealm_session {op:"release_control"}',
        stopAgent: 'corealm_session {op:"stop"}',
        playerCanAlways: "pause, stop, or take control from the agent panel; every change is an agent.session event",
      },
      approvalRequired: [
        "entering play mode (request_control)",
        "each shop buy or sell in play mode, unless the player pre-approved trades in the panel",
      ],
    };
  }

  if (want("player")) out.player = player;
  if (want("skills")) out.skills = api.getSkills();

  const inventory = api.getInventory();
  if (want("inventory")) {
    out.inventory = { freeSlots: inventory.freeSlots, capacity: inventory.slots.length, items: compactSlots(inventory.slots), currency: api.getCurrency() };
  }
  if (want("equipment")) {
    const equipment = api.getEquipment();
    const worn: Record<string, unknown> = {};
    for (const [slot, stack] of Object.entries(equipment.slots)) {
      worn[slot] = stack ? { itemId: stack.itemId, name: content.item(stack.itemId)?.name ?? stack.itemId, quantity: stack.quantity } : null;
    }
    out.equipment = { slots: worn, totals: equipment.totals };
  }

  if (want("magic")) {
    const spellbook = api.getSpellbook();
    out.magic = {
      magicLevel: spellbook.magicLevel,
      activeSpellId: spellbook.activeSpellId,
      preferredSpellId: spellbook.preferredSpellId,
      equippedWeapon: spellbook.equippedWeapon,
      essence: spellbook.essence,
      castable: spellbook.spells.filter((spell) => spell.castable).map((spell) => spell.id),
    };
  }

  const quests = api.getQuests();
  if (want("quests")) {
    out.quests = {
      active: quests.filter((quest) => quest.status === "active").map((quest) => ({
        id: quest.id, name: quest.name, stage: quest.stage, stageCount: quest.stageCount,
        objective: quest.currentObjective, refs: quest.currentObjectiveRefs, regionId: quest.regionId,
      })),
      available: quests.filter((quest) => quest.status === "unstarted").map((quest) => ({
        id: quest.id, name: quest.name, regionId: quest.regionId, requirements: quest.requirements,
      })),
      complete: quests.filter((quest) => quest.status === "complete").map((quest) => quest.id),
    };
  }

  const nearby = want("nearby") || want("suggestions") ? api.observe({ radius: 40, limit: 40 }) : [];
  if (want("nearby")) {
    const useful = nearby.filter((row) => row.archetype !== "landmark" && row.archetype !== "obstacle" || row.interactions.length > 1);
    out.nearby = { radius: 40, count: nearby.length, entities: useful.slice(0, 20).map(compactEntity) };
  }
  if (want("places")) {
    const known = api.observe({ scope: "known", limit: 100 });
    out.places = {
      knownCount: known.length,
      nearest: known.slice(0, 12).map((row) => ({
        locationId: row.locationId ?? row.id, name: row.name, archetype: row.archetype, regionId: row.regionId,
        distance: Math.round(row.distance), ...(row.locationId && row.id !== row.locationId ? { entityId: row.id } : {}),
      })),
      hint: "Undiscovered places are found through corealm_search_docs, which lists every locationId.",
    };
  }

  const dialogue = api.dialogue("state");
  const dialogueView = dialogue.ok ? dialogue.value : null;
  if (want("dialogue")) out.dialogue = dialogueView;

  if (want("combat")) {
    out.combat = {
      inCombat: player.inCombat, targetId: player.targetId, engagedBy: player.engagedBy,
      regenBlocked: player.regenBlocked, health: player.health, maxHealth: player.maxHealth,
    };
  }
  const activity = api.getActivity();
  if (want("activity")) out.activity = activity;

  if (want("bank")) {
    const bank = api.bank("list");
    out.bank = bank.ok ? { open: true, ...bank.value } : { open: false, reason: bank.error.message };
  }
  if (want("shop")) {
    const shop = api.shop("list");
    out.shop = shop.ok ? { open: true, ...shop.value } : { open: false, reason: shop.error.message };
  }

  if (want("events")) {
    // A non-blocking read of the tail, so "what just happened" comes with "what is happening".
    // `nextSeq` is the cursor to continue from.
    const seq = revision.eventSeq;
    const tail = await api.events(Math.max(0, seq - RECENT_EVENTS), undefined, 0);
    out.events = {
      nextSeq: seq,
      recent: tail.events.map((event) => ({
        seq: event.seq, type: event.type, atMs: event.atMs,
        ...(event.entityId ? { entityId: event.entityId } : {}),
        ...(typeof event.data.reason === "string" ? { reason: event.data.reason } : {}),
      })),
      hint: `Call corealm_events {sinceSeq: ${seq}, timeoutMs} to wait for what happens next.`,
    };
  }

  if (want("suggestions")) {
    out.suggestedActions = suggest(api, session, player, quests, nearby, inventory, dialogueView, activity);
  }

  return out;
}

function suggest(
  api: GameApi,
  session: AgentSession,
  player: PlayerView,
  quests: QuestSummary[],
  nearby: ObservedEntity[],
  inventory: ReturnType<GameApi["getInventory"]>,
  dialogue: DialogueView | null,
  activity: ActivitySummary | null,
): SuggestedAction[] {
  const view = session.read();
  const canAct = view.mode === "play" && view.controlOwner === "agent" && !view.paused;
  const needPlay = canAct ? undefined : 'play mode with control: corealm_session {op:"request_control"}';
  const act = (tool: string, args: Record<string, unknown>, why: string): SuggestedAction =>
    needPlay ? { tool, args, why, requires: needPlay } : { tool, args, why };
  const out: SuggestedAction[] = [];

  if (view.pendingApproval) {
    out.push({ tool: "corealm_session", args: { op: "wait_approval", requestId: view.pendingApproval.id }, why: `The player has not answered "${view.pendingApproval.description}" yet.` });
    return out;
  }
  if (view.paused) {
    out.push({ tool: "corealm_wait", args: { events: ["agent.session"], timeoutMs: 60_000 }, why: "The player paused the agent. Wait for resume." });
    return out;
  }
  if (player.dead) {
    out.push({ tool: "corealm_wait", args: { respawned: true, timeoutMs: 30_000 }, why: "The character is dead and will respawn at the last respawn point." });
    return out;
  }
  if (dialogue) {
    const enabled = dialogue.options.filter((option) => option.enabled);
    if (enabled[0]) {
      out.push(act("corealm_dialogue", { op: "choose", optionId: enabled[0].id }, `A conversation with ${dialogue.speaker} is open. Options: ${enabled.map((option) => `${option.id} = "${option.text}"`).join("; ")}`));
    }
    out.push(act("corealm_dialogue", { op: "end" }, "Close the conversation."));
    return out;
  }
  if (activity) {
    out.push({ tool: "corealm_wait", args: { idle: true, timeoutMs: 60_000 }, why: `The character is busy (${activity.kind}${activity.recipeId ? `: ${activity.recipeId}` : ""}). Wait for it to finish, or corealm_stop.` });
  }
  if (player.inCombat && player.targetId) {
    out.push(act("corealm_fight", { entityId: player.targetId, loot: true }, "A fight is in progress. Finish it and loot."));
  } else if (player.engagedBy.length > 0) {
    out.push(act("corealm_fight", { entityId: player.engagedBy[0], loot: true }, `${player.engagedBy[0]} is attacking the character.`));
  }

  const healthFraction = player.health / Math.max(1, player.maxHealth);
  if (healthFraction < 0.45) {
    const food = inventory.slots.find((slot) => slot && content.item(slot.itemId)?.food);
    if (food) out.push(act("corealm_use_item", { itemId: food.itemId }, `Health is at ${Math.round(healthFraction * 100)}%. Eat ${content.item(food.itemId)?.name ?? food.itemId}.`));
    else out.push({ tool: "corealm_wait", args: { healthAtLeast: 0.8, timeoutMs: 120_000 }, why: `Health is at ${Math.round(healthFraction * 100)}% and there is no food. Regeneration resumes eight seconds after the last blow.` });
  }

  const loot = nearby.filter((row) => row.archetype === "loot" || row.archetype === "recovery_cache");
  if (loot.length > 0 && inventory.freeSlots > 0) {
    out.push(act("corealm_loot_nearby", { radius: 40 }, `${loot.length} loot ${loot.length === 1 ? "pile is" : "piles are"} within 40 m.`));
  }

  if (inventory.freeSlots === 0) {
    const bank = api.observe({ scope: "known", archetypes: ["bank"], limit: 1 })[0];
    if (bank) out.push(act("corealm_navigate", { entityId: bank.id }, `The pack is full. The nearest known bank is ${bank.name}, ${Math.round(bank.distance)} m away; then corealm_interact {interaction:"bank"} and corealm_bank {op:"depositAll"}.`));
    else out.push({ tool: "corealm_search_docs", args: { query: "bank" }, why: "The pack is full and no bank is known yet." });
  }

  const active = quests.find((quest) => quest.status === "active");
  if (active) {
    const refs = active.currentObjectiveRefs;
    const entityRef = refs.find((ref) => ref.kind === "entity");
    const locationRef = refs.find((ref) => ref.kind === "location");
    const target = entityRef ? refToTarget(entityRef) : locationRef ? refToTarget(locationRef) : null;
    if (target) {
      const near = entityRef ? nearby.find((row) => row.id === entityRef.id) : null;
      if (near && near.interactions.includes("talk")) {
        out.push(act("corealm_interact", { entityId: near.id, interaction: "talk" }, `Quest "${active.name}": ${active.currentObjective ?? ""} ${near.name} is ${Math.round(near.distance)} m away.`));
      } else {
        out.push(act("corealm_navigate", target, `Quest "${active.name}", stage ${active.stage + 1}/${active.stageCount}: ${active.currentObjective ?? ""}`));
      }
    } else if (refs.some((ref) => ref.kind === "item" || ref.kind === "recipe" || ref.kind === "enemyFamily")) {
      const ref = refs[0]!;
      out.push({ tool: "corealm_search_docs", args: { query: ref.id.replace(/_/g, " ") }, why: `Quest "${active.name}": ${active.currentObjective ?? ""} Look up where to get "${ref.id}".` });
    }
  } else {
    const givers = nearby.filter((row) => row.archetype === "npc" && row.interactions.includes("talk"));
    for (const giver of givers.slice(0, 3)) {
      const detail = api.inspect(giver.id);
      const questIds = detail.ok ? (detail.value as SemanticEntity).npc?.questIds ?? [] : [];
      const offered = questIds.filter((id) => quests.some((quest) => quest.id === id && quest.status === "unstarted"));
      if (offered.length > 0) {
        out.push(act("corealm_interact", { entityId: giver.id, interaction: "talk" }, `${giver.name} (${Math.round(giver.distance)} m) offers a quest: ${offered.join(", ")}.`));
        break;
      }
    }
  }

  if (out.length < 4) {
    const node = nearby.find((row) => row.requirementsMet && row.state === "available"
      && (row.archetype === "ore" || row.archetype === "tree" || row.archetype === "fishing_spot"));
    if (node) {
      const interaction = node.archetype === "ore" ? "mine" : node.archetype === "tree" ? "chop" : "fish";
      out.push(act("corealm_gather", { interaction, entityId: node.id, quantity: Math.max(1, Math.min(10, inventory.freeSlots)) }, `${node.name} is ${Math.round(node.distance)} m away and the player qualifies.`));
    }
  }
  if (out.length === 0) {
    out.push({ tool: "corealm_manual", args: { topic: "overview" }, why: "Nothing is pressing. Read the manual, then pick a skill to train or a quest to start." });
  }
  if (view.mode === "guide" && !view.connected) {
    out.unshift({ tool: "corealm_session", args: { op: "connect", agentName: "<your name>" }, why: "Tell the player who is helping. Optional but polite." });
  }
  return out.slice(0, 6);
}

export function createContextTool({ api, session, version }: ToolDeps): ToolDef {
  return defineTool(TOOL_SPECS.corealm_context, (args) => {
    const sections = new Set<Section>(Array.isArray(args.sections) && args.sections.length > 0
      ? (args.sections as Section[])
      : SECTIONS);
    return buildContext(api, session, version, sections);
  });
}
