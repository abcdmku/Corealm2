import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { BAKE_ENTRIES, generationRevision } from "../tools/lib/generation-revision.js";
import { repoBaseVersion } from "../tools/lib/baseVersion.js";

/** Cutting a base release is a version bump. It must not look like a content or bake change. */
describe("the base version and the baked world", () => {
  const made: string[] = [];
  afterAll(async () => { for (const directory of made) await rm(directory, { recursive: true, force: true }); });
  async function checkout(version: string, dependency = "1.0.0"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "corealm-base-version-")); made.push(root);
    const game = join(root, "game");
    await mkdir(join(game, "src"), { recursive: true }); await mkdir(join(game, "content/data"), { recursive: true }); await mkdir(join(game, "public/assets"), { recursive: true });
    for (const entry of [...BAKE_ENTRIES, "game/src/app/boot.ts"]) {
      const file = join(root, entry); await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "export const a = 1;\n");
    }
    await writeFile(join(game, "content/data/items.json"), "[]\n");
    await writeFile(join(game, "public/assets/manifest.json"), "{}\n");
    await writeFile(join(root, "package-lock.json"), JSON.stringify({ name: "corealm", version, lockfileVersion: 3,
      packages: { "": { name: "corealm", version }, "node_modules/three": { version: dependency } } }, null, 2));
    return game;
  }

  it("leaves the generation revision alone when only package.json's version moves", async () => {
    const before = await generationRevision(await checkout("0.1.0")), bumped = await generationRevision(await checkout("0.2.0"));
    expect(bumped).toBe(before);
    expect(await generationRevision(await checkout("0.1.0", "1.0.1"))).not.toBe(before);
  });

  it("reads the base version from package.json", () => {
    expect(repoBaseVersion()).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
  });
});
