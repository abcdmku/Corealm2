import type { ContentTables, EnemyDef, SpellDef } from './index.js';
import type { ClientCatalog } from './clientCatalog.js';

/** The part of `ContentRegistry` an overlay touches, so a test can pass a fake. */
export interface OverlayRegistry {
  register(tables: Partial<ContentTables>): void;
  allItems(): ContentTables['items']; allResources(): ContentTables['resources']; allRecipes(): ContentTables['recipes'];
  allSpells(): ContentTables['spells']; allEnemies(): ContentTables['enemies']; allShops(): ContentTables['shops'];
}

/** The combat fields of an enemy only the server knows. It has a name and a tier here, and the page needs no more. */
const UNKNOWN_ENEMY: Omit<EnemyDef, 'id' | 'name' | 'family' | 'tier'> = {
  maxHealth: 1, attackLevel: 1, defenceLevel: 1, accuracy: 0, armour: 0, magicArmour: 0, maxHit: 0,
  attackSpeedMs: 2400, aggroRadius: 0, behaviour: 'passive', lootRolls: [],
};

/** Server fields win, fields the server did not send survive, and rows only the server has are appended. */
function merged<T extends { id: string }>(base: readonly T[], server: readonly Partial<T>[], unknown?: Omit<T, keyof T & ('id' | 'name' | 'family' | 'tier')>): T[] {
  const incoming = new Map(server.map(row => [row.id!, row]));
  const rows = base.map(row => incoming.has(row.id) ? { ...row, ...incoming.get(row.id) } : row);
  const known = new Set(base.map(row => row.id));
  for (const row of server) if (!known.has(row.id!)) rows.push({ ...unknown, ...row } as T);
  return rows;
}

/**
 * A joined world's names, icons, item stats and shop stock come from its host's catalog revision. The
 * page's own registry underneath is the build's client catalog, installed by the entry, so both
 * sides carry the same presentation fields and a server row simply wins field by field. A row only
 * the server has is appended; an enemy of that kind gets inert combat fields, because `EnemyDef`
 * demands them and nothing on a page fights. Returns the undo, which leaving the world must call so
 * the next world, or local play, starts from the build's tables again.
 */
export function overlayClientCatalog(registry: OverlayRegistry, catalog: ClientCatalog): () => void {
  const before: ContentTables = { items: registry.allItems(), resources: registry.allResources(), recipes: registry.allRecipes(),
    spells: registry.allSpells(), enemies: registry.allEnemies(), shops: registry.allShops() };
  const tables = catalog.tables;
  const spells = (tables.spells as (SpellDef & { catalog?: string })[]).map(({ catalog: _catalog, ...spell }) => spell);
  registry.register({
    items: merged(before.items, tables.items as ContentTables['items']),
    resources: merged(before.resources, tables.resources as ContentTables['resources']),
    recipes: merged(before.recipes, tables.recipes as ContentTables['recipes']),
    spells: merged(before.spells, spells),
    enemies: merged(before.enemies, tables.enemies, UNKNOWN_ENEMY),
    shops: merged(before.shops, tables.shops as ContentTables['shops']),
  });
  return () => registry.register(before);
}
