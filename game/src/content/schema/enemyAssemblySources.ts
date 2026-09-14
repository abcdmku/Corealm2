import { arr, discriminated, id, lit, obj, refine, str, tuple, type Infer } from './core.js';
import { EnemyFields } from './enemies.js';

const inputRef = () => str({ nonEmpty: true }, { readOnly: true });
const identity = { id: EnemyFields.id, family: EnemyFields.family, name: EnemyFields.name };
const combat = { maxHealth: EnemyFields.maxHealth, attackLevel: EnemyFields.attackLevel,
  defenceLevel: EnemyFields.defenceLevel, accuracy: EnemyFields.accuracy, armour: EnemyFields.armour,
  magicArmour: EnemyFields.magicArmour, maxHit: EnemyFields.maxHit };
const other = { attackSpeedMs: EnemyFields.attackSpeedMs, aggroRadius: EnemyFields.aggroRadius,
  behaviour: EnemyFields.behaviour, moveSpeedMps: EnemyFields.moveSpeedMps, walkSpeedMps: EnemyFields.walkSpeedMps,
  attackStyle: EnemyFields.attackStyle, attackRangeM: EnemyFields.attackRangeM, respawnSeconds: EnemyFields.respawnSeconds };

export const LegacyMarksRemainderSchema = obj({
  id: id(), kind: lit('legacyMarksRemainder'), legacyInputId: inputRef(), lootInputId: inputRef(),
  authored: obj({ ...identity, ...combat, ...other }),
});
export const LegacyBossRemainderSchema = obj({
  id: id(), kind: lit('legacyBossRemainder'), legacyInputId: inputRef(), lootInputId: inputRef(),
  authored: obj({ ...identity, ...other, marks: EnemyFields.marks }),
});
export const RedWormAssemblySourceSchema = obj({
  id: id(), kind: lit('redWorm'), authored: obj({ ...EnemyFields }), drops: tuple([] as const),
});
export const EnemyAssemblySourceSchema = discriminated('kind', {
  legacyMarksRemainder: LegacyMarksRemainderSchema,
  legacyBossRemainder: LegacyBossRemainderSchema,
  redWorm: RedWormAssemblySourceSchema,
});
export const EnemyAssemblySourcesSchema = refine(arr(EnemyAssemblySourceSchema), rows =>
  new Set(rows.map(row => row.id)).size === rows.length
  && new Set(rows.map(row => row.authored.id)).size === rows.length,
  'assembly source ids and original enemy ids must be unique');
export type EnemyAssemblySource = Infer<typeof EnemyAssemblySourceSchema>;
