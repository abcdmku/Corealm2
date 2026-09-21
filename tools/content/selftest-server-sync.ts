/**
 * M8's done-when, proved with no hosted server and no secrets.
 *
 * It boots a real game server on loopback with a temporary database, publishes a small deterministic
 * loot edit through `POST /admin/content/publish` exactly as devdocs does, runs the export tool's
 * real CLI entry against it, and asserts that the checkout now holds that edit and nothing else:
 * one data file changed, the change is the edit, the bytes are the canonical writer's, the content
 * still compiles. What remains unproved after this is GitHub's own plumbing — a branch, a pull
 * request, the runner — which `.github/workflows/content-selftest.yml` adds on top.
 *
 * Usage:
 *   npm run content:selftest                 export into a temporary copy of game/content/data
 *   npm run content:selftest -- --in-place   export into this checkout (CI, or a disposable clone)
 *   npm run content:selftest -- --keep       leave the temporary copy behind to look at
 *
 * It refuses to touch `game/content/` without `--in-place`, because the default has to be safe on a
 * working checkout.
 */
import "../lib/repoContent.js";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { formatContentJson } from "../../game/src/content/compiler/canonical.js";
import { compileContent, readContentSources } from "./compile.js";
import { contentRoot } from "./format.js";
import { readRepoReferencePools } from "./referencePools.js";
import { startLabServer, LAB_TABLE, type Sources } from "./labServer.js";
import { argValue, repoRoot } from "../lib/paths.js";

/** Loopback, inside the content tooling's range. */
const PORT = 4323;
/** The edit. Deterministic, valid, and its marker is unique enough to grep a pull request's patch for. */
const MARKER = "Frog starter drops (self-test)";
const QUARTZ_CHANCE = 0.05;
const EXPECTED_FILES = ["game/content/compiled/catalog.json", "game/content/data/lootTables.json"];

export interface SelftestResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  /** Repository-relative paths the export changed. The pull request's diff must be exactly these. */
  changedFiles: string[];
  /** A string that appears in the exported file and therefore in the pull request's patch. */
  marker: string;
  serverRevision: string;
  root: string;
  inPlace: boolean;
  summary: string;
}

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function fingerprint(directory: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(directory, full).split(path.sep).join("/")] = hash(await readFile(full));
  }
  return out;
}

/** Runs a repo tool the way a shell would, through the tsx CLI, with no shell in between. */
function runTool(script: string, args: string[], env: Record<string, string>): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"), path.join(repoRoot, script), ...args],
      { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, output }));
  });
}

export async function runSelftest(options: { inPlace?: boolean; keep?: boolean; root?: string } = {}): Promise<SelftestResult> {
  const checks: SelftestResult["checks"] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };

  const inPlace = options.inPlace === true;
  const temporary = inPlace ? null : options.root ?? await mkdtemp(path.join(tmpdir(), "corealm-selftest-"));
  const root = inPlace ? contentRoot : temporary!;
  if (!inPlace) await cp(path.join(contentRoot, "data"), path.join(root, "data"), { recursive: true });

  const server = await startLabServer({ port: PORT });
  let serverRevision = "";
  try {
    const token = await server.mintToken(`selftest-${randomUUID().slice(0, 8)}`, ["content:read"]);
    check("a real cat_ token was minted with content:read only", token.startsWith("cat_"), token.slice(0, 4));

    // The edit, made the way devdocs makes one.
    const published = await server.publishAsDevdocs((draft: Sources) => {
      const table = draft.lootTables.find((row: any) => row.id === LAB_TABLE);
      table.name = MARKER;
      table.rolls[0].drops.find((drop: any) => drop.itemId === "pale_quartz").chance = QUARTZ_CHANCE;
    }, "self-test loot edit");
    serverRevision = published.revision as string;
    check("the server accepted a loot edit and moved its catalog",
      published.stored === true && published.changedCollections.join() === "lootTables" && published.affected?.lootTables?.join() === LAB_TABLE,
      `revision ${serverRevision.slice(0, 12)}, changed ${published.changedCollections.join(", ")}`);

    const before = await fingerprint(root);
    const outputFile = path.join(tmpdir(), `selftest-output-${randomUUID()}.txt`);
    const summaryFile = path.join(tmpdir(), `selftest-summary-${randomUUID()}.md`);
    await writeFile(outputFile, "");
    // The tool's real command line, with the token where only the environment can carry it.
    const exported = await runTool("tools/content/export-from-server.ts",
      ["--server", `http://127.0.0.1:${server.port}/`, "--root", root, "--summary", summaryFile],
      { COREALM_CONTENT_TOKEN: token, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: "" });
    const stepOutputs = Object.fromEntries((await readFile(outputFile, "utf8")).split(/\r?\n/).filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2) as [string, string]));
    check("the export CLI succeeded", exported.code === 0, exported.output.trim().split(/\r?\n/).join(" | "));
    check("it reported changed=true and the server's revision to $GITHUB_OUTPUT",
      stepOutputs.changed === "true" && stepOutputs.revision === serverRevision && stepOutputs.collections === "lootTables",
      JSON.stringify(stepOutputs));

    const after = await fingerprint(root);
    const movedFiles = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]).sort();
    check("exactly one authored file changed, plus the compiled catalog",
      movedFiles.join() === "compiled/catalog.json,data/lootTables.json", movedFiles.join(", ") || "nothing");

    const written = await readFile(path.join(root, "data", "lootTables.json"), "utf8");
    const serverValue = (await server.sources()).lootTables;
    check("the file is byte for byte the server's collection through the canonical writer",
      written === formatContentJson(serverValue), `${written.length} bytes`);
    const table = JSON.parse(written).find((row: any) => row.id === LAB_TABLE);
    check("the diff is the edit and only the edit",
      table.name === MARKER && table.rolls[0].drops.find((drop: any) => drop.itemId === "pale_quartz").chance === QUARTZ_CHANCE,
      `${table.name}, chance ${table.rolls[0].drops.find((drop: any) => drop.itemId === "pale_quartz").chance}`);

    // `content:check` over what was written, which is what the workflows run after an export.
    const build = compileContent(await readContentSources(root), await readRepoReferencePools());
    check("the exported content compiles with no errors", build.ok,
      build.ok ? `revision ${build.revision.slice(0, 12)}` : build.diagnostics.filter(problem => problem.severity === "error").slice(0, 5).map(problem => `${problem.path}: ${problem.message}`).join(" | "));
    if (inPlace) {
      const checked = await runTool("tools/content/check.ts", [], {});
      check("npm run content:check passes on the checkout", checked.code === 0, checked.output.trim().split(/\r?\n/).slice(-1)[0] ?? "");
    }

    await rm(outputFile, { force: true });
    await rm(summaryFile, { force: true });
  } finally {
    await server.close();
    if (temporary && options.keep !== true) await rm(temporary, { recursive: true, force: true });
  }

  const ok = checks.every(entry => entry.ok);
  const lines = [`## Content sync self-test: ${ok ? "PASS" : "FAIL"}`, "",
    `A real game server on \`127.0.0.1:${PORT}\`, a real \`cat_…\` token, a loot edit published through the admin API, and the export tool's own command line.`,
    `Exported into ${inPlace ? "this checkout" : "a temporary copy of `game/content/data`"}.`, "",
    "| | Check | Detail |", "| --- | --- | --- |",
    ...checks.map(entry => `| ${entry.ok ? "PASS" : "FAIL"} | ${entry.name} | ${entry.detail.replaceAll("|", "\\|").slice(0, 200)} |`)];
  return { ok, checks, changedFiles: EXPECTED_FILES, marker: MARKER, serverRevision, root, inPlace, summary: lines.join("\n") };
}

async function main(argv: string[]): Promise<number> {
  const inPlace = argv.includes("--in-place");
  if (!inPlace && argv.includes("--root") && path.resolve(argValue(argv, "--root")!) === contentRoot) {
    console.error("Refusing to export into game/content without --in-place.");
    return 2;
  }
  const result = await runSelftest({ inPlace, keep: argv.includes("--keep"), root: inPlace ? undefined : argValue(argv, "--root") });
  for (const entry of result.checks) console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? `  (${entry.detail})` : ""}`);
  console.log(result.ok ? "\nPASS: the export tool reproduced an edit made on a live server, exactly." : "\nFAIL: see the lines above.");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `ok=${result.ok}\nmarker=${result.marker}\nchanged_files=${result.changedFiles.join(" ")}\nrevision=${result.serverRevision}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) process.exitCode = await main(process.argv.slice(2));
