import { sameContent } from './canonical.js';
import { CONTENT_COLLECTIONS, type ContentCollection } from './collections.js';

/**
 * Updating a server from a newer base game: a three-way merge of source collections, one record at
 * a time. Pure and browser-safe: values in, values out, no Node built-in anywhere in its imports, so
 * devdocs can import the types and run the same merge the server runs.
 *
 *   ancestor  the base sources the server last took (its seed, or its last base update)
 *   theirs    the new base: the sources the running server executable ships with
 *   mine      the server's active sources, its own edits included
 *
 * A record is the unit. Two edits to different fields of one record are a conflict, not a field
 * merge; the conflict lists the fields each side changed so a person can decide quickly. Records
 * are compared as content (`sameContent`), so key order and formatting never count as a change.
 *
 * How a collection splits into records:
 *  - an array collection by its `idKey` (`id`, `logItemId` for campfire fuels, `itemId` for runes);
 *  - `audio` by entry inside each of its maps, with ids like `cues/ui.click`;
 *  - every other object collection (`balance/*`) by top-level key;
 *  - any collection whose records have no usable id on some side (a record that is not an object,
 *    an id that is missing, or an id that repeats) is merged whole, as the one record `$collection`.
 *
 * Order is kept deterministically: the result follows `mine`, and a record the base added goes after
 * the nearest record before it in `theirs` that is still there, or at the end when none is. A
 * collection the server never changed becomes `theirs` exactly, order included, and a collection the
 * base did not change stays `mine` exactly.
 */
export type ContentSourceSet = Readonly<Record<string, unknown>>;
export interface BaseMergeInputs { ancestor: ContentSourceSet; theirs: ContentSourceSet; mine: ContentSourceSet }

/**
 *  - `both-changed`: the server and the base changed the record differently.
 *  - `both-added`: the server and the base each added a record with this id, with different content.
 *  - `deleted-in-base`: the base removed the record; the server changed it. `theirs` means delete it.
 *  - `deleted-on-server`: the server removed the record; the base changed it. `mine` means it stays deleted.
 */
export type BaseConflictKind = 'both-changed' | 'both-added' | 'deleted-in-base' | 'deleted-on-server';
export interface BaseConflict {
  collection: string;
  id: string;
  kind: BaseConflictKind;
  /** The record on each side, or null where that side has none. */
  ancestor: unknown; mine: unknown; theirs: unknown;
  /** Top-level fields each side changed against the ancestor. For `both-added`, the fields on which the two differ. Empty for a value that is not an object. */
  mineFields: string[]; theirsFields: string[];
  /** The decision given for it, or null while it has none. */
  decision?: BaseDecision['take'] | null;
}
export interface BaseDecision { collection: string; id: string; take: 'mine' | 'theirs' }
/**
 * Counted against `mine`, so they say what the server will see change. `takenFromBase`: a record the
 * server has that becomes the base's version. `keptMine`: a record that stays as the server has it
 * while the base's differs or has none. `added`: a record the server did not have. `deleted`: a record
 * the server had and loses. `unchanged`: the same on the server and in the new base. `conflicts`:
 * records waiting for a decision.
 */
export interface BaseMergeCounts { takenFromBase: number; keptMine: number; added: number; deleted: number; unchanged: number; conflicts: number }
export interface BaseMergeResult {
  /** The merged sources. A conflict that has no decision holds the server's own record, so this is always a whole set. */
  merged: Record<string, unknown>;
  /** Per collection, for every collection that has a record on any side. */
  summary: Record<string, BaseMergeCounts>;
  /** Conflicts that still need a decision, in collection order then record order. */
  conflicts: BaseConflict[];
  /** How many conflicts have no decision. Zero means `merged` is final. */
  decisionsNeeded: number;
}

export class BaseDecisionError extends Error {
  constructor(readonly missing: { collection: string; id: string }[], readonly unknown: BaseDecision[]) {
    super([missing.length ? `${missing.length} conflict${missing.length === 1 ? ' needs' : 's need'} a decision` : '',
      unknown.length ? `${unknown.length} decision${unknown.length === 1 ? ' names' : 's name'} no conflict` : ''].filter(Boolean).join('; '));
    this.name = 'BaseDecisionError';
  }
}

/** The one id a collection merged whole goes by. */
export const WHOLE_COLLECTION = '$collection';
/** `audio` is three maps of named entries. Each entry is a record. */
const NESTED_MAPS: Readonly<Record<string, true>> = { audio: true };

type Unit = { id: string; value: unknown };
type Side = Unit[] | null;
const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = Object.prototype.hasOwnProperty;

/** Records of one collection value, or null when it cannot be split by id. An absent collection has no records. */
function unitsOf(spec: ContentCollection | undefined, value: unknown): Side {
  if (value === undefined) return [];
  if (spec?.shape === 'array' || (!spec && Array.isArray(value))) {
    if (!Array.isArray(value)) return null;
    const key = spec?.idKey ?? 'id', seen = new Set<string>(), units: Unit[] = [];
    for (const row of value) {
      const id = plainObject(row) ? row[key] : undefined;
      if ((typeof id !== 'string' || !id) && typeof id !== 'number') return null;
      const text = String(id);
      if (seen.has(text)) return null;
      seen.add(text); units.push({ id: text, value: row });
    }
    return units;
  }
  if (!plainObject(value)) return null;
  if (spec && NESTED_MAPS[spec.name]) {
    const units: Unit[] = [];
    for (const [section, entries] of Object.entries(value)) {
      if (!plainObject(entries)) return null;
      for (const [name, entry] of Object.entries(entries)) units.push({ id: `${section}/${name}`, value: entry });
    }
    return units;
  }
  return Object.entries(value).map(([id, entry]) => ({ id, value: entry }));
}

/** The inverse of `unitsOf`. `sections` keeps a nested map's sections, empty ones included, in the order given. */
function valueOf(spec: ContentCollection | undefined, units: readonly Unit[], template: unknown, sections: readonly string[]): unknown {
  if (Array.isArray(template)) return units.map(unit => unit.value);
  if (spec && NESTED_MAPS[spec.name]) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const section of sections) out[section] = {};
    for (const unit of units) {
      const cut = unit.id.indexOf('/'), section = unit.id.slice(0, cut);
      (out[section] ??= {})[unit.id.slice(cut + 1)] = unit.value;
    }
    return out;
  }
  return Object.fromEntries(units.map(unit => [unit.id, unit.value]));
}

function changedFields(from: unknown, to: unknown): string[] {
  if (!plainObject(from) || !plainObject(to)) return [];
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(key => has.call(from, key) !== has.call(to, key) || !sameContent(from[key], to[key]));
}

interface CollectionMerge { value: unknown; present: boolean; counts: BaseMergeCounts; conflicts: BaseConflict[] }
const zero = (): BaseMergeCounts => ({ takenFromBase: 0, keptMine: 0, added: 0, deleted: 0, unchanged: 0, conflicts: 0 });

/** How the result's records compare with `mine` and `theirs`. Conflicts without a decision are counted apart. */
function count(result: readonly Unit[], mine: readonly Unit[], theirs: readonly Unit[], open: ReadonlySet<string>): BaseMergeCounts {
  const counts = zero(), mineOf = new Map(mine.map(unit => [unit.id, unit.value])), theirsOf = new Map(theirs.map(unit => [unit.id, unit.value]));
  counts.conflicts = open.size;
  const resultIds = new Set(result.map(unit => unit.id));
  for (const unit of result) {
    if (open.has(unit.id)) continue;
    if (!mineOf.has(unit.id)) { counts.added++; continue; }
    const same = sameContent(unit.value, mineOf.get(unit.id));
    if (!same) counts.takenFromBase++;
    else if (theirsOf.has(unit.id) && sameContent(unit.value, theirsOf.get(unit.id))) counts.unchanged++;
    else counts.keptMine++;
  }
  for (const unit of mine) if (!resultIds.has(unit.id) && !open.has(unit.id)) counts.deleted++;
  return counts;
}

function mergeCollection(name: string, ancestorValue: unknown, theirsValue: unknown, mineValue: unknown, decide: (id: string) => BaseDecision['take'] | undefined): CollectionMerge {
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === name);
  const inMine = mineValue !== undefined, inTheirs = theirsValue !== undefined;
  // Whole-collection shortcuts. They are what make a server with no edits of its own end up on the base exactly, order included.
  const mineUntouched = sameContent(mineValue, ancestorValue), baseUntouched = sameContent(theirsValue, ancestorValue);
  let ancestor = unitsOf(spec, ancestorValue), theirs = unitsOf(spec, theirsValue), mine = unitsOf(spec, mineValue);
  if (!mineUntouched && !baseUntouched && (!ancestor || !theirs || !mine || (inMine && inTheirs && Array.isArray(mineValue) !== Array.isArray(theirsValue)))) {
    // No stable id on some side: the collection is one record.
    const whole = (value: unknown): Unit[] => value === undefined ? [] : [{ id: WHOLE_COLLECTION, value }];
    ancestor = whole(ancestorValue); theirs = whole(theirsValue); mine = whole(mineValue);
    const merged = mergeUnits(name, ancestor, theirs, mine, decide);
    const unit = merged.result[0];
    return { value: unit?.value, present: unit !== undefined, counts: count(merged.result, mine, theirs, merged.open), conflicts: merged.conflicts };
  }
  const units = (side: Side): Unit[] => side ?? [];
  if (mineUntouched || baseUntouched) {
    const value = mineUntouched ? theirsValue : mineValue;
    const result = unitsOf(spec, value) ?? (value === undefined ? [] : [{ id: WHOLE_COLLECTION, value }]);
    const mineUnits = mine ?? (inMine ? [{ id: WHOLE_COLLECTION, value: mineValue }] : []), theirUnits = theirs ?? (inTheirs ? [{ id: WHOLE_COLLECTION, value: theirsValue }] : []);
    return { value, present: value !== undefined, counts: count(result, mineUnits, theirUnits, new Set()), conflicts: [] };
  }
  const merged = mergeUnits(name, units(ancestor), units(theirs), units(mine), decide);
  const sections = NESTED_MAPS[name] ? [...new Set([...Object.keys(plainObject(mineValue) ? mineValue : {}), ...Object.keys(plainObject(theirsValue) ? theirsValue : {})])] : [];
  const template = inMine ? mineValue : theirsValue;
  return { value: valueOf(spec, merged.result, template, sections), present: inMine || inTheirs,
    counts: count(merged.result, units(mine), units(theirs), merged.open), conflicts: merged.conflicts };
}

/** The per-record rules, then the order. `open` holds the ids of conflicts that have no decision. */
function mergeUnits(collection: string, ancestor: readonly Unit[], theirs: readonly Unit[], mine: readonly Unit[], decide: (id: string) => BaseDecision['take'] | undefined) {
  const a = new Map(ancestor.map(unit => [unit.id, unit.value])), t = new Map(theirs.map(unit => [unit.id, unit.value])), m = new Map(mine.map(unit => [unit.id, unit.value]));
  const chosen = new Map<string, { keep: boolean; value?: unknown }>(), conflicts: BaseConflict[] = [], open = new Set<string>();
  const ids = [...new Set([...mine.map(unit => unit.id), ...theirs.map(unit => unit.id), ...ancestor.map(unit => unit.id)])];
  for (const id of ids) {
    const inA = a.has(id), inT = t.has(id), inM = m.has(id), A = a.get(id), T = t.get(id), M = m.get(id);
    let kind: BaseConflictKind | null = null;
    if (inT && inM) {
      if (inA ? sameContent(M, A) : false) chosen.set(id, { keep: true, value: T });
      else if (inA && sameContent(T, A)) chosen.set(id, { keep: true, value: M });
      else if (sameContent(T, M)) chosen.set(id, { keep: true, value: M });
      else kind = inA ? 'both-changed' : 'both-added';
    } else if (inM) {
      // The base has no such record: it deleted it, or it never had it and the server added it.
      if (!inA) chosen.set(id, { keep: true, value: M });
      else if (sameContent(M, A)) chosen.set(id, { keep: false });
      else kind = 'deleted-in-base';
    } else if (inT) {
      if (!inA) chosen.set(id, { keep: true, value: T });
      else if (sameContent(T, A)) chosen.set(id, { keep: false });
      else kind = 'deleted-on-server';
    } else chosen.set(id, { keep: false });
    if (kind === null) continue;
    const take = decide(id);
    const record = (value: unknown, present: boolean) => present ? value : null;
    conflicts.push({ collection, id, kind, ancestor: record(A, inA), mine: record(M, inM), theirs: record(T, inT),
      mineFields: kind === 'both-added' ? changedFields(M, T) : kind === 'deleted-on-server' ? [] : changedFields(A, M),
      theirsFields: kind === 'both-added' ? changedFields(M, T) : kind === 'deleted-in-base' ? [] : changedFields(A, T) });
    if (take === 'theirs') chosen.set(id, inT ? { keep: true, value: T } : { keep: false });
    else if (take === 'mine') chosen.set(id, inM ? { keep: true, value: M } : { keep: false });
    else { open.add(id); chosen.set(id, inM ? { keep: true, value: M } : { keep: false }); }
  }
  // Mine's order, then each record the server did not have, after its nearest surviving predecessor in theirs.
  const result: Unit[] = mine.filter(unit => chosen.get(unit.id)!.keep).map(unit => ({ id: unit.id, value: chosen.get(unit.id)!.value }));
  const position = new Map(result.map((unit, index) => [unit.id, index]));
  theirs.forEach((unit, index) => {
    if (m.has(unit.id) || !chosen.get(unit.id)!.keep) return;
    let after = -1;
    for (let back = index - 1; back >= 0; back--) { const found = position.get(theirs[back]!.id); if (found !== undefined) { after = found; break; } }
    const at = after < 0 ? result.length : after + 1;
    result.splice(at, 0, { id: unit.id, value: chosen.get(unit.id)!.value });
    for (const [id, index] of position) if (index >= at) position.set(id, index + 1);
    position.set(unit.id, at);
  });
  return { result, conflicts, open };
}

function run(inputs: BaseMergeInputs, decide: (collection: string, id: string) => BaseDecision['take'] | undefined): BaseMergeResult {
  const names = [...new Set([...Object.keys(inputs.mine), ...CONTENT_COLLECTIONS.map(spec => spec.name).filter(name => inputs.theirs[name] !== undefined || inputs.mine[name] !== undefined),
    ...Object.keys(inputs.theirs)])];
  const merged: Record<string, unknown> = {}, summary: Record<string, BaseMergeCounts> = {}, conflicts: BaseConflict[] = [];
  for (const name of names) {
    const own = (set: ContentSourceSet) => has.call(set, name) ? set[name] : undefined;
    const outcome = mergeCollection(name, own(inputs.ancestor), own(inputs.theirs), own(inputs.mine), id => decide(name, id));
    if (outcome.present) merged[name] = outcome.value;
    summary[name] = outcome.counts;
    conflicts.push(...outcome.conflicts);
  }
  const open = conflicts.filter(conflict => decide(conflict.collection, conflict.id) === undefined);
  return { merged, summary, conflicts, decisionsNeeded: open.length };
}

const decisionKey = (collection: string, id: string) => `${collection}\n${id}`;

/**
 * The merge, with whatever decisions are given. Every conflict is listed with its `decision`, or
 * null, and an undecided one holds the server's own record in `merged`. Throws `BaseDecisionError`
 * (with `missing` empty) when a decision names no conflict or one conflict is decided twice.
 */
export function mergeBase(inputs: BaseMergeInputs, decisions: readonly BaseDecision[] = []): BaseMergeResult {
  const given = new Map<string, BaseDecision['take']>(), repeated: BaseDecision[] = [];
  for (const decision of decisions) {
    const key = decisionKey(decision.collection, decision.id);
    if (given.has(key)) repeated.push(decision); else given.set(key, decision.take);
  }
  const result = run(inputs, (collection, id) => given.get(decisionKey(collection, id)));
  const known = new Set(result.conflicts.map(conflict => decisionKey(conflict.collection, conflict.id)));
  const unknown = [...decisions.filter(decision => !known.has(decisionKey(decision.collection, decision.id))), ...repeated];
  if (unknown.length) throw new BaseDecisionError([], unknown);
  for (const conflict of result.conflicts) conflict.decision = given.get(decisionKey(conflict.collection, conflict.id)) ?? null;
  return result;
}

/**
 * The merge with a decision for every conflict. Throws `BaseDecisionError` when a conflict has no
 * decision, or a decision names no conflict, or one conflict is decided twice; nothing is guessed.
 * The result's `conflicts` lists what was decided, and `decisionsNeeded` is zero.
 */
export function applyBaseDecisions(inputs: BaseMergeInputs, decisions: readonly BaseDecision[]): BaseMergeResult {
  const result = mergeBase(inputs, decisions);
  const missing = result.conflicts.filter(conflict => conflict.decision === null).map(({ collection, id }) => ({ collection, id }));
  if (missing.length) throw new BaseDecisionError(missing, []);
  return result;
}
