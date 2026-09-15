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

/** One `group` per grid the creature sheet draws: identity, then the combat numbers. */
export const EnemyFields = {
  id: id(),
  name: nonempty().describe({ label: "Name", display: true }),
  family: ref("enemyFamily", { label: "Family", role: "Family of" }),
  tier: int({ min: 1 }, { label: "Tier", step: 1 }),
  maxHealth: int({ min: 1 }, { label: "Health", step: 1, group: "combat" }),
  attackLevel: int({ min: 1 }, { label: "Attack level", step: 1, group: "combat" }),
  defenceLevel: int({ min: 1 }, { label: "Defence level", step: 1, group: "combat" }),
  accuracy: int({ min: 0 }, { label: "Accuracy", step: 1, group: "combat" }),
  armour: int({ min: 0 }, { label: "Armour", step: 1, group: "combat" }),
  magicArmour: int({ min: 0 }, { label: "Magic armour", step: 1, group: "combat" }),
  maxHit: int({ min: 1 }, { label: "Max hit", step: 1, group: "combat" }),
  attackSpeedMs: int({ min: 1 }, { unit: "ms", label: "Attack interval", step: 1, group: "combat" }),
  aggroRadius: num({ min: 0 }, { unit: "m", label: "Aggro radius", group: "combat" }),
  behaviour: enumOf(["passive", "aggressive", "territorial"] as const, { label: "Behaviour", group: "combat" }),
  moveSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: "m/s", label: "Chase speed", group: "movement" })),
  walkSpeedMps: opt(num({ exclusiveMin: 0 }, { unit: "m/s", label: "Walk speed", group: "movement" })),
  marks: opt(MarksRangeSchema.describe({ label: "Marks dropped", unit: "marks", group: "combat" })),
  attackStyle: opt(enumOf(["melee", "ranged", "magic"] as const, { label: "Attack style", group: "combat" })),
  attackRangeM: opt(num({ exclusiveMin: 0 }, { unit: "m", label: "Attack range", group: "combat" })),
  respawnSeconds: opt(num({ min: 0 }, { unit: "s", label: "Respawn", group: "movement" })),
};

export const EnemySchema = obj({
  ...EnemyFields,
  drops: arr(DropSchema, {}, { label: "Drops", role: "Dropped by", probability: "chance" }),
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
