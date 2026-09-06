import type { CreatureSpeciesDef } from "./creatureSpecies.js";
import { enemyCombatLevel, type EnemyDef } from "./index.js";

export type RpgBodyFamily = "goblin" | "orc" | "skeleton" | "zombie" | "wraith" | "golem" | "harpy" | "gargoyle" | "gnoll" | "lizardman" | "minotaur" | "demon" | "spider" | "wasp" | "forest_creature" | "elemental" | "roach" | "troll" | "rat";
export interface RpgBestiaryEntry extends CreatureSpeciesDef {
  readonly bodyFamily: RpgBodyFamily;
  readonly rigFamily: string;
  readonly movement: "biped" | "hover" | "arthropod" | "flying" | "quadruped";
  readonly habitat: string;
  readonly respawnMs: number;
  readonly nativeSize: readonly [number, number, number];
  readonly nativeBase: readonly [number, number, number];
  readonly nativeVisualRadius: number;
  readonly nativeBodyRadius: number;
  /** Intentional animation actions. Projectile/special mechanics need the shared combat owner. */
  readonly attack: { readonly action: string; readonly proposedMechanic: "melee" | "projectile" | "spell"; readonly recoveryMs: number };
  readonly source: { readonly author: string; readonly license: string; readonly generator: string };
  readonly acceptance: "candidate";
}


/** Neutral-pose bounds measured from the staged weighted GLBs. */
const nativeBounds: Readonly<Record<string, readonly [number, number, number, number, number, number]>> = {
  giant_rat: [-0.141679335, 0.004, -0.619674694, 0.283358671, 0.34, 1.239349388],
  wild_goblin: [-0.493633103, 0.006, -0.256327075, 0.987266206, 1.35, 0.512654150],
  troll_mauler: [-1.558338501, 0.001, -0.819256479, 3.110015344, 3.075232424, 1.675653406],
  webweaver_spider: [-0.8, 0.003, -0.625535, 1.6, 0.520136, 1.353785],
  marsh_wasp: [-0.576492, 0.378816, -0.751139, 1.2, 1.882373, 2.482819],
  cave_roach: [-0.592252, 0.005, -0.924792, 1.184504, 1.15, 1.626328],
  mossback_sentinel: [-1.049472, 0.003, -1.619951, 2.017049, 4.018234, 2.392775],
  shale_elemental: [-1.393284, 0.003, -0.795828, 2.778613, 2.55, 1.281181],
  beetle_golem: [-1.237891, 0.003, -0.529829, 2.475101, 2.55, 1.414106],
  lava_golem: [-0.943108, 0.003, -0.629999, 1.85112, 2.815493, 1.163049],
  goblin_scout: [-0.254276, 0.002, -0.271784, 0.541855, 1.327607, 0.512835],
  goblin_archer: [-0.254276, 0.002, -0.271784, 0.605896, 1.327607, 0.512835],
  goblin_shaman: [-0.267722, 0.002, -0.904144, 0.474369, 1.328404, 1.503733],
  orc_warrior: [-0.440445, 0.002, -0.453897, 0.939455, 1.966316, 0.903847],
  orc_berserker: [-0.437784, 0.002, -0.453897, 0.991211, 1.966316, 1.003561],
  orc_warlord: [-0.449815, 0.002, -0.453897, 0.948825, 1.966316, 0.999641],
  gnoll_hunter: [-0.450548, 0.002, -0.811069, 0.864918, 1.796064, 1.378549],
  gnoll_brute: [-0.566822, 0.002, -0.595868, 0.981192, 1.796064, 1.078706],
  gnoll_chieftain: [-0.421955, 0.002, -0.396683, 0.836325, 1.796064, 0.87952],
  lizardman_scout: [-0.372655, 0.002, -0.909, 0.69932, 1.734628, 1.515027],
  lizardman_guard: [-0.333649, 0.002, -0.909, 0.802464, 1.734628, 1.470446],
  lizardman_shaman: [-0.344195, 0.002, -1.162961, 0.917055, 1.738904, 1.896518],
  skeleton_soldier: [-0.872977, 0.003274, -0.38727, 1.229458, 1.595942, 0.835135],
  skeleton_archer: [-0.457728, 0.003274, -0.38727, 0.837203, 1.649144, 0.812991],
  skeleton_mage: [-0.465797, 0.003274, -0.38727, 0.85874, 1.944003, 0.812991],
  zombie: [-0.366457, 0.010608, -0.294692, 0.706815, 1.355349, 0.732274],
  plague_zombie: [-0.360696, 0.013174, -0.312365, 0.706227, 1.354252, 0.750708],
  grave_ghoul: [-0.354186, 0.001, -0.267868, 0.770518, 1.065226, 0.712601],
  wraith: [-0.329546, 0.09, -0.462466, 0.585141, 1.731475, 1.265196],
  banshee: [-0.3706, 0.09, -0.462466, 0.649938, 1.869651, 1.265196],
  revenant: [-0.350503, 0.09, -0.310453, 0.748118, 1.723984, 0.516036],
  stone_golem: [-0.701402, 0.003, -0.614629, 1.511812, 2.140015, 1.193236],
  iron_golem: [-0.723342, 0.003, -0.670835, 1.551952, 2.341389, 1.290052],
  fire_golem: [-0.75501, 0.003, -0.693356, 1.589861, 2.219845, 1.271963],
  harpy: [-0.465834, 0.002, -0.374225, 0.943939, 1.813311, 0.775834],
  cliff_harpy: [-0.465834, 0.002, -0.374225, 0.943939, 1.808541, 0.775834],
  storm_harpy: [-0.465834, 0.002, -0.380875, 0.943939, 1.89388, 0.782484],
  gargoyle: [-1.322836, 0.001, -0.735638, 2.433198, 2.375324, 1.066589],
  obsidian_gargoyle: [-1.145799, 0.001, -0.796021, 2.059469, 2.622583, 1.126972],
  ancient_gargoyle: [-1.673159, 0.00108, -0.81406, 3.1165, 2.826226, 1.171487],
  minotaur: [-0.510895, 0.002, -0.514962, 1.078798, 2.509786, 1.090392],
  labyrinth_guardian: [-0.538139, 0.002, -0.550211, 1.436629, 2.449201, 1.12605],
  elder_minotaur: [-0.579754, 0.002, -0.561645, 1.231625, 2.590493, 1.137348],
  imp: [-0.515704, 0.00066, -0.503711, 1.046599, 1.574378, 0.732477],
  horned_demon: [-0.78137, 0.001, -0.334879, 1.585756, 2.329191, 0.66583],
  abyssal_demon: [-0.875134, 0.00113, -0.748775, 1.776046, 3.158813, 1.106203],
};

const importedSources: Readonly<Record<string, RpgBestiaryEntry["source"]>> = {
  webweaver_spider: { author: 'Quaternius', license: 'CC0-1.0', generator: 'tools/rpg-bestiary/whole-insects/index.mjs' },
  marsh_wasp: { author: 'Quaternius', license: 'CC0-1.0', generator: 'tools/rpg-bestiary/whole-insects/index.mjs' },
  cave_roach: { author: 'Atmostatic; animation and textures by Danimal', license: 'CC-BY-SA-3.0', generator: 'tools/rpg-bestiary/roach-source/roach.mjs' },
  giant_rat: { author: 'CDmir and TinyWorlds', license: 'CC0-1.0', generator: 'tools/rpg-bestiary/giant-rat-source/giant-rat.mjs' },
  wild_goblin: { author: 'Danimal; body xGhostx7; knife Wind astella', license: 'CC-BY-3.0', generator: 'tools/rpg-bestiary/mocap-goblin-source/goblin.mjs' },
  troll_mauler: { author: 'piacenti', license: 'CC-BY-3.0', generator: 'tools/rpg-bestiary/troll-mauler-source/index.mjs' },
  mossback_sentinel: { author: 'Čestmír Dammer (CDmir)', license: 'CC0-1.0', generator: 'tools/rpg-bestiary/forest-monster-source/forest-monster.mjs' },
  shale_elemental: { author: 'piacenti', license: 'CC-BY-3.0', generator: 'tools/rpg-bestiary/earth-elemental-source/earth.mjs' },
  beetle_golem: { author: 'killyoverdrive; animation by Dm3d', license: 'CC-BY-SA-3.0', generator: 'tools/rpg-bestiary/beetle-golem-source/beetle.mjs' },
  lava_golem: { author: 'gavlig; replacement rock maps by Corealm', license: 'CC0-1.0 source; original project replacement maps', generator: 'tools/rpg-bestiary/lava-golem-source/lava-golem.mjs' },
  "goblin_scout": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "goblin_archer": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "goblin_shaman": {
    "author": "Quaternius; Blink staff",
    "license": "CC0-1.0 plus Blink weapon Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "orc_warrior": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gnoll_hunter": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "lizardman_scout": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "skeleton_soldier": {
    "author": "Polygon Blacksmith",
    "license": "Standard Unity Asset Store EULA; local entitlement cache",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "skeleton_archer": {
    "author": "Polygon Blacksmith",
    "license": "Standard Unity Asset Store EULA; local entitlement cache",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "skeleton_mage": {
    "author": "Polygon Blacksmith",
    "license": "Standard Unity Asset Store EULA; local entitlement cache",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "zombie": {
    "author": "Quaternius; Corealm corpse proportion, damage and clothing edits",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "plague_zombie": {
    "author": "Quaternius; Corealm corpse proportion, damage and clothing edits",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "grave_ghoul": {
    "author": "Quaternius; Corealm corpse proportion, damage and clothing edits",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "wraith": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "banshee": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "revenant": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "stone_golem": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "iron_golem": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "fire_golem": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gargoyle": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "obsidian_gargoyle": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "ancient_gargoyle": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "minotaur": {
    "author": "Quaternius; janpec",
    "license": "CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "imp": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "horned_demon": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "abyssal_demon": {
    "author": "PixeliusVita",
    "license": "Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "orc_berserker": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "orc_warlord": {
    "author": "Quaternius",
    "license": "CC0-1.0",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gnoll_brute": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "gnoll_chieftain": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "lizardman_guard": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "lizardman_shaman": {
    "author": "Quaternius; Jan Pec animal head",
    "license": "CC0-1.0 plus Animal Pack Deluxe Standard Unity Asset Store EULA",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "labyrinth_guardian": {
    "author": "Quaternius; janpec",
    "license": "CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "elder_minotaur": {
    "author": "Quaternius; janpec",
    "license": "CC0-1.0 humanoid, clothing, axe and animations; Standard Unity Asset Store EULA; project owner must confirm entitlement for animal-pack-deluxe",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "harpy": {
    "author": "Quaternius and Corealm",
    "license": "CC0-1.0 source packs; Corealm additions project-owned",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "cliff_harpy": {
    "author": "Quaternius and Corealm",
    "license": "CC0-1.0 source packs; Corealm additions project-owned",
    "generator": "tools/rpg-bestiary/build.mjs"
  },
  "storm_harpy": {
    "author": "Quaternius and Corealm",
    "license": "CC0-1.0 source packs; Corealm additions project-owned",
    "generator": "tools/rpg-bestiary/build.mjs"
  }
};

type Row = readonly [id: string, name: string, family: RpgBodyFamily, region: CreatureSpeciesDef["regionId"], tier: number, role: "skirmisher" | "fighter" | "brute" | "caster" | "guard", action: string, habitat: string];
const rows: readonly Row[] = [
  ['webweaver_spider', 'Webweaver Spider', 'spider', 'vellenwood', 5, 'skirmisher', 'fang bite', 'woodland web hollows'],
  ['marsh_wasp', 'Marsh Wasp', 'wasp', 'vellenwood', 5, 'skirmisher', 'stinger strike', 'reedbank nest margins'],
  ["goblin_scout", "Goblin Scout", "goblin", "fallowmarch", 1, "skirmisher", "dagger thrust", "hedge camps"],
  ["goblin_archer", "Goblin Archer", "goblin", "fallowmarch", 1, "skirmisher", "bow shot", "hedge camp lookouts"],
  ["goblin_shaman", "Goblin Shaman", "goblin", "fallowmarch", 5, "caster", "staff curse", "abandoned farm circles"],
  ["orc_warrior", "Orc Warrior", "orc", "vellenwood", 5, "fighter", "axe chop", "logging camp ruins"],
  ["orc_berserker", "Orc Berserker", "orc", "vellenwood", 10, "brute", "overhead cleave", "forest war camps"],
  ["orc_warlord", "Orc Warlord", "orc", "karrowmoor", 20, "guard", "heavy cleave", "fortified highland camps"],
  ["skeleton_soldier", "Skeleton Soldier", "skeleton", "vellenwood", 5, "fighter", "sword cut", "dry crypt approaches"],
  ["skeleton_archer", "Skeleton Archer", "skeleton", "vellenwood", 5, "skirmisher", "bow shot", "ruined watch posts"],
  ["skeleton_mage", "Skeleton Mage", "skeleton", "kilnhalt", 20, "caster", "staff curse", "sealed burial halls"],
  ["zombie", "Zombie", "zombie", "fallowmarch", 1, "brute", "grasp", "abandoned graveyards"],
  ["plague_zombie", "Plague Zombie", "zombie", "kilnhalt", 20, "brute", "grasp", "abandoned infirmaries"],
  ["grave_ghoul", "Grave Ghoul", "zombie", "vellenwood", 10, "skirmisher", "claw rake", "graveyard hollows"],
  ["wraith", "Wraith", "wraith", "vellenwood", 10, "caster", "spectral touch", "ruined forest shrines"],
  ["banshee", "Banshee", "wraith", "kilnhalt", 20, "caster", "lament", "buried chapel rooms"],
  ["revenant", "Revenant", "wraith", "kilnhalt", 20, "guard", "spectral cut", "sealed tomb guards"],
  ["stone_golem", "Stone Golem", "golem", "karrowmoor", 10, "guard", "hammer fist", "abandoned quarry yards"],
  ["iron_golem", "Iron Golem", "golem", "karrowmoor", 20, "guard", "hammer fist", "ruined forge yards"],
  ["fire_golem", "Fire Golem", "golem", "kilnhalt", 20, "brute", "furnace slam", "cold kiln chambers"],
  ["harpy", "Harpy", "harpy", "vellenwood", 5, "skirmisher", "wing strike", "dry forest crags"],
  ["cliff_harpy", "Cliff Harpy", "harpy", "karrowmoor", 10, "skirmisher", "wing strike", "cliff nesting shelves"],
  ["storm_harpy", "Storm Harpy", "harpy", "karrowmoor", 20, "caster", "wing strike", "exposed summit ruins"],
  ["gargoyle", "Gargoyle", "gargoyle", "karrowmoor", 10, "guard", "stone claw", "ruined gate courts"],
  ["obsidian_gargoyle", "Obsidian Gargoyle", "gargoyle", "kilnhalt", 20, "guard", "stone claw", "volcanic temple floors"],
  ["ancient_gargoyle", "Ancient Gargoyle", "gargoyle", "karrowmoor", 20, "brute", "stone claw", "forgotten monument courts"],
  ["gnoll_hunter", "Gnoll Hunter", "gnoll", "fallowmarch", 5, "skirmisher", "spear thrust", "grassland hunting camps"],
  ["gnoll_brute", "Gnoll Brute", "gnoll", "karrowmoor", 10, "brute", "club swing", "rocky hunting dens"],
  ["gnoll_chieftain", "Gnoll Chieftain", "gnoll", "karrowmoor", 20, "guard", "heavy spear thrust", "ridge hunting camps"],
  ["lizardman_scout", "Lizardman Scout", "lizardman", "vellenwood", 5, "skirmisher", "spear thrust", "dry reedbank camps"],
  ["lizardman_guard", "Lizardman Guard", "lizardman", "vellenwood", 10, "guard", "spear thrust", "marsh ruin approaches"],
  ["lizardman_shaman", "Lizardman Shaman", "lizardman", "vellenwood", 10, "caster", "staff curse", "marsh shrine clearings"],
  ["minotaur", "Minotaur", "minotaur", "karrowmoor", 10, "brute", "axe sweep", "broad ruin courts"],
  ["labyrinth_guardian", "Labyrinth Guardian", "minotaur", "karrowmoor", 20, "guard", "heavy axe sweep", "labyrinth outer courts"],
  ["elder_minotaur", "Elder Minotaur", "minotaur", "kilnhalt", 20, "brute", "overhead axe strike", "buried labyrinth halls"],
  ["imp", "Imp", "demon", "kilnhalt", 10, "skirmisher", "claw jab", "abandoned furnace niches"],
  ["horned_demon", "Horned Demon", "demon", "kilnhalt", 20, "fighter", "claw rake", "broken summoning rooms"],
  ["abyssal_demon", "Abyssal Demon", "demon", "kilnhalt", 20, "brute", "claw sweep", "deep ritual halls"],
];

function entry([id, name, bodyFamily, regionId, tier, role, action, habitat]: Row): RpgBestiaryEntry {
  const sourceId = id === 'fire_golem' ? 'lava_golem' : id;
  const bounds = nativeBounds[sourceId]!;
  const nativeSize = bounds.slice(3) as [number, number, number];
  const nativeBase = bounds.slice(0, 3) as [number, number, number];
  const nativeVisualRadius = Math.hypot(Math.max(Math.abs(bounds[0]), Math.abs(bounds[0] + bounds[3])), Math.max(Math.abs(bounds[2]), Math.abs(bounds[2] + bounds[5])));
  const brute = role === "brute", guard = role === "guard", caster = role === "caster", swift = role === "skirmisher";
  const generator = ["goblin", "orc", "gnoll", "lizardman"].includes(bodyFamily) ? "humanoids" : ["skeleton", "zombie", "wraith", "golem"].includes(bodyFamily) ? "undead" : "mythic";
  const attackSpeedMs = brute ? 3400 : guard ? 3000 : caster ? 2800 : swift ? 2000 : 2400;
  const attackStyle = action === "bow shot" ? "ranged" : action === "staff curse" || action === "lament" ? "magic" : "melee";
  const essence = { fallowmarch: "air_essence", vellenwood: "earth_essence", karrowmoor: "water_essence", kilnhalt: "fire_essence" }[regionId as "fallowmarch" | "vellenwood" | "karrowmoor" | "kilnhalt"];
  const stats: EnemyDef = {
    id: `${id}_t${tier}`, family: id, name, tier,
    attackStyle, attackRangeM: attackStyle === "melee" ? 1.8 : attackStyle === "ranged" ? 10 : 8,
    maxHealth: Math.round((8 + tier * 2.2) * (brute ? 1.4 : guard ? 1.2 : caster ? .8 : 1)),
    attackLevel: tier + (brute ? 6 : 2), defenceLevel: tier + (guard ? 4 : 0),
    accuracy: swift ? 12 : caster ? 16 : 6, armour: guard ? 45 : brute ? 16 : caster ? 3 : 10,
    magicArmour: caster ? 55 : bodyFamily === "golem" ? 5 : 15,
    maxHit: Math.max(2, Math.round(tier * .45 + (brute ? 4 : 1))), attackSpeedMs,
    aggroRadius: swift ? 10 : 7, moveSpeedMps: brute ? 1.2 : guard ? 1.3 : 1.6, walkSpeedMps: .4,
    behaviour: bodyFamily === "golem" || bodyFamily === "gargoyle" ? "territorial" : "aggressive",
    drops: [{ itemId: essence, quantity: [1, Math.max(1, Math.ceil(tier / 10))], chance: caster ? .45 : .15 }],
    marks: [Math.max(1, tier), Math.max(3, tier * 3)],
  };
  return {
    id, assetId: `creature_${sourceId}`, scale: 1, regionId, activity: "patrol", stats,
    description: `${name} inhabits ${habitat}. Uses ${action} with ${attackSpeedMs / 1000} seconds between attacks.`,
    bodyFamily, rigFamily: `corealm_${bodyFamily}`, movement: bodyFamily === "wraith" ? "hover" : (bodyFamily === 'spider' || bodyFamily === 'roach') ? 'arthropod' : bodyFamily === 'wasp' ? 'flying' : bodyFamily === 'rat' ? 'quadruped' : "biped", habitat,
    nativeSize, nativeBase, nativeVisualRadius, nativeBodyRadius: Math.max(.3, Math.max(nativeSize[0], nativeSize[2]) / 2),
    respawnMs: 30000,
    attack: { action, proposedMechanic: action === "bow shot" ? "projectile" : action === "staff curse" || action === "lament" ? "spell" : "melee", recoveryMs: Math.round(attackSpeedMs * .45) },
    source: importedSources[sourceId] ?? { author: "Corealm", license: "Original project asset", generator: `tools/rpg-bestiary/${generator}.mjs` },
    acceptance: "candidate",
  };
}

/** Staged production definitions. Lab acceptance must precede authored-world placement. */
const retainedFamilies = new Set<RpgBodyFamily>(['goblin', 'skeleton', 'zombie', 'wraith', 'golem', 'spider', 'wasp']);
// The user's whole-body art direction withdraws the unreleased hybrid/demonic
// families. Their frozen candidate catalogues remain historical evidence only.
const acceptedCompleteSources: readonly RpgBestiaryEntry[] = [
  entry(['shale_elemental','Shale Elemental','elemental','karrowmoor',10,'guard','stone punch','exposed shale beds']),
  entry(['lava_golem','Lava Golem','elemental','kilnhalt',10,'brute','two-arm stone smash','cooling volcanic chambers']),
  entry(['mossback_sentinel','Mossback Sentinel','forest_creature','vellenwood',10,'brute','root-arm strike','old woodland groves']),
  entry(['beetle_golem','Beetle Golem','golem','vellenwood',10,'guard','plated forelimb strike','mossy ruin courts']),
];
export const RPG_BESTIARY: readonly RpgBestiaryEntry[] = [...rows.filter(row => retainedFamilies.has(row[2])).map(entry), ...acceptedCompleteSources];
export const RPG_BESTIARY_BY_ID: ReadonlyMap<string, RpgBestiaryEntry> = new Map(RPG_BESTIARY.map(row => [row.id, row]));
/** Explicit lab-only candidates. Never used by active enemy or regional-pack registration. */
export const RPG_BESTIARY_STAGED: readonly RpgBestiaryEntry[] = [
  entry(['giant_rat','Giant Rat','rat','fallowmarch',3,'skirmisher','biting lunge','old granaries and creek banks']),
  entry(['wild_goblin','Wild Goblin','goblin','vellenwood',5,'skirmisher','knife slash','fern thickets and woodland ruins']),
  entry(['troll_mauler','Troll Mauler','troll','karrowmoor',12,'brute','heavy fist strike','rocky hollows and abandoned quarries']),
  entry(['cave_roach','Cave Roach','roach','karrowmoor',5,'skirmisher','mandible snap','sheltered limestone hollows']),
];
export const RPG_BESTIARY_STAGED_BY_ID: ReadonlyMap<string,RpgBestiaryEntry> = new Map(RPG_BESTIARY_STAGED.map(row=>[row.id,row]));
/** Historical explicit candidate aliases remain available after accepted content activation. */
export const RPG_BESTIARY_REVIEW_BY_ID: ReadonlyMap<string,RpgBestiaryEntry> = new Map([...RPG_BESTIARY, ...RPG_BESTIARY_STAGED].map(row=>[row.id,row]));
/** Call on demand so content registration never reads partially initialized shared tables. */
export function rpgBestiaryLevel(id: string): number | undefined {
  const row = RPG_BESTIARY_BY_ID.get(id);
  return row ? enemyCombatLevel(row.stats) : undefined;
}
