/**
 * Group all 96 packs by (species, setting recipe) and mark each group with the representative pack
 * proven for it in `test-results/regional-pack-lifecycle/`. Root reads this to build the activation
 * list one region at a time. A group with no passing representative is not accepted.
 */
import { readdir, readFile } from "node:fs/promises";
import { REGIONAL_PACKS, REGIONAL_PACK_VARIANTS } from "../game/src/content/regionalPacks.js";
import { REGIONAL_PACK_LAYOUT } from "../game/src/content/regionalPackLayout.js";
import { RPG_BESTIARY_BY_ID } from "../game/src/content/rpgBestiary.js";
import { RPG_REGIONAL_PACK_PLAN } from "../game/src/content/rpgRegionalPacks.js";

const root = "test-results/regional-pack-lifecycle";
const proven = new Map();
for (const dir of await readdir(root)) {
  const report = JSON.parse(await readFile(`${root}/${dir}/report.json`, "utf8"));
  proven.set(report.packId, report);
}
const legacy = new Map(REGIONAL_PACK_VARIANTS.map((row) => [row.id, row]));
const setting = (id) => {
  const dressing = REGIONAL_PACK_LAYOUT[id].dressing;
  return !dressing.length ? "undressed"
    : dressing.some((piece) => piece.id === "ration-cache") ? "supply-camp"
    : dressing.some((piece) => piece.id === "offering-table") ? "burial-shrine"
    : dressing.some((piece) => piece.id === "split-block") ? "stone-working"
    : dressing.some((piece) => piece.id === "stone-perch") ? "roost"
    : dressing.some((piece) => piece.id === "ritual-altar") ? "ritual-court" : "unknown";
};
const groups = new Map();
for (const pack of REGIONAL_PACKS) {
  const plan = RPG_REGIONAL_PACK_PLAN.find((row) => row.packId === pack.id);
  const species = plan.speciesId ? RPG_BESTIARY_BY_ID.get(plan.speciesId) : undefined;
  const stats = species?.stats ?? legacy.get(pack.members[0].variantId).stats;
  const key = `${pack.regionId}\u0000${plan.speciesId ?? stats.name}\u0000${setting(pack.id)}`;
  if (!groups.has(key)) groups.set(key, { regionId: pack.regionId, species: plan.speciesId ?? `${stats.name} (wildlife)`,
    family: species?.bodyFamily ?? "wildlife", setting: setting(pack.id), style: stats.attackStyle ?? "melee",
    behaviour: stats.behaviour, packs: [] });
  groups.get(key).packs.push(pack.id);
}
for (const region of ["fallowmarch", "vellenwood", "karrowmoor", "kilnhalt"]) {
  const rows = [...groups.values()].filter((group) => group.regionId === region);
  console.log(`\n### ${region[0].toUpperCase()}${region.slice(1)}\n`);
  console.log("| Species | Family | Setting | Style | Packs | Representative | Result | Individually held |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows.sort((a, b) => a.species.localeCompare(b.species) || a.setting.localeCompare(b.setting))) {
    // Prefer a pack that passed: one pocket failing does not unprove the species and setting, and
    // the failing pocket is named separately so it can be held on its own.
    const representative = row.packs.find((id) => proven.get(id)?.passed) ?? row.packs.find((id) => proven.has(id));
    const report = representative ? proven.get(representative) : null;
    const alsoFailed = row.packs.filter((id) => proven.get(id)?.passed === false);
    console.log(`| ${row.species} | ${row.family} | ${row.setting} | ${row.style} | ${row.packs.length} | ${
      representative ?? "-"} | ${report ? (report.passed ? "proven" : "FAILED") : "not exercised"} | ${
      alsoFailed.length && report?.passed ? `held: ${alsoFailed.join(", ")}` : ""} |`);
  }
  const bucket = (predicate) => rows.filter(predicate).flatMap((row) => row.packs);
  const passing = (row) => row.packs.some((id) => proven.get(id)?.passed);
  const failing = (row) => !passing(row) && row.packs.some((id) => proven.has(id));
  // A pack that failed on its own evidence is never accepted, even when a sibling with the same
  // species and setting passed. The sibling proves the combination, not that pocket.
  const selfFailed = (id) => proven.get(id)?.passed === false;
  const accepted = bucket(passing).filter((id) => !selfFailed(id));
  const failed = [...new Set([...bucket(failing), ...bucket(passing).filter(selfFailed)])];
  const untested = bucket((row) => !passing(row) && !failing(row));
  console.log(`
Accepted, species and setting both proven (${accepted.length}): ${accepted.join(", ") || "none"}`);
  console.log(`
Not exercised, no representative run (${untested.length}): ${untested.join(", ") || "none"}`);
  console.log(`
Failed, do not activate (${failed.length}): ${failed.join(", ") || "none"}`);
}
