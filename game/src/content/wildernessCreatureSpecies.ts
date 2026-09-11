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
    description: 'A headless mass of fractured stone that braces its broad shoulder dome before grinding an intruder beneath its forelimbs.' },
  { id: 'basalt_maw', name: 'Basalt Maw', tier: 50, level: 57, role: 'predator',
    description: 'A digging predator with an open crushing face. Molten tissue joins the broken basalt around its jaws and digging arms.' },
  { id: 'rift_carapace', name: 'Rift Carapace', tier: 70, level: 69, role: 'crawler',
    description: 'An angular deep-earth crawler with separated upright plates. Blue and violet fissures show through the gaps as its mantle twists.' },
  { id: 'voidstone_colossus', name: 'Voidstone Colossus', tier: 70, level: 76, role: 'heavy',
    description: 'A hollow ribbed mass of suspended stone. Dark magic binds its separated weight-bearing blocks through deep blue fissures.' },
  { id: 'gloam_wraith', name: 'Gloam Wraith', tier: 70, level: 73, role: 'ghost',
    description: 'A slit-veiled apparition with long trailing membranes. Its hollow upper body opens during a pulling spectral strike.' },
  ...WILDERNESS_RUNE_KEEPERS.map(keeper => ({
    id: keeper.id, name: keeper.name, tier: keeper.tier, level: keeper.tier * keeper.multiplier,
    role: 'keeper' as const,
    description: {
      ashseal_warden: 'A volcanic sentinel with a fused shield forearm and a recessed seal cavity. It plants its weight before driving the entire arm forward.',
      furnace_regent: 'An immense furnace sovereign with an open caldera torso under an overhanging rib mantle. Its full-body strike exposes the molten chamber.',
      chainbound_archon: 'A suspended jailer with a split thorax and long pendulous arms. Its body opens around a bound blue void during its casting windup.',
      nightforge_marshal: 'A walking nightforge with a hollow gate-like cuirass and a massive asymmetric hammer limb. Violet seams divide the load-bearing armour.',
      hollow_star: 'A radial dark-magic creature with a hollow central body and six articulated limbs. Its limbs unfold around the void before converging in a strike.',
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
