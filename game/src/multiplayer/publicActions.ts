import type { GameEvent, RemotePlayer, WorldAction, SpellId } from "../contracts.js";
import type { GameState } from "../state/store.js";
import { content } from "../content/index.js";
import type { CombatSystem } from "../systems/combat.js";

/** Project visible activity without publishing the activity's private progress or inventory. */
export function publicPresentation(state: GameState): NonNullable<RemotePlayer["presentation"]> {
  if (state.player.health <= 0) return { pose: "death" };
  const activity = state.activity;
  if (activity?.kind === "gathering") {
    const pose = activity.skill === "woodcutting" ? "chop" : activity.skill === "fishing" ? "fish" : "mine";
    const tool = state.inventory.slots.filter(stack => stack && content.item(stack.itemId)?.tool?.skill === activity.skill)
      .sort((a, b) => (content.item(b!.itemId)?.tool?.gatherBonus ?? 0) - (content.item(a!.itemId)?.tool?.gatherBonus ?? 0))[0];
    return { pose, ...(tool ? { toolItemId: tool.itemId } : {}),
      gathering: {entityId:activity.entityId,startedAtMs:activity.startedAtMs,nextRollAtMs:activity.nextRollAtMs} };
  }
  if (activity?.kind === "production" || activity?.kind === "building_campfire") return { pose: "produce" };
  if (activity?.kind === "eating") return { pose: "eat" };
  if (activity?.kind === "traversing") return { pose: "climb" };
  return { pose: state.player.movement.mode === "idle" ? "idle" : "run" };
}

type ActionPayload = WorldAction extends infer A ? A extends WorldAction ? Omit<A, "sequence" | "playerId" | "position" | "regionId"> : never : never;
type ActionOrigin = {player: Pick<GameState["player"], "id" | "position" | "regionId">};

/** A bounded public log with an explicit allowlist. Owner event payloads never pass through. */
export class PublicActions {
  private sequence = 0;
  private entries: WorldAction[] = [];
  private readonly committed = new Map<string, Map<string, ActionOrigin>>();
  currentSequence(): number { return this.sequence; }
  publish(state: ActionOrigin, action: ActionPayload): void {
    const sequence = ++this.sequence;
    this.entries[(sequence - 1) % 4096] = { ...action, sequence, playerId: state.player.id,
      position: [...state.player.position], regionId: state.player.regionId };
  }
  since(sequence: number): readonly WorldAction[] {
    // Sequences are contiguous in this ring. Cursor reads cost only the new batch.
    const result: WorldAction[] = [];
    for (let next = Math.max(sequence + 1, this.sequence - this.entries.length + 1); next <= this.sequence; next++)
      result.push(this.entries[(next - 1) % 4096]!);
    return result;
  }
  combat(state: Pick<GameState,"player">, combat: CombatSystem): void {
    let sources = this.committed.get(state.player.id);
    if (!sources) { sources = new Map(); this.committed.set(state.player.id, sources); }
    for (const [sourceId, origin] of sources) if (!combat.isAttackCommitted(sourceId)) {
      this.publish(origin, {type:"attackCancelled",sourceId}); sources.delete(sourceId);
    }
    for (const attack of combat.consumeAttackStarts()) {
      this.publish(state, {type:"attack",attack});
      sources.set(attack.sourceId, {player:{id:state.player.id,position:[...state.player.position],regionId:state.player.regionId}});
    }
    for (const hit of combat.consumeHits()) this.publish(state, {type:"hit",hit});
    if (!sources.size) this.committed.delete(state.player.id);
  }
  leave(state: GameState): void {
    for (const [sourceId, origin] of this.committed.get(state.player.id) ?? []) this.publish(origin, {type:"attackCancelled",sourceId});
    this.committed.delete(state.player.id);
  }
  event(state: GameState, event: GameEvent): void {
    if (event.type === "spell.launched") {
      const data = event.data;
      if (typeof data.spellId !== "string" || typeof data.targetId !== "string" || typeof data.flightMs !== "number") return;
      const spell = content.spell(data.spellId as SpellId);
      if (!spell) return;
      this.publish(state, { type: "spell", atMs: event.atMs, spellId: spell.id, targetId: data.targetId,
        flightMs: data.flightMs, hit: data.hit === true,
        ...(Array.isArray(data.aim) && data.aim.length === 3 ? { aim: [...data.aim] as [number, number, number] } : {}) });
    } else if (event.type === "player.died") {
      const position = event.data.position, regionId = event.data.regionId;
      if (Array.isArray(position) && position.length === 3 && position.every(Number.isFinite) && typeof regionId === "string")
        this.publish({player:{...state.player,position:position as [number,number,number],regionId:regionId as GameState["player"]["regionId"]}}, {type:"death",atMs:event.atMs});
    } else if (event.type === "activity.started" && event.data.kind === "bank") {
      this.publish(state, { type: "gesture", atMs: event.atMs, pose: "bank" });
    }
  }
}
