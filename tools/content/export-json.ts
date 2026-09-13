import { spawnSync } from "node:child_process";
import { repoRoot } from "../lib/paths.js";

// A migration export is intentionally opt-in: rerunning it replaces authored edits with baseline data.
if (!process.argv.includes("--apply")) {
  console.log("Dry run: export people, story, spells and audio from .baseline into game/content/data. Pass --apply to replace these files.");
} else {
  for (const name of ["people", "story", "spells", "audio"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `tools/content/export-${name}.ts`], { cwd: repoRoot, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Export ${name} failed (${result.status})`);
  }
}
