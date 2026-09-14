import { arr, bool, enumOf, id, int, lit, num, obj, refine, str, tuple, union, type Infer, type Schema } from './core.js';

const positive = () => num({ exclusiveMin: 0 });
const positiveInt = () => int({ min: 1 });
const nonnegative = () => num({ min: 0 });
const nonempty = () => str({ nonEmpty: true });
const marks = () => refine(tuple<[Schema<number>, Schema<number>]>([int({ min: 0 }), int({ min: 0 })]),
  ([low, high]) => low <= high, 'marks minimum must not exceed maximum');
const identity = { id: id(), speciesId: nonempty(), name: nonempty(), sourceInputId: nonempty(), targetLevel: positiveInt() };
export const FairyCrownSourceInputSchema = obj({ ...identity, kind: lit('fairyCrown'),
  tier: union([lit(30), lit(40), lit(60)] as const), nativeScale: positive(),
  behaviour: enumOf(['passive', 'aggressive', 'territorial'] as const), boss: bool() });
export const CrownwardDragonSourceInputSchema = obj({ ...identity, kind: lit('crownwardDragon'), rank: enumOf(['miniboss', 'boss'] as const) });
export const DescendantSourceInputSchema = union([FairyCrownSourceInputSchema, CrownwardDragonSourceInputSchema] as const);
export const DescendantSourceInputsSchema = refine(arr(DescendantSourceInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'source input ids must be unique');
export const FairyCrownSourceParamsSchema = obj({
  movementScaleCap: positive(),
  attackRangeM: obj({ boss: obj({ minimum: positive(), fallback: positive() }), ordinary: obj({ maximum: positive(), fallback: positive() }) }),
  aggroRadius: obj({ boss: nonnegative(), passive: nonnegative(), territorial: nonnegative(), aggressive: nonnegative() }),
  marksPerTier: obj({ ordinary: marks(), boss: marks() }),
});
export const CrownwardDragonSourceParamsSchema = obj({
  tier: positiveInt(), behaviour: lit('territorial'), aggroRadius: obj({ miniboss: nonnegative(), boss: nonnegative() }),
  marks: obj({ miniboss: marks(), boss: marks() }),
});
export const DescendantSourceParamsSchema = obj({ fairyCrown: FairyCrownSourceParamsSchema, crownwardDragon: CrownwardDragonSourceParamsSchema });
export type FairyCrownSourceInput = Infer<typeof FairyCrownSourceInputSchema>;
export type CrownwardDragonSourceInput = Infer<typeof CrownwardDragonSourceInputSchema>;
export type DescendantSourceInput = Infer<typeof DescendantSourceInputSchema>;
export type DescendantSourceParams = Infer<typeof DescendantSourceParamsSchema>;
