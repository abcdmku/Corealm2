import { WILDERNESS_CRAFTING_TIER_DATA } from "./craftingTierData.js";
import { itemRows } from "./itemData.js";
import type { ItemDef, ItemId } from '../contracts.js';
import type { EnemyDef, RecipeDef } from './index.js';
import { recipeRows } from "./recipeData.js";
import { COSMIC_RUNE_ID, SPELL_RUNES } from './spells.js';
import { WILDERNESS_RUNE_KEEPERS } from './wildernessDepth.js';
import { bossArmorDrops } from './bossArmor.js';
export type WildernessStructureLootId = 'cinder_chain_foundry' | 'nightforge_bastion' | 'hollow_star_sanctum';
/** These rows extend equipment and production without adding a spell element or another rune. */
export const WILDERNESS_CRAFTING_TIERS = WILDERNESS_CRAFTING_TIER_DATA;
export const WILDERNESS_LOOT_ITEMS: readonly ItemDef[] = itemRows("WILDERNESS_LOOT_ITEMS");

export const WILDERNESS_LOOT_RECIPES: readonly RecipeDef[] = recipeRows("WILDERNESS_LOOT_RECIPES");

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
