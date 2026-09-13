import npcData from "../../content/data/npcs.json";
import dialogueData from "../../content/data/dialogue.json";
import { parseCollection, stripExtras } from "./schema/core.js";
import { npcRecordSchema } from "./schema/people.js";
import { dialogueRecordSchema } from "./schema/story.js";
import type { NpcDef } from './npcs.js';
import type { DialogueNodeDef } from './dialogue.js';
import type { NpcStandDef } from './regions.js';

export const FAIRY_NPC_SCALE = 1.2;

/** Shared by the lab and world so the interaction label follows the enlarged body. */
export function fairyNpcPresentation(assetId: string): { scale: number; labelHeight: number } {
  return assetId.startsWith('npc_fey_') ? { scale: FAIRY_NPC_SCALE, labelHeight: 1.4 }
    : { scale: 1, labelHeight: 2.2 };
}

/** Source-skinned NPC candidates. Final-world placement is registered after lab acceptance. */
export interface FairyNpcCandidate extends NpcDef {
  assetId: string;
  /** Native GLB bind height. The source idle poses the body at 0.87–0.89m tall. */
  bindHeightMetres: number;
}

export const FAIRY_NPC_CANDIDATES: readonly FairyNpcCandidate[] = parseCollection(npcRecordSchema, npcData, { name: "npcs" })
  .filter((row) => row.catalog === "fairy")
  .map((row) => stripExtras(row, ["catalog"]));

/** Authored village stands. Root registers these only after the NPC lab acceptance. */
export const FAIRY_NPC_STANDS: NpcStandDef[] = [
  {
    id: 'npc_fey_lantern_keeper', name: 'Luma', assetId: 'npc_fey_opaline',
    position: [2087, -103], facingRad: Math.PI / 2,
    dialogueRootId: 'fey_luma_root', questIds: [],
  },
  {
    id: 'npc_fey_moss_tender', name: 'Brindle', assetId: 'npc_fey_autumn',
    position: [2081, -93.6], facingRad: Math.PI,
    dialogueRootId: 'fey_brindle_root', questIds: [],
  },
  {
    id: 'npc_fey_seed_keeper', name: 'Nyssa', assetId: 'npc_fey_autumn',
    position: [2074.5, -90.5], facingRad: 0,
    dialogueRootId: 'fey_seed_keeper_root', questIds: [],
  },
  {
    id: 'npc_fey_nectar_cook', name: 'Pip', assetId: 'npc_fey_opaline',
    position: [2083, -99], facingRad: 0,
    dialogueRootId: 'fey_nectar_cook_root', questIds: [],
  },
  {
    id: 'npc_fey_glassworker', name: 'Tansy', assetId: 'npc_fey_frostbloom',
    position: [2063, -117.5], facingRad: 0,
    dialogueRootId: 'fey_glassworker_root', questIds: [],
  },
  {
    id: 'npc_fey_path_courier', name: 'Wren', assetId: 'npc_fey_nightshade',
    position: [2087, -77], facingRad: Math.PI,
    dialogueRootId: 'fey_path_courier_root', questIds: [],
  },
  {
    id: 'npc_fey_path_warden', name: 'Vesper', assetId: 'npc_fey_nightshade',
    position: [2299, 139], facingRad: Math.PI,
    dialogueRootId: 'fey_vesper_root', questIds: [],
  },
  {
    id: 'npc_fey_jewel_keeper', name: 'Rime', assetId: 'npc_fey_frostbloom',
    position: [2304.5, 136], facingRad: -Math.PI / 2,
    dialogueRootId: 'fey_rime_root', questIds: [],
  },
  {
    id: 'npc_fey_orchid_tender', name: 'Ione', assetId: 'npc_fey_opaline',
    position: [2304, 153.5], facingRad: Math.PI,
    dialogueRootId: 'fey_orchid_tender_root', questIds: [],
  },
  {
    id: 'npc_fey_star_reader', name: 'Aster', assetId: 'npc_fey_nightshade',
    position: [2300, 153.5], facingRad: Math.PI,
    dialogueRootId: 'fey_star_reader_root', questIds: [],
  },
  {
    id: 'npc_fey_silkwright', name: 'Thimble', assetId: 'npc_fey_autumn',
    position: [2296, 145.5], facingRad: Math.PI / 2,
    dialogueRootId: 'fey_silkwright_root', questIds: [],
  },
  {
    id: 'npc_fey_dew_scribe', name: 'Serein', assetId: 'npc_fey_frostbloom',
    position: [2305, 143], facingRad: -Math.PI / 2,
    dialogueRootId: 'fey_dew_scribe_root', questIds: [],
  },
];

export const FAIRY_NPC_DIALOGUE: readonly DialogueNodeDef[] = parseCollection(dialogueRecordSchema, dialogueData, { name: "dialogue" })
  .filter((row) => row.catalog === "fairy")
  .map((row) => stripExtras(row, ["catalog"]));

export function fairyNpcCandidate(npcId: string): FairyNpcCandidate | undefined {
  return FAIRY_NPC_CANDIDATES.find(npc => npc.id === npcId);
}
