import { err, ok, type InventorySlot, type ItemStack, type Result, type TradeAction, type TradeView } from "../contracts.js";
import { content } from "../content/index.js";
import { distanceXZ } from "../core/math.js";
import { sameCombatRealm } from "../systems/combat.js";
import { MAX_STACK } from "../systems/inventory.js";
import type { HeadlessWorld } from "./headlessWorld.js";

/** Offers never escrow items. Validate both complete inventories before committing either. */
export class WorldExchange {
  private readonly trades = new Map<string, TradeView>();
  private serial = 0;
  constructor(private readonly world: HeadlessWorld) {}
  view(id: string): TradeView | null { return structuredClone(this.trades.get(id) ?? null); }
  cancel(id: string): void {
    const trade = this.trades.get(id);
    if (trade) for (const member of trade.participants) this.trades.delete(member.id);
  }
  private available(a: string, b: string): boolean {
    const first = this.world.players.get(a)?.store.get().player, second = this.world.players.get(b)?.store.get().player;
    return !!first && !!second && this.world.active.has(a) && this.world.active.has(b)
      && first.health > 0 && second.health > 0 && sameCombatRealm(first.regionId, second.regionId)
      && distanceXZ(first.position, second.position) <= 5;
  }
  tick(): void {
    for (const [id, trade] of this.trades) if (trade.expiresAtMs <= this.world.clock.elapsedMs
      || !this.available(trade.participants[0]!.id, trade.participants[1]!.id)) this.cancel(id);
  }
  private transferable(itemId: string): boolean {
    const def = content.item(itemId);
    // These carry character-owned progression, not transferable item-instance state.
    return !!def && def.category !== "quest" && !def.orb && !def.magicWeapon?.charge;
  }
  drop(id: string, itemId: string, quantity: number): Result<unknown> {
    const player = this.world.players.get(id)!;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) return err("INVALID_ARGUMENT", "Enter a whole quantity from 1 to 1,000,000.");
    if (!this.transferable(itemId)) return err("UNAVAILABLE", "Quest items, orbs and charged weapons cannot be dropped or traded.");
    if (player.store.get().player.health <= 0) return err("UNAVAILABLE", "You cannot drop items while dead.");
    const removed = player.inventory.removeItem(itemId, quantity);
    if (!removed.ok) return removed;
    const state = player.store.get(), position = [...state.player.position] as [number, number, number];
    let pileId: string;
    do { pileId = `drop:${id}:${this.world.clock.tick}:${++this.serial}`; } while (this.world.entities.get(pileId));
    const items = [{ itemId, quantity, stackId: `${pileId}:0` }];
    const expiresAtMs = this.world.clock.elapsedMs + 300_000;
    this.world.shared.lootPiles[pileId] = { position, items, ownerId: id, ownerOnly: false, expiresAtMs };
    this.world.entities.add({ id: pileId, name: `${state.player.name}'s dropped items`, archetype: "loot", tier: 1,
      regionId: state.player.regionId, position, state: "available", interactions: ["inspect", "loot"], loot: items,
      view: { assetId: "crate_wood", scale: .5 }, meta: { expiresAtMs } });
    return ok({ pileId, quantity });
  }
  command(id: string, action: TradeAction): Result<unknown> {
    this.tick();
    if (action.kind === "request") {
      if (id === action.playerId || !this.available(id, action.playerId)) return err("UNAVAILABLE", "Move within 5 metres of the other player to trade.");
      if (this.trades.has(id) || this.trades.has(action.playerId)) return err("UNAVAILABLE", "One of you already has a trade open.");
      const trade: TradeView = { id: `trade:${this.world.clock.tick}:${++this.serial}`, revision: 0,
        expiresAtMs: this.world.clock.elapsedMs + 120_000,
        participants: [id, action.playerId].map(playerId => ({ id: playerId, name: this.world.players.get(playerId)!.store.get().player.name, items: [], accepted: false })) };
      for (const member of trade.participants) this.trades.set(member.id, trade);
      return ok({ tradeId: trade.id });
    }
    const trade = this.trades.get(id);
    if (!trade || action.tradeId !== trade.id) return err("UNAVAILABLE", "That trade has closed.");
    if (action.kind === "cancel") { this.cancel(id); return ok({ cancelled: true }); }
    const member = trade.participants.find(member => member.id === id)!;
    if (action.kind === "offer") {
      if (!Number.isSafeInteger(action.quantity) || action.quantity < 0 || action.quantity > 1_000_000) return err("INVALID_ARGUMENT", "Enter a whole quantity from 0 to 1,000,000.");
      if (!this.transferable(action.itemId)) return err("UNAVAILABLE", "Quest items, orbs and charged weapons cannot be dropped or traded.");
      if (this.world.players.get(id)!.inventory.countOf(action.itemId) < action.quantity) return err("NOT_ENOUGH_ITEMS", "You no longer have that quantity.");
      if (action.quantity && member.items.length >= 29 && !member.items.some(item => item.itemId === action.itemId)) return err("UNAVAILABLE", "A trade can contain at most 29 different items.");
      member.items = member.items.filter(item => item.itemId !== action.itemId);
      if (action.quantity) member.items.push({ itemId: action.itemId, quantity: action.quantity });
      trade.revision++;
      for (const participant of trade.participants) participant.accepted = false;
      return ok({ revision: trade.revision });
    }
    if (action.revision !== trade.revision) return err("UNAVAILABLE", "The offer changed. Review it before accepting.");
    member.accepted = true;
    if (!trade.participants.every(member => member.accepted)) return ok({ waiting: true });
    const projections = trade.participants.map((member, index) => {
      const state = this.world.players.get(member.id)!.store.get();
      return this.project(state.inventory.slots, state.currency, member.items, trade.participants[1 - index]!.items);
    });
    if (projections.some(result => !result)) {
      trade.revision++;
      for (const participant of trade.participants) participant.accepted = false;
      return err("UNAVAILABLE", "Trade could not complete. Check that both players still have the items and enough inventory space.");
    }
    trade.participants.forEach((participant, index) => {
      const player = this.world.players.get(participant.id)!, state = player.store.get(), next = projections[index]!;
      state.inventory.slots = next.slots; state.currency = next.currency; player.store.markDirty();
      for (const stack of participant.items) player.events.emit("item.lost", { ...stack, source: "trade" }, undefined, this.world.clock.elapsedMs);
      for (const stack of trade.participants[1 - index]!.items) player.events.emit("item.received", { ...stack, source: "trade" }, undefined, this.world.clock.elapsedMs);
    });
    this.cancel(id);
    return ok({ completed: true });
  }
  private project(original: (InventorySlot | null)[], balance: number, outgoing: ItemStack[], incoming: ItemStack[]) {
    const slots = structuredClone(original); let currency = balance;
    for (const item of outgoing) {
      if (!this.transferable(item.itemId)) return null;
      if (content.item(item.itemId)!.category === "currency") { if (currency < item.quantity) return null; currency -= item.quantity; continue; }
      let left = item.quantity;
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index]; if (!slot || slot.itemId !== item.itemId) continue;
        const take = Math.min(left, slot.quantity); left -= take; slot.quantity -= take;
        if (!slot.quantity) slots[index] = null;
      }
      if (left) return null;
    }
    for (const item of incoming) {
      const def = content.item(item.itemId); if (!def || !this.transferable(item.itemId)) return null;
      if (def.category === "currency") { currency += item.quantity; if (!Number.isSafeInteger(currency)) return null; continue; }
      let left = item.quantity;
      const existing = def.stackable ? slots.find(slot => slot?.itemId === item.itemId) : null;
      if (existing) { if (existing.quantity + left > MAX_STACK) return null; existing.quantity += left; left = 0; }
      for (let index = 0; index < slots.length && left; index++) if (!slots[index]) {
        const quantity = def.stackable ? Math.min(left, MAX_STACK) : 1;
        slots[index] = { slotIndex: index, itemId: item.itemId, quantity }; left -= quantity;
      }
      if (left) return null;
    }
    return { slots, currency };
  }
}
