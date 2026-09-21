/**
 * Canonical text for content, with no Node built-ins in it.
 *
 * Hashing lives next door in `revision.ts`, which needs `node:crypto`. Keeping the two apart is what
 * lets the browser import this module and `changes.ts`: devdocs runs the same diffing code a publish
 * runs, and a `node:crypto` import anywhere in that graph would stop the editor bundle from building.
 */

/** Canonical text for any JSON value. Deterministic for equal inputs. */
export function formatContentJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Text that is equal exactly when two JSON values are equal as content: object keys are sorted at
 * every depth, array order is kept. A record whose keys were written in another order, or formatted
 * differently, is the same record. Used to decide whether a record changed, never to write one.
 */
export function contentKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(name => [name, (entry as Record<string, unknown>)[name]])) : entry) ?? 'undefined';
}

export function sameContent(a: unknown, b: unknown): boolean {
  return a === b || contentKey(a) === contentKey(b);
}
