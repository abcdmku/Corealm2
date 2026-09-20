import { CreatureProfileSchema, type CreatureProfile } from '../schema/creatureDefinitions.js';
import { EnemySchema } from '../schema/enemies.js';
import { calculateCreatureCombat } from './creature.js';
import { int, num, obj, type Schema, type Infer } from '../schema/core.js';
import { EquipmentFamilySchema, RecipeTemplateSchema } from '../schema/progression.js';
import { EquipmentBonusesSchema } from '../schema/items.js';
import { equipmentStats, productionStats } from './progression.js';

const input = obj({ tier: int({ min: 1, max: 1000 }) });
const zeroBonuses = { meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0, meleePower: 0, magicPower: 0, vitality: 0 };
function defineFormula<I, P, O>(definition: {
  title: string; description: string; source: { file: string; symbol: string }; profilesCollection: string;
  inputSchema: Schema<I>; parameterSchema: Schema<P>; outputSchema: Schema<O>;
  defaultInput: I; defaultParameters: P; calculate: (input: I, parameters: P) => O;
}) { return definition; }
const { id: _id, name: _name, family: _family, lootRolls: _lootRolls, ...combatFields } = EnemySchema.fields;
export const formulaRegistry = {
  'creature.combat': defineFormula({
    title: 'Creature combat', description: 'One combat curve for creatures in every region.',
    source: { file: 'game/src/content/formulas/creature.ts', symbol: 'calculateCreatureCombat' }, profilesCollection: 'creatureProfiles',
    inputSchema: input, parameterSchema: CreatureProfileSchema, outputSchema: obj(combatFields),
    defaultInput: { tier: 10 }, defaultParameters: {id:'example',name:'Example skirmisher',role:'skirmisher',healthPerLevel:8,healthBase:10,attackMultiplier:1,defenceMultiplier:1,accuracyPerLevel:1,armourPerLevel:0.5,magicArmourPerLevel:0.5,hitPerLevel:1,attackSpeedMs:2000,goldPerLevel:1} satisfies CreatureProfile,
    calculate: (input, parameters) => calculateCreatureCombat(input.tier, parameters),
  }),
  'equipment.linear': defineFormula({
    title: 'Equipment progression', description: 'Value, equipment bonuses and gathering strength by tier.',
    source: { file: 'game/src/content/formulas/progression.ts', symbol: 'equipmentStats' }, profilesCollection: 'equipmentFamilies',
    inputSchema: input, parameterSchema: EquipmentFamilySchema.fields.parameters,
    outputSchema: obj({ value: int({ min: 0 }), bonuses: EquipmentBonusesSchema, gatherBonus: num({ min: 0 }) }),
    defaultInput: { tier: 10 }, defaultParameters: { valueBase: 0, valuePerLevel: 5, bonusesBase: zeroBonuses,
      bonusesPerLevel: { ...zeroBonuses, meleePower: 1 }, gatherBonusPerLevel: 0.01 },
    calculate: (input, parameters) => equipmentStats(input.tier, parameters),
  }),
  'production.linear': defineFormula({
    title: 'Production experience', description: 'Recipe duration and experience by tier.',
    source: { file: 'game/src/content/formulas/progression.ts', symbol: 'productionStats' }, profilesCollection: 'recipeTemplates',
    inputSchema: input, parameterSchema: RecipeTemplateSchema.fields.parameters,
    outputSchema: obj({ durationMs: num({ exclusiveMin: 0 }), xp: int({ min: 0 }) }),
    defaultInput: { tier: 10 }, defaultParameters: { durationMs: 2000, xpBase: 0, xpPerLevel: 5 },
    calculate: (input, parameters) => productionStats(input.tier, parameters),
  }),
} as const;
export type FormulaId = keyof typeof formulaRegistry;
export type FormulaBinding = { [K in FormulaId]: { formula: K; parameters: Infer<(typeof formulaRegistry)[K]['parameterSchema']> } }[FormulaId];
export function isFormulaId(value: unknown): value is FormulaId { return typeof value === 'string' && Object.hasOwn(formulaRegistry, value); }
function checked<T>(schema: Schema<T>, value: unknown, path: string): T {
  const context = { issues: [] as { path: string; message: string; severity: 'error' | 'warning' }[] };
  const parsed = schema.parse(value, path, context);
  if (context.issues.length) throw new Error(context.issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
  return parsed;
}
function preview<I,P,O>(formula: {inputSchema:Schema<I>;parameterSchema:Schema<P>;outputSchema:Schema<O>;calculate:(input:I,parameters:P)=>O}, input:unknown, parameters:unknown) {
  return checked(formula.outputSchema, formula.calculate(checked(formula.inputSchema,input,'input'), checked(formula.parameterSchema,parameters,'parameters')), 'result');
}
/** Exhaustive dispatch preserves each formula's parameter contract at the JSON boundary. */
export function previewFormula(id: FormulaId, input: unknown, parameters: unknown) {
  switch(id) {
    case 'creature.combat': return preview(formulaRegistry[id],input,parameters);
    case 'equipment.linear': return preview(formulaRegistry[id],input,parameters);
    case 'production.linear': return preview(formulaRegistry[id],input,parameters);
  }
}


