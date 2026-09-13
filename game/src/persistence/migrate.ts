import { canonicalJewelryId, jewelrySlots } from '../content/jewelry.js';
import { EQUIP_SLOTS } from '../contracts.js';
import { SAVE_VERSION, type GameState } from "../state/store.js";
import { normalizeHuntContracts } from "../systems/huntContracts.js";

export interface MigrationResult {
  ok: boolean;
  state?: GameState;
  reason?: string;
  fromVersion?: number;
}

type LooseStack = { itemId: string; quantity: number; slotIndex?: number };
type TransitionalEquipment = GameState["equipment"] & { focus?: LooseStack | null };
type TransitionalMagic = Partial<GameState["magic"]> & { orbCharges?: Record<string, number> };

const ALTAR_BY_ORB: Readonly<Record<string, string>> = {
  air_orb: "fallowmarch_air_altar",
  earth_orb: "vellenwood_earth_altar",
  water_orb: "karrowmoor_water_altar",
  fire_orb: "kilnhalt_fire_altar",
};

const LEGACY_ITEM_REPLACEMENTS: Readonly<Record<string, string>> = {
  essence_shard: "air_essence",
  worn_staff: "basic_wooden_staff",
  quartz_focus: "air_orb",
  amber_focus: "earth_orb",
  garnet_focus: "water_orb",
};

const TWO_HANDED_STAFFS = new Set([
  "basic_wooden_staff", "palewood_staff", "duskoak_staff", "cairnpine_staff", "cinderpine_staff",
  "air_staff", "earth_staff", "water_staff", "fire_staff",
  "galeskin_staff", "mossbound_staff", "tideworn_staff", "cinderwake_staff",
]);

const REMOVED_FARMING_ITEMS = new Set([
  "bittergrain", "duskberry", "cairnleaf", "coalroot",
  "bittergrain_seed", "duskberry_seed", "cairnleaf_seed", "coalroot_seed",
]);

function removeFarmingContent(state: GameState): void {
  if (state.inventory?.slots) {
    state.inventory.slots = state.inventory.slots.map((stack, slotIndex) =>
      stack && !REMOVED_FARMING_ITEMS.has(stack.itemId) ? { ...stack, slotIndex } : null,
    );
  }
  if (state.bank?.slots) {
    state.bank.slots = state.bank.slots.filter((stack) => !REMOVED_FARMING_ITEMS.has(stack.itemId));
  }
  for (const slot of Object.keys(state.equipment ?? {}) as (keyof GameState["equipment"])[]) {
    const stack = state.equipment[slot];
    if (stack && REMOVED_FARMING_ITEMS.has(stack.itemId)) state.equipment[slot] = null;
  }
  if (state.world?.recoveryCache) {
    state.world.recoveryCache.items = state.world.recoveryCache.items.filter(
      (stack) => !REMOVED_FARMING_ITEMS.has(stack.itemId),
    );
  }
  for (const pile of Object.values(state.world?.lootPiles ?? {})) {
    pile.items = pile.items.filter((stack) => !REMOVED_FARMING_ITEMS.has(stack.itemId));
  }

  delete (state.skills as Record<string, unknown> | undefined)?.farming;
  delete (state.quests as Record<string, unknown> | undefined)?.bright_water;
  delete (state as unknown as Record<string, unknown>).farming;
}

function isReleasedOrb(itemId: string): boolean {
  return /^(air|earth|water|fire)_orb$/.test(itemId);
}

function clampCharges(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1000, Math.floor(value)))
    : 1000;
}

function preserveStack(state: GameState, stack: LooseStack): void {
  const inventorySlots = state.inventory?.slots;
  const freeSlot = inventorySlots?.indexOf(null) ?? -1;
  if (inventorySlots && freeSlot >= 0) {
    inventorySlots[freeSlot] = { ...stack, slotIndex: freeSlot };
    return;
  }

  const bank = state.bank ?? (state.bank = { slots: [], filter: "" });
  const existing = bank.slots.find((candidate) => candidate.itemId === stack.itemId);
  if (existing) existing.quantity += stack.quantity;
  else bank.slots.push({ ...stack });
}

function visitPhysicalStacks(state: GameState, visit: (stack: LooseStack) => void): void {
  for (const stack of state.inventory?.slots ?? []) if (stack) visit(stack);
  for (const stack of state.bank?.slots ?? []) visit(stack);
  for (const stack of Object.values(state.equipment ?? {})) if (stack) visit(stack);
  for (const stack of state.world?.recoveryCache?.items ?? []) visit(stack);
  for (const pile of Object.values(state.world?.lootPiles ?? {})) {
    for (const stack of pile.items ?? []) visit(stack);
  }
}

function rewriteLegacyItems(state: GameState): void {
  visitPhysicalStacks(state, (stack) => {
    stack.itemId = LEGACY_ITEM_REPLACEMENTS[stack.itemId] ?? stack.itemId;
  });
}

function removeDuplicatePhysicalOrbs(state: GameState, equipment: TransitionalEquipment): void {
  const claimed = new Set<string>();
  const keep = (stack: LooseStack | null): boolean => {
    if (!stack || !isReleasedOrb(stack.itemId)) return true;
    if (claimed.has(stack.itemId)) return false;
    claimed.add(stack.itemId);
    stack.quantity = 1;
    return true;
  };

  if (equipment.focus) keep(equipment.focus);
  for (const slot of Object.keys(equipment) as (keyof TransitionalEquipment)[]) {
    if (slot === "focus") continue;
    const stack = equipment[slot];
    if (stack && !keep(stack)) equipment[slot] = null;
  }
  for (let index = 0; index < (state.inventory?.slots.length ?? 0); index += 1) {
    const stack = state.inventory.slots[index];
    if (stack && !keep(stack)) state.inventory.slots[index] = null;
  }
  if (state.bank?.slots) state.bank.slots = state.bank.slots.filter(keep);
  if (state.world?.recoveryCache) {
    state.world.recoveryCache.items = state.world.recoveryCache.items.filter(keep);
  }
  for (const pile of Object.values(state.world?.lootPiles ?? {})) {
    pile.items = pile.items.filter(keep);
  }
}

function migrateMagicItems(state: GameState): void {
  rewriteLegacyItems(state);
  const equipment = (state.equipment ?? {}) as TransitionalEquipment;
  const transitional = (state.magic ?? {}) as TransitionalMagic;
  const weaponCharges: Record<string, number> = { ...(transitional.weaponCharges ?? {}) };
  const consumedOrbs: Record<string, boolean> = { ...(transitional.consumedOrbs ?? {}) };
  const awakenedAltars: Record<string, boolean> = { ...(transitional.awakenedAltars ?? {}) };

  const offHand = equipment.offHand;
  if (offHand && isReleasedOrb(offHand.itemId)) {
    if (equipment.focus) preserveStack(state, equipment.focus);
    equipment.focus = { ...offHand };
    equipment.offHand = null;
  } else if (offHand && TWO_HANDED_STAFFS.has(equipment.mainHand?.itemId ?? "")) {
    preserveStack(state, offHand);
    equipment.offHand = null;
  }

  removeDuplicatePhysicalOrbs(state, equipment);

  const focus = equipment.focus ?? null;
  if (focus && isReleasedOrb(focus.itemId)) {
    const element = focus.itemId.slice(0, -4);
    const handId = equipment.mainHand?.itemId ?? "";
    const kind = handId.endsWith("wand") ? "wand" : handId.endsWith("staff") ? "staff" : null;
    if (kind) {
      const weaponItemId = `${element}_${kind}`;
      equipment.mainHand = { itemId: weaponItemId, quantity: 1 };
      weaponCharges[weaponItemId] = clampCharges(transitional.orbCharges?.[focus.itemId]);
      consumedOrbs[focus.itemId] = true;
    } else {
      preserveStack(state, focus);
    }
  }
  delete equipment.focus;

  // Before v6 an Orb was consumed by the first elemental weapon craft. Preserve that progress by
  // treating every previously consumed Orb as the key that awakened its matching regional altar.
  for (const [orbItemId, altarId] of Object.entries(ALTAR_BY_ORB)) {
    if (consumedOrbs[orbItemId]) awakenedAltars[altarId] = true;
  }

  state.equipment = equipment;
  state.magic = {
    weaponCharges: weaponCharges as GameState["magic"]["weaponCharges"],
    consumedOrbs: consumedOrbs as GameState["magic"]["consumedOrbs"],
    awakenedAltars: awakenedAltars as GameState["magic"]["awakenedAltars"],
  };
}

function migrateProductionWorld(state: GameState, sourceVersion: number): void {
  if (!state.world) return;
  const playedAtMs = (state.meta?.playSeconds ?? 0) * 1_000;
  state.world.nodes = Object.fromEntries(Object.entries(state.world.nodes ?? {}).map(([id, node]) => {
    const repaired = withNodeCapacity(node);
    if (sourceVersion >= 3) return [id, repaired];
    return [id, {
      ...repaired,
      respawnAtMs: repaired.state === "depleted" ? playedAtMs : null,
    }];
  }));
  state.world.campfire ??= null;
}

/**
 * Migrates the production foundation, elemental weapons, regional altar rites, and the v7 removal
 * of the retired farming feature.
 * shape. V3 existed independently on both branches, so field presence is normalized as well as
 * the numeric version; that keeps either ancestry loadable after the rebase.
 */
export function migrate(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "Save is not an object" };
  const candidate = raw as Partial<GameState>;
  const version = candidate.meta?.saveVersion;
  if (typeof version !== "number") return { ok: false, reason: "Save has no version" };
  if (!Number.isSafeInteger(version) || version < 1) {
    return { ok: false, reason: `Unsupported save version: ${String(version)}` };
  }
  if (version > SAVE_VERSION) {
    return {
      ok: false,
      reason: `Save is from a newer build (v${version} > v${SAVE_VERSION})`,
      fromVersion: version,
    };
  }

  // Migration rewrites nested stacks and world records. Clone first so validation/import callers
  // can safely retain the raw save for diagnostics or retry it with a newer build.
  const state = structuredClone(candidate) as GameState;
  try {
    state.huntContracts = normalizeHuntContracts(candidate.huntContracts, candidate.meta?.seed);
  } catch {
    return { ok: false, reason: "Invalid hunt contract save", fromVersion: version };
  }
  if (version < 2) {
    state.combat = { ...state.combat, preferredSpellId: state.combat?.preferredSpellId ?? null };
  }
  migrateMagicItems(state);
  migrateProductionWorld(state, version);
  removeFarmingContent(state);
  migrateJewelry(state);
  state.meta.saveVersion = SAVE_VERSION;
  return { ok: true, state, fromVersion: version };
}

function withNodeCapacity(
  node: GameState["world"]["nodes"][string],
): GameState["world"]["nodes"][string] {
  const remaining = Number.isFinite(node.remaining) ? Math.max(0, Math.floor(node.remaining)) : 0;
  const savedMaximum = Number.isFinite(node.maxYields)
    ? Math.max(0, Math.floor(node.maxYields))
    : remaining;
  return { ...node, remaining, maxYields: Math.max(remaining, savedMaximum) };
}

/** Idempotent v8 item aliases preserve quantities in all saved physical containers. */
function migrateJewelry(state: GameState): void {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (typeof row.itemId === 'string') row.itemId = canonicalJewelryId(row.itemId);
    for (const nested of Object.values(row)) visit(nested);
  };
  visit(state);
  state.equipment ??= {} as GameState['equipment'];
  for (const slot of EQUIP_SLOTS) state.equipment[slot] ??= null;
  const jewelry = EQUIP_SLOTS.flatMap(slot => {
    const item = state.equipment[slot];
    if (!item || !/^(crafted_(ring|earring)_t|guardian_(ring|earring)_t)/.test(item.itemId)) return [];
    const primary = item.itemId.includes("_earring_") ? "accessory2" : "accessory1";
    if (jewelrySlots(primary).includes(slot)) return [];
    state.equipment[slot] = null;
    return [item];
  });
  for (const item of jewelry) {
    const primary = item.itemId.includes('_earring_') ? 'accessory2' : 'accessory1';
    const slot = jewelrySlots(primary).find(slot => !state.equipment[slot]);
    if (slot) state.equipment[slot] = item;
    else preserveStack(state, item);
  }
  if (state.bank?.slots) {
    const merged = new Map<string, LooseStack>();
    for (const item of state.bank.slots) {
      const prior = merged.get(item.itemId);
      if (prior) prior.quantity += item.quantity;
      else merged.set(item.itemId, { ...item });
    }
    state.bank.slots = [...merged.values()];
  }
}
