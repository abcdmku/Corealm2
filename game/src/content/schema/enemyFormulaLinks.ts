import { EnemyBalanceSchema } from './enemyBalance.js';
import { EnemyDerivationSchema } from './enemyDerivation.js';
import { parseValue, type SchemaIssue } from './core.js';
import { deriveEnemySourceGraph } from '../balance/enemySourceGraph.js';

const savedBossTargets = {
  galeskin: 'galeskin_t1', tempest_roc: 'tempest_roc_t1', mossbound: 'mossbound_t5', rootheart: 'rootheart_t5',
  tideworn: 'tideworn_t10', ordrun: 'quarrykeeper_t10', cinderwake: 'cinderwake_t20',
} as const;

/** Formula references are checked against editable inputs, never against final generated stats. */
export function validateEnemyFormulaLinks(tables: ReadonlyMap<string, unknown>): SchemaIssue[] {
  const rows = tables.get('enemies');
  if (!Array.isArray(rows) || !tables.has('balance/enemies')) return [];
  const issues: SchemaIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  const params = parseValue(EnemyBalanceSchema, tables.get('balance/enemies'), 'balance/enemies');
  const graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs);
  const sources = new Map(params.sourceInputs.map(input => [input.id, { input, output: graph.get(input.id)! }]));
  for (const id of params.fantasy.sourceInputIds) if (!sources.has(id)) issue('balance/enemies.fantasy.sourceInputIds', `Missing fantasy source ${id}`);
  const enemies = new Map(rows.map((row: { id: string; catalog: string; stage: string; derivation?: unknown }) => [row.id, row]));
  for (const input of params.legacyBossInputs) {
    if (input.enemyId !== savedBossTargets[input.bossId]) issue(`balance/enemies.legacyBossInputs.${input.id}.enemyId`, 'Boss input must retain its original saved enemy identity');
  }
  for (const input of params.legacyMarksInputs) {
    if (Object.values(savedBossTargets).some(id => id === input.enemyId)) issue(`balance/enemies.legacyMarksInputs.${input.id}.enemyId`, 'Legacy boss marks are authored and cannot use an ordinary marks input');
  }
  for (const [name, inputs] of [['legacyMarksInputs', params.legacyMarksInputs], ['legacyBossInputs', params.legacyBossInputs]] as const) {
    for (const input of inputs) {
      const enemy = enemies.get(input.enemyId);
      if (!enemy || enemy.catalog !== 'LEGACY_BLOCKS' || enemy.stage !== 'registered') {
        issue(`balance/enemies.${name}.${input.id}.enemyId`, 'Legacy formula input must target a registered legacy canonical enemy');
      }
    }
  }
  for (const row of enemies.values()) {
    if (row.derivation === undefined) continue;
    const at = `enemies.${row.id}.derivation`;
    const tag = parseValue(EnemyDerivationSchema, row.derivation, at);
    if (tag.kind === 'fantasyScale.v1') {
      const source = sources.get(tag.sourceInputId);
      if (!source || !params.fantasy.sourceInputIds.includes(tag.sourceInputId) || !params.fantasy.tiers.includes(tag.tier)) issue(at, 'Fantasy source or tier is missing');
      if (row.catalog !== 'FANTASY_TIER_BLOCKS' || row.stage !== 'registered') issue(at, 'Fantasy derivation requires a registered scaled fantasy row');
      if (source && `${source.output.family}_t${tag.tier}` !== row.id) issue(at, 'Fantasy source belongs to another saved enemy');
      if (source && tag.tier === source.output.tier) issue(at, 'Native fantasy rows retain their original source derivation');
      continue;
    }
    if (tag.kind === 'sourceEnemy.v1') {
      const source = sources.get(tag.inputId);
      if (!source || source.output.id !== row.id) issue(`${at}.inputId`, 'Source input is missing or belongs to another enemy');
      if (source) {
        const catalogs = source.input.kind === 'rpg' ? ['RPG_BESTIARY_BLOCKS', 'RPG_BESTIARY_STAGED_BLOCKS'] : ['CREATURE_SPECIES_BLOCKS'];
        if (!catalogs.includes(row.catalog)) issue(at, 'Source formula catalog disagrees with its original generator');
      }
      continue;
    }
    const inputs = tag.kind === 'legacyMarks.v1' ? params.legacyMarksInputs : params.legacyBossInputs;
    const input = inputs.find(entry => entry.id === tag.inputId);
    if (!input || input.enemyId !== row.id) issue(`${at}.inputId`, 'Formula input is missing or belongs to another enemy');
    if (row.catalog !== 'LEGACY_BLOCKS' || row.stage !== 'registered') issue(at, 'Legacy formula tags require a registered legacy canonical enemy');
  }
  return issues;
}
