import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';
import type { EnemyDef } from './index.js';

interface RegionalForm {
  readonly id: string;
  readonly sourceSpeciesId: string;
  readonly sourceAssetId: string;
  readonly name: string;
  readonly regionId: 'crownward' | 'gloamgarden' | 'faeholme';
  readonly tier: 30 | 40 | 60;
  readonly level: number;
  /** Desired uniform multiplier of the unchanged source GLB's native dimensions. */
  readonly nativeScale: number;
  readonly activity: CreatureSpeciesDef['activity'];
  readonly behaviour: EnemyDef['behaviour'];
  readonly description: string;
  readonly boss?: true;
}

/** Existing complete bodies, with material changes and uniform runtime sizing only. */
export const FAIRY_CROWN_FORMS: readonly RegionalForm[] = [
  { id: 'pearl_knight', sourceSpeciesId: 'nightforge_marshal', sourceAssetId: 'creature_nightforge_marshal',
    name: 'Pearl Knight', regionId: 'crownward', tier: 40, level: 40, nativeScale: .66,
    activity: 'patrol', behaviour: 'territorial',
    description: 'A knight in pearl-white plate and a closed silver helm. Cool light catches the fitted armour above dark articulated joints.' },
  { id: 'ivory_castellan', sourceSpeciesId: 'nightforge_marshal', sourceAssetId: 'creature_nightforge_marshal',
    name: 'Ivory Castellan', regionId: 'crownward', tier: 40, level: 100, nativeScale: 1.05,
    activity: 'patrol', behaviour: 'territorial', boss: true,
    description: 'A towering castle guardian in white plate, with pale gold shoulders and a shimmering silver helm. Its heavy gauntlets lead each strike.' },
  { id: 'crown_hart', sourceSpeciesId: 'marchwild_horse', sourceAssetId: 'animal_deer',
    name: 'Crown Hart', regionId: 'crownward', tier: 40, level: 36, nativeScale: 1.1,
    activity: 'graze', behaviour: 'passive',
    description: 'A pale silver-antlered deer browsing the old royal parkland. Its cream coat has the faint green sheen of the surrounding groves.' },
  { id: 'silverthorn_harrow', sourceSpeciesId: 'briar_harrow', sourceAssetId: 'creature_briar_harrow',
    name: 'Silverthorn Harrow', regionId: 'crownward', tier: 40, level: 44, nativeScale: 1.05,
    activity: 'patrol', behaviour: 'territorial',
    description: 'An old walking tree with silver bark and dark moss-green hollows. Heavy root hands drag beside its bowed trunk.' },
  { id: 'lantern_sprite', sourceSpeciesId: 'marsh_wasp', sourceAssetId: 'creature_marsh_wasp',
    name: 'Lantern Sprite', regionId: 'gloamgarden', tier: 30, level: 28, nativeScale: .58,
    activity: 'forage', behaviour: 'territorial',
    description: 'A small winged garden spirit with a teal body and translucent lilac wings. Soft mint light gathers on its existing shell markings.' },
  { id: 'moonpetal_stalker', sourceSpeciesId: 'heath_jack', sourceAssetId: 'creature_heath_jack',
    name: 'Moonpetal Stalker', regionId: 'gloamgarden', tier: 30, level: 32, nativeScale: .85,
    activity: 'prowl', behaviour: 'aggressive',
    description: 'A small carved woodland hunter in plum cloth. Pale turquoise grain follows its long hands and hollow wooden face.' },
  { id: 'dewglass_weaver', sourceSpeciesId: 'fen_crawler', sourceAssetId: 'creature_fen_crawler',
    name: 'Dewglass Weaver', regionId: 'gloamgarden', tier: 30, level: 30, nativeScale: .9,
    activity: 'prowl', behaviour: 'aggressive',
    description: 'A low teal crawler with lilac shell edges and long folded legs. Its feeding blades shine like wet glass beneath the front shield.' },
  { id: 'bloomheart_matriarch', sourceSpeciesId: 'boss_rootheart', sourceAssetId: 'creature_boss_rootheart',
    name: 'Bloomheart Matriarch', regionId: 'gloamgarden', tier: 30, level: 75, nativeScale: 1.35,
    activity: 'patrol', behaviour: 'territorial', boss: true,
    description: 'An ancient violet tree guardian with teal inner growth and pale rose edges. A recessed luminous heart sits inside the split trunk.' },
  { id: 'prismatic_sprite', sourceSpeciesId: 'marsh_wasp', sourceAssetId: 'creature_marsh_wasp',
    name: 'Prismatic Sprite', regionId: 'faeholme', tier: 60, level: 58, nativeScale: .85,
    activity: 'forage', behaviour: 'territorial',
    description: 'A large violet-winged garden spirit with a deep turquoise shell. Magenta and cyan marks trace its familiar winged insect body.' },
  { id: 'orchid_reaper', sourceSpeciesId: 'veil_reaper', sourceAssetId: 'creature_veil_reaper',
    name: 'Orchid Reaper', regionId: 'faeholme', tier: 60, level: 62, nativeScale: .85,
    activity: 'patrol', behaviour: 'aggressive',
    description: 'A drifting figure in orchid-purple woven robes and an ivory cowl. Teal light runs softly across its outstretched hands.' },
  { id: 'starroot_guardian', sourceSpeciesId: 'briar_harrow', sourceAssetId: 'creature_briar_harrow',
    name: 'Starroot Guardian', regionId: 'faeholme', tier: 60, level: 66, nativeScale: 1.2,
    activity: 'patrol', behaviour: 'territorial',
    description: 'A mature walking root with dark violet bark and bright turquoise inner fibres. Its crooked branches frame a deep shadowed body cavity.' },
  { id: 'amethyst_sovereign', sourceSpeciesId: 'hollow_star', sourceAssetId: 'creature_hollow_star',
    name: 'Amethyst Sovereign', regionId: 'faeholme', tier: 60, level: 150, nativeScale: 1.25,
    activity: 'patrol', behaviour: 'territorial', boss: true,
    description: 'A tall winged chitin sovereign with amethyst plates, wine-purple membranes and a pale teal sheen. Long antennae and hooked claws retain its ancient insect silhouette.' },
];

/** Full asset IDs for root to copy source attack timing, gait ceilings and footprint records. */
export const FAIRY_CROWN_SOURCE_ASSETS: Readonly<Record<string, string>> = Object.fromEntries(
  FAIRY_CROWN_FORMS.map(form => [`creature_${form.id}`, form.sourceAssetId]),
);

export const FAIRY_CROWN_BOSS_IDS = FAIRY_CROWN_FORMS.filter(form => form.boss).map(form => form.id);

export const FAIRY_CROWN_SPECIES: readonly CreatureSpeciesDef[] = creatureRows('FAIRY_CROWN_SPECIES');
