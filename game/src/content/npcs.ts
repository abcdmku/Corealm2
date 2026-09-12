/**
 * The twelve Phase 1 NPCs.
 *
 * `content/regions.ts` already places the stands - position, mesh, facing, and the
 * `dialogueRootId` string. This file is the other half of each of those people: who they are, what
 * they sound like, where an agent can find them, and which quests they hand out. The ids here are
 * the same ids the region data uses, and `world/regionBuilder.ts` turns those stands into entities
 * with `archetype: "npc"` and `interactions: ["inspect", "talk"]`.
 *
 * `voice` is not decoration. Twelve people who all sound the same is a content failure even when
 * every objective works, so each entry states the rule its lines are written against, and
 * `content/dialogue.ts` is written to those rules.
 *
 * Nothing here imports a system. Content is data; the quest and dialogue systems read it.
 */
import type { EntityId, QuestId, RegionId } from "../contracts.js";
import { FAIRY_NPC_CANDIDATES } from './fairyNpcs.js';

export interface NpcDef {
  /** Matches `NpcStandDef.id` in content/regions.ts exactly. */
  id: EntityId;
  name: string;
  regionId: RegionId;
  /** Settlement id from region data: "coldbrace" | "rootfall" | "highcairn". */
  settlementId: string;
  /** One line for the journal and for `searchDocs`. */
  role: string;
  /** The writing rule for this character's lines. Read it before adding dialogue. */
  voice: string;
  /** Root node id in content/dialogue.ts. Matches `NpcStandDef.dialogueRootId`. */
  dialogueRootId: string;
  /** Quests this person gives, in the order they should be offered. */
  questIds: QuestId[];
  /**
   * Nearest route-graph node, so an agent can `moveTo({ locationId })` and then `observe` to find
   * this person rather than needing their coordinates.
   */
  locationId: string;
}

export const NPCS: readonly NpcDef[] = [
  ...FAIRY_NPC_CANDIDATES,
  // -------------------------------------------------------------- Fallowmarch
  {
    id: "npc_warden_ilse",
    name: "Warden Ilse",
    regionId: "fallowmarch",
    settlementId: "coldbrace",
    role: "Warden of Millfield. Runs a town on behalf of a company that stopped writing back.",
    voice:
      "Precise and administrative. Complete sentences, no contractions, cites Trade Company "
      + "regulations by number as though someone were still enforcing them. Never raises her "
      + "voice; the joke is that she is entirely serious.",
    dialogueRootId: "ilse_root",
    questIds: [],
    locationId: "town_center",
  },
  {
    id: "npc_pitmaster_dorn",
    name: "Pitmaster Dorn",
    regionId: "fallowmarch",
    settlementId: "coldbrace",
    role: "Runs the Copper Pit, and the ledger that says what the Copper Pit contains.",
    voice:
      "Numbers first, sentences second. Interrupts himself to correct a figure. Anxious in a "
      + "clerical way: the pit does not frighten him, the arithmetic does.",
    dialogueRootId: "dorn_root",
    questIds: ["dorns_tally"],
    locationId: "town_center",
  },
  {
    id: "npc_smith_harrow",
    name: "Harrow the Smith",
    regionId: "fallowmarch",
    settlementId: "coldbrace",
    role: "Millfield's smith. Sells metal, teaches the material loop, says very little.",
    voice:
      "Short declaratives. Rarely more than eight words. Uses two sentences where most people "
      + "would use a paragraph, and never explains twice.",
    dialogueRootId: "harrow_root",
    questIds: ["cold_iron"],
    locationId: "town_center",
  },
  {
    id: "npc_ranger_syb",
    name: "Ranger Syb",
    regionId: "fallowmarch",
    settlementId: "coldbrace",
    role: "Walks the march and knows where the water is.",
    voice:
      "Deadpan and outdoorsy. Describes weather and terrain in the same flat tone she uses for "
      + "her own hunger. Dry, never bitter.",
    dialogueRootId: "syb_root",
    questIds: [],
    locationId: "town_center",
  },
  {
    id: "npc_carter_bel",
    name: "Carter Bel",
    regionId: "fallowmarch",
    settlementId: "coldbrace",
    role: "Hauls ore from the pit to the vault. Currently losing an argument to Warden Ilse.",
    voice:
      "Loud, boastful, permanently mid-argument. Talks in exclamations and asks questions he "
      + "answers himself. Every anecdote is about a distance and every distance is exaggerated.",
    dialogueRootId: "bel_root",
    questIds: ["the_carters_wager"],
    locationId: "town_entrance",
  },

  // --------------------------------------------------------------- Vellenwood
  {
    id: "npc_woodward_ansel",
    name: "Woodward Ansel",
    regionId: "vellenwood",
    settlementId: "rootfall",
    role: "Keeps the Maple Grove. Decides which trees may be felled and which may not.",
    voice:
      "Slow, reverent, superstitious about trees specifically. Long pauses written as sentence "
      + "breaks. Calls trees by name and people by their job.",
    dialogueRootId: "ansel_root",
    questIds: ["crooked_grain"],
    locationId: "rootfall_hamlet",
  },
  {
    id: "npc_seamer_juno",
    name: "Seamer Juno",
    regionId: "vellenwood",
    settlementId: "rootfall",
    role: "Oakwood's crafter. Shafts, hide, cord, and anything that has to hold under load.",
    voice:
      "Brisk and teasing. Uses trade jargon and then translates it in the same breath, because "
      + "she has explained this to a hundred people and enjoys it anyway.",
    dialogueRootId: "juno_root",
    questIds: ["knots_and_names"],
    locationId: "rootfall_hamlet",
  },
  {
    id: "npc_trapper_mott",
    name: "Trapper Mott",
    regionId: "vellenwood",
    settlementId: "rootfall",
    role: "Sets eleven traps in the deep wood. Has caught nothing in eleven days.",
    voice:
      "Gloomy and self-pitying, and funny because he is completely sincere. Volunteers bad news "
      + "nobody asked for. Counts his misfortunes out loud.",
    dialogueRootId: "mott_root",
    questIds: ["eleven_empty_days"],
    locationId: "rootfall_hamlet",
  },

  // --------------------------------------------------------------- Karrowmoor
  {
    id: "npc_foreman_arden",
    name: "Foreman Arden",
    regionId: "karrowmoor",
    settlementId: "highcairn",
    role: "Foreman of the Hillcrest quarry crew. Stopped the dig six months ago and kept the camp.",
    voice:
      "A manager. Everything is a cost, a distance, or a headcount. Gives instructions in the "
      + "order they must be carried out and expects them back in the same order.",
    dialogueRootId: "arden_root",
    questIds: ["bad_ground"],
    locationId: "highcairn_outpost",
  },
  {
    id: "npc_quarrier_vess",
    name: "Quarrier Vess",
    regionId: "karrowmoor",
    settlementId: "highcairn",
    role: "Works the Cobalt faces. Does not like what the blue-black stone does in the dark.",
    voice:
      "Blunt and physical, mildly superstitious. Curses in weather and stone. Says the "
      + "frightening part flatly and then changes the subject herself.",
    dialogueRootId: "vess_root",
    questIds: ["sparking_stone"],
    locationId: "highcairn_outpost",
  },
  {
    id: "npc_cairnkeeper_ode",
    name: "Cairnkeeper Ode",
    regionId: "karrowmoor",
    settlementId: "highcairn",
    role: "Keeps the cairns on the moor. Nobody appointed her; nobody has argued.",
    voice:
      "Formal and liturgical. Speaks of the cairns as duties rather than objects, and of the "
      + "Stone Cavern as a room in a house she is responsible for. Never uses the word monster.",
    dialogueRootId: "ode_root",
    questIds: ["long_cairn"],
    locationId: "highcairn_outpost",
  },
  {
    id: "npc_watcher_hale",
    name: "Watcher Hale",
    regionId: "karrowmoor",
    settlementId: "highcairn",
    role: "On the rota that watches Stone Cavern mouth. It is his shift more often than it should be.",
    voice:
      "Quiet, frightened, and constitutionally unable to overstate anything. Describes a horror "
      + "as an inconvenience. Trails off rather than finishing the worst sentence.",
    dialogueRootId: "hale_root",
    questIds: [],
    locationId: "highcairn_outpost",
  },
];

const BY_ID = new Map<EntityId, NpcDef>(NPCS.map((row) => [row.id, row]));

export function npc(id: EntityId): NpcDef | undefined {
  return BY_ID.get(id);
}

export function npcName(id: EntityId): string {
  return BY_ID.get(id)?.name ?? id;
}

export function npcsForRegion(regionId: RegionId): NpcDef[] {
  return NPCS.filter((row) => row.regionId === regionId);
}

/** Which of the twelve hands out a given quest, if any. */
export function npcGivingQuest(questId: QuestId): NpcDef | undefined {
  return NPCS.find((row) => row.questIds.includes(questId));
}

/** Root dialogue node for an NPC id, for the `talk` handler. */
export function dialogueRootFor(id: EntityId): string | undefined {
  return BY_ID.get(id)?.dialogueRootId;
}
