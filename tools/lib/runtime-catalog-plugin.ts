import type { Plugin } from 'vite';

/** Omit authoring copies already embedded in the resolved world table from game bundles. */
export function runtimeCatalogPlugin(): Plugin {
  return {
    name: 'corealm-runtime-catalog', enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/content/compiled/catalog.json')) return;
      const catalog = JSON.parse(source);
      for (const key of ['worldRegions', 'encounters', 'placements', 'resourcePlacements']) delete catalog.tables[key];
      delete catalog.sourceMap;
      return { code: JSON.stringify(catalog), map: null };
    },
  };
}
