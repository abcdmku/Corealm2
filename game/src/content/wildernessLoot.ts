import type { EquipmentBonuses, EquipSlot, ItemDef, ItemId, SkillId } from '../contracts.js';
import type { EnemyDef, RecipeDef } from './index.js';
import { recipeXp, toolBonus } from './index.js';
import { COSMIC_RUNE_ID, SPELL_RUNES } from './spells.js';
import { WILDERNESS_RUNE_KEEPERS } from './wildernessDepth.js';
import { bossArmorDrops } from './bossArmor.js';
type WildernessTier = 50 | 70;
type Ingredient = readonly [
    ItemId,
    number
];
export type WildernessStructureLootId = 'cinder_chain_foundry' | 'nightforge_bastion' | 'hollow_star_sanctum';
/** These rows extend equipment and production without adding a spell element or another rune. */
export const WILDERNESS_CRAFTING_TIERS = [
    { tier: 50, metal: 'cindersteel', metalName: 'Cindersteel', ore: 'cindervein_ore', wood: 'teak',
        woodName: 'Teak', hide: 'dragonhide', hideName: 'Dragonhide', thread: 'grave_thread',
        flux: 'molten_heart', jewellery: 'emberweave', gem: 'fire_opal' },
    { tier: 70, metal: 'nightglass', metalName: 'Nightglass', ore: 'nightglass_ore', wood: 'magic',
        woodName: 'Magic', hide: 'starhide', hideName: 'Starhide', thread: 'void_thread',
        flux: 'astral_core', jewellery: 'starweave', gem: 'fire_opal' },
] as const;
type CraftingTier = typeof WILDERNESS_CRAFTING_TIERS[number];
function material(id: string, name: string, tier: WildernessTier, value: number, description: string, category: 'component' | 'resource' | 'bar' = 'component'): ItemDef {
    return { id, name, tier, value, description, category, stackable: category === 'component' };
}
const MATERIALS: readonly ItemDef[] = [
    material('cindervein_ore', 'Cindervein Ore', 50, 360, 'Black ore shot through with copper-red seams. Smelt three with a Molten Heart into Cindersteel.', 'resource'),
    material('nightglass_ore', 'Nightglass Ore', 70, 590, 'Violet ore with a blue fracture. Smelt three with an Astral Core into a Nightglass Bar.', 'resource'),
    material('cindersteel_bar', 'Cindersteel Bar', 50, 1250, 'Dense dark steel cast with a molten stone heart. Used for level 50 armour, weapons and tools.', 'bar'),
    material('nightglass_bar', 'Nightglass Bar', 70, 2050, 'A solid bar of blue-black glass metal. Used for level 70 armour, weapons and tools.', 'bar'),
    material('molten_heart', 'Molten Heart', 50, 110, 'A cooled kernel from a living stone creature. It replaces flux when smelting Cindersteel.'),
    material('dragonhide', 'Dragonhide', 50, 340, 'Supple hide beneath a young dragon\'s scales. Grave Thread binds it into level 50 casting armour.'),
    material('grave_thread', 'Grave Thread', 50, 90, 'Black binding drawn from the Wilderness dead. Stitch Dragonhide or wind it into a Teak casting weapon.'),
    material('astral_core', 'Astral Core', 70, 180, 'A blue-violet heart from a deep Wilderness creature. It fuses Nightglass Ore without shattering it.'),
    material('starhide', 'Starhide', 70, 560, 'Adult dragon hide steeped in deep magic. Void Thread stitches it into level 70 casting armour.'),
    material('void_thread', 'Void Thread', 70, 150, 'A dark strand pulled from a deep spirit. Binds Starhide and the crowns of Magic casting weapons.'),
    material('teak_handle', 'Teak Handle', 50, 640, 'Oiled teak cut for a Cindersteel sword, pickaxe or hatchet.'),
    material('magic_handle', 'Magic Handle', 70, 1010, 'A carved magic-wood grip for Nightglass weapons and gathering tools.'),
    material('ashseal_iron', 'Ashseal Iron', 50, 1700, 'The Ashseal Warden\'s dense shield iron. Rivet it across a Teak Shield to make an Ashseal Guard.'),
    material('furnace_crown', 'Furnace Crown', 50, 2100, 'A piece of the Furnace Regent\'s crucible crown. Set three around a Teak Staff to make a Regent Staff.'),
    material('chainbound_link', 'Chainbound Link', 70, 2400, 'A living link carried by the foundry guard and Chainbound Archon. Three bind a Nightglass Sword into a Chainbound Sword.'),
    material('nightforge_seal', 'Nightforge Seal', 70, 2600, 'A breastplate stamp taken from the bastion guard or Nightforge Marshal. Reinforces Nightglass Plate into Nightmarshal Plate.'),
    material('hollow_star_fragment', 'Hollow Star Fragment', 70, 3000, 'A heavy black shard carried by the sanctum guard and Hollow Star. Three form the crown of a Hollowstar Staff.'),
];
function bonuses(partial: Partial<EquipmentBonuses>): EquipmentBonuses {
    return { meleeAccuracy: 0, meleePower: 0, defence: Math.max(0, 0), magicAccuracy: 0, magicPower: 0,
        health: 0, ...partial, vitality: 0 };
}
function gear(id: string, name: string, tier: WildernessTier, slot: EquipSlot, skill: 'melee' | 'magic', value: number, description: string, stats: Partial<EquipmentBonuses>, weapon?: 'sword' | 'wand' | 'staff'): ItemDef {
    return {
        id, name, tier, value, description, category: 'equipment', stackable: false,
        equip: { slot, requires: { [skill]: tier }, bonuses: bonuses(stats),
            ...(weapon ? { attackSpeedMs: weapon === 'staff' ? 3000 : weapon === 'wand' ? 2200 : 2400 } : {}) },
        ...(weapon && weapon !== 'sword' ? { magicWeapon: { kind: weapon, hands: weapon === 'staff' ? 2 as const : 1 as const } } : {})
    };
}
function tierGear(def: CraftingTier): ItemDef[] {
    const { tier: t, metal: m, metalName: mn, wood: w, woodName: wn, hide: h, hideName: hn, jewellery: j } = def;
    const deep = t === 70;
    const pair = (shallow: number, northern: number): number => deep ? northern : shallow;
    const defence = (suffix: string, name: string, slot: EquipSlot, stats: Partial<EquipmentBonuses>, value: number): ItemDef => gear(`${m}_${suffix}`, `${mn} ${name}`, t, slot, 'melee', value, `${mn} ${name.toLowerCase()} forged for level ${t} melee combat.`, stats);
    const robes = (suffix: string, name: string, slot: EquipSlot, stats: Partial<EquipmentBonuses>, value: number): ItemDef => gear(`${h}_${suffix}`, `${hn} ${name}`, t, slot, 'magic', value, `${hn} ${name.toLowerCase()} sewn with ${deep ? 'Void' : 'Grave'} Thread. Requires level ${t} Magic.`, stats);
    return [
        gear(`${m}_sword`, `${mn} Sword`, t, 'mainHand', 'melee', pair(8200, 13700), `A ${deep ? 'blue-black glass edge on a magic-wood grip' : 'broad dark blade on an oiled teak grip'}. Requires level ${t} Melee.`, { meleeAccuracy: pair(92, 125), meleePower: pair(92, 128) }, 'sword'),
        gear(`${w}_shield`, `${wn} Shield`, t, 'offHand', 'melee', pair(4700, 7600), `Layered ${wn.toLowerCase()} faced in ${mn}.`, { meleeAccuracy: pair(6, 8), defence: Math.max(pair(43, 56), pair(19, 25)), health: pair(5, 7) }),
        defence('helm', 'Helm', 'head', { meleeAccuracy: pair(7, 9), defence: Math.max(pair(28, 37), pair(9, 12)), health: pair(6, 8) }, pair(5500, 9000)),
        defence('plate', 'Plate', 'body', { meleeAccuracy: pair(10, 13), defence: Math.max(pair(60, 79), pair(16, 22)), health: pair(14, 19) }, pair(9400, 15400)),
        defence('greaves', 'Greaves', 'legs', { meleeAccuracy: pair(7, 9), defence: Math.max(pair(39, 51), pair(12, 16)), health: pair(10, 14) }, pair(8700, 14200)),
        defence('boots', 'Boots', 'feet', { meleeAccuracy: pair(4, 5), defence: Math.max(pair(18, 24), pair(8, 11)), health: pair(5, 7) }, pair(4200, 6900)),
        defence('gauntlets', 'Gauntlets', 'hands', { meleeAccuracy: pair(6, 8), defence: Math.max(pair(16, 21), pair(8, 11)), health: pair(5, 7) }, pair(4200, 6900)),
        gear(`${w}_wand`, `${wn} Wand`, t, 'mainHand', 'magic', pair(5400, 8700), `${wn} wrapped with ${deep ? 'Void' : 'Grave'} Thread. A fast one-handed weapon; carried Essence pays for spells.`, { magicAccuracy: pair(54, 74), magicPower: pair(46, 63), defence: pair(9, 13) }, 'wand'),
        gear(`${w}_staff`, `${wn} Staff`, t, 'mainHand', 'magic', pair(7200, 11700), `${wn} crowned with ${mn}. A heavy two-handed casting weapon; carried Essence pays for spells.`, { meleePower: pair(15, 21), magicAccuracy: pair(80, 110), magicPower: pair(69, 94), defence: pair(13, 19) }, 'staff'),
        robes('hood', 'Hood', 'head', { defence: Math.max(pair(5, 7), pair(27, 38)), magicAccuracy: pair(15, 20), magicPower: pair(7, 10), health: pair(7, 10), vitality: 0 }, pair(4800, 7800)),
        robes('robe', 'Robe', 'body', { defence: Math.max(pair(8, 11), pair(48, 67)), magicAccuracy: pair(23, 31), magicPower: pair(11, 15), health: pair(13, 18), vitality: 0 }, pair(8300, 13500)),
        robes('leggings', 'Leggings', 'legs', { defence: Math.max(pair(6, 9), pair(33, 46)), magicAccuracy: pair(13, 18), magicPower: pair(7, 9), health: pair(9, 12), vitality: 0 }, pair(7500, 12200)),
        robes('boots', 'Boots', 'feet', { defence: Math.max(pair(3, 4), pair(10, 15)), magicAccuracy: pair(4, 6), health: pair(4, 6), vitality: 0 }, pair(3500, 5700)),
        robes('wraps', 'Wraps', 'hands', { defence: Math.max(pair(3, 4), pair(10, 15)), magicAccuracy: pair(4, 6), health: pair(4, 6), vitality: 0 }, pair(3500, 5700)),


        ...(['pickaxe', 'hatchet'] as const).map((tool): ItemDef => ({
            id: `${m}_${tool}`, name: `${mn} ${tool === 'pickaxe' ? 'Pickaxe' : 'Hatchet'}`, tier: t,
            description: `${mn} on a ${wn.toLowerCase()} handle. Adds ${toolBonus(t)} effective gathering levels; resource requirements still apply.`,
            category: 'tool', stackable: false, value: pair(4000, 6500),
            tool: { skill: tool === 'pickaxe' ? 'mining' : 'woodcutting', gatherBonus: toolBonus(t) }
        })),
    ];
}
const SPECIAL_GEAR: readonly ItemDef[] = [
    gear('ashseal_guard', 'Ashseal Guard', 50, 'offHand', 'melee', 12600, 'The Ashseal Warden\'s iron spread across a Teak Shield. A heavy guard for close fighting.', { meleeAccuracy: 6, defence: Math.max(57, 25), health: 9 }),
    gear('regent_staff', 'Regent Staff', 50, 'mainHand', 'magic', 16200, 'Three pieces of the Furnace Regent\'s crown brace a Teak Staff. Casts through carried Essence.', { meleePower: 17, magicAccuracy: 89, magicPower: 81, defence: 16 }, 'staff'),
    gear('chainbound_sword', 'Chainbound Sword', 70, 'mainHand', 'melee', 26000, 'Living foundry chain wound through a Nightglass blade. The edge tightens under a full swing.', { meleeAccuracy: 141, meleePower: 141 }, 'sword'),
    gear('nightmarshal_plate', 'Nightmarshal Plate', 70, 'body', 'melee', 28900, 'Nightglass Plate reinforced with the bastion\'s old seals. Heavy overlapping ribs protect the chest.', { meleeAccuracy: 14, defence: Math.max(98, 30), health: 25 }),
    gear('hollowstar_staff', 'Hollowstar Staff', 70, 'mainHand', 'magic', 29900, 'Three fragments of the Hollow Star turn above a magic-wood shaft. Casts through carried Essence.', { meleePower: 24, magicAccuracy: 123, magicPower: 111, defence: 24 }, 'staff'),
];
export const WILDERNESS_LOOT_ITEMS: readonly ItemDef[] = [
    ...MATERIALS, ...WILDERNESS_CRAFTING_TIERS.flatMap(tierGear), ...SPECIAL_GEAR,
];
const SKILLS: Record<RecipeDef['kind'], SkillId> = {
    smelt: 'smithing', smith: 'smithing', craft: 'crafting', fletch: 'fletching', cook: 'cooking'
};
const STATIONS: Record<RecipeDef['kind'], RecipeDef['stations']> = {
    smelt: ['furnace'], smith: ['anvil'], craft: ['crafting_table'], fletch: ['fletching_bench'], cook: ['range', 'campfire']
};
function recipe(tier: WildernessTier, output: string, kind: RecipeDef['kind'], inputs: readonly Ingredient[], weight: number): RecipeDef {
    const item = WILDERNESS_LOOT_ITEMS.find((candidate) => candidate.id === output);
    if (!item)
        throw new Error(`Wilderness recipe has no output item: ${output}`);
    return {
        id: `${kind}_${output}`, name: item.name, tier, kind, skill: SKILLS[kind], reqLevel: tier,
        stations: STATIONS[kind], inputs: inputs.map(([itemId, quantity]) => ({ itemId, quantity })),
        output: { itemId: output, quantity: 1 }, durationMs: kind === 'smith' ? 3000 : kind === 'fletch' ? 1800 : 2400,
        xp: recipeXp(tier, weight)
    };
}
function tierRecipes(def: CraftingTier): RecipeDef[] {
    const { tier: t, metal: m, wood: w, hide: h, jewellery: j, thread, flux, gem } = def;
    const bar = `${m}_bar`, handle = `${w}_handle`, log = `${w}_log`;
    return [
        recipe(t, bar, 'smelt', [[def.ore, 3], [flux, 1]], .8),
        recipe(t, handle, 'fletch', [[log, 1]], 1),
        recipe(t, `${m}_sword`, 'smith', [[bar, 3], [handle, 1]], 3.5),
        recipe(t, `${w}_shield`, 'fletch', [[log, 2], [bar, 2]], 2.8),
        ...(['helm', 'plate', 'greaves', 'boots', 'gauntlets'] as const).map((part) => {
            const large = part === 'plate' || part === 'greaves';
            return recipe(t, `${m}_${part}`, 'smith', [[bar, large ? 4 : part === 'helm' ? 2 : 1]], large ? 5 : 2.5);
        }),


        recipe(t, `${w}_wand`, 'fletch', [[log, 2], [bar, 1], [thread, 3]], 2.4),
        recipe(t, `${w}_staff`, 'fletch', [[log, 3], [bar, 2], [thread, 5]], 3.2),
        ...(['hood', 'robe', 'leggings', 'boots', 'wraps'] as const).map((part) => {
            const large = part === 'robe' || part === 'leggings';
            return recipe(t, `${h}_${part}`, 'craft', [[h, large ? 4 : part === 'hood' ? 2 : 1], [thread, large ? 4 : 2]], large ? 4 : 2.5);
        }),


        recipe(t, `${m}_pickaxe`, 'smith', [[bar, 2], [handle, 1]], 2.2),
        recipe(t, `${m}_hatchet`, 'smith', [[bar, 2], [handle, 1]], 2.2),
    ];
}
export const WILDERNESS_LOOT_RECIPES: readonly RecipeDef[] = [
    ...WILDERNESS_CRAFTING_TIERS.flatMap(tierRecipes),
    recipe(50, 'ashseal_guard', 'smith', [['teak_shield', 1], ['ashseal_iron', 3], ['cindersteel_bar', 2]], 2.8),
    recipe(50, 'regent_staff', 'fletch', [['teak_staff', 1], ['furnace_crown', 3], ['grave_thread', 6]], 3.2),
    recipe(70, 'chainbound_sword', 'smith', [['nightglass_sword', 1], ['chainbound_link', 3], ['nightglass_bar', 2]], 3.5),
    recipe(70, 'nightmarshal_plate', 'smith', [['nightglass_plate', 1], ['nightforge_seal', 3], ['nightglass_bar', 2]], 5),
    recipe(70, 'hollowstar_staff', 'fletch', [['magic_staff', 1], ['hollow_star_fragment', 3], ['void_thread', 6]], 3.2),
];
/** Distinct fortress supplies also fall from ordinary guards, so their recipes are not boss-only. */
export const WILDERNESS_STRUCTURE_COMPONENTS: Readonly<Record<WildernessStructureLootId, ItemId>> = {
    cinder_chain_foundry: 'chainbound_link', nightforge_bastion: 'nightforge_seal', hollow_star_sanctum: 'hollow_star_fragment'
};
export const WILDERNESS_KEEPER_COMPONENTS: Readonly<Record<typeof WILDERNESS_RUNE_KEEPERS[number]['id'], ItemId>> = {
    ashseal_warden: 'ashseal_iron', furnace_regent: 'furnace_crown', chainbound_archon: 'chainbound_link',
    nightforge_marshal: 'nightforge_seal', hollow_star: 'hollow_star_fragment'
};
function runeForRank(rank: number): ItemId {
    const rune = SPELL_RUNES.find((candidate) => candidate.tier === rank);
    if (!rune)
        throw new Error(`Missing merged invocation rune rank ${rank}`);
    return rune.itemId;
}
function drop(itemId: ItemId, min: number, max: number, chance = 1): EnemyDef['drops'][number] {
    return { itemId, quantity: [min, max], chance };
}
/** Body authors own species names. Keep their non-literal stone names explicit here. */
const STONE_SPECIES = new Set([
    'cinderback_crag', 'furnace_grazer', 'basalt_maw', 'rift_carapace', 'voidstone_colossus',
    'ashseal_warden', 'furnace_regent', 'nightforge_marshal',
]);
/** The source creature determines material. Root passes a fortress id only for its local guard packs. */
export function wildernessDrops(speciesId: string, tier: number, keeperId?: string, structureId?: WildernessStructureLootId): EnemyDef['drops'] {
    const keeper = WILDERNESS_RUNE_KEEPERS.find((candidate) => candidate.id === keeperId);
    if (keeperId && !keeper)
        throw new Error(`Unknown Wilderness rune keeper: ${keeperId}`);
    const deep = (keeper?.tier ?? tier) >= 70;
    const lootSpecies = keeper?.id ?? speciesId;
    const draconic = /dragon|drake|hatchling/.test(lootSpecies);
    const stony = STONE_SPECIES.has(lootSpecies)
        || /stone|rock|golem|cairn|flint|basalt|slag|kiln|obsidian|magma|crag|colossus|nightglass/.test(lootSpecies);
    const materialId = draconic ? (deep ? 'starhide' : 'dragonhide')
        : stony ? (deep ? 'astral_core' : 'molten_heart') : (deep ? 'void_thread' : 'grave_thread');
    if (keeper) {
        return [
            drop(materialId, 5, 9),
            drop(WILDERNESS_KEEPER_COMPONENTS[keeper.id], 1, 2),
            drop(keeper.rune, 24, 40),
            drop(COSMIC_RUNE_ID, 24, 40),
            drop(deep ? 'nightglass_ore' : 'cindervein_ore', 3, 6),
            drop('fire_opal', 1, 2, .35),
            ...bossArmorDrops(keeper.tier),
        ];
    }
    return [
        drop(materialId, 1, 3),
        // A pack of eleven averages 13.2 Cosmic Runes; upper ranks remain scarcer than lower ones.
        drop(COSMIC_RUNE_ID, 2, 4, .4),
        ...(deep ? [drop(runeForRank(3), 2, 4, .32), drop(runeForRank(4), 1, 3, .22), drop(runeForRank(5), 1, 2, .1)]
            : [drop(runeForRank(1), 2, 4, .4), drop(runeForRank(2), 2, 3, .28)]),
        ...(stony ? [drop(deep ? 'nightglass_ore' : 'cindervein_ore', 1, 2, .25)] : []),
        drop('fire_opal', 1, 1, .04),
        ...(structureId ? [drop(WILDERNESS_STRUCTURE_COMPONENTS[structureId], 1, 1, .12)] : []),
    ];
}
