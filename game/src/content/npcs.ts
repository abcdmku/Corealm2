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
import npcData from "../../content/data/npcs.json";
import { parseCollection, stripExtras } from "./schema/core.js";
import { npcRecordSchema } from "./schema/people.js";
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

/** Fairy rows retain the same object identity as their dedicated export. */
export const NPCS: readonly NpcDef[] = [
  ...FAIRY_NPC_CANDIDATES,
  ...parseCollection(npcRecordSchema, npcData, { name: "npcs" })
    .filter((row) => row.catalog === "base")
    .map((row) => stripExtras(row, ["catalog"])),
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
