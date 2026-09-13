/** Original enemy/alias export. Validate both complete tables before --apply can write either. */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { EnemyDef } from '../../game/src/content/index.js';
import { EnemyRecordSchema, EnemyAliasSchema, EnemySchema, type EnemyRecord, type EnemyAlias } from '../../game/src/content/schema/enemies.js';
import { canonicalRecords, writeContentJson } from './format.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from './m4-baseline.js';
import { buildLegacyEnemyInputs } from './enemy-formula-inputs.js';
import { buildCoreEnemySources } from './enemy-source-inputs.js';
import { deriveCoreEnemy } from '../../game/src/content/balance/enemySources.js';
import { buildVariantEnemySources } from './enemy-source-variant-inputs.js';
import { deriveEnemySourceGraph } from '../../game/src/content/balance/enemySourceGraph.js';
import { scaleFantasy } from '../../game/src/content/balance/enemySourceVariants.js';
import { repoRoot } from '../lib/paths.js';

function equal(expected: unknown, actual: unknown, label: string): void {
  if (!isDeepStrictEqual(expected, actual)) throw new Error(`Enemy export parity failed: ${label}`);
}

/** Decode evidence before equality: object key order is formatting, while Map/array order is data. */
export function restoreSnapshot(value: Snapshot): unknown {
  switch (value.kind) {
    case 'null': return null;
    case 'undefined': return undefined;
    case 'number': case 'string': case 'boolean': return value.value;
    case 'array': return value.values.map(restoreSnapshot);
    case 'set': return new Set(value.values.map(restoreSnapshot));
    case 'map': return new Map(value.entries.map(([key, entry]) => [restoreSnapshot(key), restoreSnapshot(entry)]));
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restoreSnapshot(entry)]));
  }
}

/** Schema validation and exact baseline equality include optional-key absence and sparse overrides. */
export function buildEnemyRecords(baseline: M4Baseline): { enemies: EnemyRecord[]; aliases: EnemyAlias[] } {
  const enemies = canonicalRecords(EnemyRecordSchema, baseline.records.enemies, 'enemies');
  const aliases = canonicalRecords(EnemyAliasSchema, baseline.records.aliases, 'enemyAliases');
  equal(baseline.records.enemies, enemies, 'canonical records');
  equal(baseline.records.aliases, aliases, 'alias records');
  const lootMap = new Map(baseline.records.lootTables.map(row => [row.id, row.drops]));
  const blocks = new Map<string, EnemyDef>();
  for (const record of enemies) {
    let row: Omit<EnemyDef, 'drops'>;
    if (record.stage === 'registered') {
      const { catalog: _catalog, stage: _stage, lootTableId: _loot, registrationOrder: _registration, fantasyTierOrder: _fantasy, ...stats } = record;
      row = stats;
    } else {
      const { catalog: _catalog, stage: _stage, lootTableId: _loot, labOrder: _lab, ...stats } = record;
      row = stats;
    }
    const { lootTableId } = record;
    const drops = lootMap.get(lootTableId);
    if (!drops) throw new Error(`Missing enemy loot ${lootTableId}`);
    blocks.set(row.id, { ...row, drops });
  }
  const resolved = new Map(blocks);
  for (const alias of aliases) {
    const base = blocks.get(alias.blockId);
    if (!base || resolved.has(alias.id)) throw new Error(`Invalid alias identity/base ${alias.id}`);
    const drops = alias.lootTableId === undefined ? base.drops : lootMap.get(alias.lootTableId);
    if (!drops) throw new Error(`Missing alias loot ${alias.id}`);
    resolved.set(alias.id, { ...base, ...alias.overrides, id: alias.id, drops });
  }
  canonicalRecords(EnemySchema, [...resolved.values()], 'resolvedEnemies');
  const actualOrder = [...enemies.filter(row => row.stage === 'registered'), ...aliases]
    .sort((a, b) => a.registrationOrder - b.registrationOrder).map(row => row.id);
  equal(baseline.original.registeredOrder, actualOrder, 'registered order');
  equal(baseline.original.canonicalOrder, enemies.filter(row => row.stage === 'registered').map(row => row.id), 'canonical file order');
  equal(baseline.original.labOrder, enemies.filter(row => row.stage === 'labOnly').sort((a, b) => a.labOrder - b.labOrder).map(row => row.id), 'lab order');
  equal(baseline.original.fantasyTierOrder, enemies.filter(row => row.stage === 'registered' && row.fantasyTierOrder !== undefined)
    .sort((a, b) => (a.stage === 'registered' ? a.fantasyTierOrder! : 0) - (b.stage === 'registered' ? b.fantasyTierOrder! : 0)).map(row => row.id), 'fantasy view order');
  // Compare resolved values with the actual captured named export, not only normalized records.
  const expected = baseline.constants.find(row => row.module === 'enemies' && row.name === 'ENEMIES');
  if (!expected) throw new Error('Missing original ENEMIES snapshot');
  equal(restoreSnapshot(expected.value), actualOrder.map(id => resolved.get(id)!), 'all original ENEMIES values');
  const inputs = buildLegacyEnemyInputs(baseline, readFileSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts'), 'utf8'));
  for (const [rows, kind] of [[inputs.legacyMarksInputs, 'legacyMarks.v1'], [inputs.legacyBossInputs, 'legacyBossCombat.v1']] as const) {
    for (const input of rows) {
      const row = enemies.find(row => row.id === input.enemyId);
      if (!row || row.stage !== 'registered' || row.catalog !== 'LEGACY_BLOCKS') throw new Error(`Invalid legacy formula target ${input.enemyId}`);
      row.derivation = { kind, inputId: input.id };
    }
  }
  const core = buildCoreEnemySources(baseline, {
    creatureExpansion: readFileSync(path.join(repoRoot, '.baseline/game/src/content/creatureExpansion.ts'), 'utf8'),
    starterCreatures: readFileSync(path.join(repoRoot, '.baseline/game/src/content/starterCreatures.ts'), 'utf8'),
    rpgBestiary: readFileSync(path.join(repoRoot, '.baseline/game/src/content/rpgBestiary.ts'), 'utf8'),
  });
  for (const input of core.inputs) {
    const output = deriveCoreEnemy(core.params, input);
    const row = enemies.find(row => row.id === output.id);
    if (!row || row.derivation) throw new Error(`Missing or already linked source target ${output.id}`);
    for (const key of Object.keys(output) as (keyof typeof output)[]) equal(output[key], row[key], `Source input ${input.id}.${key}`);
    row.derivation = { kind: 'sourceEnemy.v1', inputId: input.id };
  }
  const sourceText = (name: string) => readFileSync(path.join(repoRoot, '.baseline/game/src/content', `${name}.ts`), 'utf8');
  const variants = buildVariantEnemySources(baseline, {
    regionalCreatureVariants: sourceText('regionalCreatureVariants'), creatureRedesign: sourceText('creatureRedesign'),
    forestCreatureRedesigns: sourceText('forestCreatureRedesigns'), ashCreatureRedesigns: sourceText('ashCreatureRedesigns'),
    stoneCreatureRedesigns: sourceText('stoneCreatureRedesigns'), enemies: sourceText('enemies'),
  }, core.inputs);
  const graph = deriveEnemySourceGraph({ ...core.params, ...variants.params }, [...core.inputs, ...variants.inputs]);
  for (const input of variants.inputs) {
    const output = graph.get(input.id)!;
    const row = enemies.find(row => row.id === output.id);
    if (!row || row.derivation) throw new Error(`Missing or already linked variant ${output.id}`);
    for (const key of Object.keys(output) as (keyof typeof output)[]) equal(output[key], row[key], `Variant ${input.id}.${key}`);
    row.derivation = { kind: 'sourceEnemy.v1', inputId: input.id };
  }
  for (const sourceInputId of variants.sourceInputIds) {
    const source = graph.get(sourceInputId)!;
    for (const tier of variants.fantasy.tiers) {
      if (tier === source.tier) continue;
      const { drops: _drops, ...output } = scaleFantasy(variants.fantasy, { ...source, drops: [] }, tier);
      const row = enemies.find(row => row.id === output.id);
      if (!row || row.derivation || row.catalog !== 'FANTASY_TIER_BLOCKS') throw new Error(`Invalid scaled fantasy row ${output.id}`);
      for (const key of Object.keys(output) as (keyof typeof output)[]) equal(output[key], row[key], `Fantasy ${sourceInputId}.${key}`);
      row.derivation = { kind: 'fantasyScale.v1', sourceInputId, tier };
    }
  }
  return { enemies, aliases };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: tsx tools/content/export-enemies.ts [--apply]');
  const records = buildEnemyRecords(await buildM4Baseline());
  console.log(`Validated ${records.enemies.length} canonical enemy records and ${records.aliases.length} aliases against the original exports.`);
  if (args.includes('--apply')) {
    await writeContentJson('data/enemies.json', records.enemies);
    await writeContentJson('data/enemyAliases.json', records.aliases);
    console.log('Wrote game/content/data/enemies.json and enemyAliases.json');
  } else console.log('Dry run: no files written. Pass --apply to write the validated baseline records.');
}
