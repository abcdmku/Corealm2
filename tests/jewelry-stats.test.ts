import { beforeEach, describe, expect, it } from 'vitest';
import { CRAFTED_JEWELRY, JEWELRY_RECIPES, JEWELRY_STATS, JEWELRY_TIERS, canonicalJewelryId, jewelryBonuses, selectEquipmentSlot } from '../game/src/content/jewelry.js';
import { MINIBOSS_JEWELLERY, MINIBOSS_JEWELRY_PROFILES } from '../game/src/content/universalMinibossLoot.js';
import { universalMinibossSpecies } from '../game/src/content/universalMinibosses.js';
import { criticalDamage, rollItemDrops } from '../game/src/systems/equipmentCombat.js';
import { Rng } from '../game/src/core/rng.js';
import { createInitialState, computeMaxHealth } from '../game/src/state/store.js';
import { migrate } from '../game/src/persistence/migrate.js';
import { content } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { equipmentTotalsOf } from '../game/src/systems/equipment.js';

beforeEach(()=>content.register({items:ALL_ITEMS}));
describe('single-stat jewelry and paired boss rewards',()=>{
 it.each(JEWELRY_TIERS)('crafts only the assigned stat at T%i',tier=>{
  const items=CRAFTED_JEWELRY.filter(item=>item.tier===tier);
  expect(items).toHaveLength(2);
  for(const item of items){
   expect(Object.entries(item.equip!.bonuses).filter(([,value])=>value>0).map(([key])=>key)).toEqual([JEWELRY_STATS[JEWELRY_TIERS.indexOf(tier)]]);
   const recipe=JEWELRY_RECIPES.find(row=>row.output.itemId===item.id)!;
   expect(recipe.inputs).toHaveLength(2);expect(recipe.reqLevel).toBe(tier);
  }
 });
 it.each(JEWELRY_TIERS)('gives every boss a matching rare pair at T%i',tier=>{
  const items=MINIBOSS_JEWELLERY.filter(item=>item.tier===tier);
  expect(items).toHaveLength(2);
  for(let i=0;i<items.length;i+=2){
   expect(items[i]!.equip!.bonuses).toEqual(items[i+1]!.equip!.bonuses);
   expect(Object.values(items[i]!.equip!.bonuses).filter(value => value > 0)).toEqual(MINIBOSS_JEWELRY_PROFILES[JEWELRY_TIERS.indexOf(tier)]!.map(() => 2));
   expect(Object.entries(items[i]!.equip!.bonuses).filter(([,v])=>v>0).map(([key])=>key).sort()).toEqual([...MINIBOSS_JEWELRY_PROFILES[JEWELRY_TIERS.indexOf(tier)]!].sort());
  }
 });
 it('uses exactly 30% total probability with mutually exclusive ring and earring',()=>{
  const drops=universalMinibossSpecies('01','karrowmoor').stats.drops;
  for(const [sample,suffix] of [[0,'ring'],[.149999,'ring'],[.15,'earring'],[.299999,'earring'],[.30,null],[.999,null]] as const){
   const rng={next:()=>sample,chance:()=>false,int:()=>1};
   const result=rollItemDrops(drops,rng);
   expect(result).toHaveLength(suffix?1:0);
   if(suffix)expect(result[0]!.itemId).toBe(`guardian_${suffix}_t10`);
  }
 });
 it('adds four pieces once each and chooses the empty compatible slot',()=>{
  const state=createInitialState(1);for(const slot of Object.keys(state.equipment) as (keyof typeof state.equipment)[])state.equipment[slot]=null;
  expect(selectEquipmentSlot('accessory1',state.equipment)).toBe('accessory1');
  state.equipment.accessory1={itemId:'crafted_ring_t10',quantity:1};
  expect(selectEquipmentSlot('accessory1',state.equipment)).toBe('ring2');
  state.equipment.ring2={itemId:'crafted_ring_t10',quantity:1};
  state.equipment.accessory2={itemId:'crafted_earring_t40',quantity:1};
  state.equipment.earring2={itemId:'crafted_earring_t70',quantity:1};
  expect(equipmentTotalsOf(state.equipment)).toEqual(jewelryBonuses({meleeAccuracy:2,health:12,vitality:7}));
  expect(computeMaxHealth(state,12)-computeMaxHealth(state,0)).toBe(12);
 });
 it('uses Vitality only for critical chance and never turns misses into hits',()=>{
  const always={chance:()=>true};const never={chance:()=>false};
  expect(criticalDamage(10,100,always)).toBe(15);
  expect(criticalDamage(10,1,never)).toBe(10);
  expect(criticalDamage(0,100,always)).toBe(0);
  expect(criticalDamage(10,0,{chance:()=>{throw new Error('zero chance should not consume RNG')}})).toBe(10);
 });
 it('merges boss-specific bank copies into the shared tier reward without losing equipment',()=>{
  const state=createInitialState(1);
  state.bank.slots=[{itemId:'guardian_01_ring_t30',quantity:2},{itemId:'guardian_09_ring_t30',quantity:3}];
  state.equipment.accessory1={itemId:'guardian_02_ring_t30',quantity:1};
  state.equipment.ring2={itemId:'guardian_03_ring_t30',quantity:1};
  const result=migrate(state).state!;
  expect(result.bank.slots).toEqual([{itemId:'guardian_ring_t30',quantity:5}]);
  expect(result.equipment.accessory1!.itemId).toBe('guardian_ring_t30');
  expect(result.equipment.ring2!.itemId).toBe('guardian_ring_t30');
  expect(migrate(result).state).toEqual(result);
 });
 it('preserves a valid second-slot choice when loading a save',()=>{
  const state=createInitialState(1);state.equipment.accessory1=null;
  state.equipment.ring2={itemId:'crafted_ring_t10',quantity:1};
  const result=migrate(state);
  expect(result.state!.equipment.accessory1).toBeNull();
  expect(result.state!.equipment.ring2!.itemId).toBe('crafted_ring_t10');
 });
 it('preserves and consolidates retired jewelry in old saves, idempotently',()=>{
  const state=createInitialState(1);state.meta.saveVersion=7;
  state.inventory.slots[0]={itemId:'storm_ring',quantity:1,slotIndex:0};
  state.bank.slots=[{itemId:'kaldite_ring',quantity:2},{itemId:'storm_ring',quantity:3}];
  state.equipment.accessory1={itemId:'warden_jewellery_01_t10',quantity:1};
  state.equipment.accessory2={itemId:'unique_jewellery_02_t20',quantity:1};
  const result=migrate(state);expect(result.ok).toBe(true);
  expect(result.state!.inventory.slots[0]!.itemId).toBe('crafted_ring_t10');
  expect(result.state!.bank.slots).toEqual([{itemId:'crafted_ring_t10',quantity:5}]);
  expect(result.state!.equipment.accessory2!.itemId).toBe('guardian_earring_t10');
  expect(result.state!.equipment.accessory1!.itemId).toBe('guardian_ring_t20');
  expect(migrate(result.state).state).toEqual(result.state);
  expect(state.bank.slots[0]!.itemId).toBe('kaldite_ring');
 });
});
