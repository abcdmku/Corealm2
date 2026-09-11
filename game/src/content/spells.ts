/**
 * The sixteen attack spells, ordered by Magic requirement.
 *
 * Every cast spends one unit of matching fuel: a charge from a matching elemental weapon first,
 * then one carried Essence when no matching charge is available. The weapon supplies cadence:
 * wands use 2200 ms and staffs use 3000 ms. `castMs` remains the 3000 ms table fallback for callers
 * that have not resolved a weapon yet.
 *
 * The entry rung follows region progression: wind at Magic 1, earth at 5, water at 10, and fire at
 * 15. Fire fuel and weapons released with the tier-20 Kilnhalt region, so every rung is castable
 * once its element's Essence is in hand.
 */
import type { ItemId, SpellElement, SpellId, SpellRung } from "../contracts.js";
import type { SpellDef, SpellRuneCost } from "./index.js";
import { ELEMENTAL_SPELLS } from "./elementalSpells.js";
import { tierForLevel } from "./xp.js";

export const SPELLS: readonly SpellDef[] = [
  // -------------------------------------------------------------------- lash, Magic 1-15
  {
    id: "voltrend",
    name: "Voltrend",
    element: "wind",
    rung: "lash",
    reqLevel: 1,
    tier: 1,
    baseMax: 3,
    divisor: 8,
    baseXp: 5,
    castMs: 3000,
    cost: { element: "wind", charges: 1 },
    description: "A compact wind charm with a pale leading edge and a rippling pressure wake.",
  },
  {
    id: "stonebrand",
    name: "Stonebrand",
    element: "earth",
    rung: "lash",
    reqLevel: 5,
    tier: 5,
    baseMax: 5,
    divisor: 7,
    baseXp: 12,
    castMs: 3000,
    cost: { element: "earth", charges: 1 },
    description: "A small green-gold charm carrying fine stone grit into a sharp magical impact.",
  },
  {
    id: "rimewash",
    name: "Rimewash",
    element: "water",
    rung: "lash",
    reqLevel: 10,
    tier: 10,
    baseMax: 8,
    divisor: 6,
    baseXp: 22,
    castMs: 3000,
    cost: { element: "water", charges: 1 },
    description: "A bright water charm that streams toward one target and breaks into fine liquid spray.",
  },
  {
    id: "emberlash",
    name: "Emberlash",
    element: "fire",
    rung: "lash",
    reqLevel: 15,
    tier: 10,
    baseMax: 9,
    divisor: 6,
    baseXp: 30,
    castMs: 3000,
    cost: { element: "fire", charges: 1 },
    description: "A small, living flame gathered at the weapon tip and released with a trail of sparks.",
  },

  // -------------------------------------------------------------------- bolt, Magic 17-35
  {
    id: "skirlbolt",
    name: "Skirlbolt",
    element: "wind",
    rung: "bolt",
    reqLevel: 17,
    tier: 10,
    baseMax: 11,
    divisor: 5.5,
    baseXp: 36,
    castMs: 3000,
    cost: { element: "wind", charges: 1 },
    description: "A stronger wind charm with a wider pressure wake and more luminous motes.",
  },
  {
    id: "sleetbolt",
    name: "Sleetbolt",
    element: "water",
    rung: "bolt",
    reqLevel: 23,
    tier: 20,
    baseMax: 13,
    divisor: 5.2,
    baseXp: 47,
    castMs: 3000,
    cost: { element: "water", charges: 1 },
    description: "A stronger water charm with a fuller flowing wake and a denser splash on contact.",
  },
  {
    id: "shalebolt",
    name: "Shalebolt",
    element: "earth",
    rung: "bolt",
    reqLevel: 29,
    tier: 20,
    baseMax: 15,
    divisor: 5.0,
    baseXp: 59,
    castMs: 3000,
    cost: { element: "earth", charges: 1 },
    description: "A stronger earth charm with a brighter mineral wake and more scattered grit.",
  },
  {
    id: "cinderbolt",
    name: "Cinderbolt",
    element: "fire",
    rung: "bolt",
    reqLevel: 35,
    tier: 30,
    baseMax: 17,
    divisor: 4.8,
    baseXp: 71,
    castMs: 3000,
    cost: { element: "fire", charges: 1 },
    description: "A stronger flame charm with a fuller burning core and a longer ember wake.",
  },

  // -------------------------------------------------------------------- burst, Magic 41-59
  {
    id: "galeburst",
    name: "Galeburst",
    element: "wind",
    rung: "burst",
    reqLevel: 41,
    tier: 40,
    baseMax: 19,
    divisor: 4.6,
    baseXp: 84,
    castMs: 3000,
    cost: { element: "wind", charges: 1 },
    description: "A broad wind charm that drives a dense, shimmering pressure wake into one target.",
  },
  {
    id: "spateburst",
    name: "Spateburst",
    element: "water",
    rung: "burst",
    reqLevel: 47,
    tier: 40,
    baseMax: 21,
    divisor: 4.4,
    baseXp: 97,
    castMs: 3000,
    cost: { element: "water", charges: 1 },
    description: "A broad water charm with rolling liquid highlights and a dense burst of spray.",
  },
  {
    id: "cragburst",
    name: "Cragburst",
    element: "earth",
    rung: "burst",
    reqLevel: 53,
    tier: 50,
    baseMax: 23,
    divisor: 4.2,
    baseXp: 111,
    castMs: 3000,
    cost: { element: "earth", charges: 1 },
    description: "A broad earth charm with a dense green-gold wake that scatters tiny fragments on contact.",
  },
  {
    id: "pyreburst",
    name: "Pyreburst",
    element: "fire",
    rung: "burst",
    reqLevel: 59,
    tier: 50,
    baseMax: 25,
    divisor: 4.0,
    baseXp: 125,
    castMs: 3000,
    cost: { element: "fire", charges: 1 },
    description: "A broad flame charm with curling fire and a dense shower of embers on contact.",
  },

  // -------------------------------------------------------------------- surge, Magic 62-70
  {
    id: "squallsurge",
    name: "Squallsurge",
    element: "wind",
    rung: "surge",
    reqLevel: 62,
    tier: 60,
    baseMax: 27,
    divisor: 3.8,
    baseXp: 133,
    castMs: 3000,
    cost: { element: "wind", charges: 1 },
    description: "The strongest wind charm: a wide luminous wake, dense motes, and one concentrated impact.",
  },
  {
    id: "tidesurge",
    name: "Tidesurge",
    element: "water",
    rung: "surge",
    reqLevel: 65,
    tier: 60,
    baseMax: 29,
    divisor: 3.6,
    baseXp: 141,
    castMs: 3000,
    cost: { element: "water", charges: 1 },
    description: "The strongest water charm: a full flowing wake and a brilliant, concentrated splash.",
  },
  {
    id: "scarpsurge",
    name: "Scarpsurge",
    element: "earth",
    rung: "surge",
    reqLevel: 68,
    tier: 60,
    baseMax: 31,
    divisor: 3.5,
    baseXp: 149,
    castMs: 3000,
    cost: { element: "earth", charges: 1 },
    description: "The strongest earth charm: a broad mineral glow and dense fragments released on impact.",
  },
  {
    id: "kilnsurge",
    name: "Kilnsurge",
    element: "fire",
    rung: "surge",
    reqLevel: 70,
    tier: 70,
    baseMax: 33,
    divisor: 3.4,
    baseXp: 155,
    castMs: 3000,
    cost: { element: "fire", charges: 1 },
    description: "The strongest flame charm: a full organic flame wake and a concentrated burst of glowing embers.",
  },
];

/** One rung's spells, weakest first. `sort` runs on the copy `filter` returns, never on `SPELLS`. */
function spellsOfRung(rung: SpellRung): readonly SpellDef[] {
  return SPELLS.filter((spell) => spell.rung === rung).sort((a, b) => a.reqLevel - b.reqLevel);
}

/**
 * The ladder grouped by rung, sorted by required level inside each group.
 *
 * The spellbook draws one section per rung and needs this every time it opens; deriving it there
 * meant a filter-and-sort over sixteen rows per repaint, against a table that cannot change after
 * boot. Built once here instead. `content.spellsOfElement()` is the same idea on the other axis,
 * and lives on the registry because its key is a value the caller picks at runtime.
 */
export const SPELLS_BY_RUNG: Readonly<Record<SpellRung, readonly SpellDef[]>> = {
  lash: spellsOfRung("lash"),
  bolt: spellsOfRung("bolt"),
  burst: spellsOfRung("burst"),
  surge: spellsOfRung("surge"),
};

/**
 * PRD 2.4 magic accuracy: attackLevel is Magic, and styleFactor is 1.15 rather than melee's 1.00.
 * Exported so `systems/combat.ts` reads the constant instead of retyping 1.15.
 */
export const MAGIC_STYLE_FACTOR = 1.15;
export const MELEE_STYLE_FACTOR = 1.00;

/**
 * Spell reach in metres, mirroring `app/config.ts` SPELL_RANGE for the generated docs.
 *
 * 15, not the PRD's 9. Raised because at nine metres a caster was in melee by the second cast, so
 * the 3.0 s cast time bought nothing. `app/config.ts` is the authority; this constant exists so
 * `content/` can state the number without importing from `app/`.
 */
export const SPELL_RANGE_M = 15.0;
export const MELEE_RANGE_M = 1.6;

// ------------------------------------------------------------------ spell runes

/**
 * The six spell runes. Essence is the primary fuel of every spell; these are the secondaries.
 *
 * One tier rune per advanced rank, so a caster stocks the rune of the invocations they actually
 * use rather than a single universal token, and one Cosmic Rune that every area invocation adds on
 * top. Rank-1 invocations strike one target and need no Cosmic Rune; ranks 2 to 5 all sweep an
 * area. The basic sixteen never touch a rune, which keeps the starter loop unchanged.
 */
export interface SpellRuneDef {
  itemId: ItemId;
  name: string;
  /** 1 to 5 for the tier runes; 0 for the Cosmic Rune. */
  tier: number;
  description: string;
}

export const SPELL_RUNES: readonly SpellRuneDef[] = [
  { itemId: "mind_rune", name: "Mind Rune", tier: 1,
    description: "A pale rune etched with a single clear eye. It steadies the caster's thought onto one mark. Spent by every rank-one invocation." },
  { itemId: "chaos_rune", name: "Chaos Rune", tier: 2,
    description: "An orange rune scored with a jagged fork. It lets a spell break loose and scatter across a line of foes. Spent by every rank-two invocation." },
  { itemId: "death_rune", name: "Death Rune", tier: 3,
    description: "A bone-white rune cut with a hollow skull. It holds a spell's shape while it gathers and closes. Spent by every rank-three invocation." },
  { itemId: "blood_rune", name: "Blood Rune", tier: 4,
    description: "A dark red rune with a drop sunk into its face. It feeds invocations heavy enough to batter the ground. Spent by every rank-four invocation." },
  { itemId: "wrath_rune", name: "Wrath Rune", tier: 5,
    description: "A black rune split through with slow red light. Spent by the four finales and by nothing smaller." },
  { itemId: "cosmic_rune", name: "Cosmic Rune", tier: 0,
    description: "A yellow rune ringed with a wheel of stars. It spreads an invocation across an area. Spent alongside the tier rune by every area invocation." },
];

export const COSMIC_RUNE_ID: ItemId = "cosmic_rune";

export function tierRune(rank: number): SpellRuneDef {
  const rune = SPELL_RUNES.find((row) => row.tier === rank);
  if (!rune) throw new Error(`No spell rune for rank ${rank}`);
  return rune;
}

export function spellRune(itemId: ItemId): SpellRuneDef | undefined {
  return SPELL_RUNES.find((row) => row.itemId === itemId);
}

// ----------------------------------------------------------- advanced invocations

/**
 * Numbers for the twenty manual invocations, keyed by rank and element.
 *
 * Elements open in the ladder's own order inside each rank (wind, earth, water, fire). Every rank
 * costs its tier rune; ranks 2 to 5 strike an area and cost a Cosmic Rune as well. Damage per cast
 * climbs a step above the basic rung a caster holds at the same level, because the cast also burns
 * a rune and, for the finales, locks the caster for six or seven seconds.
 */
const ADVANCED_ELEMENT_ORDER: readonly SpellElement[] = ["wind", "earth", "water", "fire"];

const ADVANCED_RANKS: readonly {
  rank: number; reqLevel: number; baseMax: number; divisor: number; baseXp: number; aoe: boolean;
}[] = [
  { rank: 1, reqLevel: 20, baseMax: 14, divisor: 5.0, baseXp: 40, aoe: false },
  { rank: 2, reqLevel: 32, baseMax: 18, divisor: 4.6, baseXp: 66, aoe: true },
  { rank: 3, reqLevel: 44, baseMax: 22, divisor: 4.2, baseXp: 92, aoe: true },
  { rank: 4, reqLevel: 56, baseMax: 27, divisor: 3.8, baseXp: 120, aoe: true },
  { rank: 5, reqLevel: 74, baseMax: 40, divisor: 3.2, baseXp: 170, aoe: true },
];

/** The rung whose flight profile and cast tempo an invocation of this rank borrows. */
export function rungForRank(rank: number): SpellRung {
  return rank <= 1 ? "bolt" : rank <= 3 ? "burst" : "surge";
}

export const ADVANCED_SPELLS: readonly SpellDef[] = ADVANCED_RANKS.flatMap((row) =>
  ADVANCED_ELEMENT_ORDER.map((element, offset): SpellDef => {
    const source = ELEMENTAL_SPELLS.find((spell) => spell.element === element && spell.rank === row.rank);
    if (!source) throw new Error(`No elemental spell for ${element} rank ${row.rank}`);
    const reqLevel = row.reqLevel + offset * 2;
    const runes: SpellRuneCost[] = [{ itemId: tierRune(row.rank).itemId, quantity: 1 }];
    if (row.aoe) runes.push({ itemId: COSMIC_RUNE_ID, quantity: 1 });
    return {
      id: source.id as SpellId,
      name: source.name,
      element,
      rung: rungForRank(row.rank),
      rank: row.rank,
      aoe: row.aoe,
      reqLevel,
      tier: tierForLevel(reqLevel),
      baseMax: row.baseMax + offset,
      divisor: row.divisor,
      baseXp: row.baseXp + offset * 4,
      castMs: 3000,
      cost: { element, charges: 1, runes },
      description: source.description,
    };
  }));

/** Every spell the world registers: the sixteen basics first, then the twenty invocations. */
export const ALL_SPELLS: readonly SpellDef[] = [...SPELLS, ...ADVANCED_SPELLS];

export function isAdvancedSpell(spell: Pick<SpellDef, "rank">): boolean {
  return (spell.rank ?? 0) > 0;
}
