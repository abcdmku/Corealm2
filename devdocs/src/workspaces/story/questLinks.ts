import type { ContentRow } from "../../model/contracts.js";
import type { ReferenceIndex } from "../../model/refs.js";
import { contentRows } from "../../model/rows.js";
import { asRecord, list, num, strings, text } from "./shared.js";

/*
  The dialogue that belongs to one quest stage, found by reading every node for what it does to the
  quest:

    completes    the stage's `talk` rule names this node
    offers       an option starts the quest, or is gated on the quest being offerable (stage 0)
    sets         an option sets a flag or bumps a counter the stage's rule checks
    needs        a line or option is gated on a flag this stage grants
    during       a line, option or branch is gated on a stage range that covers this stage
*/

export type DialogueRole = "completes" | "offers" | "sets" | "needs" | "during";
export interface StageDialogue { nodeId: string; roles: DialogueRole[]; detail: string[] }

const ORDER: readonly DialogueRole[] = ["completes", "offers", "sets", "needs", "during"];

/** Flags and counters a completion rule checks, and the node its talk rule ends at. */
function checks(predicate: unknown, out = { flags: new Set<string>(), counters: new Set<string>(), talk: new Set<string>() }) {
  const node = asRecord(predicate);
  switch (text(node.kind)) {
    case "all": for (const child of list(node.of)) checks(child, out); break;
    case "flag": if (text(node.flag)) out.flags.add(String(node.flag)); break;
    case "counter": if (text(node.counter)) out.counters.add(String(node.counter)); break;
    case "talk": if (text(node.dialogueNodeId)) out.talk.add(String(node.dialogueNodeId)); break;
  }
  return out;
}

/** Every condition a node carries, from its variants, options and branches. */
function conditionsOf(node: ContentRow): ContentRow[] {
  const out: ContentRow[] = [];
  for (const variant of list(node.variants).map(asRecord)) out.push(...list(variant.when).map(asRecord));
  for (const option of list(node.options).map(asRecord)) {
    out.push(...list(option.showIf).map(asRecord), ...list(option.requires).map(asRecord));
    for (const branch of list(option.nextIf).map(asRecord)) out.push(...list(branch.when).map(asRecord));
  }
  return out;
}

const effectsOf = (node: ContentRow): ContentRow[] => list(node.options).flatMap(option => list(asRecord(option).effects).map(asRecord));

export function stageDialogue(index: ReferenceIndex, questId: string, stage: ContentRow, stageIndex: number): StageDialogue[] {
  const response = index.collections.get("dialogue");
  if (!response) return [];
  const rule = checks(stage.completion);
  const granted = new Set(strings(asRecord(stage.grants).flags));
  const found = new Map<string, StageDialogue>();
  const add = (nodeId: string, role: DialogueRole, detail?: string) => {
    const entry = found.get(nodeId) ?? { nodeId, roles: [], detail: [] };
    if (!entry.roles.includes(role)) entry.roles.push(role);
    if (detail && !entry.detail.includes(detail)) entry.detail.push(detail);
    found.set(nodeId, entry);
  };

  for (const nodeId of rule.talk) add(nodeId, "completes");
  for (const node of contentRows(response)) {
    const nodeId = String(node.id);
    for (const effect of effectsOf(node)) {
      if (text(effect.questId) !== questId) continue;
      const kind = text(effect.kind);
      if (kind === "startQuest" && stageIndex === 0) add(nodeId, "offers");
      if (kind === "setFlag" && rule.flags.has(text(effect.flag) ?? "")) add(nodeId, "sets", `flag ${String(effect.flag)}`);
      if (kind === "bumpCounter" && rule.counters.has(text(effect.counter) ?? "")) add(nodeId, "sets", `counter ${String(effect.counter)}`);
    }
    for (const condition of conditionsOf(node)) {
      if (text(condition.questId) !== questId) continue;
      const kind = text(condition.kind);
      if (kind === "questOffer" && stageIndex === 0) add(nodeId, "offers");
      if (kind === "questFlag" && granted.has(text(condition.flag) ?? "")) add(nodeId, "needs", `flag ${String(condition.flag)}`);
      if (kind === "questStage") {
        const min = num(condition.min), max = num(condition.max);
        // An open range on both ends says nothing about this stage in particular.
        if ((min !== undefined || max !== undefined) && (min ?? 0) <= stageIndex && stageIndex <= (max ?? Infinity)) add(nodeId, "during", min === max ? `stage ${min}` : `stages ${min ?? 0}–${max ?? "end"}`);
      }
    }
  }
  const rank = (entry: StageDialogue) => Math.min(...entry.roles.map(role => ORDER.indexOf(role)));
  return [...found.values()].sort((a, b) => rank(a) - rank(b) || a.nodeId.localeCompare(b.nodeId));
}

export const ROLE_LABEL: Readonly<Record<DialogueRole, string>> = {
  completes: "Completes the step",
  offers: "Offers the quest",
  sets: "Advances the step",
  needs: "Needs this step",
  during: "Plays during",
};
