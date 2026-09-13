import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../tools/lib/paths.js";

const leafOutputs = {
  people: ["data/shops.json", "data/npcs.json"],
  story: ["data/quests.json", "data/dialogue.json"],
  spells: ["data/spells.json", "data/spellRunes.json", "data/elementalSpells.json"],
  audio: ["data/audio/catalog.json"],
} as const;
const allOutputs = [...new Set(Object.values(leafOutputs).flat()),
  "data/items.json", "data/recipes.json", "data/resources.json", "data/equipmentSets.json",
  "data/gatheringTiers.json", "data/craftingTiers.json", "data/campfireFuels.json"];

function fileHash(relative: string): string {
  return createHash("sha256").update(readFileSync(path.join(repoRoot, "game", "content", relative))).digest("hex");
}

function snapshot(files: readonly string[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file, fileHash(file)]));
}

function runExporter(name: string, args: readonly string[] = []) {
  const result = spawnSync(process.execPath, ["--import", "tsx", `tools/content/export-${name}.ts`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

// One-shot migration proof is available only while the untracked source snapshot is retained.
describe.skipIf(!existsSync(path.join(repoRoot, ".baseline/game/src/content/items.ts")))("content exporters", () => {
  it.each(Object.entries(leafOutputs))("runs %s as a validating dry run", (name, outputs) => {
    const before = snapshot(outputs);
    const result = runExporter(name);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Validated");
    expect(result.output).toContain("Dry run: no files written");
    expect(snapshot(outputs)).toEqual(before);
  });

  it("preflights every exporter in the umbrella dry run without changing content", () => {
    const before = snapshot(allOutputs);
    const result = runExporter("json");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Preflight passed for all 11 exporters");
    expect(result.output).toContain("Dry run: no files written");
    expect(snapshot(allOutputs)).toEqual(before);
  });

  it.each(["people", "story", "spells", "audio", "json"])('%s rejects unexpected arguments before writing', (name) => {
    const before = snapshot(allOutputs);
    const result = runExporter(name, ["--unexpected"]);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Unknown arguments: --unexpected");
    expect(snapshot(allOutputs)).toEqual(before);
  });
});
