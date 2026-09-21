import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NON_BAKE_CONTENT_FILES } from "../tools/lib/bake-inputs.js";
import { generationInputs } from "../tools/lib/generation-revision.js";
import { gameRoot, repoRoot } from "../tools/lib/paths.js";

function walk(directory: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(path.join(gameRoot, "src"), (file) => /\.(ts|tsx|js|mjs)$/.test(file));
const relative = (file: string): string => path.relative(repoRoot, file).replaceAll("\\", "/");

describe("content store isolation", () => {
  it("keeps dev-only meta out of the game bundle", () => {
    const offenders = sourceFiles.filter((file) => /content\/meta\b|\.meta\.json/.test(readFileSync(file, "utf8")));
    expect(offenders.map(relative)).toEqual([]);
  });

  it("keeps formula and schema modules free of JSON imports and Vite environment reads", () => {
    const pure = sourceFiles.filter((file) => /[\\/]content[\\/](schema|balance)[\\/]/.test(file));
    expect(pure.length).toBeGreaterThan(0);
    for (const file of pure) {
      const text = readFileSync(file, "utf8");
      expect(text, `${relative(file)} imports JSON`).not.toMatch(/from\s+["'][^"']+\.json["']/);
      expect(text, `${relative(file)} reads import.meta.env`).not.toMatch(/import\.meta\.env/);
    }
  });

  it("hashes shipped content data into the world revision and never the meta directory", () => {
    const inputs = generationInputs(gameRoot).map(relative);
    expect(inputs).toContain("game/public/assets/manifest.json");
    expect(inputs.some((file) => file.startsWith("game/src/content/"))).toBe(true);
    expect(inputs.filter((file) => file.startsWith("game/content/meta/"))).toEqual([]);
    // Once data files exist they must be covered; an empty directory changes nothing. The only
    // exceptions are the sources that reach no baked byte, listed and proved in bake-inputs.ts.
    const skipped = NON_BAKE_CONTENT_FILES.map((file) => `game/${file}`);
    const dataFiles = walk(path.join(gameRoot, "content", "data"), (file) => file.endsWith(".json")).map(relative);
    for (const file of dataFiles) expect(inputs.includes(file), file).toBe(!skipped.includes(file));
    expect(skipped.filter((file) => !dataFiles.includes(file))).toEqual([]);
  });
});
