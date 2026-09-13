/** One-shot set migration. Dry run validates; --apply writes baseline records. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { EquipmentSetDefinition } from "../../game/src/content/equipmentSets.js";
import { EquipmentSetSchema, EquipmentSetRecordSchema, type EquipmentSetRecord } from "../../game/src/content/schema/equipmentSets.js";
import { setsBalanceSchema, type SetsBalance } from "../../game/src/content/schema/balance.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { setThresholds } from "../../game/src/content/balance/sets.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, readContentJson, writeContentJson } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

function assertEqual(expected: unknown, actual: unknown, source: string): void {
  const differences: ParityDifference[] = [];
  collectDifferences(expected, actual, source, differences);
  if (differences.length) throw new Error(`Set parity failed for ${source}:\n${differences.map(row =>
    `${row.path}: expected ${row.expected}, got ${row.actual}`).join("\n")}`);
}

/** Tags only thresholds reproduced exactly by the supplied parameters. */
export function buildSetRecords(allSets: readonly EquipmentSetDefinition[], bossSets: readonly EquipmentSetDefinition[], params: SetsBalance): EquipmentSetRecord[] {
  const all = canonicalRecords(EquipmentSetSchema, allSets, "EQUIPMENT_SETS");
  const boss = canonicalRecords(EquipmentSetSchema, bossSets, "BOSS_ARMOR_SETS");
  const allIds = new Set(all.map(row => row.id));
  if (boss.some(row => !allIds.has(row.id))) throw new Error("BOSS_ARMOR_SETS contains a set absent from EQUIPMENT_SETS");
  const bossIds = new Set(boss.map(row => row.id));
  assertEqual(boss, all.filter(row => bossIds.has(row.id)), "BOSS_ARMOR_SETS");
  const records = canonicalRecords(EquipmentSetRecordSchema, all.map(row => {
    const differences: ParityDifference[] = [];
    collectDifferences(row.thresholds, setThresholds(params, { tier: row.tier, bareheaded: !row.members.head }), row.id, differences);
    return { ...row, catalog: bossIds.has(row.id) ? "BOSS_ARMOR_SETS" : "EQUIPMENT_SETS",
      ...(differences.length === 0 ? { derivation: { kind: "setThresholds" } } : {}) };
  }), "equipmentSets");
  assertEqual(all, records.map(({ catalog: _catalog, derivation: _derivation, ...row }) => row), "EQUIPMENT_SETS");
  return records;
}

async function baselineSets(): Promise<EquipmentSetRecord[]> {
  const load = (name: string) => import(pathToFileURL(path.join(repoRoot, ".baseline", "game", "src", "content", `${name}.ts`)).href);
  const [sets, boss, rawParams] = await Promise.all([load("equipmentSets"), load("bossArmor"), readContentJson("data/balance/sets.json")]);
  return buildSetRecords(sets.EQUIPMENT_SETS, boss.BOSS_ARMOR_SETS, parseValue(setsBalanceSchema, rawParams, "balance/sets"));
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unexpected = args.filter(arg => arg !== "--apply");
  if (unexpected.length) throw new Error(`Unknown arguments: ${unexpected.join(", ")}`);
  const records = await baselineSets();
  console.log(`Validated ${records.length} baseline sets; ${records.filter(row => row.derivation).length} reproduce balance thresholds.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/equipmentSets.json", records);
    console.log(changed ? "Wrote game/content/data/equipmentSets.json" : "game/content/data/equipmentSets.json already matches");
  } else console.log("Dry run: no files written. Pass --apply to write baseline records.");
}
