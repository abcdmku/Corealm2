import { EQUIP_SLOTS, SKILL_IDS, SPELL_ELEMENTS } from '../../contracts.js';
import { arr, enumOf, id, int, num, obj, opt, rec, ref, str, type Infer } from './core.js';
import { EquipmentBonusesSchema, MagicWeaponSchema } from './items.js';
import { RecipeSchema } from './recipes.js';

const text = str({ nonEmpty: true });
export const MaterialSchema = obj({ id: id(), name: text, itemId: ref('item'), description: opt(str()) });
const bonuses = rec(num());
export const EquipmentFamilySchema = obj({
  id: id(), name: text, slot: opt(enumOf(EQUIP_SLOTS)), skill: enumOf(SKILL_IDS),
  category: enumOf(['equipment', 'tool'] as const),
  formula: enumOf(['equipment.linear'] as const),
  parameters: obj({ valueBase: num({ min: 0 }), valuePerLevel: num({ min: 0 }),
    bonusesBase: EquipmentBonusesSchema, bonusesPerLevel: EquipmentBonusesSchema,
    gatherBonusPerLevel: num({ min: 0 }) }),
  attackSpeedMs: opt(num({ exclusiveMin: 0 })), magicWeapon: opt(MagicWeaponSchema),
});
const equipmentMember = obj({ familyId: ref("equipmentFamily"), id: id(), name: text, description: str(),
  adjustments: opt(obj({ value: opt(int({ min: 0 })), bonuses: opt(bonuses),
    gatherBonus: opt(num({ min: 0 })) })) });
export const RecipeTemplateSchema = obj({ id: id(), name: text, formula: enumOf(['production.linear'] as const),
  kind: RecipeSchema.fields.kind, skill: RecipeSchema.fields.skill, stations: RecipeSchema.fields.stations,
  parameters: obj({ durationMs: num({ exclusiveMin: 0 }), xpBase: num({ min: 0 }), xpPerLevel: num({ min: 0 }) }) });
const production = obj({ id: id(), name: text, templateId: ref("recipeTemplate"), inputs: RecipeSchema.fields.inputs,
  output: RecipeSchema.fields.output, burntItemId: opt(ref('item')),
  adjustments: opt(obj({ xp: opt(int({ min: 0 })), durationMs: opt(num({ exclusiveMin: 0 })), reqLevel: opt(int({ min: 1 })) })) });
export const ProgressionTierSchema = obj({ id: id(), name: text, tier: int({ min: 1 }), reqLevel: int({ min: 1 }),
  materials: rec(ref("material")), resourceIds: arr(ref('resource')), equipment: arr(equipmentMember), production: arr(production),
  campfireFuelId: opt(ref('campfireFuel')), magic: opt(obj({ element: enumOf(SPELL_ELEMENTS), essence: ref('item'), orb: ref('item'),
    staff: ref('item'), wand: ref('item'), basicStaff: opt(ref('item')), basicWand: opt(ref('item')) })),
  smelting: opt(obj({ orePerBar: int({ min: 1 }), fluxPerBar: int({ min: 1 }) })),
  presentation: rec(str()),
});
export type Material = Infer<typeof MaterialSchema>;
export type EquipmentFamily = Infer<typeof EquipmentFamilySchema>;
export type RecipeTemplate = Infer<typeof RecipeTemplateSchema>;
export type ProgressionTier = Infer<typeof ProgressionTierSchema>;
