import type { NpcDef } from './npcs.js';
import type { DialogueNodeDef } from './dialogue.js';
import type { NpcStandDef } from './regions.js';

/** Source-skinned NPC candidates. Final-world placement is registered after lab acceptance. */
export interface FairyNpcCandidate extends NpcDef {
  assetId: string;
  /** Native GLB bind height. The source idle poses the body at 0.87–0.89m tall. */
  bindHeightMetres: number;
}

export const FAIRY_NPC_CANDIDATES: readonly FairyNpcCandidate[] = [
  {
    id: 'npc_fey_lantern_keeper', name: 'Luma', assetId: 'npc_fey_opaline',
    regionId: 'gloamgarden', settlementId: 'lantern_rest', locationId: 'lantern_rest_square',
    role: 'Lantern keeper at Lantern Rest. Helps visitors find their way through Gloamgarden.',
    voice: 'Welcoming and direct. Gives one useful direction before any local gossip.',
    dialogueRootId: 'fey_luma_root', questIds: [], bindHeightMetres: 0.78,
  },
  {
    id: 'npc_fey_moss_tender', name: 'Brindle', assetId: 'npc_fey_autumn',
    regionId: 'gloamgarden', settlementId: 'lantern_rest', locationId: 'lantern_rest_square',
    role: 'Tends the planted banks and cottage gardens at Lantern Rest.',
    voice: 'Practical gardener. Notices damaged roots and muddy boots before titles.',
    dialogueRootId: 'fey_brindle_root', questIds: [], bindHeightMetres: 0.78,
  },
  {
    id: 'npc_fey_path_warden', name: 'Vesper', assetId: 'npc_fey_nightshade',
    regionId: 'faeholme', settlementId: 'prism_hollow', locationId: 'prism_hollow_square',
    role: 'Watches the paths leading out of Prism Hollow into the deeper fairy realm.',
    voice: 'Quiet and exact. Describes a threat plainly and gives the traveler room to decide.',
    dialogueRootId: 'fey_vesper_root', questIds: [], bindHeightMetres: 0.78,
  },
  {
    id: 'npc_fey_jewel_keeper', name: 'Rime', assetId: 'npc_fey_frostbloom',
    regionId: 'faeholme', settlementId: 'prism_hollow', locationId: 'prism_hollow_square',
    role: 'Keeps the jewel records at Prism Hollow and studies unusual monster spoils.',
    voice: 'Curious jeweler. Talks about what a stone can do, with little interest in its price.',
    dialogueRootId: 'fey_rime_root', questIds: [], bindHeightMetres: 0.78,
  },
];

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
    id: 'npc_fey_path_warden', name: 'Vesper', assetId: 'npc_fey_nightshade',
    position: [2299, 139], facingRad: Math.PI,
    dialogueRootId: 'fey_vesper_root', questIds: [],
  },
  {
    id: 'npc_fey_jewel_keeper', name: 'Rime', assetId: 'npc_fey_frostbloom',
    position: [2304.5, 136], facingRad: -Math.PI / 2,
    dialogueRootId: 'fey_rime_root', questIds: [],
  },
];

export const FAIRY_NPC_DIALOGUE: readonly DialogueNodeDef[] = [
  {
    id: 'fey_luma_root', speaker: 'Luma',
    text: 'Welcome to Lantern Rest. The bank is here in the village. Follow the lit paths when you leave; the high gardens have only a few ways up.',
    options: [
      { id: 'fey_luma_root#paths', text: 'How do I reach the high gardens?', next: 'fey_luma_paths' },
      { id: 'fey_luma_root#bye', text: 'Thank you.', next: null },
    ],
  },
  {
    id: 'fey_luma_paths', speaker: 'Luma',
    text: 'Look for a narrow path climbing around the rock. Most of those banks are too steep to walk up. The wider clearings farther from town are creature territory.',
    options: [{ id: 'fey_luma_paths#bye', text: 'I will watch the clearings.', next: null }],
  },
  {
    id: 'fey_brindle_root', speaker: 'Brindle',
    text: 'Mind the roots beside the steps. We build into these banks because they shelter the cottages. Took years to get the moss back after the last roof went up.',
    options: [
      { id: 'fey_brindle_root#gardens', text: 'Are the gardens outside town safe?', next: 'fey_brindle_gardens' },
      { id: 'fey_brindle_root#bye', text: 'I will keep to the path.', next: null },
    ],
  },
  {
    id: 'fey_brindle_gardens', speaker: 'Brindle',
    text: 'Safe enough here. Farther out, something always wants the same patch of shade you do. Leave room to retreat before you climb into an occupied clearing.',
    options: [{ id: 'fey_brindle_gardens#bye', text: 'Good advice.', next: null }],
  },
  {
    id: 'fey_vesper_root', speaker: 'Vesper',
    text: 'This is Prism Hollow. Beyond it, Faeholme grows colder and the creatures grow stronger. Check the clearing above you before you take its climbing path.',
    options: [
      { id: 'fey_vesper_root#threats', text: 'What should I watch for?', next: 'fey_vesper_threats' },
      { id: 'fey_vesper_root#bye', text: 'I understand.', next: null },
    ],
  },
  {
    id: 'fey_vesper_threats', speaker: 'Vesper',
    text: 'The largest strangers wander into every region. They are much stronger than the usual creatures, and their resting places can change. An empty path today proves very little about tomorrow.',
    options: [{ id: 'fey_vesper_threats#bye', text: 'I will look before I climb.', next: null }],
  },
  {
    id: 'fey_rime_root', speaker: 'Rime',
    text: 'A good jewel earns its setting. Some protect the wearer; some lend strength to a blade or spell. The unusual ones can do both.',
    options: [
      { id: 'fey_rime_root#jewels', text: 'Where do the unusual jewels come from?', next: 'fey_rime_jewels' },
      { id: 'fey_rime_root#bye', text: 'I will keep an eye out.', next: null },
    ],
  },
  {
    id: 'fey_rime_jewels', speaker: 'Rime',
    text: 'The roaming great monsters sometimes carry them. Ordinary jewelry is much more common. A rare piece can hold defense, vitality and strength together; those are the ones I record carefully.',
    options: [{ id: 'fey_rime_jewels#bye', text: 'That sounds worth the trouble.', next: null }],
  },
];

export function fairyNpcCandidate(npcId: string): FairyNpcCandidate | undefined {
  return FAIRY_NPC_CANDIDATES.find(npc => npc.id === npcId);
}
