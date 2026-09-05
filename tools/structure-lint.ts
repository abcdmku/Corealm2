/**
 * Command-line front end for the structure geometry lint.
 *
 * The checks themselves live in `tools/lib/structure-geometry.ts` so `tests/structure-geometry.
 * test.ts` can hold the same invariants without a second implementation of the maths.
 *
 *   npm run structure:lint
 *   npm run structure:lint -- --only "composition region_gate" --kind FLOATING
 *   npm run structure:lint -- --quiet --json test-results/structure-lint.json
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { lintStructures, structureCaseCount } from "./lib/structure-geometry.js";
import { argValue, repoRoot } from "./lib/paths.js";

const args = process.argv.slice(2);
const filter = argValue(args, "--only");
const jsonOut = argValue(args, "--json");
const kindFilter = (argValue(args, "--kind") ?? "").split(",").map((value) => value.trim()).filter(Boolean);

const caseCount = structureCaseCount(filter);
const report = lintStructures(filter)
  .map((row) => ({
    key: row.key,
    defects: row.defects.filter((defect) => kindFilter.length === 0 || kindFilter.includes(defect.kind)),
  }))
  .filter((row) => row.defects.length > 0);

const totals: Record<string, number> = {};
for (const row of report) {
  for (const defect of row.defects) totals[defect.kind] = (totals[defect.kind] ?? 0) + 1;
}

if (!args.includes("--quiet")) {
  for (const row of report) {
    process.stdout.write(`
${row.key}
`);
    for (const defect of row.defects) {
      process.stdout.write(`  ${defect.kind.padEnd(13)} ${defect.assetId}
`);
      process.stdout.write(`      tags: ${defect.tags.join(", ")}
`);
      process.stdout.write(`      ${defect.detail}
`);
    }
  }
}
process.stdout.write(`
${caseCount} cases, ${report.length} with defects, ${JSON.stringify(totals)}
`);

if (jsonOut) {
  await writeFile(
    path.resolve(repoRoot, jsonOut),
    `${JSON.stringify({ caseCount, totals, report }, null, 2)}
`,
    "utf8",
  );
}
