import { RESOLVED_TABLES } from './resolvedCatalog.js';
import type { CreatureSkin } from './schema/creatureSkins.js';

/**
 * The `creatureSkins` table of the catalog this process runs on, by id.
 *
 * Read through the installed table rather than copied at import, so a live publish (which refills
 * `RESOLVED_TABLES` in place and replaces the array) is picked up on the next lookup. A catalog
 * without the table (a client projection that does not carry it) has no skins.
 */
let indexed: unknown = null;
let byId = new Map<string, CreatureSkin>();

export function creatureSkinById(id: string): CreatureSkin | undefined {
  const rows = RESOLVED_TABLES.creatureSkins;
  if (rows !== indexed) {
    indexed = rows;
    byId = new Map((Array.isArray(rows) ? rows as CreatureSkin[] : []).map(row => [row.id, row]));
  }
  return byId.get(id);
}
