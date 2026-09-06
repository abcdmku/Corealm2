/**
 * Collapse every `test-results/regional-pack-lifecycle/<pack>/report.json` into the pack x check
 * matrix used by `runs/corealm-rebuild/SLICE-07-REGIONAL-ENCOUNTER-LAB.md`. Reads disposable
 * evidence only; it makes no claim the reports were produced by the current tree.
 */
import { readdir, readFile } from "node:fs/promises";
const root = "test-results/regional-pack-lifecycle";
const order = ["fallowmarch", "vellenwood", "karrowmoor", "kilnhalt"];
const rows = [];
for (const dir of await readdir(root)) {
  const report = JSON.parse(await readFile(`${root}/${dir}/report.json`, "utf8"));
  rows.push(report);
}
const columns = [...new Set(rows.flatMap((row) => Object.keys(row.checks ?? {})))];
rows.sort((a, b) => order.indexOf(a.packId.split("_")[1]) - order.indexOf(b.packId.split("_")[1]) || a.packId.localeCompare(b.packId));
if (process.argv.includes("--matrix")) {
  console.log(`| Pack | Species | Setting | Style | ${columns.join(" | ")} |`);
  console.log(`| --- | --- | --- | --- | ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.packId} | ${row.speciesId ?? "(wildlife)"} | ${row.settingKind} | ${row.attackStyle} | ${
    columns.map((name) => row.checks?.[name] === true ? "pass" : row.checks?.[name] === false ? "FAIL" : "-").join(" | ")} |`);
} else {
  for (const row of rows) console.log([row.passed ? "PASS" : "FAIL", row.packId, row.speciesId ?? "(wildlife)", row.family,
    row.settingKind, row.attackStyle, row.behaviour, `${row.residents}res`, row.assetSource.startsWith("public") ? "public" : "staged"].join(" | "));
}
