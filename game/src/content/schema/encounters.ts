import { arr, bool, enumOf, id, int, num, obj, opt, ref, refine, str, tuple, type Infer } from './core.js';
import { DressingArraySchema, ClusterFields } from './spawns.js';
const point = tuple([num(), num()] as const);
const positive = () => num({ exclusiveMin: 0 });
export const EncounterDefinitionSchema = obj({
  id: id(), name: str({ nonEmpty: true }),
  activity: enumOf(['graze', 'forage', 'prowl', 'patrol'] as const),
  members: refine(arr(obj({ creatureId: ref('enemy'), weight: positive() })),
    rows => rows.length > 0 && new Set(rows.map(row => row.creatureId)).size === rows.length,
    'encounter needs unique creature members'),
});
export const WorldPlacementSchema = refine(obj({
  id: id(), encounterId: str({ nonEmpty: true }), regionId: ref('region'),
  centre: point, count: int({ min: 1, max: 64 }), radius: positive(),
  rank: opt(enumOf(['boss', 'miniboss'] as const)),
  level: opt(int({ min: 1 })), scaleMultiplier: opt(positive()),
  formation: obj({ kind: enumOf(['grid', 'ring', 'authored'] as const), spacing: positive(), rotation: num() }),
  anchorAdjustments: opt(arr(obj({ index: int({ min: 0 }), offset: point }))),
  roamRadius: opt(num({ min: 0 })), dressing: DressingArraySchema,
  boundary: opt(enumOf(['playable-coast'] as const)),
  habitatId: opt(str({ nonEmpty: true })),
  firstActorUsesPlacementId: opt(bool()),
}), row => !row.anchorAdjustments || (new Set(row.anchorAdjustments.map(a => a.index)).size === row.anchorAdjustments.length
  && row.anchorAdjustments.every(a => a.index < row.count)), 'anchor adjustments must have unique in-range indices');
export const ResourcePlacementSchema = obj({ ...ClusterFields, regionId: ref('region') });
export type EncounterDefinition = Infer<typeof EncounterDefinitionSchema>;
export type WorldPlacement = Infer<typeof WorldPlacementSchema>;
export type ResourcePlacement = Infer<typeof ResourcePlacementSchema>;
