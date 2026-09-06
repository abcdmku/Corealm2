/** Evidence for a root relevance decision; never changes or accepts a capture. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stableJson, structureInputHash, type StructureReviewInput } from "./lib/structureReviewInputs.js";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("Pass an immutable catalogue report.json path; regenerate the plan first.");
const plan = JSON.parse(readFileSync("art/rebuild/candidates/finish-structures/catalogue-plan.json", "utf8"));
const reportBytes = readFileSync(reportPath);
const report = JSON.parse(reportBytes.toString("utf8"));
const identity = (input: StructureReviewInput) => stableJson([input.path, input.kind ?? null, input.id ?? null]);
const captured = new Map<string, StructureReviewInput>((report.inputs ?? []).map((input: StructureReviewInput) => [identity(input), input]));
function compare(input: StructureReviewInput) {
  const old = captured.get(identity(input));
  let current: string | null = null;
  try { current = structureInputHash(input); } catch { /* Missing data is explicit, never equivalent. */ }
  return { path: input.path, kind: input.kind, id: input.id, captured: old?.sha256 ?? null,
    planned: input.sha256, current, equal: old !== undefined && old.sha256 === current && current === input.sha256 };
}
const sources = plan.sources.map(compare);
const cases = new Map<string, any>(plan.cases.map((entry: any) => [entry.key, entry]));
const rows = (report.records ?? []).map((record: any) => {
  const current = cases.get(record.key);
  if (!current) return { key: record.key, missingCurrentCase: true };
  const ids = new Set(current.assetIds);
  const assets = plan.assets.filter((asset: any) => ids.has(asset.id)).flatMap((asset: any) => [
    { path: asset.path, sha256: asset.sha256 }, ...(asset.inputs ?? []),
  ]).map(compare);
  return { key: record.key, parts: { captured: record.partsSha256, current: current.partsSha256,
    equal: record.partsSha256 === current.partsSha256 },
    selectionEqual: stableJson(record.selection) === stableJson(current.selection),
    assetIdsEqual: stableJson([...record.assetIds].sort()) === stableJson([...current.assetIds].sort()),
    usedAssetsEqual: assets.every((input: any) => input.equal), usedAssets: assets,
    changedSources: sources.filter((input: any) => !input.equal),
    unchangedSources: sources.filter((input: any) => input.equal), shots: record.shots,
  };
});
console.log(JSON.stringify({ reportPath,
  reportSha256: createHash("sha256").update(reportBytes).digest("hex"),
  createdAt: new Date().toISOString(), acceptance: "requires-explicit-root-review",
  note: "Unchanged part output and source assets do not waive changed code. Root must review every changed source for this exact case. Missing historical per-entry hashes remain missing.",
  rows }, null, 2));
