/** Extract only progression operands from immutable originals, never groups or derived enemies. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { WildernessProgressionParamsSchema } from '../../game/src/content/schema/enemyWildernessProgression.js';
import type { M4Baseline } from './m4-baseline.js';
export const WILDERNESS_PROGRESSION_MODULES = ['wildernessDepth', 'wildernessEnemyProgression'] as const;
type Module = typeof WILDERNESS_PROGRESSION_MODULES[number];
export type WildernessProgressionSources = { [K in Module]: string };
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Wilderness progression extraction: ${message}`); }

// TypeScript 7 does not expose the former compiler AST API. This constrained lexer keeps
// strings opaque and verifies every supported arithmetic shape before taking its literals.
function tokens(source: string): string[] {
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|[^\s]/gy;
  const result: string[] = []; let offset = 0;
  for (const match of source.matchAll(pattern)) {
    assert(match.index === offset, 'Unrecognized source token'); offset += match[0].length;
    if (!/^\s|^\/\/|^\/\*/.test(match[0])) result.push(match[0]);
  }
  assert(offset === source.length, 'Unterminated source token'); return result;
}
const closes: { [key: string]: string | undefined } = { ')': '(', ']': '[', '}': '{' };
function split(values: readonly string[], separator = ','): string[][] {
  const result: string[][] = [], stack: string[] = []; let row: string[] = [];
  for (const token of values) {
    if (!stack.length && token === separator) { assert(row.length, 'Empty literal entry'); result.push(row); row = []; continue; }
    if (['(', '[', '{'].includes(token)) stack.push(token);
    if (closes[token]) assert(stack.pop() === closes[token], 'Unbalanced expression');
    row.push(token);
  }
  assert(!stack.length, 'Unclosed expression'); if (row.length) result.push(row); return result;
}
function closeAt(values: readonly string[], start: number): number {
  const opening = values[start], closing = Object.keys(closes).find(key => closes[key] === opening);
  assert(closing, 'Expected opening delimiter'); let depth = 0;
  for (let i = start; i < values.length; i++) {
    if (values[i] === opening) depth++;
    if (values[i] === closing && --depth === 0) return i;
  }
  throw new Error('Wilderness progression extraction: Unclosed delimiter');
}
function declaration(values: readonly string[], name: string): string[] {
  const indices = values.flatMap((value, index) => value === 'const' && values[index + 1] === name ? [index] : []);
  assert(indices.length === 1, `Expected one ${name} declaration`);
  let start = indices[0]! + 2;
  while (start < values.length && values[start] !== '=' && values[start] !== ';') start++;
  assert(values[start] === '=', `Missing ${name} initializer`); start++;
  let end = start;
  for (; end < values.length && values[end] !== ';'; end++) if (['(', '[', '{'].includes(values[end]!)) end = closeAt(values, end);
  assert(end < values.length, `Unterminated ${name} initializer`); return values.slice(start, end);
}
function fn(values: readonly string[], name: string): { args: string[][]; body: string[] } {
  const indices = values.flatMap((value, index) => value === 'function' && values[index + 1] === name ? [index] : []);
  assert(indices.length === 1, `Expected one ${name} function`);
  const start = indices[0]! + 2; assert(values[start] === '(', `Unexpected ${name} signature`);
  const end = closeAt(values, start); let bodyStart = end + 1;
  while (bodyStart < values.length && values[bodyStart] !== '{') bodyStart++;
  assert(bodyStart < values.length, `Missing ${name} body`);
  return { args: split(values.slice(start + 1, end)), body: values.slice(bodyStart + 1, closeAt(values, bodyStart)) };
}
function object(value: readonly string[]): Properties {
  assert(value[0] === '{' && value.at(-1) === '}', 'Expected literal object');
  const result: Properties = new Map();
  for (const prop of split(value.slice(1, -1))) {
    const key = prop[0] === '.' ? prop.join('') : prop[0]!;
    assert(!result.has(key), `Duplicate property ${key}`);
    if (prop.length === 1 || prop.slice(0, 3).join('') === '...') result.set(key, prop);
    else { assert(/^[A-Za-z_$][\w$]*$/.test(key) && prop[1] === ':', 'Expected explicit property'); result.set(key, prop.slice(2)); }
  }
  return result;
}
function array(value: readonly string[]): string[][] {
  assert(value[0] === '[' && closeAt(value, 0) === value.length - 1, 'Expected literal array'); return split(value.slice(1, -1));
}
function get(row: Properties, name: string): string[] { const value = row.get(name); assert(value, `Missing property ${name}`); return value; }
function string(value: readonly string[]): string {
  assert(value.length === 1 && /^(?:"[^"\\]*"|'[^'\\]*')$/.test(value[0]!), 'Expected unescaped string literal'); return value[0]!.slice(1, -1);
}
function number(value: readonly string[]): number {
  assert(value.length === 1 && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value[0]!), 'Expected numeric literal');
  const result = Number(value[0]); assert(Number.isFinite(result), 'Expected finite literal'); return result;
}
function canonical(token: string): string { return /^['"]/.test(token) ? JSON.stringify(string([token])) : token; }
function capture(actual: readonly string[], expected: string, label: string): Map<string, string> {
  const pattern = tokens(expected), result = new Map<string, string>();
  assert(pattern.length === actual.length, `Unsupported ${label} expression`);
  pattern.forEach((token, index) => {
    const value = actual[index]!;
    if (token.startsWith('__')) {
      assert(!result.has(token) || canonical(result.get(token)!) === canonical(value), `Inconsistent ${label} literal`); result.set(token, value);
    } else assert(canonical(token) === canonical(value), `Unsupported ${label} expression`);
  });
  return result;
}
function n(captures: Map<string, string>, name: string): number { const value = captures.get(`__${name}`); assert(value, `Missing ${name} numeric capture`); return number([value]); }
function s(captures: Map<string, string>, name: string): string { const value = captures.get(`__${name}`); assert(value, `Missing ${name} string capture`); return string([value]); }
function fields(row: Properties, names: readonly string[], label: string): void {
  assert(row.size === names.length && names.every(key => row.has(key)), `Unsupported ${label} fields`);
}

export function buildWildernessProgressionInputs(baseline: M4Baseline, sources: WildernessProgressionSources) {
  assert(Object.keys(sources).length === WILDERNESS_PROGRESSION_MODULES.length, 'Expected both original progression modules');
  const files = WILDERNESS_PROGRESSION_MODULES.map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, source = sources[module];
    assert(typeof source === 'string', `Missing ${module} source`);
    const sha256 = createHash('sha256').update(source).digest('hex'), matches = baseline.source.files.filter(file => file.path === path);
    assert(matches.length === 1 && matches[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const depth = tokens(sources.wildernessDepth), progression = tokens(sources.wildernessEnemyProgression);
  const depthInit = declaration(depth, 'WILDERNESS_DEPTH'), depthEnd = closeAt(depthInit, 0);
  capture(depthInit.slice(depthEnd + 1), 'as const', 'depth suffix');
  const depthRows = object(depthInit.slice(0, depthEnd + 1));
  fields(depthRows, ['south', 'divide', 'north', 'shallowTier', 'deepTier', 'magicFadeStart', 'magicFadeEnd'], 'depth');
  // Atmospheric operands and unused shallowTier/deepTier labels are not progression dependencies.
  capture(fn(depth, 'wildernessTierAt').body, 'return z < WILDERNESS_DEPTH.divide ? 50 : 70;', 'tier selection');
  capture(fn(progression, 'bandProgress').body, `
    const south = tier === 50 ? WILDERNESS_DEPTH.south : WILDERNESS_DEPTH.divide;
    const north = tier === 50 ? WILDERNESS_DEPTH.divide : WILDERNESS_DEPTH.north;
    return Math.max(0, Math.min(1, (z - south) / (north - south)));`, 'band progress');
  const level = capture(fn(progression, 'wildernessEnemyLevelAt').body, `
    if (!Number.isFinite(z)) throw new Error(\`Invalid Wilderness encounter depth for \${base.id}\`);
    const tier = wildernessTierAt(z);
    const progress = bandProgress(z, tier);
    if (base.tier < __threshold) return (tier === 50 ? __legacyShallow : __legacyDeep) + Math.round(progress * __legacyProgress);
    const low = tier === 50 ? __lowShallow : __lowDeep, high = tier === 50 ? __highShallow : __highDeep;
    const authored = enemyCombatLevel(base);
    const nativeLevel = base.tier === tier && !KEEPER_FAMILIES.has(base.family)
      ? authored : Math.max(low, Math.min(high, tier + authored - base.tier));
    return nativeLevel + Math.round(progress * __nativeProgress);`, 'encounter level');
  const marks = capture(fn(progression, 'scaledMarks').body, `
    const ratio = tier / base.tier;
    const min = Math.max(tier, Math.round((base.marks?.[0] ?? base.tier) * ratio));
    return [min, Math.max(min, tier * __targetMaximum, Math.round((base.marks?.[1] ?? base.tier * __sourceMaximum) * ratio))];`, 'marks');
  const tiers = (name: string) => {
    const init = declaration(progression, name), end = closeAt(init, 0);
    capture(init.slice(end + 1), 'as const', `${name} suffix`);
    return array(init.slice(0, end + 1)).map(number);
  };
  const nativeTiers = tiers('TIERS'), legacyTiers = tiers('LEGACY_TIERS');
  assert(nativeTiers.length === 2 && nativeTiers[0] === 50 && nativeTiers[1] === 70 && legacyTiers.length === 4, 'Unsupported tier domains');
  capture(declaration(progression, 'KEEPERS'), 'new Map<string, Keeper>(WILDERNESS_RUNE_KEEPERS.map((keeper) => [keeper.id, keeper]))', 'keeper lookup');
  capture(declaration(progression, 'KEEPER_FAMILIES'), 'new Set<string>(WILDERNESS_RUNE_KEEPERS.map((keeper) => keeper.id))', 'keeper families');
  // The builder and source guard contain only fixed domain/control-flow numbers (band identity,
  // singleton count, coordinates/array indexes). Fingerprint their token shapes to reject an
  // unsupported precedence or registration change; editable operands are captured above.
  const shape = (name: string) => createHash('sha256').update(fn(progression, name).body.map(canonical).join('\0')).digest('hex');
  assert(shape('buildWildernessEnemyProgression') === '5854c2392da591ffb72c73c04ddae419dd762a38f362f90a1940794e9ca594bb', 'Unsupported registration builder expression');
  assert(shape('requireUsableBase') === '7a5aff18260644ca52fa3eab408bd2701ac78a1d8fbd47d519ee739a061c093f', 'Unsupported source guard expression');
  const params = parseValue(WildernessProgressionParamsSchema, {
    depth: { south: number(get(depthRows, 'south')), divide: number(get(depthRows, 'divide')), north: number(get(depthRows, 'north')) },
    bands: [
      { tier: nativeTiers[0], legacyBase: n(level, 'legacyShallow'), fallbackFloor: n(level, 'lowShallow'), fallbackCeiling: n(level, 'highShallow') },
      { tier: nativeTiers[1], legacyBase: n(level, 'legacyDeep'), fallbackFloor: n(level, 'lowDeep'), fallbackCeiling: n(level, 'highDeep') },
    ],
    legacyProgressLevels: n(level, 'legacyProgress'), nativeProgressLevels: n(level, 'nativeProgress'),
    legacySourceTierThreshold: n(level, 'threshold'), fallbackTiers: [...nativeTiers, ...legacyTiers],
    // The original minimum expressions multiply by the implicit identity coefficient one.
    marks: { defaultMinimumPerSourceTier: 1, minimumPerTargetTier: 1,
      defaultMaximumPerSourceTier: n(marks, 'sourceMaximum'), maximumPerTargetTier: n(marks, 'targetMaximum') },
  }, 'wildernessProgressionParams');
  return { params, manifest: { sources: files, parameters: [
    { parameterPath: 'depth', module: 'wildernessDepth', symbol: 'WILDERNESS_DEPTH' },
    ...['bands', 'legacyProgressLevels', 'nativeProgressLevels', 'legacySourceTierThreshold'].map(parameterPath =>
      ({ parameterPath, module: 'wildernessEnemyProgression', symbol: 'wildernessEnemyLevelAt' })),
    { parameterPath: 'fallbackTiers', module: 'wildernessEnemyProgression', symbol: 'TIERS+LEGACY_TIERS' },
    { parameterPath: 'marks', module: 'wildernessEnemyProgression', symbol: 'scaledMarks' },
  ] } };
}
