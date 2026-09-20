import { createHash } from 'node:crypto';
import { formatContentJson } from './canonical.js';

/**
 * Content hashing. Node only: `node:crypto` is the one dependency here, which is why it is not in
 * `canonical.ts` or `changes.ts`. A browser never computes a revision — a live server reports the
 * revision of every source collection with the sources themselves, and its publish endpoint checks
 * what an editor sends against this same function.
 */

/** Stable hash-friendly text used by revision checks: identical bytes for identical records. */
export function contentRevision(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The revision an editor read a collection at. Canonical text, so equal values give equal revisions. */
export function collectionRevision(value: unknown): string {
  return contentRevision(formatContentJson(value));
}
