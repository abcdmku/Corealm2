import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { RPG_BESTIARY } from './rpgBestiary.js';
import { CREATURE_EXPANSION } from './creatureExpansion.js';

/** Regional forms retain the complete source skeleton and production combat behavior. */
type VariantRow = readonly [string, string, string, CreatureSpeciesDef["regionId"], number, number, string, string];
const variants: readonly VariantRow[] = [
  ['gloam_fox', 'redbrush_fox', 'Gloam Fox', 'fallowmarch', 1.08, 12, 'air_essence', 'Lilac dusk fur marks this shy hedge spirit.'],
  ['moonweave_spider', 'webweaver_spider', 'Moonweave Spider', 'vellenwood', .82, 28, 'earth_essence', 'A jade woodland spider with a faintly luminous shell.'],
  ['rimeback_tortoise', 'slateback_tortoise', 'Rimeback Tortoise', 'karrowmoor', 1.12, 44, 'water_essence', 'An ice-blue shell protects this slow highland browser.'],
  ['cindercrest_salamander', 'kiln_salamander', 'Cindercrest Salamander', 'kilnhalt', 1.15, 62, 'fire_essence', 'A copper crawler whose skin glows like cooling embers.'],
  ['amethyst_spider', 'webweaver_spider', 'Amethyst Spider', 'gravelmaw', .72, 32, 'earth_essence', 'A violet cave hunter with a mineral sheen.'],
];
export const REGIONAL_CREATURE_VARIANTS: readonly CreatureSpeciesDef[] = variants.map(([id, baseId, name, regionId, scale, health, essence, description]) => {
  const base = [...CREATURE_EXPANSION, ...RPG_BESTIARY].find(row => row.id === baseId)!;
  return { ...base, id, assetId: `creature_${id}`, regionId, scale, description,
    stats: { ...base.stats, id: `${id}_t${base.stats.tier}`, family: id, name,
      maxHealth: health, magicArmour: base.stats.magicArmour + 12,
      drops: [...base.stats.drops, { itemId: essence, quantity: [1, 1], chance: .25 }] } };
});

