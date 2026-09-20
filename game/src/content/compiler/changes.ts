import { CONTENT_COLLECTIONS, type ContentCollection } from './collections.js';

/**
 * What a content write changed, for the three places that accept one: the devdocs repo transaction,
 * a live server's publish, and the editor in the browser deciding what its save has to send. Pure:
 * values in, names and ids out, and no Node built-in anywhere in this file's imports so the editor
 * bundle can have it. Hashing a collection into a revision is `revision.ts`, which is Node only.
 */
export interface AffectedRecord { collection: string; id: string }

/** Collections an editor read at another revision than the current one. Empty means the write may proceed. */
export function staleCollections(read: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>): string[] {
  return Object.entries(read).filter(([name, revision]) => current[name] !== revision).map(([name]) => name);
}

export function changedCollections(before: ReadonlyMap<string, unknown>, after: ReadonlyMap<string, unknown>): ContentCollection[] {
  return CONTENT_COLLECTIONS.filter(spec => JSON.stringify(after.get(spec.name)) !== JSON.stringify(before.get(spec.name)));
}

function changedIds(before: readonly Record<string, unknown>[], after: readonly Record<string, unknown>[], idKey: string): string[] {
  const old = new Map(before.map(row => [String(row[idKey]), JSON.stringify(row)])), next = new Map(after.map(row => [String(row[idKey]), JSON.stringify(row)]));
  return [...new Set([...old.keys(), ...next.keys()])].filter(id => old.get(id) !== next.get(id));
}

/** Source records that differ. A collection that is one object reports itself as `$collection`. */
export function affectedSources(changed: readonly ContentCollection[], before: ReadonlyMap<string, unknown>, after: ReadonlyMap<string, unknown>): AffectedRecord[] {
  return changed.flatMap(spec => {
    const old = before.get(spec.name), rows = after.get(spec.name);
    if (!Array.isArray(rows) || !Array.isArray(old)) return [{ collection: spec.name, id: '$collection' }];
    return changedIds(old, rows, spec.idKey).map(id => ({ collection: spec.name, id }));
  });
}

/** Compiled rows that differ, which is how an edit to a loot table names the creatures it reaches. Only tables of rows with an `id` take part. */
export function affectedCompiled(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, known: readonly AffectedRecord[] = []): AffectedRecord[] {
  const seen = new Set(known.map(entry => `${entry.collection}\n${entry.id}`)), found: AffectedRecord[] = [];
  for (const [name, table] of Object.entries(after)) {
    if (!Array.isArray(table)) continue;
    const identified = (rows: unknown) => (Array.isArray(rows) ? rows as Record<string, unknown>[] : []).filter(row => Boolean(row?.id));
    for (const id of changedIds(identified(before[name]), identified(table), 'id')) if (!seen.has(`${name}\n${id}`)) found.push({ collection: name, id });
  }
  return found;
}

/** Compiled tables whose value differs, by name, in table order. */
export function changedTables(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
}
