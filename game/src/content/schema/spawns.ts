/** Shared spatial values. Encounters and placements are the only resident authoring model. */
import { SPELL_ELEMENTS } from '../../contracts.js';
import { arr, id, int, num, obj, opt, ref, refine, str, tuple, union, enumOf, type Schema } from './core.js';
export const SpotSchema = tuple([num(), num()] as const);
const positive = () => num({ exclusiveMin: 0 });
const radius = () => num({ min: 0 }, { unit: 'm' });
const count = () => int({ min: 1 });
const nonempty = () => str({ nonEmpty: true });
function uniqueRows<T>(schema: Schema<T>, key: (row: T) => string, label: string) {
  return refine(arr(schema), rows => new Set(rows.map(key)).size === rows.length, `duplicate ${label}`);
}
const PositiveVec3Schema = tuple<[Schema<number>, Schema<number>, Schema<number>]>([positive(), positive(), positive()]);
export const DressingSchema = obj({
  id: id(), assetId: ref('asset'), x: num({}, { unit: 'm' }), z: num({}, { unit: 'm' }),
  yaw: num({}, { unit: 'rad' }), scale: union([positive(), PositiveVec3Schema] as const), sink: opt(num({}, { unit: 'm' })),
});
export const DressingArraySchema = uniqueRows(DressingSchema, (row) => row.id, 'dressing id within habitat');

export const ClusterFields = {
  id: id(), resourceId: ref('resource'), count: count(), centre: SpotSchema, radius: radius(),
  locationId: ref('location'), waterBodyId: opt(nonempty()), ringRadius: opt(radius()),
  heroAssetId: opt(ref('asset')), heroScale: opt(positive()),
  essenceElement: opt(enumOf(SPELL_ELEMENTS, { ref: 'element' })),
};
