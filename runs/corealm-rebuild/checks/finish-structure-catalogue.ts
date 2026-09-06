/** Bounded hardware catalogue capture. Regenerate structure-review-plan.ts before a frozen review round. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { assertGameplayHardware } from "./finish-gameplay-renderer.js";
import { structureInputHash } from "../../../tools/lib/structureReviewInputs.js";

const arg = (flag: string, fallback: string) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] ?? fallback : fallback;
const from = Number(arg("--from", "0")), limit = Number(arg("--limit", "6"));
assert(Number.isInteger(from) && from >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 8);
const planPath = "art/rebuild/candidates/finish-structures/catalogue-plan.json";
const plan = JSON.parse(await readFile(planPath, "utf8"));
const out = arg("--out", `test-results/finish-structure-catalogue/${from}/${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(out, { recursive: true });
const byKey = new Map(plan.cases.map((entry: any) => [entry.key, entry]));
const selections: any[] = plan.representativeCaseKeys.slice(from, from + limit).map((key: string) => byKey.get(key));
assert(selections.length > 0 && selections.every(Boolean));
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const requiredIds = new Set(selections.flatMap((entry: any) => entry.assetIds));
const inputs = [...plan.sources, ...plan.assets.filter((asset: any) => requiredIds.has(asset.id)).flatMap((asset: any) => [
  {path:asset.path,sha256:asset.sha256}, ...(asset.inputs ?? []),
])];
async function verifyInputs() {
  for (const input of inputs) assert.equal(structureInputHash(input), input.sha256, `Changed input ${input.path} ${input.id ?? ""}; regenerate the review plan`);
}
await verifyInputs();
const clear = installTestDeadline("Structure catalogue shard", 60_000);
const driver = new GameDriver({ url: arg("--url", "http://127.0.0.1:4175"), close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const report: any = { passed: false, visualAccepted: false, createdAt: new Date().toISOString(), planPath,
  planSha256: await hash(planPath), from, limit, inputs, supplementalSources:plan.supplementalSources, records: [] };
try {
  await driver.launch(); await driver.open(24_000, "/index.html?mode=building");
  const page = driver.page!;
  report.renderer = await assertGameplayHardware(page);
  await page.locator("#panel-feature-lab .panel__close").click();
  for (const entry of selections) {
    if (entry.fixtureSupported === false) {
      report.records.push({ ...entry, disposition: "blocked-fixture", shots: [] }); continue;
    }
    const state: any = await page.evaluate(async selection => (window as any).__featureLab.setStructure(selection), entry.selection);
    const view = state.structure; assert(view.ready && view.bounds && view.partCount > 0);
    assert.equal(view.variant, entry.variant, `${entry.key} rendered wrong variant`);
    assert.deepEqual(view.selection, entry.selection, `${entry.key} selection changed`);
    const b = view.bounds;
    const centre = [0, 1, 2].map(axis => (b.min[axis] + b.max[axis]) / 2);
    const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const shots: string[] = [];
    const front = entry.selection.kind === "prefab" ? Math.PI + 0.4 : 0.4;
    for (const [name, yaw] of [["front", front], ["rear", front + Math.PI]] as const) {
      await driver.callDebug("inspectPose", [{ x: centre[0], y: centre[1], z: centre[2],
        yaw, pitch: 0.43, distance: Math.max(9, span * 1.55), detached: true }]);
      await page.evaluate(() => (window as any).__featureLab.setPlayerVisible(false));
      await driver.wait(120);
      shots.push(await driver.screenshot(out, `${entry.key}-${name}`));
    }
    report.records.push({ ...entry, view, shots, disposition: "captured-pending-review" });
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.pageErrors, []);
  await verifyInputs(); report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await driver.close(); clear(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, from, captures: report.records.length, error: report.error, out }));
}
