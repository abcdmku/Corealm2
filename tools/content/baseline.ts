import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "../lib/paths.js";

const destination = path.join(repoRoot, ".baseline");
if (existsSync(destination)) throw new Error(".baseline already exists. Preserve it until migration parity is accepted.");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "game/src", "game/content/data", "tools"], { cwd: repoRoot, encoding: "utf8" }).trim().split(/\r?\n/);
await mkdir(destination);
for (const file of files) {
  const target = path.join(destination, file);
  if (path.relative(destination, target).startsWith("..")) throw new Error(`Invalid baseline path ${file}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, execFileSync("git", ["show", `${revision}:${file}`], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }));
}
await writeFile(path.join(destination, "revision.txt"), `${revision}\n`);
console.log(`Saved ${files.length} baseline files at ${revision}.`);
