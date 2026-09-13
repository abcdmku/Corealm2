import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';

export {
  UNIVERSAL_MINIBOSS_RESPAWN_SECONDS, UNIQUE_JEWELLERY_CHANCE, UNIVERSAL_MINIBOSS_ROSTER,
  UNIVERSAL_MINIBOSS_SPECIES,
} from './universalMinibosses.js';
export { MINIBOSS_JEWELLERY } from './universalMinibossLoot.js';

/** Increasing body size and danger place the last two creatures in the remote clearings. */
export const FAIRY_CREATURE_ROSTER = [
  { number: '11', id: 'petal_pouncer', name: 'Petal Pouncer', levelOffset: -4, nativeScale: .7 },
  { number: '14', id: 'moss_nibbler', name: 'Moss Nibbler', levelOffset: -2, nativeScale: .65 },
  { number: '16', id: 'bloom_hopper', name: 'Bloom Hopper', levelOffset: 0, nativeScale: .8 },
  { number: '21', id: 'thicket_spirit', name: 'Thicket Spirit', levelOffset: 3, nativeScale: .9 },
  { number: '27', id: 'bramble_prowler', name: 'Bramble Prowler', levelOffset: 8, nativeScale: 1.1 },
  { number: '30', id: 'elder_grovebeast', name: 'Elder Grovebeast', levelOffset: 14, nativeScale: 1.2 },
] as const;

export const FAIRY_CREATURE_SPECIES: readonly CreatureSpeciesDef[] = creatureRows('FAIRY_CREATURE_SPECIES');
