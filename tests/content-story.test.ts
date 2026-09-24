import { describe, expect, it } from "vitest";
import questData from "../game/content/data/quests.json";
import dialogueData from "../game/content/data/dialogue.json";
import { QUESTS, quest, questsForRegion, questsGivenBy, referencedItemIds, stageOf } from "../game/src/content/quests.js";
import { DIALOGUE_NODES, allOptionIds, dialogueNode, nodeExists, validateDialogue } from "../game/src/content/dialogue.js";
import { FAIRY_NPC_DIALOGUE } from "../game/src/content/fairyNpcs.js";
import { parseCollection, parseValue, validateCollection } from "../game/src/content/schema/core.js";
import {
  dialogueConditionSchema, dialogueEffectSchema, dialogueNodeSchema, dialogueOptionSchema, dialogueRecordSchema,
  questObjectiveRefSchema, questPredicateSchema, questSchema, questStageSchema,
} from "../game/src/content/schema/story.js";

describe("JSON quest and dialogue content", () => {
  it("loads all authored records in their original order and strips dialogue catalog metadata", () => {
    expect(QUESTS).toEqual(questData);
    expect(QUESTS).toHaveLength(9);
    expect(DIALOGUE_NODES).toEqual(dialogueData.map(({ catalog: _catalog, ...row }) => row));
    expect(parseCollection(questSchema, questData, { name: "quests" })).toEqual(questData);
    expect(parseCollection(dialogueRecordSchema, dialogueData, { name: "dialogue" })).toEqual(dialogueData);
  });

  it("keeps lookup and filtering helpers tied to the loaded records", () => {
    for (const row of QUESTS) {
      expect(quest(row.id)).toBe(row);
      expect(questsForRegion(row.regionId)).toContain(row);
      expect(questsGivenBy(row.giverNpcId)).toContain(row);
      for (const stage of row.stages) expect(stageOf(row.id, stage.index)).toBe(stage);
    }
    expect(quest("missing")).toBeUndefined();
    expect(stageOf("missing", 0)).toBeUndefined();
    expect(stageOf("cold_iron", 999)).toBeUndefined();
    expect(referencedItemIds()).toEqual([...new Set(referencedItemIds())].sort());
    expect(referencedItemIds()).toContain("cairn_garnet");
    expect(questsGivenBy("missing")).toEqual([]);
  });

  it("preserves dialogue branches, helpers, and fairy node object identity", () => {
    expect(validateDialogue()).toEqual([]);
    expect(allOptionIds()).toEqual(DIALOGUE_NODES.flatMap((row) => row.options.map((option) => option.id)));
    for (const row of DIALOGUE_NODES) {
      expect(dialogueNode(row.id)).toBe(row);
      expect(nodeExists(row.id)).toBe(true);
    }
    for (const row of FAIRY_NPC_DIALOGUE) expect(DIALOGUE_NODES.find((node) => node.id === row.id)).toBe(row);
    expect(dialogueNode("missing")).toBeUndefined();
    expect(nodeExists("missing")).toBe(false);
  });

  it("reports nested quest problems at the exact field instead of accepting arbitrary payloads", () => {
    const row = structuredClone(questData[0]!);
    Object.assign(row.stages[0]!, {
      completion: { kind: "all", of: [{ kind: "have", itemId: "grithe_ore", quantity: 0, quantitty: 5 }] },
      grants: { worldState: [{ entityId: "gate", state: 7 }] },
    });
    const { issues } = validateCollection(questSchema, [row], { name: "quests" });
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "quests[0:cold_iron].stages[0].completion.of[0].quantity",
      "quests[0:cold_iron].stages[0].completion.of[0].quantitty",
      "quests[0:cold_iron].stages[0].grants.worldState[0].state",
    ]));
    expect(() => parseCollection(questSchema, [row], { name: "quests" })).toThrow("failed validation");
  });

  it("validates conditions, effects, variants, and conditional next targets", () => {
    const row = {
      id: "test", catalog: "base", text: "Test",
      variants: [{ when: [{ kind: "skill", skill: "misspelt", level: 1, reason: "" }], text: "Variant" }],
      options: [{
        id: "test#go", text: "Continue", next: null,
        effects: [{ kind: "giveItem", itemId: "cairn_garnet", quantity: -1 }],
        nextIf: [{ when: [{ kind: "questFlag", questId: "long_cairn", flag: "known", value: "yes", reason: "" }], next: 42 }],
      }],
    };
    const { issues } = validateCollection(dialogueRecordSchema, [row], { name: "dialogue" });
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "dialogue[0:test].variants[0].when[0].skill",
      "dialogue[0:test].options[0].effects[0].quantity",
      "dialogue[0:test].options[0].nextIf[0].when[0].value",
      "dialogue[0:test].options[0].nextIf[0].next",
    ]));
    expect(() => parseValue(dialogueNodeSchema, { id: "stuck", text: "No exit", options: [] }, "node")).toThrow("options");
  });

  it("supports optional recursive predicate, condition, and effect fields without adding keys", () => {
    const predicate = { kind: "all", of: [
      { kind: "have", itemId: "orb", quantity: 1, orAwakenedAltarId: "altar" },
      { kind: "visit", locationId: "town_center" },
      { kind: "counter", counter: "attempts", atLeast: 2 },
    ] };
    expect(parseValue(questPredicateSchema, predicate, "predicate")).toEqual(predicate);
    const condition = { kind: "questFlag", questId: "cold_iron", flag: "done", reason: "" };
    expect(parseValue(dialogueConditionSchema, condition, "condition")).toEqual(condition);
    const effect = { kind: "bumpCounter", questId: "long_cairn", counter: "attempts", by: -1 };
    expect(parseValue(dialogueEffectSchema, effect, "effect")).toEqual(effect);
    const spellRef = { kind: "spell", id: "voltrend" };
    expect(parseValue(questObjectiveRefSchema, spellRef, "ref")).toEqual(spellRef);
    expect(() => parseValue(questObjectiveRefSchema, { ...spellRef, id: "unknown" }, "ref")).toThrow("ref.id");
  });

  it("rejects duplicate collection ids, invalid catalog tags, and unknown nested keys", () => {
    expect(() => parseCollection(questSchema, [questData[0], questData[0]], { name: "quests" })).toThrow("duplicate id");
    expect(() => parseCollection(dialogueRecordSchema, [{ ...dialogueData[0], catalog: "unknown" }], { name: "dialogue" })).toThrow("catalog");
    expect(() => parseValue(dialogueEffectSchema, { kind: "setFlag", questId: "cold_iron", flag: "done", typo: true }, "effect")).toThrow("effect.typo");
  });

  it("exposes editor identity and reference metadata", () => {
    expect(questSchema.fields.id.meta).toMatchObject({ identity: true, readOnly: true });
    expect(questSchema.fields.giverNpcId.meta.ref).toBe("npc");
    expect(questStageSchema.fields.index.meta).toMatchObject({ identity: true, readOnly: true });
    expect(dialogueOptionSchema.fields.id.meta.identity).toBe(true);
    expect(dialogueOptionSchema.fields.next.inner.meta.ref).toBe("dialogue");
  });
});
