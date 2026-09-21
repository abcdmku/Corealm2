import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { repoRoot } from "../tools/lib/paths.js";

const run = promisify(execFile);

/**
 * `content/resolvedCatalog.ts` carries no catalog of its own, so a process that reads content says
 * where the content came from: `bundledCatalog.js` for the repo's, or `installCatalog()` for a
 * server's database. These cases run in a fresh process each, because the answer is a module-level
 * decision that is final for the life of a process — this suite has already made it, in
 * `vitest.setup.ts`.
 */
async function node(script: string): Promise<{ ok: boolean; output: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "corealm-catalog-order-"));
  const file = path.join(directory, "case.mts");
  await writeFile(file, script, "utf8");
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", file], { cwd: repoRoot, timeout: 120_000 });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const importOf = (module: string): string => JSON.stringify(pathToFileURL(path.join(repoRoot, module)).href);

it("tells a process that imported content without installing a catalog what to do", async () => {
  const result = await node(`import { RESOLVED_CATALOG } from ${importOf("game/src/content/resolvedCatalog.ts")};\nconsole.log(RESOLVED_CATALOG.revision);\n`);
  expect(result.ok).toBe(false);
  expect(result.output).toContain("No content catalog is installed");
  expect(result.output).toContain("bundledCatalog.js");
});

it("runs on the build's catalog when the bundled one is imported first", async () => {
  const result = await node(`import ${importOf("game/src/content/bundledCatalog.ts")};\n`
    + `import { RESOLVED_CATALOG } from ${importOf("game/src/content/resolvedCatalog.ts")};\n`
    + `console.log("revision", RESOLVED_CATALOG.revision, RESOLVED_CATALOG.tables.items.length > 0);\n`);
  expect(result.ok).toBe(true);
  expect(result.output).toMatch(/revision \w+ true/);
});

it("keeps a catalog that was already installed, so the bundled one never overrides a server's", async () => {
  const result = await node(`import { installCatalog } from ${importOf("game/src/content/catalogInstall.ts")};\n`
    + `installCatalog({ version: 1, revision: "from-the-database", formulaRevision: "f", tables: { items: [] } });\n`
    + `await import(${importOf("game/src/content/bundledCatalog.ts")});\n`
    + `const { RESOLVED_CATALOG } = await import(${importOf("game/src/content/resolvedCatalog.ts")});\n`
    + `console.log("revision", RESOLVED_CATALOG.revision);\n`);
  expect(result.ok).toBe(true);
  expect(result.output).toContain("revision from-the-database");
});

it("still refuses an install that arrives after the content graph evaluated", async () => {
  const result = await node(`import ${importOf("game/src/content/bundledCatalog.ts")};\n`
    + `import { RESOLVED_CATALOG } from ${importOf("game/src/content/resolvedCatalog.ts")};\n`
    + `const { installCatalog } = await import(${importOf("game/src/content/catalogInstall.ts")});\n`
    + `console.log(RESOLVED_CATALOG.version);\n`
    + `installCatalog({ version: 1, revision: "too-late", formulaRevision: "f", tables: {} });\n`);
  expect(result.ok).toBe(false);
  expect(result.output).toContain("installCatalog ran after the content modules were evaluated");
});
