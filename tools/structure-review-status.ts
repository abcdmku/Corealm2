/** Reconcile catalogue captures and explicit root decisions without treating screenshots as approval. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { structureInputHash } from "./lib/structureReviewInputs.js";

const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const plan = JSON.parse(readFileSync("art/rebuild/candidates/finish-structures/catalogue-plan.json", "utf8"));
const root = "test-results/finish-structure-catalogue";
function reports(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? reports(path.join(directory, entry.name)) : entry.name === "report.json" ? [path.join(directory, entry.name)] : []);
}
const currentHashes = new Map<string, string | null>();
const currentHash = (input: any) => {
  const key = JSON.stringify([input.path,input.kind,input.id]);
  if (!currentHashes.has(key)) {
    try { currentHashes.set(key,structureInputHash(input)); }
    catch { currentHashes.set(key,null); }
  }
  return currentHashes.get(key);
};
const byKey = new Map<string, any[]>();
for (const file of reports(root)) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  const decisionFile = path.join(path.dirname(file), "review.json");
  // A review file is deliberately authored separately after inspecting the actual PNGs.
  // Only the root's explicit decision can mark a capture accepted or rejected.
  const review = existsSync(decisionFile) ? JSON.parse(readFileSync(decisionFile, "utf8")) : null;
  const sourceChanges = (report.inputs ?? []).filter((input: any) => currentHash(input) !== input.sha256).map((input: any) => `${input.path}${input.id ? `#${input.kind}:${input.id}` : ""}`);
  for (const record of report.records ?? []) {
    const entry = { report: file, createdAt: report.createdAt ?? "", passed: report.passed === true,
      record, sourceChanges, decision: review?.reviewedBy === "root" && review?.reportSha256 === hash(file)
        ? review.decisions?.find((decision: any) => decision.key === record.key) : null };
    const existing = byKey.get(record.key) ?? []; existing.push(entry); byKey.set(record.key, existing);
  }
}
const cases = new Map(plan.cases.map((entry: any) => [entry.key, entry]));
const rows = plan.representativeCaseKeys.map((key: string) => {
  const expected: any = cases.get(key);
  const captures = (byKey.get(key) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const usable = captures.find(capture => capture.passed && capture.sourceChanges.length === 0
    && capture.record.partsSha256 === expected.partsSha256
    && capture.record.disposition === "captured-pending-review"
    && capture.record.shots?.length >= 2 && capture.record.shots.every((file: string) => existsSync(file)));
  const status = usable ? (["accepted", "rejected"].includes(usable.decision?.decision)
    ? usable.decision.decision : "captured-pending-review") : captures.length ? "stale-or-failed" : "uncaptured";
  return { key, status, report: usable?.report ?? captures[0]?.report ?? null,
    reason: usable?.decision?.reason ?? null, changedInputs: usable ? [] : captures[0]?.sourceChanges ?? [] };
});
const counts: Record<string, number> = {};
for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
console.log(JSON.stringify({ representatives: rows.length, counts, rows }, null, 2));
