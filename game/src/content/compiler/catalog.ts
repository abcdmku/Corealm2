import { formatContentJson } from './canonical.js';
import { contentRevision } from './revision.js';
import { CONTENT_COLLECTIONS, parseContentCollection } from './collections.js';
import { collectionReferenceIssues, type ReferencePools } from './references.js';
import { compileProgression } from './progression.js';
import type { CompiledDomain, ContentDiagnostic, SourceLocation } from './contracts.js';
import { compileWorld, type WorldCreature } from '../worldCompiler.js';
import { createWorldCreatureResolver, worldRegionBounds } from '../worldCreatureResolver.js';
import { compileCreatures } from '../creatureCompiler.js';
import { CATALOG_REVISION, clientCatalog, type ClientCatalog } from '../clientCatalog.js';
import type { EncounterDefinition, WorldPlacement } from '../schema/encounters.js';
import type { WorldRegionGeometry } from '../schema/worldRegions.js';
import type { CreatureDefinition, CreatureProfile } from '../schema/creatureDefinitions.js';
import type { LootTableRecord } from '../schema/loot.js';
import { SKILL_IDS, SPELL_ELEMENTS } from '../../contracts.js';
import { COMPOSITION_IDS } from '../../render/compositionIds.js';

/**
 * The server catalog: every resolved table, authoring inputs included. `revision` names this catalog
 * and the client catalog projected from it. `formulaRevision` names the formula code it was compiled
 * with, which ships with a server release and never changes while a server runs.
 */
export type ServerCatalog = CompiledDomain<Record<string, unknown>> & { formulaRevision: string };
export type ContentBuild = ServerCatalog & { ok: boolean; diagnostics: ContentDiagnostic[] };
/** Source collections by collection name, exactly as `game/content/data/` holds them. */
export type ContentSources = Readonly<Record<string, unknown>>;
export type CatalogCompilation = { ok: true; catalog: ServerCatalog; client: ClientCatalog; problems: ContentDiagnostic[] }
  | { ok: false; problems: ContentDiagnostic[] };

/**
 * Pure: reads no file and no clock. `formulaRevision` comes from the caller because only the caller
 * knows where formula code lives. A repo checkout hashes `game/src/content`; a bundled server passes
 * the `formulaRevision` of the catalog it was built with, which is that same hash taken at build time.
 */
export function compileContent(values: ReadonlyMap<string, unknown>, external: ReferencePools, formulaRevision: string): ContentBuild {
  if (!CATALOG_REVISION.test(formulaRevision)) throw new Error('formulaRevision must be a sha256 hex digest');
  const diagnostics: ContentDiagnostic[] = [], tables: Record<string, unknown> = {}, sourceMap: Record<string, SourceLocation> = {};
  const revision = contentRevision(formatContentJson(Object.fromEntries([...values].sort(([a],[b]) => a.localeCompare(b)))));
  for (const spec of CONTENT_COLLECTIONS) {
    try { tables[spec.name] = parseContentCollection(spec, values.get(spec.name)); }
    catch (error) { diagnostics.push({path: spec.name, message: error instanceof Error ? error.message : String(error), severity: 'error'}); }
  }
  if (!diagnostics.length) try {
    const output = compileProgression({items: tables.items, recipes: tables.recipes, resources: tables.resources, materials: tables.materials, equipmentFamilies: tables.equipmentFamilies, recipeTemplates: tables.recipeTemplates, progression: tables.progression});
    Object.assign(tables, {items: output.items, recipes: output.recipes, resources: output.resources}); Object.assign(sourceMap, output.sourceMap);
  } catch (error) { diagnostics.push({path:'progression', message: error instanceof Error ? error.message : String(error), severity:'error'}); }
  // Retired definitions still resolve. They leave every loot roll, shop shelf and placement here, once, so no system has to ask.
  type Row = Record<string, unknown>;
  const retiredItems = new Set(diagnostics.length ? [] : (tables.items as Row[]).filter(row => row.retired === true).map(row => String(row.id)));
  const info = (path: string, message: string) => diagnostics.push({ path, message, severity: 'info' });
  // Quests, stations and other recipes may still name a recipe that is no longer craftable, so references check against every authored id.
  const authoredRecipes = new Set(diagnostics.length ? [] : (tables.recipes as Row[]).map(row => String(row.id)));
  if (retiredItems.size && !diagnostics.length) {
    const drops = (owner: string, plan: unknown) => { for (const roll of ((plan as { rolls?: { id: string; drops: { itemId: string }[] }[] } | undefined)?.rolls ?? []))
      for (const drop of roll.drops) if (retiredItems.has(drop.itemId)) info(`${owner}.${roll.id}`, `Retired item ${drop.itemId} no longer drops`); };
    for (const row of tables.creatureDefinitions as Row[]) drops(`creatureDefinitions.${row.id}.loot`, row.loot);
    for (const row of tables.lootTables as Row[]) drops(`lootTables.${row.id}`, row);
    tables.shops = (tables.shops as (Row & { stock: { itemId: string }[] })[]).map(shop => {
      for (const entry of shop.stock) if (retiredItems.has(entry.itemId)) info(`shops.${shop.id}.stock`, `Retired item ${entry.itemId} is no longer sold`);
      return { ...shop, stock: shop.stock.filter(entry => !retiredItems.has(entry.itemId)) };
    });
    // A recipe that makes a retired item leaves the table, which is what hides it from every station list. One that only consumes it stays, so players can use up their stock.
    tables.recipes = (tables.recipes as (Row & { output: { itemId: string } })[]).filter(recipe => {
      if (retiredItems.has(recipe.output.itemId)) info(`recipes.${recipe.id}.output`, `Retired item ${recipe.output.itemId} can no longer be made`);
      return !retiredItems.has(recipe.output.itemId);
    });
    // A node must yield something, so a retired main yield is the author's to change. Bonus yields are simply dropped.
    tables.resources = (tables.resources as (Row & { itemId: string; bonus?: { itemId: string }[] })[]).map(resource => {
      if (retiredItems.has(resource.itemId)) diagnostics.push({ path: `resources.${resource.id}.itemId`, message: `Still yields retired item ${resource.itemId}. Give the node another yield or remove it.`, severity: 'warning' });
      if (!resource.bonus?.some(entry => retiredItems.has(entry.itemId))) return resource;
      for (const entry of resource.bonus) if (retiredItems.has(entry.itemId)) info(`resources.${resource.id}.bonus`, `Retired item ${entry.itemId} is no longer a bonus yield`);
      return { ...resource, bonus: resource.bonus.filter(entry => !retiredItems.has(entry.itemId)) };
    });
  }
  if (!diagnostics.some(issue => issue.severity === 'error')) try {
    const output = compileCreatures(tables.creatureDefinitions as CreatureDefinition[], tables.creatureProfiles as CreatureProfile[], tables.lootTables as LootTableRecord[], retiredItems);
    tables.compiledCreatures = output.creatures; tables.enemies = output.enemies; tables.species = output.species;
    for(const creature of output.creatures) sourceMap[`enemies:${creature.id}`] = {collection:'creatureDefinitions',id:creature.id,formula:'creature.combat',profile:creature.profileId,inputs:{tier:creature.level}};
  } catch(error) {diagnostics.push({path:'creatureDefinitions',message:error instanceof Error?error.message:String(error),severity:'error'});}
  const regionGeometry=(tables.worldRegions??[]) as WorldRegionGeometry[];
  const regionBounds=worldRegionBounds(regionGeometry);
  if(!diagnostics.some(issue=>issue.severity==='error'))try{
    const creatures=tables.compiledCreatures as ReturnType<typeof compileCreatures>['creatures'];
    const resolveCreature=createWorldCreatureResolver(new Map(creatures.map(row=>[row.id,row])),tables.creatureProfiles as CreatureProfile[]);
    const creatureMap=new Map<string,WorldCreature>();
    for(const encounter of tables.encounters as EncounterDefinition[])for(const member of encounter.members){
      const creature=resolveCreature(member.creatureId);
      if(creature)creatureMap.set(creature.id,creature);
      else {const definition=creatures.find(row=>row.id===member.creatureId);if(definition)throw new Error(`encounters.${encounter.id}: creature ${member.creatureId} ${definition.availability!=='world'?'is available only in the lab':'needs a presentation with an asset and scale on its definition or base'}`);}
    }
    const retired=new Set(creatures.filter(row=>row.retired).map(row=>row.id));
    for(const encounter of tables.encounters as EncounterDefinition[])for(const member of encounter.members)if(retired.has(member.creatureId))info(`encounters.${encounter.id}.members`,`Retired creature ${member.creatureId} no longer spawns`);
    const world=compileWorld({encounters:tables.encounters as EncounterDefinition[],placements:tables.placements as WorldPlacement[],regions:regionBounds,creatures:creatureMap,resolveCreature,retired});
    diagnostics.push(...world.diagnostics);tables.world={regions:regionGeometry,encounters:tables.encounters,placements:tables.placements,resources:tables.resourcePlacements,groupsByRegion:Object.fromEntries(world.groupsByRegion),habitats:world.habitats,creatureByGroup:Object.fromEntries(world.creatureByGroup)};
    for(const row of tables.placements as WorldPlacement[])sourceMap[`placements:${row.id}`]={collection:'placements',id:row.id,inputs:{encounterId:row.encounterId,level:row.level}};
  }catch(error){diagnostics.push({path:'placements',message:error instanceof Error?error.message:String(error),severity:'error'});}
  const ids = (name: string, key = 'id') => new Set((Array.isArray(tables[name]) ? tables[name] as Record<string, unknown>[] : []).map(row => String(row[key])));
  const audio = tables.audio as {cues?: object; loops?: object} | undefined;
  const pools: ReferencePools = {...external, material:ids('materials'), equipmentFamily:ids('equipmentFamilies'), recipeTemplate:ids('recipeTemplates'), creatureProfile:ids('creatureProfiles'), encounter:ids('encounters'), region:new Set(regionBounds.map(row=>row.id)), item: ids('items'), recipe: authoredRecipes, resource: ids('resources'), npc: ids('npcs'), shop: ids('shops'), quest: ids('quests'), dialogue: ids('dialogue'), spell: ids('spells'), rune: ids('spellRunes','itemId'), set: ids('equipmentSets'), campfireFuel: ids('campfireFuels','logItemId'), enemy: ids('creatureDefinitions'), species: ids('creatureDefinitions'), lootTable: ids('lootTables'), skill: new Set(SKILL_IDS), element: new Set(SPELL_ELEMENTS), composition: new Set(COMPOSITION_IDS), audio: new Set([...Object.keys(audio?.cues ?? {}), ...Object.keys(audio?.loops ?? {})])};
  if (!diagnostics.some(issue => issue.severity === 'error')) for (const spec of CONTENT_COLLECTIONS) {
    const rows = spec.shape === 'array' ? tables[spec.name] as unknown[] : [tables[spec.name]];
    rows.forEach((row,index) => diagnostics.push(...collectionReferenceIssues(spec.name,spec.schema,row,pools,`${spec.name}[${index}]`)));
  }
  return {version:1, revision:contentRevision(formatContentJson({sourceRevision:revision,formulaRevision,tables})), formulaRevision, tables, sourceMap, diagnostics, ok: !diagnostics.some(issue => issue.severity === 'error')};
}

/**
 * The in-process compile a running server uses: source collections and reference pools in, both
 * catalogs out. `problems` carries warnings when `ok`, and the errors that refused it when not.
 */
export function compileCatalog(sources: ContentSources, options: { formulaRevision: string; pools?: ReferencePools }): CatalogCompilation {
  const { ok, diagnostics, ...catalog } = compileContent(new Map(Object.entries(sources)), options.pools ?? {}, options.formulaRevision);
  return ok ? { ok, catalog, client: clientCatalog(catalog), problems: diagnostics } : { ok, problems: diagnostics };
}
