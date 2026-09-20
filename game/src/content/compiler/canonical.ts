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
