import { err, ok, type Result, type SemanticEntity, type UpgradeRequest, type UpgradeResult } from '../contracts.js';
import { content } from '../content/index.js';
import { BOOSTER_PRICE, ENCHANTMENTS, enchantmentFits, isJewelry, isUpgradeable, itemUpgrade, requiredUpgradeScroll, UPGRADE_BOOSTER, upgradeChance, upgradedItemId } from '../content/itemUpgrades.js';
import type { Store } from '../state/store.js';
import type { InventorySystem } from './inventory.js';
import type { EventBus } from '../core/events.js';
import type { InteractionDispatcher } from '../world/interactions.js';
import { distanceXZ } from '../core/math.js';
import { INTERACT_RANGE } from '../app/config.js';

export class UpgradingSystem {
  constructor(private readonly deps: { store: Store; inventory: InventorySystem; events: EventBus; now(): number;
    random(): number; entity(id: string): SemanticEntity | undefined; dispatcher?: InteractionDispatcher }) {
    deps.dispatcher?.registerHandler('upgrade', ({ entity }) => {
      if (!entity.meta?.upgradeFount) return err('INVALID_ARGUMENT', 'This is not an upgrade fount');
      deps.events.emit('activity.started', { kind: 'upgrade', interaction: 'upgrade' }, entity.id, deps.now());
      return ok({ started: 'Opened Upgrade Fount' });
    });
  }

  perform(request: UpgradeRequest): Result<UpgradeResult> {
    const { store, inventory } = this.deps;
    const state = store.get(), fount = this.deps.entity(request.fountId);
    if (!fount?.meta?.upgradeFount) return err('NOT_FOUND', 'Upgrade fount not found');
    if (state.player.health <= 0) return err('DEAD', 'You cannot upgrade while dead');
    if (state.activity || state.combat.targetId || state.combat.engagedBy.length) return err('BUSY', 'Finish your activity or combat first');
    if (fount.regionId !== state.player.regionId || distanceXZ(state.player.position, fount.interactionPosition ?? fount.position) > INTERACT_RANGE)
      return err('OUT_OF_RANGE', 'Stand beside the Upgrade Fount');
    const boosters = request.boosters ?? 0;
    if (!Number.isInteger(boosters) || boosters < 0 || boosters > 9) return err('INVALID_ARGUMENT', 'Choose zero through nine boosters');
    if (request.mode === 'buy-booster') {
      if (state.currency < BOOSTER_PRICE) return err('NOT_ENOUGH_CURRENCY', 'A Fount Blessing costs 100,000,000 gold');
      if (!inventory.hasSpaceFor(UPGRADE_BOOSTER, 1)) return err('INVENTORY_FULL', 'Make room for a Fount Blessing');
      inventory.spendCurrency(BOOSTER_PRICE); inventory.addItem(UPGRADE_BOOSTER, 1);
      return ok({ success: true, chance: 1, itemId: UPGRADE_BOOSTER, message: 'Purchased one Fount Blessing' });
    }
    const def = request.itemId ? content.item(request.itemId) : undefined;
    if (!def || !isUpgradeable(def)) return err('INVALID_ARGUMENT', 'Choose carried armor, a weapon, or jewelry');
    const identity = itemUpgrade(def.id);
    const jewelry = isJewelry(def);
    let output: string, chance: number, material: string | undefined, copies = 1;
    if (request.mode === 'magic') {
      if (boosters) return err('INVALID_ARGUMENT', 'Magic enhancement does not use boosters');
      const enchantment = request.enchantment;
      if (!enchantment || !ENCHANTMENTS.includes(enchantment) || !enchantmentFits(def, enchantment)) return err('INVALID_ARGUMENT', 'This magic cannot be applied to that item');
      if (identity.enchantment === enchantment) return err('INVALID_ARGUMENT', 'This item already has that magic');
      output = upgradedItemId(def.id, identity.rank, enchantment); chance = 1; material = `enchant_${enchantment}`;
    } else if (request.mode === 'rank') {
      if (identity.rank >= 10) return err('INVALID_ARGUMENT', 'This item is already +10');
      if (jewelry && boosters) return err('INVALID_ARGUMENT', 'Jewelry combining does not use boosters');
      copies = jewelry ? 3 : 1;
      material = jewelry ? undefined : requiredUpgradeScroll(def);
      output = upgradedItemId(def.id, identity.rank + 1, identity.enchantment);
      chance = upgradeChance(def, boosters);
    } else return err('INVALID_ARGUMENT', 'Unknown upgrade operation');
    if (inventory.countOf(def.id) < copies) return err('NOT_ENOUGH_ITEMS', jewelry ? 'Bring three identical pieces at the same rank' : 'That piece is no longer in your inventory');
    if (material && inventory.countOf(material) < 1) return err('NOT_ENOUGH_ITEMS', `You need ${content.item(material)?.name ?? material}`);
    if (inventory.countOf(UPGRADE_BOOSTER) < boosters) return err('NOT_ENOUGH_ITEMS', `You need ${boosters} Fount Blessings`);
    if (!content.item(output)) return err('NOT_FOUND', 'The resulting item is unavailable');
    // Synchronous authority transaction: validation precedes the single random draw and all writes.
    const success = chance >= 1 || this.deps.random() < chance;
    inventory.removeItem(def.id, copies);
    if (material) inventory.removeItem(material, 1);
    if (boosters) inventory.removeItem(UPGRADE_BOOSTER, boosters);
    if (success && def.magicWeapon?.charge) state.magic.weaponCharges[output] = state.magic.weaponCharges[def.id] ?? 0;
    if (success) inventory.addItem(output, 1); // Removing non-stackable equipment always frees the output slot.
    store.markDirty();
    return ok({ success, chance, itemId: success ? output : null,
      message: success ? `Created ${content.item(output)!.name}` : `Upgrade failed. ${copies === 3 ? 'All three pieces were' : def.name + ' was'} destroyed.` });
  }
}
