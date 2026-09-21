import { EQUIP_SLOTS, SKILL_IDS, type EquipSlot, type SemanticEntity, type SkillId, type Vec3 } from "../contracts.js";
import type { GameState } from "../state/store.js";

/**
 * The debug channel of worker-hosted local play: what `window.__gameDebug` asks of the world it no
 * longer holds.
 *
 * It is not part of the session protocol. A request travels as a `@port` frame on the session's
 * MessagePort, which only `messagePortLink.ts` reads, so the host core never sees one and a socket
 * peer that sends one is refused like any other unknown message (`tests/local-debug.test.ts`). It
 * shares the port so that the answer is ordered after the update that carries its effect: the host
 * applies the operation between ticks, replicates, then replies. By the time the page sees the
 * reply its store already shows the change.
 *
 * This module imports no content and nothing from the host, so both sides can load it first.
 */
export type EntityFilter = { archetype?: string; regionId?: string; tier?: number; ids?: string[]; near?: { position: Vec3; radius: number } };

export type DebugOp =
  // ---- the player
  | { op: "place"; position: Vec3; regionId: string; facingRad?: number }
  | { op: "giveItem"; itemId: string; quantity: number; to: "inventory" | "bank" }
  | { op: "removeItem"; itemId: string; quantity: number; from: "inventory" | "bank" }
  | { op: "clearInventory" }
  | { op: "setEquipment"; slot: EquipSlot; itemId: string | null }
  | { op: "setHealth"; health: number }
  | { op: "setSkillLevel"; skill: SkillId; level: number }
  | { op: "grantXp"; skill: SkillId; amount: number }
  | { op: "setCurrency"; amount: number }
  | { op: "setQuestStage"; questId: string; stage: number }
  | { op: "setQuestState"; questId: string; state: { status: "unstarted" | "active" | "complete"; stage: number; counters?: Record<string, number>; flags?: Record<string, boolean> } | null }
  | { op: "seedMagic"; magicLevel: number; essenceQuantity: number }
  // ---- the world
  | { op: "depleteNode"; entityId: string }
  | { op: "forceRespawn"; entityId: string }
  | { op: "killEntity"; entityId: string }
  | { op: "spawnEntity"; entity: SemanticEntity }
  | { op: "despawnEntity"; entityId: string }
  | { op: "getEntity"; entityId: string }
  | { op: "findEntities"; filter?: EntityFilter }
  | { op: "getWorldState" }
  // ---- the whole session
  | { op: "reset"; seed?: number }
  | { op: "getSave" }
  | { op: "loadSave"; state: GameState }
  | { op: "flush" }
  // ---- time
  | { op: "setPaused"; paused: boolean }
  | { op: "setTimeScale"; scale: number }
  | { op: "advanceGameTime"; seconds: number }
  | { op: "advanceTicks"; ticks: number };

export type DebugOpName = DebugOp["op"];
/** `tick` is the world tick the page's store shows once the reply has arrived. */
export type DebugReply = { ok: true; value: unknown; tick: number } | { ok: false; error: string };

export const MAX_TIME_SCALE = 100;
export const MIN_TIME_SCALE = 0.1;
/** One call may not hold the world for longer than this many ticks: ten minutes of play. */
export const MAX_ADVANCE_TICKS = 6000;
const MAX_COORDINATE = 100_000;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 256;
const vec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(n => finite(n) && Math.abs(n) <= MAX_COORDINATE);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;

/**
 * Shape only, at the worker boundary. Whether the item exists, the entity is a node or the player is
 * in the world is the host's to answer. Throws with the reason, which becomes the rejected promise.
 */
export function debugOp(value: unknown): DebugOp {
  const bad = (message: string): never => { throw new Error(`Invalid debug operation: ${message}`); };
  if (!isRecord(value) || typeof value.op !== "string") return bad("an operation is an object with an op name");
  const input = value as Record<string, unknown> & { op: string };
  switch (input.op) {
    case "place":
      if (!vec3(input.position)) bad("position must be [x, y, z] in metres");
      if (!id(input.regionId)) bad("regionId must be a region id");
      if (input.facingRad !== undefined && !finite(input.facingRad)) bad("facingRad must be a number");
      return { op: "place", position: input.position as Vec3, regionId: input.regionId as string, ...(input.facingRad === undefined ? {} : { facingRad: input.facingRad as number }) };
    case "giveItem": case "removeItem": {
      if (!id(input.itemId)) bad("itemId must be an item id");
      if (!count(input.quantity)) bad("quantity must be a positive integer");
      const where = input.op === "giveItem" ? input.to ?? "inventory" : input.from ?? "inventory";
      if (where !== "inventory" && where !== "bank") bad("the place must be inventory or bank");
      return input.op === "giveItem" ? { op: "giveItem", itemId: input.itemId as string, quantity: input.quantity as number, to: where as "inventory" | "bank" }
        : { op: "removeItem", itemId: input.itemId as string, quantity: input.quantity as number, from: where as "inventory" | "bank" };
    }
    case "clearInventory": case "getWorldState": case "getSave": case "flush": return { op: input.op };
    case "setEquipment":
      if (!(EQUIP_SLOTS as readonly unknown[]).includes(input.slot)) bad(`slot must be one of ${EQUIP_SLOTS.join(", ")}`);
      if (input.itemId !== null && !id(input.itemId)) bad("itemId must be an item id or null");
      return { op: "setEquipment", slot: input.slot as EquipSlot, itemId: input.itemId as string | null };
    case "setHealth":
      if (!finite(input.health)) bad("health must be a number");
      return { op: "setHealth", health: input.health as number };
    case "setSkillLevel": case "grantXp": {
      if (!(SKILL_IDS as readonly unknown[]).includes(input.skill)) bad(`skill must be one of ${SKILL_IDS.join(", ")}`);
      const amount = input.op === "setSkillLevel" ? input.level : input.amount;
      if (!finite(amount)) bad("the amount must be a number");
      return input.op === "setSkillLevel" ? { op: "setSkillLevel", skill: input.skill as SkillId, level: amount as number } : { op: "grantXp", skill: input.skill as SkillId, amount: amount as number };
    }
    case "setCurrency":
      if (!finite(input.amount)) bad("amount must be a number");
      return { op: "setCurrency", amount: input.amount as number };
    case "setQuestStage":
      if (!id(input.questId)) bad("questId must be a quest id");
      if (!finite(input.stage)) bad("stage must be a number");
      return { op: "setQuestStage", questId: input.questId as string, stage: input.stage as number };
    case "setQuestState": {
      if (!id(input.questId)) bad("questId must be a quest id");
      const state = input.state;
      if (state === null) return { op: "setQuestState", questId: input.questId as string, state: null };
      if (!isRecord(state) || !["unstarted", "active", "complete"].includes(state.status as string) || !finite(state.stage)) return bad("state must be {status, stage, counters?, flags?} or null");
      const counters = state.counters ?? {}, flags = state.flags ?? {};
      if (!isRecord(counters) || !Object.values(counters).every(finite)) bad("counters must map names to numbers");
      if (!isRecord(flags) || !Object.values(flags).every(flag => typeof flag === "boolean")) bad("flags must map names to booleans");
      return { op: "setQuestState", questId: input.questId as string, state: { status: state.status as "unstarted" | "active" | "complete", stage: state.stage, counters: counters as Record<string, number>, flags: flags as Record<string, boolean> } };
    }
    case "seedMagic":
      if (!finite(input.magicLevel) || !finite(input.essenceQuantity)) bad("magicLevel and essenceQuantity must be numbers");
      return { op: "seedMagic", magicLevel: input.magicLevel as number, essenceQuantity: input.essenceQuantity as number };
    case "depleteNode": case "forceRespawn": case "killEntity": case "despawnEntity": case "getEntity":
      if (!id(input.entityId)) bad("entityId must be an entity id");
      return { op: input.op, entityId: input.entityId as string };
    case "spawnEntity": {
      const entity = input.entity;
      if (!isRecord(entity) || !id(entity.id) || typeof entity.archetype !== "string" || typeof entity.name !== "string" || !id(entity.regionId)
        || !vec3(entity.position) || typeof entity.state !== "string" || !Array.isArray(entity.interactions)) return bad("entity must be a semantic entity with id, archetype, name, regionId, position, state and interactions");
      return { op: "spawnEntity", entity: entity as unknown as SemanticEntity };
    }
    case "findEntities": {
      const filter = input.filter;
      if (filter === undefined) return { op: "findEntities" };
      if (!isRecord(filter)) return bad("filter must be an object");
      if (filter.archetype !== undefined && typeof filter.archetype !== "string") bad("filter.archetype must be a string");
      if (filter.regionId !== undefined && typeof filter.regionId !== "string") bad("filter.regionId must be a string");
      if (filter.tier !== undefined && !finite(filter.tier)) bad("filter.tier must be a number");
      if (filter.ids !== undefined && !(Array.isArray(filter.ids) && filter.ids.every(id))) bad("filter.ids must be a list of entity ids");
      if (filter.near !== undefined && !(isRecord(filter.near) && vec3(filter.near.position) && finite(filter.near.radius) && filter.near.radius >= 0)) bad("filter.near must be {position, radius}");
      return { op: "findEntities", filter: filter as EntityFilter };
    }
    case "reset":
      if (input.seed !== undefined && !(Number.isSafeInteger(input.seed) && (input.seed as number) >= 0)) bad("seed must be a non-negative integer");
      return { op: "reset", ...(input.seed === undefined ? {} : { seed: input.seed as number }) };
    case "loadSave":
      // The page ran the save through the game's load pipeline (migrate, recompute, validate) before it got here.
      if (!isRecord(input.state) || !isRecord(input.state.meta) || !isRecord(input.state.player) || !isRecord(input.state.world)) bad("state must be a loaded game state");
      return { op: "loadSave", state: input.state as unknown as GameState };
    case "setPaused":
      if (typeof input.paused !== "boolean") bad("paused must be a boolean");
      return { op: "setPaused", paused: input.paused as boolean };
    case "setTimeScale":
      if (!finite(input.scale) || input.scale <= 0) bad("scale must be a positive number");
      return { op: "setTimeScale", scale: Math.max(MIN_TIME_SCALE, Math.min(MAX_TIME_SCALE, input.scale as number)) };
    case "advanceGameTime":
      if (!finite(input.seconds) || input.seconds < 0) bad("seconds must be a non-negative number");
      return { op: "advanceGameTime", seconds: input.seconds as number };
    case "advanceTicks":
      if (!count(input.ticks) || (input.ticks as number) > MAX_ADVANCE_TICKS) bad(`ticks must be an integer from 1 to ${MAX_ADVANCE_TICKS}`);
      return { op: "advanceTicks", ticks: input.ticks as number };
    default: return bad(`unknown op ${JSON.stringify(input.op.slice(0, 64))}`);
  }
}
