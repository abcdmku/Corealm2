import { beforeAll, describe, expect, it } from "vitest";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { guideCreatures, itemDetailDoc, itemLink, itemsDoc } from "../tools/gen-docs.js";

beforeAll(() => content.register({ items: ALL_ITEMS }));

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("generated item Codex", () => {
  it("resolves item links from flat, nested, and item-detail routes", () => {
    const href = (markdown: string) => markdown.match(/\]\(([^)]+)\)/)?.[1];
    expect(new URL(href(itemLink("grithe_ore"))!, "https://docs.local/game/resources/").pathname)
      .toBe("/game/items/grithe_ore/");
    expect(new URL(href(itemLink("grithe_ore", "Copper Ore", "../../"))!, "https://docs.local/game/quests/cold_iron/").pathname)
      .toBe("/game/items/grithe_ore/");
    expect(new URL(href(itemLink("grithe_bar", "Copper Bar", "../../"))!, "https://docs.local/game/items/grithe_ore/").pathname)
      .toBe("/game/items/grithe_bar/");
  });

  it("gives every catalog item one linked, focusable gallery tile and tooltip", () => {
    const markdown = itemsDoc();
    for (const item of ALL_ITEMS) {
      expect(markdown.match(new RegExp(`data-item-id="${escaped(item.id)}"`, "g"))).toHaveLength(1);
      expect(markdown).toContain(`href="./${item.id}/"`);
      expect(markdown).toContain(`aria-label="${item.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
      expect(markdown).toContain(`aria-describedby="item-tooltip-${item.id}"`);
      expect(markdown).toContain(`src="../assets/items/${item.id}.png"`);
      expect(markdown).toContain(`id="item-tooltip-${item.id}" role="tooltip"`);
    }
  });

  it("keeps old item-name hash anchors on the gallery", () => {
    expect(itemsDoc()).toContain('id="copper-sword" data-item-id="grithe_sword"');
  });

  it("builds a useful dedicated page for every catalog item", () => {
    for (const item of ALL_ITEMS) {
      const markdown = itemDetailDoc(item);
      expect(markdown).toContain(`title: ${JSON.stringify(item.name)}`);
      expect(markdown).toContain(item.description);
      expect(markdown).toContain(`../../assets/items/${item.id}.png`);
      expect(markdown).toContain("[Back to all items](../)");
    }
  });

  it("links drops to canonical creature pages without duplicating tier suffixes", () => {
    const markdown = itemDetailDoc(ALL_ITEMS.find((item) => item.id === "grithe_ore")!);
    expect(markdown).toContain("../../creatures/goat_t1/");
    expect(markdown).toContain("../../creatures/reaver_t1/");
    expect(markdown).not.toContain("_t1_t1/");
  });

  it("only links to generated creature detail routes", () => {
    const creatureIds = new Set(guideCreatures().map((creature) => creature.id));
    for (const item of ALL_ITEMS) {
      const markdown = itemDetailDoc(item);
      for (const match of markdown.matchAll(/\.\.\/\.\.\/creatures\/([^/]+)\//g)) {
        expect(creatureIds.has(match[1]!), `${item.id} links missing creature ${match[1]}`).toBe(true);
      }
    }
  });
});
