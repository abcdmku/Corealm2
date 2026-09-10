/** Essence casting, elemental-weapon charge, and altar recharge rules. */
import type {
  ElementalWeaponChargeSpec, EquippedMagicWeaponView, ItemDef, ItemId, Result, SemanticEntity,
  SpellElement,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { SpellDef } from "../content/index.js";
import { content } from "../content/index.js";
import type { EventBus } from "../core/events.js";
import type { GameState, Store } from "../state/store.js";
import type { InteractionDispatcher } from "../world/interactions.js";

export const RELEASED_MAGIC_ELEMENTS: readonly SpellElement[] =
  ["wind", "earth", "water", "fire"] as const;

export const ELEMENT_LABELS: Readonly<Record<SpellElement, string>> = {
  wind: "Air",
  earth: "Earth",
  water: "Water",
  fire: "Fire",
};

export const ESSENCE_BY_ELEMENT: Readonly<Partial<Record<SpellElement, ItemId>>> = {
  wind: "air_essence",
  earth: "earth_essence",
  water: "water_essence",
  fire: "fire_essence",
};

export const ORB_BY_ELEMENT: Readonly<Partial<Record<SpellElement, ItemId>>> = {
  wind: "air_orb",
  earth: "earth_orb",
  water: "water_orb",
  fire: "fire_orb",
};

export interface MagicLoadout {
  weaponItemId: ItemId;
  weapon: ItemDef;
  charge: ElementalWeaponChargeSpec | null;
  charges: number;
  castMs: number;
}

/** The equipped magic weapon. Plain weapons are valid and use carried Essence. */
export function magicLoadout(state: GameState): MagicLoadout | null {
  const weaponStack = state.equipment.mainHand;
  if (!weaponStack) return null;
  const weapon = content.item(weaponStack.itemId);
  if (!weapon?.magicWeapon) return null;
  const charge = weapon.magicWeapon.charge ?? null;
  return {
    weaponItemId: weapon.id,
    weapon,
    charge,
    charges: charge ? weaponCharge(state, weapon.id) : 0,
    castMs: weapon.equip?.attackSpeedMs ?? 3_000,
  };
}

/** Returns current weapon charge, clamped to the authored capacity. */
export function weaponCharge(state: GameState, weaponItemId: ItemId): number {
  const charge = content.item(weaponItemId)?.magicWeapon?.charge;
  if (!charge) return 0;
  const raw = state.magic.weaponCharges[weaponItemId];
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(charge.capacity, Math.floor(raw)));
}

/** A newly crafted elemental weapon receives its authored starting charge exactly once. */
export function initialiseWeaponCharge(state: GameState, weaponItemId: ItemId): number | null {
  const charge = content.item(weaponItemId)?.magicWeapon?.charge;
  if (!charge) return null;
  const existing = state.magic.weaponCharges[weaponItemId];
  if (Number.isFinite(existing)) return weaponCharge(state, weaponItemId);
  const initial = Math.max(0, Math.min(charge.capacity, Math.floor(charge.initialCharges)));
  state.magic.weaponCharges[weaponItemId] = initial;
  return initial;
}

function carriedInState(state: GameState, itemId: ItemId): number {
  let quantity = 0;
  for (const stack of state.inventory.slots) {
    if (stack?.itemId === itemId) quantity += stack.quantity;
  }
  return quantity;
}

/** One reason, in command-validation order, or null when this spell can launch now. */
export function spellBlockReason(state: GameState, spell: SpellDef): string | null {
  if (state.skills.magic.level < spell.reqLevel) return `${spell.name} needs Magic ${spell.reqLevel}.`;
  if (!RELEASED_MAGIC_ELEMENTS.includes(spell.cost.element)) {
    return `${ELEMENT_LABELS[spell.cost.element]} magic is not released yet.`;
  }

  const loadout = magicLoadout(state);
  if (!loadout) return "Equip a wand or staff first.";

  if (
    loadout.charge?.released
    && loadout.charge.element === spell.cost.element
    && loadout.charges >= spell.cost.charges
  ) {
    return runeBlockReason(state, spell);
  }

  const essenceItemId = ESSENCE_BY_ELEMENT[spell.cost.element];
  if (!essenceItemId) return `${ELEMENT_LABELS[spell.cost.element]} magic is not released yet.`;
  if (carriedInState(state, essenceItemId) >= spell.cost.charges) return runeBlockReason(state, spell);

  const label = ELEMENT_LABELS[spell.cost.element];
  return `Carry ${spell.cost.charges} ${label} Essence to cast ${spell.name}.`;
}

/**
 * The secondary runes an invocation burns, checked after its Essence.
 *
 * Checked LAST on purpose: Essence is the fuel every spell shares and the reason a caster is most
 * often blocked, so it keeps the first word. A weapon charge never stands in for a rune; charges
 * are Essence pressed into a staff, and the runes are a separate purchase.
 */
function runeBlockReason(state: GameState, spell: SpellDef): string | null {
  for (const rune of spell.cost.runes ?? []) {
    if (carriedInState(state, rune.itemId) >= rune.quantity) continue;
    const name = content.item(rune.itemId)?.name ?? rune.itemId;
    return `Carry ${rune.quantity} ${name} to cast ${spell.name}.`;
  }
  return null;
}

/** Carried count of every rune this spell spends, for the spellbook row. */
export function spellRunesCarried(
  state: GameState,
  spell: SpellDef,
): { itemId: ItemId; name: string; quantity: number; carried: number }[] {
  return (spell.cost.runes ?? []).map((rune) => ({
    itemId: rune.itemId,
    name: content.item(rune.itemId)?.name ?? rune.itemId,
    quantity: rune.quantity,
    carried: carriedInState(state, rune.itemId),
  }));
}

export interface SpellFuelInventory {
  countItem(itemId: ItemId): number;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
}

/** Runes removed by one cast, present only when the spell spends any. */
export interface SpellRuneSpend { itemId: ItemId; quantity: number; remaining: number }

export type SpellFuelSpend =
  | { source: "weapon"; weaponItemId: ItemId; remainingCharges: number; runes?: SpellRuneSpend[] }
  | { source: "essence"; essenceItemId: ItemId; remainingEssence: number; runes?: SpellRuneSpend[] };

/** Charged matching weapons pay first. Plain, empty, or other-element weapons spend Essence. */
export function spendSpellFuel(
  state: GameState,
  spell: SpellDef,
  inventory: SpellFuelInventory,
): Result<SpellFuelSpend> {
  const blocked = spellBlockReason(state, spell);
  if (blocked) return err("NOT_ENOUGH_ITEMS", blocked);
  const loadout = magicLoadout(state);
  if (!loadout) return err("REQUIREMENTS_NOT_MET", "Equip a wand or staff first.");

  if (
    loadout.charge?.released
    && loadout.charge.element === spell.cost.element
    && loadout.charges >= spell.cost.charges
  ) {
    const remainingCharges = loadout.charges - spell.cost.charges;
    state.magic.weaponCharges[loadout.weaponItemId] = remainingCharges;
    const runes = spendRunes(spell, inventory);
    if (!runes.ok) return runes;
    return ok({ source: "weapon", weaponItemId: loadout.weaponItemId, remainingCharges, ...runes.value });
  }

  const essenceItemId = ESSENCE_BY_ELEMENT[spell.cost.element];
  if (!essenceItemId) {
    return err("UNAVAILABLE", `${ELEMENT_LABELS[spell.cost.element]} magic is not released yet.`);
  }
  const removed = inventory.removeItem(essenceItemId, spell.cost.charges);
  if (!removed.ok) return removed;
  const runes = spendRunes(spell, inventory);
  if (!runes.ok) return runes;
  return ok({
    source: "essence",
    essenceItemId,
    remainingEssence: inventory.countItem(essenceItemId),
    ...runes.value,
  });
}

/**
 * Removes the spell's runes. `spellBlockReason` has already confirmed they are carried, so a
 * failure here is a genuine inventory fault rather than a shortfall. Returns an empty object for
 * the basics so their spend result is byte-for-byte what it always was.
 */
function spendRunes(spell: SpellDef, inventory: SpellFuelInventory): Result<{ runes?: SpellRuneSpend[] }> {
  const costs = spell.cost.runes ?? [];
  if (costs.length === 0) return ok({});
  const runes: SpellRuneSpend[] = [];
  for (const cost of costs) {
    const removed = inventory.removeItem(cost.itemId, cost.quantity);
    if (!removed.ok) return removed;
    runes.push({ itemId: cost.itemId, quantity: cost.quantity, remaining: inventory.countItem(cost.itemId) });
  }
  return ok({ runes });
}

export function equippedMagicWeaponView(state: GameState): EquippedMagicWeaponView | null {
  const loadout = magicLoadout(state);
  const charge = loadout?.charge;
  if (!loadout || !charge || !charge.released) return null;
  return {
    itemId: loadout.weaponItemId,
    name: loadout.weapon.name,
    element: charge.element,
    charges: loadout.charges,
    capacity: charge.capacity,
    rechargeItemId: charge.rechargeItemId,
    rechargeCost: charge.rechargeCost,
  };
}

interface EssenceInventory {
  countItem(itemId: ItemId): number;
  removeItem(
    itemId: ItemId,
    quantity: number,
    options?: { eventData?: Record<string, unknown> },
  ): Result<number>;
}

interface EssenceAltarEntities {
  get(id: string): SemanticEntity | undefined;
  all(): SemanticEntity[];
}

export interface EssenceSystemDeps {
  store: Store;
  events: EventBus;
  inventory: EssenceInventory;
  dispatcher: InteractionDispatcher;
  entities: EssenceAltarEntities;
  /** Rebuilds entity presentation after a dormant/awakened material identity change. */
  syncViews?: () => void;
  now: () => number;
}

/** Owns persistent Essence Altar awakening and recharge. Casting remains CombatSystem's responsibility. */
export class EssenceSystem {
  constructor(private readonly deps: EssenceSystemDeps) {
    deps.dispatcher.registerHandler("awaken", (context) => this.awaken(context.entity.id));
    deps.dispatcher.registerHandler("recharge", (context) => this.recharge(context.entity.id));
    this.hydrateAltars();
    deps.store.subscribe(() => this.hydrateAltars());
  }

  awaken(altarId: string): Result<{ started: string }> {
    const state = this.deps.store.get();
    const altar = this.deps.entities.get(altarId);
    const element = altarElement(altar);
    if (!altar || !element) {
      return err("INVALID_ARGUMENT", `${altarId} is not a regional Essence Altar.`, altarId);
    }
    if (state.magic.awakenedAltars[altarId]) {
      this.applyAltarState(altar, true);
      return err("UNAVAILABLE", `${altar.name} is already awakened.`, altarId);
    }

    const orbItemId = ORB_BY_ELEMENT[element];
    if (!orbItemId) return err("UNAVAILABLE", `${ELEMENT_LABELS[element]} altars are not released yet.`, altarId);
    if (this.deps.inventory.countItem(orbItemId) < 1) {
      const orbName = content.item(orbItemId)?.name ?? orbItemId;
      return err("NOT_ENOUGH_ITEMS", `${altar.name} needs the ${orbName} carried by this region's boss.`, altarId);
    }

    const paid = this.deps.inventory.removeItem(
      orbItemId,
      1,
      { eventData: { reason: "consumed", source: "altar_awakening", altarId, element } },
    );
    if (!paid.ok) return paid;

    state.magic.consumedOrbs[orbItemId] = true;
    state.magic.awakenedAltars[altarId] = true;
    this.applyAltarState(altar, true);
    this.deps.store.markDirty();
    this.deps.syncViews?.();
    this.deps.events.emit(
      "essence.altarAwakened",
      { altarId, element, orbItemId },
      altarId,
      this.deps.now(),
    );
    return ok({ started: `awakened ${altar.name}` });
  }

  recharge(altarId: string): Result<{ started: string }> {
    const state = this.deps.store.get();
    const altar = this.deps.entities.get(altarId);
    const element = altarElement(altar);
    if (!altar || !element) {
      return err("INVALID_ARGUMENT", `${altarId} is not a regional Essence Altar.`, altarId);
    }
    if (!state.magic.awakenedAltars[altarId]) {
      return err("UNAVAILABLE", `${altar.name} is dormant. Awaken it with its boss Orb first.`, altarId);
    }
    const loadout = magicLoadout(state);
    const charge = loadout?.charge;
    if (!loadout || !charge || !charge.released) {
      return err("REQUIREMENTS_NOT_MET", "Equip a charged elemental wand or staff first.", altarId);
    }
    if (charge.element !== element) {
      return err(
        "REQUIREMENTS_NOT_MET",
        `${altar.name} can recharge only ${ELEMENT_LABELS[element]} weapons.`,
        altarId,
      );
    }

    const before = loadout.charges;
    if (before >= charge.capacity) {
      return err("UNAVAILABLE", `${loadout.weapon.name} is already fully charged.`, altarId);
    }
    const held = this.deps.inventory.countItem(charge.rechargeItemId);
    if (held < charge.rechargeCost) {
      const essenceName = content.item(charge.rechargeItemId)?.name ?? charge.rechargeItemId;
      return err(
        "NOT_ENOUGH_ITEMS",
        `${loadout.weapon.name} needs ${charge.rechargeCost} ${essenceName}; you have ${held}.`,
        altarId,
      );
    }

    const paid = this.deps.inventory.removeItem(
      charge.rechargeItemId,
      charge.rechargeCost,
      { eventData: { reason: "consumed", source: "essence_altar", altarId } },
    );
    if (!paid.ok) return paid;
    state.magic.weaponCharges[loadout.weaponItemId] = charge.capacity;
    this.deps.store.markDirty();
    this.deps.events.emit(
      "essence.recharged",
      {
        altarId,
        weaponItemId: loadout.weaponItemId,
        element: charge.element,
        before,
        after: charge.capacity,
        essenceItemId: charge.rechargeItemId,
        essenceSpent: charge.rechargeCost,
      },
      altarId,
      this.deps.now(),
    );
    return ok({ started: `recharged ${loadout.weapon.name} to ${charge.capacity}` });
  }

  /** Applies saved altar state to semantic entities after boot, load, or debug reset. */
  hydrateAltars(): void {
    const state = this.deps.store.get();
    let changed = false;
    for (const entity of this.deps.entities.all()) {
      if (!altarElement(entity)) continue;
      changed = this.applyAltarState(entity, state.magic.awakenedAltars[entity.id] === true) || changed;
    }
    if (changed) this.deps.syncViews?.();
  }

  private applyAltarState(altar: SemanticEntity, awakened: boolean): boolean {
    const state = awakened ? "awakened" : "dormant";
    const interactions = awakened
      ? (["inspect", "produce", "recharge"] as const)
      : (["inspect", "awaken"] as const);
    let changed = altar.state !== state
      || altar.interactions.length !== interactions.length
      || altar.interactions.some((interaction, index) => interaction !== interactions[index]);
    altar.state = state;
    altar.interactions = [...interactions];
    for (const entity of this.deps.entities.all()) {
      if (entity.meta?.essenceAltarRuins !== true || entity.meta.essenceAltarId !== altar.id) continue;
      if (entity.state !== state) changed = true;
      entity.state = state;
    }
    return changed;
  }
}

function altarElement(entity: SemanticEntity | undefined): SpellElement | null {
  if (!entity
    || entity.archetype !== "station"
    || entity.station?.kind !== "essence_altar"
    || entity.meta?.essenceAltar !== true) return null;
  const element = entity.meta.essenceElement;
  return element === "wind" || element === "earth" || element === "water" || element === "fire"
    ? element
    : null;
}
