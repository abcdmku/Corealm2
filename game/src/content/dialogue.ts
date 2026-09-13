/**
 * Every dialogue tree in Phase 1, as a node graph.
 *
 * Three rules the whole file obeys, because the UI, the agent surface and PRD acceptance F4 all
 * depend on them:
 *
 *  1. **A gated option stays visible and says why.** `requires` disables an option and shows its
 *     `reason` as plain text; it never hides it. Choosing a disabled option returns
 *     `INVALID_ARGUMENT` and does not move `nodeId`. `showIf` is the separate, narrower tool for
 *     branches that are not merely unavailable but irrelevant - offering a quest you already
 *     finished is noise, not a locked door.
 *  2. **Nothing in a line depends on seeing anything.** Every fact a player needs to act on is in
 *     the text: place names, directions in metres, and the actual reasoning for the one puzzle. An agent
 *     reading `corealm_dialogue` has exactly the information a human reading the panel has.
 *  3. **Twelve people, twelve voices.** Each tree is written against the `voice` rule on that
 *     character in `content/npcs.ts`. Read the rule before you add a line.
 *
 * Node ids referenced by a quest's `talk` predicate are load-bearing: `content/quests.ts` names
 * them, and reaching the node is what completes the stage.
 */
import type { ItemId, QuestId, SkillId } from "../contracts.js";

import dialogueData from "../../content/data/dialogue.json";
import { FAIRY_NPC_DIALOGUE } from "./fairyNpcs.js";
import { parseCollection, stripExtras } from "./schema/core.js";
import { dialogueRecordSchema } from "./schema/story.js";

// ------------------------------------------------------------------- shapes

/**
 * A test over quest state, skills, inventory or currency.
 *
 * Every arm carries its own `reason`, because a disabled option has to explain itself in one line
 * of plain English and the only place that line can honestly come from is the condition that
 * failed.
 */
export type DialogueCondition =
  | { kind: "questStatus"; questId: QuestId; status: "unstarted" | "active" | "complete"; reason: string }
  | { kind: "questStage"; questId: QuestId; min?: number; max?: number; reason: string }
  | { kind: "questFlag"; questId: QuestId; flag: string; value?: boolean; reason: string }
  | { kind: "questCounter"; questId: QuestId; counter: string; min?: number; max?: number; reason: string }
  /** Unstarted, prerequisites done, and skill requirements met. */
  | { kind: "questOffer"; questId: QuestId; reason: string }
  | { kind: "skill"; skill: SkillId; level: number; reason: string }
  | { kind: "item"; itemId: ItemId; quantity: number; reason: string }
  /** Holds when the player is carrying FEWER than `quantity`. The replacement-item safety net. */
  | { kind: "lacksItem"; itemId: ItemId; quantity: number; reason: string }
  | { kind: "currency"; amount: number; reason: string };

export type DialogueEffect =
  | { kind: "startQuest"; questId: QuestId }
  | { kind: "setFlag"; questId: QuestId; flag: string; value?: boolean }
  | { kind: "bumpCounter"; questId: QuestId; counter: string; by?: number }
  | { kind: "giveItem"; itemId: ItemId; quantity: number }
  | { kind: "takeItem"; itemId: ItemId; quantity: number }
  | { kind: "grantXp"; skill: SkillId; amount: number }
  | { kind: "grantCurrency"; amount: number };

export interface DialogueOptionDef {
  /** Globally unique. `dialogue("choose", id)` takes exactly this string. */
  id: string;
  text: string;
  /** All must hold for the option to appear at all. Use sparingly; prefer `requires`. */
  showIf?: DialogueCondition[];
  /** All must hold for the option to be selectable. A failure disables it and shows the reason. */
  requires?: DialogueCondition[];
  effects?: DialogueEffect[];
  /** First matching branch wins; `next` is the fallback. */
  nextIf?: { when: DialogueCondition[]; next: string | null }[];
  /** `null` ends the conversation. */
  next: string | null;
}

export interface DialogueNodeDef {
  id: string;
  /** Defaults to the NPC's name from content/npcs.ts. */
  speaker?: string;
  text: string;
  /** First matching variant replaces `text`. Lets one node id react to quest state. */
  variants?: { when: DialogueCondition[]; text: string }[];
  options: DialogueOptionDef[];
}

/** Fairy nodes are shared with their source export, including object identity. */
export const DIALOGUE_NODES: readonly DialogueNodeDef[] = [
  ...FAIRY_NPC_DIALOGUE,
  ...parseCollection(dialogueRecordSchema, dialogueData.filter((row) => row.catalog === "base"), { name: "dialogue" })
    .map((row) => stripExtras(row, ["catalog"])),
];

const NODES_BY_ID = new Map<string, DialogueNodeDef>(DIALOGUE_NODES.map((row) => [row.id, row]));

export function dialogueNode(id: string): DialogueNodeDef | undefined {
  return NODES_BY_ID.get(id);
}

/** Every option id, for the docs index and for a uniqueness check at boot. */
export function allOptionIds(): string[] {
  const out: string[] = [];
  for (const node of DIALOGUE_NODES) for (const option of node.options) out.push(option.id);
  return out;
}

/**
 * Structural check the root can run once at boot next to `content/validate.ts`: every `next` and
 * every `nextIf` target resolves, and no option id is used twice. Returns plain strings so a
 * content bug is a console line rather than a crashed frame.
 */
export function validateDialogue(): string[] {
  const problems: string[] = [];
  const seenOptionIds = new Set<string>();
  const seenNodeIds = new Set<string>();

  for (const node of DIALOGUE_NODES) {
    if (seenNodeIds.has(node.id)) problems.push(`dialogue: duplicate node id "${node.id}"`);
    seenNodeIds.add(node.id);

    if (node.options.length === 0) {
      problems.push(`dialogue: node "${node.id}" has no options, so it cannot be left`);
    }

    for (const option of node.options) {
      if (seenOptionIds.has(option.id)) {
        problems.push(`dialogue: duplicate option id "${option.id}"`);
      }
      seenOptionIds.add(option.id);

      const targets: (string | null)[] = [option.next];
      for (const branch of option.nextIf ?? []) targets.push(branch.next);
      for (const target of targets) {
        if (target !== null && !NODES_BY_ID.has(target)) {
          problems.push(`dialogue: option "${option.id}" points at missing node "${target}"`);
        }
      }
    }
  }

  return problems;
}

/** Every entity id an NPC's tree references as a `talk` target, for the quest cross-check. */
export function nodeExists(id: string): boolean {
  return NODES_BY_ID.has(id);
}
