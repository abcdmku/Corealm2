import { expect, it } from 'vitest';
import catalog from '../game/content/compiled/catalog.json';
import { runtimeCatalogPlugin } from '../tools/lib/runtime-catalog-plugin.js';

it('omits authoring inputs from the game bundle while preserving resolved gameplay tables', () => {
  const transform = runtimeCatalogPlugin().transform as (source: string, id: string) => { code: string } | undefined;
  const source = JSON.stringify(catalog);
  const result = JSON.parse(transform(source, 'C:/game/content/compiled/catalog.json')!.code);
  const omitted = ['worldRegions', 'encounters', 'placements', 'resourcePlacements',
    'creatureDefinitions', 'creatureProfiles', 'equipmentFamilies', 'recipeTemplates'];
  for (const [key, value] of Object.entries(catalog.tables)) {
    if (omitted.includes(key)) expect(result.tables).not.toHaveProperty(key);
    else expect(result.tables[key], key).toEqual(value);
  }
  expect(result.revision).toBe(catalog.revision);
  expect(result.version).toBe(catalog.version);
  expect(result.sourceMap).toBeUndefined();
  expect(transform(source, 'C:/game/content/data/creatureDefinitions.json')).toBeUndefined();
});
