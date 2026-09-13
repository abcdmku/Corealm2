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
import type { ItemId, SpellElement, SpellRung } from "../contracts.js";
import type { SpellDef } from "./index.js";
import spellData from "../../content/data/spells.json";
import runeData from "../../content/data/spellRunes.json";
import { parseCollection, stripExtras } from "./schema/core.js";
import { SpellRecordSchema, SpellRuneSchema } from "./schema/spells.js";

const spellRecords = parseCollection(SpellRecordSchema, spellData, { name: "spells" });

export const SPELLS: readonly SpellDef[] = spellRecords
  .filter((spell) => spell.catalog === "SPELLS")
  .map((spell) => stripExtras(spell, ["catalog"]));

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

export const SPELL_RUNES: readonly SpellRuneDef[] = parseCollection(SpellRuneSchema, runeData, {
  name: "spellRunes", idKey: "itemId",
});

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
 * Original balance constants retained until the balance-parameter migration.
 * The authored spell records now live in JSON. These constants no longer generate them.
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

export const ADVANCED_SPELLS: readonly SpellDef[] = spellRecords
  .filter((spell) => spell.catalog === "ADVANCED_SPELLS")
  .map((spell) => stripExtras(spell, ["catalog"]));

/** Every spell the world registers: the sixteen basics first, then the twenty invocations. */
export const ALL_SPELLS: readonly SpellDef[] = [...SPELLS, ...ADVANCED_SPELLS];

export function isAdvancedSpell(spell: Pick<SpellDef, "rank">): boolean {
  return (spell.rank ?? 0) > 0;
}
