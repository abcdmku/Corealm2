/**
 * The dialogue system: a node graph walker behind `SystemHooks.dialogue`.
 *
 * Satisfies `op("state" | "choose" | "end", optionId?) => Result<DialogueView | null>` and
 * registers the `talk` interaction handler, so a human clicking an NPC and an agent calling
 * `corealm_interact(npcId, "talk")` land in the same function with the same validation behind them.
 *
 * ---------------------------------------------------------------------------------------------
 * THE READABILITY RULE, WHICH IS ALSO PRD ACCEPTANCE F4
 * ---------------------------------------------------------------------------------------------
 * A gated option stays **visible** in `DialogueView.options` with `enabled: false` and a plain-text
 * `disabledReason`. Choosing it returns `INVALID_ARGUMENT` and leaves `state.dialogue.nodeId`
 * exactly where it was. Nothing is silently missing: a player who cannot take an option can see
 * what it would cost them, and an agent gets the same sentence in the same field.
 *
 * `showIf` is the separate, narrower tool. It hides branches that are irrelevant rather than
 * unavailable - offering a quest that is already finished is noise, not a locked door - and it is
 * used sparingly for exactly that.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT OWN
 * ---------------------------------------------------------------------------------------------
 * It does not know what a quest is. Quest reads and writes go through `DialogueQuestPort`, which
 * `systems/quests.ts` implements; items and XP go through their own ports. That is what lets a
 * dialogue option hand over five fish through the same inventory rules used in ordinary play.
 */
import type { DialogueView, EntityId, ItemId, Result, SemanticEntity, SkillId } from "../contracts.js";
import { err, ok } from "../contracts.js";
import { addSkillXp, Store } from "../state/store.js";
import { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type {
  DialogueCondition, DialogueEffect, DialogueNodeDef, DialogueOptionDef,
} from "../content/dialogue.js";
import { dialogueNode } from "../content/dialogue.js";
import { dialogueRootFor, npcName } from "../content/npcs.js";
import { quest } from "../content/quests.js";
import { content } from "../content/index.js";
import { InventorySystem } from "./inventory.js";

// -------------------------------------------------------------------- ports

/** Implemented by `systems/quests.ts`. Everything dialogue needs to know about quest state. */
export interface DialogueQuestPort {
  status(questId: string): "unstarted" | "active" | "complete";
  stage(questId: string): number;
  flag(questId: string, flag: string): boolean;
  counter(questId: string, counter: string): number;
  canOffer(questId: string): boolean;
  requirementProblem(questId: string): string | undefined;
  start(questId: string): Result<unknown>;
  setFlag(questId: string, flag: string, value?: boolean): void;
  bumpCounter(questId: string, counter: string, by?: number): void;
  noteDialogueNode(npcId: EntityId, nodeId: string): void;
  /** Runs a predicate pass immediately, so a choice can advance a stage in the same call. */
  evaluateNow(): void;
}

export interface DialogueInventoryPort {
  addItem(itemId: ItemId, quantity: number): Result<number>;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
  countItem(itemId: ItemId): number;
  hasRoomFor(itemId: ItemId, quantity: number): boolean;
  addCurrency(amount: number): Result<number>;
}

export interface DialogueXpPort {
  award(skill: SkillId, amount: number): void;
}

export interface DialogueEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
}

export interface DialogueDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  entities: DialogueEntityPort;
  inventory: DialogueInventoryPort;
  xp: DialogueXpPort;
  quests: DialogueQuestPort;
  dispatcher: InteractionDispatcher;
}

// ------------------------------------------------------------------- system

export class DialogueSystem {
  constructor(private readonly deps: DialogueDeps) {
    deps.dispatcher.registerHandler("talk", (context) => this.handleTalk(context));
  }

  // -------------------------------------------------------- the `talk` verb

  private handleTalk(context: InteractionContext): Result<{ started: string }> {
    const entity = context.entity;
    const rootId = entity.npc?.dialogueRootId ?? dialogueRootFor(entity.id);
    if (!rootId) {
      return err("NO_DIALOGUE", `${entity.name} has nothing to say.`, entity.id);
    }
    const opened = this.open(entity.id, rootId);
    if (!opened.ok) return { ok: false, error: opened.error };
    return ok({ started: `talking to ${entity.name}` });
  }

  /** Opens (or re-opens) a conversation at a node. Emits `dialogue.opened`. */
  open(npcId: EntityId, nodeId: string): Result<DialogueView> {
    const node = dialogueNode(nodeId);
    if (!node) return err("NO_DIALOGUE", `No dialogue node "${nodeId}"`, npcId);

    // Note and evaluate before building the view, so an NPC never greets you with the line for a
    // stage that this very conversation has already finished.
    this.deps.quests.noteDialogueNode(npcId, node.id);
    this.deps.quests.evaluateNow();

    const view = this.buildView(npcId, node);
    this.writeState(npcId, node.id, view);
    this.deps.events.emit(
      "dialogue.opened",
      { npcId, speaker: view.speaker, nodeId: node.id, optionCount: view.options.length },
      npcId,
      this.deps.clock.elapsedMs,
    );
    this.deps.store.markDirty();
    return ok(view);
  }

  // ------------------------------------------------------- the frozen hook

  /**
   * `SystemHooks.dialogue`.
   *
   *  - `state`  : the open conversation, recomputed from the current node so option gating is
   *               never stale. `ok(null)` when nothing is open, because "no conversation" is an
   *               answer, not a failure.
   *  - `choose` : `INVALID_ARGUMENT` for a missing, unknown, hidden, or disabled option, and in
   *               every one of those cases `state.dialogue.nodeId` is untouched.
   *  - `end`    : closes and emits `dialogue.closed`.
   */
  op(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null> {
    const state = this.deps.store.get();
    const open = state.dialogue;

    if (op === "state") {
      if (!open) return ok(null);
      const node = dialogueNode(open.nodeId);
      if (!node) {
        this.closeSilently();
        return err("NO_DIALOGUE", `Dialogue node "${open.nodeId}" no longer exists`);
      }
      const view = this.buildView(open.npcId, node);
      this.writeState(open.npcId, node.id, view);
      return ok(view);
    }

    if (!open) return err("NO_DIALOGUE", "No conversation is open");

    if (op === "end") {
      this.close(open.npcId);
      return ok(null);
    }

    // op === "choose"
    if (!optionId) return err("INVALID_ARGUMENT", "dialogue('choose') needs an optionId");

    const node = dialogueNode(open.nodeId);
    if (!node) {
      this.closeSilently();
      return err("NO_DIALOGUE", `Dialogue node "${open.nodeId}" no longer exists`);
    }

    const visible = node.options.filter((option) => this.allHold(option.showIf));
    const option = visible.find((row) => row.id === optionId);
    if (!option) {
      return err(
        "INVALID_ARGUMENT",
        `"${optionId}" is not an option here. Available: ${visible.map((row) => row.id).join(", ")}`,
        open.npcId,
      );
    }

    const blocked = this.firstFailure(option.requires);
    if (blocked) {
      // The node does not move. PRD F4 asserts exactly this.
      return err("INVALID_ARGUMENT", blocked, open.npcId);
    }

    const npcId = open.npcId;
    const ready = this.preflightEffects(option.effects);
    if (!ready.ok) return ready;
    const applied = this.applyEffects(option.effects);
    if (!applied.ok) return applied;

    const nextId = this.resolveNext(option);
    if (nextId === null) {
      this.deps.quests.evaluateNow();
      this.close(npcId);
      return ok(null);
    }

    const nextNode = dialogueNode(nextId);
    if (!nextNode) {
      this.closeSilently();
      return err("NO_DIALOGUE", `Dialogue node "${nextId}" does not exist`, npcId);
    }

    // Arriving at the node is what satisfies a quest's `talk` predicate, and evaluating right here
    // means the stage has already advanced by the time the new node's text is chosen - so an NPC
    // never greets you with the line for a stage you just finished.
    this.deps.quests.noteDialogueNode(npcId, nextNode.id);
    this.deps.quests.evaluateNow();

    const view = this.buildView(npcId, nextNode);
    this.writeState(npcId, nextNode.id, view);
    this.deps.store.markDirty();
    return ok(view);
  }

  // ------------------------------------------------------------------ views

  private buildView(npcId: EntityId, node: DialogueNodeDef): DialogueView {
    const speaker = node.speaker
      ?? npcName(npcId)
      ?? this.deps.entities.get(npcId)?.name
      ?? npcId;

    let text = node.text;
    for (const variant of node.variants ?? []) {
      if (this.allHold(variant.when)) {
        text = variant.text;
        break;
      }
    }

    const options: DialogueView["options"] = [];
    for (const option of node.options) {
      if (!this.allHold(option.showIf)) continue;
      const reason = this.firstFailure(option.requires);
      options.push(
        reason
          ? { id: option.id, text: option.text, enabled: false, disabledReason: reason }
          : { id: option.id, text: option.text, enabled: true },
      );
    }

    return { npcId, speaker, text, options };
  }

  private writeState(npcId: EntityId, nodeId: string, view: DialogueView): void {
    this.deps.store.get().dialogue = {
      npcId,
      nodeId,
      text: view.text,
      speaker: view.speaker,
      options: view.options.map((option) => (
        option.disabledReason === undefined
          ? { id: option.id, text: option.text, enabled: option.enabled }
          : {
              id: option.id,
              text: option.text,
              enabled: option.enabled,
              disabledReason: option.disabledReason,
            }
      )),
    };
  }

  private close(npcId: EntityId): void {
    this.deps.store.get().dialogue = null;
    this.deps.events.emit("dialogue.closed", { npcId }, npcId, this.deps.clock.elapsedMs);
    this.deps.store.markDirty();
  }

  /** Used when the content behind an open conversation has vanished. No event; nothing happened. */
  private closeSilently(): void {
    this.deps.store.get().dialogue = null;
    this.deps.store.markDirty();
  }

  // ------------------------------------------------------------- conditions

  private allHold(conditions: DialogueCondition[] | undefined): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((condition) => this.holds(condition));
  }

  /** The first failing condition's reason, or undefined when every one holds. */
  private firstFailure(conditions: DialogueCondition[] | undefined): string | undefined {
    if (!conditions) return undefined;
    for (const condition of conditions) {
      if (!this.holds(condition)) return this.reasonFor(condition);
    }
    return undefined;
  }

  private holds(condition: DialogueCondition): boolean {
    const quests = this.deps.quests;
    switch (condition.kind) {
      case "questStatus":
        return quests.status(condition.questId) === condition.status;

      case "questStage": {
        const stage = quests.stage(condition.questId);
        if (condition.min !== undefined && stage < condition.min) return false;
        if (condition.max !== undefined && stage > condition.max) return false;
        return true;
      }

      case "questFlag":
        return quests.flag(condition.questId, condition.flag) === (condition.value ?? true);

      case "questCounter": {
        const value = quests.counter(condition.questId, condition.counter);
        if (condition.min !== undefined && value < condition.min) return false;
        if (condition.max !== undefined && value > condition.max) return false;
        return true;
      }

      case "questOffer":
        return quests.canOffer(condition.questId);

      case "skill":
        return this.deps.store.get().skills[condition.skill].level >= condition.level;

      case "item":
        return this.deps.inventory.countItem(condition.itemId) >= condition.quantity;

      case "lacksItem":
        return this.deps.inventory.countItem(condition.itemId) < condition.quantity;

      case "currency":
        return this.deps.store.get().currency >= condition.amount;

      default:
        return false;
    }
  }

  /**
   * The plain-text reason a gated option shows.
   *
   * Authored `reason` strings win, because the writer knows why the door is shut. The generated
   * fallbacks exist so an option can never be disabled with an empty explanation, which is the
   * failure mode the readability rule is actually guarding against.
   */
  private reasonFor(condition: DialogueCondition): string {
    if (condition.kind === "questOffer") {
      const problem = this.deps.quests.requirementProblem(condition.questId);
      if (problem) return problem;
    }
    if (condition.reason.length > 0) return condition.reason;

    switch (condition.kind) {
      case "questStatus":
        return `Available while "${quest(condition.questId)?.name ?? condition.questId}" is ${condition.status}.`;
      case "questStage":
        return `You are not far enough into "${quest(condition.questId)?.name ?? condition.questId}" yet.`;
      case "questFlag":
        return "Something earlier in this quest has not happened yet.";
      case "questCounter":
        return "The count on this quest does not match.";
      case "questOffer":
        return `"${quest(condition.questId)?.name ?? condition.questId}" is not available to you.`;
      case "skill":
        return `Requires ${condition.skill} level ${condition.level}.`;
      case "item":
        return `Requires ${condition.quantity} x ${condition.itemId} in your inventory.`;
      case "lacksItem":
        return `Only available while you are carrying fewer than ${condition.quantity} x ${condition.itemId}.`;
      case "currency":
        return `Requires ${condition.amount} marks.`;
      default:
        return "Not available.";
    }
  }

  // ---------------------------------------------------------------- effects

  /**
   * Item handovers are indivisible choices. Preview every move in authored order before flags,
   * finite replacement counters, quest starts or node arrival can commit. A private store and
   * event bus use the production stack rules without publishing receipts or mutating live state.
   */
  private preflightEffects(effects: DialogueEffect[] | undefined): Result<void> {
    if (!effects?.some((effect) => effect.kind === "giveItem" || effect.kind === "takeItem")) return ok(undefined);
    const previewStore = new Store();
    previewStore.replace(this.deps.store.snapshot());
    const inventory = new InventorySystem({
      store: previewStore, events: new EventBus(), now: () => this.deps.clock.elapsedMs,
    });

    for (const effect of effects) {
      if (effect.kind === "giveItem") {
        const added = inventory.addItem(effect.itemId, effect.quantity);
        if (!added.ok) return added;
        if (added.value < Math.floor(effect.quantity)) return this.incompleteGrant(effect.itemId, effect.quantity);
      } else if (effect.kind === "takeItem") {
        const removed = inventory.removeItem(effect.itemId, effect.quantity);
        if (!removed.ok) return removed;
      } else if (effect.kind === "grantCurrency") {
        const paid = inventory.addCurrency(effect.amount);
        if (!paid.ok) return paid;
      } else if (effect.kind === "grantXp") {
        addSkillXp(previewStore.get(), effect.skill, effect.amount);
      } else if (effect.kind === "startQuest") {
        // A first quest start can use slots before a later direct handover. Quest-owned grants
        // deliberately park shortfalls, so they may partially fit and must not block acceptance.
        // Active/complete or repeated starts never replay the onStart grant.
        const def = quest(effect.questId);
        if (!def) return err("NOT_FOUND", `No quest with id ${effect.questId}`);
        const state = previewStore.get();
        if ((state.quests[effect.questId]?.status ?? "unstarted") !== "unstarted") continue;
        for (const skill of Object.keys(def.requirements) as SkillId[]) {
          const needed = def.requirements[skill];
          if (needed !== undefined && state.skills[skill].level < needed) {
            return err("REQUIREMENTS_NOT_MET", `Requires ${skill} ${needed}`);
          }
        }
        for (const prerequisite of def.prerequisiteQuestIds) {
          if (state.quests[prerequisite]?.status !== "complete") {
            return err("REQUIREMENTS_NOT_MET", `Requires the quest "${quest(prerequisite)?.name ?? prerequisite}" first`);
          }
        }
        state.quests[effect.questId] = { status: "active", stage: 0, counters: {}, flags: {} };
        const grant = def.onStart;
        for (const skill of Object.keys(grant?.xp ?? {}) as SkillId[]) {
          const amount = grant?.xp?.[skill];
          if (amount !== undefined) addSkillXp(state, skill, amount);
        }
        for (const stack of grant?.takeItems ?? []) inventory.removeItem(stack.itemId, stack.quantity);
        for (const stack of grant?.items ?? []) inventory.addItem(stack.itemId, stack.quantity);
        if (grant?.currency !== undefined && grant.currency > 0) inventory.addCurrency(grant.currency);
      }
    }
    return ok(undefined);
  }

  private incompleteGrant(itemId: ItemId, quantity: number): Result<never> {
    const name = content.item(itemId)?.name ?? "the reward";
    return err("INVENTORY_FULL", `Make room for all ${Math.floor(quantity)} ${name} before choosing this reply.`);
  }

  private applyEffects(effects: DialogueEffect[] | undefined): Result<void> {
    if (!effects) return ok(undefined);
    for (const effect of effects) {
      switch (effect.kind) {
        case "startQuest": {
          const started = this.deps.quests.start(effect.questId);
          if (!started.ok) return started;
          break;
        }
        case "setFlag":
          this.deps.quests.setFlag(effect.questId, effect.flag, effect.value ?? true);
          break;
        case "bumpCounter":
          this.deps.quests.bumpCounter(effect.questId, effect.counter, effect.by ?? 1);
          break;
        case "giveItem": {
          const added = this.deps.inventory.addItem(effect.itemId, effect.quantity);
          if (!added.ok) return added;
          if (added.value < Math.floor(effect.quantity)) return this.incompleteGrant(effect.itemId, effect.quantity);
          break;
        }
        case "takeItem": {
          const removed = this.deps.inventory.removeItem(effect.itemId, effect.quantity);
          if (!removed.ok) return removed;
          break;
        }
        case "grantXp":
          this.deps.xp.award(effect.skill, effect.amount);
          break;
        case "grantCurrency": {
          const paid = this.deps.inventory.addCurrency(effect.amount);
          if (!paid.ok) return paid;
          break;
        }
        default:
          break;
      }
    }
    this.deps.store.markDirty();
    return ok(undefined);
  }

  private resolveNext(option: DialogueOptionDef): string | null {
    for (const branch of option.nextIf ?? []) {
      if (this.allHold(branch.when)) return branch.next;
    }
    return option.next;
  }
}
