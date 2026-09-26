import { serializeSave, loadSerializedSave } from "../game/src/persistence/storage.js";
import { BankSystem } from "../game/src/systems/bank.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";
import { beforeAll, describe, expect, it } from 'vitest';
import { content } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { BOOSTER_PRICE, DROP_RANK_WEIGHTS, equipmentDropRank, isJewelry, itemUpgrade, requiredUpgradeScroll, upgradeChance, upgradedItemId } from '../game/src/content/itemUpgrades.js';
import { Store } from '../game/src/state/store.js';
import { EventBus } from '../game/src/core/events.js';
import { InventorySystem } from '../game/src/systems/inventory.js';
import { EquipmentSystem } from '../game/src/systems/equipment.js';
import { UpgradingSystem } from '../game/src/systems/upgrading.js';
import { createUpgradeFount } from '../game/src/world/upgradeFount.js';
import { gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import { EQUIPMENT_SETS, inferEquipmentSets } from '../game/src/content/equipmentSets.js';

beforeAll(() => content.register({ items: ALL_ITEMS }));
function setup(roll = 0) {
  const store = new Store(42), events = new EventBus(), now = () => 0;
  store.get().inventory.slots.fill(null);
  const fount = createUpgradeFount('fount', [0, 0, 2.5], store.get().player.regionId);
  store.get().player.position = [0, 0, 0];
  const inventory = new InventorySystem({ store, events, now });
  const equipment = new EquipmentSystem({ store, events, inventory, now });
  let rolls = 0;
  const upgrading = new UpgradingSystem({ store, inventory, events, now, entity: () => fount, random: () => { rolls++; return roll; } });
  return { store, inventory, equipment, upgrading, rolls: () => rolls };
}
describe('equipment upgrades', () => {
  it('preserves distinct ranks and magic through banking and save loading', () => {
    const x = setup(), id = 'grithe_sword__r8__flame';
    x.inventory.addItem(id, 1); x.inventory.addItem('grithe_sword__r7', 1);
    const dispatcher = new InteractionDispatcher({ get: () => undefined, playerPosition: () => x.store.get().player.position, skillLevels: () => ({} as any) });
    const bank = new BankSystem({ store: x.store, inventory: x.inventory, events: new EventBus(), dispatcher, now: () => 0, inRangeOfBank: () => true });
    expect(bank.op('deposit', { itemId: id, quantity: 1 }).ok).toBe(true);
    expect(x.inventory.countOf('grithe_sword__r7')).toBe(1);
    const loaded = loadSerializedSave(serializeSave(x.store.get()));
    expect(loaded.status).toBe('loaded');
    expect(loaded.state!.bank.slots).toContainEqual({ itemId: id, quantity: 1 });
    expect(bank.op('withdraw', { itemId: id, quantity: 1 }).ok).toBe(true);
    expect(x.inventory.countOf(id)).toBe(1);
  });
  it('uses the agreed rates, including 0.5% and nine multiplicative boosters', () => {
    const item = content.item('grithe_sword__r9')!;
    expect(upgradeChance(item)).toBe(.005);
    expect(upgradeChance(item, 9)).toBeCloseTo(.02579890176, 10);
    expect(upgradeChance(content.item('grithe_sword__r3')!, 9)).toBe(1);
    expect(requiredUpgradeScroll(content.item('grithe_sword__r7')!)).toBe('upgrade_scroll_mid');
    expect(upgradeChance(content.item('grithe_sword__r10')!, 9)).toBe(0);
  });
  it('rejects invalid variants and preserves base appearance and sets', () => {
    expect(content.item('grithe_ore__r9')).toBeUndefined();
    expect(content.item('grithe_sword__r11')).toBeUndefined();
    expect(content.item('grithe_sword__r8__health')).toBeUndefined();
    const parts = gearAppearanceParts('grithe_sword__r8');
    expect(parts[0]?.assetId).toBe(gearAppearanceParts('grithe_sword')[0]?.assetId);
    expect(parts[0]?.upgradeRank).toBe(8);
    const set = EQUIPMENT_SETS[0]!;
    const slots = Object.fromEntries(Object.entries(set.members).map(([slot, id]) => [slot, { itemId: upgradedItemId(id!, 8), quantity: 1 }]));
    expect(inferEquipmentSets(slots)[0]?.pieces).toBe(Object.keys(set.members).length);
  });
  it('consumes exactly the scroll and nine boosters on failure, preserving other ranks', () => {
    const x = setup(.99);
    x.inventory.addItem('grithe_sword__r9', 1); x.inventory.addItem('grithe_sword__r8', 1);
    x.inventory.addItem('upgrade_scroll_mid', 2); x.inventory.addItem('fount_blessing', 10);
    const result = x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: 'grithe_sword__r9', boosters: 9 });
    expect(result).toMatchObject({ ok: true, value: { success: false, itemId: null } });
    expect(x.inventory.countOf('grithe_sword__r9')).toBe(0);
    expect(x.inventory.countOf('grithe_sword__r8')).toBe(1);
    expect(x.inventory.countOf('upgrade_scroll_mid')).toBe(1);
    expect(x.inventory.countOf('fount_blessing')).toBe(1);
    expect(x.rolls()).toBe(1);
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: 'grithe_sword__r9', boosters: 9 }).ok).toBe(false);
    expect(x.rolls()).toBe(1);
  });
  it('does not consume anything on invalid counts, wrong location, or missing materials', () => {
    const x = setup(); x.inventory.addItem('grithe_sword', 1);
    for (const boosters of [-1, .5, 10, NaN]) expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: 'grithe_sword', boosters }).ok).toBe(false);
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: 'grithe_sword' }).ok).toBe(false);
    x.inventory.addItem('upgrade_scroll_low', 1); x.store.get().player.position = [100, 0, 100];
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: 'grithe_sword' }).ok).toBe(false);
    expect(x.inventory.countOf('grithe_sword')).toBe(1); expect(x.inventory.countOf('upgrade_scroll_low')).toBe(1); expect(x.rolls()).toBe(0);
  });
  it('upgrades in a full pack and retains magic through equip and unequip', () => {
    const x = setup(); x.inventory.addItem('grithe_sword__r3__flame', 1); x.inventory.addItem('upgrade_scroll_low', 1);
    x.inventory.addItem('grithe_ore', 26);
    expect(x.inventory.freeSlots()).toBe(0);
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: 'grithe_sword__r3__flame' })).toMatchObject({ ok: true, value: { success: true, itemId: 'grithe_sword__r4__flame' } });
    expect(x.equipment.equip('grithe_sword__r4__flame').ok).toBe(true);
    expect(x.equipment.unequip('mainHand').ok).toBe(true);
    expect(x.inventory.countOf('grithe_sword__r4__flame')).toBe(1);
  });
  it('combines only three same-rank jewelry pieces and destroys all three on failure', () => {
    const jewelry = ALL_ITEMS.find(isJewelry)!;
    for (const [rank, chance] of [[5, .55], [6, .60], [7, .75], [8, .90], [9, .95]]) {
      const id = upgradedItemId(jewelry.id, rank!);
      expect(upgradeChance(content.item(id)!)).toBe(chance);
    }
    const x = setup(.9), id = upgradedItemId(jewelry.id, 5);
    x.inventory.addItem(id, 2); x.inventory.addItem(jewelry.id, 1);
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: id }).ok).toBe(false);
    x.inventory.addItem(id, 1);
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'rank', itemId: id })).toMatchObject({ ok: true, value: { success: false } });
    expect(x.inventory.countOf(id)).toBe(0); expect(x.inventory.countOf(jewelry.id)).toBe(1);
  });
  it('applies magic separately and sells a booster for exactly 100m', () => {
    const x = setup(); x.inventory.addItem('grithe_cuirass', 1); x.inventory.addItem('enchant_health', 1);
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'magic', itemId: 'grithe_cuirass', enchantment: 'health' })).toMatchObject({ ok: true, value: { success: true, itemId: 'grithe_cuirass__r1__health' } });
    expect(content.item('grithe_cuirass__r1__health')!.equip!.bonuses.health).toBe(content.item('grithe_cuirass')!.equip!.bonuses.health + 10);
    x.store.get().currency = BOOSTER_PRICE;
    expect(x.upgrading.perform({ fountId: 'fount', mode: 'buy-booster' }).ok).toBe(true);
    expect(x.store.get().currency).toBe(0); expect(x.inventory.countOf('fount_blessing')).toBe(1);
  });
  it('keeps normalized loot weights, rare low-level +7, and stronger high-region drops', () => {
    for (const row of DROP_RANK_WEIGHTS) expect(row.reduce((a,b) => a+b, 0)).toBeCloseTo(100);
    expect(equipmentDropRank(1, 1, 1, .9999999)).toBe(7);
    expect(equipmentDropRank(1, 1, 1, .5)).toBe(1);
    expect(equipmentDropRank(70, 70, 1, .5)).toBe(5);
    expect(itemUpgrade(upgradedItemId('grithe_sword', 7, 'poison'))).toEqual({ baseId: 'grithe_sword', rank: 7, enchantment: 'poison' });
  });
});
