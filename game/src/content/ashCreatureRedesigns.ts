import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { RPG_BESTIARY_BY_ID } from './rpgBestiary.js';

/** Sculpted production candidates. Candidate catalogue proof precedes authored-world use. */
export const ASH_CREATURE_REDESIGNS: readonly CreatureSpeciesDef[] = [
  { id: 'kiln_marrow', source: 'lava_golem', name: 'Kiln Marrow', regionId: 'kilnhalt', health: 74, tier: 20, scale: .88,
    description: 'A hunched stone giant with long, heavy arms. Banked heat shows through narrow cracks in its cooled ash hide.' },
  { id: 'slag_crawler', source: 'webweaver_spider', name: 'Slag Crawler', regionId: 'kilnhalt', health: 38, tier: 10, scale: 1,
    description: 'An eight-legged furnace scavenger with overlapping slag plates, a shovel mouth and folding mandibles. Its body rocks over a low, heavy support gait.' },
  { id: 'cinder_penitent', source: 'revenant', name: 'Cinder Penitent', regionId: 'kilnhalt', health: 52, tier: 20, scale: 1,
    description: 'An apparition in a pale ash cowl and scorched maroon robes. A dark face slit sits above its long reaching hands.' },
  { id: 'grave_lantern', source: 'grave_ghoul', name: 'Ashen Ghoul', regionId: 'wilderness', health: 46, tier: 20, scale: 1.08,
    description: 'A crouched corpse with cold pale skin and torn dark clothing. Its long arms hang beside a lean, hunched torso as it searches the graves.' },
  { id: 'veil_reaper', source: 'banshee', name: 'Veil Reaper', regionId: 'wilderness', health: 58, tier: 20, scale: 1.05,
    description: 'A hooded apparition in worn ceremonial cloth. Long sleeves follow its hooked hands through a sweeping strike.' },
].map(row => {
  const base = RPG_BESTIARY_BY_ID.get(row.source)!;
  return { id: row.id, assetId: `creature_${row.id}`, scale: row.scale,
    regionId: row.regionId as CreatureSpeciesDef['regionId'], activity: 'patrol', description: row.description,
    stats: { ...base.stats, id: `${row.id}_t${row.tier}`, family: row.id, name: row.name, tier: row.tier,
      maxHealth: row.health, attackStyle: 'melee', attackRangeM: row.id === 'kiln_marrow' ? 2.1 : 1.8,
      behaviour: row.id === 'kiln_marrow' ? 'territorial' : 'aggressive',
      drops: [{ itemId: row.regionId === 'kilnhalt' ? 'fire_essence' : 'earth_essence', quantity: [1, 2], chance: .35 }] } };
});
