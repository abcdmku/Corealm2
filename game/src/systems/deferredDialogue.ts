import { err, ok, type DialogueView, type Result, type SemanticEntity } from "../contracts.js";
import type { DialogueDeps, DialogueSystem } from "./dialogue.js";
import type { GameState } from "../state/store.js";
import type { InteractionContext, InteractionHandler } from "../world/interactions.js";

export type DialogueLoader = () => Promise<{
  DialogueSystem: new (deps: DialogueDeps) => Pick<DialogueSystem, "op">;
}>;

const LEAVE = "deferred-dialogue:leave";
const RETRY = "deferred-dialogue:retry";
const WATCH_INTERVAL_MS = 100;

interface PendingConversation {
  world: GameState;
  entity: SemanticEntity;
  rootId: string | undefined;
  conversation: NonNullable<GameState["dialogue"]>;
  phase: "loading" | "failed";
}

/** Keeps the dialogue table and graph walker outside the initial game import graph. */
export class DeferredDialogueSystem {
  private service: Pick<DialogueSystem, "op"> | null = null;
  private talk: InteractionHandler | null = null;
  private loading: Promise<boolean> | null = null;
  private pending: PendingConversation | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private disposed = false;
  private readonly unsubscribeStore: () => void;
  private readonly unsubscribeEvents: () => void;

  constructor(
    private readonly deps: DialogueDeps,
    private readonly loader: DialogueLoader = () => import("./dialogue.js"),
  ) {
    deps.dispatcher.registerHandler("talk", (context) => this.handleTalk(context));
    this.unsubscribeStore = deps.store.subscribe(() => this.checkPending());
    this.unsubscribeEvents = deps.events.subscribe((event) => {
      if (event.type === "player.died") this.cancelPending(true);
      else this.checkPending();
    });
  }

  op(operation: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null> {
    if (this.disposed) return err("UNAVAILABLE", "Conversations are unavailable.");
    this.checkPending();
    const request = this.pending;
    if (!request) {
      if (this.service) return this.service.op(operation, optionId);
      return operation === "state" ? ok(null) : err("NO_DIALOGUE", "No conversation is open");
    }
    if (operation === "end" || (operation === "choose" && optionId === LEAVE)) {
      this.cancelPending(true);
      return ok(null);
    }
    if (operation === "state") return ok(this.view(request.conversation));
    if (optionId === RETRY && request.phase === "failed") {
      if (this.service) {
        // A loaded implementation can still refuse a missing or currently unavailable node.
        // Keep the retry view installed until opening succeeds, just as on the first attempt.
        this.resume(request);
        const conversation = this.deps.store.get().dialogue;
        return ok(conversation ? this.view(conversation) : null);
      }
      // Revalidate the real entity, skill requirements, and range before retrying.
      const result = this.deps.dispatcher.run(request.entity.id, "talk");
      if (!result.ok) return result;
      const conversation = this.deps.store.get().dialogue;
      return ok(conversation ? this.view(conversation) : null);
    }
    return request.phase === "loading"
      ? err("BUSY", "The conversation is still loading. You can leave while you wait.")
      : err("INVALID_ARGUMENT", "Choose Retry or Leave.");
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending(true);
    this.unsubscribeStore();
    this.unsubscribeEvents();
  }

  private handleTalk(context: InteractionContext): Result<{ started: string }> {
    if (this.disposed) return err("UNAVAILABLE", "Conversations are unavailable.");
    const state = this.deps.store.get();
    if (state.player.health <= 0) return err("DEAD", "You are dead.");
    // A new conversation replaces the old one without a closed event that could close the new UI.
    this.cancelPending(false);
    if (this.service && this.talk) return this.talk(context);

    const entity = context.entity;
    const conversation: NonNullable<GameState["dialogue"]> = {
      npcId: entity.id,
      nodeId: `deferred-dialogue:${++this.sequence}`,
      speaker: entity.name,
      text: "Loading conversation...",
      options: [{ id: LEAVE, text: "Leave.", enabled: true }],
    };
    const request: PendingConversation = {
      world: state, entity, rootId: entity.npc?.dialogueRootId, conversation, phase: "loading",
    };
    this.pending = request;
    state.dialogue = conversation;
    this.deps.store.markDirty();
    this.deps.events.emit("dialogue.opened", {
      npcId: entity.id, speaker: entity.name, nodeId: conversation.nodeId, optionCount: 1,
    }, entity.id, this.deps.clock.elapsedMs);
    this.watcher = setInterval(() => this.checkPending(), WATCH_INTERVAL_MS);
    void this.ensureLoaded().then((loaded) => {
      if (loaded) this.resume(request);
      else this.showFailure(request);
    }).catch(() => this.showFailure(request));
    return ok({ started: `loading conversation with ${entity.name}` });
  }

  private ensureLoaded(): Promise<boolean> {
    if (this.service) return Promise.resolve(true);
    if (this.loading) return this.loading;
    const loading = (async (): Promise<boolean> => {
      try {
        const module = await this.loader();
        let capturedTalk: InteractionHandler | null = null;
        // DialogueSystem registers Talk in its constructor. Capture that handler on a facade so
        // it cannot replace this proxy and bypass pending-request cancellation after loading.
        const dispatcher = new Proxy(this.deps.dispatcher, {
          get(target, property) {
            if (property === "registerHandler") {
              return (...args: Parameters<typeof target.registerHandler>) => {
                if (args[0] === "talk") capturedTalk = args[1];
                else target.registerHandler(...args);
              };
            }
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const service = new module.DialogueSystem({ ...this.deps, dispatcher });
        if (!capturedTalk) throw new Error("Dialogue implementation did not register Talk");
        this.service = service;
        this.talk = capturedTalk;
        return true;
      } catch {
        return false;
      }
    })();
    this.loading = loading;
    void loading.then((loaded) => {
      if (!loaded && this.loading === loading) this.loading = null;
    });
    return loading;
  }

  private resume(request: PendingConversation): void {
    if (!this.isCurrent(request)) {
      if (this.pending === request) this.cancelPending(true);
      return;
    }
    this.stopWatcher();
    this.pending = null;
    // Dispatcher validates again using current skills, position and the live entity. The captured
    // production handler then opens the NPC's original root and performs normal quest evaluation.
    try {
      const result = this.deps.dispatcher.run(request.entity.id, "talk");
      if (result.ok) return;
    } catch {
      // Keep the same retryable conversation if the implementation cannot open its node.
    }
    if (this.deps.store.get() === request.world && request.world.dialogue === request.conversation) {
      this.pending = request;
      this.showFailure(request);
      this.watcher = setInterval(() => this.checkPending(), WATCH_INTERVAL_MS);
    }
  }

  private showFailure(request: PendingConversation): void {
    if (!this.isCurrent(request)) {
      if (this.pending === request) this.cancelPending(true);
      return;
    }
    request.phase = "failed";
    request.conversation.text = "Could not load this conversation. Try again or leave.";
    request.conversation.options = [
      { id: RETRY, text: "Retry.", enabled: true },
      { id: LEAVE, text: "Leave.", enabled: true },
    ];
    this.deps.store.markDirty();
  }

  private isCurrent(request: PendingConversation): boolean {
    const state = this.deps.store.get();
    if (this.disposed || this.pending !== request || state !== request.world
      || state.dialogue !== request.conversation || state.player.health <= 0) return false;
    const entity = this.deps.entities.get(request.entity.id);
    if (entity !== request.entity || entity.state === "dead" || !entity.interactions.includes("talk")
      || entity.npc?.dialogueRootId !== request.rootId || state.player.regionId !== entity.regionId) return false;
    const target = entity.interactionPosition ?? entity.position;
    return Math.hypot(state.player.position[0] - target[0], state.player.position[2] - target[2])
      <= this.deps.dispatcher.rangeFor("talk");
  }

  private checkPending(): void {
    if (this.pending && !this.isCurrent(this.pending)) this.cancelPending(true);
  }

  private cancelPending(announce: boolean): void {
    const request = this.pending;
    if (!request) return;
    this.pending = null;
    this.stopWatcher();
    // World replacement or another owner may already have installed a different conversation.
    if (this.deps.store.get() !== request.world || request.world.dialogue !== request.conversation) return;
    request.world.dialogue = null;
    this.deps.store.markDirty();
    if (announce) this.deps.events.emit("dialogue.closed", { npcId: request.entity.id },
      request.entity.id, this.deps.clock.elapsedMs);
  }

  private stopWatcher(): void {
    if (this.watcher !== null) clearInterval(this.watcher);
    this.watcher = null;
  }

  private view(conversation: NonNullable<GameState["dialogue"]>): DialogueView {
    return {
      npcId: conversation.npcId,
      speaker: conversation.speaker,
      text: conversation.text,
      options: conversation.options.map((option) => ({ ...option })),
    };
  }
}
