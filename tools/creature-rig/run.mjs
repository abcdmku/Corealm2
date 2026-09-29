/**
 * Creature rig pipeline: re-rig and re-animate a Tripo-generated production creature.
 *
 *   node tools/creature-rig/run.mjs <assetId> [<assetId> ...] [--from intake|rig|assemble|review] [--out <dir>]
 *
 * --out stages work files, candidates, sheets and catalog.json under <dir> (default
 * test-results/creature-motion/rig); donor extractions and the source-rig index stay shared.
 * One asset's failure does not stop the batch; failures are listed at the end (exit code 1).
 * Starting after intake repeats the intake when its forced source or the production file changed.
 *
 * intake    production mesh -> <work>/mesh.glb (bind pose, world space) + healthy source rig, if any
 * rig       Blender: fit skeleton, bone-heat skin, retarget donor clips -> <work>/rig.json
 * assemble  -> <rig root>/models/<production path>.glb (production materials, 4 influences)
 * review    bind-pose validation (<work>/validation.json), contact sheets against production
 *           (<rig root>/sheets), joint close-ups, and the catalog.json entry
 *
 * Blender runs headless as the bpy module: CREATURE_RIG_PYTHON (default "py -3.13") with
 * CREATURE_RIG_BPY on PYTHONPATH (default D:/CorealmAgentCache/bpy-5.2).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble } from "./assemble.mjs";
import { intake, intakeStale } from "./intake.mjs";
import { paths, repo, setRigRoot } from "./paths.mjs";
import { stage } from "./stage.mjs";
import { summarise, validate } from "./validate.mjs";

const STEPS = ["intake", "rig", "assemble", "review"];
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const from = option("--from") ?? "intake";
const ids = args.filter((a, i) => !a.startsWith("--") && !["--from", "--out"].includes(args[i - 1]));
if (!ids.length || !STEPS.includes(from)) {
  console.error("usage: run.mjs <assetId> [...] [--from intake|rig|assemble|review] [--out <dir>]");
  process.exit(2);
}
if (option("--out")) setRigRoot(path.resolve(repo, option("--out")));
const python = (process.env.CREATURE_RIG_PYTHON ?? "py -3.13").split(" ");
const env = { ...process.env, PYTHONPATH: process.env.CREATURE_RIG_BPY ?? "D:/CorealmAgentCache/bpy-5.2" };

function run(command, argv, label) {
  const result = spawnSync(command, argv, { cwd: repo, env, encoding: "utf8", maxBuffer: 64 << 20 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${label} failed:\n${out.split("\n").filter((l) => !/\| INFO|^\s*$/.test(l)).slice(-30).join("\n")}`);
  return out;
}

async function runAsset(id) {
  const work = paths.work(id);
  const stale = from !== "intake" && intakeStale(id, work);
  const step = (name) => STEPS.indexOf(name) >= STEPS.indexOf(from) || (stale && name === "intake");
  if (stale) console.log(`${id}: intake is missing or stale; repeating it`);
  const t0 = Date.now();
  if (step("intake")) {
    const record = await intake(id, work);
    console.log(`${id}: intake ${record.source.kind}${record.source.file ? ` (${path.basename(record.source.file)})` : ""}`);
  }
  if (step("rig")) {
    const out = run(python[0], [...python.slice(1), path.join(paths.tool, "py/rig.py"), "--donors", paths.donors, work], "rig.py");
    console.log(`${id}: rig ${out.trim().split("\n").at(-1)}`);
  }
  let model;
  if (step("assemble")) {
    model = (await assemble(id, work)).out;
    console.log(`${id}: assembled ${path.relative(repo, model)}`);
  }
  if (step("review")) {
    const record = stage(id, work);
    model = path.join(paths.rigRoot, record.candidateFile);
    const production = path.join(paths.publicAssets, record.file);
    const report = validate(model);
    writeFileSync(path.join(work, "validation.json"), JSON.stringify({ candidate: report, production: validate(production) }, null, 1));
    console.log(summarise(report));
    for (const view of ["side", "front", "three-quarter"])
      run(process.execPath, [path.join(repo, "tools/creature-motion/contact-sheet.mjs"), model, production, "--out", path.join(paths.sheets, view), "--phases", "8", "--size", "200", "--view", view], "contact-sheet");
    mkdirSync(path.join(paths.sheets, "closeup"), { recursive: true });
    // The class picks the joints its close-ups frame (rig.json "closeup").
    const joints = JSON.parse(readFileSync(path.join(work, "rig.json"), "utf8")).closeup.join(",");
    run(python[0], [...python.slice(1), path.join(paths.tool, "py/closeup.py"), "--", model, path.join(paths.sheets, "closeup", `${id}.png`), "--clips", "Idle,Walk,Run,Attack", "--phases", "2", "--joints", joints], "closeup.py");
    console.log(`${id}: sheets in ${path.relative(repo, paths.sheets)}/{side,front,three-quarter,closeup}; catalog entry staged`);
  }
  console.log(`${id}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const failures = [];
for (const id of ids) {
  try {
    await runAsset(id);
  } catch (error) {
    console.error(`${id}: FAILED\n${String(error.stack ?? error)}`);
    const lines = String(error.message ?? error).split("\n").filter((l) => l.trim());
    failures.push([id, lines.at(-1)]);
  }
}
if (failures.length) {
  console.error(`\n${failures.length} of ${ids.length} failed:`);
  for (const [id, reason] of failures) console.error(`  ${id}: ${reason}`);
  process.exitCode = 1;
}
