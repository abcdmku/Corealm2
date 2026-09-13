import { arr, enumOf, id, int, lit, num, obj, refine, str, tuple, union, type Infer, type Schema } from './core.js';

const positive = () => num({ exclusiveMin: 0 });
const positiveInt = () => int({ min: 1 });
const nonnegativeInt = () => int({ min: 0 });
const nonempty = () => str({ nonEmpty: true });
const behaviour = () => enumOf(['passive', 'aggressive', 'territorial'] as const);
const marks = () => refine(tuple<[Schema<number>, Schema<number>]>([nonnegativeInt(), nonnegativeInt()]),
  ([low, high]) => low <= high, 'marks minimum must not exceed maximum');
const fairyTier = () => union([lit(30), lit(60)] as const);
export const UNIVERSAL_ACTOR_NUMBERS = ['01', '02', '03', '04', '05', '06', '07', '08', '09'] as const;

// These factories have complete literal seeds. Missing original optional fields stay absent.
const template = {
  id: nonempty(), family: nonempty(), name: nonempty(), tier: positiveInt(),
  maxHealth: positiveInt(), attackLevel: positiveInt(), defenceLevel: positiveInt(),
  accuracy: nonnegativeInt(), armour: nonnegativeInt(), magicArmour: nonnegativeInt(), maxHit: positiveInt(),
  attackSpeedMs: positiveInt(), aggroRadius: num({ min: 0 }), moveSpeedMps: positive(),
  walkSpeedMps: positive(), behaviour: behaviour(),
};
export const FairyActorTemplateSchema = obj(template);
export const GardenActorTemplateSchema = obj(template);
export const UniversalActorTemplateSchema = obj({ ...template, attackRangeM: positive() });
export const UniversalSourceInputSchema = obj({
  id: id(), kind: lit('universal'), number: enumOf(UNIVERSAL_ACTOR_NUMBERS), name: nonempty(),
  style: enumOf(['melee', 'magic'] as const), tier: positiveInt(),
});
const fairyIdentity = { id: id(), speciesId: nonempty(), family: nonempty(), name: nonempty(),
  tier: fairyTier(), levelOffset: int() };
export const FairySourceInputSchema = obj({ ...fairyIdentity, kind: lit('fairy') });
export const GardenSourceInputSchema = obj({ ...fairyIdentity, kind: lit('garden'),
  speed: positive(), behaviour: behaviour() });
export const ActorEnemySourceInputSchema = union([
  UniversalSourceInputSchema, FairySourceInputSchema, GardenSourceInputSchema,
] as const);
export const ActorSourceInputsSchema = refine(arr(ActorEnemySourceInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'source input ids must be unique');
export const UniversalActorParamsSchema = obj({
  template: UniversalActorTemplateSchema, minimumRegionTier: positiveInt(), minimumTargetLevel: positiveInt(),
  targetLevelMultiplier: positive(), respawnSeconds: num({ min: 0 }), marksMinimum: marks(), marksPerTier: marks(),
});
export const FairyActorParamsSchema = obj({
  template: FairyActorTemplateSchema, aggressiveLevelOffset: int(),
  aggroRadius: obj({ aggressive: num({ min: 0 }), other: num({ min: 0 }) }), marksPerTier: marks(),
});
export const GardenActorParamsSchema = obj({
  template: GardenActorTemplateSchema, walkSpeedCap: positive(), walkSpeedMultiplier: positive(),
  aggroRadius: obj({ aggressive: num({ min: 0 }), other: num({ min: 0 }) }), marksPerTier: marks(),
});
export const ActorSourceParamsSchema = obj({
  universal: UniversalActorParamsSchema, fairy: FairyActorParamsSchema, garden: GardenActorParamsSchema,
});
export type UniversalSourceInput = Infer<typeof UniversalSourceInputSchema>;
export type FairySourceInput = Infer<typeof FairySourceInputSchema>;
export type GardenSourceInput = Infer<typeof GardenSourceInputSchema>;
export type ActorEnemySourceInput = Infer<typeof ActorEnemySourceInputSchema>;
export type ActorSourceParams = Infer<typeof ActorSourceParamsSchema>;
