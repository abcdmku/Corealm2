import { describe, expect, it } from 'vitest';
import { compileProgression } from '../game/src/content/compiler/progression.js';
import items from '../game/content/data/items.json';
import recipes from '../game/content/data/recipes.json';
import resources from '../game/content/data/resources.json';
import materials from '../game/content/data/materials.json';
import progression from '../game/content/data/progression.json';
import equipmentFamilies from '../game/content/data/equipmentFamilies.json';
import recipeTemplates from '../game/content/data/recipeTemplates.json';
import { compileCreatures } from '../game/src/content/creatureCompiler.js';
import { CREATURE_DEFINITIONS, CREATURE_PROFILES } from '../game/src/content/creatureRuntime.js';
import { LOOT_RECORDS } from '../game/src/content/lootData.js';
import { previewFormula } from '../game/src/content/formulas/index.js';
import { compileCatalog } from '../game/src/content/compiler/catalog.js';
import { readContentSources } from '../tools/content/compile.js';
import { RESOLVED_CATALOG } from '../game/src/content/resolvedCatalog.js';
const PROGRESSION_SOURCES = { items, recipes, resources, materials, progression, equipmentFamilies, recipeTemplates };

describe('authored content compiler', () => {
  it('publishes terrain settings to clients and rejects widths outside their sampled extent', async () => {
    const sources = Object.fromEntries(await readContentSources());
    const valid = compileCatalog(sources, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('Terrain catalog failed');
    expect(valid.client.tables.worldTerrain).toEqual(sources.worldTerrain);
    const terrain = structuredClone(sources.worldTerrain) as { coast: { shoreline: number[]; collar: number } }[];
    terrain[0]!.coast.shoreline[1] = terrain[0]!.coast.collar + 1;
    const invalid = compileCatalog({ ...sources, worldTerrain: terrain }, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    expect(invalid.ok).toBe(false);
    expect(invalid.problems.some(row => row.path === 'worldTerrain.corealm.coast.collar')).toBe(true);
  });
  it('accepts the scree boars on the Highlands coast while rejecting another region', async () => {
    const sources = Object.fromEntries(await readContentSources());
    const placements = structuredClone(sources.placements) as { id: string; count: number; centre: [number, number] }[];
    const boars = placements.find(row => row.id === 'scree_boars')!;
    boars.centre = [171.66, -243.7];
    const moved = { ...sources, placements };
    const coastal = compileCatalog(moved, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    expect(coastal.problems.filter(problem => problem.severity === 'error')).toEqual([]);
    expect(coastal.ok).toBe(true);
    if (!coastal.ok) throw new Error('Coastal placement failed');
    const world = coastal.catalog.tables.world as { habitats: { groupId: string; regionId: string; centre: number[]; anchors: number[][] }[] };
    expect(world.habitats.find(row => row.groupId === boars.id)).toMatchObject({ regionId: 'karrowmoor', centre: boars.centre });
    expect(world.habitats.find(row => row.groupId === boars.id)?.anchors).toHaveLength(boars.count);
    boars.centre = [-240, -50];
    const wrongRegion = compileCatalog(moved, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    expect(wrongRegion.ok).toBe(false);
    expect(wrongRegion.problems.some(problem => problem.path.startsWith('placements.scree_boars.anchors') && problem.severity === 'error')).toBe(true);
  });

  it('adds a tier through data and keeps one explicit equipment adjustment', () => {
    const source = structuredClone(PROGRESSION_SOURCES);
    const base = source.progression.find(row => row.equipment.length > 0)!;
    const tier = structuredClone(base);
    tier.id = 'compiler_example_tier';
    tier.name = 'Example tier';
    tier.tier = 81;
    tier.reqLevel = 81;
    tier.equipment = [structuredClone(base.equipment[0]!)];
    tier.equipment[0]!.id = 'compiler_example_equipment';
    Object.assign(tier.equipment[0]!, { adjustments: { value: 123 } });
    tier.production = [];
    source.progression.push(tier);
    const compiled = compileProgression(source);
    const item = compiled.items.find(row => row.id === 'compiler_example_equipment')!;
    expect(item).toMatchObject({ tier: 81, value: 123 });
    expect(compiled.sourceMap[`items:${item.id}`]).toMatchObject({ collection: 'progression', id: tier.id, formula: 'equipment.linear' });
    expect(compileProgression(source)).toEqual(compiled);
  });

  it('rejects conflicting generated identities and missing references', () => {
    const source = structuredClone(PROGRESSION_SOURCES);
    source.progression.push(structuredClone(source.progression[0]!));
    expect(() => compileProgression(source)).toThrow(/duplicate/i);
    const broken = structuredClone(PROGRESSION_SOURCES);
    broken.materials[0]!.itemId = 'missing_material_item';
    expect(() => compileProgression(broken)).toThrow(/unknown item/i);
  });

  it('resolves a direct variant and refuses inheritance chains', () => {
    const base = CREATURE_DEFINITIONS.find(row => !row.baseId)!;
    const variant = { id: 'compiler_variant', baseId: base.id, name: 'Example variant', availability: 'lab' as const, level: 27 };
    const compiled = compileCreatures([...CREATURE_DEFINITIONS, variant], CREATURE_PROFILES, LOOT_RECORDS);
    expect(compiled.byCreatureId.get(variant.id)).toMatchObject({ level: 27, availability: 'lab', enemy: { name: variant.name } });
    expect(() => compileCreatures([...CREATURE_DEFINITIONS, variant, { ...variant, id: 'invalid_chain', baseId: variant.id }], CREATURE_PROFILES, LOOT_RECORDS)).toThrow(/variants cannot inherit variants/);
  });

  it('rejects invalid formula parameters and nonfinite outputs at the JSON boundary', () => {
    expect(() => previewFormula('production.linear', { tier: 10 }, { durationMs: 1000, xpBase: 0, xpPerLevel: -1 })).toThrow();
    expect(() => previewFormula('production.linear', { tier: 10 }, { durationMs: 1000, xpBase: 0, xpPerLevel: Number.MAX_VALUE })).toThrow();
  });
});
