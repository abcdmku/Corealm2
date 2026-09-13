/** One-shot M1 exporter. Reads the pre-migration TS snapshot, never the JSON loaders. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { ElementalSpellSchema, SpellRecordSchema, SpellRuneSchema } from "../../game/src/content/schema/spells.js";
import type { SpellDef } from "../../game/src/content/index.js";
import type { SpellRuneDef } from "../../game/src/content/spells.js";
import type { ElementalSpellDef } from "../../game/src/content/elementalSpells.js";

const baseline = (name: string) => pathToFileURL(path.join(repoRoot, ".baseline/game/src/content", `${name}.ts`)).href;
const spells = await import(baseline("spells")) as {
  SPELLS: readonly SpellDef[]; ADVANCED_SPELLS: readonly SpellDef[]; SPELL_RUNES: readonly SpellRuneDef[];
};
const elemental = await import(baseline("elementalSpells")) as { ELEMENTAL_SPELLS: readonly ElementalSpellDef[] };
const records = [
  ...spells.SPELLS.map((spell) => ({ ...spell, catalog: "SPELLS" })),
  ...spells.ADVANCED_SPELLS.map((spell) => ({ ...spell, catalog: "ADVANCED_SPELLS" })),
];
await writeContentJson("data/spells.json", canonicalRecords(SpellRecordSchema, records, "spells"));
await writeContentJson("data/spellRunes.json", canonicalRecords(SpellRuneSchema, spells.SPELL_RUNES, "spellRunes", "itemId"));
await writeContentJson("data/elementalSpells.json", canonicalRecords(ElementalSpellSchema, elemental.ELEMENTAL_SPELLS, "elementalSpells"));
console.log(`Exported ${records.length} spells, ${spells.SPELL_RUNES.length} runes, ${elemental.ELEMENTAL_SPELLS.length} elemental spells from .baseline.`);
