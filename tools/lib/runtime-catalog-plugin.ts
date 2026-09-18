import type { Plugin } from 'vite';

/** Omit authoring copies already embedded in the resolved world table from game bundles. */
export function runtimeCatalogPlugin(): Plugin {
  return {
    name: 'corealm-runtime-catalog', enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/content/compiled/catalog.json')) return;
      const catalog = JSON.parse(source);
      for (const key of ['worldRegions', 'encounters', 'placements', 'resourcePlacements']) delete catalog.tables[key];
      // These source tables are consumed by the editor/compiler, not gameplay. Their resolved
      // outputs remain in compiledCreatures, species, items, recipes, and resources.
      for (const key of ['creatureDefinitions', 'creatureProfiles', 'equipmentFamilies', 'recipeTemplates']) {
        delete catalog.tables[key];
      }
      delete catalog.sourceMap;
      return { code: JSON.stringify(catalog), map: null };
    },
  };
}
