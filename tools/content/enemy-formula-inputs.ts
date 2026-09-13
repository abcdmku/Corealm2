/** Extract original authored inputs without evaluating source or reading final combat results. */
import { createHash } from 'node:crypto';
import type { M4Baseline } from './m4-baseline.js';

const SOURCE_PATH = '.baseline/game/src/content/enemies.ts';
const BOSS_IDS = {
  galeskin_t1: 'galeskin', tempest_roc_t1: 'tempest_roc', mossbound_t5: 'mossbound',
  rootheart_t5: 'rootheart', tideworn_t10: 'tideworn', quarrykeeper_t10: 'ordrun', cinderwake_t20: 'cinderwake',
} as const;
const MARKS_IDS = [
  'frog_t1', 'hen_t1', 'goat_t1', 'cattle_t1', 'coney_t1', 'viper_t1', 'reaver_t1',
  'deer_t5', 'hog_t5', 'coyote_t5', 'frog_t5', 'coney_t5', 'viper_t5', 'reaver_t5',
  'bear_t10', 'boar_t10', 'ibex_t10', 'aurochs_t10', 'reaver_t10', 'coyote_t10', 'rat_t10', 'scorpion_t10', 'crab_t10',
  'bear_t20', 'boar_t20', 'ibex_t20', 'viper_t20', 'reaver_t20',
];
const COMBAT_FIELDS = ['maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit'] as const;
type CombatSeed = { [K in typeof COMBAT_FIELDS[number]]: number };
export interface LegacyMarksInput { readonly id: string; enemyId: string; tier: number; profile: 'ordinary' | 'purse' }
export interface LegacyBossInput { readonly id: string; enemyId: string; bossId: typeof BOSS_IDS[keyof typeof BOSS_IDS]; seed: CombatSeed }
export type ExtractedOrdrunPhases = [
  { atHealthFraction: number; attackSpeedMs: number },
  { atHealthFraction: number; armourNumerator: number; armourDenominator: number; attackSpeedMs: number;
    maxHitNumerator: number; maxHitDenominator: number; telegraphId: string; telegraphWindupMs: number; telegraphRadiusM: number },
];
export interface LegacyInputOrigin {
  inputId: string; collection: 'legacyMarksInputs' | 'legacyBossInputs' | 'ordrunPhases';
  module: 'enemies'; symbol: 'BLOCKS' | 'ORDRUN_PHASES'; rowIndex: number;
}

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Legacy enemy input extraction: ${message}`); }

/** A deliberately narrow lexer. Quoted text and comments cannot introduce fake declarations. */
function tokens(source: string): string[] {
  const result: string[] = [];
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|[^\s]/gy;
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    assert(match.index === offset, 'Unrecognized source token'); offset += match[0].length;
    if (!/^\s|^\/\/|^\/\*/.test(match[0])) result.push(match[0]);
  }
  assert(offset === source.length, 'Unterminated source token');
  return result;
}

function split(values: readonly string[]): string[][] {
  const rows: string[][] = []; let row: string[] = []; const stack: string[] = [];
  for (const token of values) {
    if (token === ',' && !stack.length) { assert(row.length, 'Empty literal entry'); rows.push(row); row = []; continue; }
    if (['[', '{', '('].includes(token)) stack.push(token);
    if ([']', '}', ')'].includes(token)) assert(stack.pop() === ({ ']': '[', '}': '{', ')': '(' }[token]), 'Unbalanced literal');
    row.push(token);
  }
  assert(!stack.length, 'Unclosed literal'); if (row.length) rows.push(row);
  return rows;
}

function arrayDeclaration(source: readonly string[], name: string): string[][] {
  const matches = source.flatMap((token, index) => token === 'const' && source[index + 1] === name ? [index] : []);
  assert(matches.length === 1, `Expected one ${name} declaration`);
  let start = matches[0]! + 2;
  while (start < source.length && source[start] !== '=' && source[start] !== ';') start++;
  assert(source[start] === '=' && source[start + 1] === '[', `${name} must be a literal array`);
  start += 2; let depth = 1, end = start;
  for (; end < source.length; end++) {
    if (source[end] === '[') depth++;
    if (source[end] === ']' && --depth === 0) break;
  }
  assert(end < source.length && source[end + 1] === ';', `${name} must end at its literal array`);
  return split(source.slice(start, end));
}

function object(row: readonly string[]): Map<string, string[]> {
  assert(row[0] === '{' && row.at(-1) === '}', 'Expected literal object');
  const properties = new Map<string, string[]>();
  for (const property of split(row.slice(1, -1))) {
    const key = property[0]!;
    assert(/^[A-Za-z_$][\w$]*$/.test(key) && property[1] === ':' && property.length > 2, 'Expected explicit literal property');
    assert(!properties.has(key), `Duplicate property ${key}`); properties.set(key, property.slice(2));
  }
  return properties;
}
function field(row: Map<string, string[]>, name: string): string[] {
  const value = row.get(name); assert(value, `Missing property ${name}`); return value;
}
function number(value: readonly string[], label: string): number {
  assert(value.length === 1 && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value[0]!), `${label} must be a numeric literal`);
  const result = Number(value[0]); assert(Number.isFinite(result), `${label} must be finite`); return result;
}
function string(value: readonly string[], label: string): string {
  assert(value.length === 1 && /^(?:"[^"\\]+"|'[^'\\]+')$/.test(value[0]!), `${label} must be an unescaped string literal`);
  return value[0]!.slice(1, -1);
}
function exact(value: readonly string[], expected: readonly string[], label: string): void {
  assert(value.join('\0') === expected.join('\0'), `Unsupported ${label} expression`);
}
function ratio(value: readonly string[], name: 'armour' | 'maxHit'): [number, number] {
  assert(value.length === 12, `Unsupported Ordrun ${name} ratio`);
  exact(value.slice(0, 8), ['Math', '.', 'round', '(', 'balancedOrdrun', '.', name, '*'], `Ordrun ${name}`);
  exact([value[9]!, value[11]!], ['/', ')'], `Ordrun ${name} division`);
  const numerator = number([value[8]!], name), denominator = number([value[10]!], name);
  assert(denominator > 0, `Ordrun ${name} denominator must be positive`); return [numerator, denominator];
}

export function buildLegacyEnemyInputs(baseline: M4Baseline, originalEnemiesSource: string) {
  const sha256 = createHash('sha256').update(originalEnemiesSource).digest('hex');
  const sources = baseline.source.files.filter(row => row.path === SOURCE_PATH);
  assert(sources.length === 1 && sources[0]!.sha256 === sha256, 'Original enemies source hash does not match baseline');
  const source = tokens(originalEnemiesSource);
  const marksCalls = source.filter((token, index) => (token === 'marksFor' || token === 'purseMarksFor')
    && source[index + 1] === '(' && source[index - 1] !== 'function');
  assert(marksCalls.length === 28, 'Expected exactly 28 original marks call sites');
  const blocks = arrayDeclaration(source, 'BLOCKS').map(object);
  assert(blocks.length === 35 && baseline.original.blocks.length === 35, 'Expected 35 original BLOCKS rows');
  const ids = blocks.map(row => string(field(row, 'id'), 'BLOCKS.id'));
  assert(new Set(ids).size === 35, 'Duplicate original BLOCKS identity');
  assert(ids.every((id, index) => baseline.original.blocks[index]!.id === id), 'Original BLOCKS identities/order do not match baseline');
  const legacyMarksInputs: LegacyMarksInput[] = [], legacyBossInputs: LegacyBossInput[] = [], origins: LegacyInputOrigin[] = [];
  blocks.forEach((row, rowIndex) => {
    const enemyId = ids[rowIndex]!, id = `legacy/${enemyId}`;
    const marks = field(row, 'marks');
    if (marks[0] === 'marksFor' || marks[0] === 'purseMarksFor') {
      assert(marks.length === 4 && marks[1] === '(' && marks[3] === ')', `${enemyId} marks must be an original one-argument call`);
      const tier = number([marks[2]!], `${enemyId} marks tier`);
      assert(Number.isInteger(tier) && tier > 0 && tier === number(field(row, 'tier'), `${enemyId}.tier`), `${enemyId} marks tier mismatch`);
      legacyMarksInputs.push({ id, enemyId, tier, profile: marks[0] === 'marksFor' ? 'ordinary' : 'purse' });
      origins.push({ inputId: id, collection: 'legacyMarksInputs', module: 'enemies', symbol: 'BLOCKS', rowIndex });
    } else {
      assert(Object.hasOwn(BOSS_IDS, enemyId), `Unexpected nonformula marks row ${enemyId}`);
      const original = baseline.original.blocks[rowIndex]!;
      const seed = {} as CombatSeed;
      for (const key of COMBAT_FIELDS) {
        const literal = number(field(row, key), `${enemyId}.${key}`);
        assert(literal === original[key], `${enemyId}.${key} original seed differs from source literal`);
        assert(literal >= 0 && (!['maxHealth', 'attackLevel', 'defenceLevel', 'maxHit'].includes(key) || literal > 0), `${enemyId}.${key} invalid seed`);
        seed[key] = original[key];
      }
      legacyBossInputs.push({ id, enemyId, bossId: BOSS_IDS[enemyId as keyof typeof BOSS_IDS], seed });
      origins.push({ inputId: id, collection: 'legacyBossInputs', module: 'enemies', symbol: 'BLOCKS', rowIndex });
    }
  });
  assert(legacyMarksInputs.length === 28 && legacyMarksInputs.every((row, index) => row.enemyId === MARKS_IDS[index]), 'Expected the 28 original marks identities');
  assert(legacyMarksInputs.filter(row => row.profile === 'purse').length === 4, 'Expected four original purse marks calls');
  assert(legacyBossInputs.length === 7 && Object.keys(BOSS_IDS).every(id => legacyBossInputs.some(row => row.enemyId === id)), 'Expected seven saved boss identities');

  const phases = arrayDeclaration(source, 'ORDRUN_PHASES').map(object);
  assert(phases.length === 2, 'Expected two Ordrun phases');
  const first = phases[0]!, second = phases[1]!;
  assert(first.size === 4 && second.size === 7, 'Unexpected Ordrun phase fields');
  exact(field(first, 'armour'), ['balancedOrdrun', '.', 'armour'], 'Ordrun first armour');
  exact(field(first, 'maxHit'), ['balancedOrdrun', '.', 'maxHit'], 'Ordrun first maxHit');
  const [armourNumerator, armourDenominator] = ratio(field(second, 'armour'), 'armour');
  const [maxHitNumerator, maxHitDenominator] = ratio(field(second, 'maxHit'), 'maxHit');
  const ordrunPhases: ExtractedOrdrunPhases = [
    { atHealthFraction: number(field(first, 'atHealthFraction'), 'phase 1 threshold'), attackSpeedMs: number(field(first, 'attackSpeedMs'), 'phase 1 speed') },
    { atHealthFraction: number(field(second, 'atHealthFraction'), 'phase 2 threshold'), armourNumerator, armourDenominator,
      attackSpeedMs: number(field(second, 'attackSpeedMs'), 'phase 2 speed'), maxHitNumerator, maxHitDenominator,
      telegraphId: string(field(second, 'telegraphId'), 'phase 2 telegraph'),
      telegraphWindupMs: number(field(second, 'telegraphWindupMs'), 'phase 2 windup'), telegraphRadiusM: number(field(second, 'telegraphRadiusM'), 'phase 2 radius') },
  ];
  assert(ordrunPhases[0].atHealthFraction <= 1 && ordrunPhases[1].atHealthFraction < ordrunPhases[0].atHealthFraction, 'Invalid Ordrun phase thresholds');
  for (const phase of ordrunPhases) assert(Number.isInteger(phase.attackSpeedMs) && phase.attackSpeedMs > 0, 'Invalid Ordrun attack speed');
  assert(Number.isInteger(ordrunPhases[1].telegraphWindupMs) && ordrunPhases[1].telegraphWindupMs > 0 && ordrunPhases[1].telegraphRadiusM > 0, 'Invalid Ordrun telegraph');
  for (let rowIndex = 0; rowIndex < 2; rowIndex++) origins.push({ inputId: `legacy/ordrunPhase${rowIndex + 1}`, collection: 'ordrunPhases', module: 'enemies', symbol: 'ORDRUN_PHASES', rowIndex });
  return { legacyMarksInputs, legacyBossInputs, ordrunPhases, manifest: { source: { path: SOURCE_PATH, sha256 }, rows: origins } };
}
