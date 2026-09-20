import { describe, expect, it } from 'vitest';
import { compileCatalog } from '../game/src/content/compiler/catalog.js';
import { clientCatalog } from '../game/src/content/clientCatalog.js';
import { RESOLVED_CATALOG } from '../game/src/content/resolvedCatalog.js';
import { readContentSources } from '../tools/content/compile.js';

const compile = (sources: Record<string, any>) => {
  const result = compileCatalog(sources, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
  if (!result.ok) throw new Error(JSON.stringify(result.problems.slice(0, 3)));
  return result;
};

describe('retired definitions', () => {
  it('keeps a retired item resolvable and takes it out of every loot roll and shop shelf', async () => {
    const sources = structuredClone(Object.fromEntries(await readContentSources())) as Record<string, any>;
    const before = compile(sources).catalog.tables as Record<string, any>;
    const sold = before.shops.find((shop: any) => shop.stock.length > 0), itemId = 'marsh_gland';
    expect(before.enemies.find((row: any) => row.id === 'redsill_frogs').lootRolls.find((roll: any) => roll.id === 'items').drops.map((drop: any) => drop.itemId)).toContain(itemId);
    sources.items.find((row: any) => row.id === itemId).retired = true;
    sources.items.find((row: any) => row.id === sold.stock[0].itemId).retired = true;

    const { catalog, problems } = compile(sources), tables = catalog.tables as Record<string, any>;
    expect(tables.items.find((row: any) => row.id === itemId)).toMatchObject({ id: itemId, name: 'Marsh Gland', retired: true });
    expect(tables.enemies.flatMap((row: any) => row.lootRolls).flatMap((roll: any) => roll.drops).filter((drop: any) => drop.itemId === itemId)).toEqual([]);
    expect(tables.shops.find((shop: any) => shop.id === sold.id).stock.map((row: any) => row.itemId)).not.toContain(sold.stock[0].itemId);
    expect(tables.shops.find((shop: any) => shop.id === sold.id).stock).toHaveLength(sold.stock.length - 1);
    expect(problems).toContainEqual({ path: 'lootTables.shared_t0_frog.items', message: `Retired item ${itemId} no longer drops`, severity: 'info' });
    expect(problems).toContainEqual({ path: `shops.${sold.id}.stock`, message: `Retired item ${sold.stock[0].itemId} is no longer sold`, severity: 'info' });
    // The client still names and draws a stack a player holds.
    expect((clientCatalog(catalog).tables.items as any[]).find(row => row.id === itemId).retired).toBe(true);
  });

  it('stops a retired item being made or gathered, and still lets players use theirs up', async () => {
    const sources = structuredClone(Object.fromEntries(await readContentSources())) as Record<string, any>;
    for (const id of ['grithe_bar', 'pale_quartz', 'grithe_ore']) sources.items.find((row: any) => row.id === id).retired = true;
    const result = compileCatalog(sources, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    if (!result.ok) throw new Error(JSON.stringify(result.problems.filter(problem => problem.severity === 'error').slice(0, 3)));
    const tables = result.catalog.tables as Record<string, any>, recipeIds = tables.recipes.map((row: any) => row.id);
    // The bar can no longer be smelted, but a bar in the bank still makes a dagger.
    expect(recipeIds).not.toContain('smelt_grithe_bar');
    expect(recipeIds).toContain('smith_grithe_dagger');
    expect(tables.resources.find((row: any) => row.id === 'ore_grithe')).toMatchObject({ itemId: 'grithe_ore', bonus: [] });
    expect(result.problems).toContainEqual({ path: 'recipes.smelt_grithe_bar.output', message: 'Retired item grithe_bar can no longer be made', severity: 'info' });
    expect(result.problems).toContainEqual({ path: 'resources.ore_grithe.bonus', message: 'Retired item pale_quartz is no longer a bonus yield', severity: 'info' });
    expect(result.problems).toContainEqual({ path: 'resources.ore_grithe.itemId', message: 'Still yields retired item grithe_ore. Give the node another yield or remove it.', severity: 'warning' });
  });

  it('keeps a retired creature resolvable and spawns it nowhere', async () => {
    const sources = structuredClone(Object.fromEntries(await readContentSources())) as Record<string, any>;
    const before = compile(sources).catalog.tables as Record<string, any>;
    expect(before.world.groupsByRegion.fallowmarch.map((group: any) => group.id)).toContain('redsill_frogs');
    sources.creatureDefinitions.find((row: any) => row.id === 'redsill_frogs').retired = true;

    const { catalog, problems } = compile(sources), tables = catalog.tables as Record<string, any>;
    expect(tables.world.groupsByRegion.fallowmarch.map((group: any) => group.id)).not.toContain('redsill_frogs');
    expect(tables.world.habitats.some((habitat: any) => habitat.groupId === 'redsill_frogs')).toBe(false);
    expect(tables.enemies.find((row: any) => row.id === 'redsill_frogs').name).toBe('Frog');
    expect(tables.compiledCreatures.find((row: any) => row.id === 'redsill_frogs').retired).toBe(true);
    expect(tables.world.groupsByRegion.fallowmarch).toHaveLength(before.world.groupsByRegion.fallowmarch.length - 1);
    expect(problems).toContainEqual({ path: 'encounters.redsill_frogs_forage.members', message: 'Retired creature redsill_frogs no longer spawns', severity: 'info' });
  });
});
