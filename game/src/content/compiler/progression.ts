import { formulaRegistry } from '../formulas/index.js';
import { parseCollection } from '../schema/core.js';
import { ItemRecordSchema, type ItemRecord } from '../schema/itemRecords.js';
import { RecipeRecordSchema, type RecipeRecord } from '../schema/recipes.js';
import { ResourceRecordSchema, type ResourceRecord } from '../schema/resources.js';
import { MaterialSchema, EquipmentFamilySchema, RecipeTemplateSchema, ProgressionTierSchema } from '../schema/progression.js';
import type { SourceLocation } from './contracts.js';
export type { ProgressionTier } from '../schema/progression.js';
export interface ProgressionSources { items: unknown; recipes: unknown; resources: unknown; materials: unknown;
  equipmentFamilies: unknown; recipeTemplates: unknown; progression: unknown; }
export function compileProgression(source: ProgressionSources) {
  const items = parseCollection(ItemRecordSchema, source.items, { name: 'items' });
  const recipes = parseCollection(RecipeRecordSchema, source.recipes, { name: 'recipes' });
  const resources = parseCollection(ResourceRecordSchema, source.resources, { name: 'resources' });
  const materials = parseCollection(MaterialSchema, source.materials, { name: 'materials' });
  const families = parseCollection(EquipmentFamilySchema, source.equipmentFamilies, { name: 'equipmentFamilies' });
  const templates = parseCollection(RecipeTemplateSchema, source.recipeTemplates, { name: 'recipeTemplates' });
  const progression = parseCollection(ProgressionTierSchema, source.progression, { name: 'progression' }).sort((a,b) => a.tier-b.tier);
  const sourceMap: Record<string, SourceLocation> = {};
  for (const [collection, rows] of [['items', items], ['recipes', recipes], ['resources', resources]] as const)
    for (const row of rows) sourceMap[`${collection}:${row.id}`] = { collection, id: row.id };
  const levels = new Set<number>();
  for (const tier of progression) {
    if (levels.has(tier.tier)) throw new Error(`progression:${tier.id}: duplicate tier ${tier.tier}`);
    levels.add(tier.tier);
    for (const [role, materialId] of Object.entries(tier.materials))
      if (!materials.some(material => material.id === materialId)) throw new Error(`progression:${tier.id}.materials.${role}: unknown material ${materialId}`);
    for (const member of tier.equipment) {
      const family = families.find(row => row.id === member.familyId);
      if (!family) throw new Error(`progression:${tier.id}.equipment:${member.id}: unknown family ${member.familyId}`);
      const calculated = formulaRegistry[family.formula].calculate({ tier: tier.tier }, family.parameters);
      const adjustment = member.adjustments;
      const item: ItemRecord = { id: member.id, name: member.name, description: member.description, tier: tier.tier,
        value: adjustment?.value ?? calculated.value, category: family.category, stackable: false,
        ...(family.category === 'tool' ? { tool: { skill: family.skill, gatherBonus: adjustment?.gatherBonus ?? calculated.gatherBonus } }
          : { equip: { slot: family.slot ?? 'mainHand', requires: { [family.skill]: tier.reqLevel },
            bonuses: { ...calculated.bonuses, ...adjustment?.bonuses }, ...(family.attackSpeedMs ? { attackSpeedMs: family.attackSpeedMs } : {}) } }),
        ...(family.magicWeapon ? { magicWeapon: family.magicWeapon } : {}) };
      items.push(item);
      sourceMap[`items:${item.id}`] = { collection: 'progression', id: tier.id, formula: family.formula, profile: family.id, inputs: { tier: tier.tier, memberId: member.id, adjustments: member.adjustments } };
    }
    for (const member of tier.production) {
      const template = templates.find(row => row.id === member.templateId);
      if (!template) throw new Error(`progression:${tier.id}.production:${member.id}: unknown template ${member.templateId}`);
      const recipe: (typeof recipes)[number] = { id: member.id, name: member.name, kind: template.kind, skill: template.skill,
        stations: template.stations, tier: tier.tier, reqLevel: tier.reqLevel, inputs: member.inputs, output: member.output,
        ...formulaRegistry[template.formula].calculate({ tier: tier.tier }, template.parameters), ...member.adjustments,
        ...(member.burntItemId ? { burntItemId: member.burntItemId } : {}) };
      recipes.push(recipe);
      sourceMap[`recipes:${recipe.id}`] = { collection: 'progression', id: tier.id, formula: template.formula, profile: template.id, inputs: { tier: tier.tier, memberId: member.id, adjustments: member.adjustments } };
    }
  }
  // Revalidate expanded outputs, including collisions and finite numeric values.
  const itemRecords = parseCollection(ItemRecordSchema, items, { name: 'compiled.items' });
  const recipeRecords = parseCollection(RecipeRecordSchema, recipes, { name: 'compiled.recipes' });
  const itemIds = new Set(items.map(row => row.id));
  const resourceIds = new Set(resources.map(row => row.id));
  const requireItem = (id: string, path: string) => { if (!itemIds.has(id)) throw new Error(`${path}: unknown item ${id}`); };
  for (const material of materials) requireItem(material.itemId, `materials:${material.id}.itemId`);
  for (const recipe of recipes) {
    for (const entry of [...recipe.inputs, recipe.output]) requireItem(entry.itemId, `recipes:${recipe.id}`);
    if (recipe.burntItemId) requireItem(recipe.burntItemId, `recipes:${recipe.id}.burntItemId`);
  }
  for (const item of items) {
    const charge = item.magicWeapon?.charge;
    if (charge) { requireItem(charge.rechargeItemId, `items:${item.id}.magicWeapon.charge.rechargeItemId`); requireItem(charge.orbItemId, `items:${item.id}.magicWeapon.charge.orbItemId`); }
  }
  for (const tier of progression) if (tier.magic) for (const [field, id] of Object.entries(tier.magic))
    if (field !== 'element' && id) requireItem(id, `progression:${tier.id}.magic.${field}`);
  for (const resource of resources) { requireItem(resource.itemId, `resources:${resource.id}`); for (const bonus of resource.bonus ?? []) requireItem(bonus.itemId, `resources:${resource.id}.bonus`); }
  for (const tier of progression) for (const id of tier.resourceIds) if (!resourceIds.has(id)) throw new Error(`progression:${tier.id}: unknown resource ${id}`);
  return { items: itemRecords as readonly ItemRecord[], recipes: recipeRecords as readonly RecipeRecord[], resources: resources as readonly ResourceRecord[], progression, materials, families, templates, sourceMap };
}


