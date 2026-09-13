import { arr, enumOf, id, int, lit, num, obj, refine, str, union, type Infer } from './core.js';

const positiveInt = () => int({ min: 1 });
const nonnegativeInt = () => int({ min: 0 });
const nonempty = () => str({ nonEmpty: true });
const identity = { id: id(), speciesId: nonempty(), name: nonempty(), sourceInputId: nonempty(), health: positiveInt() };
export const VariantSourceInputSchema = obj({ ...identity, kind: lit('variant') });
const redesign = { ...identity, kind: lit('redesign'), tier: positiveInt(),
  behaviour: enumOf(['passive', 'aggressive', 'territorial'] as const) };
export const RedesignSourceInputSchema = union([
  obj({ ...redesign, profile: enumOf(['basic', 'forest', 'stone'] as const) }),
  obj({ ...redesign, profile: lit('ash'), attackRangeM: num({ exclusiveMin: 0 }) }),
] as const);
export const VariantEnemySourceInputSchema = union([VariantSourceInputSchema, RedesignSourceInputSchema] as const);
export const VariantSourceInputsSchema = refine(arr(VariantEnemySourceInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'source input ids must be unique');
export const VariantParamsSchema = obj({
  variant: obj({ magicArmourBonus: nonnegativeInt() }),
  redesign: obj({ ash: obj({ attackStyle: lit('melee') }) }),
});
export const FantasyParamsSchema = obj({
  tiers: refine(arr(positiveInt(), { minLength: 1 }),
    tiers => tiers.every((tier, index) => index === 0 || tier > tiers[index - 1]!), 'tiers must be unique and ascending'),
  minimums: obj({ maxHealth: positiveInt(), attackLevel: positiveInt(), defenceLevel: positiveInt(),
    accuracy: nonnegativeInt(), armour: nonnegativeInt(), magicArmour: nonnegativeInt(),
    maxHit: positiveInt(), marks: nonnegativeInt() }),
});
export type VariantSourceInput = Infer<typeof VariantSourceInputSchema>;
export type RedesignSourceInput = Infer<typeof RedesignSourceInputSchema>;
export type VariantEnemySourceInput = Infer<typeof VariantEnemySourceInputSchema>;
export type VariantParams = Infer<typeof VariantParamsSchema>;
export type FantasyParams = Infer<typeof FantasyParamsSchema>;
