import { arr, bool, enumOf, id, int, num, obj, opt, ref, refine, str, tuple, type Infer } from './core.js';
import { DressingArraySchema, ClusterFields } from './spawns.js';
const point = tuple([num(), num()] as const);
const positive = () => num({ exclusiveMin: 0 });
export const EncounterDefinitionSchema = obj({
  id: id(), name: str({ nonEmpty: true }, { label: 'Name', display: true }),
  activity: enumOf(['graze', 'forage', 'prowl', 'patrol'] as const, { label: 'Activity' }),
  // Members compete for each spawn slot, so `weight` is a share of the group, not a probability.
  members: refine(arr(obj({
    creatureId: ref('enemy', { label: 'Creature', role: 'Spawns as' }),
    weight: num({ exclusiveMin: 0 }, { label: 'Weight', help: 'Relative share of the group. Weights need not sum to anything.' }),
  }), {}, { label: 'Members', role: 'Spawns as', weight: 'weight' }),
    rows => rows.length > 0 && new Set(rows.map(row => row.creatureId)).size === rows.length,
    'encounter needs unique creature members'),
});
export const WorldPlacementSchema = refine(obj({
  id: id(), encounterId: ref('encounter', { label: 'Encounter', role: 'Placed as' }), regionId: ref('region', { label: 'Region', role: 'Placed in' }),
  centre: point.describe({ unit: 'm', label: 'Centre' }), count: int({ min: 1, max: 64 }, { label: 'Count' }), radius: positive().describe({ label: 'Radius', unit: 'm' }),
  rank: opt(enumOf(['boss', 'miniboss'] as const), { label: 'Rank' }),
  level: opt(int({ min: 1 }), { label: 'Level' }), scaleMultiplier: opt(positive(), { label: 'Scale multiplier' }),
  formation: obj({ kind: enumOf(['grid', 'ring', 'authored'] as const, { label: 'Formation' }), spacing: positive().describe({ label: 'Spacing', unit: 'm' }), rotation: num({}, { label: 'Rotation', unit: 'rad' }) }, {}, { label: 'Formation' }),
  // Keyed by `index`, so the array is a sparse map rather than an ordered list.
  anchorAdjustments: opt(arr(obj({ index: int({ min: 0 }, { label: 'Anchor' }), offset: point.describe({ unit: 'm', label: 'Offset' }) }), {}, { label: 'Anchor adjustments' })),
  roamRadius: opt(num({ min: 0 }), { label: 'Roam radius', unit: 'm' }), dressing: DressingArraySchema.describe({ label: 'Dressing', role: 'Dressing in' }),
  boundary: opt(enumOf(['playable-coast'] as const), { label: 'Boundary' }),
  // Habitat names are authored free text with no table behind them; no ref kind fits.
  habitatId: opt(str({ nonEmpty: true }), { label: 'Habitat' }),
  firstActorUsesPlacementId: opt(bool(), { label: 'First actor uses placement id' }),
}), row => !row.anchorAdjustments || (new Set(row.anchorAdjustments.map(a => a.index)).size === row.anchorAdjustments.length
  && row.anchorAdjustments.every(a => a.index < row.count)), 'anchor adjustments must have unique in-range indices');
export const ResourcePlacementSchema = obj({ ...ClusterFields, regionId: ref('region', { label: 'Region', role: 'Placed in' }) });
export type EncounterDefinition = Infer<typeof EncounterDefinitionSchema>;
export type WorldPlacement = Infer<typeof WorldPlacementSchema>;
export type ResourcePlacement = Infer<typeof ResourcePlacementSchema>;
