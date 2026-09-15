import { EQUIP_SLOTS, SKILL_IDS, SPELL_ELEMENTS } from '../../contracts.js';
import { arr, enumOf, id, int, num, obj, opt, rec, ref, str, type Infer } from './core.js';
import { EquipmentBonusesSchema, MagicWeaponSchema } from './items.js';
import { RecipeSchema } from './recipes.js';

const text = str({ nonEmpty: true });
export const MaterialSchema = obj({ id: id(), name: text.describe({ label: 'Name', display: true }), itemId: ref('item', { label: 'Item', role: 'Material for' }), description: opt(str(), { label: 'Description', multiline: true }) });
const bonuses = rec(num());
export const EquipmentFamilySchema = obj({
  id: id(), name: text.describe({ label: 'Name', display: true }), slot: opt(enumOf(EQUIP_SLOTS, { label: 'Equipment slot' })), skill: enumOf(SKILL_IDS, { label: 'Skill', ref: 'skill', role: 'Uses skill' }),
  category: enumOf(['equipment', 'tool'] as const, { label: 'Category' }),
  formula: enumOf(['equipment.linear'] as const, { label: 'Formula' }),
  parameters: obj({ valueBase: num({ min: 0 }), valuePerLevel: num({ min: 0 }),
    bonusesBase: EquipmentBonusesSchema, bonusesPerLevel: EquipmentBonusesSchema,
    gatherBonusPerLevel: num({ min: 0 }) }),
  attackSpeedMs: opt(num({ exclusiveMin: 0 })), magicWeapon: opt(MagicWeaponSchema),
});
const equipmentMember = obj({ familyId: ref("equipmentFamily", { label: 'Family', role: 'Member of' }), id: id(), name: text.describe({ label: 'Name', display: true }), description: str({}, { label: 'Description', multiline: true }),
  adjustments: opt(obj({ value: opt(int({ min: 0 }, { label: 'Value', group: 'adjustments' })), bonuses: opt(bonuses.describe({ label: 'Bonuses', group: 'adjustments' })),
    gatherBonus: opt(num({ min: 0 }, { label: 'Gather bonus', group: 'adjustments' })) }, {}, { label: 'Adjustments' })) });
export const RecipeTemplateSchema = obj({ id: id(), name: text.describe({ label: 'Name', display: true }), formula: enumOf(['production.linear'] as const, { label: 'Formula' }),
  kind: RecipeSchema.fields.kind, skill: RecipeSchema.fields.skill, stations: RecipeSchema.fields.stations,
  parameters: obj({ durationMs: num({ exclusiveMin: 0 }), xpBase: num({ min: 0 }), xpPerLevel: num({ min: 0 }) }) });
const production = obj({ id: id(), name: text.describe({ label: 'Name', display: true }), templateId: ref("recipeTemplate", { label: 'Template', role: 'Made from template' }), inputs: RecipeSchema.fields.inputs,
  output: RecipeSchema.fields.output, burntItemId: opt(ref('item', { role: 'Burnt output of' }), { label: 'Burnt output', role: 'Burnt output of' }),
  adjustments: opt(obj({ xp: opt(int({ min: 0 }, { label: 'XP', unit: 'xp', group: 'adjustments' })), durationMs: opt(num({ exclusiveMin: 0 }, { label: 'Duration', unit: 'ms', group: 'adjustments' })), reqLevel: opt(int({ min: 1 }, { label: 'Required level', group: 'adjustments' })) }, {}, { label: 'Adjustments' })) });
export const ProgressionTierSchema = obj({ id: id(), name: text.describe({ label: 'Name', display: true }), tier: int({ min: 1 }, { label: 'Tier' }), reqLevel: int({ min: 1 }, { label: 'Required level' }),
  materials: rec(ref("material", { role: 'Material of tier' }), { label: 'Materials', role: 'Material of tier' }),
  resourceIds: arr(ref('resource', { label: 'Resource', role: 'Resource of tier' }), {}, { label: 'Resources', role: 'Resource of tier' }),
  equipment: arr(equipmentMember, {}, { label: 'Equipment', role: 'Equipment of tier' }),
  production: arr(production, {}, { label: 'Production', role: 'Production of tier' }),
  campfireFuelId: opt(ref('campfireFuel', { role: 'Fuel of tier' }), { label: 'Campfire fuel', role: 'Fuel of tier' }),
  magic: opt(obj({ element: enumOf(SPELL_ELEMENTS, { label: 'Element', ref: 'element', role: 'Uses element' }),
    essence: ref('item', { label: 'Essence', role: 'Essence of tier' }), orb: ref('item', { label: 'Orb', role: 'Orb of tier' }),
    staff: ref('item', { label: 'Staff', role: 'Staff of tier' }), wand: ref('item', { label: 'Wand', role: 'Wand of tier' }),
    basicStaff: opt(ref('item', { role: 'Staff of tier' }), { label: 'Basic staff', role: 'Staff of tier' }),
    basicWand: opt(ref('item', { role: 'Wand of tier' }), { label: 'Basic wand', role: 'Wand of tier' }) }, {}, { label: 'Magic' })),
  smelting: opt(obj({ orePerBar: int({ min: 1 }, { label: 'Ore per bar' }), fluxPerBar: int({ min: 1 }, { label: 'Flux per bar' }) }, {}, { label: 'Smelting' })),
  presentation: rec(str(), { label: 'Presentation' }),
});
export type Material = Infer<typeof MaterialSchema>;
export type EquipmentFamily = Infer<typeof EquipmentFamilySchema>;
export type RecipeTemplate = Infer<typeof RecipeTemplateSchema>;
export type ProgressionTier = Infer<typeof ProgressionTierSchema>;
