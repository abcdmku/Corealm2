import { describe, expect, it } from "vitest";
import { publishReport, type PublishResult } from "../tools/content/publish-to-server.js";
import { RESOLVED_TABLES } from "../game/src/content/resolvedCatalog.js";
import { dialogueNode, reindexDialogue } from "../game/src/content/dialogue.js";
import { FAIRY_NPC_DIALOGUE } from "../game/src/content/fairyNpcs.js";
import { ALL_SPELLS } from "../game/src/content/spells.js";
import type { SpellDef } from "../game/src/content/index.js";
import { TOOL_SPECS } from "../game/src/agent/catalogue.js";
import { defineTool } from "../game/src/agent/toolkit.js";

describe("publish report", () => {
  it("prints tables that reshape the world as a world rebuild, not a restart", () => {
    const result: PublishResult = { serverUrl: "https://example.test/", serverName: "Test", mode: "publish", base: "b".repeat(64), sent: ["world"], report: "",
      reply: { revision: "r".repeat(64), previous: null, unchanged: false, stored: true, changedCollections: ["world"], changedTables: [], revisions: {},
        live: ["items"], onRestart: ["resources", "worldTerrain", "worldRegions"], affected: {}, problems: [] } };
    const lines = publishReport(result).split("\n");
    expect(lines).toContain("on restart: resources");
    expect(lines).toContain("world rebuild: worldTerrain, worldRegions");
  });
});

describe("server-side live follow", () => {
  it("refills the fairy dialogue export when a publish reindexes dialogue, sharing rows with dialogueNode", () => {
    const original = RESOLVED_TABLES["dialogue"] as Record<string, unknown>[];
    const fairy = original.find(row => row.catalog === "fairy")!;
    expect(fairy).toBeDefined();
    RESOLVED_TABLES["dialogue"] = original.map(row => row === fairy ? { ...row, text: "Published line." } : row);
    try {
      reindexDialogue();
      const refreshed = FAIRY_NPC_DIALOGUE.find(row => row.id === fairy.id)!;
      expect(refreshed.text).toBe("Published line.");
      expect(dialogueNode(fairy.id as string)).toBe(refreshed);
    } finally {
      RESOLVED_TABLES["dialogue"] = original;
      reindexDialogue();
    }
    expect(FAIRY_NPC_DIALOGUE.find(row => row.id === fairy.id)!.text).toBe(fairy.text);
  });

  it("lists the spells the table holds now in the agent tool schemas", () => {
    const spells = ALL_SPELLS as SpellDef[];
    const tool = defineTool(TOOL_SPECS.corealm_attack, () => null);
    const enumOf = (schema: unknown, key = "spellId") => ((schema as { properties: Record<string, { enum: unknown[]; description: string }> }).properties[key]!);
    expect(enumOf(tool.inputSchema).enum).not.toContain("published_spell");
    spells.push({ ...spells[0]!, id: "published_spell" as SpellDef["id"] });
    try {
      expect(enumOf(tool.inputSchema).enum).toContain("published_spell");
      expect(enumOf(tool.inputSchema).description).toContain("published_spell (");
      expect(enumOf(TOOL_SPECS.corealm_fight.inputSchema).enum).toContain("published_spell");
      expect(enumOf(TOOL_SPECS.corealm_spellbook.inputSchema).enum).toEqual(expect.arrayContaining(["published_spell", null]));
      expect(JSON.parse(JSON.stringify(tool.inputSchema)).properties.spellId.enum).toContain("published_spell");
    } finally {
      spells.pop();
    }
  });
});
