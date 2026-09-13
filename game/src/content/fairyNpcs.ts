import type { NpcDef } from './npcs.js';
import type { DialogueNodeDef } from './dialogue.js';
import type { NpcStandDef } from './regions.js';

export const FAIRY_NPC_SCALE = 1.2;

/** Shared by the lab and world so the interaction label follows the enlarged body. */
export function fairyNpcPresentation(assetId: string): { scale: number; labelHeight: number } {
  return assetId.startsWith('npc_fey_') ? { scale: FAIRY_NPC_SCALE, labelHeight: 1.4 }
    : { scale: 1, labelHeight: 2.2 };
}

const NEW_FAIRIES = [
  { id: 'seed_keeper', name: 'Nyssa', skin: 'autumn', regionId: 'gloamgarden',
    role: 'Collects seeds for the cottage gardens.', voice: 'Patient gardener with a dry sense of humour.',
    text: 'The sporekin have eaten another tray of moonpetal shoots. Lovely creatures. Terrible neighbours.',
    question: 'What lives beyond the village?', answer: 'Dewdrop spriggles and glasspond frogs like the lower shade. Higher up you will find lantern imps, petalguards and walking saplings. Give the petal drakes their space.' },
  { id: 'nectar_cook', name: 'Pip', skin: 'opaline', regionId: 'gloamgarden',
    role: 'Cooks at the Lantern Market.', voice: 'Cheerful cook who keeps an eye on the pot.',
    text: 'If you smell something sweet, that is supper. If you smell burnt sugar, I was talking too much.',
    question: 'Where can I cook?', answer: 'The cooking pot is on the market counter. Bring your own ingredients. There is a crafting bench here too, and the furnace and anvil are by the forge.' },
  { id: 'glassworker', name: 'Tansy', skin: 'frostbloom', regionId: 'gloamgarden',
    role: 'Works dewglass at the Lantern Forge.', voice: 'Careful craftsperson who explains things plainly.',
    text: 'Dewglass looks soft under this light. It still needs a proper furnace. I have a ruined hammer to prove it.',
    question: 'Where is the dewglass?', answer: 'Take the eastern lane to Dewglass Workings. Lantern Seam is farther into the garden. Bank your load here before heading out again.' },
  { id: 'path_courier', name: 'Wren', skin: 'nightshade', regionId: 'gloamgarden',
    role: 'Carries news between Lantern Rest and Prism Hollow.', voice: 'Brisk courier with useful route knowledge.',
    text: 'I have walked to Prism Hollow twice today. The harts keep stopping in the path to stare at me.',
    question: 'How do I reach Prism Hollow?', answer: 'Follow the paths through Moonpath Cross and keep north. The threshold leads straight into the deeper garden. Its creatures are stronger, so stop at the bank before you explore.' },
  { id: 'orchid_tender', name: 'Ione', skin: 'opaline', regionId: 'faeholme',
    role: 'Tends the frost orchids at Prism Hollow.', voice: 'Soft-spoken gardener who knows the local animals.',
    text: 'The orchid pondlings hide under these leaves. I water the flowers around them. Moving a frog is more work than moving a watering can.',
    question: 'What is different about these gardens?', answer: 'Starcap snails graze in the hollows while the porcelain reliquaries patrol. Twilight imps gather above them. The deeper crowns belong to starroot tenders, orchid drakes and mineral wardlings.' },
  { id: 'star_reader', name: 'Aster', skin: 'nightshade', regionId: 'faeholme',
    role: 'Studies the light in the fairy vault.', voice: 'Observant scholar who enjoys small discoveries.',
    text: 'Those lights overhead are not the surface stars. I keep drawing them anyway. Last week one of the patterns moved.',
    question: 'What are the winged guardians?', answer: 'Great wardens settle on the high crowns. They carry the same old guardian jewels found elsewhere, though the garden has coloured their wings. Watch them from the approach before stepping into the clearing.' },
  { id: 'silkwright', name: 'Thimble', skin: 'autumn', regionId: 'faeholme',
    role: 'Mends garden clothes and traveling cloaks.', voice: 'Matter-of-fact tailor with little patience for torn hems.',
    text: 'Another cloak caught on a root. Bring it here before you decide the missing piece makes it fashionable.',
    question: 'Any advice for the high gardens?', answer: 'Use the narrow climbing paths. Some crowns have Agility climbs too, if you have the training. Leave yourself room to get back down; a drake can turn faster than you expect.' },
  { id: 'dew_scribe', name: 'Serein', skin: 'frostbloom', regionId: 'faeholme',
    role: 'Keeps gathering notes beside Prism Bank.', voice: 'Helpful clerk who gives short, precise directions.',
    text: 'Star amethyst, yew, one muddy boot. People write unusual things in the gathering ledger.',
    question: 'Where should I gather?', answer: 'Star Amethyst Cut lies west of the village. Orchid Yew Grove is east, and Starroot Garden is farther north. The bank here saves you the trip back to Lantern Rest.' },
] as const;

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
  ...NEW_FAIRIES.map(fairy => ({
    id: `npc_fey_${fairy.id}`, name: fairy.name, assetId: `npc_fey_${fairy.skin}`,
    regionId: fairy.regionId, settlementId: fairy.regionId === 'gloamgarden' ? 'lantern_rest' : 'prism_hollow',
    locationId: fairy.regionId === 'gloamgarden' ? 'lantern_rest_square' : 'prism_hollow_square',
    role: fairy.role, voice: fairy.voice, dialogueRootId: `fey_${fairy.id}_root`, questIds: [], bindHeightMetres: .78,
  })),
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

export const FAIRY_NPC_DIALOGUE: readonly DialogueNodeDef[] = [
  ...NEW_FAIRIES.flatMap(fairy => [
    { id: `fey_${fairy.id}_root`, speaker: fairy.name, text: fairy.text,
      options: [
        { id: `fey_${fairy.id}_root#ask`, text: fairy.question, next: `fey_${fairy.id}_detail` },
        { id: `fey_${fairy.id}_root#bye`, text: 'Goodbye.', next: null },
      ] },
    { id: `fey_${fairy.id}_detail`, speaker: fairy.name, text: fairy.answer,
      options: [{ id: `fey_${fairy.id}_detail#bye`, text: 'Thank you.', next: null }] },
  ]),
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
    text: 'The roaming great monsters sometimes carry them. Ordinary jewelry is much more common. A rare piece can hold defense, health and strength together; those are the ones I record carefully.',
    options: [{ id: 'fey_rime_jewels#bye', text: 'That sounds worth the trouble.', next: null }],
  },
];

export function fairyNpcCandidate(npcId: string): FairyNpcCandidate | undefined {
  return FAIRY_NPC_CANDIDATES.find(npc => npc.id === npcId);
}
