import { afterEach, describe, expect, it, vi } from "vitest";
import { SKILL_IDS, type GameApi, type SemanticEntity } from "../game/src/contracts.js";
import { content, enemyCombatLevel } from "../game/src/content/index.js";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { SPELLS } from "../game/src/content/spells.js";
import { FEATURE_LAB_CATALOG, createFeatureLabEntity } from "../game/src/featureLab/catalog.js";
import { ContextMenu, setNoticeSink } from "../game/src/ui/contextMenu.js";
import { entityExamineLabel, entityLevelLabel, skillRequirementsLabel, spellElementRequirementLabel } from "../game/src/ui/displayLabels.js";
import { Tooltip } from "../game/src/ui/tooltips.js";

const TIER_TEXT = /\btiers?\b|\bT\d+\b/i;
const skills = Object.fromEntries(SKILL_IDS.map((id) => [id, { level: 1 }]));
const api = { getSkills: () => skills, getSpellbook: () => ({ equippedWeapon: null }) } as unknown as GameApi;

function entity(overrides: Partial<SemanticEntity> = {}): SemanticEntity {
  return {
    id: "target", name: "Target", archetype: "enemy", tier: 5, regionId: "fallowmarch",
    position: [0, 0, 0], state: "alive", interactions: ["inspect"], ...overrides,
  };
}

// Minimal DOM nodes let the real tooltip render its text, including content descriptions and
// requirement rows. Browser acceptance still owns positioning and visual readability.
class TextNode {
  private ownText = "";
  children: TextNode[] = [];
  className = "";
  hidden = false;
  style: Record<string, string> = {};
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(" "); }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  get childElementCount(): number { return this.children.length; }
  setAttribute(): void {}
  append(...nodes: TextNode[]): void { this.children.push(...nodes); }
  appendChild(node: TextNode): TextNode { this.children.push(node); return node; }
  replaceChildren(...nodes: TextNode[]): void { this.ownText = ""; this.children = nodes; }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, width: 100, height: 100 }; }
}

afterEach(() => {
  setNoticeSink(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("player-facing level labels", () => {
  it("shows creature combat stats and resource requirements independently of content tier", () => {
    const creature = entity({ combat: { health: 5, maxHealth: 48, level: 29, aggroRadius: 3 } });
    expect(entityLevelLabel(creature)).toBe("Level 29");
    expect(entityExamineLabel(creature)).toBe("Target — Level 29, alive.");
    expect(entityLevelLabel(entity({ requirements: { mining: 14 } }))).toBe("Mining 14");
    expect(entityLevelLabel(entity({ obstacle: { reqLevel: 17, durationMs: 500, savesMeters: 20, exitPosition: [1, 0, 0] } })))
      .toBe("Agility 17");
    expect(entityLevelLabel(entity())).toBe("");
    expect(entityExamineLabel(entity())).toBe("Target — alive.");
    expect(skillRequirementsLabel({ melee: 7, magic: 12 })).toBe("Melee 7 · Magic 12");
  });

  it("uses the same actual level in the context subtitle and the real Examine notice", () => {
    const target = entity({ combat: { health: 12, maxHealth: 12, level: 11, aggroRadius: 3 } });
    const menu = new ContextMenu({ api: { ...api, inspect: () => ({ ok: true, value: target }) } as GameApi });
    const open = vi.spyOn(menu, "open").mockImplementation(() => {});
    const notice = vi.fn();
    setNoticeSink(notice);
    menu.openForEntity(target.id, 0, 0);
    const call = open.mock.calls[0]!;
    expect(call[3]?.subtitle).toBe("Level 11 · alive");
    call[2].find((item) => item.id === "inspect")!.onSelect!();
    expect(notice).toHaveBeenCalledWith("Target — Level 11, alive.", "info");
  });

  it("labels every lab creature with the level of the entity it actually spawns", () => {
    for (const preset of FEATURE_LAB_CATALOG.targets.creature) {
      const spawned = createFeatureLabEntity(preset, { entityId: "label-check", groundPosition: [0, 0, 0], baseY: 0 });
      expect(preset.label, preset.id).toContain(`(Level ${spawned.combat!.level})`);
      expect(preset.label).not.toMatch(TIER_TEXT);
    }
    for (const slot of FEATURE_LAB_CATALOG.equipment) {
      for (const item of slot.items) expect(item.label).not.toMatch(TIER_TEXT);
    }
  });

  it("preserves the stat-derived level gap between ordinary enemies, minibosses and bosses", () => {
    const level = (id: string) => enemyCombatLevel(ENEMY_BLOCKS.find((row) => row.id === id)!);
    expect(level("galeskin_t1")).toBeGreaterThan(level("reaver_t1") + 4);
    expect(level("tempest_roc_t1")).toBeGreaterThan(level("galeskin_t1"));
    expect(level("tideworn_t10")).toBeGreaterThan(level("reaver_t10") + 4);
    expect(level("quarrykeeper_t10")).toBeGreaterThan(level("tideworn_t10") + 4);
    expect(level("cinderwake_t20")).toBeGreaterThan(level("reaver_t20") + 10);
  });

  it("derives spell headers from the first actual spell requirement, including Fire at Magic 15", () => {
    const reversed = [...SPELLS].reverse();
    expect(spellElementRequirementLabel(reversed, "wind")).toBe("Magic 1");
    expect(spellElementRequirementLabel(reversed, "earth")).toBe("Magic 5");
    expect(spellElementRequirementLabel(reversed, "water")).toBe("Magic 10");
    expect(spellElementRequirementLabel(reversed, "fire")).toBe("Magic 15");
    expect(spellElementRequirementLabel([], "fire")).toBe("");
  });

  it("renders all real item tooltips without tier text while keeping equip requirements", () => {
    vi.stubGlobal("document", { createElement: () => new TextNode() });
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720 });
    content.register({ items: ALL_ITEMS });
    const tooltip = new Tooltip(api);
    for (const item of ALL_ITEMS) {
      tooltip.show({ kind: "item", itemId: item.id }, new TextNode() as unknown as HTMLElement);
      const text = tooltip.element.textContent!;
      expect(text, item.id).not.toMatch(TIER_TEXT);
      expect(text, item.id).toContain(item.category);
      for (const requirement of skillRequirementsLabel(item.equip?.requires).split(" · ").filter(Boolean)) {
        expect(text, item.id).toContain(`Requires ${requirement}`);
      }
    }
  });
});
