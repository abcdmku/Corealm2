import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { WILDERNESS_RUNE_KEEPERS } from './wildernessDepth.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';
import { tierSilhouetteScale } from '../core/math.js';

interface WildernessBody {
  readonly id: string;
  readonly name: string;
  readonly tier: 50 | 70;
  readonly level: number;
  readonly role: 'crawler' | 'heavy' | 'predator' | 'ghost' | 'keeper';
  readonly description: string;
}

const bodies: readonly WildernessBody[] = [
  { id: 'cinderback_crag', name: 'Cinderback Crag', tier: 50, level: 48, role: 'crawler',
    description: 'A low eight-legged furnace scavenger. Its split basalt mantle exposes molten seams between load-bearing plates.' },
  { id: 'furnace_grazer', name: 'Furnace Grazer', tier: 50, level: 53, role: 'heavy',
    description: 'A low, horned grazer with heavy claws, overlapping scales and a pale folded throat. It lowers its head before charging.' },
  { id: 'basalt_maw', name: 'Basalt Maw', tier: 50, level: 57, role: 'predator',
    description: 'A lean horned predator with ochre plates over dark hide. Long hooked claws and powerful hind legs carry it across the basalt wastes.' },
  { id: 'rift_carapace', name: 'Rift Carapace', tier: 70, level: 69, role: 'crawler',
    description: 'An angular deep-earth crawler with separated upright plates. Blue and violet fissures show through the gaps as its mantle twists.' },
  { id: 'voidstone_colossus', name: 'Voidstone Colossus', tier: 70, level: 76, role: 'heavy',
    description: 'A tall stone guardian with worn slate armour over a darker jointed body. Faint violet eyes sit beneath its heavy brow.' },
  { id: 'gloam_wraith', name: 'Gloam Wraith', tier: 70, level: 73, role: 'ghost',
    description: 'A slender apparition in worn ash cloth and dark plum sleeves. Its hollow cowl and hooked hands lead a pulling spectral strike.' },
  ...WILDERNESS_RUNE_KEEPERS.map(keeper => ({
    id: keeper.id, name: keeper.name, tier: keeper.tier, level: keeper.tier * keeper.multiplier,
    role: 'keeper' as const,
    description: {
      ashseal_warden: 'An ancient skeletal guard in a blackened helmet, carrying a sword and shield. Pale ribs and long bony limbs show beneath its equipment.',
      furnace_regent: 'A broad stone sovereign with molten seams running through its dark hide. It bends at the waist to bring both heavy arms into a crushing strike.',
      chainbound_archon: 'A hooded spectral jailer in worn ceremonial robes. Its long sleeves trail behind outstretched hands during a curse.',
      nightforge_marshal: 'An armoured guardian with fitted plate, articulated gauntlets and a closed helm. Its heavy shoulders turn into each strike.',
      hollow_star: 'A winged deep-earth hunter with layered chitin, long antennae and hooked claws. Folded membranes rise behind its shoulders as it reaches for its prey.',
    }[keeper.id],
  })),
];

/** The lab needs real combat blocks before root attaches the final-world drop tables. */
function bodyStats(body: WildernessBody): EnemyDef {
  const heavy = body.role === 'heavy' || body.role === 'keeper';
  const magic = body.role === 'ghost' || body.id === 'chainbound_archon' || body.id === 'hollow_star';
  const attackLevel = Math.round(body.level * (magic ? .83 : heavy ? .74 : .87));
  const defenceLevel = Math.round(body.level * (heavy ? .77 : .62));
  const accuracy = magic ? 20 : body.role === 'predator' ? 15 : 8;
  const armour = magic ? 10 : heavy ? 35 : 20;
  const magicArmour = magic ? 40 : body.tier === 70 ? 25 : 10;
  return tuneEnemyCombatLevel({
    id: `${body.id}_t${body.tier}`, family: body.id, name: body.name, tier: body.tier,
    attackStyle: magic ? 'magic' : 'melee', attackRangeM: magic ? 8 : heavy ? 2.6 : 1.9,
    maxHealth: body.level * (heavy ? 5 : 3), attackLevel, defenceLevel, accuracy, armour, magicArmour,
    maxHit: Math.round(body.tier * (body.role === 'keeper' ? .76 : heavy ? .49 : .40)),
    attackSpeedMs: body.role === 'keeper' ? 3800 : heavy ? 3400 : magic ? 2900 : 2500,
    aggroRadius: body.role === 'keeper' ? 15 : magic ? 10 : 8,
    moveSpeedMps: magic ? 1.6 : heavy ? 1.1 : 1.5,
    walkSpeedMps: heavy ? .32 : .42,
    behaviour: heavy ? 'territorial' : 'aggressive', drops: [],
    marks: [body.tier, body.tier * (body.role === 'keeper' ? 12 : 3)],
  }, body.level, body.tier);
}

/** Staged actors use the production species contract. World registration follows lab acceptance. */
export const WILDERNESS_CREATURE_SPECIES: readonly CreatureSpeciesDef[] = bodies.map(body => ({
  id: body.id, assetId: `creature_${body.id}`, scale: 1 / tierSilhouetteScale(body.tier), regionId: 'wilderness',
  activity: body.role === 'heavy' ? 'graze' : body.role === 'predator' ? 'prowl' : 'patrol',
  description: body.description, stats: bodyStats(body),
}));
