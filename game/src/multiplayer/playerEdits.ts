import { createHash } from "node:crypto";
import { EQUIP_SLOTS, SKILL_IDS, type EquipSlot, type InventorySlot, type ItemDef, type ItemStack, type PlayerCharacter, type RegionId, type SkillId, type Vec3, type WorldKey } from "../contracts.js";
import { content } from "../content/index.js";
import { jewelrySlots } from "../content/jewelry.js";
import { getRegion } from "../content/regions.js";
import { levelForXp, totalXpAt } from "../content/xp.js";
import { BANK_CAPACITY, INVENTORY_SLOTS } from "../state/store.js";
import { MAX_STACK } from "../systems/inventory.js";

/**
 * Admin edits to one player, as plain data over plain data. The same function edits a live player
 * and a stored one, so both obey the same rules: the 28 slots, one stack per stackable item, a dense
 * bank of 400 kinds, gold as a balance, levels from the XP table.
 *
 * Nothing here knows whether the player is online. `referenceServer` decides where the result goes.
 */

export const MAX_PLAYER_OPS = 64;
/** A full `bank.set` is 400 stacks, about 24 KiB. */
export const MAX_PLAYER_PATCH_BYTES = 128 * 1024;
const MAX_COORDINATE = 100_000;
/** How far from the asked point the nearest walkable ground may be. */
export const PLACE_SNAP_METRES = 8;
const ITEM_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

interface StackInput { itemId: string; quantity: number }
export type PlayerOp =
  | { op: "inventory.set"; slots: (StackInput | null)[] }
  | { op: "inventory.add" | "inventory.remove" | "bank.add" | "bank.remove"; itemId: string; quantity: number }
  | { op: "bank.set"; slots: StackInput[] }
  | { op: "equipment.set"; slot: EquipSlot; itemId: string | null }
  | { op: "currency.set"; amount: number }
  | { op: "skill.setXp"; skill: SkillId; xp: number }
  | { op: "position.set"; world: WorldKey; regionId: string; position: Vec3 };
export interface PlayerPatch { ops: PlayerOp[]; expect: string | null }

/** `status` 400 is a malformed or impossible edit, 409 one that does not fit this player right now, 503 a server that could not save it. */
export class EditFailure extends Error {
  constructor(readonly status: 400 | 409 | 503, readonly code: string, message: string, readonly opIndex: number | null = null) { super(message); this.name = "EditFailure"; }
}
const bad = (index: number | null, message: string, code = "invalid_op"): never => { throw new EditFailure(400, code, index === null ? message : `ops[${index}]: ${message}`, index); };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function only(value: Record<string, unknown>, keys: readonly string[], index: number | null): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) bad(index, `unknown field ${JSON.stringify(key.slice(0, 64))}`);
}
function quantity(value: unknown, index: number, label = "quantity"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_STACK) bad(index, `${label} must be an integer from 1 to ${MAX_STACK}`);
  return value as number;
}
function itemId(value: unknown, index: number): string {
  if (typeof value !== "string" || !ITEM_ID.test(value)) bad(index, "itemId must be an item id");
  return value as string;
}
function stack(value: unknown, index: number): StackInput {
  if (!isRecord(value)) return bad(index, "a slot is {itemId, quantity}");
  only(value, ["itemId", "quantity", "slotIndex"], index);
  return { itemId: itemId(value.itemId, index), quantity: quantity(value.quantity, index) };
}

/** Shape only. Whether the items exist and the result fits is decided against the catalog by `applyPlayerOps`. */
export function playerPatch(body: Record<string, unknown>): PlayerPatch {
  only(body, ["ops", "expect"], null);
  if (!Array.isArray(body.ops) || !body.ops.length || body.ops.length > MAX_PLAYER_OPS) bad(null, `ops must be a list of 1 to ${MAX_PLAYER_OPS} operations`, "invalid_request");
  let expect: string | null = null;
  if (body.expect !== undefined) {
    if (!isRecord(body.expect) || typeof body.expect.revision !== "string" || !/^[0-9a-f]{16}$/.test(body.expect.revision) || Object.keys(body.expect).length !== 1)
      bad(null, "expect must be {revision} as GET /admin/players/<id> returned it", "invalid_request");
    expect = (body.expect as { revision: string }).revision;
  }
  const ops = (body.ops as unknown[]).map((value, index): PlayerOp => {
    if (!isRecord(value) || typeof value.op !== "string") return bad(index, "an operation is an object with an op name");
    switch (value.op) {
      case "inventory.set": {
        only(value, ["op", "slots"], index);
        if (!Array.isArray(value.slots) || value.slots.length > INVENTORY_SLOTS) bad(index, `slots must be a list of at most ${INVENTORY_SLOTS} entries`);
        return { op: value.op, slots: (value.slots as unknown[]).map(slot => slot === null ? null : stack(slot, index)) };
      }
      case "bank.set": {
        only(value, ["op", "slots"], index);
        if (!Array.isArray(value.slots) || value.slots.length > BANK_CAPACITY) bad(index, `slots must be a list of at most ${BANK_CAPACITY} stacks`);
        return { op: value.op, slots: (value.slots as unknown[]).map(slot => stack(slot, index)) };
      }
      case "inventory.add": case "inventory.remove": case "bank.add": case "bank.remove":
        only(value, ["op", "itemId", "quantity"], index);
        return { op: value.op, itemId: itemId(value.itemId, index), quantity: quantity(value.quantity, index) };
      case "equipment.set":
        only(value, ["op", "slot", "itemId"], index);
        if (!(EQUIP_SLOTS as readonly unknown[]).includes(value.slot)) bad(index, `slot must be one of ${EQUIP_SLOTS.join(", ")}`);
        return { op: value.op, slot: value.slot as EquipSlot, itemId: value.itemId === null ? null : itemId(value.itemId, index) };
      case "currency.set":
        only(value, ["op", "amount"], index);
        if (!Number.isSafeInteger(value.amount) || (value.amount as number) < 0 || (value.amount as number) > MAX_STACK) bad(index, `amount must be an integer from 0 to ${MAX_STACK}`);
        return { op: value.op, amount: value.amount as number };
      case "skill.setXp":
        only(value, ["op", "skill", "xp"], index);
        if (!(SKILL_IDS as readonly unknown[]).includes(value.skill)) bad(index, `skill must be one of ${SKILL_IDS.join(", ")}`);
        if (!Number.isSafeInteger(value.xp) || (value.xp as number) < 0 || (value.xp as number) > totalXpAt(99)) bad(index, `xp must be an integer from 0 to ${totalXpAt(99)}`);
        return { op: value.op, skill: value.skill as SkillId, xp: value.xp as number };
      case "position.set": {
        only(value, ["op", "world", "regionId", "position"], index);
        const world = value.world, position = value.position;
        if (!isRecord(world) || typeof world.providerId !== "string" || typeof world.worldId !== "string" || !ITEM_ID.test(world.providerId) || !ITEM_ID.test(world.worldId) || Object.keys(world).length !== 2)
          bad(index, "world must be {providerId, worldId}");
        if (typeof value.regionId !== "string" || !ITEM_ID.test(value.regionId)) bad(index, "regionId must be a region id");
        if (!Array.isArray(position) || position.length !== 3 || !position.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_COORDINATE)) bad(index, "position must be [x, y, z] in metres");
        const [x, y, z] = position as number[];
        return { op: value.op, world: { providerId: (world as WorldKey).providerId, worldId: (world as WorldKey).worldId }, regionId: value.regionId as string, position: [x!, y!, z!] };
      }
      default: return bad(index, `unknown op ${JSON.stringify(value.op.slice(0, 64))}`);
    }
  });
  return { ops, expect };
}

/** What only the running server can answer about where a player may stand. */
export interface EditPlacement {
  /** The world the player is in, or was last in. `position.set` must name it. */
  world: WorldKey | null;
  /** The nearest walkable point in that world within `PLACE_SNAP_METRES`, or null. */
  snap(position: Vec3): Vec3 | null;
}
export interface EditResult { character: PlayerCharacter; warnings: string[]; moved: boolean }

function known(id: string, index: number): ItemDef {
  const def = content.item(id);
  // A retired item still resolves, so an admin can still hand one out or take one away.
  if (!def) throw new EditFailure(400, "unknown_item", `ops[${index}]: no item with id ${JSON.stringify(id)} in the active catalog`, index);
  return def;
}
function carried(def: ItemDef, index: number): ItemDef {
  if (def.category === "currency") throw new EditFailure(400, "invalid_op", `ops[${index}]: ${def.name} is a balance, not a carried item. Use currency.set`, index);
  return def;
}
const fits = (index: number, message: string): never => { throw new EditFailure(409, "does_not_fit", `ops[${index}]: ${message}`, index); };

/**
 * Apply every operation in order to a copy. Any failure throws and the caller keeps the original,
 * so a patch lands whole or not at all. Equip requirements are an admin's to override: unmet ones
 * come back as warnings. What an item may physically be worn on is not.
 */
export function applyPlayerOps(original: PlayerCharacter, ops: readonly PlayerOp[], placement: EditPlacement): EditResult {
  const character = structuredClone(original), warnings: string[] = [];
  let moved = false;
  ops.forEach((op, index) => {
    switch (op.op) {
      case "inventory.set": {
        const seen = new Set<string>();
        const slots: (InventorySlot | null)[] = Array.from({ length: INVENTORY_SLOTS }, (_, slotIndex) => {
          const wanted = op.slots[slotIndex] ?? null;
          if (!wanted) return null;
          const def = carried(known(wanted.itemId, index), index);
          if (!def.stackable && wanted.quantity !== 1) bad(index, `${def.name} does not stack, so each slot holds exactly 1`);
          if (def.stackable && seen.has(def.id)) bad(index, `${def.name} stacks, so it may fill only one slot`);
          seen.add(def.id);
          return { slotIndex, itemId: def.id, quantity: wanted.quantity };
        });
        character.inventory.slots = slots; break;
      }
      case "inventory.add": {
        const def = carried(known(op.itemId, index), index), slots = character.inventory.slots;
        if (def.stackable) {
          const existing = slots.find((slot): slot is InventorySlot => slot !== null && slot.itemId === def.id);
          if (existing) { if (existing.quantity + op.quantity > MAX_STACK) fits(index, `${def.name} would exceed a stack of ${MAX_STACK}`); existing.quantity += op.quantity; break; }
          const free = slots.indexOf(null);
          if (free < 0) fits(index, `no free inventory slot for ${def.name}`);
          slots[free] = { slotIndex: free, itemId: def.id, quantity: op.quantity }; break;
        }
        const free = slots.flatMap((slot, slotIndex) => slot === null ? [slotIndex] : []);
        if (free.length < op.quantity) fits(index, `${op.quantity} ${def.name} need ${op.quantity} free inventory slots and ${free.length} are free`);
        for (const slotIndex of free.slice(0, op.quantity)) slots[slotIndex] = { slotIndex, itemId: def.id, quantity: 1 };
        break;
      }
      case "inventory.remove": {
        const def = carried(known(op.itemId, index), index), slots = character.inventory.slots;
        const held = slots.reduce((sum, slot) => sum + (slot?.itemId === def.id ? slot.quantity : 0), 0);
        if (held < op.quantity) fits(index, `the inventory holds ${held} ${def.name}, not ${op.quantity}`);
        let left = op.quantity;
        for (let i = 0; i < slots.length && left > 0; i++) {
          const slot = slots[i]; if (!slot || slot.itemId !== def.id) continue;
          const taken = Math.min(slot.quantity, left); slot.quantity -= taken; left -= taken;
          if (slot.quantity <= 0) slots[i] = null;
        }
        break;
      }
      case "bank.set": {
        const seen = new Set<string>();
        character.bank.slots = op.slots.map((wanted): ItemStack => {
          const def = carried(known(wanted.itemId, index), index);
          // Everything stacks in the bank, one row per kind.
          if (seen.has(def.id)) bad(index, `${def.name} appears twice. The bank keeps one stack per item`);
          seen.add(def.id);
          return { itemId: def.id, quantity: wanted.quantity };
        });
        break;
      }
      case "bank.add": {
        const def = carried(known(op.itemId, index), index), existing = character.bank.slots.find(slot => slot.itemId === def.id);
        if (existing) { if (existing.quantity + op.quantity > MAX_STACK) fits(index, `${def.name} would exceed a stack of ${MAX_STACK}`); existing.quantity += op.quantity; break; }
        if (character.bank.slots.length >= BANK_CAPACITY) fits(index, `the bank is full: all ${BANK_CAPACITY} slots are in use`);
        character.bank.slots.push({ itemId: def.id, quantity: op.quantity }); break;
      }
      case "bank.remove": {
        const def = carried(known(op.itemId, index), index), at = character.bank.slots.findIndex(slot => slot.itemId === def.id);
        const held = at < 0 ? 0 : character.bank.slots[at]!.quantity;
        if (held < op.quantity) fits(index, `the bank holds ${held} ${def.name}, not ${op.quantity}`);
        if (held === op.quantity) character.bank.slots.splice(at, 1); else character.bank.slots[at]!.quantity -= op.quantity;
        break;
      }
      case "equipment.set": {
        if (op.itemId === null) { character.equipment[op.slot] = null; break; }
        const def = known(op.itemId, index), equip = def.equip;
        if (!equip) return bad(index, `${def.name} is not equipment`);
        if (!jewelrySlots(equip.slot).includes(op.slot)) bad(index, `${def.name} is worn on ${jewelrySlots(equip.slot).join(" or ")}, not ${op.slot}`);
        if (def.magicWeapon?.hands === 2 && character.equipment.offHand) fits(index, `${def.name} takes both hands. Clear offHand first`);
        const main = op.slot === "offHand" && character.equipment.mainHand ? content.item(character.equipment.mainHand.itemId) : undefined;
        if (main?.magicWeapon?.hands === 2) fits(index, `${main.name} takes both hands. Clear mainHand first`);
        for (const [skill, level] of Object.entries(equip.requires)) {
          const have = character.skills[skill as SkillId]?.level ?? 1;
          if (typeof level === "number" && level > 1 && have < level) warnings.push(`ops[${index}]: ${def.name} needs ${skill} level ${level} and the player has ${have}. Equipped anyway`);
        }
        character.equipment[op.slot] = { itemId: def.id, quantity: 1 }; break;
      }
      case "currency.set": character.currency = op.amount; break;
      case "skill.setXp": character.skills[op.skill] = { xp: op.xp, level: levelForXp(op.xp) }; break;
      case "position.set": {
        if (!placement.world) fits(index, "this player has never been in a world on this server");
        if (placement.world!.providerId !== op.world.providerId || placement.world!.worldId !== op.world.worldId)
          fits(index, `the player is in world ${placement.world!.worldId}, not ${op.world.worldId}`);
        const region = getRegion(op.regionId as RegionId);
        if (!region) throw new EditFailure(400, "unknown_region", `ops[${index}]: no region with id ${JSON.stringify(op.regionId)}`, index);
        const snapped = placement.snap(op.position);
        if (!snapped) fits(index, `no walkable ground within ${PLACE_SNAP_METRES} m of that position`);
        const initial = { mode: "idle" as const, path: null, pathIndex: 0, destination: null, destinationEntityId: null };
        character.player = { ...character.player, position: snapped!, regionId: region.id, movement: initial };
        character.activity = null; character.dialogue = null;
        moved = true; break;
      }
    }
    // Altar-crafted weapons get their first charge the first time one is held, exactly once.
    if (op.op === "inventory.set" || op.op === "inventory.add" || op.op === "equipment.set") for (const id of heldIds(character)) {
      const charge = content.item(id)?.magicWeapon?.charge;
      if (charge && !Number.isFinite(character.magic.weaponCharges[id])) character.magic.weaponCharges[id] = Math.max(0, Math.min(charge.capacity, Math.floor(charge.initialCharges)));
    }
  });
  return { character, warnings, moved };
}
function heldIds(character: PlayerCharacter): Set<string> {
  return new Set([...character.inventory.slots, ...Object.values(character.equipment)].flatMap(slot => slot ? [slot.itemId] : []));
}

const HASHED = ["inventory", "bank", "equipment", "currency", "skills"] as const;

/**
 * A short hash of what an editor shows and changes. Position is left out: a walking player moves ten
 * times a second, and an inventory edit must not lose a race with their feet. `GET` returns it,
 * `PATCH` takes it back as `expect.revision`, and a player who looted in between is a 409.
 */
export function playerRevision(character: PlayerCharacter): string {
  const hash = createHash("sha256");
  for (const key of HASHED) hash.update(JSON.stringify(key === "bank" ? character.bank.slots : key === "inventory" ? character.inventory.slots : character[key])).update("\n");
  return hash.digest("hex").slice(0, 16);
}

/** Only what changed, for the audit row: slot lists by index, the rest by key. */
export function editDiff(before: PlayerCharacter, after: PlayerCharacter): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const was: Record<string, unknown> = {}, now: Record<string, unknown> = {};
  const compact = (slot: { itemId: string; quantity: number } | null | undefined) => slot ? { itemId: slot.itemId, quantity: slot.quantity } : null;
  for (const [key, from, to] of [["inventory", before.inventory.slots, after.inventory.slots], ["bank", before.bank.slots, after.bank.slots]] as const) {
    const a: Record<string, unknown> = {}, b: Record<string, unknown> = {};
    for (let i = 0; i < Math.max(from.length, to.length); i++) if (JSON.stringify(compact(from[i])) !== JSON.stringify(compact(to[i]))) { a[i] = compact(from[i]); b[i] = compact(to[i]); }
    if (Object.keys(a).length) { was[key] = a; now[key] = b; }
  }
  for (const [key, from, to] of [["equipment", before.equipment, after.equipment], ["skills", before.skills, after.skills], ["weaponCharges", before.magic.weaponCharges, after.magic.weaponCharges]] as const) {
    const a: Record<string, unknown> = {}, b: Record<string, unknown> = {};
    for (const id of new Set([...Object.keys(from), ...Object.keys(to)])) {
      const left = (from as Record<string, unknown>)[id] ?? null, right = (to as Record<string, unknown>)[id] ?? null;
      if (JSON.stringify(left) !== JSON.stringify(right)) { a[id] = left; b[id] = right; }
    }
    if (Object.keys(a).length) { was[key] = a; now[key] = b; }
  }
  if (before.currency !== after.currency) { was.currency = before.currency; now.currency = after.currency; }
  if (JSON.stringify([before.player.position, before.player.regionId]) !== JSON.stringify([after.player.position, after.player.regionId])) {
    was.position = { position: before.player.position, regionId: before.player.regionId }; now.position = { position: after.player.position, regionId: after.player.regionId };
  }
  return Object.keys(was).length ? { before: was, after: now } : null;
}
