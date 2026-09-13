import { describe, expect, it } from 'vitest';
import type { EquipmentBonuses } from '../game/src/contracts.js';
import { REGIONAL_CRAFTING_TIERS, REGIONAL_TIER_ITEMS, REGIONAL_TIER_RECIPES } from '../game/src/content/regionalTierEquipment.js';
import { EQUIPMENT } from '../game/src/content/equipment.js';
import { WILDERNESS_LOOT_ITEMS } from '../game/src/content/wildernessLoot.js';
import { HIGH_TIER_LOG_ITEMS } from '../game/src/content/treeSpecies.js';
import { toolBonus } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { RECIPES } from '../game/src/content/recipes.js';
import { resourceDef } from '../game/src/content/resources.js';
import { CREATURE_SPECIES } from '../game/src/content/creatureSpecies.js';
import { CROWNWARD } from '../game/src/content/crownward.js';
import { GLOAMGARDEN, FAEHOLME } from '../game/src/content/fairyRegions.js';

describe('regional tier equipment', () => {
  it('registers production outputs and supplies each raw input in its authored region', () => {
    for (const item of REGIONAL_TIER_ITEMS) expect(ALL_ITEMS.filter(row=>row.id===item.id)).toEqual([item]);
    for (const recipe of REGIONAL_TIER_RECIPES) expect(RECIPES.filter(row=>row.id===recipe.id)).toEqual([recipe]);
    for (const region of [GLOAMGARDEN,CROWNWARD,FAEHOLME]) {
      const tier=REGIONAL_CRAFTING_TIERS.find(row=>row.tier===region.tier)!;
      const resources=region.clusters.map(cluster=>({cluster,resource:resourceDef(cluster.resourceId)}));
      for (const itemId of [tier.ore,`${tier.wood}_log`]) {
        const sources=resources.filter(row=>row.resource.itemId===itemId);
        expect(sources.length,`${region.id}:${itemId}`).toBeGreaterThan(0);
        for (const {cluster,resource} of sources) {
          expect(cluster.count).toBeGreaterThan(0);
          expect(resource.reqLevel).toBe(tier.tier);
          expect(resource.tier).toBe(tier.tier);
        }
      }
      const normalGroups=region.enemyGroups.filter(group=>!group.boss&&!group.miniBoss&&group.count>0);
      const fabricSources=normalGroups.flatMap(group=>CREATURE_SPECIES.filter(species=>
        species.regionId===region.id&&species.stats.family===group.family&&species.stats.tier===group.tier)
        .flatMap(species=>species.stats.drops.filter(drop=>drop.itemId===tier.hide)));
      expect(fabricSources.length,`${region.id}:${tier.hide}`).toBeGreaterThan(0);
      for (const drop of fabricSources) {
        expect(drop.chance).toBe(.75);
        expect(drop.quantity).toEqual([1,3]);
      }
      const bindings=REGIONAL_TIER_RECIPES.find(recipe=>recipe.output.itemId===tier.thread)!;
      expect(bindings.inputs).toEqual([{itemId:tier.hide,quantity:1}]);
      expect(bindings.output.quantity).toBe(4);
    }
  });
  it('provides two complete armor sets, four weapons and three tools at each missing tier', () => {
    expect(REGIONAL_TIER_ITEMS).toHaveLength(66);
    expect(new Set(REGIONAL_TIER_ITEMS.map(item=>item.id)).size).toBe(66);
    for (const def of REGIONAL_CRAFTING_TIERS) {
      const items=REGIONAL_TIER_ITEMS.filter(item=>item.tier===def.tier);
      expect(items.filter(item=>item.equip)).toHaveLength(14);
      for (const [family,skill] of [[def.metal,'melee'],[def.hide,'magic']] as const) {
        const armor=items.filter(item=>item.id.startsWith(`${family}_`)&&item.equip&&!['mainHand','offHand'].includes(item.equip.slot));
        expect(armor.map(item=>item.equip!.slot).sort()).toEqual(['body','feet','hands','head','legs']);
        for (const item of armor) expect(item.equip!.requires).toEqual({[skill]:def.tier});
      }
      const tools=items.filter(item=>item.tool);
      expect(tools.map(item=>item.tool!.skill).sort()).toEqual(['fishing','mining','woodcutting']);
      for (const item of tools) expect(item.tool!.gatherBonus).toBe(toolBonus(def.tier));
      expect(items.some(item=>item.equip?.slot.startsWith('accessory'))).toBe(false);
      const wand=items.find(item=>item.id===`${def.wood}_wand`)!;
      const staff=items.find(item=>item.id===`${def.wood}_staff`)!;
      expect(wand.magicWeapon).toEqual({kind:'wand',hands:1});
      expect(staff.magicWeapon).toEqual({kind:'staff',hands:2});
      expect(wand.equip!.attackSpeedMs).toBe(2200);
      expect(staff.equip!.attackSpeedMs).toBe(3000);
      expect(staff.equip!.bonuses.magicPower).toBeGreaterThan(wand.equip!.bonuses.magicPower);
    }
  });

  it('makes every finished item through an acyclic recipe chain from regional ore, textiles and existing logs', () => {
    expect(REGIONAL_TIER_RECIPES).toHaveLength(60);
    expect(new Set(REGIONAL_TIER_RECIPES.map(recipe=>recipe.id)).size).toBe(60);
    const known=new Set([...REGIONAL_TIER_ITEMS,...HIGH_TIER_LOG_ITEMS].map(item=>item.id));
    for (const def of REGIONAL_CRAFTING_TIERS) {
      const reachable=new Set([def.ore,def.hide,`${def.wood}_log`]);
      const pending=REGIONAL_TIER_RECIPES.filter(recipe=>recipe.tier===def.tier);
      expect(pending).toHaveLength(20);
      for (const recipe of pending) {
        expect(recipe.reqLevel).toBe(def.tier);
        expect(recipe.stations?.length).toBeGreaterThan(0);
        expect(recipe.xp).toBeGreaterThan(0);
        expect(recipe.durationMs).toBeGreaterThan(0);
        for (const input of recipe.inputs) {
          expect(known.has(input.itemId),input.itemId).toBe(true);
          expect(input.quantity).toBeGreaterThan(0);
        }
      }
      while (pending.length) {
        const index=pending.findIndex(recipe=>recipe.inputs.every(input=>reachable.has(input.itemId)));
        expect(index,'recipe cycle or missing acquired input').toBeGreaterThanOrEqual(0);
        reachable.add(pending.splice(index,1)[0]!.output.itemId);
      }
      for (const item of REGIONAL_TIER_ITEMS.filter(item=>item.tier===def.tier)) {
        expect(reachable.has(item.id),item.id).toBe(true);
        if (item.equip||item.tool) expect(REGIONAL_TIER_RECIPES.filter(recipe=>recipe.output.itemId===item.id)).toHaveLength(1);
      }
    }
  });

  it('interpolates every equipment bonus and price from the released T20/T50/T70 counterparts', () => {
    const released=[...EQUIPMENT,...WILDERNESS_LOOT_ITEMS];
    for (const def of REGIONAL_CRAFTING_TIERS) {
      for (const item of REGIONAL_TIER_ITEMS.filter(item=>item.tier===def.tier&&item.equip)) {
        const family=item.id.startsWith(`${def.metal}_`)?def.metal:item.id.startsWith(`${def.wood}_`)?def.wood:def.hide;
        const suffix=item.id.slice(family.length);
        const lowFamily=family===def.metal?'emberite':family===def.wood?'cinderpine':'charhide';
        const midFamily=family===def.metal?'cindersteel':family===def.wood?'teak':'dragonhide';
        const highFamily=family===def.metal?'nightglass':family===def.wood?'magic':'starhide';
        const low=released.find(row=>row.id===`${def.tier<50?lowFamily:midFamily}${suffix}`)!;
        const high=released.find(row=>row.id===`${def.tier<50?midFamily:highFamily}${suffix}`)!;
        expect(low,item.id).toBeDefined();expect(high,item.id).toBeDefined();
        if (!item.equip || !low?.equip || !high?.equip) throw new Error(`Missing equipment anchor for ${item.id}`);
        const actualBonuses=item.equip.bonuses, lowBonuses=low.equip.bonuses, highBonuses=high.equip.bonuses;
        const fraction=def.tier<50?(def.tier-20)/30:(def.tier-50)/20;
        for (const key of Object.keys(actualBonuses) as (keyof EquipmentBonuses)[]) {
          expect(actualBonuses[key],`${item.id}.${key}`).toBe(Math.round(lowBonuses[key]+(highBonuses[key]-lowBonuses[key])*fraction));
        }
        expect(item.value).toBe(Math.round(low.value+(high.value-low.value)*fraction));
      }
    }
  });
});
