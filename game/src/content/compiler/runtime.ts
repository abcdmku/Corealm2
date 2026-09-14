import { RESOLVED_CATALOG } from '../resolvedCatalog.js';
const tables = RESOLVED_CATALOG.tables;
export const COMPILED_PROGRESSION = {
  items: tables.items, recipes: tables.recipes, resources: tables.resources,
  progression: tables.progression, materials: tables.materials,
  families: tables.equipmentFamilies, templates: tables.recipeTemplates,
};
