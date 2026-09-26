/** Portable, per-essence fuel reservoirs. A tome contributes only while carried. */
import type { EssenceTomeView, ItemId, Result, SemanticEntity } from "../contracts.js";
import { INTERACT_RANGE } from "../app/config.js";
import { distanceXZ } from "../core/math.js";
import { err, ok } from "../contracts.js";
import { content } from "../content/index.js";
import type { GameState, Store } from "../state/store.js";

export const ESSENCE_IDS: readonly ItemId[] = [
  "air_essence", "earth_essence", "water_essence", "fire_essence",
  "arc_essence", "cosmic_essence", "temporal_essence",
];

export const TOME_SPECS = [
  { itemId: "master_essence_tome", essencePerRecharge: 1000, chargeCapacity: 1000 },
  { itemId: "adept_essence_tome", essencePerRecharge: 500, chargeCapacity: 500 },
  { itemId: "apprentice_essence_tome", essencePerRecharge: 100, chargeCapacity: 100 },
] as const;

export interface EssenceInventory {
  countItem(itemId: ItemId): number;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
}

export interface EssenceCost { itemId: ItemId; quantity: number }
export interface EssenceFuelSpend {
  tomeChargesSpent: { tomeId: ItemId; essenceId: ItemId; quantity: number; remaining: number }[];
  looseEssenceSpent: { itemId: ItemId; quantity: number; remaining: number }[];
}

function carried(state: GameState, itemId: ItemId): number {
  return state.inventory.slots.reduce(
    (count, slot) => count + (slot?.itemId === itemId ? slot.quantity : 0), 0,
  );
}

function specFor(tomeId: ItemId) {
  return TOME_SPECS.find((spec) => spec.itemId === tomeId);
}

export function tomeCharges(state: GameState, tomeId: ItemId, essenceId: ItemId): number {
  const spec = specFor(tomeId);
  if (!spec || !ESSENCE_IDS.includes(essenceId)) return 0;
  const raw = state.magic.tomeCharges[tomeId]?.[essenceId];
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(0, Math.min(spec.chargeCapacity, Math.floor(raw)))
    : 0;
}

/** The same view works for the authoritative state and a replicated player state. */
export function essenceTomeViews(state: GameState): EssenceTomeView[] {
  return TOME_SPECS.filter((spec) => carried(state, spec.itemId) > 0).map((spec) => ({
    itemId: spec.itemId,
    name: content.item(spec.itemId)?.name ?? spec.itemId,
    essencePerRecharge: spec.essencePerRecharge,
    chargeCapacity: spec.chargeCapacity,
    essences: ESSENCE_IDS.map((essenceId) => {
      const charges = tomeCharges(state, spec.itemId, essenceId);
      const held = carried(state, essenceId);
      return {
        itemId: essenceId,
        name: content.item(essenceId)?.name ?? essenceId,
        charges,
        carried: held,
        canImbue: charges === 0 && held >= spec.essencePerRecharge,
      };
    }),
  }));
}

export function availableEssenceFuel(state: GameState, essenceId: ItemId): number {
  if (!ESSENCE_IDS.includes(essenceId)) return 0;
  return carried(state, essenceId) + TOME_SPECS.reduce(
    (sum, spec) => sum + (carried(state, spec.itemId) > 0
      ? tomeCharges(state, spec.itemId, essenceId) : 0), 0,
  );
}

/** An indivisible fuel purchase: all costs are planned before any inventory or charge changes. */
export function spendEssenceFuel(
  state: GameState, inventory: EssenceInventory, costs: readonly EssenceCost[],
): Result<EssenceFuelSpend> {
  const requested = new Map<ItemId, number>();
  for (const cost of costs) {
    if (!ESSENCE_IDS.includes(cost.itemId) || !Number.isSafeInteger(cost.quantity) || cost.quantity < 1) {
      return err("INVALID_ARGUMENT", "Essence cost must name a known essence and a positive whole quantity.");
    }
    requested.set(cost.itemId, (requested.get(cost.itemId) ?? 0) + cost.quantity);
  }
  const tomePlan: { tomeId: ItemId; essenceId: ItemId; quantity: number; remaining: number }[] = [];
  const loosePlan: { itemId: ItemId; quantity: number }[] = [];
  for (const [essenceId, required] of requested) {
    let left = required;
    for (const spec of TOME_SPECS) {
      if (carried(state, spec.itemId) < 1) continue;
      const current = tomeCharges(state, spec.itemId, essenceId);
      const quantity = Math.min(left, current);
      if (quantity > 0) tomePlan.push({ tomeId: spec.itemId, essenceId, quantity, remaining: current - quantity });
      left -= quantity;
      if (left === 0) break;
    }
    if (left > inventory.countItem(essenceId)) {
      const name = content.item(essenceId)?.name ?? essenceId;
      return err("NOT_ENOUGH_ITEMS", `Need ${required} ${name} fuel; ${availableEssenceFuel(state, essenceId)} available.`);
    }
    if (left > 0) loosePlan.push({ itemId: essenceId, quantity: left });
  }
  const looseEssenceSpent: EssenceFuelSpend["looseEssenceSpent"] = [];
  for (const row of loosePlan) {
    const removed = inventory.removeItem(row.itemId, row.quantity);
    if (!removed.ok) return removed;
    looseEssenceSpent.push({ ...row, remaining: inventory.countItem(row.itemId) });
  }
  for (const row of tomePlan) {
    state.magic.tomeCharges[row.tomeId] ??= {};
    state.magic.tomeCharges[row.tomeId]![row.essenceId] = row.remaining;
  }
  return ok({ tomeChargesSpent: tomePlan, looseEssenceSpent });
}

export class EssenceTomeSystem {
  constructor(private readonly deps: { store: Store; inventory: EssenceInventory; altars: () => readonly SemanticEntity[] }) {}

  list(): EssenceTomeView[] { return essenceTomeViews(this.deps.store.get()); }
  available(essenceId: ItemId): number { return availableEssenceFuel(this.deps.store.get(), essenceId); }

  imbue(tomeId: ItemId, essenceId: ItemId): Result<{charges: number; essenceSpent: number}> {
    const spec = specFor(tomeId);
    if (!spec || !ESSENCE_IDS.includes(essenceId)) return err("INVALID_ARGUMENT", "Choose a tome and essence type.");
    const state = this.deps.store.get();
    const nearby = this.deps.altars().filter((altar) => altar.station?.kind === "essence_altar"
      && altar.meta?.essenceAltar === true && altar.regionId === state.player.regionId
      && distanceXZ(altar.position, state.player.position) <= INTERACT_RANGE
      && Math.abs(altar.position[1] - state.player.position[1]) <= 3);
    if (nearby.length === 0) return err("OUT_OF_RANGE", "Bring your tome and essence to an Essence Altar to imbue it.");
    if (!nearby.some((altar) => state.magic.awakenedAltars[altar.id])) {
      return err("REQUIREMENTS_NOT_MET", "Awaken the Essence Altar before imbuing your tome.");
    }
    if (carried(state, tomeId) < 1) return err("NOT_ENOUGH_ITEMS", "Carry the tome to imbue it.");
    if (tomeCharges(state, tomeId, essenceId) > 0) {
      return err("REQUIREMENTS_NOT_MET", "Spend this tome's remaining charges before recharging that essence.");
    }
    if (this.deps.inventory.countItem(essenceId) < spec.essencePerRecharge) {
      return err("NOT_ENOUGH_ITEMS", `Need ${spec.essencePerRecharge} ${content.item(essenceId)?.name ?? essenceId} to imbue this tome.`);
    }
    const removed = this.deps.inventory.removeItem(essenceId, spec.essencePerRecharge);
    if (!removed.ok) return removed;
    state.magic.tomeCharges[tomeId] ??= {};
    state.magic.tomeCharges[tomeId]![essenceId] = spec.chargeCapacity;
    this.deps.store.markDirty();
    return ok({ charges: spec.chargeCapacity, essenceSpent: spec.essencePerRecharge });
  }

  spend(costs: readonly EssenceCost[]): Result<EssenceFuelSpend> {
    const result = spendEssenceFuel(this.deps.store.get(), this.deps.inventory, costs);
    if (result.ok && result.value.tomeChargesSpent.length > 0) this.deps.store.markDirty();
    return result;
  }
}
