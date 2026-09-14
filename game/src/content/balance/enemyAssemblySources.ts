import type { EnemyDef } from '../index.js';
import type { EnemyAssemblySource } from '../schema/enemyAssemblySources.js';
import { tierMarks, deriveLegacyBoss, type EnemyBalanceStage1 } from './enemies.js';
export type { EnemyAssemblySource } from '../schema/enemyAssemblySources.js';

export type EnemyAssemblySourceParams = Pick<EnemyBalanceStage1,
  'marksPerTier' | 'combatLevel' | 'tuning' | 'regionalBossLevels' | 'legacyMarksInputs' | 'legacyBossInputs'>;
export type AssemblySourceLootResolver = (inputId: string) => EnemyDef['drops'] | undefined;

/** Compose original authored fields with their separately verified marks/combat and loot inputs. */
export function deriveEnemyAssemblySource(params: EnemyAssemblySourceParams, input: Readonly<EnemyAssemblySource>,
  resolveLoot: AssemblySourceLootResolver): EnemyDef {
  if (input.kind === 'redWorm') return { ...input.authored,
    ...(Object.hasOwn(input.authored, 'marks') ? { marks: input.authored.marks ? [...input.authored.marks] : undefined } : {}), drops: [] };
  if (input.lootInputId !== input.legacyInputId || input.legacyInputId !== `legacy/${input.authored.id}`) {
    throw new Error(`Original legacy source references disagree for ${input.id}`);
  }
  const loot = resolveLoot(input.lootInputId);
  if (!loot) throw new Error(`Missing original loot input ${input.lootInputId} for ${input.id}`);
  const drops: EnemyDef['drops'] = loot.map(drop => ({ ...drop, quantity: [drop.quantity[0], drop.quantity[1]] }));
  if (input.kind === 'legacyMarksRemainder') {
    const matches = params.legacyMarksInputs.filter(row => row.id === input.legacyInputId);
    if (matches.length !== 1 || matches[0]!.enemyId !== input.authored.id) throw new Error(`Invalid legacy marks dependency ${input.legacyInputId} for ${input.id}`);
    const source = matches[0]!;
    return { ...input.authored, tier: source.tier, marks: tierMarks(params.marksPerTier, source.tier, source.profile), drops };
  }
  const matches = params.legacyBossInputs.filter(row => row.id === input.legacyInputId);
  if (matches.length !== 1 || matches[0]!.enemyId !== input.authored.id) throw new Error(`Invalid legacy boss dependency ${input.legacyInputId} for ${input.id}`);
  const source = matches[0]!, target = params.regionalBossLevels[source.bossId];
  if (!target) throw new Error(`Missing legacy boss target ${source.bossId} for ${input.id}`);
  return { ...input.authored,
    ...(Object.hasOwn(input.authored, 'marks') ? { marks: input.authored.marks ? [...input.authored.marks] : undefined } : {}),
    ...deriveLegacyBoss(params, source), drops };
}
