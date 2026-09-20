import type { CompiledLootRoll, LootDrop, LootPlan, LootRoll } from '../contracts.js';
import type { LootTableRecord } from './schema/loot.js';

export const GOLD_ROLL_ID = 'gold';
/** The currency item id. A literal, because the authoring app bundles this file and items.ts is heavy. */
const GOLD_ITEM_ID = 'gold';

/** Gold is a guaranteed roll of its own, sized by the creature's gold range. */
export function goldRoll(range: readonly [number, number] | undefined): CompiledLootRoll | undefined {
  if (!range || range[1] < 1) return undefined;
  return { id: GOLD_ROLL_ID, name: 'Gold', count: 1,
    drops: [{ itemId: GOLD_ITEM_ID, quantity: [Math.max(1, range[0]), range[1]], chance: 1 }] };
}

/** The gold roll leads, rebuilt from the final range so a re-levelled creature never keeps a stale one. */
export function withGoldRoll(rolls: readonly CompiledLootRoll[], range: readonly [number, number] | undefined): CompiledLootRoll[] {
  const gold = goldRoll(range);
  const authored = rolls.filter(roll => roll.id !== GOLD_ROLL_ID);
  return gold ? [gold, ...authored] : authored;
}

/** Resolve reusable pools once. A reference joins a pool, never creates hidden extra rolls. */
export function createLootCompiler(tables: readonly LootTableRecord[]) {
  const byId = new Map(tables.map(table => [table.id, table]));
  if (byId.size !== tables.length) throw new Error('Duplicate shared loot table id');
  const cache = new Map<string, LootDrop[]>();
  const active = new Set<string>();
  function pool(roll: LootRoll, path: string): LootDrop[] {
    if (cache.has(path)) return cache.get(path)!;
    if (active.has(path)) throw new Error(`${path}: cyclic loot table reference`);
    active.add(path);
    const drops = [...roll.drops];
    for (const link of roll.tables) {
      const table = byId.get(link.tableId);
      if (!table) throw new Error(`${path}: unknown loot table ${link.tableId}`);
      const source = table.rolls.find(candidate => candidate.id === link.rollId);
      if (!source) throw new Error(`${path}: unknown roll ${link.rollId} in ${link.tableId}`);
      drops.push(...pool(source, `lootTables.${table.id}.${source.id}`));
    }
    const total = drops.reduce((sum, drop) => sum + drop.chance, 0);
    if (total > 1 + 1e-10) throw new Error(`${path}: per-roll chances total ${(total * 100).toFixed(2)}%, exceeding 100%`);
    active.delete(path);
    cache.set(path, drops);
    return drops;
  }
  function compile(plan: LootPlan, path: string): CompiledLootRoll[] {
    if (new Set(plan.rolls.map(roll => roll.id)).size !== plan.rolls.length) throw new Error(`${path}: duplicate loot roll id`);
    if (plan.rolls.some(roll => roll.id === GOLD_ROLL_ID)) throw new Error(`${path}.${GOLD_ROLL_ID}: loot roll id "${GOLD_ROLL_ID}" is reserved for the creature's gold drop`);
    return plan.rolls.map(roll => ({ id: roll.id, name: roll.name, count: roll.count, drops: pool(roll, `${path}.${roll.id}`) }));
  }
  for (const table of tables) compile(table, `lootTables.${table.id}`);
  return compile;
}

/** Direct and transitive table users, including inherited creature loot. */
export function referencedLootTables(plan: LootPlan, tables: ReadonlyMap<string, LootTableRecord>): Set<string> {
  const ids = new Set<string>();
  const pools = new Set<string>();
  function visit(rolls: LootRoll[]) {
    for (const roll of rolls) for (const link of roll.tables) {
      const key = `${link.tableId}:${link.rollId}`;
      if (pools.has(key)) continue;
      pools.add(key);
      ids.add(link.tableId);
      const source = tables.get(link.tableId)?.rolls.find(candidate => candidate.id === link.rollId);
      if (source) visit([source]);
    }
  }
  visit(plan.rolls);
  return ids;
}
