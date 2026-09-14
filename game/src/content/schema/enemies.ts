import type { EnemyDef } from "../index.js";
import { DropSchema } from "./loot.js";
import { arr, enumOf, id, int, num, obj, opt, ref, refine, str, tuple, type Schema } from "./core.js";

const nonempty = () => str({ nonEmpty: true });

// EnemyDef uses mutable pairs. The explicit tuple generic preserves assignability.
// Do not reuse core.intRange, whose inferred pair is readonly.
const MarksRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 0 }), int({ min: 0 })]),
  ([low, high]) => low <= high,
  "marks minimum must not exceed maximum",
);

export const EnemyFields = {
  id: id(),
  name: nonempty(),
  family: ref("enemyFamily"),
  tier: int({ min: 1 }),
  maxHealth: int({ min: 1 }),
  attackLevel: int({ min: 1 }),
  defenceLevel: int({ min: 1 }),
  accuracy: int({ min: 0 }),
  armour: int({ min: 0 }),
  magicArmour: int({ min: 0 }),
  maxHit: int({ min: 1 }),
  attackSpeedMs: int({ min: 1 }, { unit: "ms" }),
  aggroRadius: num({ min: 0 }, { unit: "m" }),
  behaviour: enumOf(["passive", "aggressive", "territorial"] as const),
  moveSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: "m/s" })),
  walkSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: "m/s" })),
  marks: opt(MarksRangeSchema),
  attackStyle: opt(enumOf(["melee", "ranged", "magic"] as const)),
  attackRangeM: opt(num({ exclusiveMin: 0 }, { unit: "m" })),
  respawnSeconds: opt(num({ min: 0 }, { unit: "s" })),
};

export const EnemySchema = obj({
  ...EnemyFields,
  drops: arr(DropSchema),
}) satisfies Schema<EnemyDef>;

// Closed partial EnemyDef excluding id and drops. List the fields explicitly;
// do not widen them through Object.fromEntries or Record<string, Schema>.
export const EnemyOverridesSchema = obj({
  name: opt(EnemyFields.name), family: opt(EnemyFields.family),
  tier: opt(EnemyFields.tier), maxHealth: opt(EnemyFields.maxHealth),
  attackLevel: opt(EnemyFields.attackLevel), defenceLevel: opt(EnemyFields.defenceLevel),
  accuracy: opt(EnemyFields.accuracy), armour: opt(EnemyFields.armour),
  magicArmour: opt(EnemyFields.magicArmour), maxHit: opt(EnemyFields.maxHit),
  attackSpeedMs: opt(EnemyFields.attackSpeedMs), aggroRadius: opt(EnemyFields.aggroRadius),
  behaviour: opt(EnemyFields.behaviour),
  moveSpeedMps: EnemyFields.moveSpeedMps, walkSpeedMps: EnemyFields.walkSpeedMps,
  marks: EnemyFields.marks, attackStyle: EnemyFields.attackStyle,
  attackRangeM: EnemyFields.attackRangeM, respawnSeconds: EnemyFields.respawnSeconds,
});
