import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { tierSilhouetteScale } from '../core/math.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';

/** Staged production species. Root accepts the lab assets before world registration. */
const DRAGON_SPECIES: readonly CreatureSpeciesDef[] = [
  {id:'baby_red_dragon',name:'Red Dragon Hatchling',tier:50,combatLevel:50,description:'A red hatchling with a broad brow, short tail and developing wing fingers. It braces on its rear claws before snapping forward.'},
  {id:'baby_black_dragon',name:'Black Dragon Hatchling',tier:50,combatLevel:53,description:'A low black hatchling with a short hooked muzzle, round throat and broad small wings. It stalks the charcoal flats.'},
  {id:'baby_lava_dragon',name:'Cinder Dreadwing',tier:50,combatLevel:56,description:'A lean volcanic dreadwing with a tucked throat, long tail and copper-red hide above an ochre underside.'},
  {id:'red_wilderness_dragon',name:'Red Wilderness Dragon',tier:70,combatLevel:72,description:'A tall red wyvern with a spear-shaped skull, hooked wing claws and a long blade tail. Its rear legs brace a heavy neck strike.'},
  {id:'black_wilderness_dragon',name:'Black Wilderness Dragon',tier:70,combatLevel:75,description:'A black four-legged dragon with a long low neck, backward crown horns and broad sail wings.'},
  {id:'purple_wilderness_dragon',name:'Violet Dreadwing',tier:70,combatLevel:78,description:'A narrow-bodied dreadwing with a raised throat, long legs and a swept tail. Pale horns break up its plum hide and violet wing membranes.'},
  {id:'amethyst_dragon',name:'Purple Wilderness Dragon',tier:70,combatLevel:78,description:'A lean purple dragon with a long neck and dark sail wings. Fine amethyst light follows the grain of its scales.'},
].map(row => ({
  id:row.id,assetId:`creature_${row.id}`,scale:1/tierSilhouetteScale(row.tier),regionId:'wilderness',activity:'prowl',description:row.description,
  stats:tuneEnemyCombatLevel({id:`${row.id}_t${row.tier}`,family:row.id,name:row.name,tier:row.tier,maxHealth:row.tier*3,
    attackLevel:row.tier-3,defenceLevel:row.tier-5,accuracy:12,armour:24,magicArmour:32,
    maxHit:Math.round(row.tier*.32),attackSpeedMs:row.tier===50?2800:3600,attackStyle:'melee',attackRangeM:row.tier===50?2.3:3.5,
    aggroRadius:row.tier===50?8:11,moveSpeedMps:row.tier===50?1.4:1.8,walkSpeedMps:row.tier===50?.65:.8,behaviour:'aggressive',
    marks:[row.tier*2,row.tier*6],drops:[{itemId:'drake_scale',quantity:[1,row.tier===50?2:4],chance:.85},{itemId:'fire_essence',quantity:[2,5],chance:.65}]},row.combatLevel),
}));

export const WILDERNESS_DRAGONS = DRAGON_SPECIES.filter(species => species.id !== 'amethyst_dragon');
export const WILDERNESS_DRAGON_CANDIDATES = DRAGON_SPECIES;
