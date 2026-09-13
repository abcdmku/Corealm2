import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocsLinks } from "../tools/check-docs-links.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "docs-links-"));
  fixtures.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

describe("built guide links", () => {
  it.each(["/", "/Corealm2/docs", "/Corealm2/docs/"])("resolves pages, assets and anchors under %s", (base) => {
    const prefix = base.replace(/\/$/, "");
    const dir = fixture({
      "index.html": `<a href="${prefix}/game/campfires/#fuel">Campfires</a>`,
      "game/campfires/index.html": `<h2 id="fuel">Fuel</h2>
        <a href="${prefix}/">Home</a><a href="../../">Relative home</a>
        <a href="#fuel">Fuel</a><a href="../items/?sort=name#tools">Items</a>
        <img src="${prefix}/game/assets/icon.svg"><img src="../assets/icon.svg">`,
      "game/items/index.html": '<h2 id="tools">Tools</h2>',
      "game/assets/icon.svg": "<svg/>",
    });
    expect(checkDocsLinks(dir, base)).toEqual({ pages: 3, problems: [] });
  });

  it("still rejects missing pages, assets, anchors and paths outside the mount", () => {
    const dir = fixture({
      "index.html": `<a href="/Corealm2/docs/missing/">Missing</a>
        <img src="/Corealm2/docs/missing.svg">
        <a href="/Corealm2/docs/#missing">Missing anchor</a>
        <a href="/Corealm2/docs-other/">Wrong prefix</a>
        <a href="/">Outside mount</a>`,
    });
    expect(checkDocsLinks(dir, "/Corealm2/docs").problems.map(({ reason }) => reason)).toEqual([
      "no such page", "asset is not in the build", "target page has no element with that id",
      "reference is outside the docs base path", "reference is outside the docs base path",
    ]);
  });
});
