/** One-shot M1 exporter. Reads the pre-migration TS snapshot, never the JSON loaders. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { ElementalSpellSchema, SpellRecordSchema, SpellRuneSchema } from "../../game/src/content/schema/spells.js";
import type { SpellDef } from "../../game/src/content/index.js";
import type { SpellRuneDef } from "../../game/src/content/spells.js";
import type { ElementalSpellDef } from "../../game/src/content/elementalSpells.js";

function applyRequested(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

export async function buildSpellExport(): Promise<{
  spells: unknown[];
  spellRunes: unknown[];
  elementalSpells: unknown[];
}> {
  const baseline = (name: string) => pathToFileURL(path.join(repoRoot, ".baseline/game/src/content", `${name}.ts`)).href;
  const spells = await import(baseline("spells")) as {
    SPELLS: readonly SpellDef[]; ADVANCED_SPELLS: readonly SpellDef[]; SPELL_RUNES: readonly SpellRuneDef[];
  };
  const elemental = await import(baseline("elementalSpells")) as { ELEMENTAL_SPELLS: readonly ElementalSpellDef[] };
  if (!Array.isArray(spells.SPELLS) || !Array.isArray(spells.ADVANCED_SPELLS) || !Array.isArray(spells.SPELL_RUNES)) {
    throw new Error("Baseline spells module does not export all spell tables");
  }
  if (!Array.isArray(elemental.ELEMENTAL_SPELLS)) throw new Error("Baseline elemental module does not export ELEMENTAL_SPELLS");
  const records = [
    ...spells.SPELLS.map((spell) => ({ ...spell, catalog: "SPELLS" })),
    ...spells.ADVANCED_SPELLS.map((spell) => ({ ...spell, catalog: "ADVANCED_SPELLS" })),
  ];
  return {
    spells: canonicalRecords(SpellRecordSchema, records, "spells"),
    spellRunes: canonicalRecords(SpellRuneSchema, spells.SPELL_RUNES, "spellRunes", "itemId"),
    elementalSpells: canonicalRecords(ElementalSpellSchema, elemental.ELEMENTAL_SPELLS, "elementalSpells"),
  };
}

export async function runSpellExport(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const apply = applyRequested(args);
  const records = await buildSpellExport();
  console.log(`Validated ${records.spells.length} spells, ${records.spellRunes.length} runes, and ${records.elementalSpells.length} elemental spells from .baseline.`);
  if (!apply) {
    console.log("Dry run: no files written. Pass --apply to replace spell JSON tables.");
    return;
  }
  const [spellsChanged, runesChanged, elementalChanged] = await Promise.all([
    writeContentJson("data/spells.json", records.spells),
    writeContentJson("data/spellRunes.json", records.spellRunes),
    writeContentJson("data/elementalSpells.json", records.elementalSpells),
  ]);
  console.log(`Applied spell export (${spellsChanged || runesChanged || elementalChanged ? "files changed" : "files already matched"}).`);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  await runSpellExport();
}
