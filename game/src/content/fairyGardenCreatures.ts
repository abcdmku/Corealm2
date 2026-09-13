import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { tierSilhouetteScale } from '../core/math.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';

/** Regional variants share their source bodies. World placement is separate. */
export const FAIRY_GARDEN_FORMS = [
  { id: 'spriggle', source: 'fairy_monster_10', names: ['Dewdrop Spriggle', 'Prism Spriggle'], scale: .75, level: -3, speed: .8, activity: 'forage', behaviour: 'territorial', look: 'mint', description: 'A rotund garden sprite with curling tail, stone buds and winding markings across its back.' },
  { id: 'sporekin', source: 'creature_goblin_shaman', names: ['Mooncap Sporekin', 'Duskcap Sporekin'], scale: .65, level: -6, speed: 1.1, activity: 'forage', behaviour: 'passive', look: 'rose', description: 'A staff-carrying woodland fey with spore-dappled skin and fungal markings on its robes.' },
  { id: 'frog', source: 'animal_frog', names: ['Glasspond Frog', 'Orchid Pondling'], scale: 3.4, level: -4, speed: .65, activity: 'forage', behaviour: 'territorial', look: 'mint', description: 'A jewel-coloured frog resting in the damp shade of the gardens.' },
  { id: 'imp', source: 'fairy_monster_19', names: ['Lantern Imp', 'Twilight Imp'], scale: .85, level: 1, speed: 1.1, activity: 'forage', behaviour: 'territorial', look: 'rose', description: 'A small, one-eyed winged imp with pale membranes and curling horns.' },
  { id: 'snail', source: 'creature_quarry_snail', names: ['Mooncap Snail', 'Starcap Snail'], scale: 2.1, level: -2, speed: .3, activity: 'forage', behaviour: 'passive', look: 'rose', description: 'A slow garden snail carrying a lilac spiral shell.' },
  { id: 'reliquary', source: 'fairy_monster_28', names: ['Dewglass Reliquary', 'Starporcelain Reliquary'], scale: .95, level: 0, speed: .55, activity: 'patrol', behaviour: 'territorial', look: 'mint', description: 'A squat one-eyed construct with moss-veined porcelain plates and gilded vine inlays.' },
  { id: 'hart', source: 'animal_deer', names: ['Silverleaf Hart', 'Starhorn Hart'], scale: .85, level: 2, speed: 1.2, activity: 'graze', behaviour: 'territorial', look: 'pearl', description: 'A pale woodland hart with silver antlers and a cool sheen across its coat.' },
  { id: 'veilspirit', source: 'creature_wraith', names: ['Thistledown Veilspirit', 'Orchid Veilspirit'], scale: .75, level: 4, speed: 1.2, activity: 'prowl', behaviour: 'territorial', look: 'rose', description: 'A hovering fey spirit wrapped in trailing veils sewn with branching veins and tiny stars.' },
  { id: 'sapling', source: 'creature_briar_harrow', names: ['Briar Sapling', 'Starroot Tender'], scale: .52, level: 7, speed: .85, activity: 'patrol', behaviour: 'territorial', look: 'mint', description: 'A small walking tree with twisted root hands and light inside its bark.' },
  { id: 'drake', source: 'creature_baby_red_dragon', names: ['Petal Drake', 'Orchid Drake'], scale: .72, level: 9, speed: .9, activity: 'prowl', behaviour: 'aggressive', look: 'rose', description: 'A young fairy drake with flower-coloured scales and broad folded wings.' },
  { id: 'wardling', source: 'fairy_monster_34', names: ['Dewstone Wardling', 'Amethyst Wardling'], scale: 1.2, level: 11, speed: 1, activity: 'patrol', behaviour: 'territorial', look: 'mint', description: 'A compact guardian made of separated, floating stones around a luminous mineral core.' },
  { id: 'petalguard', source: 'fairy_monster_31', names: ['Silverleaf Petalguard', 'Moonstone Petalguard'], scale: 1.5, level: 5, speed: .7, activity: 'patrol', behaviour: 'territorial', look: 'pearl', description: 'A small enchanted suit of armor with leaf-etched enamel, a gemstone shield and a narrow blade.' },
] as const;

export const FAIRY_GARDEN_VARIANTS = ([{ regionId: 'gloamgarden', tier: 30 }, { regionId: 'faeholme', tier: 60 }] as const)
  .flatMap(({ regionId, tier }, index) => FAIRY_GARDEN_FORMS.map(form => ({
    ...form, regionId, tier, name: form.names[index]!, family: `garden_${form.id}`, id: `garden_${form.id}_t${tier}`,
    assetId: `fairy_garden_${form.id}_${regionId}`,
  })));

const template: EnemyDef = {
  id: 'fairy_garden', family: 'fairy_garden', name: 'Garden Creature', tier: 30,
  maxHealth: 70, attackLevel: 8, defenceLevel: 7, accuracy: 18, armour: 20, magicArmour: 12,
  maxHit: 6, attackSpeedMs: 2400, aggroRadius: 5, moveSpeedMps: 1, walkSpeedMps: .3,
  behaviour: 'territorial', drops: [],
};

export const FAIRY_GARDEN_SPECIES: readonly CreatureSpeciesDef[] = FAIRY_GARDEN_VARIANTS.map(form => ({
  id: form.id, assetId: form.assetId, regionId: form.regionId,
  scale: form.scale / tierSilhouetteScale(form.tier), activity: form.activity, description: form.description,
  stats: {
    ...tuneEnemyCombatLevel(template, form.tier + form.level, form.tier),
    id: form.id, family: form.family, name: form.name,
    behaviour: form.behaviour, moveSpeedMps: form.speed, walkSpeedMps: Math.min(.35, form.speed * .45),
    aggroRadius: form.behaviour === 'aggressive' ? 7 : 4,
    drops: [
      { itemId: 'earth_essence', quantity: [1, 3], chance: .55 },
      { itemId: form.tier === 30 ? 'chaos_rune' : 'blood_rune', quantity: [1, 2], chance: .18 },
      { itemId: 'cosmic_rune', quantity: [1, 1], chance: .14 },
    ], marks: [form.tier * 3, form.tier * 7],
  },
}));

