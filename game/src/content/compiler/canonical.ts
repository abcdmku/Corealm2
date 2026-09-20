import { createHash } from 'node:crypto';

/** Canonical text for any JSON value. Deterministic for equal inputs. */
export function formatContentJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
/** Stable hash-friendly text used by revision checks: identical bytes for identical records. */
export function contentRevision(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
