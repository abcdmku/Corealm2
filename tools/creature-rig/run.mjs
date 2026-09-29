/**
 * Creature rig pipeline: re-rig and re-animate a Tripo-generated production creature.
 *
 *   node tools/creature-rig/run.mjs <assetId> [<assetId> ...] [--from intake|rig|assemble|review]
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
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assemble } from "./assemble.mjs";
import { intake } from "./intake.mjs";
import { paths, repo } from "./paths.mjs";
import { stage } from "./stage.mjs";
import { summarise, validate } from "./validate.mjs";

const STEPS = ["intake", "rig", "assemble", "review"];
const args = process.argv.slice(2);
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : "intake";
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--from");
if (!ids.length || !STEPS.includes(from)) {
  console.error("usage: run.mjs <assetId> [...] [--from intake|rig|assemble|review]");
  process.exit(2);
}
const python = (process.env.CREATURE_RIG_PYTHON ?? "py -3.13").split(" ");
const env = { ...process.env, PYTHONPATH: process.env.CREATURE_RIG_BPY ?? "D:/CorealmAgentCache/bpy-5.2" };

function run(command, argv, label) {
  const result = spawnSync(command, argv, { cwd: repo, env, encoding: "utf8", maxBuffer: 64 << 20 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${label} failed:\n${out.split("\n").filter((l) => !/\| INFO|^\s*$/.test(l)).slice(-30).join("\n")}`);
  return out;
}

for (const id of ids) {
  const work = paths.work(id);
  const step = (name) => STEPS.indexOf(name) >= STEPS.indexOf(from);
  const t0 = Date.now();
  if (step("intake")) {
    const record = await intake(id, work);
    console.log(`${id}: intake ${record.source.kind}${record.source.file ? ` (${path.basename(record.source.file)})` : ""}`);
  }
  if (step("rig")) {
    const out = run(python[0], [...python.slice(1), path.join(paths.tool, "py/rig.py"), work], "rig.py");
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
    const joints = ["upperarm_l", "lowerarm_l", "thigh_l", "calf_l", "spine_02"].join(",");
    run(python[0], [...python.slice(1), path.join(paths.tool, "py/closeup.py"), "--", model, path.join(paths.sheets, "closeup", `${id}.png`), "--clips", "Idle,Walk,Run,Attack", "--phases", "2", "--joints", joints], "closeup.py");
    console.log(`${id}: sheets in ${path.relative(repo, paths.sheets)}/{side,front,three-quarter,closeup}; catalog entry staged`);
  }
  console.log(`${id}: done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
