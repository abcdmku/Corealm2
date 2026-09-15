import { int, num, obj, refine, str, tuple } from './core.js';
const positive = () => num({ exclusiveMin: 0 });
const nonnegative = () => num({ min: 0 });
const positiveInt = () => int({ min: 1 });
const chance = () => num({ min: 0, max: 1 });
// Telegraph ids are render-side effect names in code, not rows in any collection.
const inputId = () => str({ nonEmpty: true });
export const OrdrunPhaseParamsSchema = refine(tuple([
  obj({ atHealthFraction: chance(), attackSpeedMs: positiveInt() }),
  obj({ atHealthFraction: chance(), armourNumerator: nonnegative(), armourDenominator: positive(),
    attackSpeedMs: positiveInt(), maxHitNumerator: nonnegative(), maxHitDenominator: positive(),
    telegraphId: inputId(), telegraphWindupMs: positiveInt(), telegraphRadiusM: positive() }),
] as const), phases => phases[1].atHealthFraction < phases[0].atHealthFraction,
'second phase health threshold must be lower than the first');
