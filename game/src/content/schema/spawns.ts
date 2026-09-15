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
  id: id(), assetId: ref('asset', { label: 'Asset', role: 'Dressing for' }), x: num({}, { unit: 'm', label: 'X' }), z: num({}, { unit: 'm', label: 'Z' }),
  yaw: num({}, { unit: 'rad', label: 'Yaw' }), scale: union([positive(), PositiveVec3Schema] as const, { label: 'Scale' }), sink: opt(num({}, { unit: 'm', label: 'Sink' })),
});
export const DressingArraySchema = uniqueRows(DressingSchema, (row) => row.id, 'dressing id within habitat').describe({ label: 'Dressing', role: 'Dressing for' });

export const ClusterFields = {
  id: id(), resourceId: ref('resource', { label: 'Resource', role: 'Placed as' }), count: count().describe({ label: 'Count' }),
  centre: SpotSchema.describe({ label: 'Centre', unit: 'm' }), radius: radius().describe({ label: 'Radius' }),
  locationId: ref('location', { label: 'Location', role: 'Placed at' }),
  // Water bodies are named per region in the geometry file and have no collection of their own.
  waterBodyId: opt(nonempty(), { label: 'Water body' }), ringRadius: opt(radius(), { label: 'Ring radius' }),
  heroAssetId: opt(ref('asset', { role: 'Hero model for' }), { label: 'Hero asset', role: 'Hero model for' }), heroScale: opt(positive(), { label: 'Hero scale' }),
  essenceElement: opt(enumOf(SPELL_ELEMENTS, { ref: 'element', label: 'Essence element', role: 'Uses element' })),
};
