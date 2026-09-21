import { RESOLVED_TABLES } from './resolvedCatalog.js';
/**
 * The nine Phase 1 quests, as pure data.
 *
 * Design rules this file is written against, from the brief and PRD 7.3:
 *
 *  1. **Every objective is a sentence a player and an agent can both act on.** "Mine 6 Grithe ore
 *     at the Bracken Pit", never "Help Dorn". Where an objective names a place, an entity, an item,
 *     an enemy family or a spell, that id appears in the stage's `refs` array — because
 *     `moveTo({ locationId })`, `interact(entityId, ...)` and `getInventory()` all take ids and an
 *     external agent has no other way to turn prose into an action. The ids live in `refs` rather
 *     than inside the sentence so the journal a player reads never prints one.
 *  2. **Every completion is a machine-checkable predicate** over quest counters, quest flags,
 *     inventory, the bank, skills, or live entity state. There is no "the player did the thing"
 *     boolean that only a human can judge.
 *  3. **Nothing depends on a visual cue.** No stage says "look for the glowing rock". The three
 *     Gravelmaw levers are a real inference puzzle whose entire input is dialogue text, so an agent
 *     reading `corealm_dialogue` can solve it with no pixels at all.
 *  4. **Requirements gate, they never soft-lock.** Every requirement listed on a quest is reachable
 *     from a fresh character with no other quest completed, and every stage that needs a consumable
 *     either grants it in `onStart` or names a place to gather it.
 *
 * `systems/quests.ts` evaluates the predicates; this file never imports it.
 */
import type {
  EntityId, ItemId, ItemStack, QuestId, QuestObjectiveRef, RecipeId, RegionId, SkillId,
} from "../contracts.js";

const questData = RESOLVED_TABLES["quests"];
import { parseCollection } from "./schema/core.js";
import { questPresentationSchema, questSchema } from "./schema/story.js";

// ------------------------------------------------------------------- shapes

/**
 * A stage completion test.
 *
 * Every arm is decidable from `GameState` plus the entity table, which is what lets the quest
 * system re-evaluate on an event rather than asking a system "did you just do a thing".
 */
export type QuestPredicate =
  /** The player reached a specific dialogue node with a specific NPC. */
  | { kind: "talk"; npcId: EntityId; dialogueNodeId: string }
  /** Carrying this many, or having already spent the unique Orb to awaken its named altar. */
  | { kind: "have"; itemId: ItemId; quantity: number; orAwakenedAltarId?: EntityId }
  /** Stored in the bank, right now. */
  | { kind: "banked"; itemId: ItemId; quantity: number }
  /** Worn in any equipment slot. */
  | { kind: "equipped"; itemId: ItemId }
  /** Kills of an enemy family since the stage began, counted off `combat.ended`. */
  | { kind: "kill"; enemyFamily: string; count: number }
  /** Units of an item received since the stage began, counted off `item.received`. */
  | { kind: "gather"; itemId: ItemId; count: number }
  /** Successful, unburnt productions of a recipe, counted off `production.completed`. */
  | { kind: "produce"; recipeId: RecipeId; count: number }
  /** Nodes of this resource worked to exhaustion, counted off `resource.depleted`. */
  | { kind: "deplete"; itemId: ItemId; count: number }
  /** Player is within `radius` metres (XZ) of a route-graph location. Default 14 m. */
  | { kind: "reach"; locationId: string; radius?: number }
  /** A visit made while this stage is active; retained when the player moves away. */
  | { kind: "visit"; locationId: string; radius?: number }
  /** Player is within `radius` metres (XZ) of a named entity. Default 12 m. */
  | { kind: "nearEntity"; entityId: EntityId; radius?: number }
  /** The agility obstacle has been traversed at least once, per `world.obstaclesUsed`. */
  | { kind: "traverse"; obstacleId: EntityId }
  /** A live entity is in a given state, e.g. a door that is now "open". */
  | { kind: "entityState"; entityId: EntityId; state: string }
  | { kind: "skill"; skill: SkillId; level: number }
  /** A flag on this quest's own record. */
  | { kind: "flag"; flag: string; value?: boolean }
  /** A counter on this quest's own record. */
  | { kind: "counter"; counter: string; atLeast: number }
  /** Every child must hold. Used where one objective genuinely has two halves. */
  | { kind: "all"; of: QuestPredicate[] };

/** What a stage or a completion hands over. Applied exactly once. */
export interface QuestGrant {
  xp?: Partial<Record<SkillId, number>>;
  items?: ItemStack[];
  /** Taken out of the inventory, e.g. handing over a delivery. Missing items are not an error. */
  takeItems?: ItemStack[];
  currency?: number;
  /** Flags set on this quest's record. */
  flags?: string[];
  /** World writes, e.g. unbarring a door. Applied through the injected world port. */
  worldState?: { entityId: EntityId; state: string; lockedReason?: string }[];
  /** Plain text for the quest panel and the docs index. */
  unlocks?: string[];
}

export type { QuestObjectiveRef };

/**
 * A stage as the journal shows it. Every catalog carries this much, the client catalog included,
 * because the quest panel prints the objective and names its refs.
 */
export interface QuestStagePresentation {
  index: number;
  /**
   * Player-facing prose. Shown in the quest panel and returned by `getQuests().currentObjective`.
   * Contains no ids: everything actionable is in `refs`.
   */
  objective: string;
  /**
   * Every actionable id this objective names, followed by the authored location ids a player can
   * use to reach the step. Every stage has at least one location so the journal and generated
   * guides can show the step in the real world rather than beside a generic illustration.
   */
  refs?: QuestObjectiveRef[];
}

/** A stage with its rules: how it is finished and what finishing it pays. Server catalogs only. */
export interface QuestStageDef extends QuestStagePresentation {
  /** One line of "how", surfaced through docs search and the quest panel. */
  hint: string;
  completion: QuestPredicate;
  /** Applied when this stage completes, before the next stage starts. */
  grants?: QuestGrant;
  /**
   * Mid-stage reactions. Applied at most once each, the first time the named flag is true while
   * this stage is the current one. This is how a dialogue choice reaches back into the world
   * without the dialogue system needing world access: the choice sets a flag, the flag unbars a
   * door. The Long Cairn's stage 5 is the only user in Phase 1.
   */
  onFlag?: { flag: string; grant: QuestGrant }[];
}

/**
 * A quest as the journal shows it: the name, where it is, who starts it, what it asks of a
 * character, and the prose of each stage. This is what the client catalog carries, so a page can
 * build the quest log without being handed the answers.
 */
export interface QuestPresentation {
  id: QuestId;
  name: string;
  regionId: RegionId;
  /** The NPC id that starts it. `npcGivingQuest` in content/npcs.ts agrees with this. */
  giverNpcId: EntityId;
  requirements: Partial<Record<SkillId, number>>;
  prerequisiteQuestIds: QuestId[];
  stages: QuestStagePresentation[];
}

/** The authored quest, rules and all. Only a server catalog carries it: see `questRules`. */
export interface QuestDef extends QuestPresentation {
  kind: "local" | "skill" | "puzzle" | "dungeon" | "chain";
  /** One paragraph for the journal and the docs index. Never leaks a later stage. */
  summary: string;
  /** Handed over the moment the quest starts, so no stage can strand a fresh character. */
  onStart?: QuestGrant;
  stages: QuestStageDef[];
  /** PRD 7.3 shape. Applied once, on completion, on top of every stage grant. */
  rewards: {
    xp: Partial<Record<SkillId, number>>;
    items: ItemStack[];
    currency: number;
    unlocks: string[];
    worldState?: { entityId: EntityId; state: string; lockedReason?: string }[];
  };
}

/**
 * Which catalog this process runs on. A server catalog holds authored quests; the client catalog
 * holds the projection `content/clientCatalog.ts` makes of them, which has no `rewards` because it
 * has no rules at all. The rows are parsed against whichever shape they are, so a projected row
 * that still carried a predicate would fail here rather than reach a player.
 */
const authored = Array.isArray(questData) && questData.length > 0
  && (questData as Record<string, unknown>[]).every((row) => typeof row === "object" && row !== null && "rewards" in row);

/** Quest records retain their authored journal order. */
export const QUESTS: readonly QuestPresentation[] = authored
  ? parseCollection(questSchema, questData, { name: "quests" })
  : parseCollection(questPresentationSchema, questData, { name: "quests" });

const BY_ID = new Map<QuestId, QuestPresentation>(QUESTS.map((row) => [row.id, row]));
const RULES = new Map<QuestId, QuestDef>(authored ? (QUESTS as readonly QuestDef[]).map((row) => [row.id, row]) : []);

export function quest(id: QuestId): QuestPresentation | undefined {
  return BY_ID.get(id);
}

/**
 * How a quest is finished and what it pays. A host has these; a page does not, because the client
 * catalog carries no predicate a player could read the answers out of. Nothing on a page asks: the
 * quest log is built from `QUESTS` and from the summaries the host replicates.
 */
export function questRules(id: QuestId): QuestDef | undefined {
  return RULES.get(id);
}

/** Every authored quest, rules and all, in journal order. Empty on a client catalog. */
export const QUEST_RULES: readonly QuestDef[] = [...RULES.values()];

export function questsForRegion(regionId: RegionId): QuestPresentation[] {
  return QUESTS.filter((row) => row.regionId === regionId);
}

export function questsGivenBy(npcId: EntityId): QuestPresentation[] {
  return QUESTS.filter((row) => row.giverNpcId === npcId);
}

export function stageOf(id: QuestId, index: number): QuestStagePresentation | undefined {
  const def = BY_ID.get(id);
  if (!def) return undefined;
  return def.stages.find((row) => row.index === index);
}

/**
 * Every item id this file references, so the root can reconcile authored content against the item
 * tables in one call instead of grepping ten quest definitions.
 */
export function referencedItemIds(): ItemId[] {
  const out = new Set<ItemId>();
  const walk = (predicate: QuestPredicate): void => {
    if (predicate.kind === "all") {
      for (const child of predicate.of) walk(child);
      return;
    }
    if (predicate.kind === "have" || predicate.kind === "banked" || predicate.kind === "gather") {
      out.add(predicate.itemId);
    }
    if (predicate.kind === "equipped" || predicate.kind === "deplete") out.add(predicate.itemId);
  };
  const collect = (grant: QuestGrant | undefined): void => {
    if (!grant) return;
    for (const stack of grant.items ?? []) out.add(stack.itemId);
    for (const stack of grant.takeItems ?? []) out.add(stack.itemId);
  };
  for (const def of RULES.values()) {
    collect(def.onStart);
    for (const stage of def.stages) {
      walk(stage.completion);
      collect(stage.grants);
    }
    for (const stack of def.rewards.items) out.add(stack.itemId);
  }
  return [...out].sort();
}
