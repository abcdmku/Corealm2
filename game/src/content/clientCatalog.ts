/**
 * The client catalog: what rendering and UI need from a server catalog, and nothing a player must
 * not read. Built by allowlist, so a table or field added to the server catalog stays server-only
 * until it is named here. `docs/content-authoring.md` holds the split as a table.
 *
 * This module imports no content table, so the compiler, the server and the browser all use it.
 */

/** A catalog revision is the sha256 of the server catalog's inputs, in hex. */
export const CATALOG_REVISION = /^[0-9a-f]{64}$/;

/** Whole tables copied as they are. Every one is already visible to a player in the game's UI. */
export const CLIENT_TABLES = [
  'items', 'recipes', 'resources', 'progression', 'materials', 'campfireFuels', 'equipmentSets',
  'shops', 'npcs', 'spells', 'spellRunes', 'elementalSpells',
  'balance/recipes', 'balance/sets', 'balance/campfires', 'audio',
] as const;
/** Presentation fields of a species row. `stats`, `attack`, `habitat` and `respawnMs` stay on the server. */
const CREATURE_FIELDS = ['id', 'assetId', 'scale', 'regionId', 'activity', 'description', 'bodyFamily', 'rigFamily',
  'movement', 'nativeSize', 'nativeBase', 'nativeVisualRadius', 'nativeBodyRadius'] as const;

export interface ClientEnemy { id: string; name: string; family: string; tier: number }
export interface ClientCreature extends Record<string, unknown> { id: string; assetId: string; scale: number; name: string; family: string; tier: number }
export interface ClientCatalog {
  version: 1;
  /** The revision of the server catalog this was projected from. One revision names the pair. */
  revision: string;
  tables: Record<(typeof CLIENT_TABLES)[number], unknown> & {
    /** Region geometry for the map. Encounters, placements, groups and habitats stay on the server. */
    regions: unknown[];
    creatures: ClientCreature[];
    enemies: ClientEnemy[];
  };
}
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];

export function clientCatalog(server: { revision: string; tables: Record<string, unknown> }): ClientCatalog {
  const tables = Object.fromEntries(CLIENT_TABLES.map(name => [name, server.tables[name]])) as ClientCatalog['tables'];
  tables.regions = rows((server.tables.world as Row | undefined)?.regions);
  tables.creatures = rows(server.tables.species).map(species => {
    const stats = species.stats as Row;
    return { ...Object.fromEntries(CREATURE_FIELDS.filter(key => species[key] !== undefined).map(key => [key, species[key]])),
      name: stats.name, family: stats.family, tier: stats.tier } as ClientCreature;
  });
  tables.enemies = rows(server.tables.enemies).map(enemy => ({ id: enemy.id, name: enemy.name, family: enemy.family, tier: enemy.tier }) as ClientEnemy);
  return { version: 1, revision: server.revision, tables };
}

/** The bytes `GET /catalog/<revision>` serves. Key order is fixed by `clientCatalog`, so equal catalogs give equal bytes. */
export function serializeClientCatalog(catalog: ClientCatalog): string {
  return JSON.stringify(catalog);
}

const record = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const identified = (value: unknown, key = 'id'): value is Row[] => Array.isArray(value) && value.every(row => record(row) && typeof row[key] === 'string' && row[key] !== '');

/** Parse what a server sent. Throws on anything the overlay could not apply safely. */
export function parseClientCatalog(value: unknown, revision: string): ClientCatalog {
  if (!record(value) || value.version !== 1 || value.revision !== revision || !CATALOG_REVISION.test(revision) || !record(value.tables)) throw new Error('Invalid client catalog');
  const tables = value.tables;
  for (const name of ['items', 'recipes', 'resources', 'spells', 'shops', 'regions', 'creatures'] as const) if (!identified(tables[name])) throw new Error(`Invalid client catalog table ${name}`);
  if (!identified(tables.enemies) || !tables.enemies.every(row => typeof row.name === 'string' && typeof row.family === 'string' && Number.isFinite(row.tier))) throw new Error('Invalid client catalog table enemies');
  return value as unknown as ClientCatalog;
}
