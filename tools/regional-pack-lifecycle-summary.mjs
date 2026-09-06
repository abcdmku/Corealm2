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
rows.sort((a, b) => order.indexOf(a.packId.split("_")[1]) - order.indexOf(b.packId.split("_")[1]) || a.packId.localeCompare(b.packId));
const STAGES = [
  ["registered", ["fixtureIsRequestedPack", "normalClock", "residentAliveAtBoot", "plainName", "computedLevelLabel", "renderedExpectedBody", "fullHealthAtBoot", "spawnBodiesSeparated"]],
  ["patrol", ["idleMovementInsideHabitat", "patrolBodiesNeverOverlap", "patrolStaysInsideHabitat"]],
  ["aggro", ["residentsInitiateOrAnswer", "residentsPursuePlayer"]],
  ["damage", ["enemyDamageLands", "enemyDamageWithinAuthoredMaxHit", "damageAtAttackContactMarker", "rangedDamageFromStandoff"]],
  ["flinch", ["residentFlinchesWhenHit"]],
  ["kill", ["attackCommandKillsResident", "killAwardsXp", "killRollsNormalCoinLoot"]],
  ["loot", ["lootPileReachable", "lootPilePickedUp", "lootPileNamesArePlain"]],
  ["return", ["survivorsReturnToHabitat"]],
  ["respawn", ["respawnOnNormalClock", "respawnAtSpawnFullHealth", "survivorsResumeRanging", "finalBodiesSeparated"]],
  ["clean", ["noGameErrors", "noPageErrors", "noConsoleErrors"]],
];
if (process.argv.includes("--matrix")) {
  console.log(`| Pack | Species | Setting | Style | ${STAGES.map(([name]) => name).join(" | ")} |`);
  console.log(`| --- | --- | --- | --- | ${STAGES.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    const cells = STAGES.map(([, names]) => {
      const values = names.map((name) => row.checks?.[name]).filter((value) => value !== undefined);
      if (values.some((value) => value === false)) return "**FAIL**";
      if (!values.length) return "-";
      return values.length === names.length ? "pass" : `pass (${values.length}/${names.length})`;
    });
    console.log(`| ${row.packId.replace("pack_", "")} | ${row.speciesId ?? "(wildlife)"} | ${row.settingKind} | ${row.attackStyle} | ${cells.join(" | ")} |`);
  }
} else {
  for (const row of rows) console.log([row.passed ? "PASS" : "FAIL", row.packId, row.speciesId ?? "(wildlife)", row.family,
    row.settingKind, row.attackStyle, row.behaviour, `${row.residents}res`, row.assetSource.startsWith("public") ? "public" : "staged"].join(" | "));
}
