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

export interface QuestStageDef {
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

export interface QuestDef {
  id: QuestId;
  name: string;
  regionId: RegionId;
  kind: "local" | "skill" | "puzzle" | "dungeon" | "chain";
  /** One paragraph for the journal and the docs index. Never leaks a later stage. */
  summary: string;
  /** The NPC id that starts it. `npcGivingQuest` in content/npcs.ts agrees with this. */
  giverNpcId: EntityId;
  requirements: Partial<Record<SkillId, number>>;
  prerequisiteQuestIds: QuestId[];
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

// ------------------------------------------------------------------ quest 1

/**
 * The starter, and the only quest whose numbers are load-bearing for a test.
 *
 * PRD acceptance F2 starts it by id and F3 asserts the exact reward XP per skill, the exact item
 * stacks, and the exact mark amount, so `cold_iron` deliberately has **no per-stage grants**: every
 * number a test can see lives in one `rewards` block.
 *
 * It also teaches the whole material loop in four stages and nothing else: gather, smelt, smith,
 * use. Stage 4 requires the dagger to be equipped as well as swung, because the equipment slot is
 * the step new players skip.
 */
const COLD_IRON: QuestDef = {
  id: "cold_iron",
  name: "Cold Iron",
  regionId: "fallowmarch",
  kind: "skill",
  summary:
    "Harrow the smith will not sell a weapon to somebody who has never made one. Pull Copper out "
    + "of the Copper Pit, melt it, beat it into a dagger, and go and find out whether it holds.",
  giverNpcId: "npc_smith_harrow",
  requirements: {},
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective: "Mine 6 Copper ore at the Copper Pit.",
      refs: [{ kind: "item", id: "grithe_ore" }, { kind: "location", id: "bracken_pit" }],
      hint:
        "Six seams stand at the pit, 160 m north of Millfield. `moveTo({ locationId: "
        + "\"bracken_pit\" })`, then `interact(<ore entity id>, \"mine\")`. Mining 1 is enough.",
      completion: { kind: "gather", itemId: "grithe_ore", count: 6 },
    },
    {
      index: 1,
      objective: "Smelt 2 Copper bars at the Millfield Furnace.",
      refs: [
        { kind: "item", id: "grithe_bar" },
        { kind: "entity", id: "coldbrace_furnace" },
        { kind: "location", id: "town_center" },
      ],
      hint:
        "Stand at the furnace and `produce(\"smelt_grithe_bar\", 2)`. The furnace is in the forge "
        + "yard on the east side of Millfield Square.",
      completion: { kind: "have", itemId: "grithe_bar", quantity: 2 },
    },
    {
      index: 2,
      objective: "Smith a Copper dagger at the Millfield Anvil.",
      refs: [
        { kind: "item", id: "grithe_dagger" },
        { kind: "entity", id: "coldbrace_anvil" },
        { kind: "location", id: "town_center" },
      ],
      hint: "The anvil stands four metres from the furnace. The dagger is the cheapest thing on it.",
      completion: { kind: "have", itemId: "grithe_dagger", quantity: 1 },
    },
    {
      index: 3,
      objective:
        "Equip the Copper dagger and kill 3 Frogs on the shallows south-east of town.",
      refs: [
        { kind: "item", id: "grithe_dagger" },
        { kind: "enemyFamily", id: "frog" },
        { kind: "location", id: "redsill_shallows" },
      ],
      hint:
        "`equipItem(\"grithe_dagger\")` first - the stage checks the slot, not just the bag. The "
        + "frogs are passive and sit on the bank around (-56, -72), between town and the shallows.",
      completion: {
        kind: "all",
        of: [
          { kind: "equipped", itemId: "grithe_dagger" },
          { kind: "kill", enemyFamily: "frog", count: 3 },
        ],
      },
    },
    {
      index: 4,
      objective: "Tell Harrow the Smith that the dagger held.",
      refs: [
        { kind: "entity", id: "npc_smith_harrow" },
        { kind: "location", id: "town_center" },
      ],
      hint: "Walk back into Millfield Square and `interact(\"npc_smith_harrow\", \"talk\")`.",
      completion: { kind: "talk", npcId: "npc_smith_harrow", dialogueNodeId: "harrow_cold_iron_done" },
    },
  ],
  rewards: {
    xp: { mining: 120, smithing: 140, melee: 60 },
    items: [
      { itemId: "grithe_hatchet", quantity: 1 },
      { itemId: "seared_minnow", quantity: 5 },
    ],
    currency: 150,
    unlocks: [
      "Harrow will talk about the higher tiers.",
      "The rest of Millfield will give you work.",
    ],
  },
};

// ------------------------------------------------------------------ quest 2

/**
 * The counting puzzle. Dorn's ledger says a Grithe seam holds one number and the pit says another,
 * and the only way to settle it is to work a seam dry and read what the world reports.
 *
 * The answer is not authored into the dialogue: the quest system records the real `yieldsTaken`
 * from the `resource.depleted` event into the `last_seam_yield` counter, and Dorn's three answers
 * are checked against it. A player who guesses gets sent back to the pit; nobody is locked out.
 */
const DORNS_TALLY: QuestDef = {
  id: "dorns_tally",
  name: "Dorn's Tally",
  regionId: "fallowmarch",
  kind: "puzzle",
  summary:
    "The Trade Company ledger says a Copper seam is worth four loads. Pitmaster Dorn has been "
    + "signing that figure for nine years and has never once believed it. Work a seam to the "
    + "bottom, count what it actually gave, and settle the argument with a number.",
  giverNpcId: "npc_pitmaster_dorn",
  requirements: {},
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective:
        "Work one Copper seam at the Copper Pit until it is worked out. Stay on the same seam: "
        + "Dorn wants the count from one node, not from six.",
      refs: [{ kind: "location", id: "bracken_pit" }, { kind: "item", id: "grithe_ore" }],
      hint:
        "Pick one seam and stay on it. `inspect` the node while you work: its `resource.remaining` "
        + "counts down, and the event that ends it carries `yieldsTaken`, which is the number Dorn "
        + "wants.",
      completion: { kind: "deplete", itemId: "grithe_ore", count: 1 },
      grants: { xp: { mining: 40 } },
    },
    {
      index: 1,
      objective:
        
        "Tell Pitmaster Dorn how many loads the seam actually gave. He offers three bands; pick the one your seam fell into.",
      refs: [
        { kind: "entity", id: "npc_pitmaster_dorn" },
        { kind: "location", id: "town_center" },
      ],
      hint:
        "The exact figure was in the `resource.depleted` event, and the quest kept it: it is the "
        + "`last_seam_yield` counter on this quest's record. Guess wrong and Dorn sends you back "
        + "to check, which costs nothing but a walk.",
      completion: { kind: "talk", npcId: "npc_pitmaster_dorn", dialogueNodeId: "dorn_tally_correct" },
      grants: { xp: { mining: 60 }, flags: ["ledger_corrected"] },
    },
    {
      index: 2,
      objective:
        "Make the vault agree with the ledger: bank 15 Copper ore at the Millfield Bank.",
      refs: [
        { kind: "item", id: "grithe_ore" },
        { kind: "entity", id: "coldbrace_bank" },
        { kind: "location", id: "bank_interior" },
      ],
      hint:
        "Walk to the bank counter and `bank(\"deposit\", { itemId: \"grithe_ore\", quantity: -1 })`. "
        + "The stage counts what is in the bank, not what you carried in.",
      completion: { kind: "banked", itemId: "grithe_ore", quantity: 15 },
    },
    {
      index: 3,
      objective: "Sign the corrected page with Pitmaster Dorn.",
      refs: [
        { kind: "entity", id: "npc_pitmaster_dorn" },
        { kind: "location", id: "town_center" },
      ],
      hint: "Back to the square. He will have a pen ready; he always has a pen ready.",
      completion: { kind: "talk", npcId: "npc_pitmaster_dorn", dialogueNodeId: "dorn_tally_signed" },
    },
  ],
  rewards: {
    xp: { mining: 260 },
    items: [{ itemId: "grithe_pickaxe", quantity: 1 }],
    currency: 220,
    unlocks: ["Dorn will quote you real seam figures instead of the ledger's."],
  },
};

// ------------------------------------------------------------------ quest 3

/**
 * The comedy, and the Agility introduction.
 *
 * Stage 1 completes on **Agility 3**, not on a fixed number of traversals: the Brookvault Planks
 * are requirement level 1 and hand out Agility XP every time, so a fresh character trains the skill
 * by doing the thing the quest is about. That also means the Wall Vault's level 3 gate in stage 2
 * can never strand anyone.
 */
const THE_CARTERS_WAGER: QuestDef = {
  id: "the_carters_wager",
  name: "The Carter's Wager",
  regionId: "fallowmarch",
  kind: "local",
  summary:
    "Carter Bel has bet Warden Ilse two weeks of cart duty that the pit road is slower than going "
    + "over things. Warden Ilse has cited three regulations. Carter Bel has cited a cousin.",
  giverNpcId: "npc_carter_bel",
  requirements: {},
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective:
        "Train Agility to level 3 on the Brook Planks - vault them until the skill comes up.",
      refs: [
        { kind: "entity", id: "brookvault_planks" },
        { kind: "location", id: "marchfield" },
      ],
      hint:
        "The planks cross Iron Brook at (-78, -30) and need Agility 1. Every successful vault "
        + "pays Agility XP; a failure costs a few health and nothing else. `interact"
        + "(\"brookvault_planks\", \"vault\")`.",
      completion: { kind: "skill", skill: "agility", level: 3 },
      grants: { xp: { agility: 30 } },
    },
    {
      index: 1,
      objective: "Vault the Millfield north wall at least once.",
      refs: [
        { kind: "entity", id: "wall_vault" },
        { kind: "location", id: "town_center" },
      ],
      hint:
        "It sits on the town's north wall at (-160, -56) and needs Agility 3, which stage 1 just "
        + "bought you. It saves 44 m on the run to the pit, which is Bel's entire argument.",
      completion: { kind: "traverse", obstacleId: "wall_vault" },
      grants: { xp: { agility: 60 } },
    },
    {
      index: 2,
      objective:
        
        "Report your time to Carter Bel at the south gate. He will believe whatever you say. Warden Ilse is standing directly behind him.",
      refs: [
        { kind: "entity", id: "npc_carter_bel" },
        { kind: "location", id: "town_entrance" },
      ],
      hint:
        "Every answer finishes the quest. Only one of them survives contact with the Warden, and "
        + "the difference shows up in what those two say to you afterwards.",
      completion: { kind: "talk", npcId: "npc_carter_bel", dialogueNodeId: "bel_wager_settled" },
    },
  ],
  rewards: {
    xp: { agility: 180 },
    items: [{ itemId: "seared_minnow", quantity: 4 }],
    currency: 260,
    unlocks: [
      "Warden Ilse will tell you where every shortcut in Farmland is.",
      "Carter Bel will tell you about a cousin.",
    ],
  },
};

// ------------------------------------------------------------------ quest 4

const CROOKED_GRAIN: QuestDef = {
  id: "crooked_grain",
  name: "Crooked Grain",
  regionId: "vellenwood",
  kind: "skill",
  summary:
    "Woodward Ansel will let you take eight ash logs out of his stand. He would like you to "
    + "understand, first, which one you are not taking.",
  giverNpcId: "npc_woodward_ansel",
  requirements: { woodcutting: 5 },
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective:
        "Fell Ash at the Ash Grove until you hold 8 Ash logs.",
      refs: [{ kind: "location", id: "vellenwood_canopy" }, { kind: "item", id: "duskoak_log" }],
      hint:
        "Ten trees stand there and Woodcutting 5 is the gate. Logs do not stack, so eight logs is "
        + "eight inventory slots - bank anything else first.",
      completion: { kind: "gather", itemId: "duskoak_log", count: 8 },
      grants: { xp: { woodcutting: 120 } },
    },
    {
      index: 1,
      objective:
        "Go and stand at the Split Ash, the one tree Ansel will not let anybody cut.",
      refs: [
        { kind: "entity", id: "split_duskoak" },
        { kind: "location", id: "blackwater_pools" },
      ],
      hint:
        "It is at (170, 112), east of Oakwood past the Blackwater Pools. `observe({ radius: 140, "
        + "archetypes: [\"landmark\"] })` finds it, then `moveTo({ entityId: \"split_duskoak\" })`. "
        + "`inspect` it when you get there; it is still alive on one side.",
      completion: { kind: "nearEntity", entityId: "split_duskoak", radius: 12 },
      grants: { flags: ["saw_the_split_oak"] },
    },
    {
      index: 2,
      objective:
        "Bring the 8 Ash logs back to Woodward Ansel in Oakwood and tell him what you saw.",
      refs: [
        { kind: "entity", id: "npc_woodward_ansel" },
        { kind: "item", id: "duskoak_log" },
        { kind: "location", id: "rootfall_hamlet" },
      ],
      hint: "The handover takes the logs. He counts them; he counts everything from this stand.",
      completion: { kind: "talk", npcId: "npc_woodward_ansel", dialogueNodeId: "ansel_logs_taken" },
    },
  ],
  rewards: {
    xp: { woodcutting: 420 },
    items: [{ itemId: "corven_hatchet", quantity: 1 }],
    currency: 400,
    unlocks: ["Ansel will name the trees you are allowed to fell in the deep stand."],
  },
};

// ------------------------------------------------------------------ quest 5

const KNOTS_AND_NAMES: QuestDef = {
  id: "knots_and_names",
  name: "Knots and Names",
  regionId: "vellenwood",
  kind: "skill",
  summary:
    "Seamer Juno makes the parts of things: shafts, cord, hide, and the elemental essence that "
    + "powers magic weapons. She will teach both trades to anyone who brings her the "
    + "raw material and does not pretend to already know.",
  giverNpcId: "npc_seamer_juno",
  requirements: {},
  prerequisiteQuestIds: [],
  onStart: {
    items: [{ itemId: "pale_quartz", quantity: 3 }],
    unlocks: ["Juno hands you three Quartz to start on."],
  },
  stages: [
    {
      index: 0,
      objective:
        "Fletch 4 Pine shafts at a fletching bench.",
      refs: [
        { kind: "item", id: "palewood_shaft" },
        { kind: "entity", id: "coldbrace_fletching" },
        { kind: "location", id: "palewood_copse" },
        { kind: "location", id: "town_center" },
      ],
      hint:
        "Shafts come from Pine logs, cut at the Pine Grove in Farmland (locationId "
        + "`palewood_copse`). Millfield has the only fletching bench in Phase 1.",
      completion: { kind: "have", itemId: "palewood_shaft", quantity: 4 },
      grants: { xp: { fletching: 60 } },
    },
    {
      index: 1,
      objective:
        "Mine 5 Air Essence from the distant Farmland cache.",
      refs: [
        { kind: "item", id: "air_essence" },
        { kind: "location", id: "fallowmarch_air_cache" },
      ],
      hint:
        "The Air Essence Cache lies deep in southern Farmland. Mine any of its five glowing "
        + "rocks; essence stacks, so this is one inventory slot.",
      completion: { kind: "have", itemId: "air_essence", quantity: 5 },
      grants: { xp: { mining: 60 } },
    },
    {
      index: 2,
      objective:
        "Bring Seamer Juno the 4 shafts and 5 Air Essence so she can show you what they are for.",
      refs: [
        { kind: "entity", id: "npc_seamer_juno" },
        { kind: "item", id: "palewood_shaft" },
        { kind: "item", id: "air_essence" },
        { kind: "location", id: "rootfall_hamlet" },
      ],
      hint: "She works the trade post side of the Oakwood stump. The handover takes both.",
      completion: { kind: "talk", npcId: "npc_seamer_juno", dialogueNodeId: "juno_parts_taken" },
    },
  ],
  rewards: {
    xp: { crafting: 240, fletching: 240 },
    items: [
      { itemId: "bramblehide_wraps", quantity: 1 },
      { itemId: "air_essence", quantity: 10 },
    ],
    currency: 300,
    unlocks: ["Juno will explain how a boss Orb awakens a regional altar for elemental weapons."],
  },
};

// ------------------------------------------------------------------ quest 6

/**
 * The exploration quest, and the second joke. Four `visit` predicates in one stage: the objective
 * lists all four location ids, so an agent can plan the circuit in one read rather than being fed
 * one waypoint at a time.
 */
const ELEVEN_EMPTY_DAYS: QuestDef = {
  id: "eleven_empty_days",
  name: "Eleven Empty Days",
  regionId: "vellenwood",
  kind: "local",
  summary:
    "Trapper Mott has eleven traps in the deep wood. In eleven days they have caught eleven "
    + "nothings. He would like a second opinion, and he would like it delivered gently.",
  giverNpcId: "npc_trapper_mott",
  requirements: {},
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective:
        "Walk Mott's trap line: the Blackwater Pools, the Gorge Head, The Thicket Camp and the "
        + "Gorge Ford, in any order.",
      refs: [
        { kind: "location", id: "blackwater_pools" },
        { kind: "location", id: "gorge_head" },
        { kind: "location", id: "thornline_camp" },
        { kind: "location", id: "gorge_ford" },
      ],
      hint:
        "All four are route-graph nodes: `moveTo({ locationId })` reaches each one directly. The "
        + "Thicket is where the vipers keep to the edge, so go there with health to "
        + "spare or take the long way round by the ford.",
      completion: {
        kind: "all",
        of: [
          { kind: "visit", locationId: "blackwater_pools" },
          { kind: "visit", locationId: "gorge_head" },
          { kind: "visit", locationId: "thornline_camp" },
          { kind: "visit", locationId: "gorge_ford" },
        ],
      },
      grants: { xp: { agility: 90 }, flags: ["walked_the_line"] },
    },
    {
      index: 1,
      objective:
        
        "Something has been going through the bait. Kill 3 Pigs between Oakwood and "
        + "The Thicket.",
      refs: [
        { kind: "enemyFamily", id: "hog" },
        { kind: "location", id: "thornline_camp" },
      ],
      hint: "They root around (150, 128) and they are aggressive, so they will find you first.",
      completion: { kind: "kill", enemyFamily: "hog", count: 3 },
      grants: { xp: { melee: 150 } },
    },
    {
      index: 2,
      objective:
        
        "Report to Trapper Mott in Oakwood. Decide on the way whether to mention the thing you noticed about how his traps are set.",
      refs: [
        { kind: "entity", id: "npc_trapper_mott" },
        { kind: "location", id: "rootfall_hamlet" },
      ],
      hint:
        "Both answers finish the quest. One of them changes what Mott says to you for the rest of "
        + "the game, and it is not the kind one.",
      completion: { kind: "talk", npcId: "npc_trapper_mott", dialogueNodeId: "mott_verdict_given" },
    },
  ],
  rewards: {
    xp: { melee: 200, agility: 120 },
    items: [{ itemId: "seared_trout", quantity: 5 }],
    currency: 420,
    unlocks: ["Mott will tell you what is moving in the deep wood, at length, whether you ask or not."],
  },
};

// ------------------------------------------------------------------ quest 7

/**
 * The route-optimisation quest. PRD 2.8's flip, made explicit: the same sixteen ore, once by road
 * and once over Sunder Ledge, and Arden times both because Arden times everything.
 */
const BAD_GROUND: QuestDef = {
  id: "bad_ground",
  name: "Bad Ground",
  regionId: "karrowmoor",
  kind: "skill",
  summary:
    "Foreman Arden has a crew that stopped digging and a camp that still has to eat. He wants "
    + "sixteen Cobalt in the Hillcrest vault and he wants to know which way you walked to get it.",
  giverNpcId: "npc_foreman_arden",
  requirements: { mining: 10, agility: 10 },
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective:
        "Mine 10 Cobalt ore at the Lower Quarry.",
      refs: [{ kind: "item", id: "kaldite_ore" }, { kind: "location", id: "karrowmoor_terraces" }],
      hint:
        "Five Cobalt faces on terrace one, next to Stone Cavern mouth. Mining 10 is the gate. "
        + "Ore does not stack: ten ore is ten slots.",
      completion: { kind: "gather", itemId: "kaldite_ore", count: 10 },
      grants: { xp: { mining: 150 } },
    },
    {
      index: 1,
      objective: "Climb Broken Ledge at least once.",
      refs: [
        { kind: "entity", id: "sunder_ledge" },
        { kind: "location", id: "highcairn_bank" },
        { kind: "location", id: "upper_karrow_seam" },
      ],
      hint:
        "It runs from the Hillcrest bank at (170, -74) up to the Upper Cobalt Seam and needs "
        + "Agility 10. By road that trip is 188 m; over the ledge it is 46 m plus a six-second "
        + "climb. Compare `moveTo` path lengths before and after if you want to see the flip.",
      completion: { kind: "traverse", obstacleId: "sunder_ledge" },
      grants: { xp: { agility: 120 }, flags: ["knows_the_ledge"] },
    },
    {
      index: 2,
      objective:
        "Put 16 Cobalt ore into the Hillcrest Bank.",
      refs: [
        { kind: "item", id: "kaldite_ore" },
        { kind: "entity", id: "highcairn_bank_counter" },
        { kind: "location", id: "highcairn_bank" },
      ],
      hint:
        "The Upper Cobalt Seam is only three nodes and genuinely runs dry above Mining 20 - the "
        + "Lower Quarry is the reliable half of the circuit. The stage counts the bank, not the bag.",
      completion: { kind: "banked", itemId: "kaldite_ore", quantity: 16 },
    },
    {
      index: 3,
      objective: "Tell Foreman Arden which route you used.",
      refs: [
        { kind: "entity", id: "npc_foreman_arden" },
        { kind: "location", id: "highcairn_outpost" },
      ],
      hint: "He is at the middle of the camp. He will have the figure already; he always does.",
      completion: { kind: "talk", npcId: "npc_foreman_arden", dialogueNodeId: "arden_route_reported" },
    },
  ],
  rewards: {
    xp: { mining: 900, agility: 400 },
    items: [{ itemId: "kaldite_pickaxe", quantity: 1 }],
    currency: 900,
    unlocks: ["Arden will quote you the real distance between any two things on the moor."],
  },
};

// ------------------------------------------------------------------ quest 8

/**
 * The Magic introduction. Essence powers the starter wand directly. Vess supplies raw palewood,
 * then the Tempest Roc's boss-dropped Air Orb wakes the cache altar. The awakened altar turns the
 * Palewood Staff into a charged Air Staff.
 */
const SPARKING_STONE: QuestDef = {
  id: "sparking_stone",
  name: "The Sparking Stone",
  regionId: "karrowmoor",
  kind: "skill",
  summary:
    "Quarrier Vess has been cutting Cobalt for nine years and she has never liked what it does "
    + "in the dark. She would like somebody who is not her to find out what is in it.",
  giverNpcId: "npc_quarrier_vess",
  requirements: { mining: 10 },
  prerequisiteQuestIds: [],
  onStart: {
    items: [
      { itemId: "palewood_log", quantity: 1 },
      { itemId: "air_essence", quantity: 100 },
    ],
    unlocks: ["Vess gives you one pine log and 100 measures of Air Essence."],
  },
  stages: [
    {
      index: 0,
      objective: "Return to Farmland and kill the Storm Rhino west of the Air Essence Cache.",
      refs: [
        { kind: "entity", id: "tempest_roc" },
        { kind: "location", id: "fallowmarch_air_cache" },
      ],
      hint:
        "Go south through Woodlands to Millfield, then follow the western track to locationId "
        + "fallowmarch_air_cache. The Storm Rhino, entity tempest_roc, roams about 42 metres west "
        + "of the cache. The Air Essence Vess gave you can power Voltrend during the fight.",
      completion: { kind: "kill", enemyFamily: "tempest_roc", count: 1 },
    },
    {
      index: 1,
      objective: "Loot the Air Orb dropped by the Storm Rhino.",
      refs: [
        { kind: "item", id: "air_orb" },
        { kind: "entity", id: "tempest_roc" },
        { kind: "location", id: "fallowmarch_air_cache" },
      ],
      hint:
        "The guaranteed Air Orb remains in the Storm Rhino's loot pile after the kill. Use `loot` "
        + "on that pile. If you already used its Orb to awaken the Air Altar, that earlier "
        + "awakening counts and you can continue with your staff.",
      completion: {
        kind: "have", itemId: "air_orb", quantity: 1,
        orAwakenedAltarId: "fallowmarch_air_altar",
      },
    },
    {
      index: 2,
      objective: "Make an Air Staff at the Air Altar, then equip it.",
      refs: [
        { kind: "item", id: "palewood_log" },
        { kind: "item", id: "palewood_shaft" },
        { kind: "item", id: "palewood_staff" },
        { kind: "item", id: "air_orb" },
        { kind: "item", id: "air_staff" },
        { kind: "entity", id: "fallowmarch_air_altar" },
        { kind: "location", id: "fallowmarch_air_cache" },
      ],
      hint:
        "If the Air Altar is dormant, awaken it with the Air Orb first. At a "
        + "fletching bench, make an Pine Shaft, then an Pine Staff. Make "
        + "an Air Staff at the awakened altar and equip it. Once partly spent, the same altar "
        + "restores it to 1000 for exactly 100 Air Essence.",
      completion: { kind: "equipped", itemId: "air_staff" },
    },
    {
      index: 3,
      objective: "Raise Magic to level 5 by casting Voltrend at something that will hold still for it.",
      refs: [
        { kind: "spell", id: "voltrend" },
        { kind: "enemyFamily", id: "frog" },
        { kind: "location", id: "redsill_shallows" },
        { kind: "entity", id: "fallowmarch_air_altar" },
      ],
      hint:
        "The Air Staff spends its charge before carried Air Essence. Frogs near "
        + "locationId redsill_shallows are cheap targets. Recharge at entity "
        + "fallowmarch_air_altar with 100 Air Essence when needed.",
      completion: { kind: "skill", skill: "magic", level: 5 },
      grants: { xp: { magic: 60 } },
    },
    {
      index: 4,
      objective:
        "Bring Quarrier Vess 6 Cobalt ore so she can watch what a live spell does to it.",
      refs: [
        { kind: "entity", id: "npc_quarrier_vess" },
        { kind: "item", id: "kaldite_ore" },
        { kind: "location", id: "highcairn_outpost" },
      ],
      hint: "She is at the middle of Hillcrest. The handover takes the ore.",
      completion: { kind: "talk", npcId: "npc_quarrier_vess", dialogueNodeId: "vess_stone_tested" },
    },
  ],
  rewards: {
    xp: { magic: 700, mining: 200 },
    items: [
      { itemId: "earth_essence", quantity: 25 },
    ],
    currency: 700,
    unlocks: ["Vess stops calling the Cobalt \"that\" and starts calling it by its name."],
  },
};

// ------------------------------------------------------------------ quest 9

/**
 * THE LONG CAIRN - the seven-stage chain, and the only quest an external agent is graded on end to
 * end (PRD F18). Every stage is discoverable and completable through `observe`, `inspect`,
 * `interact` and `dialogue` alone.
 *
 * Stage 5 is the three-lever stone door in chamber 2, which PRD section 4 says is described in this
 * quest's stage-5 dialogue. The description lives on Cairnkeeper Ode's `ode_long_cairn_levers` node
 * and it is a genuine inference: Ode names the three mason's marks and the crew's rule for ordering
 * them, and the six possible orders are all offered as live options. Nothing about the answer is
 * visual, positional, or cultural - it is derivable from the text alone, which is exactly what an
 * agent needs. Two wrong answers unlock a "just tell me" option, so the chain cannot dead-end.
 *
 * Completion opens `ordrun_gate`, the sealed door onto the boss arena. Ordrun himself is a separate
 * fight; this chain earns the door, it does not fight what is behind it.
 */
const LONG_CAIRN: QuestDef = {
  id: "long_cairn",
  name: "The Long Cairn",
  regionId: "karrowmoor",
  kind: "chain",
  summary:
    "Somebody has been re-stacking the cairns on Highlands. Cairnkeeper Ode knows every stone on "
    + "this moor by name and she did not move them. The line of re-stacked cairns runs from terrace "
    + "four down the ramps and into a hole the quarry crew stopped digging six months ago.",
  giverNpcId: "npc_cairnkeeper_ode",
  requirements: { melee: 10, mining: 10 },
  prerequisiteQuestIds: [],
  stages: [
    {
      index: 0,
      objective: "Go and look at the Great Cairn on terrace four.",
      refs: [{ kind: "entity", id: "great_cairn_stone" }, { kind: "location", id: "great_cairn" }],
      hint:
        "`moveTo({ locationId: \"great_cairn\" })` from Hillcrest goes bank -> Second Ramp -> Third "
        + "Ramp -> the cairn. Bears hold the ground around (100, -110) on the way, so travel "
        + "fed and armed. `inspect(\"great_cairn_stone\")` when you arrive.",
      completion: { kind: "reach", locationId: "great_cairn", radius: 16 },
      grants: { xp: { mining: 120 }, flags: ["saw_great_cairn"] },
    },
    {
      index: 1,
      objective:
        "Tell Cairnkeeper Ode at Hillcrest that the Great Cairn has been re-stacked.",
      refs: [
        { kind: "entity", id: "npc_cairnkeeper_ode" },
        { kind: "location", id: "highcairn_outpost" },
      ],
      hint: "She stands on the west side of the camp, at (138, -68).",
      completion: { kind: "talk", npcId: "npc_cairnkeeper_ode", dialogueNodeId: "ode_long_cairn_reported" },
      grants: { xp: { melee: 120 }, currency: 150, flags: ["ode_knows"] },
    },
    {
      index: 2,
      objective:
        "Ask Watcher Hale what the rota has seen come out of Stone Cavern.",
      refs: [
        { kind: "entity", id: "npc_watcher_hale" },
        { kind: "location", id: "highcairn_outpost" },
      ],
      hint:
        "Hale is at (152, -74), the east side of Hillcrest. He watches the mouth for a living and "
        + "he will tell you what is in the first chamber if you ask him directly.",
      completion: { kind: "talk", npcId: "npc_watcher_hale", dialogueNodeId: "hale_gravelmaw_told" },
      grants: { xp: { magic: 90 }, flags: ["knows_gravelmaw"] },
    },
    {
      index: 3,
      objective:
        "Enter Stone Cavern, kill 4 Giant Rats in the Lit Gallery, and reach The Collapse.",
      refs: [
        { kind: "entity", id: "gravelmaw_mouth_portal" },
        { kind: "enemyFamily", id: "rat" },
        { kind: "location", id: "gravelmaw_entrance" },
        { kind: "location", id: "gravelmaw_chamber1" },
        { kind: "location", id: "gravelmaw_chamber2" },
      ],
      hint:
        "The mouth is at (46, -24) on terrace one, next to the Lower Quarry. Inside, "
        + "`moveTo({ locationId: \"gravelmaw_chamber1\" })` then `\"gravelmaw_chamber2\"`. The "
        + "gallery is lit; the collapse is not.",
      completion: {
        kind: "all",
        of: [
          { kind: "kill", enemyFamily: "rat", count: 4 },
          { kind: "reach", locationId: "gravelmaw_chamber2", radius: 16 },
        ],
      },
      grants: { xp: { melee: 400 }, flags: ["cleared_gallery"] },
    },
    {
      index: 4,
      objective:
        
        "Ask Cairnkeeper Ode about the three levers, work out the order she describes, then open the Three-Lever Door in The Collapse.",
      refs: [
        { kind: "entity", id: "npc_cairnkeeper_ode" },
        { kind: "entity", id: "gravelmaw_stone_door" },
        { kind: "location", id: "highcairn_outpost" },
        { kind: "location", id: "gravelmaw_entrance" },
        { kind: "location", id: "gravelmaw_chamber2" },
      ],
      hint:
        "Ode describes all three mason's marks and the crew's rule for ordering them on her "
        + "`ode_long_cairn_levers` node; the answer is in what she says, not in anything you have "
        + "to see. Get it right and the door unbars, at which point "
        + "`interact(\"gravelmaw_stone_door\", \"open\")` inside chamber 2 swings it. Get it wrong "
        + "twice and she will simply tell you.",
      completion: { kind: "entityState", entityId: "gravelmaw_stone_door", state: "open" },
      onFlag: [
        {
          // Ode's correct answer sets this flag. Unbarring the door is what turns the answer into
          // something the world can be interacted with: `InteractionDispatcher` refuses `open` on
          // a door whose state is "locked", so until the levers are understood the door is not a
          // thing you can try, it is a thing you are told about.
          flag: "lever_order_known",
          grant: {
            worldState: [
              {
                entityId: "gravelmaw_stone_door",
                state: "unbarred",
                lockedReason: "The levers are set in the order Ode gave. It will open now.",
              },
            ],
            unlocks: ["The Three-Lever Door will answer `interact(\"gravelmaw_stone_door\", \"open\")`."],
          },
        },
      ],
      grants: {
        xp: { agility: 200, mining: 200 },
        flags: ["door_open"],
        worldState: [{
          entityId: "gravelmaw_stone_door", state: "open",
          lockedReason: "The three levers are thrown. The door stands open.",
        }],
        unlocks: ["The Collapse now walks straight through into The Cairn Hall."],
      },
    },
    {
      index: 5,
      objective:
        "Go back to Cairnkeeper Ode and ask for the keeping-stone she means to leave in the hall.",
      refs: [
        { kind: "entity", id: "npc_cairnkeeper_ode" },
        { kind: "location", id: "highcairn_outpost" },
      ],
      hint:
        "She will hand you a Garnet (item `cairn_garnet`). Do not sell it; stage 7 checks "
        + "that you are still carrying it.",
      completion: { kind: "talk", npcId: "npc_cairnkeeper_ode", dialogueNodeId: "ode_long_cairn_stone_given" },
      grants: {
        items: [{ itemId: "cairn_garnet", quantity: 1 }],
        currency: 300,
        flags: ["has_keeping_stone"],
      },
    },
    {
      index: 6,
      objective:
        
        "Carry the Garnet into The Cairn Hall, kill the 2 cave bears standing over the cairn, and set the stone on it.",
      refs: [
        { kind: "item", id: "cairn_garnet" },
        { kind: "location", id: "gravelmaw_entrance" },
        { kind: "location", id: "gravelmaw_chamber3" },
        { kind: "enemyFamily", id: "bear" },
      ],
      hint:
        "With the door open, chamber 2 walks straight through to chamber 3. The stage completes "
        + "the moment all three hold at once: both bears dead, you inside the hall, garnet still "
        + "in your bag. Completing it takes the garnet and unseals the Armored Rhino's Gate.",
      completion: {
        kind: "all",
        of: [
          { kind: "kill", enemyFamily: "bear", count: 2 },
          { kind: "reach", locationId: "gravelmaw_chamber3", radius: 16 },
          { kind: "have", itemId: "cairn_garnet", quantity: 1 },
        ],
      },
      grants: {
        takeItems: [{ itemId: "cairn_garnet", quantity: 1 }],
        flags: ["cairn_laid"],
      },
    },
  ],
  rewards: {
    xp: { melee: 1600, magic: 600, mining: 600, agility: 300 },
    items: [
      { itemId: "kaldite_dagger", quantity: 1 },
      { itemId: "seared_cragfin", quantity: 8 },
    ],
    currency: 2400,
    unlocks: [
      "The Armored Rhino's Gate (entity `ordrun_gate`) is unsealed. Armored Rhino is behind it.",
      "Cairnkeeper Ode will speak plainly about what is under the Great Cairn.",
    ],
    worldState: [
      {
        entityId: "ordrun_gate",
        state: "open",
        lockedReason: "The Long Cairn is finished. The gate stands open.",
      },
    ],
  },
};

// ------------------------------------------------------------------ registry

/** The nine quests, in the order the quest panel lists them. */
export const QUESTS: readonly QuestDef[] = [
  COLD_IRON,
  DORNS_TALLY,
  THE_CARTERS_WAGER,
  CROOKED_GRAIN,
  KNOTS_AND_NAMES,
  ELEVEN_EMPTY_DAYS,
  BAD_GROUND,
  SPARKING_STONE,
  LONG_CAIRN,
];

const BY_ID = new Map<QuestId, QuestDef>(QUESTS.map((row) => [row.id, row]));

export function quest(id: QuestId): QuestDef | undefined {
  return BY_ID.get(id);
}

export function questsForRegion(regionId: RegionId): QuestDef[] {
  return QUESTS.filter((row) => row.regionId === regionId);
}

export function questsGivenBy(npcId: EntityId): QuestDef[] {
  return QUESTS.filter((row) => row.giverNpcId === npcId);
}

export function stageOf(id: QuestId, index: number): QuestStageDef | undefined {
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
  for (const def of QUESTS) {
    collect(def.onStart);
    for (const stage of def.stages) {
      walk(stage.completion);
      collect(stage.grants);
    }
    for (const stack of def.rewards.items) out.add(stack.itemId);
  }
  return [...out].sort();
}
