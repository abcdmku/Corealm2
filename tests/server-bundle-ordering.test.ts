import { expect, it } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { serverBundleOptions } from "../tools/server-exe/bundle.js";

const run = promisify(execFile);

/**
 * Install before import has to hold inside the single executable's bundle as well as on disk.
 *
 * The server installs the database's catalog and only then reaches the simulation through
 * `await import()`, because about 144 content modules read their tables as they are evaluated. A
 * bundler that hoisted those modules to the top of the file would run every one of them before the
 * catalog was installed, and the server would silently simulate the catalog it shipped with.
 *
 * `tests/multiplayer-catalog-boot.test.ts` proves the ordering for the checkout. This proves that
 * `serverBundleOptions` — the exact options `npm run server:build` uses — keeps it after bundling.
 */
it("keeps a dynamic import lazy when the server entry is bundled to one CommonJS file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "corealm-bundle-"));
  try {
    await writeFile(join(directory, "eager.mjs"), 'console.log("eager evaluated");\nexport const eager = 1;\n');
    await writeFile(join(directory, "content.mjs"), 'console.log("content evaluated");\nexport const tables = "from the database";\n');
    await writeFile(join(directory, "entry.mjs"),
      'import { eager } from "./eager.mjs";\n'
      + 'async function main() {\n'
      + '  console.log("catalog installed", eager);\n'
      + '  const { tables } = await import("./content.mjs");\n'
      + '  console.log("server started on", tables);\n'
      + '}\n'
      + 'void main();\n');
    const outfile = join(directory, "bundle.cjs");
    await build(serverBundleOptions(join(directory, "entry.mjs"), outfile));
    const { stdout } = await run(process.execPath, [outfile]);
    expect(stdout.split(/\r?\n/).filter(Boolean)).toEqual([
      "eager evaluated",
      "catalog installed 1",
      "content evaluated",
      "server started on from the database",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
