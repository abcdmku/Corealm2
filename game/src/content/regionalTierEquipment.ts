import type { EquipmentBonuses, EquipSlot, ItemDef, SkillId } from '../contracts.js';
import { recipeXp, toolBonus, type RecipeDef, type EnemyDef } from './index.js';

/** Standalone regional catalog. Root registers this after production-lab acceptance. */
export const REGIONAL_CRAFTING_TIERS = [
  { tier: 30, metal: 'dewglass', metalName: 'Dewglass', ore: 'dewglass_ore', wood: 'willow', woodName: 'Willow',
    hide: 'mistweave', hideName: 'Mistweave', thread: 'mistweave_thread', threadName: 'Mistweave Thread',
    metalArt: 'Translucent turquoise mineral-metal with pearly silver edges, overlapping leaf-shaped plates and dark leather straps',
    clothArt: 'Layered blue-green cloth with pointed petal panels, pale embroidered seams and softly shaded folds',
    woodArt: 'Pale willow with bent flowing grain, turquoise bindings and pearly silver Dewglass fittings' },
  { tier: 40, metal: 'crownsilver', metalName: 'Crownsilver', ore: 'crownsilver_ore', wood: 'maple', woodName: 'Maple',
    hide: 'crownhide', hideName: 'Crownhide', thread: 'crownhide_thread', threadName: 'Crownhide Lacing',
    metalArt: 'Ivory silver with shaped fluting, brass fasteners and a dark navy underlayer',
    clothArt: 'Cream and tan pebbled leather with dark blue gussets, brass buckles, braided leather borders and visible saddle stitching',
    woodArt: 'Amber-red maple with figured grain, warm leather grips and silver and brass fittings' },
  { tier: 60, metal: 'staramethyst', metalName: 'Star Amethyst', ore: 'star_amethyst_ore', wood: 'yew', woodName: 'Yew',
    hide: 'faesilk', hideName: 'Faesilk', thread: 'faesilk_thread', threadName: 'Faesilk Thread',
    metalArt: 'Dark violet crystalline metal with blue-violet depths, sharp facets and silver branching inlay',
    clothArt: 'Lavender and teal silk with silver embroidery, layered pointed hems and silver closures',
    woodArt: 'Reddish yew heartwood with pale sapwood edges, teal bindings and silver and amethyst fittings' },
] as const;
type Tier = typeof REGIONAL_CRAFTING_TIERS[number];
type Stats = Partial<EquipmentBonuses>;
type GearSpec = { family: 'metal' | 'wood' | 'hide'; suffix: string; name: string; slot: EquipSlot;
  skill: 'melee' | 'magic'; values: readonly [number, number, number]; stats: readonly [Stats, Stats, Stats]; shape: string };

// Released T20/T50/T70 checkpoints. Interpolate each bonus independently and round once.
// Explicit snapshots avoid a catalog initialization cycle when this module is registered.
const GEAR: readonly GearSpec[] = [
  { family: 'metal', suffix: 'sword', name: 'Sword', slot: 'mainHand', skill: 'melee', values: [3200,8200,13700],
    stats: [{meleeAccuracy:48,meleePower:45},{meleeAccuracy:92,meleePower:92},{meleeAccuracy:125,meleePower:128}], shape: 'A solid double-edged blade with beveled cutting edges, a shaped crossguard and a wrapped wood grip.' },
  { family: 'wood', suffix: 'shield', name: 'Shield', slot: 'offHand', skill: 'melee', values: [1250,4700,7600],
    stats: [{meleeAccuracy:3,defence:22,health:2},{meleeAccuracy:6,defence:43,health:5},{meleeAccuracy:8,defence:56,health:7}], shape: 'A curved layered-wood shield with a reinforced metal rim, central boss and two leather straps on its back.' },
  { family: 'metal', suffix: 'helm', name: 'Helm', slot: 'head', skill: 'melee', values: [1950,5500,9000],
    stats: [{meleeAccuracy:4,defence:14,health:3},{meleeAccuracy:7,defence:28,health:6},{meleeAccuracy:9,defence:37,health:8}], shape: 'A fitted helmet with a raised brow, layered cheek guards and a protective nape.' },
  { family: 'metal', suffix: 'plate', name: 'Plate', slot: 'body', skill: 'melee', values: [3900,9400,15400],
    stats: [{meleeAccuracy:6,defence:30,health:7},{meleeAccuracy:10,defence:60,health:14},{meleeAccuracy:13,defence:79,health:19}], shape: 'A shaped breastplate and backplate with overlapping shoulder plates, a fitted waist and articulated lower lames.' },
  { family: 'metal', suffix: 'greaves', name: 'Greaves', slot: 'legs', skill: 'melee', values: [3600,8700,14200],
    stats: [{meleeAccuracy:4,defence:19,health:5},{meleeAccuracy:7,defence:39,health:10},{meleeAccuracy:9,defence:51,health:14}], shape: 'A matched pair of leg guards with separate thigh shells, raised knee cups and shin plates over leather lining.' },
  { family: 'metal', suffix: 'boots', name: 'Boots', slot: 'feet', skill: 'melee', values: [1350,4200,6900],
    stats: [{meleeAccuracy:2,defence:6,health:2},{meleeAccuracy:4,defence:18,health:5},{meleeAccuracy:5,defence:24,health:7}], shape: 'A matched pair of leather-soled boots with overlapping metal toe plates, ankle guards and rear buckles.' },
  { family: 'metal', suffix: 'gauntlets', name: 'Gauntlets', slot: 'hands', skill: 'melee', values: [1350,4200,6900],
    stats: [{meleeAccuracy:4,defence:4,health:3},{meleeAccuracy:6,defence:16,health:5},{meleeAccuracy:8,defence:21,health:7}], shape: 'A matched pair of five-fingered gauntlets with articulated knuckles, flared cuffs and leather palms.' },
  { family: 'wood', suffix: 'wand', name: 'Wand', slot: 'mainHand', skill: 'magic', values: [1900,5400,8700],
    stats: [{magicAccuracy:27,magicPower:23,defence:5},{magicAccuracy:54,magicPower:46,defence:9},{magicAccuracy:74,magicPower:63,defence:13}], shape: 'A short tapered wand with a wrapped grip and a small crystal held in an open metal tip cage. One-handed; carried Essence pays for spells.' },
  { family: 'wood', suffix: 'staff', name: 'Staff', slot: 'mainHand', skill: 'magic', values: [2700,7200,11700],
    stats: [{meleePower:7,magicAccuracy:40,magicPower:34,defence:7},{meleePower:15,magicAccuracy:80,magicPower:69,defence:13},{meleePower:21,magicAccuracy:110,magicPower:94,defence:19}], shape: 'A long staff with a forked metal crown around a large crystal, wrapped handhold and reinforced foot. Two-handed; carried Essence pays for spells.' },
  { family: 'hide', suffix: 'hood', name: 'Hood', slot: 'head', skill: 'magic', values: [1650,4800,7800],
    stats: [{defence:15,magicAccuracy:8,magicPower:4,health:3},{defence:27,magicAccuracy:15,magicPower:7,health:7},{defence:38,magicAccuracy:20,magicPower:10,health:10}], shape: 'A deep open-faced hood with an embroidered brow, folded lining and a short shoulder cowl.' },
  { family: 'hide', suffix: 'robe', name: 'Robe', slot: 'body', skill: 'magic', values: [3300,8300,13500],
    stats: [{defence:26,magicAccuracy:12,magicPower:6,health:6},{defence:48,magicAccuracy:23,magicPower:11,health:13},{defence:67,magicAccuracy:31,magicPower:15,health:18}], shape: 'A fitted sleeveless robe with a belted waist, overlapping front panels and split flowing tails. Open armholes leave the arms visible.' },
  { family: 'hide', suffix: 'leggings', name: 'Leggings', slot: 'legs', skill: 'magic', values: [2950,7500,12200],
    stats: [{defence:18,magicAccuracy:7,magicPower:4,health:4},{defence:33,magicAccuracy:13,magicPower:7,health:9},{defence:46,magicAccuracy:18,magicPower:9,health:12}], shape: 'A fitted pair of trousers with a reinforced waistband, separate legs, stitched knee panels and tapered ankle cuffs.' },
  { family: 'hide', suffix: 'boots', name: 'Boots', slot: 'feet', skill: 'magic', values: [1150,3500,5700],
    stats: [{defence:5,magicAccuracy:2,health:2},{defence:10,magicAccuracy:4,health:4},{defence:15,magicAccuracy:6,health:6}], shape: 'A matched pair of soft casting boots with turned cuffs, side lacing, embroidered uppers and dark leather soles.' },
  { family: 'hide', suffix: 'wraps', name: 'Wraps', slot: 'hands', skill: 'magic', values: [1150,3500,5700],
    stats: [{defence:5,magicAccuracy:2,health:2},{defence:10,magicAccuracy:4,health:4},{defence:15,magicAccuracy:6,health:6}], shape: 'A matched pair of fingerless hand wraps with layered wrist bands, fitted thumb openings and embroidered cuff borders.' },
];
const BONUS_KEYS = ['meleeAccuracy','meleePower','defence','magicAccuracy','magicPower','health','vitality'] as const;
function interpolate(tier: number, values: readonly [number, number, number]): number {
  const [low,high,deep] = values;
  return Math.round(tier <= 50 ? low + (high-low)*(tier-20)/30 : high+(deep-high)*(tier-50)/20);
}
function tierItems(def: Tier): ItemDef[] {
  const t = def.tier;
  const mat = (id: string, name: string, description: string, value: number, category: 'component'|'resource'|'bar' = 'component'): ItemDef =>
    ({id,name,tier:t,description,value,category,stackable:category==='component'});
  return [
    mat(def.ore, `${def.metalName} Ore`, `${def.metalArt}. Rough mineral fragments in a dark stone matrix; smelt three into one bar.`, interpolate(t,[160,360,590]), 'resource'),
    mat(`${def.metal}_bar`, `${def.metalName} Bar`, `${def.metalArt}. A solid cast ingot with beveled ends and a stamped maker's mark.`, interpolate(t,[600,1250,2050]), 'bar'),
    mat(def.hide, def.hideName, `${def.clothArt}. ${def.hide==='crownhide'?'A folded tanned hide with a natural irregular edge':'A folded bolt with a visible woven edge'}. Cut into garments or binding thread.`, interpolate(t,[150,340,560])),
    mat(def.thread, def.threadName, `${def.hide==='crownhide'?'Narrow tan leather lacing braided around an ivory spool':'Fine '+def.hideName+' thread wound around a carved wooden spool'}. Used for seams, casting grips and fishing line.`, interpolate(t,[40,90,150])),
    mat(`${def.wood}_handle`, `${def.woodName} Handle`, `${def.woodArt}. A shaped grip with a shouldered tang socket for swords, pickaxes and hatchets.`, interpolate(t,[220,640,1010])),
    ...GEAR.map((spec): ItemDef => {
      const family = def[spec.family], familyName = def[`${spec.family}Name`];
      const art = spec.family==='metal'?def.metalArt:spec.family==='hide'?def.clothArt:def.woodArt;
      const weapon = spec.suffix==='sword'||spec.suffix==='wand'||spec.suffix==='staff' ? spec.suffix : undefined;
      const bonuses = Object.fromEntries(BONUS_KEYS.map(key=>[key,interpolate(t,spec.stats.map(s=>s[key]??0) as [number,number,number])])) as unknown as EquipmentBonuses;
      return {id:`${family}_${spec.suffix}`,name:`${familyName} ${spec.name}`,tier:t,value:interpolate(t,spec.values),
        description:`${art}. ${t===30&&spec.suffix==='robe'
          ? 'A fitted robe with flared sleeves, pale botanical embroidery and split pointed tails.'
          : t===30&&spec.suffix==='staff'
            ? 'A long willow staff with a bent branch loop around a Dewglass crystal. Two-handed; carried Essence pays for spells.'
            : spec.shape}`,category:'equipment',stackable:false,
        equip:{slot:spec.slot,requires:{[spec.skill]:t},bonuses,
          ...(weapon?{attackSpeedMs:weapon==='staff'?3000:weapon==='wand'?2200:2400}:{})},
        ...(weapon&&weapon!=='sword'?{magicWeapon:{kind:weapon,hands:weapon==='staff'?2 as const:1 as const}}:{})};
    }),
    ...(['pickaxe','hatchet','rod'] as const).map((tool):ItemDef=>({
      id:`${tool==='rod'?def.wood:def.metal}_${tool}`,name:`${tool==='rod'?def.woodName:def.metalName} ${tool==='pickaxe'?'Pickaxe':tool==='hatchet'?'Hatchet':'Rod'}`,
      tier:t,value:interpolate(t,tool==='rod'?[1100,3200,5300]:tool==='pickaxe'?[1400,4000,6500]:[1350,4000,6500]),
      category:'tool',stackable:false,tool:{skill:tool==='pickaxe'?'mining':tool==='hatchet'?'woodcutting':'fishing',gatherBonus:toolBonus(t)},
      description:`${def.woodArt}. ${tool==='rod'?'A flexible fishing rod with spaced line guides, a working reel, crank knob and hanging float.':tool==='pickaxe'?`A curved two-ended ${def.metalName} mining head with a pointed pick and a flat chisel.`:`A broad bearded ${def.metalName} axe head with a honed edge and wedge-fastened eye.`} Adds ${toolBonus(t)} effective gathering levels; resource requirements still apply.`,
    })),
  ];
}
export const REGIONAL_TIER_ITEMS: readonly ItemDef[] = REGIONAL_CRAFTING_TIERS.flatMap(tierItems);
/** Regional creatures supply the fabric or hide; its own recipe makes the matching binding. */
export function regionalFabricDrops(tier: number, boss = false): EnemyDef['drops'] {
  const row = REGIONAL_CRAFTING_TIERS.find(row => row.tier === tier);
  return row ? [{ itemId: row.hide, quantity: boss ? [4, 7] : [1, 3], chance: boss ? 1 : .75 }] : [];
}
const SKILLS: Record<RecipeDef['kind'],SkillId> = {smelt:'smithing',smith:'smithing',craft:'crafting',fletch:'fletching',cook:'cooking'};
const STATIONS: Record<RecipeDef['kind'],RecipeDef['stations']> = {smelt:['furnace'],smith:['anvil'],craft:['crafting_table'],fletch:['fletching_bench'],cook:['range','campfire']};
function tierRecipes(def: Tier): RecipeDef[] {
  const {tier:t,metal:m,wood:w,hide:h,thread} = def;
  const bar=`${m}_bar`,handle=`${w}_handle`,log=`${w}_log`;
  const recipe=(output:string,kind:RecipeDef['kind'],inputs:readonly (readonly [string,number])[],weight:number,quantity=1):RecipeDef=>({
    id:`${kind}_${output}`,name:REGIONAL_TIER_ITEMS.find(item=>item.id===output)!.name,tier:t,reqLevel:t,kind,
    skill:SKILLS[kind],stations:STATIONS[kind],inputs:inputs.map(([itemId,quantity])=>({itemId,quantity})),
    output:{itemId:output,quantity},durationMs:kind==='smith'?3000:kind==='fletch'?1800:2400,xp:recipeXp(t,weight),
  });
  return [
    recipe(bar,'smelt',[[def.ore,3]],.8),recipe(handle,'fletch',[[log,1]],1),recipe(thread,'craft',[[h,1]],.8,4),
    recipe(`${m}_sword`,'smith',[[bar,3],[handle,1]],3.5),recipe(`${w}_shield`,'fletch',[[log,2],[bar,2]],2.8),
    ...(['helm','plate','greaves','boots','gauntlets'] as const).map(part=>recipe(`${m}_${part}`,'smith',[[bar,part==='plate'||part==='greaves'?4:part==='helm'?2:1]],part==='plate'||part==='greaves'?5:2.5)),
    recipe(`${w}_wand`,'fletch',[[log,2],[bar,1],[thread,3]],2.4),recipe(`${w}_staff`,'fletch',[[log,3],[bar,2],[thread,5]],3.2),
    ...(['hood','robe','leggings','boots','wraps'] as const).map(part=>recipe(`${h}_${part}`,'craft',[[h,part==='robe'||part==='leggings'?4:part==='hood'?2:1],[thread,part==='robe'||part==='leggings'?4:2]],part==='robe'||part==='leggings'?4:2.5)),
    recipe(`${m}_pickaxe`,'smith',[[bar,2],[handle,1]],2.2),recipe(`${m}_hatchet`,'smith',[[bar,2],[handle,1]],2.2),
    recipe(`${w}_rod`,'fletch',[[log,2],[bar,1],[thread,3]],1.8),
  ];
}
export const REGIONAL_TIER_RECIPES: readonly RecipeDef[] = REGIONAL_CRAFTING_TIERS.flatMap(tierRecipes);
